import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Assignment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getAssignmentState } from "./assignment-state";

export function AssignmentCard({ assignment }: { assignment: Assignment }) {
  const state = getAssignmentState(assignment);
  const StatusIcon = state.icon;
  const TaskIcon = assignment.task_type === "reading" ? BookOpen : FileText;
  return (
    <article
      className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/30 sm:p-6"
      aria-label={assignment.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 font-medium text-foreground">
            <TaskIcon aria-hidden="true" className="size-3.5" />
            {assignment.task_type === "reading"
              ? "Đọc hiểu"
              : assignment.task_type === "social"
                ? "Nghị luận xã hội"
                : "Đề tự học"}
          </span>
          {assignment.grade && <span>Lớp {assignment.grade}</span>}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
            state.style,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-3.5" />
          {state.label}
        </span>
      </div>
      <h2 className="mt-4 break-words text-base font-semibold leading-7 sm:text-lg">
        {assignment.title}
      </h2>
      <p className="mt-1.5 line-clamp-2 break-words text-sm leading-6 text-muted-foreground">
        {assignment.prompt}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {assignment.document_id ? (
            <>
              <Paperclip aria-hidden="true" className="size-3.5" /> Có tài liệu đính kèm
            </>
          ) : assignment.source_text ? (
            <>
              <BookOpen aria-hidden="true" className="size-3.5" /> Có ngữ liệu
            </>
          ) : (
            "Đề tự học của em"
          )}
        </span>
        <Button
          asChild
          variant={state.key === "active" ? "default" : "outline"}
          className={cn(
            "h-11 bg-card shadow-none",
            state.key === "active"
              ? "bg-primary"
              : "border-primary/20 text-primary hover:bg-primary-soft",
          )}
        >
          <Link to="/phien-hoc" search={{ assignment: assignment.id }}>
            {state.action}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function AssignmentListSkeleton() {
  return (
    <div role="status" aria-label="Đang tải đề bài" className="space-y-4">
      <span className="sr-only">Đang tải đề bài…</span>
      {[0, 1, 2].map((item) => (
        <div key={item} aria-hidden="true" className="rounded-xl border bg-card p-6">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-7 w-24" />
          </div>
          <Skeleton className="mt-5 h-6 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-5 ml-auto h-10 w-36" />
        </div>
      ))}
    </div>
  );
}
