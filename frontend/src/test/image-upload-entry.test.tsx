import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { api, authApi } from "@/lib/api";
import { routeTree } from "@/routeTree.gen";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, "sessions").mockResolvedValue([]);
  vi.spyOn(api, "documents").mockResolvedValue([]);
  vi.spyOn(api, "saveTextDocument").mockResolvedValue({ document_id: "manual-document" } as Awaited<
    ReturnType<typeof api.saveTextDocument>
  >);
  vi.spyOn(api, "saveDocumentReview").mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.saveDocumentReview>>,
  );
});

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

  fireEvent.keyDown(await screen.findByRole("tab", { name: "Tải tài liệu" }), {
    key: "Enter",
  });
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

it("shows extracted question images while reviewing a newly uploaded exam", async () => {
  vi.spyOn(authApi, "session").mockResolvedValue({
    user: { id: "student-1", email: "student@example.com", display_name: "Student" },
    csrf_token: "test-csrf",
  });
  vi.spyOn(api, "assignments").mockResolvedValue([]);
  vi.spyOn(api, "extract").mockResolvedValue({
    document_id: "math-exam",
    filename: "de-toan.pdf",
    title: "Đề Toán kiểm tra",
    text: "Câu 1. Tính giá trị của biểu thức đã cho.",
    subject: "Toán",
    pages: [{
      number: 1,
      label: "Trang 1",
      text: "",
      method: "image",
      confidence: null,
      visual_sources: [{ source_id: "page-1", source: "pdf_page" }],
    }],
    structure: {
      global_context: "",
      global_paragraphs: [],
      excluded: [],
      warnings: [],
      visuals: [{
        id: "page-1-question-1",
        page: 1,
        source_id: "page-1",
        source: "pdf_page",
        kind: "question",
        bbox: [0, 0, 1000, 500],
        orientation: "horizontal",
        description: "Ảnh câu 1",
        uncertain: false,
        link_status: "proposed",
      }],
      parts: [{
        id: "part-1",
        title: "Đề Toán",
        context: "",
        source_pages: [1],
        paragraphs: [],
        questions: [{
          id: "question-1",
          label: "Câu 1",
          text: "Tính giá trị của biểu thức đã cho.",
          stem: "Tính giá trị của biểu thức đã cho.",
          context: "Tính giá trị của biểu thức đã cho.",
          subquestions: [],
          ideas: [],
          source_pages: [1],
          paragraphs: [],
          visual_refs: ["page-1-question-1"],
        }],
      }, {
        id: "part-2",
        title: "Phần II",
        context: "",
        source_pages: [1],
        paragraphs: [],
        questions: [{
          id: "question-2",
          label: "Câu 2",
          text: "Tìm nghiệm của phương trình.",
          stem: "Tìm nghiệm của phương trình.",
          context: "Tìm nghiệm của phương trình.",
          subquestions: [],
          ideas: [],
          source_pages: [1],
          paragraphs: [],
        }],
      }],
    },
  });
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

  fireEvent.keyDown(await screen.findByRole("tab", { name: "Tải tài liệu" }), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Chọn tệp PDF, Word hoặc văn bản"), {
    target: { files: [new File(["pdf"], "de-toan.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Đã kiểm tra, chọn câu" }));
  const collapsedPart = screen.getByRole("button", { name: "Mở phần Phần II" });
  expect(collapsedPart).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(collapsedPart);
  expect(screen.getByRole("button", { name: "Thu gọn phần Phần II" })).toHaveAttribute(
    "aria-expanded", "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Thu gọn phần Phần II" }));
  expect(await screen.findByRole("img", { name: "Ảnh câu 1" })).toHaveAttribute(
    "src",
    "/api/documents/math-exam/visuals/page-1-question-1/image",
  );
  fireEvent.click(screen.getByRole("button", { name: "Quay lại kiểm tra nội dung" }));
  fireEvent.click(await screen.findByRole("button", { name: "Xem và sửa bản tách" }));
  expect(screen.getByRole("button", { name: "Mở phần Phần II" })).toHaveAttribute(
    "aria-expanded", "false",
  );

  expect(await screen.findByRole("img", { name: "Ảnh câu 1" })).toHaveAttribute(
    "src",
    "/api/documents/math-exam/visuals/page-1-question-1/image",
  );
});

it("displays a numbered prose paragraph without OCR hard line breaks", async () => {
  vi.spyOn(authApi, "session").mockResolvedValue({
    user: { id: "student-1", email: "student@example.com", display_name: "Student" },
    csrf_token: "test-csrf",
  });
  vi.spyOn(api, "assignments").mockResolvedValue([]);
  vi.spyOn(api, "structure").mockResolvedValue({
    global_context: "",
    global_paragraphs: [],
    excluded: [],
    warnings: [],
    parts: [
      {
        id: "part-1",
        title: "I. ĐỌC HIỂU",
        context: "(1) Năm 1440, tại một xưởng cơ khí\nnhỏ ở Mainz.",
        source_pages: [],
        paragraphs: [
          {
            id: "paragraph-1",
            text: "(1) Năm 1440, tại một xưởng cơ khí\nnhỏ ở Mainz.",
            source_pages: [],
          },
        ],
        questions: [
          {
            id: "question-1",
            label: "Câu 1",
            text: "Ai phát minh máy in?",
            stem: "Ai phát minh máy in?",
            context: "Năm 1440, Gutenberg phát minh máy in.",
            subquestions: [],
            ideas: [],
            source_pages: [],
            paragraphs: [],
          },
          {
            id: "question-2",
            label: "Câu 2",
            text: "Đọc bài thơ:\nNHỮNG CHIẾC LÁ\nChiều lạnh cóng",
            stem: "Đọc bài thơ:",
            task: "Đọc bài thơ:",
            materials: "NHỮNG CHIẾC LÁ\nChiều lạnh cóng",
            context: "Đọc bài thơ:\nNHỮNG CHIẾC LÁ\nChiều lạnh cóng",
            subquestions: [],
            ideas: [],
            source_pages: [],
            paragraphs: [],
          },
        ],
      },
    ],
  });
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

  fireEvent.keyDown(await screen.findByRole("tab", { name: "Tải tài liệu" }), {
    key: "Enter",
  });
  vi.spyOn(api, "extract").mockResolvedValue({
    filename: "de-doc-hieu.txt",
    title: "Đề đọc hiểu",
    text: "Nội dung tài liệu được trích xuất.",
    structure: await api.structure("Nội dung kiểm thử."),
  });
  fireEvent.change(screen.getByLabelText("Chọn tệp PDF, Word hoặc văn bản"), {
    target: { files: [new File(["test"], "de-doc-hieu.txt", { type: "text/plain" })] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Đã kiểm tra, chọn câu" }));
  fireEvent.click(await screen.findByText(/Đọc ngữ liệu chung của phần này/));
  expect(await screen.findByText("Đoạn 1")).toBeInTheDocument();
  const paragraph = await screen.findByText("Năm 1440, tại một xưởng cơ khí nhỏ ở Mainz.");
  expect(paragraph.textContent).not.toContain("\n");
  fireEvent.click(screen.getByRole("button", { name: /^Câu 2/ }));
  expect(screen.getByText("01 · Yêu cầu cần làm")).toBeInTheDocument();
  expect(screen.getByText("02 · Ngữ liệu đi kèm")).toBeInTheDocument();
  expect(
    within(screen.getByLabelText("Nội dung ngữ liệu riêng")).getByText(/NHỮNG CHIẾC LÁ/)
      .textContent,
  ).toContain("\nChiều lạnh cóng");
});
