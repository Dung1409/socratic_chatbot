"""Durable adaptive sessions. Provider calls never hold a database transaction."""
import copy
import hashlib
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from .ai_tutor import POLICY_VERSION, TutorError
from .assessment import SCORING_VERSION, build_report
from .db import Database

LEASE_SECONDS = 120


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def require_session(db, conn, session_id, owner_id):
    session = db.get(conn, "sessions", session_id, owner_id=owner_id)
    if session is None:
        raise HTTPException(404, "Không tìm thấy phiên học")
    return session


def public_pending(pending):
    if not pending:
        return None
    status = pending["status"]
    if status == "processing" and pending["lease_until"] <= time.time():
        status = "failed"
    return {key: pending[key] for key in ("action", "text", "client_message_id")} | {"status": status}


def response_turn(reply, session, requested=False):
    support = reply.kind == "support"
    if support != bool(reply.support_reason):
        raise TutorError("AI chưa phân loại hỗ trợ hợp lệ. Em hãy thử lại.")
    if requested and reply.kind not in ("support", "source_request"):
        raise TutorError("AI chưa tạo được gợi ý phù hợp. Em hãy thử lại.")
    if support and any(" ".join(t["text"].split()).casefold() == " ".join(reply.text.split()).casefold()
                       for t in session["turns"] if t["kind"] == "hint"):
        raise TutorError("AI lặp lại hỗ trợ đã có. Em hãy thử lại để nhận gợi ý khác; lượt này chưa tính hỗ trợ.")
    turn = {"id": str(uuid4()), "kind": "hint" if support else "tutor", "step": 0,
            "text": reply.text, "level": reply.bloom_level, "response_kind": reply.kind,
            "strategy": reply.strategy, "objective": reply.objective,
            "created_at": timestamp()}
    if support:
        turn["tier"] = session.get("hint_tier", 0) + 1
        session["hint_tier"] = turn["tier"]
        session["support_events"].append({
            "id": str(uuid4()), "turn_id": turn["id"], "reason": reply.support_reason,
            "origin": "requested" if requested else "adaptive",
            "counted_for_autonomy": True, "delivered_at": turn["created_at"],
        })
    else:
        session["hint_tier"] = 0
    session["turns"].append(turn)
    session["current_objective"] = reply.objective
    if reply.kind == "ready":
        session["done"] = True


