export type Assignment = {
  id: string;
  title: string;
  prompt: string;
  target: number;
  document_id: string | null;
  source: string;
  status: string;
  progress: number;
  task_type?: "reading" | "social";
  source_text?: string;
  grade?: 10 | 11 | 12 | null;
};
export type Step = { level: number; q: string; hints: string[] };
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
  purpose?: "source" | "answer";
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
  plan?: { summary: string; objectives: string[]; task_type: "reading" | "social" };
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
export type Progress = {
  bloom_profile: { skill: string; value: number }[];
  sessions: Session[];
};

export type AuthUser = { id: string; email: string; display_name: string };
export type AuthSession = { user: AuthUser; csrf_token: string };
let csrfToken: string | null = null;
let refreshPromise: Promise<AuthSession> | null = null;

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
    response = await fetch(`${import.meta.env["VITE_API_URL"] || ""}/api${path}`, {
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
    throw new ApiError("Không kết nối được backend. Kiểm tra FastAPI đang chạy ở cổng 8000.", 0);
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

type ExtractedDocument = { filename: string; title: string; text: string; document_id?: string };
type PendingDocument = { document_id: string; job_id: string; status: string };
type DocumentStatus = PendingDocument & {
  filename: string;
  title: string;
  text: string | null;
  error: string | null;
};

export const api = {
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
  extract: async (file: File): Promise<ExtractedDocument> => {
    const data = new FormData();
    data.append("file", file);
    const result = await request<ExtractedDocument | PendingDocument>("/uploads/extract", {
      method: "POST",
      body: data,
    });
    if ("text" in result) return result;
    for (let attempt = 0; attempt < 240; attempt++) {
      const document = await request<DocumentStatus>(`/documents/${result.document_id}`);
      if (document.status === "needs_review" && document.text !== null) {
        return {
          filename: document.filename,
          title: document.title,
          text: document.text,
          document_id: result.document_id,
        };
      }
      if (document.status === "failed") {
        throw new ApiError(document.error || "Không trích xuất được văn bản từ tệp.", 422);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new ApiError("Tệp vẫn đang được xử lý. Em có thể nhập đề trực tiếp trong lúc chờ.", 504);
  },
  dashboard: () => request<Dashboard>("/dashboard"),
  progress: () => request<Progress>("/progress"),
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
  action: (session: Session, action: "finish" | "continue" | "cancel", key: string) =>
    post<Session>(`/sessions/${session.id}/${action}`, {
      expected_version: session.version,
      client_message_id: key,
    }),
};
