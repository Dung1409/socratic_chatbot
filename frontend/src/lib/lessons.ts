import type { Assignment, DocumentHistoryItem, Session } from "./api";

export type LessonFilter = "all" | "review" | "new" | "active" | "submitted";
export const lessonFilters = [
  ["all", "Tất cả"],
  ["review", "Cần kiểm tra"],
  ["new", "Chưa bắt đầu"],
  ["active", "Đang học"],
  ["submitted", "Đã nộp"],
] as const;

export function lessonSessions(assignment: Assignment, sessions: Session[]) {
  const latest = new Map<string, Session>();
  for (const session of sessions
    .filter((entry) => entry.assignment_id === assignment.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const key = session.assignment.active_item_id ?? "legacy";
    if (!latest.has(key)) latest.set(key, session);
  }
  return [...latest.values()];
}

export function lessonState(assignment: Assignment, sessions: Session[]) {
  const saved = lessonSessions(assignment, sessions);
  const total = assignment.items?.length || 1;
  const submitted = saved.filter((session) => session.submitted).length;
  const state: LessonFilter = !saved.length ? "new" : submitted >= total ? "submitted" : "active";
  const next = assignment.items?.find(
    (item) => !saved.some((session) => session.assignment.active_item_id === item.id),
  );
  const resume = saved.find((session) => !session.submitted) ?? (!next ? saved[0] : undefined);
  const search = resume
    ? { session: resume.id }
    : { assignment: assignment.id, ...(next ? { item: next.id } : {}) };
  return { saved, total, submitted, state, resume, search };
}

// A source attached to a saved lesson belongs inside that lesson, never a second
// row. This also hides the source generated internally for a pasted quick task.
export function unassignedDocuments(assignments: Assignment[], documents: DocumentHistoryItem[]) {
  const attached = new Set(assignments.map((assignment) => assignment.document_id).filter(Boolean));
  return documents.filter((document) => !attached.has(document.document_id));
}
