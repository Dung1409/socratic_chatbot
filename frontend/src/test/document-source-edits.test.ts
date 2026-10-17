import { describe, expect, it } from "vitest";
import type { DocumentStructure, ParsedQuestion } from "@/lib/api";
import { editQuestionTask, editSharedMaterials, editSharedParagraph } from "@/lib/document-source-edits";

const question = (id: string, materials?: string): ParsedQuestion => ({
  id, label: id, text: `Yêu cầu ${id}`, stem: `Yêu cầu ${id}`, task: `Yêu cầu ${id}`,
  context: `Yêu cầu ${id}\n\n${materials ?? "Ngữ liệu chung"}`, ...(materials ? { materials } : {}),
  subquestions: [], ideas: [], source_pages: [1], paragraphs: [],
});

const fixture = (): DocumentStructure => ({
  global_context: "", global_paragraphs: [], excluded: [], warnings: [],
  parts: [{ id: "part-1", title: "Đọc hiểu", context: "", source_pages: [1],
    paragraphs: [{ id: "p-1", text: "Ngữ liệu chung", source_pages: [1] }],
    questions: [question("q-1"), question("q-2")],
  }, { id: "part-2", title: "Viết", context: "", source_pages: [2], paragraphs: [],
    questions: [question("q-3", "Bài thơ chung"), question("q-4", "Bài thơ chung")],
  }],
});

describe("sửa bản tách", () => {
  it("cập nhật đoạn chung cho mọi câu dùng đoạn đó", () => {
    const edited = editSharedParagraph(fixture(), "p-1", "Ngữ liệu đã sửa");
    expect(edited.parts[0]!.questions.map((item) => item.context)).toEqual([
      "Yêu cầu q-1\n\nNgữ liệu đã sửa", "Yêu cầu q-2\n\nNgữ liệu đã sửa",
    ]);
    expect(edited.parts[0]!.paragraphs[0]!.text).toBe("Ngữ liệu đã sửa");
  });

  it("cập nhật ngữ liệu riêng trùng nhau ở các câu liên quan", () => {
    const edited = editSharedMaterials(fixture(), "q-3", "Bài thơ đã sửa");
    expect(edited.parts[1]!.questions.map((item) => item.materials)).toEqual(["Bài thơ đã sửa", "Bài thơ đã sửa"]);
    expect(edited.parts[1]!.questions.map((item) => item.context)).toEqual([
      "Yêu cầu q-3\n\nBài thơ đã sửa", "Yêu cầu q-4\n\nBài thơ đã sửa",
    ]);
  });

  it("chỉ sửa yêu cầu của câu được chọn", () => {
    const edited = editQuestionTask(fixture(), "q-1", "Yêu cầu mới");
    expect(edited.parts[0]!.questions[0]!.task).toBe("Yêu cầu mới");
    expect(edited.parts[0]!.questions[1]!.task).toBe("Yêu cầu q-2");
  });
});
