import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BLOOM } from "@/lib/data";
import { api, type Criterion } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/giao-vien/rubric")({
  head: () =>
    seo(
      "Đề bài & rubric",
      "Giáo viên tạo đề bài Ngữ văn, đặt mục tiêu Bloom và thiết kế rubric đánh giá.",
    ),
  component: Page,
});

const schema = z.object({
  title: z.string().min(5, "Tên đề tối thiểu 5 ký tự"),
  prompt: z.string().min(15, "Yêu cầu đề bài cần cụ thể hơn"),
  target: z.coerce.number().min(1).max(6),
  due: z.string().min(1, "Chọn hạn nộp"),
});
type Form = z.infer<typeof schema>;

function Page() {
  const query = useQuery({ queryKey: ["rubric"], queryFn: api.rubric });
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  if (!query.data || !assignments.data)
    return (
      <ApiState
        loading={query.isPending || assignments.isPending}
        error={query.error || assignments.error}
        retry={() => {
          void query.refetch();
          void assignments.refetch();
        }}
      />
    );
  return (
    <RubricForm key={query.data.version} initial={query.data.criteria} list={assignments.data} />
  );
}

function RubricForm({
  initial,
  list,
}: {
  initial: Criterion[];
  list: { id: string; title: string; target: number; due: string }[];
}) {
  const [crit, setCrit] = useState(initial);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const total = crit.reduce((s, c) => s + Number(c.weight), 0);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) as never, defaultValues: { target: 4 } });

  const onSubmit = async (v: Form) => {
    setBusy(true);
    try {
      await api.createAssignment(v);
      reset({ target: 4 });
      await client.invalidateQueries({ queryKey: ["assignments"] });
      toast.success("Đã giao đề bài mới");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được đề");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.saveRubric(crit);
      client.setQueryData(["rubric"], saved);
      toast.success("Đã lưu rubric. Các phiên mới sẽ dùng phiên bản này.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được rubric");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Giáo viên"
        title="Đề bài & rubric"
        desc="Thiết kế đề, đặt bậc Bloom mục tiêu để gia sư xây dựng chuỗi câu hỏi phù hợp."
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-2">
        <Panel title="Tạo đề bài mới">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Tên đề</label>
              <Input
                className="mt-1.5"
                placeholder="VD: Vẻ đẹp hình tượng người lái đò sông Đà"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-xs text-destructive mt-1">{errors.title.message}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Yêu cầu</label>
              <Textarea className="mt-1.5" placeholder="Phân tích…" {...register("prompt")} />
              {errors.prompt && (
                <p className="text-xs text-destructive mt-1">{errors.prompt.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Bloom mục tiêu</label>
                <select
                  className="mt-1.5 w-full h-9 rounded-md border bg-card px-3 text-sm"
                  {...register("target")}
                >
                  {BLOOM.map((b) => (
                    <option key={b.level} value={b.level}>
                      {b.level}. {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Hạn nộp</label>
                <Input type="date" className="mt-1.5" {...register("due")} />
                {errors.due && (
                  <p className="text-xs text-destructive mt-1">{errors.due.message}</p>
                )}
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Giao đề bài"}
            </Button>
          </form>
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Đề đã giao</p>
            <ul className="divide-y">
              {list.map((a, i) => (
                <li key={i} className="py-2.5 flex items-center gap-3 text-sm">
                  <span className="flex-1">{a.title}</span>
                  <BloomBadge level={a.target} />
                  <span className="text-xs text-muted-foreground w-20 text-right">{a.due}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel
          title="Rubric đánh giá nghị luận văn học"
          action={
            <span
              className={`text-xs font-medium ${total === 100 ? "text-secondary" : "text-destructive"}`}
            >
              Tổng trọng số {total}%
            </span>
          }
        >
          <div className="space-y-3">
            {crit.map((c, i) => (
              <div key={c.id} className="grid grid-cols-[1fr_72px_32px] gap-2 items-start">
                <div>
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      setCrit(crit.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
                </div>
                <Input
                  type="number"
                  value={c.weight}
                  onChange={(e) =>
                    setCrit(
                      crit.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCrit(crit.filter((_, j) => j !== i))}
                  aria-label="Xoá tiêu chí"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCrit([
                  ...crit,
                  {
                    id: crypto.randomUUID(),
                    name: "Tiêu chí mới",
                    weight: 0,
                    desc: "Mô tả tiêu chí",
                  },
                ])
              }
            >
              <Plus />
              Thêm tiêu chí
            </Button>
            <Button
              size="sm"
              disabled={busy || total !== 100 || crit.length === 0}
              onClick={() => {
                void save();
              }}
            >
              Lưu rubric
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
