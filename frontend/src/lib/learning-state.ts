import type { Session } from "./api";

export function sessionStage(session: Session) {
  return session.submitted ? "submitted" : session.done ? "essay" : "active";
}

export function sessionLabel(session: Session) {
  return session.submitted ? "Đã nộp" : session.done ? "Đang tổng hợp" : "Đang học";
}

export function assessmentLabel(session: Session) {
  if (!session.submitted) return "Chưa nộp bài";
  if (session.assessment?.status === "complete") return `${session.assessment.score}/100`;
  return session.assessment?.status === "insufficient_evidence"
    ? "Chưa đủ bằng chứng để tính điểm"
    : "Đã lưu bài viết";
}

export function taskLabel(type?: string) {
  return (
    (
      {
        reading: "Đọc hiểu",
        social: "Nghị luận xã hội",
        literary: "Nghị luận văn học",
        mixed: "Đề nhiều dạng bài",
      } as Record<string, string>
    )[type ?? ""] ?? "Đề tự học"
  );
}

export function learningDate(value: string) {
  return new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}
