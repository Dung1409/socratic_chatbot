export type Assignment = {
  id: string;
  title: string;
  prompt: string;
  target: number;
  document_id: string | null;
  source: string;
  due?: string;
  author?: string;
  grade?: 10 | 11 | 12 | null;
  excerpt?: string;
  status: string;
  progress: number;
  task_type?: "reading" | "social" | "literary" | "mixed" | "other";
  source_text?: string;
  items?: AssignmentItem[];
  active_item_id?: string;
};
export type AssignmentItem = {
  id: string;
  label: string;
  prompt: string;
  context?: string;
  item_type?: "reading" | "social" | "literary" | "other";
};
export type Step = { level: number; q: string; hints: string[] };
export type HintDifficulty = "understanding" | "ideas" | "expression";
export type Turn = (
  | { kind: "tutor"; step: number; text: string; level: number }
  | { kind: "hint"; step: number; tier: number; text: string }
  | {
      kind: "student";
      step: number;
      text: string;
      level: number;
      quality: number | null;
      hints: number;
    }
) & {
  id?: string;
  purpose?: "source" | "answer" | "clarification";
  response_kind?: "question" | "support" | "source_request" | "ready";
  objective?: string;
  strategy?: string;
};
export type Assessment = {
  status: "complete" | "insufficient_evidence";
  dimensions: {
    key: string;
    name: string;
    maximum: number;
    observed: boolean;
    points: number | null;
    rationale: string;
    evidence: { source_id: string; quote: string }[];
  }[];
  coverage: number;
  bloom: number | null;
  hint_count: number;
  autonomy: number;
  score: number | null;
  classification: string | null;
  raw_score: string | null;
  strengths: string[];
  next_steps: string[];
  scoring_version: string;
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
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  tutor_mode: string;
  current_objective?: string;
  support_state?: {
    question_id: string | null;
    question_text: string;
    objective: string;
    consecutive_hints: number;
    needs_check_in: boolean;
    difficulty: HintDifficulty | null;
  };
  plan?: { summary: string; objectives: string[]; task_type: "reading" | "social" | "literary" };
  support_events?: {
    id: string;
    turn_id: string;
    reason: string;
    origin: string;
    counted_for_autonomy: boolean;
  }[];
  assessment?: Assessment | null;
  pending_action?: {
    action: "message" | "hint" | "submit";
    text: string;
    client_message_id: string;
    status: "processing" | "failed";
    difficulty?: HintDifficulty | null;
  } | null;
};
export type Dashboard = {
  sessions: number;
  answers: number;
  hints: number;
  hints_per_answer: number;
  submitted: number;
  latest_session: Session | null;
};

export type SessionDraft = {
  answer: string;
  essay: string;
  revision: number;
  updated_at: string | null;
};
export type Progress = {
  bloom_profile: { skill: string; value: number }[];
  sessions: Session[];
  assignments: {
    id: string;
    title: string;
    created_at: string;
    items: {
      id: string;
      order: number;
      label: string;
      prompt: string;
      source_only: boolean;
      session_id: string | null;
    }[];
  }[];
};

export type AuthUser = { id: string; email: string; display_name: string };
export type AuthSession = { user: AuthUser; csrf_token: string };
let csrfToken: string | null = null;
let refreshPromise: Promise<AuthSession> | null = null;
// Production uses Vercel's same-origin rewrite so host-only cookies keep working.
const apiOrigin = import.meta.env.PROD
  ? ""
  : (import.meta.env["VITE_API_URL"] || "").replace(/\/$/, "");

export function clearAuthState() {
  csrfToken = null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function send(path: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options?.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(options?.method ?? "GET")
          ? { "X-CSRF-Token": csrfToken }
          : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiError("Không kết nối được hệ thống. Vui lòng kiểm tra kết nối và thử lại.", 0);
  }
  return response;
}

