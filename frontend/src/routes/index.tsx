import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Lightbulb, Target, TrendingUp } from "lucide-react";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { BLOOM, bloomColor } from "@/lib/data";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () =>
    seo(
      "Tổng quan học tập",
      "Bảng tổng quan học sinh: đề bài, phiên học Socratic và mức tư duy Bloom.",
    ),
  component: Index,
});

function Index() {
  const tasks = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  if (!tasks.data || !summary.data)
    return (
      <ApiState
        loading={tasks.isPending || summary.isPending}
        error={tasks.error || summary.error}
        retry={() => {
          void tasks.refetch();
          void summary.refetch();
        }}
      />
    );
  const assignments = tasks.data;
  const stats = summary.data;
  const current = stats.latest_session?.assignment ?? assignments[0];
  if (!current) return <ApiState />;
  const practiced = (level: number) =>
    stats.latest_session?.turns.some((t) => t.kind === "student" && t.level === level);
  return (
    <>
      <PageHeader
        eyebrow="Chào buổi tối, Minh Anh"
        title="Hôm nay em sẽ suy nghĩ sâu hơn một bậc."
        desc="Gia sư không đưa đáp án. Gia sư đặt câu hỏi để em tự đi từ “Nhớ” đến “Sáng tạo”."
        action={
          <Button asChild>
            <Link to="/phien-hoc" search={{ assignment: current.id }}>
              Tiếp tục phiên học <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <Panel title="Đang học">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  {current.author} · {current.grade} · Hạn {current.due}
                </p>
                <h3 className="text-lg font-semibold mt-1">{current.title}</h3>
                <blockquote className="mt-3 border-l-2 border-secondary pl-4 font-serif italic text-foreground/80 text-[15px] leading-relaxed">
                  {current.excerpt}
                </blockquote>
                <div className="mt-4 flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Mục tiêu:</span>
                  <BloomBadge level={current.target} />
                </div>
              </div>
              <div className="md:w-56 shrink-0">
                <p className="text-xs font-medium text-muted-foreground mb-3">
                  Bậc câu hỏi đã luyện tập
                </p>
                <ol className="space-y-1.5">
                  {[...BLOOM].reverse().map((b) => (
                    <li key={b.level} className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "h-2 w-8 rounded-full",
                          practiced(b.level) ? bloomColor(b.level) : "bg-muted",
                        )}
                      />
                      <span className={practiced(b.level) ? "" : "text-muted-foreground"}>
                        {b.level}. {b.name}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Panel>
          <Panel
            title="Đề bài được giao"
            action={
              <Link to="/de-bai" className="text-xs text-primary font-medium">
                Xem tất cả
              </Link>
            }
          >
            <ul className="divide-y -my-2">
              {assignments.map((a) => (
                <li key={a.id} className="py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.author} · Hạn {a.due}
                    </p>
                  </div>
                  <div className="hidden sm:block w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${a.progress}%` }} />
                  </div>
                  <span className="text-xs w-24 text-right text-muted-foreground">{a.status}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Hoạt động đã lưu">
            <dl className="grid grid-cols-2 gap-4">
              {[
                { icon: Clock, k: "Phiên học", v: stats.sessions },
                { icon: Target, k: "Câu đã trả lời", v: stats.answers },
                { icon: Lightbulb, k: "Gợi ý / câu trả lời", v: stats.hints_per_answer },
                { icon: TrendingUp, k: "Điểm gần nhất", v: stats.latest_review?.total ?? "—" },
              ].map((s) => (
                <div key={s.k}>
                  <s.icon className="h-4 w-4 text-secondary mb-2" />
                  <dt className="text-xs text-muted-foreground">{s.k}</dt>
                  <dd className="text-xl font-semibold">{s.v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Phản hồi gần nhất từ giáo viên">
            <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
              {stats.latest_review?.feedback ??
                "Chưa có đánh giá. Hoàn thành phiên học và nộp bài để giáo viên nhận xét."}
            </p>
            <Link to="/tien-trinh" className="mt-3 inline-flex text-xs text-primary font-medium">
              Xem kết quả đánh giá →
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
