import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Send, Sparkles, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type Session } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { BloomBadge } from "@/components/AppShell";
import { AssessmentReport } from "@/components/AssessmentReport";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Action = "message" | "hint" | "submit" | "finish" | "continue" | "cancel";
const strategies: Record<string, string> = {
  clarification: "Làm rõ",
  assumptions: "Xem xét giả định",
  evidence: "Lý do và bằng chứng",
  perspectives: "Góc nhìn khác",
  consequences: "Hệ quả",
  question: "Xem xét câu hỏi",
};

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
  const request = useRef<{ action: Action; text: string; key: string; session: Session } | null>(
    null,
  );
  const answers = session.turns.filter((t) => t.kind === "student" && t.purpose !== "source");
  const hints = session.support_events?.filter((event) => event.counted_for_autonomy).length ?? 0;
  const blocked = busy || Boolean(pending);

  const saveSession = (saved: Session) => {
    client.setQueryData(queryKey, saved);
    client.setQueriesData<Session>({ queryKey: ["session"] }, (current) =>
      current?.id === saved.id ? saved : current,
    );
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "session" });
  };

  const perform = async (action: Action, retry = false) => {
    if (busy) return;
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
    setBusy(true);
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
      toast.error(error instanceof Error ? error.message : "Chưa hoàn tất được yêu cầu");
      try {
        saveSession(await api.session(session.id));
      } catch {
        /* Draft and request key survive a network interruption. */
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] min-h-screen">
      <aside className="border-b lg:border-r bg-card p-5 space-y-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto min-w-0">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
            {session.plan?.task_type === "reading" ? "Đọc hiểu" : "Nghị luận xã hội"}
            {session.assignment.grade ? ` · Lớp ${session.assignment.grade}` : ""}
          </p>
          <h1 className="font-semibold mt-2 break-words">{session.assignment.title}</h1>
          <p className="text-sm mt-3 whitespace-pre-wrap break-words text-foreground/80">
            {session.assignment.prompt}
          </p>
          {session.assignment.source_text && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-primary">Ngữ liệu của đề</summary>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {session.assignment.source_text}
              </p>
            </details>
          )}
        </div>
        <div>
          <h2 className="text-sm font-semibold">Những điều cùng khám phá</h2>
          <ul className="mt-3 space-y-3 list-disc pl-4 text-sm text-muted-foreground">
            {session.plan?.objectives.map((objective, i) => (
              <li key={i}>{objective}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-2">
          <p>
            <b>{answers.length}</b> câu trả lời · <b>{hints}</b> lượt hỗ trợ
          </p>
          <p>
            Hệ số tự lực hiện tại:{" "}
            <b>
              {Math.max(0.3, 1 - hints * 0.1).toLocaleString("vi-VN", { minimumFractionDigits: 1 })}
            </b>
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Chỉ gợi ý hoặc dẫn dắt phụ mới tính hỗ trợ. Câu hỏi Socratic thông thường không làm giảm
            hệ số tự lực. Điểm Bloom được đánh giá cuối phiên.
          </p>
        </div>
      </aside>
      <section className="min-w-0">
        <div className="border-b bg-card px-5 py-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Đối thoại Socratic</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {session.submitted ? "Đã hoàn thành" : "Câu hỏi thích ứng"}
          </span>
        </div>
        <div className="max-w-3xl mx-auto p-5 sm:p-8 space-y-6">
          {!session.done && (
            <p className="rounded-lg bg-primary-soft p-4 text-sm">
              <span className="block text-xs font-semibold text-primary mb-1">
                Đang cùng suy nghĩ
              </span>
              {session.current_objective}
            </p>
          )}
          {session.turns.map((turn, i) =>
            turn.kind === "student" ? (
              <article key={turn.id ?? i} className="rounded-lg border bg-card p-4 ml-3 sm:ml-8">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  {turn.purpose === "source" ? "Ngữ liệu em bổ sung" : "Câu trả lời của em"}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {turn.text}
                </p>
              </article>
            ) : (
              <article
                key={turn.id ?? i}
                className={
                  turn.kind === "hint"
                    ? "rounded-lg bg-warning-soft p-4"
                    : "border-l-2 border-primary pl-4"
                }
              >
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                  <span className="font-semibold text-primary">
                    {turn.kind === "hint"
                      ? "Hỗ trợ bổ sung · tính 1 lượt"
                      : turn.response_kind === "source_request"
                        ? "Bổ sung ngữ liệu · không tính gợi ý"
                        : turn.response_kind === "ready"
                          ? "Tổng hợp suy nghĩ"
                          : (strategies[turn.strategy ?? ""] ?? "Câu hỏi gợi mở")}
                  </span>
                  {turn.kind === "tutor" && turn.response_kind === "question" && (
                    <BloomBadge level={turn.level} />
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>
                {turn.kind === "hint" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {session.support_events?.find((event) => event.turn_id === turn.id)?.reason}
                  </p>
                )}
              </article>
            ),
          )}
          {pending && (
            <div role="status" className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <p className="text-sm font-medium">
                {pending.status === "processing"
                  ? "AI đang xử lý… Yêu cầu đã được lưu."
                  : "Phản hồi chưa hoàn tất. Nội dung của em đã được giữ để thử lại."}
              </p>
              {pending.text && (
                <p className="text-sm whitespace-pre-wrap break-words">{pending.text}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {pending.status === "failed" && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void perform(pending.action, true)}
                  >
                    <RotateCcw />
                    Thử lại
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void perform("cancel")}
                >
                  Hủy yêu cầu chưa hoàn tất
                </Button>
              </div>
            </div>
          )}
          {busy && !pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {request.current?.action === "submit"
                ? "Đang đối chiếu bài làm và tính điểm…"
                : "Đang xử lý…"}
            </p>
          )}
          {!session.done && (
            <div className="space-y-3 border-t pt-5">
              <label className="block text-sm font-medium" htmlFor="adaptive-answer">
                Suy nghĩ của em
              </label>
              <Textarea
                id="adaptive-answer"
                disabled={blocked}
                value={draft}
                maxLength={10000}
                placeholder="Viết suy nghĩ của em… (Ctrl + Enter để gửi)"
                className="min-h-28"
                onChange={(e) => {
                  setDraft(e.target.value);
                  sessionStorage.setItem(draftKey, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim() && !blocked) {
                    e.preventDefault();
                    void perform("message");
                  }
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  onClick={() => void perform("hint")}
                >
                  <Lightbulb />
                  Xin gợi ý
                </Button>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={blocked || !draft.trim()}
                  onClick={() => void perform("message")}
                >
                  <Send />
                  Gửi câu trả lời
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Mỗi gợi ý bổ sung làm N tăng 1; A giảm 0,1 và có sàn 0,3.
              </p>
              {answers.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={blocked}
                  onClick={() => void perform("finish")}
                >
                  Kết thúc đối thoại & tổng hợp <ArrowRight />
                </Button>
              )}
            </div>
          )}
          {session.done && !session.submitted && (
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="font-semibold">Tự tổng hợp bài làm</h2>
              <p className="text-sm text-muted-foreground">
                Viết kết luận, câu trả lời đọc hiểu hoặc bài nghị luận bằng lời của em. Báo cáo sẽ
                đối chiếu cả đối thoại và phần tổng hợp này; thiếu bằng chứng sẽ chưa có điểm tổng.
              </p>
              <label className="block text-sm font-medium" htmlFor="adaptive-essay">
                Bài làm cuối phiên
              </label>
              <Textarea
                id="adaptive-essay"
                disabled={blocked}
                value={essay}
                maxLength={50000}
                placeholder="Viết bài làm của em…"
                className="min-h-44"
                onChange={(e) => {
                  setEssay(e.target.value);
                  sessionStorage.setItem(essayKey, e.target.value);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={blocked || essay.trim().length < 20}
                  onClick={() => void perform("submit")}
                >
                  Hoàn thành & xem báo cáo
                </Button>
                <Button
                  variant="outline"
                  disabled={blocked}
                  onClick={() => void perform("continue")}
                >
                  Tiếp tục đối thoại
                </Button>
              </div>
            </div>
          )}
          {session.assessment && <AssessmentReport report={session.assessment} />}
          {session.submitted && (
            <>
              <details className="rounded-lg border p-4 text-sm">
                <summary className="cursor-pointer font-medium">Bài viết cuối phiên</summary>
                <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">
                  {session.essay}
                </p>
              </details>
              <Link to="/tien-trinh" className="inline-flex text-sm font-medium text-primary">
                Xem lại bài viết & tiến trình →
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
