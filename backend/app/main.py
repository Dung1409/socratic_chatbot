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
from .extraction import ExtractionError, MAX_FILE_BYTES, extract_text, validate_upload
from .jobs import JobQueue
from .schemas import AssignmentInput, SessionInput, ActionInput, MessageInput, SubmissionInput
from .tutor import BLOOM_NAMES, lesson_steps, tutor_turn
from .ai_tutor import OpenAITutor
from .adaptive import AdaptiveSessions, public_pending
from . import config

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
        yield

    app = FastAPI(title="SocraVăn API", version="0.1.0", lifespan=lifespan,
                  description="Đối thoại Socratic thích ứng cho đọc hiểu/nghị luận xã hội; đánh giá Bloom và mức tự lực.")
    app.state.db = db
    app.state.queue = queue
    app.state.auth = auth
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
            if config.production() and tutor_mode == "openai" and not tutor.configured:
                raise RuntimeError("AI is not configured")
        except Exception as exc:
            raise HTTPException(503, "Database hoặc kho tệp chưa sẵn sàng") from exc
        return {"status": "ready", "database": "postgresql" if db.postgres else "sqlite",
                "background_jobs": background_jobs}

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
            text = extract_text(filename, data)
        except ExtractionError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        return {"filename": filename, "title": Path(filename).stem, "text": text, "needs_confirmation": True}

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

    @app.get("/api/documents/{document_id}", tags=["Documents"])
    def document(document_id: str, user: Principal = Depends(auth.current_user)):
        result = queue.document(document_id, owner_id=user.id)
        if result is None:
            raise HTTPException(404, "Không tìm thấy tài liệu")
        return result

    @app.post("/api/sessions", tags=["Sessions"])
    def start_session(body: SessionInput, user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            assignment = require(conn, "assignments", body.assignment_id, user.id)
            existing = next((s for s in saved_sessions(conn, user.id) if s["assignment_id"] == body.assignment_id), None)
        if existing:
            return public_session(existing)
        if assignment.get("source") == "legacy_seed":
            raise HTTPException(404, "Hãy tải lên hoặc nhập đề riêng để bắt đầu tự học")
        if tutor_mode == "openai":
            return public_session(adaptive.start(assignment, user.id))
        with db.connect(write=True) as conn:
            assignment = require(conn, "assignments", body.assignment_id, user.id)
            # Repeated starts (including a remount or double click) resume the saved session.
            existing = next((s for s in saved_sessions(conn, user.id) if s["assignment_id"] == body.assignment_id), None)
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

    @app.get("/api/sessions", tags=["Sessions"])
    def sessions(user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return [public_session(s) for s in saved_sessions(conn, user.id)]

    @app.get("/api/sessions/{session_id}", tags=["Sessions"])
    def get_session(session_id: str, user: Principal = Depends(auth.current_user)):
        with db.connect() as conn:
            return public_session(require(conn, "sessions", session_id, user.id))

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
            return {
                "bloom_profile": [{"skill": name, "value": sum(t["kind"] == "student" and t.get("purpose") != "source" and t["level"] == i + 1 for s in saved for t in s["turns"])} for i, name in enumerate(BLOOM_NAMES)],
                "sessions": [public_session(s) for s in saved],
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
