import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type Session } from "@/lib/api";
import { useSessionDraft } from "@/hooks/use-session-draft";

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueriesData: vi.fn() }) }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "learner" } }) }));
const session = {
  id: "session-a",
  essay: "",
  version: 0,
  submitted: false,
  turns: [],
} as unknown as Session;
const remote = {
  answer: "Bản đang viết trên tài khoản",
  essay: "Bài tổng hợp",
  revision: 2,
  updated_at: null,
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(api, "sessionDraft").mockResolvedValue(remote);
  vi.spyOn(api, "saveSessionDraft").mockImplementation(async (_id, body) => ({
    ...body,
    revision: body.revision + 1,
    updated_at: null,
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("restores server drafts and saves changes without posting an answer", async () => {
  const { result } = renderHook(() => useSessionDraft(session));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.draft).toBe(remote.answer);
  act(() => result.current.setDraft("Suy nghĩ mới chưa gửi"));
  await act(async () => {
    expect(await result.current.save()).toBe(true);
  });
  expect(api.saveSessionDraft).toHaveBeenLastCalledWith(
    "session-a",
    expect.objectContaining({ answer: "Suy nghĩ mới chưa gửi", revision: 2, expected_version: 0 }),
  );
  expect(localStorage.getItem("socratic:learner:saved-draft:session-a")).toBeNull();
});

it("keeps a durable local backup when saving fails", async () => {
  vi.mocked(api.saveSessionDraft).mockRejectedValue(new ApiError("Mất kết nối", 0));
  const { result } = renderHook(() => useSessionDraft(session));
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.setEssay("Bài đang viết khi mất mạng"));
  await act(async () => {
    expect(await result.current.save()).toBe(false);
  });
  expect(JSON.parse(localStorage.getItem("socratic:learner:saved-draft:session-a")!).essay).toBe(
    "Bài đang viết khi mất mạng",
  );
});

it("does not silently overwrite a newer draft on another device", async () => {
  localStorage.setItem(
    "socratic:learner:saved-draft:session-a",
    JSON.stringify({ answer: "Bản cục bộ", essay: "", revision: 1, studentTurns: 0 }),
  );
  const { result } = renderHook(() => useSessionDraft(session));
  await waitFor(() => expect(result.current.hasConflict).toBe(true));
  expect(result.current.draft).toBe("Bản cục bộ");
  expect(await result.current.save()).toBe(false);
  expect(api.saveSessionDraft).not.toHaveBeenCalled();
});
