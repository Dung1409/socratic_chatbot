import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { PageHeader, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/giao-vien/")({
  head: () => seo("Lớp học", "Theo dõi phiên học, mức tư duy Bloom và tiến bộ của học sinh."),
  component: Page,
});

function Page() {
  const query = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  if (!query.data)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  const { students, distribution: dist, sessions, pending } = query.data;
  return (
    <>
      <PageHeader
        eyebrow="Giáo viên"
        title="Lớp 12A1 · 12A2"
        desc={`${students.length} hồ sơ mẫu · ${sessions} phiên học đã lưu · ${pending} bài chờ chấm`}
        action={
          <Button asChild>
            <Link to="/giao-vien/danh-gia">Chấm bài chờ</Link>
          </Button>
        }
      />
      <div className="p-6 lg:p-10 space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Số câu đã luyện tập theo bậc Bloom" className="lg:col-span-2">
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={dist}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="b" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Bar
                    isAnimationActive={false}
                    dataKey="n"
                    name="Câu trả lời"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Cần chú ý">
            <ul className="space-y-3 text-sm">
              <li>
                <p className="font-medium">{pending} bài chờ đánh giá</p>
                <p className="text-xs text-muted-foreground">
                  Chọn “Chấm bài chờ” để xem bài làm và lịch sử đối thoại.
                </p>
              </li>
              <li>
                <p className="font-medium">Môi trường demo local</p>
                <p className="text-xs text-muted-foreground">
                  Phiên học được lưu cho hồ sơ Minh Anh. Các hồ sơ còn lại để tham khảo bố cục lớp
                  học.
                </p>
              </li>
              <li>
                <p className="font-medium">Đánh giá theo bằng chứng</p>
                <p className="text-xs text-muted-foreground">
                  Chưa suy luận năng lực Bloom tự động từ số câu trả lời.
                </p>
              </li>
            </ul>
          </Panel>
        </div>
        <Panel title="Học sinh">
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr className="border-b">
                  {[
                    "Học sinh",
                    "Lớp",
                    "Phiên học",
                    "Bloom TB",
                    "Gợi ý/câu",
                    "Điểm TB",
                    "Xu hướng",
                    "",
                  ].map((h) => (
                    <th key={h} className="px-5 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5">{s.cls}</td>
                    <td className="px-5">{s.sessions}</td>
                    <td className="px-5">{s.bloom?.toFixed(1) ?? "—"}</td>
                    <td className="px-5">{s.hints}</td>
                    <td className="px-5">{s.score ?? "—"}</td>
                    <td
                      className={`px-5 ${s.trend.startsWith("+") ? "text-secondary" : "text-destructive"}`}
                    >
                      {s.trend}
                    </td>
                    <td className="px-5 text-right">
                      {s.sessions ? (
                        <Link
                          to="/giao-vien/danh-gia"
                          search={{ student: s.id }}
                          className="text-xs text-primary font-medium"
                        >
                          Xem phiên học
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Chưa có phiên</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
