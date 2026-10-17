import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Session as SavedSession } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { SessionWorkspace } from "./SessionWorkspace";
import { SessionConversation } from "./SessionConversation";
import { SessionComposer } from "./SessionComposer";
import { SessionRequestError } from "./SessionRequestState";

const HINT_LABELS = ["Định hướng", "Câu hỏi phụ", "Khung trả lời"];

export function TemplateSessionView({
  session,
  queryKey,
}: {
  session: SavedSession;
  queryKey: string[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const draftKey = `socratic:${user?.id}:draft:${session.id}`;
  const essayKey = `socratic:${user?.id}:essay:${session.id}`;
  const { done, submitted } = session;
  const hintTier = session.hint_tier;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) || "");
  const [essay, setEssay] = useState(() => sessionStorage.getItem(essayKey) || session.essay);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"message" | "hint" | "submit" | null>(null);
  const [error, setError] = useState("");
  const [failedAction, setFailedAction] = useState<"message" | "hint" | "submit">("message");
  const inFlight = useRef(false);
  const pending = useRef<{ type: string; text: string; key: string; session: SavedSession } | null>(
    null,
  );

  const perform = async (type: "message" | "hint" | "submit") => {
    if (inFlight.current) return;
    const text = type === "message" ? draft.trim() : type === "submit" ? essay.trim() : "";
    if (type === "message" && !text) return;
    if (!pending.current || pending.current.type !== type || pending.current.text !== text) {
      pending.current = { type, text, key: crypto.randomUUID(), session };
    }
    const action = pending.current;
    inFlight.current = true;
    setBusy(true);
    setBusyAction(type);
    setError("");
    try {
      const saved =
        type === "message"
          ? await api.message(action.session, text, action.key)
          : type === "hint"
            ? await api.hint(action.session, action.key)
            : await api.submit(action.session, text, action.key);
      client.setQueryData(queryKey, saved);
      client.setQueriesData<SavedSession>({ queryKey: ["session"] }, (current) =>
        current?.id === saved.id ? saved : current,
      );
      pending.current = null;
      if (type === "message") {
        setDraft("");
        sessionStorage.removeItem(draftKey);
      }
      if (type === "submit") {
        sessionStorage.removeItem(essayKey);
        toast.success("Đã lưu bài viết và hoàn thành phiên tự học");
      }
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        pending.current = null;
        try {
          client.setQueryData(queryKey, await api.session(session.id));
        } catch {
          /* Keep the draft available for retry. */
        }
      } else if (error instanceof ApiError && error.status !== 0) pending.current = null;
      const message = error instanceof Error ? error.message : "Không lưu được dữ liệu";
      setError(message);
      setFailedAction(type);
      toast.error(message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setBusyAction(null);
    }
  };
  const askHint = () => {
    void perform("hint");
  };

  return (
    <SessionWorkspace
      session={session}
      activity={busy}
      onSelectItem={(itemId) => {
        if (busy || itemId === session.assignment.active_item_id) return;
        setBusy(true);
        void api.selectSessionItem(session.id, itemId)
          .then(async (selected) => {
            client.setQueryData(["session", selected.id], selected);
            await navigate({ to: "/phien-hoc", search: { session: selected.id } });
          })
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không chuyển được câu hỏi"))
          .finally(() => setBusy(false));
      }}
      composer={
        !submitted ? (
          <SessionComposer
            mode={done ? "essay" : "answer"}
            value={done ? essay : draft}
            onChange={(value) => {
              if (done) {
                setEssay(value);
                sessionStorage.setItem(essayKey, value);
              } else {
                setDraft(value);
                sessionStorage.setItem(draftKey, value);
              }
            }}
            disabled={busy}
            busy={busyAction === (done ? "submit" : "message")}
            sendLabel={done ? "Lưu bài viết & hoàn thành" : "Gửi câu trả lời"}
            onSend={() => void perform(done ? "submit" : "message")}
            {...(!done
              ? {
                  onHint: askHint,
                  hintDisabled: hintTier >= 3,
                  hintBusy: busyAction === "hint",
                  hintDescription:
                    hintTier >= 3
                      ? "Đã dùng hết gợi ý cho câu hỏi này"
                      : `Gợi ý mức ${hintTier + 1} · ${HINT_LABELS[hintTier]}`,
                }
              : {})}
            notice={
              error ? (
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
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {busyAction === "hint"
            ? "Gia sư đang chuẩn bị gợi ý…"
            : busyAction === "submit"
              ? "Đang lưu bài viết…"
              : "Đang lưu câu trả lời…"}
        </p>
      )}
      {done && (
        <section data-session-complete className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">
            {submitted ? "Phiên tự học đã hoàn thành" : "Hoàn thành chuỗi câu hỏi"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {submitted
              ? "Đã lưu bài viết và hoàn thành phiên tự học."
              : "Em đã hoàn thành chuỗi câu hỏi luyện tập. Hãy tổng hợp thành bài viết để lưu lại cách lập luận của mình."}
          </p>
          {submitted && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">Bài viết cuối phiên</summary>
              <p className="mt-3 whitespace-pre-wrap break-words leading-7">{session.essay}</p>
            </details>
          )}
        </section>
      )}
    </SessionWorkspace>
  );
}
