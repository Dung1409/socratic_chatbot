import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssessmentReport } from "@/components/AssessmentReport";
import type { Assessment } from "@/lib/api";

afterEach(cleanup);

function report(): Assessment {
  return {
    status: "complete",
    coverage: 3,
    bloom: 90,
    hint_count: 2,
    autonomy: 0.8444444444444444,
    score: 76,
    raw_score: "76.0",
    classification: "Tư duy Khá",
    scoring_version: "bloom-autonomy-2.0",
    dimensions: [
      {
        key: "basic",
        name: "Cơ bản",
        maximum: 30,
        points: 30,
        observed: true,
        rationale: "Giải thích bằng lời riêng",
        evidence: [{ source_id: "answer-1", quote: "Quan điểm của em có căn cứ." }],
      },
    ],
    strengths: ["Giải thích rõ"],
    next_steps: ["Kiểm tra phản đề"],
  };
}

describe("final assessment report", () => {
  it("shows Bloom, autonomy and final score separately with student evidence", () => {
    render(<AssessmentReport report={report()} />);
    expect(screen.getByText("90 / 100")).toBeInTheDocument();
    expect(screen.getByText("76 / 100")).toBeInTheDocument();
    expect(screen.getByText("0,8444")).toBeInTheDocument();
    expect(screen.getByText(/A = 0,3 \+ 0,7 \/ \(1 \+ N\/7\)/)).toBeInTheDocument();
    expect(screen.getByText("Tư duy Khá")).toBeInTheDocument();
    expect(screen.getByText("“Quan điểm của em có căn cứ.”")).toBeInTheDocument();
  });

  it("preserves historical scores and shows their original formula", () => {
    render(
      <AssessmentReport
        report={{
          ...report(),
          scoring_version: "bloom-autonomy-1.0",
          autonomy: 0.8,
          score: 72,
          raw_score: "72.0",
        }}
      />,
    );
    expect(screen.getByText("72 / 100")).toBeInTheDocument();
    expect(screen.getByText("0,8")).toBeInTheDocument();
    expect(screen.getByText(/A = max\(0,3; 1 − 0,1 × N\)/)).toBeInTheDocument();
    expect(screen.queryByText(/A = 0,3 \+ 0,7/)).not.toBeInTheDocument();
  });

  it("does not invent a formula for reports with an unknown version", () => {
    render(<AssessmentReport report={{ ...report(), scoring_version: "future-version" }} />);
    expect(screen.getByText(/A theo báo cáo đã lưu/)).toBeInTheDocument();
    expect(screen.getByText("76 / 100")).toBeInTheDocument();
  });

  it("does not turn insufficient evidence into zero or classify the student", () => {
    const partial = {
      ...report(),
      status: "insufficient_evidence" as const,
      coverage: 1,
      bloom: null,
      score: null,
      raw_score: null,
      classification: null,
    };
    render(<AssessmentReport report={partial} />);
    expect(screen.getByText(/Chưa đủ dữ liệu để tính điểm tổng/)).toBeInTheDocument();
    expect(screen.getAllByText("— / 100")).toHaveLength(1);
    expect(screen.queryByText("Cần Rèn Luyện")).not.toBeInTheDocument();
  });

  it("keeps backend classification when displayed score rounds to a boundary", () => {
    render(<AssessmentReport report={{ ...report(), score: 80, raw_score: "79.99" }} />);
    expect(screen.getByText("80 / 100")).toBeInTheDocument();
    expect(screen.getByText("Tư duy Khá")).toBeInTheDocument();
    expect(screen.queryByText("Tư duy Xuất sắc")).not.toBeInTheDocument();
  });
});
