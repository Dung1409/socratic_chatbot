import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, authApi, type Assignment, type DocumentHistoryItem } from "@/lib/api";
import { routeTree } from "@/routeTree.gen";

beforeEach(() => {
  vi.spyOn(authApi, "session").mockResolvedValue({
    user: { id: "learner", email: "test@example.com", display_name: "Người học" },
    csrf_token: "csrf",
  });
  vi.spyOn(api, "assignments").mockResolvedValue([
    {
      id: "lesson",
      title: "Bài học đã lưu",
      prompt: "Yêu cầu học đã được lưu",
      items: [{ id: "q1", label: "Câu 1", prompt: "Nêu ý chính" }],
      document_id: "attached",
    },
  ] as Assignment[]);
  vi.spyOn(api, "sessions").mockResolvedValue([]);
  vi.spyOn(api, "documents").mockResolvedValue([
    {
      document_id: "attached",
      title: "Bản nguồn của đề",
      filename: "de-le.txt",
      status: "needs_review",
    },
  ] as DocumentHistoryItem[]);
  vi.spyOn(api, "prepareSession");
  vi.spyOn(api, "start");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  render(<RouterProvider router={router} />);
  return router;
}

it("has three primary destinations and exactly one row for a lesson with its source", async () => {
  show("/");
  const list = await screen.findByRole("list", { name: "Danh sách bài học" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryByText("Bản nguồn của đề")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("navigation", { name: "Điều hướng chính" })).getAllByRole("link"),
  ).toHaveLength(3);
  expect(api.prepareSession).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

it("does not mount a library or document history in the creation screen", async () => {
  show("/de-bai?tab=quick");
  await screen.findByRole("heading", { name: "Thêm bài học" });
  expect(screen.queryByRole("list", { name: "Danh sách bài học" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Lịch sử tài liệu/)).not.toBeInTheDocument();
  expect(screen.queryByText("Bài học đã lưu")).not.toBeInTheDocument();
  expect(api.documents).not.toHaveBeenCalled();
});

it("opens only one lesson's result view without starting a conversation", async () => {
  show("/?lesson=lesson&view=results");
  await screen.findByRole("heading", { name: "Câu 1 chưa có phiếu kết quả" });
  expect(screen.queryByRole("navigation", { name: "Nội dung bài học" })).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Danh sách bài học" })).not.toBeInTheDocument();
  expect(api.prepareSession).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});
