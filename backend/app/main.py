import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .db import Database
from .auth import AuthService, Principal, UNSAFE_METHODS, auth_router
from .extraction import ExtractionError, MAX_FILE_BYTES, extract_document, extract_image_batch, validate_upload
from .structure import structure_text
from .jobs import JobQueue
from .schemas import (AssignmentInput, StructureInput, SessionInput, ActionInput, MessageInput, SubmissionInput,
                      MultiAssignmentInput, SessionTurnInput, SessionItemStatusInput, SessionSelectItemInput)
from .tutor import BLOOM_NAMES, lesson_steps, tutor_turn
from .ai_tutor import OpenAITutor
from .adaptive import AdaptiveSessions, public_pending
from . import config
from .proxy import PublicOriginMiddleware

ROOT = config.ROOT
logger = logging.getLogger("socratic.api")


def now():
    return datetime.now(timezone.utc).isoformat()


def require(conn, collection, identifier, owner_id):
    value = Database.get(conn, collection, identifier, owner_id=owner_id)
    if value is None:
        raise HTTPException(404, "Không tìm thấy dữ liệu")
    return value


def public_session(session):
    result = {key: value for key, value in session.items()
            if key not in {"requests", "rubric", "review", "student_id", "student_name", "class_name"}}
    if session.get("tutor_mode") == "openai":
        result["pending_action"] = public_pending(session.get("pending_action"))
    return result


def saved_sessions(conn, owner_id):
    return sorted(Database.all(conn, "sessions", owner_id=owner_id), key=lambda s: s["updated_at"], reverse=True)


