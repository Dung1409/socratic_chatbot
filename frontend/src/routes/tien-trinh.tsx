import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { PageHeader, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";
import { AssessmentReport } from "@/components/AssessmentReport";

export const Route = createFileRoute("/tien-trinh")({
  head: () =>
    seo("Tiến trình tự học", "Xem lại phiên học, câu trả lời và bài viết Ngữ văn của bạn."),
  component: Page,
});

function Page() {
  const query = useQuery({ queryKey: ["progress"], queryFn: api.progress });
  if (!query.data)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const { sessions, assignments, bloom_profile: bloomProfile } = query.data;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const totalItems = assignments.reduce((total, assignment) => total + assignment.items.length, 0);
  const completed = assignments.reduce((total, assignment) => total + assignment.items.filter((item) => {
    const session = item.session_id ? sessionById.get(item.session_id) : null;
    return session?.submitted && session.assessment?.status === "complete";
  }).length, 0);
  return (
    <>
      <PageHeader
        eyebrow="Nhật ký học tập"
        title="Tiến trình tự học"
        desc={`${assignments.length} đề/tài liệu · ${completed}/${totalItems} mục có kết quả. Xem lại từng câu và cách lập luận của bạn.`}
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-2">
        <Panel title="Số câu đã luyện tập theo bậc Bloom">
          <div className="h-72">
            <ResponsiveContainer>
              <RadarChart data={bloomProfile}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <PolarRadiusAxis
                  domain={[0, Math.max(1, ...bloomProfile.map((point) => point.value))]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  isAnimationActive={false}
                  dataKey="value"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.15}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            Biểu đồ đếm câu trả lời theo bậc câu hỏi, không phải điểm năng lực. Điểm đánh giá và
            bằng chứng được trình bày riêng trong báo cáo mỗi phiên bên dưới.
          </p>
        </Panel>
        <Panel title="Tự đối chiếu sau mỗi phiên">
          <ul className="space-y-3 text-sm text-foreground/80 list-disc pl-5">
            <li>Mình đã xác định rõ yêu cầu và luận điểm chính chưa?</li>
            <li>Dẫn chứng có trong ngữ liệu và hỗ trợ được luận điểm không?</li>
            <li>Mình đã giải thích mối liên hệ giữa dẫn chứng và nhận định chưa?</li>
            <li>Có góc nhìn khác hoặc phản biện nào cần xem xét thêm?</li>
          </ul>
        </Panel>
        <div className="xl:col-span-2 space-y-4">
          <h2 className="font-semibold">Kết quả theo đề và câu hỏi</h2>
          {assignments.length === 0 ? (
            <Panel title="Chưa có đề hoặc tài liệu">
              <p className="text-sm text-muted-foreground mb-4">
                Thêm đề hoặc tài liệu để bắt đầu và theo dõi kết quả từng câu.
              </p>
              <Button asChild>
                <Link to="/de-bai">Thêm đề tự học</Link>
              </Button>
            </Panel>
          ) : (
            assignments.map((assignment) => {
              const available = assignment.items.filter((item) => {
                const session = item.session_id ? sessionById.get(item.session_id) : null;
                return session?.submitted && session.assessment?.status === "complete";
              }).length;
              return (
              <Panel
                key={assignment.id}
                title={assignment.title}
                action={
                  <span className="text-xs text-muted-foreground">
                    {available}/{assignment.items.length} mục có kết quả
                  </span>
                }
              >
                <ol className="space-y-3" aria-label={`Các mục của ${assignment.title}`}>
                  {assignment.items.map((item) => {
                    const session = item.session_id ? sessionById.get(item.session_id) : null;
                    const assessment = session?.submitted ? session.assessment : null;
                    return (
                      <li key={item.id} className="rounded-lg border bg-background p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">{item.source_only ? "Tài liệu không có câu hỏi" : `Câu ${item.order}`}</p>
                            <h3 className="mt-1 font-semibold">{item.source_only ? "Kết quả tài liệu đầu vào" : item.label}</h3>
                            {!item.source_only && item.prompt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.prompt}</p>}
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${assessment?.status === "complete" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                            {assessment?.status === "complete" ? `${assessment.score}/100` : "Chưa có kết quả"}
                          </span>
                        </div>
                        {session && !session.submitted && <p className="mt-2 text-xs text-muted-foreground">Đang học · Chưa nộp bài tổng hợp</p>}
                        {assessment?.status === "insufficient_evidence" && <p className="mt-2 text-xs text-muted-foreground">Đã nộp, nhưng chưa đủ bằng chứng để tính điểm.</p>}
                        {assessment && (
                          <details className="mt-3 rounded-md border p-3">
                            <summary className="cursor-pointer text-sm font-medium text-primary">Xem báo cáo của {item.source_only ? "tài liệu" : "câu này"}</summary>
                            <div className="mt-3"><AssessmentReport report={assessment} /></div>
                          </details>
                        )}
                        {session?.submitted && session.essay && (
                          <details className="mt-3 rounded-md border p-3 text-sm">
                            <summary className="cursor-pointer font-medium">Xem bài tổng hợp</summary>
                            <p className="mt-3 whitespace-pre-wrap leading-relaxed">{session.essay}</p>
                          </details>
                        )}
                        <Button asChild variant="outline" size="sm" className="mt-3">
                          {session ? (
                            <Link to="/phien-hoc" search={{ session: session.id }}>{session.submitted ? "Xem lại phiên học" : "Tiếp tục học"}</Link>
                          ) : (
                            <Link to="/phien-hoc" search={{ assignment: assignment.id, item: item.id }}>Bắt đầu học</Link>
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              </Panel>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
