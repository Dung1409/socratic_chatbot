import { useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type Assignment } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (assignment: Assignment, start: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};
type UploadedFile = { filename: string; text: string; documentId: string | undefined };
const initialDraft = {
  title: "",
  prompt: "",
  taskType: "social" as "reading" | "social",
  grade: "",
  sourceText: "",
};

export function CreateAssignmentDialog({ open, onOpenChange, onCreated, triggerRef }: Props) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initialDraft);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState<"upload" | "save" | "start" | null>(null);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const taskInput = useRef<HTMLSelectElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  // Protect against double clicks before React renders the disabled state.
  const locked = useRef(false);
  const titleError = draft.title.trim().length < 5 ? "Tên đề cần ít nhất 5 ký tự." : "";
  const promptError = draft.prompt.trim().length < 15 ? "Nội dung đề cần ít nhất 15 ký tự." : "";

  const update = (key: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError("");
  };
  const validate = () => {
    setValidated(true);
    if (titleError || promptError) {
      setStep(1);
      requestAnimationFrame(() => (titleError ? titleInput : promptInput).current?.focus());
      return false;
    }
    return true;
  };
  const upload = async (selected?: File) => {
    if (!selected || locked.current) return;
    setError("");
    if (!/\.(pdf|docx|txt)$/i.test(selected.name)) {
      setError("Chọn tài liệu PDF, DOCX hoặc TXT.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("Tệp vượt quá 10 MB. Em hãy chọn tệp nhỏ hơn.");
      return;
    }
    if (!selected.size) {
      setError("Tệp đang trống. Em hãy chọn tài liệu có nội dung.");
      return;
    }
    locked.current = true;
    setBusy("upload");
    try {
      const result = await api.extract(selected);
      if (result.text.length > 30000)
        throw new Error("Tài liệu vượt quá 30.000 ký tự. Em hãy chia thành tệp nhỏ hơn.");
      setFile({ filename: result.filename, text: result.text, documentId: result.document_id });
      // Never replace text the learner has already entered.
      setDraft((previous) => ({
        ...previous,
        title: previous.title || result.title.slice(0, 300),
        prompt: previous.prompt || result.text,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được tệp. Em hãy thử lại.");
      requestAnimationFrame(() => errorMessage.current?.focus());
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const save = async (start: boolean) => {
    if (locked.current || !validate()) return;
    locked.current = true;
    setBusy(start ? "start" : "save");
    setError("");
    try {
      const assignment = await api.createAssignment({
        title: draft.title.trim(),
        prompt: draft.prompt.trim(),
        task_type: draft.taskType,
        grade: draft.grade ? (Number(draft.grade) as 10 | 11 | 12) : null,
        source_text: draft.sourceText.trim(),
        ...(file?.documentId ? { document_id: file.documentId } : {}),
      });
      toast.success(
        start
          ? "Đã lưu đề bài. Đang mở phiên học…"
          : "Đã lưu đề bài. Em có thể bắt đầu học bất cứ lúc nào.",
      );
      setDraft(initialDraft);
      setFile(null);
      setValidated(false);
      setStep(1);
      onOpenChange(false);
      onCreated(assignment, start);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa lưu được đề bài. Em hãy thử lại.");
      requestAnimationFrame(() => errorMessage.current?.focus());
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!locked.current) {
          onOpenChange(next);
          setDragging(false);
        }
      }}
    >
      <DialogContent
        closeDisabled={!!busy}
        className="assignment-dialog max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-2xl gap-0 overflow-hidden rounded-xl bg-card p-0 shadow-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (step === 1 ? titleInput : taskInput).current?.focus();
        }}
      >
        <DialogHeader className="px-5 pb-5 pt-6 text-left sm:px-6">
          <DialogTitle className="pr-8 text-xl">Tạo đề bài mới</DialogTitle>
          <DialogDescription className="pr-6 text-sm leading-6">
            Chuẩn bị đề của em, cùng gia sư khám phá từng ý.
          </DialogDescription>
        </DialogHeader>
        <ol
          aria-label="Các bước tạo đề"
          className="mx-5 mb-5 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 sm:mx-6"
        >
          {["Nội dung đề", "Thiết lập"].map((label, index) => (
            <li key={label}>
              <button
                type="button"
                disabled={!!busy}
                aria-current={step === index + 1 ? "step" : undefined}
                onClick={() => {
                  if (index === 0 || validate()) {
                    setStep(index + 1);
                    requestAnimationFrame(() =>
                      (index === 0 ? titleInput : taskInput).current?.focus(),
                    );
                  }
                }}
                className={cn(
                  "flex min-h-10 w-full items-center justify-center gap-2 rounded-md px-2 text-sm font-medium",
                  step === index + 1 ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-xs",
                    step > index + 1 ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {step > index + 1 ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <form
          noValidate
          className="flex min-h-0 flex-col overflow-hidden"
          aria-busy={!!busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 1) {
              if (validate()) {
                setStep(2);
                requestAnimationFrame(() => taskInput.current?.focus());
              }
            } else void save(false);
          }}
        >
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-6 sm:px-6">
            <fieldset disabled={!!busy} hidden={step !== 1} className="space-y-5">
              <div>
                <label htmlFor="assignment-title" className="text-sm font-medium">
                  Tên đề{" "}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </label>
                <Input
                  id="assignment-title"
                  ref={titleInput}
                  value={draft.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Ví dụ: Tài năng và nỗ lực"
                  maxLength={300}
                  required
                  aria-invalid={validated && !!titleError}
                  aria-describedby="assignment-title-hint"
                  className="mt-2 h-11 shadow-none"
                />
                <p
                  id="assignment-title-hint"
                  className={cn(
                    "mt-1.5 text-xs",
                    validated && titleError ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {validated && titleError ? titleError : "Từ 5 đến 300 ký tự."}
                </p>
              </div>
              <div>
                <label htmlFor="assignment-prompt" className="text-sm font-medium">
                  Nội dung đề{" "}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </label>
                <Textarea
                  id="assignment-prompt"
                  ref={promptInput}
                  value={draft.prompt}
                  onChange={(event) => update("prompt", event.target.value)}
                  placeholder="Nhập yêu cầu của đề bài hoặc tải tài liệu bên dưới…"
                  maxLength={30000}
                  required
                  aria-invalid={validated && !!promptError}
                  aria-describedby="assignment-prompt-hint"
                  className="mt-2 min-h-32 resize-y shadow-none"
                />
                <div
                  id="assignment-prompt-hint"
                  className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground"
                >
                  <span className={validated && promptError ? "text-destructive" : ""}>
                    {validated && promptError
                      ? promptError
                      : "Ít nhất 15 ký tự. Em có thể chỉnh sửa văn bản trích xuất."}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {draft.prompt.length.toLocaleString("vi-VN")}/30.000
                  </span>
                </div>
              </div>
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Chọn tệp đề bài"
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void upload(event.dataTransfer.files[0]);
                  }}
                  className={cn(
                    "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
                    dragging
                      ? "border-primary bg-primary-soft"
                      : "border-input hover:border-primary/50 hover:bg-muted/50",
                  )}
                >
                  {busy === "upload" ? (
                    <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
                  ) : (
                    <UploadCloud aria-hidden="true" className="size-5 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {busy === "upload" ? "Đang trích xuất tài liệu…" : "Kéo thả hoặc chọn tài liệu"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    PDF, DOCX, TXT · Tối đa 10 MB
                  </span>
                </button>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  PDF cần có văn bản. Tệp ảnh và PDF scan chưa được hỗ trợ.
                </p>
              </div>
              {file && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Bỏ tài liệu đính kèm"
                      onClick={() => setFile(null)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <p role="status" className="mt-1 text-xs leading-5 text-muted-foreground">
                    Đã trích xuất văn bản. Kiểm tra nội dung trước khi lưu đề.
                  </p>
                  {file.text !== draft.prompt && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-medium text-primary">
                        Xem văn bản từ tài liệu
                      </summary>
                      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-5">
                        {file.text}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => {
                          update("sourceText", file.text);
                          toast.success("Đã điền văn bản vào ngữ liệu ở bước Thiết lập.");
                        }}
                      >
                        Dùng làm ngữ liệu
                      </Button>
                    </details>
                  )}
                </div>
              )}
            </fieldset>
            <fieldset disabled={!!busy} hidden={step !== 2} className="space-y-5">
              <div className="rounded-lg bg-muted/60 px-4 py-3">
                <p className="text-xs text-muted-foreground">Đề bài của em</p>
                <p className="mt-1 break-words text-sm font-medium">{draft.title}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="assignment-task" className="text-sm font-medium">
                    Dạng bài
                  </label>
                  <select
                    ref={taskInput}
                    id="assignment-task"
                    value={draft.taskType}
                    onChange={(event) => update("taskType", event.target.value)}
                    className="assignment-select mt-2"
                  >
                    <option value="social">Nghị luận xã hội</option>
                    <option value="reading">Đọc hiểu</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="assignment-grade" className="text-sm font-medium">
                    Khối lớp <span className="font-normal text-muted-foreground">(tùy chọn)</span>
                  </label>
                  <select
                    id="assignment-grade"
                    value={draft.grade}
                    onChange={(event) => update("grade", event.target.value)}
                    className="assignment-select mt-2"
                  >
                    <option value="">Chưa chọn lớp</option>
                    <option value="10">Lớp 10</option>
                    <option value="11">Lớp 11</option>
                    <option value="12">Lớp 12</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="assignment-source" className="text-sm font-medium">
                  Ngữ liệu / đoạn trích liên quan
                </label>
                <Textarea
                  id="assignment-source"
                  value={draft.sourceText}
                  onChange={(event) => update("sourceText", event.target.value)}
                  maxLength={30000}
                  placeholder="Dán văn bản hoặc đoạn trích cần dùng cho đề bài…"
                  aria-describedby="assignment-source-hint"
                  className="mt-2 min-h-28 resize-y shadow-none sm:min-h-40"
                />
                <p
                  id="assignment-source-hint"
                  className="mt-2 text-xs leading-5 text-muted-foreground"
                >
                  Có thể để trống nếu đề đã đủ ngữ liệu. Gia sư sẽ hỏi thêm khi cần.
                </p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Lưu đề để học sau, hoặc bắt đầu đối thoại cùng gia sư ngay.
              </p>
            </fieldset>
            {error && (
              <p
                ref={errorMessage}
                tabIndex={-1}
                role="alert"
                className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
              >
                {error}
              </p>
            )}
          </div>
          <footer className="flex shrink-0 flex-col gap-3 border-t bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {step === 1 ? (
              <>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Bước 1 / 2 · Nội dung đề
                </span>
                <Button type="submit" disabled={!!busy} className="h-11 shadow-none">
                  Tiếp tục <ArrowRight aria-hidden="true" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!busy}
                  className="h-9 sm:h-11 sm:px-2"
                  onClick={() => {
                    setStep(1);
                    requestAnimationFrame(() => titleInput.current?.focus());
                  }}
                >
                  <ArrowLeft aria-hidden="true" /> Quay lại
                </Button>
                <div className="flex flex-col gap-2 min-[380px]:flex-row">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!!busy}
                    className="h-11 bg-card shadow-none"
                  >
                    {busy === "save" && <Loader2 aria-hidden="true" className="animate-spin" />}
                    {busy === "save" ? "Đang lưu…" : "Lưu đề bài"}
                  </Button>
                  <Button
                    type="button"
                    disabled={!!busy}
                    className="h-11 shadow-none"
                    onClick={() => void save(true)}
                  >
                    {busy === "start" ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                    {busy === "start" ? "Đang lưu đề…" : "Lưu & bắt đầu học"}
                  </Button>
                </div>
              </>
            )}
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
