import { useLayoutEffect, useRef } from "react";
import { Check, ChevronRight, Info, MessageSquare, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type Session } from "@/lib/api";
import { sessionLabel } from "@/lib/learning-state";
import { BLOOM } from "@/lib/data";
import { getLearningHistory } from "./learning-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssignmentPanel } from "./AssignmentPanel";

export function LearningPanel({
  session,
  sessions,
  onJump,
  onViewAssignment,
  onSelectItem,
  navigationBusy,
  tab,
  onTabChange,
}: {
  session: Session;
  sessions: Session[];
  onJump: (index: number) => void;
  onViewAssignment: () => void;
  onSelectItem?: (itemId: string) => void;
  navigationBusy: boolean;
  tab: "assignment" | "journey";
  onTabChange: (tab: "assignment" | "journey") => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [tab]);
  const { questions, answers } = getLearningHistory(session);
  const completed = questions.filter((item) => item.answered);
  const adaptive = session.tutor_mode === "openai";
  const supports = adaptive
    ? (session.support_events?.filter((item) => item.counted_for_autonomy).length ?? null)
    : session.turns.filter((turn) => turn.kind === "hint").length;
  const requestedHints = adaptive
    ? (session.support_events?.filter((item) => item.origin === "requested").length ?? null)
    : supports;
  const current = questions.at(-1);
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value === "journey" ? "journey" : "assignment")}
      className="flex h-full min-h-0 flex-col"
    >
      {session.assignment.items && session.assignment.items.length > 1 && onSelectItem && (
        <div className="shrink-0 border-b px-4 py-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Câu đang học
            <select
              aria-label="Câu đang học"
              className="mt-1 block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
              value={session.assignment.active_item_id ?? session.assignment.items[0]?.id}
              disabled={navigationBusy}
              onChange={(event) => onSelectItem(event.target.value)}
            >
              {session.assignment.items.map((item) => {
                const saved = sessions.find(
                  (entry) =>
                    entry.assignment_id === session.assignment_id &&
                    entry.assignment.active_item_id === item.id,
                );
                return (
                  <option key={item.id} value={item.id}>
                    {item.label} ·{" "}
                    {item.id === session.assignment.active_item_id
                      ? "Đang chọn"
                      : saved
                        ? sessionLabel(saved)
                        : "Chưa bắt đầu"}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      )}
      <div className="shrink-0 border-b px-4 py-2">
        <TabsList aria-label="Nội dung thông tin học tập" className="grid h-10 w-full grid-cols-2">
          <TabsTrigger
            value="assignment"
            className="h-full data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Đề bài
          </TabsTrigger>
          <TabsTrigger
            value="journey"
            className="h-full data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Hành trình
          </TabsTrigger>
        </TabsList>
      </div>
      <div
        ref={scroll}
        className="learning-panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <TabsContent value="assignment" className="m-0 p-5">
          <AssignmentPanel session={session} onViewAssignment={onViewAssignment} />
        </TabsContent>
        <TabsContent
          value="journey"
          className="m-0 space-y-6 p-5 text-sm [&>section:first-child]:border-0 [&>section:first-child]:pt-0"
        >
          {!session.done && (session.current_objective || current) && (
            <section className="border-t pt-5">
              <h3 className="font-semibold">Vấn đề đang khám phá</h3>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words leading-6 text-muted-foreground">
                {session.current_objective || current?.turn.text}
              </p>
              {current && (
                <Button
                  variant="link"
                  className="mt-1 h-9 px-0"
                  onClick={() => onJump(current.index)}
                >
                  Đến câu hỏi hiện tại <ChevronRight aria-hidden="true" />
                </Button>
              )}
            </section>
          )}
          <section className="border-t pt-5">
            <h3 className="font-semibold">Hành trình suy nghĩ</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Nhìn lại các câu hỏi em đã trả lời, theo thứ tự trong cuộc trò chuyện.
            </p>
            {completed.length ? (
              <ol className="mt-3 space-y-2">
                {completed.map(({ turn, index }) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-muted"
                      onClick={() => onJump(index)}
                    >
                      <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="line-clamp-2 break-words text-sm leading-6">
                          {turn.text}
                        </span>
                        {BLOOM.find((item) => item.level === turn.level) && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Câu hỏi về{" "}
                            {BLOOM.find(
                              (item) => item.level === turn.level,
                            )?.name.toLocaleLowerCase("vi")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Câu hỏi đã trả lời sẽ được ghi lại ở đây.
              </p>
            )}
            {answers.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer font-medium">
                  Suy nghĩ em đã ghi ({answers.length})
                </summary>
                <ol className="mt-2 space-y-2">
                  {answers.map(({ turn, index }, order) => (
                    <li key={index}>
                      <button
                        type="button"
                        className="w-full rounded-lg p-2 text-left hover:bg-muted"
                        onClick={() => onJump(index)}
                      >
                        <span className="text-xs text-muted-foreground">
                          Câu trả lời {order + 1}
                        </span>
                        <span className="mt-1 line-clamp-3 break-words leading-6">{turn.text}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
          <section className="border-t pt-5">
            <h3 className="font-semibold">Phiên học của em</h3>
            <dl className="mt-3 space-y-3 text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>Trạng thái</dt>
                <dd className="text-right font-medium text-foreground">
                  {session.submitted ? "Đã nộp" : session.done ? "Đang tổng hợp" : "Đang đối thoại"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="flex items-center gap-2">
                  <MessageSquare aria-hidden="true" className="size-4" />
                  Câu trả lời
                </dt>
                <dd className="font-medium tabular-nums text-foreground">{answers.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="flex items-center gap-2">
                  <Lightbulb aria-hidden="true" className="size-4" />
                  Lượt xin gợi ý
                </dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {requestedHints ?? "Chưa có dữ liệu"}
                </dd>
              </div>
              {adaptive && (
                <div className="flex justify-between gap-3">
                  <dt>Lượt hỗ trợ đã ghi nhận</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {supports ?? "Chưa có dữ liệu"}
                  </dd>
                </div>
              )}
            </dl>
            {session.assessment && (
              <TooltipProvider>
                <Tooltip>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1.5 text-muted-foreground"
                      >
                        Hệ số tự lực <Info aria-hidden="true" className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <span className="font-medium tabular-nums">
                      {session.assessment.autonomy.toLocaleString("vi-VN", {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  </div>
                  <TooltipContent
                    side="bottom"
                    className="max-w-64 bg-foreground text-sm leading-6 text-white"
                  >
                    Giá trị trong báo cáo do hệ thống đánh giá trả về, dựa trên số lượt hỗ trợ đã
                    ghi nhận. Câu hỏi thông thường không tính là gợi ý.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!adaptive && (
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Phiên kịch bản, chưa kết nối mô hình AI. Trả lời câu hỏi không đồng nghĩa đã đạt
                năng lực Bloom tương ứng.
              </p>
            )}
          </section>
        </TabsContent>
      </div>
    </Tabs>
  );
}
