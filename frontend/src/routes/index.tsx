import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { seo } from "@/lib/seo";
import { lessonFilterValues, type LessonFilter } from "@/lib/lessons";
import { LessonLibrary } from "@/components/lessons/LessonLibrary";
import { LessonDetail } from "@/components/lessons/LessonDetail";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    lesson?: string;
    view?: "assignment" | "results";
    item?: string;
    filter?: LessonFilter;
  } => ({
    ...(typeof search["lesson"] === "string" && search["lesson"]
      ? { lesson: search["lesson"] }
      : {}),
    ...(search["view"] === "assignment" || search["view"] === "results"
      ? { view: search["view"] }
      : {}),
    ...(typeof search["item"] === "string" && search["item"] ? { item: search["item"] } : {}),
    ...(lessonFilterValues.some((value) => value === search["filter"])
      ? { filter: search["filter"] as LessonFilter }
      : {}),
  }),
  head: () =>
    seo(
      "Bài học của tôi",
      "Quản lý bài học, tiếp tục học cùng Trợ lý ảo và xem kết quả trong từng bài.",
    ),
  component: Page,
});

function Page() {
  const { lesson, view, item, filter } = Route.useSearch();
  const navigate = useNavigate();
  return lesson ? (
    <LessonDetail
      id={lesson}
      view={view ?? "assignment"}
      fromSubmitted={filter === "submitted" || view === "results"}
      {...(item ? { itemId: item } : {})}
    />
  ) : (
    <LessonLibrary
      filter={filter ?? "all"}
      onFilter={(value) =>
        void navigate({ to: "/", search: value === "all" ? {} : { filter: value }, replace: true })
      }
    />
  );
}
