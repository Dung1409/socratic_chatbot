import { describe, expect, it } from "vitest";
import {
  classifyTextLayout,
  filterSourceParagraphs,
  formatProse,
  sourceParagraphListClass,
} from "@/lib/text-layout";

describe("hiển thị ngữ liệu", () => {
  it("coi các dòng OCR dài là một đoạn văn xuôi", () => {
    const text =
      "Năm 1440, tại một xưởng cơ khí nhỏ nằm giữa thành phố Mainz nước Đức,\nJohannes Gutenberg phát minh ra máy in và tri thức được nhân bản rộng rãi.";
    expect(classifyTextLayout(text)).toBe("prose");
    expect(formatProse(text)).toBe(
      "Năm 1440, tại một xưởng cơ khí nhỏ nằm giữa thành phố Mainz nước Đức, Johannes Gutenberg phát minh ra máy in và tri thức được nhân bản rộng rãi.",
    );
  });

  it("giữ xuống dòng cho bài thơ", () => {
    const text = "Chiều lạnh cóng\nNhững chiếc lá rụng\nGió bay lao xao\nChú bé nhóm lửa";
    expect(classifyTextLayout(text)).toBe("poetry");
  });

  it("ưu tiên ngữ cảnh câu hỏi khi thơ có câu dài", () => {
    const text =
      "Chiều lạnh cóng, vườn cây vắng tanh, gió thôi bay lao xao, những chiếc lá rụng trên mặt cỏ";
    expect(classifyTextLayout(text, "Phân tích bài thơ sau")).toBe("poetry");
  });

  it("không tính dòng chỉ dẫn là đoạn ngữ liệu, kể cả với dữ liệu cũ", () => {
    const paragraphs = [
      { id: "intro", text: "Đọc văn bản:" },
      { id: "first", text: "(1) Đọc sách giúp mở rộng hiểu biết." },
      { id: "second", text: "(2) Tri thức lan rộng." },
    ];
    expect(filterSourceParagraphs(paragraphs).map((item) => item.id)).toEqual(["first", "second"]);
    expect(
      filterSourceParagraphs([
        { id: "mixed", text: "Quan sát biểu đồ sau:\n(1) Số liệu tăng đều." },
      ])[0]?.text,
    ).toBe("(1) Số liệu tăng đều.");
  });

  it("đoạn văn xuôi dùng toàn bộ chiều ngang khung đọc ở mọi breakpoint", () => {
    const className = sourceParagraphListClass("prose");
    expect(className).not.toContain("grid-cols-2");
    expect(className).toContain("flex-col");
  });
});
