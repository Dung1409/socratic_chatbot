import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { lessonState } from "@/lib/lessons";
import { assessmentLabel, sessionLabel, taskLabel } from "@/lib/learning-state";
import { ApiState } from "@/components/ApiState";
import { PageHeader } from "@/components/AppShell";
import { AssessmentReport } from "@/components/AssessmentReport";
import { Button } from "@/components/ui/button";
import { LessonTabs } from "./LessonTabs";

export function LessonDetail({ id, view }: { id: string; view: "assignment" | "results" }) {
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const assignment = assignments.data?.find((entry) => entry.id === id);
  const document = useQuery({
    queryKey: ["document", assignment?.document_id],
    queryFn: () => api.document(assignment!.document_id!),
    enabled: Boolean(assignment?.document_id) && view === "assignment",
  });
  if (assignments.isPending || sessions.isPending || assignments.error || sessions.error)
    return (
      <>
        <Button asChild variant="link">
          <Link to="/" search={{}}>
            ← Bài học của tôi
          </Link>
        </Button>
        <ApiState
          loading={assignments.isPending || sessions.isPending}
          error={assignments.error || sessions.error}
          retry={() => {
            void assignments.refetch();
            void sessions.refetch();
          }}
        />
      </>
    );
  if (!assignment)
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Không tìm thấy bài học</h1>
        <Button asChild>
          <Link to="/" search={{}}>
            Về bài học của tôi
          </Link>
        </Button>
      </div>
    );
  const { saved, total, submitted, search } = lessonState(assignment, sessions.data ?? []);
  const results = saved.filter((session) => session.submitted);
  return (
    <>
      <div className="border-b bg-card px-4 pt-3 sm:px-6">
        <Button asChild variant="link" className="min-h-11 px-0">
          <Link to="/" search={{}}>
            ← Bài học của tôi
          </Link>
        </Button>
      </div>
      <PageHeader
        title={assignment.title}
        desc={`${taskLabel(assignment.task_type)} · Đã nộp ${submitted}/${total} câu`}
      />
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-10">
        <LessonTabs assignment={assignment} sessions={saved} selected={view} />
        {view === "assignment" ? (
          <>
            <section className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Nội dung đề bài</h2>
              <p className="mt-3 whitespace-pre-wrap break-words leading-7">
                {assignment.prompt || "Chọn một câu bên dưới để xem yêu cầu."}
              </p>
              {assignment.source_text && (
                <details className="mt-5 border-t pt-4">
                  <summary className="cursor-pointer text-sm font-medium">Ngữ liệu đi kèm</summary>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
                    {assignment.source_text}
                  </p>
                </details>
              )}
            </section>
            {assignment.items && (
              <section className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold">Các câu trong bài học</h2>
                <ol className="mt-4 space-y-3" aria-label="Các câu trong bài học">
                  {assignment.items.map((item) => {
                    const session = saved.find(
                      (entry) => entry.assignment.active_item_id === item.id,
                    );
                    return (
                      <li key={item.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium">{item.label}</h3>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                              {item.prompt}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {session ? sessionLabel(session) : "Chưa bắt đầu"}
                            </p>
                          </div>
                          <Button asChild variant="outline" className="min-h-11">
                            <Link
                              to="/phien-hoc"
                              search={
                                session
                                  ? { session: session.id }
                                  : { assignment: id, item: item.id }
                              }
                            >
                              {session?.submitted
                                ? "Xem đối thoại"
                                : session
                                  ? "Tiếp tục câu này"
                                  : "Học câu này"}
                            </Link>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
            {assignment.document_id && (
              <section className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold">Tài liệu đính kèm</h2>
                {document.isPending || document.error ? (
                  <ApiState
                    loading={document.isPending}
                    error={document.error}
                    retry={document.refetch}
                  />
                ) : (
                  <>
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                      {document.data?.filename}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild variant="outline">
                        <a
                          href={`/api/documents/${assignment.document_id}/original`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Xem tài liệu gốc
                        </a>
                      </Button>
                    </div>
                    <details className="mt-3 rounded-lg border p-4 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Xem nội dung đã nhận dạng
                      </summary>
                      <p className="mt-3 whitespace-pre-wrap break-words leading-7">
                        {document.data?.text}
                      </p>
                    </details>
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Thông tin xử lý tài liệu
                      </summary>
                      <p className="mt-2 text-muted-foreground">
                        {document.data?.page_count ?? 0} trang ·{" "}
                        {document.data?.question_count ?? 0} câu được nhận dạng
                      </p>
                      {document.data?.extraction_warnings?.map((warning, index) => (
                        <p className="mt-2" key={index}>
                          {warning}
                        </p>
                      ))}
                    </details>
                  </>
                )}
              </section>
            )}
          </>
        ) : results.length ? (
          <section className="space-y-4" aria-label="Kết quả bài học">
            <h2 className="text-lg font-semibold">Kết quả bài học</h2>
            {results.map((session) => (
              <article key={session.id} className="rounded-xl border bg-card p-5">
                <h3 className="font-semibold">
                  {assignment.items?.find((item) => item.id === session.assignment.active_item_id)
                    ?.label ?? "Bài làm đã nộp"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Đã nộp · {assessmentLabel(session)}
                </p>
                {session.assessment && (
                  <div className="mt-4">
                    <AssessmentReport report={session.assessment} />
                  </div>
                )}
                {session.essay && (
                  <details className="mt-4 rounded-lg border p-4">
                    <summary className="cursor-pointer text-sm font-medium">
                      Bài tổng hợp đã nộp
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
                      {session.essay}
                    </p>
                  </details>
                )}
                <Button asChild variant="outline" className="mt-4 min-h-11">
                  <Link to="/phien-hoc" search={{ session: session.id }}>
                    Xem lại đối thoại
                  </Link>
                </Button>
              </article>
            ))}
          </section>
        ) : (
          <section className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-semibold">Bài học chưa có câu đã nộp</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Kết quả và bài tổng hợp sẽ xuất hiện ở đây sau khi em nộp bài.
            </p>
            <Button asChild className="mt-4 min-h-11">
              <Link to="/phien-hoc" search={search}>
                {saved.length ? "Tiếp tục học" : "Bắt đầu học"}
              </Link>
            </Button>
          </section>
        )}
      </div>
    </>
  );
}