async function parse<T>(response: Response): Promise<T> {
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

async function raw<T>(path: string, options?: RequestInit): Promise<T> {
  return parse<T>(await send(path, options));
}

function remember(session: AuthSession) {
  csrfToken = session.csrf_token;
  return session;
}

async function refreshSession(): Promise<AuthSession> {
  if (!refreshPromise) {
    const renew = async () => {
      // Recheck after obtaining the cross-tab lock: another tab may have refreshed.
      try {
        return remember(await raw<AuthSession>("/auth/me"));
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      const csrf = await raw<{ csrf_token: string }>("/auth/csrf");
      csrfToken = csrf.csrf_token;
      return remember(await raw<AuthSession>("/auth/refresh", { method: "POST" }));
    };
    refreshPromise = (async (): Promise<AuthSession> => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request("socratic-auth-refresh", renew);
      return await renew();
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401) {
    try {
      await refreshSession();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthState();
        window.dispatchEvent(new Event("socratic:logged-out"));
      }
      throw error;
    }
    response = await send(path, options);
    if (response.status === 401) {
      clearAuthState();
      window.dispatchEvent(new Event("socratic:logged-out"));
    }
  }
  return parse<T>(response);
}

export const authApi = {
  session: async () => {
    try {
      return await refreshSession();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthState();
        return null;
      }
      throw error;
    }
  },
  login: async (email: string, password: string) =>
    remember(
      await raw<AuthSession>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    ),
  register: async (display_name: string, email: string, password: string) =>
    remember(
      await raw<AuthSession>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ display_name, email, password }),
      }),
    ),
  logout: async () => {
    await raw("/auth/logout", { method: "POST" });
    clearAuthState();
  },
};
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export type SourceTag = { type: string; id: string; label?: string; text: string };
export type SourcePage = {
  number: number;
  label: string;
  text: string;
  method: string;
  confidence: number | null;
  tags?: SourceTag[];
};
export type SourceParagraph = { id: string; text: string; source_pages: number[] };
export type ParsedIdea = {
  id: string;
  label: string;
  text: string;
  context: string;
  source_pages: number[];
};
export type ParsedQuestion = {
  id: string;
  label: string;
  text: string;
  stem: string;
  context: string;
  task?: string;
  materials?: string;
  points?: string | null;
  source_selection?: "full_source" | "cited_paragraphs" | "matched_phrase";
  subquestions: string[];
  ideas: ParsedIdea[];
  source_pages: number[];
  paragraphs: SourceParagraph[];
  source_only?: boolean;
  footnotes?: { number: string | number; text: string }[];
};
export type ParsedPart = {
  id: string;
  title: string;
  context: string;
  source_pages: number[];
  paragraphs: SourceParagraph[];
  questions: ParsedQuestion[];
};
export type DocumentStructure = {
  global_context: string;
  global_paragraphs: SourceParagraph[];
  parts: ParsedPart[];
  excluded: { text: string; page: number | null; reason: string }[];
  warnings: string[];
};
export type ExtractedDocument = {
  filename: string;
  title: string;
  text: string;
  document_id?: string;
  structure?: DocumentStructure;
  pages?: SourcePage[];
  blocks?: ContentBlock[];
  warnings?: string[];
  document_type?: string;
  subject?: string;
};
export type ContentBlock = {
  id: string;
  type: "heading" | "paragraph" | "list_item" | string;
  text: string;
  page: number;
  method: string;
};
type PendingDocument = { document_id: string; job_id: string; status: string };
export type DocumentHistoryItem = {
  document_id: string;
  filename: string;
  title: string;
  status: string;
  created_at?: number;
  updated_at?: number;
  document_type?: string;
  subject?: string;
  page_count: number;
  part_count: number;
  question_count: number;
  warning_count: number;
  groups: {
    id: string;
    label: string;
    text: string;
    question_ids: string[];
    question_labels: string[];
  }[];
};
export type DocumentDetail = DocumentHistoryItem & {
  text: string | null;
  structure?: DocumentStructure | null;
  pages?: SourcePage[];
  blocks?: ContentBlock[];
  extraction_warnings?: string[];
  error?: string | null;
  review?: DocumentReview | null;
};

export type InputMode = "auto" | "single" | "reference";
export type DocumentReview = {
  title: string;
  text: string;
  structure: DocumentStructure;
  selected_ids: string[];
  mode: InputMode;
};

