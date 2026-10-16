import { Button } from "@/components/ui/button";

export function ApiState({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: Error | null;
  retry?: () => unknown;
}) {
  return (
    <div className="p-6 lg:p-10" role={error ? "alert" : "status"}>
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
        {error?.message || (loading ? "Đang tải dữ liệu…" : "Chưa có dữ liệu.")}
      </p>
      {error && retry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            void retry();
          }}
        >
          Thử lại
        </Button>
      )}
    </div>
  );
}
