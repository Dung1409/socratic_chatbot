import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { PageHeader, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/tien-trinh")({
  head: () =>
    seo(
      "Thống kê học tập",
      "Theo dõi hoạt động học tập tổng hợp. Mở từng bài học để xem báo cáo chi tiết.",
    ),
  component: Page,
});

function Page() {
  const [period, setPeriod] = useState("30");
  const query = useQuery({ queryKey: ["progress"], queryFn: api.progress });
  if (query.isPending || query.error)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Number(period) + 1);
  const sessions = query.data.sessions.filter(
    (session) => period === "all" || new Date(session.updated_at) >= cutoff,
  );
  const answers = sessions.flatMap((session) =>
    session.turns.filter(
      (turn) => turn.kind === "student" && (!turn.purpose || turn.purpose === "answer"),
    ),
  );
  const submitted = sessions.filter((session) => session.submitted).length;
  const supported = sessions.reduce(
    (count, session) =>
      count +
      (session.tutor_mode === "openai"
        ? (session.support_events?.filter((event) => event.counted_for_autonomy).length ?? 0)
        : session.turns.filter((turn) => turn.kind === "hint").length),
    0,
  );
  const bloom = ["Nhớ", "Hiểu", "Vận dụng", "Phân tích", "Đánh giá", "Sáng tạo"].map(
    (skill, index) => ({
      skill,
      value: answers.filter((turn) => "level" in turn && turn.level === index + 1).length,
    }),
  );
  const activity = ["Đang đối thoại", "Đang tổng hợp", "Đã nộp"].map((name, index) => ({
    name,
    value: sessions.filter((session) =>
      index === 2 ? session.submitted : !session.submitted && session.done === (index === 1),
    ).length,
  }));
  return (
    <>
      <PageHeader
        title="Thống kê học tập"
        desc="Theo dõi hoạt động tổng hợp; đề bài và kết quả chi tiết nằm trong từng bài học."
        action={
          <select
            aria-label="Khoảng thời gian thống kê"
            className="assignment-select sm:w-48"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="7">7 ngày gần đây</option>
            <option value="30">30 ngày gần đây</option>
            <option value="90">90 ngày gần đây</option>
            <option value="all">Toàn bộ thời gian</option>
          </select>
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-10">
        <p className="text-xs text-muted-foreground">
          Khoảng thời gian được tính theo lần cập nhật gần nhất của từng lượt học. Biểu đồ phản ánh
          hoạt động, không phải điểm năng lực.
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Số liệu học tập tổng hợp">
          {[
            ["Bài có hoạt động", new Set(sessions.map((session) => session.assignment_id)).size],
            ["Câu đã trả lời", answers.length],
            ["Câu đã nộp bài", submitted],
            ["Lượt hỗ trợ", supported],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {!sessions.length ? (
          <section className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-semibold">Chưa có hoạt động trong khoảng đã chọn</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Thử chọn khoảng thời gian khác hoặc mở một bài học để bắt đầu.
            </p>
            <Button asChild className="mt-4">
              <Link to="/" search={{}}>
                Mở bài học của tôi
              </Link>
            </Button>
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Trạng thái các lượt học">
              <div
                className="h-72"
                role="img"
                aria-label={activity.map((entry) => `${entry.name}: ${entry.value}`).join("; ")}
              >
                <ResponsiveContainer>
                  <BarChart data={activity} margin={{ top: 15, left: -20, right: 10, bottom: 20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      name="Số lượt học"
                      fill="var(--primary)"
                      radius={[5, 5, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Câu trả lời theo bậc câu hỏi">
              {answers.length ? (
                <div
                  className="h-72"
                  role="img"
                  aria-label={bloom.map((entry) => `${entry.skill}: ${entry.value}`).join("; ")}
                >
                  <ResponsiveContainer>
                    <RadarChart data={bloom}>
                      <PolarGrid stroke="var(--border)" />
                      <PolarAngleAxis dataKey="skill" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis
                        domain={[0, Math.max(1, ...bloom.map((entry) => entry.value))]}
                        tick={false}
                        axisLine={false}
                      />
                      <Radar
                        dataKey="value"
                        stroke="var(--primary)"
                        fill="var(--primary)"
                        fillOpacity={0.15}
                        isAnimationActive={false}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Chưa có câu trả lời để hiển thị biểu đồ.
                </p>
              )}
            </Panel>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Để xem bài tổng hợp, bằng chứng và nhận xét, mở phần Kết quả trong bài học tương ứng.
        </p>
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/" search={{}}>
            Về bài học của tôi
          </Link>
        </Button>
      </div>
    </>
  );
}
