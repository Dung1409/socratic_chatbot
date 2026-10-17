import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowRight, Lightbulb, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  busy: boolean;
  mode?: "answer" | "essay";
  sendLabel?: string;
  onHint?: () => void;
  hintDisabled?: boolean;
  hintDescription?: string;
  hintBusy?: boolean;
  onFinish?: () => void;
  onContinue?: () => void;
  notice?: ReactNode;
};

export function SessionComposer({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  mode = "answer",
  sendLabel = "Gửi câu trả lời",
  onHint,
  hintDisabled,
  hintDescription,
  hintBusy,
  onFinish,
  onContinue,
  notice,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const essay = mode === "essay";
  const canSend = !disabled && value.trim().length >= (essay ? 20 : 1);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 96), 200)}px`;
  }, [value, mode]);

  return (
    <div
      className="learning-composer shrink-0 border-t bg-card px-4 pt-3 sm:px-6 sm:pt-4"
      aria-label={essay ? "Soạn bài làm cuối phiên" : "Soạn câu trả lời"}
    >
      <div className="learning-chat-content mx-auto w-full">
        {notice}
        <div className="learning-composer-labels mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label htmlFor="learning-answer" className="text-sm font-medium">
            {essay ? "Bài làm cuối phiên" : "Suy nghĩ của em"}
          </label>
          {onFinish && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              className="h-9 px-2 text-xs text-muted-foreground"
              onClick={onFinish}
            >
              Kết thúc đối thoại & tổng hợp <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="rounded-xl border bg-card p-1 focus-within:border-primary">
          <Textarea
            ref={input}
            id="learning-answer"
            value={value}
            disabled={disabled}
            maxLength={essay ? 50000 : 10000}
            placeholder={essay ? "Viết bài làm của em…" : "Viết suy nghĩ của em tại đây..."}
            aria-describedby="learning-composer-help"
            className="learning-composer-input min-h-24 max-h-[200px] resize-none rounded-lg border-0 px-3 py-2.5 leading-relaxed shadow-none focus-visible:ring-0"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
          <div
            className={
              essay
                ? "flex flex-col gap-2 px-2 pb-2 pt-1 sm:flex-row sm:items-center sm:justify-between"
                : "flex items-center justify-between gap-2 px-2 pb-2 pt-1"
            }
          >
            <div
              className={
                !onHint && !onContinue ? "hidden" : essay ? "order-2 sm:order-none" : undefined
              }
            >
              {onHint && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 gap-2 px-2.5 text-muted-foreground"
                  disabled={disabled || hintDisabled}
                  onClick={onHint}
                  title={hintDescription}
                  aria-describedby={hintDescription ? "learning-hint-help" : undefined}
                >
                  {hintBusy ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Lightbulb aria-hidden="true" />
                  )}
                  {hintDisabled ? "Đã dùng hết gợi ý" : "Xin gợi ý"}
                </Button>
              )}
              {onContinue && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full px-2 text-xs sm:w-auto sm:text-sm"
                  disabled={disabled}
                  onClick={onContinue}
                >
                  Tiếp tục đối thoại
                </Button>
              )}
              {hintDescription && (
                <span id="learning-hint-help" className="sr-only">
                  {hintDescription}
                </span>
              )}
            </div>
            <Button
              type="button"
              className={
                essay
                  ? "learning-primary h-11 w-full shrink-0 shadow-none sm:w-auto"
                  : "learning-primary h-11 shrink-0 shadow-none"
              }
              size={essay ? "default" : "icon"}
              disabled={!canSend}
              aria-label={sendLabel}
              title={essay ? undefined : "Gửi câu trả lời (Ctrl + Enter)"}
              onClick={onSend}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {essay && <span>{busy ? "Đang lưu…" : sendLabel}</span>}
            </Button>
          </div>
        </div>
        <div
          id="learning-composer-help"
          className="learning-composer-help mt-2 flex flex-wrap justify-between gap-1 text-xs leading-5 text-muted-foreground"
        >
          <span>
            {essay
              ? "Ít nhất 20 ký tự · Bản nháp được giữ trên trình duyệt này."
              : "Em có thể trả lời theo cách hiểu của mình."}
          </span>
          <span className="hidden sm:inline">Ctrl + Enter để gửi</span>
        </div>
      </div>
    </div>
  );
}
