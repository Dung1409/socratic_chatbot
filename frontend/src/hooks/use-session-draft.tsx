import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Session, type SessionDraft } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

type Values = { answer: string; essay: string };
type Backup = Values & { revision: number; studentTurns: number };
const studentTurns = (session: Session) =>
  session.turns.filter((turn) => turn.kind === "student" && turn.purpose !== "clarification")
    .length;

// Server drafts are separate from conversation versions: autosaving never changes
// the optimistic version used by an AI request. Local backup covers abrupt exits.
export function useSessionDraft(session: Session) {
  const { user } = useAuth();
  const client = useQueryClient();
  const key = `socratic:${user?.id}:saved-draft:${session.id}`;
  const latest = useRef(session);
  latest.current = session;
  const [initial] = useState<Values>(() => {
    if (!session.submitted) {
      try {
        const local = JSON.parse(localStorage.getItem(key) || "null") as Backup | null;
        if (local && typeof local.answer === "string" && typeof local.essay === "string")
          return {
            answer: local.studentTurns === studentTurns(session) ? local.answer : "",
            essay: local.essay,
          };
      } catch {
        /* Fetch the server copy when browser storage is unavailable. */
      }
    }
    return { answer: "", essay: session.essay };
  });
  const values = useRef<Values>(initial);
  const revision = useRef(0);
  const dirty = useRef(false);
  const conflict = useRef(false);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const [fields, setFields] = useState(values.current);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Đang tải bản nháp…");
  const [failed, setFailed] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const report = useCallback((message: string, error = false) => {
    if (mounted.current) {
      setStatus(message);
      setFailed(error);
    }
  }, []);
  const backup = useCallback(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...values.current,
          revision: revision.current,
          studentTurns: studentTurns(latest.current),
        } satisfies Backup),
      );
    } catch {
      /* The explicit server-save result remains authoritative. */
    }
  }, [key]);

  const load = useCallback(
    async (useServer = false) => {
      try {
        if (useServer) {
          const current = await api.session(session.id);
          latest.current = current;
          client.setQueriesData<Session>({ queryKey: ["session"] }, (cached) =>
            cached?.id === current.id ? current : cached,
          );
        }
        const remote = await api.sessionDraft(session.id);
        if (!mounted.current) return;
        revision.current = remote.revision;
        let local: Backup | null = null;
        try {
          local = JSON.parse(localStorage.getItem(key) || "null") as Backup | null;
        } catch {
          /* Use server copy. */
        }
        const valid = local && typeof local.answer === "string" && typeof local.essay === "string";
        const restored = !useServer && valid;
        values.current =
          restored && local
            ? {
                answer: local.studentTurns === studentTurns(latest.current) ? local.answer : "",
                essay: local.essay,
              }
            : {
                answer:
                  remote.answer ||
                  (session.pending_action?.action === "message" ? session.pending_action.text : ""),
                essay:
                  remote.essay ||
                  (session.pending_action?.action === "submit"
                    ? session.pending_action.text
                    : session.essay),
              };
        if (latest.current.submitted) {
          values.current = { answer: "", essay: "" };
          try {
            localStorage.removeItem(key);
          } catch {
            /* Submitted content is on the server. */
          }
        }
        if (!restored && !useServer && !latest.current.submitted) {
          // Migrate drafts kept by older versions in this tab.
          try {
            values.current.answer =
              sessionStorage.getItem(`socratic:${user?.id}:draft:${session.id}`) ??
              values.current.answer;
            values.current.essay =
              sessionStorage.getItem(`socratic:${user?.id}:essay:${session.id}`) ??
              values.current.essay;
            sessionStorage.removeItem(`socratic:${user?.id}:draft:${session.id}`);
            sessionStorage.removeItem(`socratic:${user?.id}:essay:${session.id}`);
          } catch {
            /* Storage may be disabled. */
          }
        }
        dirty.current =
          values.current.answer !== remote.answer || values.current.essay !== remote.essay;
        conflict.current = Boolean(
          restored && local && local.revision !== remote.revision && dirty.current,
        );
        setHasConflict(conflict.current);
        setFields({ ...values.current });
        initialized.current = true;
        setReady(true);
        if (useServer) {
          try {
            localStorage.removeItem(key);
          } catch {
            /* Server copy is loaded. */
          }
          dirty.current = false;
        }
        report(
          conflict.current
            ? "Có bản nháp mới trên thiết bị khác. Bản đang gõ vẫn được giữ trên máy này."
            : dirty.current
              ? "Đã khôi phục bản nháp trên máy này; đang chờ đồng bộ."
              : "Đã đồng bộ bản nháp với tài khoản.",
          conflict.current,
        );
      } catch {
        // Do not overwrite a remote draft when its revision is unknown.
        report(
          "Chưa tải được bản nháp. Kiểm tra kết nối rồi tải lại; bản trên máy vẫn được giữ.",
          true,
        );
      }
    },
    [client, key, report, session.id, session.essay, session.pending_action, user?.id],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (latest.current.submitted) return true;
    if (!initialized.current || conflict.current) return false;
    if (inFlight.current) return inFlight.current;
    const run = async () => {
      try {
        while (dirty.current) {
          report("Đang lưu bản nháp…");
          const snapshot = { ...values.current };
          const saved: SessionDraft = await api.saveSessionDraft(session.id, {
            ...snapshot,
            revision: revision.current,
            expected_version: latest.current.version,
          });
          revision.current = saved.revision;
          dirty.current =
            snapshot.answer !== values.current.answer || snapshot.essay !== values.current.essay;
          if (dirty.current) backup();
          else {
            try {
              localStorage.removeItem(key);
            } catch {
              /* Server copy is saved. */
            }
          }
        }
        report("Đã lưu bản nháp vào tài khoản.");
        return true;
      } catch (error) {
        backup();
        conflict.current = error instanceof ApiError && error.status === 409;
        if (mounted.current) setHasConflict(conflict.current);
        report(
          error instanceof Error ? error.message : "Chưa lưu được bản nháp. Hãy thử lại.",
          true,
        );
        return false;
      }
    };
    inFlight.current = run();
    try {
      return await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }, [backup, key, report, session.id]);

  const update = (field: keyof Values, value: string) => {
    values.current = { ...values.current, [field]: value };
    setFields(values.current);
    dirty.current = true;
    backup();
    report("Có thay đổi chưa đồng bộ.");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };
  const committed = (saved: Session, action: string) => {
    latest.current = saved;
    if (action === "message") values.current = { ...values.current, answer: "" };
    if (action === "submit") values.current = { answer: "", essay: "" };
    setFields(values.current);
    dirty.current = action !== "submit";
    if (saved.submitted) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* No unsent content. */
      }
    } else {
      backup();
      void save();
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      void save();
    };
    // A component is keyed by session ID. Hydration must not reset active typing
    // each time a reply updates the session prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);
  useEffect(() => {
    if (ready && dirty.current && !conflict.current) void save();
  }, [ready, save]);

  const feedback = (
    <span role={failed ? "alert" : "status"}>
      {status}{" "}
      {failed && (
        <button
          type="button"
          className="min-h-9 underline"
          onClick={() => void (hasConflict || !ready ? load(true) : save())}
        >
          {hasConflict
            ? "Dùng bản đã lưu trên tài khoản"
            : !ready
              ? "Tải lại bản nháp"
              : "Thử lưu lại"}
        </button>
      )}
    </span>
  );
  return {
    draft: fields.answer,
    essay: fields.essay,
    setDraft: (value: string) => update("answer", value),
    setEssay: (value: string) => update("essay", value),
    save,
    committed,
    feedback,
    ready,
    hasConflict,
  };
}
