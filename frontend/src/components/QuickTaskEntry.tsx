import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function QuickTaskEntry() {
  const { user } = useAuth();
  const key = `socratic:${user?.id}:quick-task`;
  const [initial] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "{}") as {
        prompt?: string;
        materials?: string;
      };
    } catch {
      return {};
    }
  });
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [materials, setMaterials] = useState(initial?.materials ?? "");
  const [materialsOpen, setMaterialsOpen] = useState(Boolean(initial?.materials));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ prompt, materials }));
    } catch {
      /* Keep the current input available. */
    }
  }, [key, prompt, materials]);
  const tooLong =
    prompt.trim().length + materials.trim().length + (materials.trim() ? 12 : 0) > 150000;
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedInput, setSavedInput] = useState("");
  const submit = async (event: FormEvent, start = true) => {
    event.preventDefault();
    if (submitting.current || prompt.trim().length < 15 || tooLong) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const input = JSON.stringify([prompt.trim(), materials.trim()]);
      const id =
        savedId && savedInput === input
          ? savedId
          : (await api.quickStart(prompt.trim(), materials.trim())).id;
      setSavedId(id);
      setSavedInput(input);
      await client.invalidateQueries({ queryKey: ["assignments"] });
      await client.invalidateQueries({ queryKey: ["documents"] });
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Starting a session does not depend on browser storage. */
      }
      if (start) await navigate({ to: "/phien-hoc", search: { assignment: id } });
      else {
        toast.success("Đã lưu bài học. Em có thể bắt đầu học sau.");
        await navigate({ to: "/", search: { lesson: id, view: "assignment" } });
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Chưa bắt đầu được phiên học. Em hãy thử lại.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-xl border bg-card p-5 sm:p-7">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <label className="block text-base font-semibold">
          Em muốn học đề nào?
          <Textarea
            className="mt-3 min-h-48 text-base leading-7"
            value={prompt}
            maxLength={150000}
            onChange={(event) => {
              setPrompt(event.target.value);
              setError("");
            }}
            placeholder="Dán nguyên đề bài vào đây. Ví dụ: Hãy trình bày suy nghĩ của em về vai trò của việc đọc sách."
            aria-describedby="quick-task-help"
          />
        </label>
        <p id="quick-task-help" className="text-sm text-muted-foreground">
          Nhập đề từ 15 ký tự. Em có thể lưu để học sau; tên đề được tạo tự động.
        </p>
        <details
          open={materialsOpen}
          onToggle={(event) => setMaterialsOpen(event.currentTarget.open)}
          className="rounded-lg border p-3 sm:p-4"
        >
          <summary className="cursor-pointer text-sm font-medium">
            Thêm ngữ liệu{" "}
            <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
          </summary>
          <label className="mt-3 block text-sm font-medium">
            Đoạn trích, bài thơ hoặc ngữ liệu liên quan
            <Textarea
              className="mt-2 min-h-36 text-sm leading-7"
              value={materials}
              maxLength={150000}
              onChange={(event) => {
                setMaterials(event.target.value);
                setError("");
              }}
              placeholder="Dán ngữ liệu cần dùng cho đề bài, nếu có."
            />
          </label>
        </details>
        {tooLong && (
          <p role="alert" className="text-sm text-destructive">
            Đề và ngữ liệu tối đa 150.000 ký tự.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            disabled={busy || prompt.trim().length < 15 || tooLong}
            onClick={(event) => void submit(event, false)}
          >
            Lưu đề
          </Button>
          <Button
            type="submit"
            className="min-h-11 w-full sm:w-auto"
            disabled={busy || prompt.trim().length < 15 || tooLong}
          >
            {busy ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                Đang chuẩn bị phiên học…
              </>
            ) : (
              <>
                Bắt đầu học
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
