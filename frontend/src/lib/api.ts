export type Assignment = {
  id: string;
  title: string;
  prompt: string;
  target: number;
  due: string;
  author: string;
  grade: string;
  excerpt: string;
  status: string;
  progress: number;
};
export type Criterion = { id: string; name: string; weight: number; desc: string };
export type Rubric = { version: number; criteria: Criterion[] };
export type Step = { level: number; q: string; hints: string[] };
export type Turn =
  | { kind: "tutor"; step: number; text: string; level: number }
  | { kind: "hint"; step: number; tier: number; text: string }
  | {
      kind: "student";
      step: number;
      text: string;
      level: number;
      quality: number | null;
      hints: number;
    };
export type Review = {
  id: string;
  session_id: string;
  scores: Record<string, number>;
  feedback: string;
  total: number;
  created_at: string;
  rubric_version: number;
};
export type Session = {
  id: string;
  assignment_id: string;
  assignment: Assignment;
  steps: Step[];
  step: number;
  hint_tier: number;
  done: boolean;
  submitted: boolean;
  essay: string;
  turns: Turn[];
  version: number;
  rubric: Rubric;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  student_name: string;
  student_id: string;
  class_name: string;
  tutor_mode: string;
  review: Review | null;
};
export type Dashboard = {
  sessions: number;
  answers: number;
  hints: number;
  hints_per_answer: number;
  submitted: number;
  pending: number;
  latest_session: Session | null;
  latest_review: Review | null;
};
export type Progress = {
  series: { week: string; score: number }[];
  bloom_profile: { skill: string; value: number }[];
  latest: Session | null;
  pending: number;
};
export type Student = {
  id: string;
  name: string;
  cls: string;
  sessions: number;
  bloom: number | null;
  score: number | null;
  trend: string;
  hints: number;
};
export type Overview = {
  students: Student[];
  sessions: number;
  pending: number;
  distribution: { b: string; n: number }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env["VITE_API_URL"] || ""}/api${path}`, {
      ...options,
      headers: {
        ...(options?.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiError("Không kết nối được backend. Kiểm tra FastAPI đang chạy ở cổng 8000.", 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((e: { msg: string }) => e.msg).join("; ")
          : `Yêu cầu thất bại (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export type SourcePage = { number: number; label: string; text: string; method: string; confidence: number | null };
export type SourceParagraph = { id: string; text: string; source_pages: number[] };
export type ParsedIdea = { id: string; label: string; text: string; context: string; source_pages: number[] };
export type ParsedQuestion = {
  id: string; label: string; text: string; stem: string; context: string;
  task?: string; materials?: string;
  points?: string | null; source_selection?: "full_source" | "cited_paragraphs" | "matched_phrase";
  subquestions: string[]; ideas: ParsedIdea[];
  source_pages: number[]; paragraphs: SourceParagraph[];
};
export type ParsedPart = {
  id: string; title: string; context: string; source_pages: number[];
  paragraphs: SourceParagraph[]; questions: ParsedQuestion[];
};
export type DocumentStructure = {
  global_context: string;
  global_paragraphs: SourceParagraph[];
  parts: ParsedPart[];
  excluded: { text: string; page: number | null; reason: string }[];
  warnings: string[];
};
type ExtractedDocument = {
  filename: string; title: string; text: string; structure?: DocumentStructure;
  pages?: SourcePage[]; warnings?: string[];
};
type PendingDocument = { document_id: string; job_id: string; status: string };
type DocumentStatus = PendingDocument & {
  filename: string;
  title: string;
  text: string | null;
  error: string | null;
  structure?: DocumentStructure | null;
  pages?: SourcePage[];
  extraction_warnings?: string[];
};

export const api = {
  assignments: () => request<Assignment[]>("/assignments"),
  createAssignment: (body: {
    title: string;
    prompt: string;
    target: number;
    due?: string;
    excerpt?: string;
  }) => post<Assignment>("/assignments", body),
  extract: async (file: File): Promise<ExtractedDocument> => {
    const data = new FormData();
    data.append("file", file);
    const result = await request<ExtractedDocument | PendingDocument>("/uploads/extract", {
      method: "POST",
      body: data,
    });
    if (!("document_id" in result)) return result;
    for (let attempt = 0; attempt < 240; attempt++) {
      const document = await request<DocumentStatus>(`/documents/${result.document_id}`);
      if (document.status === "needs_review" && document.text !== null) {
        return { filename: document.filename, title: document.title, text: document.text,
          ...(document.structure ? { structure: document.structure } : {}),
          ...(document.pages ? { pages: document.pages } : {}),
          ...(document.extraction_warnings ? { warnings: document.extraction_warnings } : {}) };
      }
      if (document.status === "failed") {
        throw new ApiError(document.error || "Không trích xuất được văn bản từ tệp.", 422);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new ApiError("Tệp vẫn đang được xử lý. Em có thể nhập đề trực tiếp trong lúc chờ.", 504);
  },
  structure: (text: string, pages?: SourcePage[]) =>
    post<DocumentStructure>("/uploads/structure", { text, ...(pages ? { pages } : {}) }),
  rubric: () => request<Rubric>("/rubric"),
  saveRubric: (criteria: Criterion[]) =>
    request<Rubric>("/rubric", { method: "PUT", body: JSON.stringify({ criteria }) }),
  dashboard: () => request<Dashboard>("/dashboard"),
  progress: () => request<Progress>("/progress"),
  overview: () => request<Overview>("/teacher/overview"),
  sessions: () => request<Session[]>("/sessions"),
  session: (id: string) => request<Session>(`/sessions/${id}`),
  start: (id: string) => post<Session>("/sessions", { assignment_id: id }),
  message: (session: Session, text: string, key: string) =>
    post<Session>(`/sessions/${session.id}/messages`, {
      text,
      expected_version: session.version,
      client_message_id: key,
    }),
  hint: (session: Session, key: string) =>
    post<Session>(`/sessions/${session.id}/hints`, {
      expected_version: session.version,
      client_message_id: key,
    }),
  submit: (session: Session, essay: string, key: string) =>
    post<Session>(`/sessions/${session.id}/submit`, {
      essay,
      expected_version: session.version,
      client_message_id: key,
    }),
  review: (id: string, scores: Record<string, number>, feedback: string) =>
    post<Session>(`/sessions/${id}/reviews`, { scores, feedback }),
};
