import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Clock, Lightbulb, Target } from "lucide-react";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () =>
    seo(
      "Tổng quan tự học",
      "Tải đề riêng, luyện tập Socratic và theo dõi tiến trình tự học Ngữ văn.",
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
  const completed = stats.latest_session?.submitted ?? false;
  return (
    <>
      <PageHeader
        eyebrow="Không gian tự học Ngữ văn"
        title="Hôm nay em sẽ suy nghĩ sâu hơn một bậc."
        desc="Mang theo đề bài của em. Cùng gia sư luyện cách đặt câu hỏi, tìm dẫn chứng và xây dựng lập luận."
        action={
          <Button asChild>
            <Link to="/de-bai">
              Thêm đề tự học <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <Panel
            title={
              current
                ? completed
                  ? "Phiên học gần nhất"
                  : "Tiếp tục tự học"
                : "Bắt đầu từ đề bài của em"
            }
          >
            {current ? (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">{current.title}</h2>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{current.prompt}</p>
                <BloomBadge level={current.target} />
                <div>
                  <Button asChild>
                    <Link to="/phien-hoc" search={{ assignment: current.id }}>
                      {completed ? "Xem lại phiên học" : "Tiếp tục phiên học"} <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Bạn chưa có đề tự học. Tải lên tệp TXT, DOCX, PDF có chữ hoặc nhập nội dung đề,
                  kiểm tra lại rồi bắt đầu.
                </p>
                <Button asChild>
                  <Link to="/de-bai">
                    Thêm đề đầu tiên <ArrowRight />
                  </Link>
                </Button>
              </div>
            )}
          </Panel>
          <Panel
            title="Đề bài của tôi"
            action={
              <Link to="/de-bai" className="text-xs text-primary font-medium">
                Xem tất cả
              </Link>
            }
          >
            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Các đề bạn xác nhận sẽ xuất hiện ở đây.
              </p>
            ) : (
              <ul className="divide-y -my-2">
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="py-3 flex items-center gap-4">
                    <Link
                      to="/phien-hoc"
                      search={{ assignment: assignment.id }}
                      className="flex-1 min-w-0 font-medium text-sm hover:text-primary"
                    >
                      {assignment.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{assignment.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Hoạt động đã lưu">
            <dl className="grid grid-cols-2 gap-4">
              {[
                { icon: Clock, label: "Phiên học", value: stats.sessions },
                { icon: Target, label: "Câu đã trả lời", value: stats.answers },
                { icon: Lightbulb, label: "Gợi ý / câu trả lời", value: stats.hints_per_answer },
                { icon: BookOpen, label: "Phiên hoàn thành", value: stats.submitted },
              ].map((item) => (
                <div key={item.label}>
                  <item.icon className="h-4 w-4 text-secondary mb-2" />
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="text-xl font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Nhật ký tự học">
            <p className="text-sm text-muted-foreground">
              Xem lại câu trả lời, gợi ý đã dùng và bài viết cuối phiên để tự đối chiếu cách lập
              luận.
            </p>
            <Link to="/tien-trinh" className="mt-3 inline-flex text-xs text-primary font-medium">
              Xem tiến trình tự học →
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
