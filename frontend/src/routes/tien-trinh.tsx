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

export const Route = createFileRoute("/tien-trinh")({
  head: () =>
    seo("Tiến trình tự học", "Xem lại phiên học, câu trả lời và bài viết Ngữ văn của bạn."),
  component: Page,
});

function Page() {
  const query = useQuery({ queryKey: ["progress"], queryFn: api.progress });
  if (!query.data)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const { sessions, bloom_profile: bloomProfile } = query.data;
  const completed = sessions.filter((session) => session.submitted).length;
  return (
    <>
      <PageHeader
        eyebrow="Nhật ký học tập"
        title="Tiến trình tự học"
        desc={`${sessions.length} phiên đã lưu · ${completed} phiên hoàn thành. Xem lại bài viết và cách lập luận của bạn.`}
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
            Biểu đồ thể hiện hoạt động luyện tập, chưa phải điểm năng lực hoặc đánh giá tự động.
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
          <h2 className="font-semibold">Các phiên tự học đã lưu</h2>
          {sessions.length === 0 ? (
            <Panel title="Chưa có phiên học">
              <p className="text-sm text-muted-foreground mb-4">
                Thêm đề riêng để bắt đầu và ghi lại tiến trình luyện tập.
              </p>
              <Button asChild>
                <Link to="/de-bai">Thêm đề tự học</Link>
              </Button>
            </Panel>
          ) : (
            sessions.map((session) => (
              <Panel
                key={session.id}
                title={session.assignment.title}
                action={
                  <span className="text-xs text-muted-foreground">
                    {session.submitted ? "Đã hoàn thành" : "Đang học"}
                  </span>
                }
              >
                <p className="text-xs text-muted-foreground mb-3">
                  {new Date(session.updated_at).toLocaleString("vi-VN")} ·{" "}
                  {session.turns.filter((turn) => turn.kind === "student").length} câu trả lời ·{" "}
                  {session.turns.filter((turn) => turn.kind === "hint").length} gợi ý
                </p>
                {session.submitted && (
                  <details className="mb-4 rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Bài viết cuối phiên
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                      {session.essay}
                    </p>
                  </details>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link to="/phien-hoc" search={{ assignment: session.assignment_id }}>
                    {session.submitted ? "Xem lại đối thoại" : "Tiếp tục phiên học"}
                  </Link>
                </Button>
              </Panel>
            ))
          )}
        </div>
      </div>
    </>
  );
}
