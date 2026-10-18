import { Link } from "@tanstack/react-router";
import type { Assignment, Session } from "@/lib/api";
import { lessonState } from "@/lib/lessons";

export function LessonTabs({
  assignment,
  sessions,
  selected,
}: {
  assignment: Assignment;
  sessions: Session[];
  selected: "assignment" | "study" | "results";
}) {
  const destination = lessonState(assignment, sessions).search;
  const style = (active: boolean) =>
    `flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-center text-xs sm:text-sm ${active ? "border-primary bg-primary-soft font-semibold text-primary" : "bg-card text-muted-foreground hover:text-primary"}`;
  return (
    <nav aria-label="Nội dung bài học" className="grid grid-cols-3 gap-2">
      <Link
        to="/"
        search={{ lesson: assignment.id, view: "assignment" }}
        aria-current={selected === "assignment" ? "page" : undefined}
        className={style(selected === "assignment")}
      >
        Đề bài
      </Link>
      <Link
        to="/phien-hoc"
        search={destination}
        aria-current={selected === "study" ? "page" : undefined}
        className={style(selected === "study")}
      >
        Học cùng Trợ lý ảo
      </Link>
      <Link
        to="/"
        search={{ lesson: assignment.id, view: "results" }}
        aria-current={selected === "results" ? "page" : undefined}
        className={style(selected === "results")}
      >
        Kết quả
      </Link>
    </nav>
  );
}