class AdaptiveSessions:
    def __init__(self, db, tutor, before_ai_call=None):
        self.db, self.tutor = db, tutor
        self.before_ai_call = before_ai_call or (lambda owner_id: None)

    def start(self, assignment, owner_id):
        # Duplicate starts may compute two plans, but only one session is ever committed.
        self.before_ai_call(owner_id)
        try:
            plan = self.tutor.plan(assignment)
        except TutorError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        session = {
            "id": str(uuid4()), "assignment_id": assignment["id"], "assignment": assignment,
            "tutor_mode": "openai", "model": self.tutor.model,
            "assessment_model": self.tutor.assessment_model,
            "policy_version": POLICY_VERSION, "scoring_version": SCORING_VERSION,
            "plan": plan.model_dump(), "steps": [], "step": 0, "hint_tier": 0,
            "done": False, "submitted": False, "essay": "", "turns": [],
            "support_events": [], "assessment": None, "pending_action": None,
            "version": 0, "requests": {}, "created_at": timestamp(), "updated_at": timestamp(),
        }
        if assignment.get("active_item_id"):
            session["opening_item_id"] = assignment["active_item_id"]
        response_turn(plan.opening, session)
        with self.db.connect(write=True) as conn:
            existing = next((s for s in self.db.all(conn, "sessions", owner_id=owner_id)
                             if s["assignment_id"] == assignment["id"] and
                             (s.get("assignment") or {}).get("active_item_id") == assignment.get("active_item_id")), None)
            if existing:
                return existing
            self.db.put(conn, "sessions", session["id"], session, owner_id=owner_id)
        return session

    def prepare_item(self, session_id, owner_id):
        """Refresh an unanswered item session created with another question's opening."""
        with self.db.connect() as conn:
            session = require_session(self.db, conn, session_id, owner_id)
        item_id = session.get("assignment", {}).get("active_item_id")
        if not item_id or session.get("opening_item_id") == item_id or any(
                turn.get("kind") == "student" for turn in session.get("turns", [])):
            return session
        try:
            plan = self.tutor.plan(session["assignment"])
        except TutorError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        refreshed = copy.deepcopy(session)
        refreshed.update(plan=plan.model_dump(), turns=[], support_events=[], assessment=None,
                         pending_action=None, current_objective=None, done=False, step=0,
                         hint_tier=0, opening_item_id=item_id)
        response_turn(plan.opening, refreshed)
        with self.db.connect(write=True) as conn:
            current = require_session(self.db, conn, session_id, owner_id)
            if current.get("version") != session.get("version") or any(
                    turn.get("kind") == "student" for turn in current.get("turns", [])):
                return current
            refreshed["version"] += 1
            refreshed["updated_at"] = timestamp()
            self.db.put(conn, "sessions", session_id, refreshed, owner_id=owner_id)
        return refreshed

    def mutate(self, session_id, body, action, owner_id):
        fingerprint = hashlib.sha256(json.dumps({"action": action, **body.model_dump()}, sort_keys=True).encode()).hexdigest()
        token = str(uuid4())
        with self.db.connect(write=True) as conn:
            session = require_session(self.db, conn, session_id, owner_id)
            previous = session["requests"].get(body.client_message_id)
            if previous:
                if previous != fingerprint:
                    raise HTTPException(409, "Mã yêu cầu đã được dùng cho nội dung khác")
                return session
            if session["version"] != body.expected_version:
                raise HTTPException(409, "Phiên đã thay đổi. Hãy tải lại để tiếp tục.")
            pending = session.get("pending_action")
            if action == "cancel":
                if not pending:
                    raise HTTPException(409, "Không có yêu cầu chưa hoàn tất để hủy.")
                session["pending_action"] = None  # Invalidates any in-flight lease token.
            else:
                if pending:
                    if (pending["client_message_id"] != body.client_message_id
                            or pending["fingerprint"] != fingerprint):
                        raise HTTPException(409, "Còn một yêu cầu chưa hoàn tất. Hãy thử lại hoặc hủy yêu cầu đó.")
                    if pending["status"] == "processing" and pending["lease_until"] > time.time():
                        raise HTTPException(409, "AI đang xử lý yêu cầu này. Hãy chờ phản hồi.")
                if session["submitted"] or (session["done"] and action not in ("submit", "continue")):
                    raise HTTPException(409, "Phiên đã kết thúc đối thoại")
                answers = [t for t in session["turns"] if t["kind"] == "student" and t.get("purpose") == "answer"]
                if action == "submit" and not session["done"]:
                    raise HTTPException(409, "Hãy kết thúc đối thoại trước khi tổng hợp bài làm.")
                if action == "finish" and not answers:
                    raise HTTPException(409, "Hãy trả lời ít nhất một câu hỏi trước khi kết thúc.")
                if action == "continue" and not session["done"]:
                    raise HTTPException(409, "Phiên đang ở phần đối thoại.")
                if action in ("finish", "continue"):
                    session["done"] = action == "finish"
                elif action in ("message", "hint", "submit"):
                    if action == "message" and len(answers) >= 40:
                        raise HTTPException(409, "Phiên đã có 40 câu trả lời. Hãy kết thúc đối thoại và tổng hợp bài làm.")
                    session["pending_action"] = {
                        "client_message_id": body.client_message_id, "fingerprint": fingerprint,
                        "action": action, "text": getattr(body, "text", getattr(body, "essay", "")),
                        "status": "processing", "lease_until": time.time() + LEASE_SECONDS, "token": token,
                    }
                    self.db.put(conn, "sessions", session_id, session, owner_id=owner_id)
                else:
                    raise HTTPException(400, "Thao tác không hợp lệ")
            if action in ("finish", "continue", "cancel"):
                return self._commit(conn, session, body.client_message_id, fingerprint, owner_id)

        # Input is durable in pending_action before contacting the provider.
        working = copy.deepcopy(session)
        try:
            self.before_ai_call(owner_id)
            if action == "submit":
                draft = self.tutor.assess(working, body.essay)
                report = build_report(draft, working, body.essay, working["assessment_model"])
                working.update(essay=body.essay, submitted=True, submitted_at=timestamp(), assessment=report)
            else:
                if action == "message":
                    previous_turn = working["turns"][-1]
                    working["turns"].append({
                        "id": str(uuid4()), "kind": "student", "step": 0, "text": body.text,
                        "purpose": "source" if previous_turn.get("response_kind") == "source_request" else "answer",
                        "level": previous_turn["level"], "hints": working["hint_tier"],
                        "quality": None, "created_at": timestamp(),
                    })
                reply = self.tutor.reply(working, action)
                response_turn(reply, working, requested=action == "hint")
        except Exception as exc:
            with self.db.connect(write=True) as conn:
                current = require_session(self.db, conn, session_id, owner_id)
                if (current.get("pending_action") or {}).get("token") == token:
                    current["pending_action"]["status"] = "failed"
                    self.db.put(conn, "sessions", session_id, current, owner_id=owner_id)
            if isinstance(exc, TutorError):
                raise HTTPException(exc.status, str(exc)) from exc
            if isinstance(exc, HTTPException):
                raise
            if isinstance(exc, ValueError):
                raise HTTPException(502, "Bằng chứng hoặc điểm AI trả về chưa hợp lệ. Bài làm được giữ để thử lại.") from exc
            raise HTTPException(502, "Không hoàn tất được phản hồi AI. Nội dung được giữ để thử lại.") from exc

        with self.db.connect(write=True) as conn:
            current = require_session(self.db, conn, session_id, owner_id)
            if (current.get("pending_action") or {}).get("token") != token or current["version"] != body.expected_version:
                raise HTTPException(409, "Yêu cầu đã được thay thế. Hãy tải lại phiên học.")
            working["pending_action"] = None
            return self._commit(conn, working, body.client_message_id, fingerprint, owner_id)

    def _commit(self, conn, session, key, fingerprint, owner_id):
        session["version"] += 1
        session["updated_at"] = timestamp()
        session["requests"][key] = fingerprint
        self.db.put(conn, "sessions", session["id"], session, owner_id=owner_id)
        return session
