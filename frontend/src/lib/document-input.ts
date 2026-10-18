import type { ContentBlock, DocumentStructure, InputMode, SourcePage } from "@/lib/api";

export type InputDraft = {
  title: string;
  text: string;
  structure: DocumentStructure | null;
  selectedIds: string[];
  documentId?: string | undefined;
  file: string | null;
  pages: SourcePage[] | null;
  warnings: string[];
  blocks: ContentBlock[];
  mode: InputMode;
  pendingId?: string | undefined;
};

export function readInputDraft(key: string): Partial<InputDraft> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<InputDraft>)
      : {};
  } catch {
    return {};
  }
}

export function writeInputDraft(key: string, draft: InputDraft) {
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* The server copy remains available for uploaded documents. */
  }
}

export function isSourceOnly(question: { source_only?: boolean; label: string }) {
  return question.source_only ?? question.label === "Nội dung chưa tách được";
}
