import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, type Session as SavedSession, type Turn } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import {
  Lightbulb,
  Send,
  CheckCircle2,
  CircleDot,
  Circle,
  FileCheck2,
  Sparkles,
} from "lucide-react";
import { BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BLOOM, bloomColor } from "@/lib/data";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { AdaptiveSessionView } from "@/components/AdaptiveSessionView";

export const Route = createFileRoute("/phien-hoc")({
  validateSearch: (search: Record<string, unknown>): { assignment?: string } =>
    typeof search["assignment"] === "string" ? { assignment: search["assignment"] } : {},
  head: () =>
    seo(
      "Phiên học Socratic",
      "Học cùng gia sư AI bằng chuỗi câu hỏi gợi mở theo thang Bloom và gợi ý tăng dần.",
    ),
  component: Session,
});

const HINT_LABELS = ["Định hướng", "Câu hỏi phụ", "Khung trả lời"];

function Session() {
  const { assignment } = Route.useSearch();
  const queryKey = ["session", assignment ?? "latest"];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (assignment) return api.start(assignment);
      const sessions = await api.sessions();
      return sessions.find((s) => !s.submitted) ?? sessions[0] ?? null;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pending_action?.status === "processing" ? 2000 : false,
  });
  if (query.isPending || query.isError)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  if (!query.data)
    return (
      <div className="p-6 lg:p-10 space-y-4">
        <h1 className="text-2xl font-semibold">Bắt đầu phiên tự học đầu tiên</h1>
        <p className="text-muted-foreground">
          Tải lên hoặc nhập đề riêng để học cùng gia sư Socratic.
        </p>
        <Button asChild>
          <Link to="/de-bai">Thêm đề tự học</Link>
        </Button>
      </div>
    );
  return query.data.tutor_mode === "openai" ? (
    <AdaptiveSessionView key={query.data.id} session={query.data} queryKey={queryKey} />
  ) : (
    <SessionView key={query.data.id} session={query.data} queryKey={queryKey} />
  );
}

