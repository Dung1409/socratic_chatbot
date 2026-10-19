import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { api } from "@/lib/api";
import { lessonState, readableLessonTitle } from "@/lib/lessons";
import { assessmentLabel, sessionLabel, taskLabel } from "@/lib/learning-state";
import { ApiState } from "@/components/ApiState";
import { AssessmentReport } from "@/components/AssessmentReport";
import { Button } from "@/components/ui/button";
import { AssignmentPanel } from "@/components/session/AssignmentPanel";
import { LessonTabs } from "./LessonTabs";

export function LessonDetail({
  id,
  view,
  itemId,
  fromSubmitted = false,
}: {
  id: string;
  view: "assignment" | "results";
  itemId?: string;
  fromSubmitted?: boolean;
}) {
  const navigate = useNavigate();
  const [panelOpen, setPanelOpen] = useState(true);
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
          <Link to="/" search={fromSubmitted ? { filter: "submitted" } : {}}>
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
  const { saved, total, submitted } = lessonState(assignment, sessions.data ?? []);
  const allResults = saved.filter((session) => session.submitted && session.assessment);
  const selectedItemId =
    itemId ?? allResults[0]?.assignment.active_item_id ?? assignment.items?.[0]?.id;
  const results = allResults.filter(
    (session) => session.assignment.active_item_id === selectedItemId,
  );
  const selectedItem = assignment.items?.find((entry) => entry.id === selectedItemId);
  const selectedResult = results[0];
  const selectedContextSession = saved.find(
    (session) => session.assignment.active_item_id === selectedItemId,
  );
  const contextSession = saved[0];
  return (
    <div className="lesson-workspace mx-auto flex min-h-[calc(100dvh-56px)] w-full min-w-0 bg-background">
      <section className="flex min-w-0 flex-1 flex-col">
        <header
          className={`learning-session-header relative grid min-h-28 shrink-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-center gap-x-2 gap-y-1 border-b bg-card px-6 py-2 lg:px-10 ${!panelOpen ? "sm:pr-16" : ""}`}
        >
          <Button
            asChild
            variant="ghost"
            className="h-8 shrink-0 justify-self-start gap-1 px-1 text-xs"
          >
            <Link to="/" search={fromSubmitted ? { filter: "submitted" } : {}}>
              <ArrowLeft aria-hidden="true" />
              <span className="hidden sm:inline">
                {fromSubmitted ? "Bài đã nộp" : "Bài học của tôi"}
              </span>
            </Link>
          </Button>
          <div className="col-span-2 row-start-2 min-w-0 self-center">
            <h1
              className="truncate text-xl font-semibold leading-7 tracking-tight"
              title={assignment.title}
            >
              {readableLessonTitle(assignment.title)}
            </h1>
            <p className="learning-session-meta mt-1 truncate text-xs leading-4 text-muted-foreground">
              {taskLabel(assignment.task_type)} · Đã nộp {submitted}/{total} câu
            </p>
          </div>
          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1">
            {assignment.document_id && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
              >
                <a
                  href={`/api/documents/${assignment.document_id}/original`}
                  target="_blank"
                  rel="noreferrer"
                  title="Xem đề bài gốc"
                  aria-label="Xem đề bài gốc"
                >
                  <BookOpen aria-hidden="true" />
                </a>
              </Button>
            )}
            {!panelOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Mở thông tin học tập"
                title="Mở thông tin học tập"
                onClick={() => setPanelOpen(true)}
              >
                <PanelRightOpen aria-hidden="true" />
              </Button>
            )}
          </div>
        </header>
        <main id="lesson-content" className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="learning-chat-content mx-auto w-full space-y-5">
            {view !== "results" && (
              <LessonTabs assignment={assignment} sessions={sessions.data ?? []} selected={view} />
            )}
            {view === "assignment" ? (
              <>
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">Nội dung đề bài</h2>
                  <p className="mt-3 whitespace-pre-wrap break-words leading-7">
                    {assignment.prompt || "Chọn một câu bên dưới để xem yêu cầu."}
                  </p>
                  {assignment.source_text && (
                    <details className="mt-5 border-t pt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Ngữ liệu đi kèm
                      </summary>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    {selectedItem ? `Kết quả ${selectedItem.label}` : "Kết quả bài học"}
                  </h2>
                </div>
                {results.map((session) => (
                  <article key={session.id} className="rounded-xl border bg-card p-5">
                    <h3 className="font-semibold">
                      {assignment.items?.find(
                        (item) => item.id === session.assignment.active_item_id,
                      )?.label ?? "Bài làm đã nộp"}
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
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-lg font-semibold">
                  {selectedItem
                    ? `${selectedItem.label} chưa có phiếu kết quả`
                    : "Bài học chưa có câu đã nộp"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedItem
                    ? "Phiếu của câu này sẽ xuất hiện sau khi em nộp bài tổng hợp."
                    : "Chọn một câu trong đề bài để bắt đầu học và xem kết quả tại đây sau khi nộp."}
                </p>
              </section>
            )}
          </div>
        </main>
      </section>
      {panelOpen && (
        <aside
          aria-label="Thông tin học tập"
          className="learning-panel hidden min-h-0 shrink-0 flex-col border-l bg-card min-[1100px]:flex"
        >
          <div className="relative flex h-28 shrink-0 items-center border-b px-5">
            <h2 className="text-lg font-semibold">Thông tin học tập</h2>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-r-none border border-r-0 bg-card text-muted-foreground shadow-none"
              aria-label="Thu gọn panel học tập"
              title="Thu gọn panel học tập"
              onClick={() => setPanelOpen(false)}
            >
              <PanelRightClose aria-hidden="true" />
            </Button>
          </div>
          <div className="learning-panel-scroll min-h-0 flex-1 overflow-y-auto p-5">
            {view === "results" ? (
              <div className="space-y-5">
                {assignment.items && assignment.items.length > 1 && (
                  <label className="block text-xs font-medium text-muted-foreground">
                    Câu đang xem
                    <select
                      aria-label="Câu đang xem kết quả"
                      className="mt-1 block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
                      value={selectedItemId}
                      onChange={(event) =>
                        void navigate({
                          to: "/",
                          search: {
                            lesson: assignment.id,
                            view: "results",
                            item: event.target.value,
                            ...(fromSubmitted ? { filter: "submitted" as const } : {}),
                          },
                        })
                      }
                    >
                      {assignment.items.map((item) => {
                        const result = allResults.find(
                          (entry) => entry.assignment.active_item_id === item.id,
                        );
                        return (
                          <option key={item.id} value={item.id}>
                            {item.label} · {result ? "Đã có kết quả" : "Chưa có kết quả"}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                )}
                {selectedContextSession ? (
                  <AssignmentPanel
                    session={selectedContextSession}
                    onViewAssignment={() =>
                      window.document
                        .getElementById("lesson-content")
                        ?.scrollTo({ top: 0, behavior: "smooth" })
                    }
                  />
                ) : (
                  <section>
                    <h3 className="text-sm font-medium text-muted-foreground">Thông tin đề</h3>
                    <p className="mt-2 break-words text-lg font-semibold leading-7">
                      {selectedItem?.label ?? readableLessonTitle(assignment.title)}
                    </p>
                    {selectedItem?.prompt && (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                        {selectedItem.prompt}
                      </p>
                    )}
                  </section>
                )}
              </div>
            ) : contextSession ? (
              <AssignmentPanel
                session={contextSession}
                onViewAssignment={() =>
                  window.document
                    .getElementById("lesson-content")
                    ?.scrollTo({ top: 0, behavior: "smooth" })
                }
              />
            ) : (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground">Bài học của em</h3>
                <p className="mt-2 break-words text-lg font-semibold leading-7">
                  {readableLessonTitle(assignment.title)}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {taskLabel(assignment.task_type)} · {total} câu
                </p>
              </section>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
