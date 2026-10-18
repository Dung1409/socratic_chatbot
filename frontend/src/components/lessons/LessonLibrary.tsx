import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { lessonFilters, lessonState, readableLessonTitle, unassignedDocuments, type LessonFilter } from "@/lib/lessons";
import { learningDate, taskLabel } from "@/lib/learning-state";
import { PageHeader } from "@/components/AppShell";
import { ApiState } from "@/components/ApiState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LessonLibrary({
  filter,
  onFilter,
}: {
  filter: LessonFilter;
  onFilter: (filter: LessonFilter) => void;
}) {
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: api.documents,
    refetchInterval: (query) =>
      query.state.data?.some((doc) => ["uploaded", "processing"].includes(doc.status))
        ? 2000
        : false,
  });
  const [search, setSearch] = useState("");
  const states = (assignments.data ?? []).map((assignment) => ({
    assignment,
    ...lessonState(assignment, sessions.data ?? []),
  }));
  const sources = unassignedDocuments(assignments.data ?? [], documents.data ?? []);
  const counts = {
    all: states.length + sources.length,
    review: sources.length,
    new: states.filter((entry) => entry.state === "new").length,
    active: states.filter((entry) => entry.state === "active").length,
    submitted: states.filter((entry) => entry.state === "submitted").length,
  };
  const matches = (value: string) =>
    value.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
  const visible = states.filter(
    (entry) =>
      (filter === "all" || filter === entry.state) &&
      matches(`${entry.assignment.title} ${entry.assignment.prompt}`),
  );
  const visibleSources = sources.filter(
    (doc) => (filter === "all" || filter === "review") && matches(`${doc.title} ${doc.filename}`),
  );
  const loading = assignments.isPending || sessions.isPending || documents.isPending;
  const error = assignments.error || sessions.error || documents.error;
  return (
    <>
      <PageHeader
        title="Bài học của tôi"
        desc="Mỗi bài học gồm đề bài, cuộc trao đổi và kết quả của em."
        action={
          <Button asChild className="min-h-11">
            <Link to="/de-bai" search={{ tab: "quick" }}>
              <Plus aria-hidden="true" /> Thêm bài học
            </Link>
          </Button>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-10">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Tóm tắt bài học">
          {[
            ["Tổng bài học", counts.all],
            ["Cần kiểm tra", counts.review],
            ["Đang học", counts.active],
            ["Đã nộp", counts.submitted],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <Input
          className="min-h-11"
          aria-label="Tìm bài học"
          placeholder="Tìm theo tên bài học hoặc nội dung đề…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc bài học">
          {lessonFilters.map(([value, label]) => (
            <Button
              key={value}
              className="min-h-11"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {label} ({counts[value]})
            </Button>
          ))}
        </div>
        {loading || error ? (
          <ApiState
            loading={loading}
            error={error}
            retry={() => {
              void assignments.refetch();
              void sessions.refetch();
              void documents.refetch();
            }}
          />
        ) : visible.length || visibleSources.length ? (
          <ul className="space-y-3" aria-label="Danh sách bài học">
            {visibleSources.map((doc) => (
              <li key={`document:${doc.document_id}`} className="rounded-xl border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="size-4" aria-hidden="true" />
                      {["uploaded", "processing"].includes(doc.status)
                        ? "Đang xử lý tài liệu"
                        : doc.status === "failed"
                          ? "Cần xử lý lại"
                          : "Cần kiểm tra nội dung"}
                    </p>
                    <h2 className="break-words font-semibold">{readableLessonTitle(doc.title)}</h2>
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                      {doc.filename}
                      {doc.question_count ? ` · ${doc.question_count} câu` : ""}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="min-h-11">
                    <Link to="/de-bai" search={{ tab: "documents", document: doc.document_id }}>
                      {["uploaded", "processing"].includes(doc.status)
                        ? "Xem trạng thái"
                        : doc.status === "failed"
                          ? "Xử lý lại tài liệu"
                          : "Tiếp tục kiểm tra"}
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
            {visible.map(
              ({ assignment, total, submitted, state, saved, resume, search: destination }) => (
                <li key={assignment.id} className="rounded-xl border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <BookOpen className="size-4" aria-hidden="true" />
                        {taskLabel(assignment.task_type)} ·{" "}
                        {state === "new"
                          ? "Chưa bắt đầu"
                          : state === "submitted"
                            ? "Đã nộp"
                            : "Đang học"}
                      </p>
                      <h2 className="break-words font-semibold">
                        <Link
                          to="/"
                          search={{ lesson: assignment.id, view: "assignment" }}
                          className="hover:text-primary"
                        >
                          {readableLessonTitle(assignment.title)}
                        </Link>
                      </h2>
                      {assignment.prompt?.trim() !== assignment.title.trim() && (
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {assignment.prompt}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Đã nộp {submitted}/{total} câu
                        {resume?.done && !resume.submitted ? " · Đang tổng hợp bài làm" : ""}
                        {saved[0] ? ` · Cập nhật ${learningDate(saved[0].updated_at)}` : ""}
                      </p>
                    </div>
                    <Button
                      asChild
                      className="min-h-11"
                      variant={state === "submitted" ? "outline" : "default"}
                    >
                      {state === "submitted" &&
                      saved.some((session) => session.submitted && session.assessment) ? (
                        <Link to="/" search={{ lesson: assignment.id, view: "results" }}>
                          Xem kết quả
                        </Link>
                      ) : (
                        <Link to="/phien-hoc" search={destination}>
                          {state === "new"
                            ? "Bắt đầu học"
                            : state === "submitted"
                              ? "Mở bài học"
                              : "Tiếp tục học"}
                        </Link>
                      )}
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-semibold">
              {counts.all ? "Không có bài học phù hợp" : "Chưa có bài học"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {counts.all
                ? "Thử đổi bộ lọc hoặc từ khóa."
                : "Thêm đề hoặc tải tài liệu để bắt đầu. Bài đang dở và kết quả sẽ được giữ trong cùng một bài học."}
            </p>
            {!counts.all && (
              <Button asChild className="mt-4 min-h-11">
                <Link to="/de-bai" search={{ tab: "quick" }}>
                  Thêm bài học đầu tiên
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