def create_app(database_path: str | None = None, frontend_dist: Path | None = None,
               storage_path: Path | None = None, tutor_engine=None):
    db = Database(database_path) if database_path else Database.from_env()
    background_jobs = config.boolean("BACKGROUND_JOBS", False)
    queue = JobQueue(db, storage_path or config.storage_path())
    auth = AuthService(db)
    tutor = tutor_engine or OpenAITutor()
    tutor_mode = os.getenv("TUTOR_MODE", "openai")
    if tutor_mode not in ("openai", "template"):
        raise ValueError("TUTOR_MODE must be openai or template")
    adaptive = AdaptiveSessions(db, tutor, before_ai_call=lambda owner: auth.resource_limit(owner, "ai"))

    @asynccontextmanager
    async def lifespan(app):
        config.configure_logging()
        config.validate_runtime(db)
        auth.configure()
        if config.auto_migrate():
            db.initialize()
        else:
            db.check_ready()
        if background_jobs:
            queue.storage_path.mkdir(parents=True, exist_ok=True)
            config.check_storage(queue.storage_path)
        logger.info("API started database=%s background_jobs=%s", "postgresql" if db.postgres else "sqlite", background_jobs)
        if not config.trust_proxy_headers():
            logger.warning("Proxy headers are disabled; client IP may be the ingress peer, not a learner. "
                           "Authentication IP limits are shared per peer; email, global and user limits remain active.")
        yield

    app = FastAPI(title="Trợ lý ảo AI API", version="0.1.0", lifespan=lifespan,
                  description="Đối thoại Socratic thích ứng cho đọc hiểu/nghị luận xã hội; đánh giá Bloom và mức tự lực.")
    app.state.db = db
    app.state.queue = queue
    app.state.auth = auth
    public_origin = config.public_api_origin()
    if public_origin:
        app.add_middleware(PublicOriginMiddleware, origin=public_origin)
    origins = config.origins(
        "AUTH_ALLOWED_ORIGINS",
        "" if config.production() else "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080,http://localhost:8000,http://127.0.0.1:8000")
    cors_origins = config.origins("CORS_ORIGINS", "" if config.production() else "http://localhost:5173,http://127.0.0.1:5173")
    if config.production() and not set(cors_origins).issubset(origins):
        raise RuntimeError("CORS_ORIGINS must be included in AUTH_ALLOWED_ORIGINS")
    app.add_middleware(CORSMiddleware, allow_origins=cors_origins,
        allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"], expose_headers=["Retry-After", "X-Request-ID"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's input/ctx may contain passwords, essays or other private data.
        errors = [{key: error[key] for key in ("type", "loc", "msg") if key in error} for error in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.middleware("http")
    async def protect_browser_requests(request: Request, call_next):
        started = time.monotonic()
        request_id = str(uuid4())
        response = None
        if request.url.path.startswith("/api/") and request.method in UNSAFE_METHODS:
            origin = request.headers.get("origin")
            if (origin is not None and origin.rstrip("/") not in origins) or (
                    origin is None and request.headers.get("sec-fetch-site") == "cross-site"):
                response = JSONResponse({"detail": "Nguồn yêu cầu không được phép."}, status_code=403)
        if response is None:
            try:
                response = await call_next(request)
            except Exception as exc:
                logger.error("Request failed request_id=%s error_type=%s", request_id, type(exc).__name__)
                response = JSONResponse({"detail": "Hệ thống chưa xử lý được yêu cầu. Vui lòng thử lại."}, status_code=500)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["CDN-Cache-Control"] = "no-store"
            response.headers["Vercel-CDN-Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["X-Request-ID"] = request_id
            if request.url.path not in {"/api/health", "/api/ready"}:
                route = getattr(request.scope.get("route"), "path", "unmatched")
                logger.info("request_id=%s method=%s route=%s status=%s duration_ms=%s",
                            request_id, request.method, route, response.status_code,
                            round((time.monotonic() - started) * 1000))
        return response

    app.include_router(auth_router(auth))

    @app.get("/api/health", tags=["System"])
    def health():
        return {"status": "ok", "tutor_mode": tutor_mode, "auth_mode": "jwt_cookie",
                "ai_configured": tutor.configured if tutor_mode == "openai" else False}

    @app.get("/api/ready", tags=["System"])
    def ready():
        try:
            db.check_ready()
            if background_jobs:
                config.check_storage(queue.storage_path)
            if config.run_mode() == "combined":
                from .combined import check_health
                check_health()
            if config.production() and tutor_mode == "openai" and not tutor.configured:
                raise RuntimeError("AI is not configured")
        except Exception as exc:
            raise HTTPException(503, "Database hoặc kho tệp chưa sẵn sàng") from exc
        return {"status": "ready", "database": "postgresql" if db.postgres else "sqlite",
                "background_jobs": background_jobs}

    def _row_dict(row):
        return dict(row) if row is not None else None

    def _decode_json(value, fallback):
        if value in (None, ""):
            return fallback
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return fallback

    def _multi_assignment(conn, assignment_id, owner_id):
        row = db.execute(conn, "SELECT * FROM assignments WHERE id=? AND owner_id=?",
                         (assignment_id, owner_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Không tìm thấy đề bài")
        assignment = _row_dict(row)
        assignment["items"] = []
        for item_row in db.execute(conn, "SELECT * FROM assignment_items WHERE assignment_id=? ORDER BY item_order",
                                   (assignment_id,)).fetchall():
            item = _row_dict(item_row)
            item["source_pages"] = _decode_json(item["source_pages"], [])
            item["metadata"] = _decode_json(item.pop("metadata_json", None), {})
            assignment["items"].append(item)
        return assignment

    @app.post("/api/learning/assignments", status_code=201, tags=["Multi-question learning"])
    def create_multi_assignment(body: MultiAssignmentInput, user: Principal = Depends(auth.current_user)):
        assignment_id = str(uuid4())
        now_value = now()
        with db.connect(write=True) as conn:
            if body.document_id and queue.document(body.document_id, owner_id=user.id) is None:
                raise HTTPException(404, "Không tìm thấy tài liệu")
            db.execute(conn, """INSERT INTO assignments
                (id, owner_id, title, prompt, task_type, source_text, document_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (assignment_id, user.id, body.title, body.prompt, body.task_type,
                        body.source_text, body.document_id, now_value, now_value))
            for order, item in enumerate(body.items, start=1):
                db.execute(conn, """INSERT INTO assignment_items
                    (id, assignment_id, item_order, item_type, label, prompt, context, source_pages, metadata_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                           (str(uuid4()), assignment_id, order, item.item_type, item.label, item.prompt,
                            item.context, json.dumps(item.source_pages), json.dumps(item.metadata, ensure_ascii=False), now_value))
            return _multi_assignment(conn, assignment_id, user.id)

    @app.get("/api/learning/assignments/{assignment_id}", tags=["Multi-question learning"])
    def get_multi_assignment(assignment_id: str, user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return _multi_assignment(conn, assignment_id, user.id)

    @app.post("/api/learning/assignments/{assignment_id}/sessions", status_code=201,
              tags=["Multi-question learning"])
    def create_learning_session(assignment_id: str, user: Principal = Depends(auth.current_user)):
        session_id = str(uuid4())
        now_value = now()
        with db.connect(write=True) as conn:
            assignment = _multi_assignment(conn, assignment_id, user.id)
            existing = db.execute(conn, "SELECT id FROM learning_sessions WHERE assignment_id=? AND owner_id=?",
                                   (assignment_id, user.id)).fetchone()
            if existing:
                return _session_payload(conn, existing["id"], user.id)
            db.execute(conn, """INSERT INTO learning_sessions
                (id, assignment_id, owner_id, active_item_order, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)""", (session_id, assignment_id, user.id, now_value, now_value))
            for order, item in enumerate(assignment["items"], start=1):
                db.execute(conn, """INSERT INTO session_items
                    (id, session_id, assignment_item_id, item_order)
                    VALUES (?, ?, ?, ?)""", (str(uuid4()), session_id, item["id"], order))
        return get_learning_session(session_id, user)

    def _session_payload(conn, session_id, owner_id):
        session_row = db.execute(conn, "SELECT * FROM learning_sessions WHERE id=? AND owner_id=?",
                                 (session_id, owner_id)).fetchone()
        if session_row is None:
            raise HTTPException(404, "Không tìm thấy phiên học")
        session = _row_dict(session_row)
        session["items"] = []
        rows = db.execute(conn, """SELECT si.*, ai.label, ai.item_type, ai.prompt, ai.context, ai.source_pages
            FROM session_items si JOIN assignment_items ai ON ai.id=si.assignment_item_id
            WHERE si.session_id=? ORDER BY si.item_order""", (session_id,)).fetchall()
        for row in rows:
            item = _row_dict(row)
            item["source_pages"] = _decode_json(item["source_pages"], [])
            item["turns"] = [_row_dict(turn) for turn in db.execute(
                "SELECT * FROM session_turns WHERE session_item_id=? ORDER BY turn_order", (item["id"],)).fetchall()]
            session["items"].append(item)
        return session

    @app.get("/api/learning/sessions/{session_id}", tags=["Multi-question learning"])
    def get_learning_session(session_id: str, user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return _session_payload(conn, session_id, user.id)

    @app.post("/api/learning/sessions/{session_id}/turns", status_code=201,
              tags=["Multi-question learning"])
    def add_learning_turn(session_id: str, body: SessionTurnInput,
                          user: Principal = Depends(auth.current_user)):
        with db.connect(write=True) as conn:
            owned = db.execute(conn, """SELECT si.id FROM session_items si
                JOIN learning_sessions ls ON ls.id=si.session_id
                WHERE si.id=? AND si.session_id=? AND ls.owner_id=?""",
                               (body.session_item_id, session_id, user.id)).fetchone()
            if owned is None:
                raise HTTPException(404, "Không tìm thấy câu trong phiên học")
            next_order = db.execute(conn, "SELECT COALESCE(MAX(turn_order), 0)+1 AS next_order FROM session_turns WHERE session_item_id=?",
                                    (body.session_item_id,)).fetchone()["next_order"]
            turn_id = str(uuid4())
            db.execute(conn, """INSERT INTO session_turns
                (id, session_item_id, turn_order, role, kind, text, bloom_level, strategy, objective, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (turn_id, body.session_item_id, next_order, body.role, body.kind, body.text,
                        body.bloom_level, body.strategy, body.objective,
                        json.dumps(body.metadata, ensure_ascii=False), now()))
            return _row_dict(db.execute(conn, "SELECT * FROM session_turns WHERE id=?", (turn_id,)).fetchone())

    @app.patch("/api/learning/session-items/{session_item_id}", tags=["Multi-question learning"])
    def update_learning_item(session_item_id: str, body: SessionItemStatusInput,
                             user: Principal = Depends(auth.current_user)):
        with db.connect(write=True) as conn:
            row = db.execute(conn, """SELECT si.session_id, si.item_order, ls.assignment_id FROM session_items si
                JOIN learning_sessions ls ON ls.id=si.session_id
                WHERE si.id=? AND ls.owner_id=?""", (session_item_id, user.id)).fetchone()
            if row is None:
                raise HTTPException(404, "Không tìm thấy câu trong phiên học")
            now_value = now()
            db.execute(conn, """UPDATE session_items SET status=?,
                started_at=CASE WHEN ?='active' AND started_at IS NULL THEN ? ELSE started_at END,
                completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END
                WHERE id=?""", (body.status, body.status, now_value, body.status, now_value, session_item_id))
            if body.status == "active":
                db.execute(conn, "UPDATE learning_sessions SET active_item_order=?, updated_at=? WHERE id=?",
                           (row["item_order"], now_value, row["session_id"]))
            db.execute(conn, """UPDATE learning_sessions SET updated_at=? WHERE id=?""", (now_value, row["session_id"]))
            counts = db.execute(conn, """SELECT COUNT(*) AS total,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
                FROM session_items WHERE session_id=?""", (row["session_id"],)).fetchone()
            total = counts["total"] or 0
            completed = counts["completed"] or 0
            progress = round(completed * 100 / total) if total else 0
            db.execute(conn, """UPDATE assignments SET progress=?, status=?, updated_at=? WHERE id=? AND owner_id=?""",
                       (progress, "completed" if progress == 100 else "active", now_value,
                        row["assignment_id"], user.id))
            return _session_payload(conn, row["session_id"], user.id)

    @app.get("/api/assignments", tags=["Assignments"])
    def assignments(user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            items = [a for a in db.all(conn, "assignments", owner_id=user.id) if a.get("source") != "legacy_seed"]
            sessions = saved_sessions(conn, user.id)
            for a in items:
                session = next((s for s in sessions if s["assignment_id"] == a["id"]), None)
                a["status"] = "Đã hoàn thành" if session and session["submitted"] else "Đang học" if session else "Chưa bắt đầu"
                a["progress"] = (100 if session and session["submitted"] else
                                 round(session["step"] / len(session["steps"]) * 100)
                                 if session and session.get("steps") else 0)
            return items

    @app.post("/api/assignments", status_code=201, tags=["Assignments"])
    def create_assignment(body: AssignmentInput, user: Principal = Depends(auth.current_user)):
        if body.document_id:
            document = queue.document(body.document_id, owner_id=user.id)
            if document is None:
                raise HTTPException(404, "Không tìm thấy tài liệu")
            if document["status"] != "needs_review":
                raise HTTPException(409, "Hãy chờ tệp được trích xuất trước khi xác nhận đề")
        item = {**body.model_dump(), "id": str(uuid4()), "source": "student", "status": "Chưa bắt đầu", "progress": 0}
        with db.connect(write=True) as conn:
            db.put(conn, "assignments", item["id"], item, owner_id=user.id)
        return item

    @app.post("/api/uploads/extract", tags=["Assignments"])
    def extract(file: UploadFile = File(...), user: Principal = Depends(auth.current_user)):
        auth.resource_limit(user.id, "upload")
        filename, data = read_upload(file)
        if background_jobs:
            return JSONResponse(queue.submit(filename, data, owner_id=user.id), status_code=202)
        try:
            extracted = extract_document(filename, data)
        except ExtractionError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        return {"filename": filename, "title": Path(filename).stem, **extracted,
                "structure": structure_text(extracted["text"], extracted["pages"]),
                "needs_confirmation": True}

    @app.post("/api/uploads/extract-batch", tags=["Assignments"])
    def extract_batch(files: list[UploadFile] = File(...), user: Principal = Depends(auth.current_user)):
        """Extract several pages/images in submitted order without merging them blindly."""
        if not files:
            raise HTTPException(422, "Cần tải lên ít nhất một tệp")
        uploads = [read_upload(file) for file in files]
        if all(Path(filename).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
               for filename, _ in uploads):
            try:
                extracted = extract_image_batch(uploads)
            except ExtractionError as exc:
                raise HTTPException(exc.status_code, str(exc)) from exc
            return {"combined": {"filename": f"{len(uploads)} ảnh", "title": "Tài liệu từ ảnh",
                                  **extracted, "structure": structure_text(extracted["text"], extracted["pages"])},
                    "needs_confirmation": True}
        documents = []
        for sequence, (filename, data) in enumerate(uploads, start=1):
            try:
                extracted = extract_document(filename, data)
            except ExtractionError as exc:
                raise HTTPException(exc.status_code, f"Tệp {sequence} ({filename}): {exc}") from exc
            documents.append({"sequence": sequence, "filename": filename, "title": Path(filename).stem,
                              **extracted,
                              "structure": structure_text(extracted["text"], extracted["pages"])})
        return {"documents": documents, "needs_confirmation": True,
                "warnings": ["Thứ tự nhiều tệp được giữ theo thứ tự gửi lên; hãy đối chiếu số trang in trên ảnh."]}

    @app.post("/api/uploads/structure", tags=["Assignments"])
    def analyze_structure(body: StructureInput, user: Principal = Depends(auth.current_user)):
        return structure_text(body.text, [page.model_dump() for page in body.pages] if body.pages else None)

    def read_upload(file):
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1][:300]
        data = file.file.read(MAX_FILE_BYTES + 1)
        try:
            validate_upload(filename, data)
        except ExtractionError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        return filename, data

    @app.post("/api/documents", status_code=202, tags=["Documents"])
    def upload_document(file: UploadFile = File(...), user: Principal = Depends(auth.current_user)):
        auth.resource_limit(user.id, "upload")
        filename, data = read_upload(file)
        return queue.submit(filename, data, owner_id=user.id)

    @app.get("/api/documents", tags=["Documents"])
    def documents(user: Principal = Depends(auth.current_user)):
        result = []
        for document in queue.documents(owner_id=user.id):
            structure = document.get("structure") or {}
            parts = structure.get("parts") or []
            questions = [question for part in parts for question in part.get("questions", [])]
            groups = []
            group_by_key = {}
            for question in questions:
                source = (question.get("materials") or "").strip()
                key = source or next((part.get("id") for part in parts
                                      if question in part.get("questions", [])), question.get("id"))
                group = group_by_key.get(key)
                if group is None:
                    group = {"id": f"source-{len(groups) + 1}", "label": "Ngữ liệu chung" if source else "Nội dung phần", "text": source,
                             "question_ids": [], "question_labels": []}
                    groups.append(group)
                    group_by_key[key] = group
                group["question_ids"].append(question.get("id"))
                group["question_labels"].append(question.get("label"))
            result.append({"document_id": document["document_id"], "filename": document["filename"],
                           "title": document["title"], "status": document["status"],
                           "created_at": document.get("created_at"), "updated_at": document.get("updated_at"),
                           "document_type": document.get("document_type"), "subject": document.get("subject"),
                           "page_count": len(document.get("pages") or []), "part_count": len(parts),
                           "question_count": len(questions), "warning_count": len(document.get("extraction_warnings") or []),
                           "groups": groups})
        return result

    @app.get("/api/documents/{document_id}", tags=["Documents"])
    def document(document_id: str, user: Principal = Depends(auth.current_user)):
        result = queue.document(document_id, owner_id=user.id)
        if result is None:
            raise HTTPException(404, "Không tìm thấy tài liệu")
        return result

    def item_assignment(base, item, items):
        assignment = dict(base)
        assignment.update(
            prompt=item["prompt"], task_type=item["item_type"], active_item_id=item["id"],
            items=[dict(entry) for entry in items],
            source_text=item["context"] or base.get("source_text", ""),
        )
        return assignment

    @app.post("/api/sessions", tags=["Sessions"])
    def start_session(body: SessionInput, user: Principal = Depends(auth.current_user)):
        with db.connect(write=True) as conn:
            assignment = Database.get(conn, "assignments", body.assignment_id, owner_id=user.id)
            # Multi-question assignments live in the relational learning tables, while
            # the existing session UI still calls this legacy endpoint. Build a
            # compatible read model so selecting several questions does not end in 404.
            if assignment is None:
                row = db.execute(conn, "SELECT * FROM assignments WHERE id=? AND owner_id=?",
                                 (body.assignment_id, user.id)).fetchone()
                if row is not None:
                    items = db.execute(conn, """SELECT id, label, prompt, context, item_type, item_order
                        FROM assignment_items WHERE assignment_id=? ORDER BY item_order""",
                                       (body.assignment_id,)).fetchall()
                    assignment = {
                        "id": row["id"], "title": row["title"],
                        "prompt": "\n\n".join(
                            f"{item['label']}: {item['prompt']}" for item in items),
                        "items": [dict(item) for item in items],
                        "source_text": row["source_text"], "source": "student",
                        "target": 4, "status": "Chưa bắt đầu",
                    }
                    Database.put(conn, "assignments", body.assignment_id, assignment, user.id)
            if assignment is None:
                raise HTTPException(404, "Không tìm thấy dữ liệu")
            saved = [s for s in saved_sessions(conn, user.id) if s["assignment_id"] == body.assignment_id]
            ordered_items = db.execute(conn, """SELECT id, label, prompt, context, item_type
                FROM assignment_items WHERE assignment_id=? ORDER BY item_order""", (body.assignment_id,)).fetchall()
            first_item_id = ordered_items[0]["id"] if ordered_items else None
            existing = next((s for s in saved
                             if not first_item_id or
                             (s.get("assignment") or {}).get("active_item_id") in {None, first_item_id}), None)
            existing = existing or (saved[0] if saved and not first_item_id else None)
            if existing and ordered_items:
                selected = next((entry for entry in ordered_items if entry["id"] ==
                                 (existing.get("assignment") or {}).get("active_item_id")), ordered_items[0])
                existing["assignment"] = item_assignment(existing["assignment"], selected, ordered_items)
                db.put(conn, "sessions", existing["id"], existing, owner_id=user.id)
            elif ordered_items:
                assignment = item_assignment(assignment, ordered_items[0], ordered_items)
        if existing:
            return public_session(adaptive.prepare_item(existing["id"], user.id)
                                  if existing.get("tutor_mode") == "openai" else existing)
        if assignment.get("source") == "legacy_seed":
            raise HTTPException(404, "Hãy tải lên hoặc nhập đề riêng để bắt đầu tự học")
        if tutor_mode == "openai":
            return public_session(adaptive.start(assignment, user.id))
        with db.connect(write=True) as conn:
            assignment = require(conn, "assignments", body.assignment_id, user.id)
            if ordered_items:
                assignment = item_assignment(assignment, ordered_items[0], ordered_items)
            # Repeated starts (including a remount or double click) resume the saved session.
            existing = next((s for s in saved_sessions(conn, user.id)
                             if s["assignment_id"] == body.assignment_id and
                             (s.get("assignment") or {}).get("active_item_id") == assignment.get("active_item_id")), None)
            if existing:
                return public_session(existing)
            if assignment.get("source") == "legacy_seed":
                raise HTTPException(404, "Hãy tải lên hoặc nhập đề riêng để bắt đầu tự học")
            steps = lesson_steps(assignment)
            session = {
                "id": str(uuid4()), "assignment_id": assignment["id"], "assignment": assignment,
                "steps": steps, "step": 0, "hint_tier": 0, "done": False, "submitted": False,
                "essay": "", "turns": [tutor_turn(0, steps)], "version": 0, "requests": {},
                "created_at": now(), "updated_at": now(), "tutor_mode": "template",
            }
            db.put(conn, "sessions", session["id"], session, owner_id=user.id)
            return public_session(session)

    @app.post("/api/sessions/{session_id}/select-item", tags=["Sessions"])
    def select_session_item(session_id: str, body: SessionSelectItemInput,
                            user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            session = require(conn, "sessions", session_id, user.id)
            assignment_id = session.get("assignment_id")
            all_items = db.execute(conn, """SELECT id, label, prompt, context, item_type
                FROM assignment_items WHERE assignment_id=? ORDER BY item_order""", (assignment_id,)).fetchall()
            item = next((entry for entry in all_items if entry["id"] == body.item_id), None)
            if item is None:
                raise HTTPException(404, "Không tìm thấy câu hỏi đã chọn")
            candidate = next((saved for saved in saved_sessions(conn, user.id)
                              if saved.get("assignment_id") == assignment_id and
                              (saved.get("assignment") or {}).get("active_item_id") == item["id"]), None)
        if candidate:
            with db.connect(write=True) as conn:
                candidate = require(conn, "sessions", candidate["id"], user.id)
                candidate["assignment"] = item_assignment(candidate["assignment"], item, all_items)
                candidate["updated_at"] = now()
                db.put(conn, "sessions", candidate["id"], candidate, owner_id=user.id)
            return public_session(adaptive.prepare_item(candidate["id"], user.id)
                                  if candidate.get("tutor_mode") == "openai" else candidate)
        assignment = item_assignment(session["assignment"], item, all_items)
        if session.get("tutor_mode") == "openai":
            return public_session(adaptive.start(assignment, user.id))
        with db.connect(write=True) as conn:
            steps = lesson_steps(assignment)
            selected_session = {
                "id": str(uuid4()), "assignment_id": assignment_id, "assignment": assignment,
                "steps": steps, "step": 0, "hint_tier": 0, "done": False, "submitted": False,
                "essay": "", "turns": [tutor_turn(0, steps)], "version": 0, "requests": {},
                "created_at": now(), "updated_at": now(), "tutor_mode": "template",
            }
            db.put(conn, "sessions", selected_session["id"], selected_session, owner_id=user.id)
            return public_session(selected_session)

    @app.get("/api/sessions", tags=["Sessions"])
    def sessions(user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return [public_session(s) for s in saved_sessions(conn, user.id)]

    @app.get("/api/sessions/{session_id}", tags=["Sessions"])
    def get_session(session_id: str, user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return public_session(require(conn, "sessions", session_id, user.id))

    @app.post("/api/sessions/{session_id}/prepare", tags=["Sessions"])
    def prepare_session(session_id: str, user: Principal = Depends(auth.current_user)):
        with db.connect(write=True) as conn:
            session = require(conn, "sessions", session_id, user.id)
            items = db.execute(conn, """SELECT id, label, prompt, context, item_type
                FROM assignment_items WHERE assignment_id=? ORDER BY item_order""",
                               (session["assignment_id"],)).fetchall()
            if items:
                active_id = (session.get("assignment") or {}).get("active_item_id") or items[0]["id"]
                item = next((entry for entry in items if entry["id"] == active_id), items[0])
                assignment = item_assignment(session["assignment"], item, items)
                if session["assignment"] != assignment:
                    session["assignment"] = assignment
                    db.put(conn, "sessions", session_id, session, owner_id=user.id)
        if session.get("tutor_mode") == "openai":
            session = adaptive.prepare_item(session_id, user.id)
        return public_session(session)

    def mutate(session_id, body, action, owner_id):
        with db.connect() as conn:
            saved = require(conn, "sessions", session_id, owner_id)
        if saved.get("tutor_mode") == "openai":
            return public_session(adaptive.mutate(session_id, body, action, owner_id))
        if action not in ("hint", "message", "submit"):
            raise HTTPException(409, "Thao tác này chỉ áp dụng cho phiên AI thích ứng.")
        with db.connect(write=True) as conn:
            session = require(conn, "sessions", session_id, owner_id)
            fingerprint = hashlib.sha256(json.dumps({"action": action, **body.model_dump()}, sort_keys=True).encode()).hexdigest()
            previous = session["requests"].get(body.client_message_id)
            if previous:
                if previous != fingerprint:
                    raise HTTPException(409, "Mã yêu cầu đã được dùng cho nội dung khác")
                return public_session(session)
            if session["version"] != body.expected_version:
                raise HTTPException(409, "Phiên đã thay đổi. Vui lòng tải lại trước khi gửi tiếp.")
            if session["submitted"] or (session["done"] and action != "submit"):
                raise HTTPException(409, "Phiên đã kết thúc đối thoại")
            step = session["step"]
            current = session["steps"][step]
            if action == "hint":
                if session["hint_tier"] >= 3:
                    raise HTTPException(409, "Đã dùng hết gợi ý ở câu hỏi này")
                tier = session["hint_tier"] + 1
                session["turns"].append({"kind": "hint", "step": step, "tier": tier, "text": current["hints"][tier - 1]})
                session["hint_tier"] = tier
            elif action == "message":
                session["turns"].append({"kind": "student", "step": step, "text": body.text, "level": current["level"], "hints": session["hint_tier"], "quality": None})
                # Demo follows a question script. Progress is NOT evidence of mastery.
                if step < len(session["steps"]) - 1:
                    session["step"] += 1
                    session["hint_tier"] = 0
                    session["turns"].append(tutor_turn(session["step"], session["steps"]))
                else:
                    session["done"] = True
            else:
                if not session["done"]:
                    raise HTTPException(409, "Hoàn thành các câu hỏi trước khi nộp bài")
                session.update(essay=body.essay, submitted=True, submitted_at=now())
            session["version"] += 1
            session["updated_at"] = now()
            session["requests"][body.client_message_id] = fingerprint
            db.put(conn, "sessions", session_id, session, owner_id=owner_id)
            return public_session(session)

    @app.post("/api/sessions/{session_id}/messages", tags=["Sessions"])
    def message(session_id: str, body: MessageInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "message", user.id)

    @app.post("/api/sessions/{session_id}/hints", tags=["Sessions"])
    def hint(session_id: str, body: ActionInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "hint", user.id)

    @app.post("/api/sessions/{session_id}/submit", tags=["Sessions"])
    def submit(session_id: str, body: SubmissionInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "submit", user.id)

    @app.post("/api/sessions/{session_id}/finish", tags=["Sessions"])
    def finish(session_id: str, body: ActionInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "finish", user.id)

    @app.post("/api/sessions/{session_id}/continue", tags=["Sessions"])
    def continue_session(session_id: str, body: ActionInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "continue", user.id)

    @app.post("/api/sessions/{session_id}/cancel", tags=["Sessions"])
    def cancel(session_id: str, body: ActionInput, user: Principal = Depends(auth.current_user)):
        return mutate(session_id, body, "cancel", user.id)

    @app.get("/api/dashboard", tags=["Analytics"])
    def dashboard(user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            saved = saved_sessions(conn, user.id)
            answers = [t for s in saved for t in s["turns"] if t["kind"] == "student" and t.get("purpose") != "source"]
            hints = sum(t["kind"] == "hint" for s in saved for t in s["turns"])
            return {"sessions": len(saved), "answers": len(answers), "hints": hints,
                    "hints_per_answer": round(hints / len(answers), 1) if answers else 0,
                    "submitted": sum(s["submitted"] for s in saved),
                    "latest_session": public_session(next((s for s in saved if not s["submitted"]), saved[0])) if saved else None}

    @app.get("/api/progress", tags=["Analytics"])
    def progress(user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            saved = saved_sessions(conn, user.id)
            sessions_by_assignment = {}
            for session in saved:
                sessions_by_assignment.setdefault(session["assignment_id"], []).append(session)
            groups = []
            relational = db.execute(conn, """SELECT id, title, created_at FROM assignments
                WHERE owner_id=? ORDER BY created_at DESC""", (user.id,)).fetchall()
            relational_ids = {row["id"] for row in relational}
            for assignment in relational:
                assignment_sessions = sessions_by_assignment.get(assignment["id"], [])
                question_rows = db.execute(conn, """SELECT id, item_order, label, prompt, metadata_json
                    FROM assignment_items WHERE assignment_id=? ORDER BY item_order""",
                                           (assignment["id"],)).fetchall()
                questions = []
                for index, row in enumerate(question_rows):
                    matched = next((session for session in assignment_sessions
                                    if (session.get("assignment") or {}).get("active_item_id") == row["id"]), None)
                    if matched is None and index == 0:
                        matched = next((session for session in assignment_sessions
                                        if not (session.get("assignment") or {}).get("active_item_id")), None)
                    metadata = _decode_json(row["metadata_json"], {})
                    questions.append({
                        "id": row["id"], "order": row["item_order"], "label": row["label"],
                        "prompt": row["prompt"], "source_only": bool(metadata.get("source_only")),
                        "session_id": matched["id"] if matched else None,
                    })
                if not questions:
                    questions = [{"id": assignment["id"], "order": 1, "label": "Tài liệu đầu vào",
                                  "prompt": "", "source_only": True,
                                  "session_id": assignment_sessions[0]["id"] if assignment_sessions else None}]
                groups.append({"id": assignment["id"], "title": assignment["title"],
                               "created_at": assignment["created_at"], "items": questions})
            for assignment in db.all(conn, "assignments", owner_id=user.id):
                if assignment["id"] in relational_ids or assignment.get("source") == "legacy_seed":
                    continue
                assignment_sessions = sessions_by_assignment.get(assignment["id"], [])
                groups.append({"id": assignment["id"], "title": assignment["title"],
                               "created_at": assignment.get("created_at", ""),
                               "items": [{"id": assignment["id"], "order": 1,
                                          "label": "Nội dung đầu vào" if assignment.get("source_only") else "Câu hỏi",
                                          "prompt": assignment.get("prompt", ""),
                                          "source_only": bool(assignment.get("source_only")),
                                          "session_id": assignment_sessions[0]["id"] if assignment_sessions else None}]})
            groups.sort(key=lambda group: group["created_at"], reverse=True)
            return {
                "bloom_profile": [{"skill": name, "value": sum(t["kind"] == "student" and t.get("purpose") != "source" and t["level"] == i + 1 for s in saved for t in s["turns"])} for i, name in enumerate(BLOOM_NAMES)],
                "sessions": [public_session(s) for s in saved],
                "assignments": groups,
            }

    dist = (frontend_dist or ROOT / "frontend/dist").resolve()
    if dist.is_dir():
        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "API không tồn tại")
            candidate = (dist / path).resolve()
            if not candidate.is_relative_to(dist):
                raise HTTPException(404)
            if candidate.is_file():
                return FileResponse(candidate)
            if path.startswith("assets/") or Path(path).suffix:
                raise HTTPException(404)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
