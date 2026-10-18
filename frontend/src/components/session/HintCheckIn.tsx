import { Button } from "@/components/ui/button";
import type { HintDifficulty } from "@/lib/api";

export function HintCheckIn({
  question,
  disabled,
  onSelect,
}: {
  question: string;
  disabled: boolean;
  onSelect: (difficulty: HintDifficulty) => void;
}) {
  return (
    <section aria-label="Chọn chỗ đang vướng" className="mb-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-medium">Em đang vướng ở đâu?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Mình vẫn tập trung vào câu hỏi: {question}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Em có thể thử trả lời bên dưới hoặc chọn chỗ vướng để nhận hỗ trợ phù hợp hơn. Việc chọn chỗ
        vướng không tính là một lượt gợi ý; gợi ý mới sau đó vẫn được ghi nhận.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            ["understanding", "Chưa hiểu câu hỏi"],
            ["ideas", "Chưa nghĩ ra ý"],
            ["expression", "Chưa biết diễn đạt"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}
