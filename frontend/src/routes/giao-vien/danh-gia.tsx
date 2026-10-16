import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, type Session } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/giao-vien/danh-gia")({
  validateSearch: (search: Record<string, unknown>): { student?: string } =>
    typeof search["student"] === "string" ? { student: search["student"] } : {},
  head: () => seo("Đánh giá bài làm", "Giáo viên xem phiên học Socratic và chấm bài theo rubric."),
  component: Page,
});

function Page() {
  const { student } = Route.useSearch();
  const query = useQuery({ queryKey: ["teacher-sessions"], queryFn: api.sessions });
  const [selected, setSelected] = useState("");
  if (!query.data)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const sessions = query.data.filter((s) => !student || s.student_id === student);
  const active =
    sessions.find((s) => s.id === selected) ??
    sessions.find((s) => s.submitted && !s.review) ??
    sessions[0];
  if (!active)
    return (
      <>
        <PageHeader
          eyebrow="Giáo viên"
          title="Đánh giá bài làm"
          desc="Chưa có phiên học. Học sinh cần bắt đầu phiên học và nộp bài trước khi chấm."
        />
        <ApiState />
      </>
    );
  return (
    <>
      <div className="px-6 lg:px-10 py-4 border-b bg-card">
        <label className="text-sm font-medium">
          Chọn phiên học
          <select
            className="mt-2 block w-full rounded-md border bg-card p-2 text-sm"
            value={active.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sessions.map((s) => (
              <option value={s.id} key={s.id}>
                {s.student_name} · {s.assignment.title} ·{" "}
                {s.review ? "Đã chấm" : s.submitted ? "Chờ chấm" : "Đang học"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ReviewForm key={`${active.id}:${active.version}`} session={active} />
    </>
  );
}

function ReviewForm({ session }: { session: Session }) {
  const rubric = session.rubric.criteria;
  const [s, setS] = useState(rubric.map((r) => session.review?.scores[r.id] ?? 0));
  const [feedback, setFeedback] = useState(session.review?.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const log = session.turns.filter((t) => t.kind === "student");
  const save = async () => {
    if (busy || !session.submitted || !feedback.trim()) return;
    setBusy(true);
    try {
      await api.review(
        session.id,
        Object.fromEntries(rubric.map((r, i) => [r.id, s[i]!])),
        feedback.trim(),
      );
      await client.invalidateQueries();
      toast.success("Đã lưu kết quả cho học sinh");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được điểm");
    } finally {
      setBusy(false);
    }
  };
  const total = rubric.reduce((sum, r, i) => sum + (s[i]! * r.weight) / 100, 0);
  return (
    <>
      <PageHeader
        eyebrow={`Giáo viên · ${session.student_name} · ${session.class_name}`}
        title={session.assignment.title}
        desc={`${session.submitted_at ? `Nộp lúc ${new Date(session.submitted_at).toLocaleString("vi-VN")}` : "Học sinh chưa nộp bài"} · ${session.turns.filter((t) => t.kind === "hint").length} gợi ý`}
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-secondary" />
            Môi trường demo local
          </span>
        }
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Panel title="Diễn biến phiên học Socratic">
            <ol className="space-y-5">
              {log.map((x, i) => (
                <li key={i} className="grid grid-cols-[24px_1fr] gap-3">
                  <span className="text-xs font-semibold text-muted-foreground pt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{session.steps[x.step]!.q}</p>
                    <p className="text-sm text-foreground/80 mt-1.5 border-l-2 pl-3 whitespace-pre-wrap">
                      {x.text}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Mục tiêu:</span>
                      <BloomBadge level={x.level} />
                      {x.hints} gợi ý
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Bài làm">
            <div className="font-serif text-[15px] leading-relaxed space-y-3 text-foreground/90">
              <p className="whitespace-pre-wrap">{session.essay || "Chưa có bài làm được nộp."}</p>
            </div>
          </Panel>
        </div>
        <Panel
          title="Chấm theo rubric"
          action={
            <span className="text-sm font-semibold text-primary">{total.toFixed(1)} / 10</span>
          }
          className="h-fit xl:sticky xl:top-6"
        >
          <p className="text-xs text-muted-foreground mb-4">
            Rubric phiên bản {session.rubric.version}. Giáo viên chấm dựa trên bài làm và dẫn chứng.
            Chưa có điểm đề xuất từ AI.
          </p>
          <div className="space-y-4">
            {rubric.map((r, i) => (
              <div key={r.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">
                    {r.name} <span className="text-muted-foreground font-normal">{r.weight}%</span>
                  </span>
                  <span>{s[i]}</span>
                </div>
                <input
                  aria-label={`Điểm ${r.name}`}
                  disabled={busy || !session.submitted}
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={s[i]}
                  onChange={(e) => setS(s.map((v, j) => (j === i ? Number(e.target.value) : v)))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
          </div>
          <Textarea
            aria-label="Nhận xét của giáo viên"
            disabled={busy || !session.submitted}
            className="mt-4"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Nhận xét cụ thể về bài làm và hướng cải thiện…"
          />
          <Button
            disabled={busy || !session.submitted || !feedback.trim()}
            className="mt-3 w-full"
            onClick={() => {
              void save();
            }}
          >
            {busy ? "Đang lưu…" : "Gửi kết quả"}
          </Button>
        </Panel>
      </div>
    </>
  );
}
