import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api, authApi } from "@/lib/api";
import { routeTree } from "@/routeTree.gen";

afterEach(() => vi.restoreAllMocks());

it("shows a visible action for uploading images on the student assignment page", async () => {
  vi.spyOn(authApi, "session").mockResolvedValue({
    user: { id: "student-1", email: "student@example.com", display_name: "Student" },
    csrf_token: "test-csrf",
  });
  vi.spyOn(api, "assignments").mockResolvedValue([]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/de-bai"] }),
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const imageButton = await screen.findByRole("button", { name: "Chọn ảnh tài liệu" });
  const imageInput = screen.getByLabelText("Chọn ảnh tài liệu") as HTMLInputElement;
  const openPicker = vi.spyOn(imageInput, "click");
  expect(imageButton).toBeVisible();
  expect(imageInput).toHaveAttribute("multiple");
  expect(imageInput.accept).toContain(".png");
  fireEvent.click(imageButton);
  expect(openPicker).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Chọn PDF/Word/TXT" })).toBeVisible();
});

it("displays a numbered prose paragraph without OCR hard line breaks", async () => {
  vi.spyOn(authApi, "session").mockResolvedValue({
    user: { id: "student-1", email: "student@example.com", display_name: "Student" },
    csrf_token: "test-csrf",
  });
  vi.spyOn(api, "assignments").mockResolvedValue([]);
  vi.spyOn(api, "structure").mockResolvedValue({
    global_context: "", global_paragraphs: [], excluded: [], warnings: [],
    parts: [{
      id: "part-1", title: "I. ĐỌC HIỂU", context: "(1) Năm 1440, tại một xưởng cơ khí\nnhỏ ở Mainz.",
      source_pages: [], paragraphs: [{ id: "paragraph-1",
        text: "(1) Năm 1440, tại một xưởng cơ khí\nnhỏ ở Mainz.", source_pages: [] }],
      questions: [{ id: "question-1", label: "Câu 1", text: "Ai phát minh máy in?",
        stem: "Ai phát minh máy in?", context: "Năm 1440, Gutenberg phát minh máy in.",
        subquestions: [], ideas: [], source_pages: [], paragraphs: [] },
      { id: "question-2", label: "Câu 2", text: "Đọc bài thơ:\nNHỮNG CHIẾC LÁ\nChiều lạnh cóng",
        stem: "Đọc bài thơ:", task: "Đọc bài thơ:", materials: "NHỮNG CHIẾC LÁ\nChiều lạnh cóng",
        context: "Đọc bài thơ:\nNHỮNG CHIẾC LÁ\nChiều lạnh cóng",
        subquestions: [], ideas: [], source_pages: [], paragraphs: [] }],
    }],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree,
    history: createMemoryHistory({ initialEntries: ["/de-bai"] }), context: { queryClient } });
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);

  fireEvent.change(await screen.findByRole("textbox", { name: "Văn bản đề gốc" }),
    { target: { value: "I. ĐỌC HIỂU\n(1) Năm 1440, tại một xưởng cơ khí\nnhỏ ở Mainz.\nCâu 1. Ai phát minh máy in?" } });
  fireEvent.click(screen.getByRole("button", { name: "Tách phần và câu hỏi" }));
  fireEvent.click(await screen.findByText(/Đọc ngữ liệu chung của phần này/));
  expect(await screen.findByText("Đoạn 1")).toBeInTheDocument();
  const paragraph = await screen.findByText("Năm 1440, tại một xưởng cơ khí nhỏ ở Mainz.");
  expect(paragraph.textContent).not.toContain("\n");
  fireEvent.click(screen.getByRole("button", { name: /^Câu 2/ }));
  expect(screen.getByText("01 · Yêu cầu cần làm")).toBeInTheDocument();
  expect(screen.getByText("02 · Ngữ liệu đi kèm")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Nội dung ngữ liệu riêng"))
    .getByText(/NHỮNG CHIẾC LÁ/).textContent).toContain("\nChiều lạnh cóng");
});
