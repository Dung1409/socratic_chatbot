import { BookOpen, GraduationCap, Info, Lightbulb } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BLOOM } from "@/lib/data";
import { type Session } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";

const hintNames = ["Định hướng", "Câu hỏi phụ", "Khung trả lời"];
const strategies: Record<string, string> = {
  clarification: "Làm rõ",
  assumptions: "Xem xét giả định",
  evidence: "Lý do và bằng chứng",
  perspectives: "Góc nhìn khác",
  consequences: "Hệ quả",
  question: "Xem xét câu hỏi",
};

export function LearningBloomBadge({ level }: { level: number }) {
  const bloom = BLOOM.find((item) => item.level === level);
  if (!bloom) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-7 items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-slate-600"
          aria-label={`Bloom ${level}: ${bloom.name}. Xem giải thích`}
        >
          {bloom.name}
          <Info aria-hidden="true" className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 bg-foreground text-sm leading-6 text-white" side="bottom">
        <p className="font-medium">
          Bloom {level} · {bloom.name}
        </p>
        <p>{bloom.desc}. Đây là mục tiêu của câu hỏi, chưa phải đánh giá năng lực của em.</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function SessionConversation({ session }: { session: Session }) {
  const adaptive = session.tutor_mode === "openai";
  return (
    <TooltipProvider delayDuration={200}>
      <ol
        className="space-y-6"
        aria-label="Các lượt hội thoại"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {session.turns.map((turn, index) => {
          const hint = turn.kind === "hint";
          const source = turn.response_kind === "source_request";
          const reason = hint
            ? session.support_events?.find((event) => event.turn_id === turn.id)
            : undefined;
          const label = hint
            ? adaptive
              ? "Gợi ý bổ sung"
              : `Gợi ý mức ${turn.tier} · ${hintNames[turn.tier - 1] ?? "Hỗ trợ"}`
            : source
              ? "Bổ sung ngữ liệu"
              : turn.response_kind === "ready"
                ? "Tổng hợp suy nghĩ"
                : "Câu hỏi gợi mở";
          return (
            <li
              key={turn.id ?? index}
              id={`learning-turn-${index}`}
              className="scroll-mt-5"
              data-turn-kind={turn.kind}
            >
              {turn.kind === "student" ? (
                <article
                  className="ml-auto w-fit max-w-[90%] sm:max-w-[85%]"
                  aria-label={
                    turn.purpose === "clarification"
                      ? "Chỗ em đang vướng"
                      : turn.purpose === "source"
                        ? "Ngữ liệu em bổ sung"
                        : "Câu trả lời của em"
                  }
                >
                  <p className="mb-1.5 text-right text-xs text-muted-foreground">
                    {turn.purpose === "clarification"
                      ? "Chỗ em đang vướng"
                      : turn.purpose === "source"
                        ? "Ngữ liệu em bổ sung"
                        : "Câu trả lời của em"}
                  </p>
                  <div className="rounded-xl bg-primary-soft px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-sm leading-7">{turn.text}</p>
                  </div>
                  <span className="sr-only">Đã lưu câu trả lời vào phiên tự học của bạn.</span>
                </article>
              ) : (
                <article
                  className={
                    hint
                      ? "ml-0 w-fit max-w-full rounded-xl bg-muted/80 px-4 py-3 sm:ml-11 sm:max-w-[calc(100%-44px)]"
                      : "flex min-w-0 items-start gap-3"
                  }
                  aria-label={label}
                >
                  {!hint && (
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                      <GraduationCap aria-hidden="true" className="size-[18px]" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      {hint ? (
                        <Lightbulb aria-hidden="true" className="size-4 text-muted-foreground" />
                      ) : (
                        <span className="text-sm font-semibold">{APP_NAME}</span>
                      )}
                      <span className="text-xs font-medium text-muted-foreground">{label}</span>
                      {turn.kind === "tutor" &&
                        (!adaptive || turn.response_kind === "question") && (
                          <LearningBloomBadge level={turn.level} />
                        )}
                    </div>
                    <p
                      className={
                        hint
                          ? "whitespace-pre-wrap break-words text-sm leading-7"
                          : "whitespace-pre-wrap break-words text-base leading-7"
                      }
                    >
                      {turn.text}
                    </p>
                    {(reason || turn.objective || turn.strategy || source) && (
                      <details className="mt-2 text-xs leading-6 text-muted-foreground">
                        <summary className="w-fit cursor-pointer font-medium">
                          {hint ? "Chi tiết gợi ý" : "Về lượt trao đổi này"}
                        </summary>
                        {reason && (
                          <>
                            <p>{reason.reason}</p>
                            <p>
                              {reason.counted_for_autonomy
                                ? "Lượt hỗ trợ này được ghi nhận trong đánh giá cuối phiên."
                                : "Lượt này không tính vào số hỗ trợ khi đánh giá."}
                            </p>
                          </>
                        )}
                        {source && (
                          <p className="flex items-start gap-1.5">
                            <BookOpen aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
                            Trợ lý đang cần thêm ngữ liệu. Yêu cầu bổ sung ngữ liệu không phải lượt
                            gợi ý.
                          </p>
                        )}
                        {turn.objective && <p>Mục tiêu: {turn.objective}</p>}
                        {turn.strategy && strategies[turn.strategy] && (
                          <p>Cách đặt câu hỏi: {strategies[turn.strategy]}</p>
                        )}
                      </details>
                    )}
                  </div>
                </article>
              )}
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
