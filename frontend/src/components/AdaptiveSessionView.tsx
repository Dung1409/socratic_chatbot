import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Session } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { AssessmentReport } from "@/components/AssessmentReport";
import { SessionWorkspace } from "@/components/session/SessionWorkspace";
import { SessionConversation } from "@/components/session/SessionConversation";
import { SessionComposer } from "@/components/session/SessionComposer";
import {
  SessionPendingRequest,
  SessionRequestError,
} from "@/components/session/SessionRequestState";

type Action = "message" | "hint" | "submit" | "finish" | "continue" | "cancel";

export function AdaptiveSessionView({
  session,
  queryKey,
}: {
  session: Session;
  queryKey: string[];
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const draftKey = `socratic:${user?.id}:draft:${session.id}`;
  const essayKey = `socratic:${user?.id}:essay:${session.id}`;
  const pending = session.pending_action;
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem(draftKey) || (pending?.action === "message" ? pending.text : ""),
  );
  const [essay, setEssay] = useState(
    () =>
      sessionStorage.getItem(essayKey) ||
      (pending?.action === "submit" ? pending.text : session.essay),
  );
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [failedAction, setFailedAction] = useState<Action>("message");
  const inFlight = useRef(false);
  const request = useRef<{ action: Action; text: string; key: string; session: Session } | null>(
    null,
  );
  const answers = session.turns.filter((t) => t.kind === "student" && t.purpose !== "source");
  const blocked = busy || Boolean(pending);
  const selectItem = async (itemId: string) => {
    if (blocked || itemId === session.assignment.active_item_id) return;
    setBusy(true);
    try {
      saveSession(await api.selectSessionItem(session.id, itemId));
      toast.success("Đã chuyển sang câu hỏi đã chọn");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không chuyển được câu hỏi");
    } finally {
      setBusy(false);
    }
  };

  const saveSession = (saved: Session) => {
    client.setQueryData(queryKey, saved);
    client.setQueriesData<Session>({ queryKey: ["session"] }, (current) =>
      current?.id === saved.id ? saved : current,
    );
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "session" });
  };

  const perform = async (action: Action, retry = false) => {
    if (inFlight.current) return;
    const text =
      retry && pending
        ? pending.text
        : action === "message"
          ? draft.trim()
          : action === "submit"
            ? essay.trim()
            : "";
    if (retry && pending)
      request.current = { action, text, key: pending.client_message_id, session };
    else if (!request.current || request.current.action !== action || request.current.text !== text)
      request.current = { action, text, key: crypto.randomUUID(), session };
    const operation = request.current;
    inFlight.current = true;
    setBusy(true);
    setBusyAction(action);
    setError("");
    try {
      const saved =
        action === "message"
          ? await api.message(operation.session, text, operation.key)
          : action === "hint"
            ? await api.hint(operation.session, operation.key)
            : action === "submit"
              ? await api.submit(operation.session, text, operation.key)
              : await api.action(operation.session, action, operation.key);
      saveSession(saved);
      request.current = null;
      if (action === "message") {
        setDraft("");
        sessionStorage.removeItem(draftKey);
      }
      if (action === "submit") {
        sessionStorage.removeItem(essayKey);
        toast.success("Đã lưu bài làm và báo cáo cuối phiên");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) request.current = null;
      const message = error instanceof Error ? error.message : "Chưa hoàn tất được yêu cầu";
      setError(message);
      setFailedAction(action);
      toast.error(message);
      try {
        saveSession(await api.session(session.id));
      } catch {
        /* Draft and request key survive a network interruption. */
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      setBusyAction(null);
    }
  };

  return (
    <SessionWorkspace
      session={session}
      activity={busy}
      onSelectItem={(itemId) => void selectItem(itemId)}
      composer={
        !session.submitted ? (
          <SessionComposer
            mode={session.done ? "essay" : "answer"}
            value={session.done ? essay : draft}
            onChange={(value) => {
              if (session.done) {
                setEssay(value);
                sessionStorage.setItem(essayKey, value);
              } else {
                setDraft(value);
                sessionStorage.setItem(draftKey, value);
              }
            }}
            disabled={blocked}
            busy={busyAction === (session.done ? "submit" : "message")}
            sendLabel={session.done ? "Hoàn thành & xem báo cáo" : "Gửi câu trả lời"}
            onSend={() => void perform(session.done ? "submit" : "message")}
            {...(!session.done
              ? {
                  onHint: () => void perform("hint"),
                  hintBusy: busyAction === "hint",
                  ...(answers.length > 0 ? { onFinish: () => void perform("finish") } : {}),
                }
              : { onContinue: () => void perform("continue") })}
            notice={
              error && !pending ? (
                <SessionRequestError
                  message={error}
                  disabled={busy}
                  onRetry={() => void perform(failedAction)}
                />
              ) : undefined
            }
          />
        ) : undefined
      }
    >
      <SessionConversation session={session} />
      {pending && (
        <SessionPendingRequest
          pending={pending}
          busy={busy}
          onRetry={() => void perform(pending.action, true)}
          onCancel={() => void perform("cancel")}
        />
      )}
      {busy && !pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {busyAction === "submit"
            ? "Đang đối chiếu bài làm và tính điểm…"
            : busyAction === "hint"
              ? "Gia sư đang chuẩn bị gợi ý…"
              : "Gia sư đang xử lý…"}
        </p>
      )}
      {session.done && !session.submitted && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Tự tổng hợp bài làm</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Viết kết luận, câu trả lời đọc hiểu hoặc bài nghị luận bằng lời của em. Báo cáo sẽ đối
            chiếu cả đối thoại và phần tổng hợp này; thiếu bằng chứng sẽ chưa có điểm tổng.
          </p>
        </section>
      )}
      {session.assessment && <AssessmentReport report={session.assessment} />}
      {session.submitted && (
        <details data-session-complete className="rounded-xl border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Bài viết cuối phiên</summary>
          <p className="mt-3 whitespace-pre-wrap break-words leading-7">{session.essay}</p>
        </details>
      )}
    </SessionWorkspace>
  );
}
