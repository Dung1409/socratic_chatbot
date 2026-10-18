import { expect, it } from "vitest";
import type { Assignment, DocumentHistoryItem, Session } from "@/lib/api";
import { lessonState, unassignedDocuments } from "@/lib/lessons";

const assignment = {
  id: "lesson",
  document_id: "attached",
  items: [{ id: "q1" }, { id: "q2" }],
} as Assignment;
function saved(id: string, item: string, submitted: boolean, updated_at = "2026-10-18T10:00:00Z") {
  return {
    id,
    assignment_id: "lesson",
    assignment: { active_item_id: item },
    submitted,
    updated_at,
  } as Session;
}

it("keeps a multi-question lesson active until all its questions are submitted", () => {
  expect(lessonState(assignment, []).state).toBe("new");
  const partial = lessonState(assignment, [saved("s1", "q1", true)]);
  expect(partial.state).toBe("active");
  expect(partial.submitted).toBe(1);
  expect(partial.search).toEqual({ assignment: "lesson", item: "q2" });
  expect(lessonState(assignment, [saved("s1", "q1", true), saved("s2", "q2", true)]).state).toBe(
    "submitted",
  );
});

it("resumes the exact unfinished question and counts a repeated session for one question once", () => {
  const result = lessonState(assignment, [
    saved("old", "q2", true, "2026-10-17T10:00:00Z"),
    saved("current", "q2", false),
    saved("s1", "q1", true),
  ]);
  expect(result.saved).toHaveLength(2);
  expect(result.state).toBe("active");
  expect(result.search).toEqual({ session: "current" });
});

it("does not list the attached or internally generated document again as another lesson", () => {
  const docs = [
    { document_id: "attached" },
    { document_id: "pending-upload" },
  ] as DocumentHistoryItem[];
  expect(unassignedDocuments([assignment], docs)).toEqual([{ document_id: "pending-upload" }]);
});
