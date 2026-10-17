import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Session } from "@/lib/api";

export function SessionRequestError({
  message,
  disabled,
  onRetry,
}: {
  message: string;
  disabled: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm"
    >
      <p
        className="line-clamp-2 min-w-0 flex-1 break-words leading-6 text-destructive"
        title={message}
      >
        {message}
      </p>
      <Button
        variant="outline"
        className="h-10 bg-card shadow-none"
        disabled={disabled}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" />
        Thử lại
      </Button>
    </div>
  );
}

export function SessionPendingRequest({
  pending,
  busy,
  onRetry,
  onCancel,
}: {
  pending: NonNullable<Session["pending_action"]>;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const processing = pending.status === "processing";
  return (
    <div role={processing ? "status" : "alert"} className="rounded-xl border bg-card p-4 text-sm">
      <p className="flex items-start gap-2 font-medium leading-6">
        {processing && (
          <Loader2 aria-hidden="true" className="mt-1 size-4 shrink-0 animate-spin text-primary" />
        )}
        {processing
          ? "Gia sư đang xử lý… Yêu cầu đã được lưu."
          : "Phản hồi chưa hoàn tất. Nội dung của em đã được giữ để thử lại."}
      </p>
      {pending.text && (
        <details className="mt-2 text-muted-foreground">
          <summary className="cursor-pointer text-xs leading-6">Xem nội dung đã giữ</summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-6">{pending.text}</p>
        </details>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!processing && (
          <Button className="learning-primary h-10 shadow-none" disabled={busy} onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Thử lại
          </Button>
        )}
        <Button
          className="h-10 bg-card shadow-none"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Hủy yêu cầu chưa hoàn tất
        </Button>
      </div>
    </div>
  );
}
