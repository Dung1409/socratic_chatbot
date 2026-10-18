export type TextLayout = "prose" | "poetry";

export function sourceParagraphListClass(layout: TextLayout): string {
  return layout === "poetry" ? "mt-4 flex flex-col gap-5" : "mt-4 flex flex-col gap-4";
}

export function formatProse(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitProseParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map(formatProse)
    .filter(Boolean);
}

export function isSourceInstruction(text: string): boolean {
  const folded = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .trim();
  return /^(?:DOC|QUAN SAT|XEM|NGHIEN CUU|THEO DOI|DUA VAO|CHO|THUC HIEN|TRA LOI)\s+.{1,90}(?:[:：]|\bSAU\b|\bDUOI DAY\b)\s*$/.test(
    folded,
  );
}

export function filterSourceParagraphs<T extends { text: string }>(paragraphs: T[]): T[] {
  return paragraphs.flatMap((paragraph) => {
    const lines = paragraph.text.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && isSourceInstruction(lines[0] ?? "")) lines.shift();
    const text = lines.join("\n").trim();
    return text ? [{ ...paragraph, text }] : [];
  });
}

export function classifyTextLayout(text: string, context = ""): TextLayout {
  if (/(bài thơ|đoạn thơ|khổ thơ|câu thơ|thể thơ)/i.test(context)) return "poetry";
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return "prose";
  const shortLines = lines.filter((line) => line.length <= 65).length;
  return shortLines / lines.length >= 0.75 ? "poetry" : "prose";
}
