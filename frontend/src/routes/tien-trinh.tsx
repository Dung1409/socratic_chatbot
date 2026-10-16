import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { PageHeader, Panel } from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/tien-trinh")({
  head: () =>
    seo(
      "Kết quả & tiến trình",
      "Kết quả đánh giá theo rubric và tiến trình phát triển tư duy Bloom của học sinh.",
    ),
  component: Page,
});

function Page() {
  const query = useQuery({ queryKey: ["progress"], queryFn: api.progress });
  if (!query.data)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const { latest, pending, series: progressSeries, bloom_profile: bloomProfile } = query.data;
  const rubric = latest?.rubric.criteria ?? [];
  const review = latest?.review;
  return (
    <>
      <PageHeader
        eyebrow="Học sinh"
        title="Kết quả & tiến trình"
        desc={
          latest
            ? `Bài được chấm gần nhất: ${latest.assignment.title}`
            : `Chưa có bài được chấm. ${pending} bài đang chờ giáo viên đánh giá.`
        }
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
                  domain={[0, Math.max(1, ...bloomProfile.map((p) => p.value))]}
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
        </Panel>
        <Panel title="Điểm bài làm được giáo viên chấm">
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={progressSeries}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" domain={[0, 10]} />
                <Tooltip />
                <Line
                  isAnimationActive={false}
                  dataKey="score"
                  name="Điểm bài làm"
                  stroke="var(--primary)"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Đánh giá theo rubric"
          action={
            <span className="text-sm font-semibold text-primary">
              {review ? `Tổng ${review.total} / 10` : "Chờ đánh giá"}
            </span>
          }
        >
          {!review && (
            <p className="text-sm text-muted-foreground">
              Điểm và nhận xét sẽ hiển thị sau khi giáo viên chấm bài.
            </p>
          )}
          <ul className="space-y-4">
            {rubric.map((r) => (
              <li key={r.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">
                    {r.name}{" "}
                    <span className="text-muted-foreground font-normal">· {r.weight}%</span>
                  </span>
                  <span>{review?.scores[r.id] ?? "—"}/10</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-secondary"
                    style={{ width: `${(review?.scores[r.id] ?? 0) * 10}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Phản hồi">
          <div className="space-y-4 text-sm leading-relaxed">
            <div className="whitespace-pre-wrap">
              <p className="text-xs font-semibold text-secondary mb-1">Nhận xét của giáo viên</p>
              {review?.feedback ?? "Chưa có nhận xét."}
            </div>
            <div className="rounded-md bg-primary-soft p-3">
              <p className="text-xs font-semibold text-primary mb-1">Cách đọc biểu đồ</p>Biểu đồ
              Bloom thể hiện số câu đã luyện tập. Đây chưa phải kết luận về năng lực tư duy; điểm
              bài làm do giáo viên đánh giá theo rubric.
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
