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
    autonomy: 0.8,
    score: 72,
    raw_score: "72.0",
    classification: "Tư duy Khá",
    scoring_version: "1",
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
    expect(screen.getByText("72 / 100")).toBeInTheDocument();
    expect(screen.getByText("0,8")).toBeInTheDocument();
    expect(screen.getByText("Tư duy Khá")).toBeInTheDocument();
    expect(screen.getByText("“Quan điểm của em có căn cứ.”")).toBeInTheDocument();
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
    expect(screen.getAllByText("— / 100")).toHaveLength(2);
    expect(screen.queryByText("Cần Rèn Luyện")).not.toBeInTheDocument();
  });

  it("keeps backend classification when displayed score rounds to a boundary", () => {
    render(<AssessmentReport report={{ ...report(), score: 80, raw_score: "79.99" }} />);
    expect(screen.getByText("80 / 100")).toBeInTheDocument();
    expect(screen.getByText("Tư duy Khá")).toBeInTheDocument();
    expect(screen.queryByText("Tư duy Xuất sắc")).not.toBeInTheDocument();
  });
});
