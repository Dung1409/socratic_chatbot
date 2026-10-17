import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiState } from "@/components/ApiState";
import { AssignmentCard, AssignmentListSkeleton } from "@/components/assignments/AssignmentCard";
import { assignmentStates, getAssignmentState } from "@/components/assignments/assignment-state";
import { CreateAssignmentDialog } from "@/components/assignments/CreateAssignmentDialog";
import { api, type Assignment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/de-bai")({
  head: () => seo("Đề bài của tôi", "Lưu đề Ngữ văn và tự học cùng gia sư Socratic."),
  component: Page,
});

function Page() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const createButton = useRef<HTMLButtonElement>(null);
  const query = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const client = useQueryClient();
  const navigate = useNavigate();
  const assignments = query.data ?? [];
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLocaleLowerCase("vi");
  const visible = assignments.filter(
    (assignment) =>
      (filter === "all" || getAssignmentState(assignment).key === filter) &&
      normalize(assignment.title).includes(normalize(search.trim())),
  );
  const filters = [{ key: "all", label: "Tất cả" }, ...assignmentStates];

  const onCreated = (assignment: Assignment, start: boolean) => {
    client.setQueryData<Assignment[]>(["assignments"], (previous = []) => [
      assignment,
      ...previous.filter((item) => item.id !== assignment.id),
    ]);
    void client.invalidateQueries({ queryKey: ["assignments"] });
    void client.invalidateQueries({ queryKey: ["dashboard"] });
    if (start) {
      void navigate({ to: "/phien-hoc", search: { assignment: assignment.id } }).catch(() =>
        toast.error("Đề đã lưu. Em có thể bấm Bắt đầu học trong danh sách để thử lại."),
      );
    } else {
      setSearch("");
      setFilter("all");
    }
  };

  return (
    <div className="assignment-page p-4 sm:p-6 lg:p-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Đề bài của tôi</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Chọn một đề bài, bắt đầu từ suy nghĩ của em.
          </p>
        </div>
        <Button
          ref={createButton}
          className="h-11 shrink-0 shadow-none"
          onClick={() => setOpen(true)}
        >
          <Plus aria-hidden="true" /> Tạo đề bài
        </Button>
      </header>

      <section className="mt-8" aria-label="Danh sách đề bài">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Tìm kiếm theo tên đề bài"
            placeholder="Tìm kiếm theo tên đề bài…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-12 rounded-lg bg-card pl-11 pr-12 shadow-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Xóa tìm kiếm"
              className="absolute right-1 top-1 h-10 w-10"
              onClick={() => setSearch("")}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="my-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
            {filters.map((item) => {
              const count =
                item.key === "all"
                  ? assignments.length
                  : assignments.filter(
                      (assignment) => getAssignmentState(assignment).key === item.key,
                    ).length;
              return (
                <Button
                  key={item.key}
                  variant="ghost"
                  aria-pressed={filter === item.key}
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "h-10 gap-2 border px-3 shadow-none sm:px-4",
                    filter === item.key
                      ? "border-primary/25 bg-primary-soft text-primary hover:bg-primary-soft"
                      : "border-transparent text-muted-foreground hover:bg-card",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs tabular-nums",
                      filter === item.key ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    {query.isPending || query.isError ? "…" : count}
                  </span>
                </Button>
              );
            })}
          </div>
          {!query.isPending && !query.isError && (
            <p role="status" className="text-xs text-muted-foreground">
              {visible.length} đề bài{query.isFetching ? " · Đang cập nhật…" : ""}
            </p>
          )}
        </div>

        {query.isPending ? (
          <AssignmentListSkeleton />
        ) : query.isError ? (
          <div className="rounded-lg border bg-card">
            <ApiState error={query.error} retry={query.refetch} />
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center">
            <div className="mb-5 grid size-14 place-items-center rounded-xl bg-primary-soft text-primary">
              <BookOpen aria-hidden="true" className="size-6" />
            </div>
            <h2 className="text-lg font-semibold">Bắt đầu với đề bài đầu tiên</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Nhập đề hoặc tải tài liệu lên. Gia sư sẽ cùng em khám phá từng ý qua những câu hỏi gợi
              mở.
            </p>
            <Button
              variant="outline"
              className="mt-6 h-11 bg-card shadow-none"
              onClick={() => setOpen(true)}
            >
              <Plus aria-hidden="true" /> Tạo đề bài đầu tiên
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border bg-card px-6 py-14 text-center">
            <Search aria-hidden="true" className="mx-auto mb-4 size-6 text-muted-foreground" />
            <h2 className="font-semibold">Không tìm thấy đề bài phù hợp</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Thử tên đề khác hoặc chọn lại trạng thái.
            </p>
            <Button
              variant="outline"
              className="mt-5 h-11 bg-card shadow-none"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>
        ) : (
          <ul className="space-y-4">
            {visible.map((assignment) => (
              <li key={assignment.id}>
                <AssignmentCard assignment={assignment} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <CreateAssignmentDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={onCreated}
        triggerRef={createButton}
      />
    </div>
  );
}