function SessionView({ session, queryKey }: { session: SavedSession; queryKey: string[] }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const draftKey = `socratic:${user?.id}:draft:${session.id}`;
  const essayKey = `socratic:${user?.id}:essay:${session.id}`;
  const a = session.assignment;
  const { step, done, submitted, turns } = session;
  const hintTier = session.hint_tier;
  const socraticSteps = session.steps;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) || "");
  const [essay, setEssay] = useState(() => sessionStorage.getItem(essayKey) || session.essay);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ type: string; text: string; key: string; session: SavedSession } | null>(
    null,
  );

  const cur = socraticSteps[step]!;
  const answers = turns.filter(
    (t): t is Extract<Turn, { kind: "student" }> => t.kind === "student",
  );
  const last = answers.at(-1);
  const totalHints = turns.filter((t) => t.kind === "hint").length;

  const perform = async (type: "message" | "hint" | "submit") => {
    if (busy) return;
    const text = type === "message" ? draft.trim() : type === "submit" ? essay.trim() : "";
    if (type === "message" && !text) return;
    if (!pending.current || pending.current.type !== type || pending.current.text !== text) {
      pending.current = { type, text, key: crypto.randomUUID(), session };
    }
    const action = pending.current;
    setBusy(true);
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
      toast.error(error instanceof Error ? error.message : "Không lưu được dữ liệu");
    } finally {
      setBusy(false);
    }
  };
  const askHint = () => {
    void perform("hint");
  };
  const submit = () => {
    void perform("message");
  };

  return (
    <div className="grid lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_300px] min-h-screen">
      {/* Left: task + Bloom ladder */}
      <aside className="border-r bg-card p-5 space-y-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div>
          <p className="text-xs font-medium text-secondary uppercase tracking-wider">Đề bài</p>
          <h1 className="font-semibold mt-1 leading-snug">{a.title}</h1>
          <p className="text-sm text-foreground/80 mt-2">{a.prompt}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-3">
            Lộ trình câu hỏi theo Bloom
          </p>
          <ol className="space-y-2.5">
            {socraticSteps.map((s, i) => {
              const b = BLOOM[s.level - 1]!;
              const st = i < step || (done && i === step) ? "done" : i === step ? "now" : "next";
              return (
                <li key={i} className="flex gap-3 text-sm">
                  {st === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-secondary mt-0.5" />
                  ) : st === "now" ? (
                    <CircleDot className="h-4 w-4 text-primary mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/50 mt-0.5" />
                  )}
                  <div className={st === "next" ? "text-muted-foreground" : ""}>
                    <p className="font-medium">
                      Bậc {b.level} · {b.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{b.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>

      {/* Center: dialogue */}
      <section className="flex flex-col min-w-0">
        <div className="border-b bg-card px-6 py-3.5 flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Đối thoại Socratic</p>
          <span className="text-xs text-muted-foreground">
            Chế độ kịch bản · Chưa kết nối mô hình AI
          </span>
        </div>
        <div className="flex-1 px-6 lg:px-10 py-8 space-y-6 max-w-3xl w-full mx-auto">
          {turns.map((t, i) => {
            if (t.kind === "tutor")
              return (
                <div key={i} className="border-l-2 border-primary pl-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-primary">Câu hỏi gợi mở</span>
                    <BloomBadge level={t.level} />
                  </div>
                  <p className="text-[17px] leading-relaxed">{t.text}</p>
                </div>
              );
            if (t.kind === "hint")
              return (
                <div key={i} className="ml-5 rounded-md bg-warning-soft px-4 py-3 text-sm">
                  <p className="text-xs font-semibold text-warning mb-1 flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Gợi ý mức {t.tier}/3 · {HINT_LABELS[t.tier - 1]}
                  </p>
                  {t.text}
                </div>
              );
            return (
              <div key={i} className="ml-5 rounded-md border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Câu trả lời của em
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{t.text}</p>
                <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Mục tiêu lượt học: <BloomBadge level={t.level} /> · {t.hints} gợi ý
                </div>
                <p className="text-xs mt-2 text-secondary">
                  Đã lưu câu trả lời vào phiên tự học của bạn.
                </p>
              </div>
            );
          })}
          {done && (
            <div className="rounded-lg border border-secondary/40 bg-secondary-soft p-5">
              <p className="font-semibold text-secondary">Hoàn thành chuỗi câu hỏi</p>
              <p className="text-sm mt-1">
                Em đã hoàn thành chuỗi câu hỏi luyện tập. Hãy tổng hợp thành bài viết để lưu lại
                cách lập luận của mình.
              </p>
              {!submitted ? (
                <>
                  <Textarea
                    className="mt-4 bg-card min-h-40 font-serif text-[15px]"
                    placeholder="Viết bài làm của em…"
                    value={essay}
                    onChange={(e) => {
                      setEssay(e.target.value);
                      sessionStorage.setItem(essayKey, e.target.value);
                    }}
                  />
                  <Button
                    className="mt-3"
                    disabled={busy || essay.trim().length < 20}
                    onClick={() => {
                      void perform("submit");
                    }}
                  >
                    <FileCheck2 />
                    {busy ? "Đang lưu…" : "Lưu bài viết & hoàn thành"}
                  </Button>
                </>
              ) : (
                <p className="mt-3 text-sm">
                  Đã lưu bài viết và hoàn thành phiên tự học.{" "}
                  <Link to="/tien-trinh" className="text-primary font-medium">
                    Xem lại bài viết & tiến trình →
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
        {!done && (
          <div className="sticky bottom-0 border-t bg-card px-6 lg:px-10 py-4">
            <div className="max-w-3xl mx-auto">
              <Textarea
                disabled={busy}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  sessionStorage.setItem(draftKey, e.target.value);
                }}
                placeholder="Viết suy nghĩ của em… (Ctrl + Enter để gửi)"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                }}
                className="min-h-24 resize-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={askHint}
                  disabled={busy || hintTier >= 3}
                >
                  <Lightbulb />
                  {hintTier >= 3
                    ? "Đã dùng hết gợi ý"
                    : `Gợi ý mức ${hintTier + 1} · ${HINT_LABELS[hintTier]}`}
                </Button>
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 w-6 rounded-full",
                        i < hintTier ? "bg-warning" : "bg-muted",
                      )}
                    />
                  ))}
                </div>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={submit}
                  disabled={busy || !draft.trim()}
                >
                  <Send />
                  {busy ? "Đang lưu…" : "Gửi câu trả lời"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Right: thinking analytics */}
      <aside className="hidden xl:block border-l bg-card p-5 space-y-6 sticky top-0 h-screen overflow-y-auto">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-3">
            Các bậc câu hỏi đã luyện tập
          </p>
          <div className="flex items-end gap-1.5 h-28">
            {BLOOM.map((b) => {
              const reached = answers.some((x) => x.level === b.level);
              return (
                <div key={b.level} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={cn("w-full rounded-sm", reached ? bloomColor(b.level) : "bg-muted")}
                    style={{ height: `${b.level * 15}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{b.level}</span>
                </div>
              );
            })}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Bậc câu hỏi</dt>
            <dd className="text-xl font-semibold">{last?.level ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Mục tiêu</dt>
            <dd className="text-xl font-semibold">{a.target}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Gợi ý đã dùng</dt>
            <dd className="text-xl font-semibold">{totalHints}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Câu đã trả lời</dt>
            <dd className="text-xl font-semibold">{answers.length}</dd>
          </div>
        </dl>
        <div className="rounded-md bg-primary-soft p-4 text-sm">
          <p className="text-xs font-semibold text-primary mb-1">Vì sao gia sư hỏi câu này?</p>
          <p className="text-foreground/80 leading-relaxed">
            Câu hỏi hiện tại ở bậc <b>{BLOOM[cur.level - 1]!.name}</b>: yêu cầu em{" "}
            {BLOOM[cur.level - 1]!.desc.toLowerCase()}. Gợi ý được mở dần từ định hướng chung đến
            khung trả lời, để em luôn là người tự rút ra kết luận.
          </p>
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          <p className="font-semibold text-foreground mb-1">Nguyên tắc gợi ý thích ứng</p>
          Bản demo chuyển câu hỏi sau mỗi câu trả lời và lưu số gợi ý. Việc hoàn thành câu hỏi không
          đồng nghĩa đã đạt năng lực Bloom tương ứng. Bạn có thể xem lại câu trả lời và bài viết để
          tự đối chiếu cách lập luận.
        </div>
      </aside>
    </div>
  );
}
