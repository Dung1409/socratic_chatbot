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
  const hasResults =
    selected === "results" || sessions.some((session) => session.submitted && session.assessment);
  const style = (active: boolean) =>
    `flex min-h-9 items-center justify-center rounded-md border px-3 py-1.5 text-center text-xs sm:text-sm ${active ? "border-primary bg-primary-soft font-semibold text-primary" : "bg-card text-muted-foreground hover:text-primary"}`;
  return (
    <nav
      aria-label="Nội dung bài học"
      className={`grid gap-2 ${hasResults ? "grid-cols-3" : "grid-cols-2"}`}
    >
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
      {hasResults && (
        <Link
          to="/"
          search={{ lesson: assignment.id, view: "results" }}
          aria-current={selected === "results" ? "page" : undefined}
          className={style(selected === "results")}
        >
          Kết quả
        </Link>
      )}
    </nav>
  );
}
