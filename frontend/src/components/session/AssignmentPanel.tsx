import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Session } from "@/lib/api";
import { taskLabel } from "@/lib/learning-state";
import { readableLessonTitle } from "@/lib/lessons";
import { cn } from "@/lib/utils";
import { AssignmentQuestionImages } from "./AssignmentQuestionImages";

export function AssignmentPanel({
  session,
  onViewAssignment,
}: {
  session: Session;
  onViewAssignment: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const prompt = useRef<HTMLParagraphElement>(null);
  const promptId = useId();
  const { assignment, plan } = session;
  const taskType = plan?.task_type ?? assignment.task_type;
  const questionImages = assignment.document_id ? (assignment.visual_refs ?? []) : [];
  const imageOnlyQuestion =
    questionImages.length > 0 &&
    assignment.prompt.trim() === "Read the question directly in the attached image.";

  useLayoutEffect(() => {
    const element = prompt.current;
    if (!element) return;
    const measure = () => {
      if (!element.clientWidth) return;
      const collapsedHeight = parseFloat(getComputedStyle(element).lineHeight) * 10;
      setOverflows(element.scrollHeight > collapsedHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [assignment.prompt]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-muted-foreground">Đề bài của em</h3>
        <p className="mt-2 break-words text-lg font-semibold leading-7">
          {readableLessonTitle(assignment.title)}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {taskLabel(taskType)}
          {assignment.grade ? ` · Lớp ${assignment.grade}` : ""}
        </p>
        <Button
          variant="outline"
          className="mt-3 h-9 gap-2 text-sm"
          onClick={onViewAssignment}
        >
          <Maximize2 aria-hidden="true" />
          Xem đề bài
        </Button>
        {imageOnlyQuestion && (
          <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-6">
            Nội dung câu hỏi nằm trong ảnh bên dưới. Chọn ảnh để xem kích thước đầy đủ.
          </p>
        )}
        {!imageOnlyQuestion && assignment.prompt.trim() && (
          <p
            ref={prompt}
            id={promptId}
            className={cn(
              "mt-4 whitespace-pre-wrap break-words text-base leading-7",
              !expanded && "line-clamp-[10]",
            )}
          >
            {assignment.prompt}
          </p>
        )}
        {overflows && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button
              variant="link"
              className="h-10 px-0"
              aria-expanded={expanded}
              aria-controls={promptId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Thu gọn đề bài" : "Xem đầy đủ"}
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          </div>
        )}
        <AssignmentQuestionImages
          documentId={assignment.document_id}
          visualIds={questionImages}
        />
      </section>
      {plan && (
        <details className="border-t pt-5">
          <summary className="cursor-pointer text-sm font-semibold leading-7">
            Mục tiêu học tập
          </summary>
          {plan.summary && (
            <p className="mt-3 break-words text-sm leading-7 text-muted-foreground">
              {plan.summary}
            </p>
          )}
          {plan.objectives.length > 0 && (
            <ul className="mt-3 list-disc space-y-3 pl-4 text-sm leading-7 text-muted-foreground">
              {plan.objectives.map((objective, index) => (
                <li key={index} className="break-words">
                  {objective}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {assignment.source_text && (
        <details className="border-t pt-5">
          <summary className="cursor-pointer text-sm font-semibold leading-7">
            Ngữ liệu / đoạn trích
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7">
            {assignment.source_text}
          </p>
        </details>
      )}
    </div>
  );
}