async function waitForDocument(
  pending: PendingDocument,
  onPending?: (id: string) => void,
): Promise<ExtractedDocument> {
  onPending?.(pending.document_id);
  for (let attempt = 0; attempt < 900; attempt++) {
    const document = await api.document(pending.document_id);
    if (document.status === "needs_review" && document.text !== null) {
      return {
        filename: document.filename,
        title: document.title,
        text: document.text,
        document_id: pending.document_id,
        ...(document.structure ? { structure: document.structure } : {}),
        ...(document.pages ? { pages: document.pages } : {}),
        ...(document.blocks ? { blocks: document.blocks } : {}),
        ...(document.document_type ? { document_type: document.document_type } : {}),
        ...(document.subject ? { subject: document.subject } : {}),
        ...(document.extraction_warnings ? { warnings: document.extraction_warnings } : {}),
      };
    }
    if (document.status === "failed")
      throw new ApiError(document.error || "Không trích xuất được tài liệu.", 422);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new ApiError("Tài liệu vẫn đang xử lý. Mở Lịch sử tài liệu để tiếp tục khi hoàn tất.", 504);
}

export const api = {
  quickStart: (prompt: string, materials: string) =>
    post<Assignment>("/learning/quick-start", { prompt, materials }),
  retryDocument: async (id: string, onPending?: (id: string) => void) =>
    waitForDocument(await post<PendingDocument>(`/documents/${id}/retry`, {}), onPending),
  documents: () => request<DocumentHistoryItem[]>("/documents"),
  document: (id: string) => request<DocumentDetail>(`/documents/${id}`),
  saveTextDocument: (text: string, title: string, mode: InputMode) =>
    post<DocumentDetail>("/documents/text", { text, title, mode }),
  saveDocumentReview: (id: string, body: DocumentReview) =>
    request<DocumentDetail>(`/documents/${id}/review`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  assignments: () => request<Assignment[]>("/assignments"),
  createAssignment: (body: {
    title: string;
    prompt: string;
    target?: number;
    task_type?: "reading" | "social";
    source_text?: string;
    grade?: 10 | 11 | 12 | null;
    document_id?: string;
  }) => post<Assignment>("/assignments", body),
  createMultiAssignment: (body: {
    title: string;
    prompt?: string;
    task_type?: "reading" | "social" | "literary" | "mixed";
    source_text?: string;
    document_id?: string;
    items: Array<{
      item_type: "reading" | "social" | "literary" | "other";
      label: string;
      prompt: string;
      context?: string;
      source_pages?: number[];
      metadata?: Record<string, unknown>;
    }>;
  }) => post<Assignment>("/learning/assignments", body),
  extract: async (file: File, onPending?: (id: string) => void): Promise<ExtractedDocument> => {
    const data = new FormData();
    data.append("file", file);
    const result = await request<ExtractedDocument | PendingDocument>("/uploads/extract", {
      method: "POST",
      body: data,
    });
    if ("text" in result) return result;
    return waitForDocument(result, onPending);
  },
  extractBatch: async (files: File[], onPending?: (id: string) => void) => {
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    const result = await request<
      | PendingDocument
      | {
          combined?: ExtractedDocument;
          documents?: ExtractedDocument[];
          warnings?: string[];
          needs_confirmation: boolean;
        }
    >("/uploads/extract-batch", { method: "POST", body: data });
    return "document_id" in result
      ? { combined: await waitForDocument(result, onPending), needs_confirmation: true }
      : result;
  },
  structure: (text: string, pages?: SourcePage[], mode: InputMode = "auto") =>
    post<DocumentStructure>("/uploads/structure", { text, mode, ...(pages ? { pages } : {}) }),
  dashboard: () => request<Dashboard>("/dashboard"),
  progress: () => request<Progress>("/progress"),
  sessions: () => request<Session[]>("/sessions"),
  session: (id: string) => request<Session>(`/sessions/${id}`),
  sessionDraft: (id: string) => request<SessionDraft>(`/sessions/${id}/draft`),
  saveSessionDraft: (
    id: string,
    body: { answer: string; essay: string; revision: number; expected_version: number },
  ) =>
    request<SessionDraft>(`/sessions/${id}/draft`, { method: "PUT", body: JSON.stringify(body) }),
  prepareSession: (id: string) => post<Session>(`/sessions/${id}/prepare`, {}),
  start: (id: string, item?: string) =>
    post<Session>("/sessions", { assignment_id: id, ...(item ? { item_id: item } : {}) }),
  selectSessionItem: (sessionId: string, itemId: string) =>
    post<Session>(`/sessions/${sessionId}/select-item`, { item_id: itemId }),
  message: (session: Session, text: string, key: string) =>
    post<Session>(`/sessions/${session.id}/messages`, {
      text,
      expected_version: session.version,
      client_message_id: key,
    }),
  hint: (session: Session, key: string, difficulty?: HintDifficulty) =>
    post<Session>(`/sessions/${session.id}/hints`, {
      expected_version: session.version,
      client_message_id: key,
      ...(difficulty ? { difficulty } : {}),
    }),
  submit: (session: Session, essay: string, key: string) =>
    post<Session>(`/sessions/${session.id}/submit`, {
      essay,
      expected_version: session.version,
      client_message_id: key,
    }),
  action: (session: Session, action: "finish" | "continue" | "cancel", key: string) =>
    post<Session>(`/sessions/${session.id}/${action}`, {
      expected_version: session.version,
      client_message_id: key,
    }),
};
