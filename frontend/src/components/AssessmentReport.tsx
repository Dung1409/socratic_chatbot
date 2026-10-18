import type { Assessment } from "@/lib/api";

const number = (value: number | null, maximumFractionDigits = 1) =>
  value === null ? "—" : value.toLocaleString("vi-VN", { maximumFractionDigits });

export function AssessmentReport({ report }: { report: Assessment }) {
  const autonomyFormula =
    report.scoring_version === "bloom-autonomy-2.0"
      ? "A = 0,3 + 0,7 / (1 + N/7)"
      : report.scoring_version === "bloom-autonomy-1.0"
        ? "A = max(0,3; 1 − 0,1 × N)"
        : "A theo báo cáo đã lưu";
  return (
    <section
      className="rounded-xl border bg-card p-5 sm:p-6 space-y-6"
      aria-label="Báo cáo tư duy cuối phiên"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
          Kết quả phiên học
        </p>
        <h2 className="mt-1 text-xl font-semibold">Báo cáo tư duy cuối phiên</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {report.status === "complete"
            ? "Kết quả thể hiện trong phiên này, dựa trên câu trả lời và bài tổng hợp của em."
            : `Chưa đủ dữ liệu để tính điểm tổng và xếp loại. Đã quan sát ${report.coverage}/3 tầng; tầng chưa quan sát không được tính là 0.`}
        </p>
      </div>
      <p className="text-2xl font-semibold text-primary">
        {report.score === null
          ? "Chưa đủ bằng chứng để tính điểm"
          : `${number(report.score)} / 100`}
      </p>
      {report.classification && (
        <p className="rounded-lg bg-primary-soft p-3 font-semibold text-primary">
          {report.classification}
        </p>
      )}
      {report.strengths.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Điểm mạnh</h3>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
            {report.strengths.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Luyện tập tiếp theo</h3>
        <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
          {report.next_steps.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-4">
        {report.dimensions.map((dimension) => (
          <div key={dimension.key} className="border-t pt-4">
            <div className="flex justify-between gap-3 text-sm font-semibold">
              <h3>{dimension.name}</h3>
              <span className="shrink-0">
                {dimension.observed
                  ? `${number(dimension.points)} / ${dimension.maximum}`
                  : "Chưa đủ dữ liệu"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">{dimension.rationale}</p>
            {dimension.evidence.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-primary">Xem bằng chứng từ bài làm</summary>
                {dimension.evidence.map((evidence, i) => (
                  <blockquote
                    key={i}
                    className="mt-2 border-l-2 pl-3 text-muted-foreground whitespace-pre-wrap break-words"
                  >
                    “{evidence.quote}”
                    <span className="block mt-1 text-xs">
                      {evidence.source_id === "submission"
                        ? "Bài tổng hợp cuối phiên"
                        : "Câu trả lời trong đối thoại"}
                    </span>
                  </blockquote>
                ))}
              </details>
            )}
          </div>
        ))}
      </div>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Cách tính điểm và mức hỗ trợ
        </summary>
        <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              ["Điểm Bloom B", `${number(report.bloom)} / 100`],
              ["Lượt hỗ trợ N", String(report.hint_count)],
              ["Hệ số tự lực A", number(report.autonomy, 4)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            B = Cơ bản + Vận dụng + Bậc cao · {autonomyFormula} · S = B × A. Điểm hiển thị được làm
            tròn một chữ số thập phân, hệ số A hiển thị tối đa bốn chữ số thập phân; xếp loại dùng
            giá trị chưa làm tròn.
          </p>
        </div>
      </details>
    </section>
  );
}
