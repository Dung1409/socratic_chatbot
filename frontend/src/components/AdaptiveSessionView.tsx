import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError, type HintDifficulty, type Session } from "@/lib/api";
import { useSessionDraft } from "@/hooks/use-session-draft";
import { SessionWorkspace } from "@/components/session/SessionWorkspace";
import { SessionConversation } from "@/components/session/SessionConversation";
import { SessionComposer } from "@/components/session/SessionComposer";
import { HintCheckIn } from "@/components/session/HintCheckIn";
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
  const client = useQueryClient();
  const navigate = useNavigate();
  const pending = session.pending_action;
  const draftState = useSessionDraft(session);
  const { draft, essay, setDraft, setEssay } = draftState;
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [failedAction, setFailedAction] = useState<Action>("message");
  const [resultNotice, setResultNotice] = useState<{ nextItemId: string | null } | null>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [switchingQuestion, setSwitchingQuestion] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<{
    action: Action;
    text: string;
    key: string;
    session: Session;
    difficulty?: HintDifficulty | undefined;
  } | null>(null);
  const answers = session.turns.filter(
    (t) => t.kind === "student" && (!t.purpose || t.purpose === "answer"),
  );
  const blocked = busy || Boolean(pending) || !draftState.ready || draftState.hasConflict;
  const selectItem = async (itemId: string) => {
    if (blocked || itemId === session.assignment.active_item_id) return;
    setBusy(true);
    try {
      if (!(await draftState.save())) return;
      const selected = await api.selectSessionItem(session.id, itemId);
      client.setQueryData(["session", selected.id], selected);
      await navigate({ to: "/phien-hoc", search: { session: selected.id } });
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

  const perform = async (action: Action, retry = false, difficulty?: HintDifficulty) => {
    if (inFlight.current) return;
    const selectedDifficulty = retry
      ? (pending?.difficulty ?? request.current?.difficulty)
      : difficulty;
    const text =
      retry && pending
        ? pending.text
        : action === "message"
          ? draft.trim()
          : action === "submit"
            ? essay.trim()
            : "";
    if (retry && pending)
      request.current = {
        action,
        text,
        key: pending.client_message_id,
        session,
        difficulty: pending.difficulty ?? undefined,
      };
    else if (
      !request.current ||
      request.current.action !== action ||
      request.current.text !== text ||
      request.current.difficulty !== selectedDifficulty
    )
      request.current = {
        action,
        text,
        key: crypto.randomUUID(),
        session,
        difficulty: selectedDifficulty,
      };
    const operation = request.current;
    inFlight.current = true;
    setBusy(true);
    setBusyAction(action);
    setError("");
    try {
      if (!pending && !(await draftState.save())) return;
      const saved =
        action === "message"
          ? await api.message(operation.session, text, operation.key)
          : action === "hint"
            ? await api.hint(operation.session, operation.key, operation.difficulty)
            : action === "submit"
              ? await api.submit(operation.session, text, operation.key)
              : await api.action(operation.session, action, operation.key);
      draftState.committed(saved, action);
      saveSession(saved);
      request.current = null;
      if (action === "submit") {
        const items = session.assignment.items ?? [];
        const activeItemId = session.assignment.active_item_id;
        let completedIds = new Set<string>(activeItemId ? [activeItemId] : []);
        try {
          const savedSessions = await api.sessions();
          completedIds = new Set(
            savedSessions
              .filter((entry) => entry.assignment_id === session.assignment_id && entry.submitted)
              .map((entry) => entry.assignment.active_item_id)
              .filter((itemId): itemId is string => Boolean(itemId)),
          );
          if (activeItemId) completedIds.add(activeItemId);
        } catch {
          // The report is already saved; still let the learner view it if listing sessions fails.
        }

        const currentIndex = items.findIndex((item) => item.id === activeItemId);
        const allCompleted = items.length > 0 && items.every((item) => completedIds.has(item.id));
        const nextItemId = allCompleted
          ? null
          : currentIndex >= 0 && currentIndex < items.length - 1
            ? items[currentIndex + 1]?.id ?? null
            : items.find((item) => !completedIds.has(item.id))?.id ?? null;
        setResultNotice({ nextItemId });
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

  const goToNextQuestion = async () => {
    if (!resultNotice?.nextItemId || switchingQuestion) return;
    setSwitchingQuestion(true);
    try {
      const nextSession = await api.selectSessionItem(session.id, resultNotice.nextItemId);
      client.setQueryData(["session", nextSession.id], nextSession);
      setResultNotice(null);
      await navigate({ to: "/phien-hoc", search: { session: nextSession.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không chuyển được câu hỏi");
    } finally {
      setSwitchingQuestion(false);
    }
  };

  return (
    <>
      <SessionWorkspace
        session={session}
        activity={blocked}
        navigationBusy={busy && busyAction === null}
        assessmentOpen={assessmentOpen}
        onAssessmentOpenChange={setAssessmentOpen}
        onSaveDraft={busy || pending ? async () => true : draftState.save}
        onSelectItem={(itemId) => void selectItem(itemId)}
        composer={
          !session.submitted ? (
            <SessionComposer
              mode={session.done ? "essay" : "answer"}
              value={session.done ? essay : draft}
              onChange={(value) => {
                if (session.done) {
                  setEssay(value);
                } else {
                  setDraft(value);
                }
              }}
              disabled={blocked}
              busy={busyAction === (session.done ? "submit" : "message")}
              sendLabel={session.done ? "Hoàn thành & xem báo cáo" : "Gửi câu trả lời"}
              onSend={() => void perform(session.done ? "submit" : "message")}
              {...(!session.done
                ? {
                    ...(!session.support_state?.needs_check_in
                      ? { onHint: () => void perform("hint") }
                      : {}),
                    hintBusy: busyAction === "hint",
                    ...(answers.length > 0 ? { onFinish: () => void perform("finish") } : {}),
                  }
                : { onContinue: () => void perform("continue") })}
              notice={
                <>
                  {!session.done && session.support_state?.needs_check_in && (
                    <HintCheckIn
                      question={session.support_state.question_text}
                      disabled={blocked}
                      onSelect={(difficulty) => void perform("hint", false, difficulty)}
                    />
                  )}
                  {error && !pending ? (
                    <SessionRequestError
                      message={error}
                      disabled={busy}
                      onRetry={() => void perform(failedAction, true)}
                    />
                  ) : undefined}
                </>
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
                ? "Trợ lý đang chuẩn bị gợi ý…"
                : "Trợ lý đang xử lý…"}
          </p>
        )}
        {session.done && !session.submitted && (
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Tự tổng hợp câu trả lời</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Trình bày câu trả lời cuối cùng bằng lời của em; nêu kết quả và những căn cứ hoặc bước
              lập luận chính phù hợp với đề. Báo cáo sẽ đối chiếu phần này với cuộc trao đổi; nếu
              chưa đủ bằng chứng, hệ thống chưa thể đưa ra điểm tổng.
            </p>
          </section>
        )}
        {session.submitted && (
          <details className="rounded-xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Câu trả lời cuối phiên</summary>
            <p className="mt-3 whitespace-pre-wrap break-words leading-7">{session.essay}</p>
          </details>
        )}
      </SessionWorkspace>
      <Dialog
        open={Boolean(resultNotice) && !assessmentOpen}
        onOpenChange={(open) => !open && setResultNotice(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đã có kết quả cho câu này</DialogTitle>
            <DialogDescription>
              Phiếu kết quả của câu vừa hoàn thành đã sẵn sàng. Em có thể xem phiếu trước hoặc
              chuyển sang câu tiếp theo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setAssessmentOpen(true)}>
              Xem kết quả câu này
            </Button>
            {resultNotice?.nextItemId ? (
              <Button onClick={() => void goToNextQuestion()} disabled={switchingQuestion}>
                {switchingQuestion ? "Đang chuyển…" : "Câu tiếp theo"}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void navigate({
                    to: "/",
                    search: { lesson: session.assignment_id, view: "results" },
                  })
                }
              >
                Xem tất cả kết quả
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
