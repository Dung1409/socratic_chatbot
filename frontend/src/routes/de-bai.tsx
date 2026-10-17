import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FileText, ArrowRight } from "lucide-react";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api, type ContentBlock, type DocumentStructure, type ParsedQuestion, type SourcePage } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/de-bai")({
  head: () =>
    seo("Đề bài của tôi", "Tải đề bài Ngữ văn và bắt đầu phiên học cùng gia sư Socratic."),
  component: Page,
});

const MAX_IMAGES = 12;
const IMAGE_TYPES = /\.(png|jpe?g|webp)$/i;
type ImageItem = { id: string; file: File; preview: string };

function formatProse(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim())
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function Page() {
  const [file, setFile] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [structure, setStructure] = useState<DocumentStructure | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sourcePages, setSourcePages] = useState<SourcePage[] | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [documentType, setDocumentType] = useState("reference_document");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imageCache, setImageCache] = useState<Record<string, SourcePage>>({});
  const [busy, setBusy] = useState(false);
  const previews = useRef<string[]>([]);
  const documentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const query = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const client = useQueryClient();
  const navigate = useNavigate();
  const applyStructure = (parsed: DocumentStructure) => {
    setStructure(parsed);
    const firstPart = parsed.parts.find((part) => part.questions.length);
    const firstQuestion = firstPart?.questions[0];
    setSelectedId(firstQuestion?.id ?? "");
    setPrompt(firstQuestion?.context ?? "");
  };
  const upload = async (selected?: File) => {
    if (!selected || busy) return;
    if (selected.size > 10 * 1024 * 1024) {
      toast.error("Tệp vượt quá 10MB");
      return;
    }
    setBusy(true);
    try {
      const result = await api.extract(selected);
      setFile(result.filename);
      setTitle(result.title);
      setText(result.text);
      setSourcePages(result.pages ?? null);
      setSourceWarnings(result.warnings ?? []);
      setContentBlocks(result.blocks ?? []);
      setSelectedBlockId("");
      setDocumentType(result.document_type ?? "reference_document");
      applyStructure(result.structure ?? await api.structure(result.text, result.pages));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đọc được tệp");
    } finally {
      setBusy(false);
    }
  };
  const chooseFiles = (selected: File[]) => {
    if (!selected.length || busy) return;
    if (selected.every((item) => IMAGE_TYPES.test(item.name))) {
      if (selected.length > MAX_IMAGES || selected.some((item) => item.size > 10 * 1024 * 1024)) {
        toast.error("Tối đa 12 ảnh, mỗi ảnh không quá 10MB");
        return;
      }
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      const prepared = selected.map((item) => ({ id: crypto.randomUUID(), file: item,
        preview: URL.createObjectURL(item) }));
      previews.current = prepared.map((item) => item.preview);
      setImages(prepared);
      setImageCache({});
      setFile(null);
      setText("");
      setStructure(null);
      setSourcePages(null);
      setSourceWarnings([]);
      setContentBlocks([]);
      setSelectedBlockId("");
      setDocumentType("reference_document");
      setSelectedId("");
      setPrompt("");
      setTitle("Đề từ ảnh của em");
    } else if (selected.length === 1 && !IMAGE_TYPES.test(selected[0]!.name)) {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      previews.current = [];
      setImages([]);
      void upload(selected[0]);
    } else {
      toast.error("Chọn một tệp PDF/Word/TXT hoặc nhiều ảnh cùng một đề");
    }
  };
  const moveImage = (index: number, direction: number) => {
    const next = [...images];
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    setImages(next);
    setStructure(null);
    setSelectedId("");
    setPrompt("");
  };
  const processImages = async () => {
    if (busy || !images.length) return;
    setBusy(true);
    const cache = { ...imageCache };
    try {
      const pages: SourcePage[] = [];
      const warnings: string[] = [];
      for (const [index, item] of images.entries()) {
        let page = cache[item.id];
        if (!page) {
          const result = await api.extract(item.file).catch((error: unknown) => {
            throw new Error(`Ảnh ${index + 1} (${item.file.name}): ${error instanceof Error ? error.message : "không đọc được"}`);
          });
          page = result.pages?.[0] ?? { number: 1, label: item.file.name, text: result.text,
            method: "ocr", confidence: null };
          cache[item.id] = page;
          setImageCache({ ...cache });
        }
        if (page.confidence !== null && page.confidence < 65) {
          warnings.push(`Ảnh ${index + 1} OCR chưa chắc chắn; cần xem lại chữ.`);
        }
        pages.push({ ...page, number: index + 1, label: `Ảnh ${index + 1}: ${item.file.name}` });
      }
      const combined = pages.map((page) => page.text).join("\n\n");
      const parsed = await api.structure(combined, pages);
      setFile(`${images.length} ảnh theo thứ tự đã xác nhận`);
      setText(combined);
      setSourcePages(pages);
      setSourceWarnings(warnings);
      setContentBlocks(pages.flatMap((page) => page.text.trim() ? [{
        id: `page-${page.number}`, type: "paragraph", text: page.text,
        page: page.number, method: page.method,
      }] : []));
      setSelectedBlockId("");
      setDocumentType("image_note");
      applyStructure(parsed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đọc được bộ ảnh");
    } finally {
      setBusy(false);
    }
  };
  const analyze = async () => {
    if (busy || text.trim().length < 15) return;
    setBusy(true);
    try {
      const parsed = await api.structure(text.trim(), sourcePages ?? undefined);
      applyStructure(parsed);
      setContentBlocks(text.trim().split(/\n\s*\n/).filter(Boolean).map((value, index) => ({
        id: `manual-${index + 1}`, type: "paragraph", text: value.trim(), page: 1, method: "text",
      })));
      setSelectedBlockId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tách được đề bài");
    } finally {
      setBusy(false);
    }
  };
  const selectQuestion = (question: ParsedQuestion) => {
    setSelectedId(question.id);
    setPrompt(question.context);
  };
  const selectIdea = (idea: ParsedQuestion["ideas"][number]) => {
    setSelectedId(idea.id);
    setPrompt(idea.context);
  };
  const confirm = async () => {
    if (busy || !structure || !selectedId || title.trim().length < 5 ||
        prompt.trim().length < 15) return;
    setBusy(true);
    try {
      const result = await api.createAssignment({
        title: title.trim(),
        prompt: prompt.trim(),
        target: 4,
      });
      await client.invalidateQueries({ queryKey: ["assignments"] });
      await navigate({ to: "/phien-hoc", search: { assignment: result.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được đề bài");
    } finally {
      setBusy(false);
    }
  };
  const selectedPart = structure?.parts.find((part) =>
    part.questions.some((question) => question.id === selectedId ||
      question.ideas.some((idea) => idea.id === selectedId)));
  const selectedQuestion = selectedPart?.questions.find((question) =>
    question.id === selectedId || question.ideas.some((idea) => idea.id === selectedId));
  const selectedIdea = selectedQuestion?.ideas.find((idea) => idea.id === selectedId);
  const selectedBlock = contentBlocks.find((block) => block.id === selectedBlockId);
  return (
    <>
      <PageHeader
        eyebrow="Học sinh"
        title="Đề bài của tôi"
        desc="Tải bộ đề của em lên, kiểm tra các câu được tách ra rồi chọn câu muốn học."
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-3">
        <Panel title="Tải đề bài lên" className="xl:col-span-3">
          <details open={!structure} className="rounded-lg border bg-background p-3">
            <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">
              {structure ? "Đổi đề đã tải lên" : "Bước 1 · Tải đề hoặc nhập văn bản"}
            </summary>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                chooseFiles(Array.from(e.dataTransfer.files));
              }}
              className="mt-3 flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center"
            >
            <FileUp className="h-6 w-6 text-primary mb-3" />
            <span className="text-sm font-medium">
              {busy ? "Đang xử lý…" : "Kéo thả tệp vào đây hoặc chọn theo định dạng"}
            </span>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button type="button" disabled={busy} onClick={() => imageInput.current?.click()}>
                Chọn ảnh đề bài
              </Button>
              <Button type="button" variant="outline" disabled={busy}
                onClick={() => documentInput.current?.click()}>
                Chọn PDF/Word/TXT
              </Button>
            </div>
            <span className="text-xs text-muted-foreground mt-3">
              Tối đa 12 ảnh JPG/PNG/WEBP hoặc một tệp PDF/DOC/DOCX/TXT · mỗi tệp tối đa 10MB
            </span>
            <input
              ref={imageInput}
              aria-label="Chọn ảnh đề bài"
              disabled={busy}
              type="file"
              multiple
              className="hidden"
              accept=".png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                chooseFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <input
              ref={documentInput}
              aria-label="Chọn tệp PDF, Word hoặc TXT"
              disabled={busy}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => {
                chooseFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            </div>
          </details>
          {images.length > 0 && (
            <div className="mt-4 space-y-3" aria-label="Thứ tự ảnh của bộ đề">
              <p className="text-sm font-medium">Kiểm tra thứ tự trang trước khi đọc chữ</p>
              <p className="text-xs text-muted-foreground">
                Tên ảnh hoặc thứ tự chọn tệp có thể sai. Dùng nút lên/xuống để sắp xếp đúng thứ tự đề.
              </p>
              {images.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
                  <img src={item.preview} alt={`Xem trước ảnh ${index + 1}`} className="h-16 w-12 object-contain" />
                  <span className="min-w-0 flex-1 truncate text-xs">{index + 1}. {item.file.name}</span>
                  <Button type="button" variant="outline" size="sm" disabled={busy || index === 0}
                    aria-label={`Đưa ảnh ${index + 1} lên`} onClick={() => moveImage(index, -1)}>↑</Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy || index === images.length - 1}
                    aria-label={`Đưa ảnh ${index + 1} xuống`} onClick={() => moveImage(index, 1)}>↓</Button>
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" disabled={busy}
                onClick={() => void processImages()}>
                {busy ? "Đang đọc ảnh…" : "Xác nhận thứ tự & đọc chữ"}
              </Button>
            </div>
          )}
          {file && (
            <div className="mt-4 rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-secondary" />
                <span className="truncate">{file}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Đã trích xuất văn bản ({documentType}). Em hãy kiểm tra và chỉnh sửa trước khi bắt đầu.
              </p>
            </div>
          )}
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <label className="block text-sm font-medium">
              Tên đề
              <Input
                className="mt-1.5"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tên đề (ít nhất 5 ký tự)"
                maxLength={300}
              />
            </label>
            <details className="rounded-md border p-3" open={!structure}>
              <summary className="cursor-pointer text-sm font-medium">
                {structure ? "Xem hoặc sửa văn bản OCR gốc" : "Nhập hoặc kiểm tra văn bản đề"}
              </summary>
              <label className="mt-3 block text-sm font-medium">
                Văn bản đề gốc
                <Textarea
                  className="mt-1.5 min-h-40"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setStructure(null);
                    setSourcePages(null);
                    setContentBlocks([]);
                    setSelectedBlockId("");
                    setSelectedId("");
                    setPrompt("");
                  }}
                  placeholder="Nhập đề trực tiếp hoặc kiểm tra văn bản từ tệp…"
                  maxLength={150000}
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                Nếu sửa chữ OCR, hệ thống sẽ yêu cầu tách câu lại để cập nhật ngữ cảnh.
              </p>
            </details>
            {!structure && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void analyze()}
                disabled={busy || text.trim().length < 15}>
                Tách phần và câu hỏi
              </Button>
            )}
            {structure && (
              <section className="space-y-5" aria-label="Cấu trúc bộ đề">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                  <div>
                    <h2 className="text-lg font-semibold">Chọn câu để học</h2>
                    <p className="text-sm text-muted-foreground">Đã tách {structure.parts.length} phần · {structure.parts.reduce((total, part) => total + part.questions.length, 0)} câu</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Bước 2/3 · Kiểm tra đề</span>
                </div>
                {[...sourceWarnings, ...structure.warnings].map((warning, index) => (
                  <p key={`${index}-${warning}`} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{warning}</p>
                ))}
                {contentBlocks.length > 0 && (
                  <details className="rounded-xl border bg-muted/20 p-4" open={documentType !== "exam"}>
                    <summary className="cursor-pointer text-sm font-semibold">
                      Nội dung đã bóc tách ({contentBlocks.length} khối) · {documentType}
                    </summary>
                    <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-2">
                      {contentBlocks.map((block) => (
                        <button key={block.id} type="button" onClick={() => {
                          setSelectedBlockId(block.id);
                          setSelectedId(block.id);
                          setPrompt(block.text);
                        }} className={`w-full rounded-lg border bg-background p-3 text-left transition-colors ${selectedBlockId === block.id ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <span>{block.type === "heading" ? "Tiêu đề" : block.type === "list_item" ? "Ý / danh sách" : "Đoạn văn"}</span>
                            <span>Trang {block.page} · {block.method}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-7">{block.text}</p>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                <div className="grid gap-5 lg:grid-cols-[minmax(220px,290px)_minmax(0,1fr)] lg:items-start">
                  <nav className="space-y-4" aria-label="Danh sách câu hỏi">
                    {structure.parts.map((part) => (
                      <div key={part.id} className="overflow-hidden rounded-xl border bg-background">
                        <h3 className="border-b bg-muted/50 px-4 py-3 text-sm font-semibold">{part.title}</h3>
                        <div className="space-y-1 p-2">
                          {part.questions.map((question) => {
                            const active = selectedQuestion?.id === question.id;
                            return (
                              <button key={question.id} type="button" aria-current={active ? "true" : undefined}
                                onClick={() => selectQuestion(question)}
                                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${active ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/50"}`}>
                                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                                  <span>{question.label}</span>
                                  {question.points && <span className="text-xs font-medium text-muted-foreground">{question.points}</span>}
                                </span>
                                <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{formatProse(question.task ?? question.text)}</span>
                                {question.materials && <span className="mt-2 inline-block rounded bg-background/80 px-2 py-0.5 text-[11px] font-medium text-primary">Có ngữ liệu riêng</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </nav>
                  {selectedQuestion && selectedPart && (
                    <article className="min-w-0 space-y-5 rounded-xl border bg-background p-4 shadow-sm sm:p-6" aria-label={`Chi tiết ${selectedQuestion.label}`}>
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{selectedPart.title}</p>
                          <h3 className="mt-1 text-xl font-semibold">{selectedQuestion.label}</h3>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {selectedQuestion.points && <span className="rounded-full border px-2.5 py-1">{selectedQuestion.points}</span>}
                          {selectedQuestion.source_pages.length > 0 && <span className="rounded-full border px-2.5 py-1">Trang/ảnh {selectedQuestion.source_pages.join(", ")}</span>}
                        </div>
                      </header>
                      <section aria-label="Yêu cầu của câu hỏi" className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-primary">01 · Yêu cầu cần làm</h4>
                        <p className="mt-3 max-w-prose whitespace-pre-wrap text-base font-medium leading-7 text-foreground">{formatProse(selectedQuestion.task ?? selectedQuestion.text)}</p>
                      </section>
                      {selectedIdea && (
                        <section className="rounded-lg border border-primary/30 p-4" aria-label="Ý nhỏ đang chọn">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Ý {selectedIdea.label} đang chọn</h4>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{selectedIdea.text}</p>
                        </section>
                      )}
                      {selectedQuestion.materials && (
                        <section aria-label="Ngữ liệu đi kèm" className="rounded-lg border bg-muted/30 p-4 sm:p-5">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/70">02 · Ngữ liệu đi kèm</h4>
                          <p className="mt-1 text-xs text-muted-foreground">Dùng để phân tích hoặc làm dẫn chứng; đây không phải yêu cầu cần trả lời.</p>
                          <div className="mt-4 max-h-[32rem] overflow-y-auto rounded-md border bg-background p-4" tabIndex={0} aria-label="Nội dung ngữ liệu riêng">
                            <p className="max-w-prose whitespace-pre-wrap text-sm leading-7">{selectedQuestion.materials}</p>
                          </div>
                        </section>
                      )}
                      {selectedPart.paragraphs.length > 0 && (
                        <details className="group rounded-lg border bg-background p-4">
                          <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">
                            03 · Đọc ngữ liệu chung của phần này ({selectedPart.paragraphs.length} mục)
                          </summary>
                          <p className="mt-2 text-xs text-muted-foreground">Các dòng văn xuôi bị ngắt khi OCR đã được nối để dễ đọc. Bản gốc có thể sửa ở phía trên.</p>
                          <div className="mt-4 max-h-[36rem] space-y-5 overflow-y-auto pr-2" tabIndex={0} aria-label={`Ngữ liệu của ${selectedPart.title}`}>
                            {selectedPart.paragraphs.map((paragraph) => {
                              const marker = /^\((\d{1,2})\)\s*/.exec(paragraph.text);
                              const content = marker ? paragraph.text.slice(marker[0].length) : paragraph.text;
                              return (
                                <div key={paragraph.id} className="max-w-prose border-l-2 border-primary/40 pl-4">
                                  {marker && <p className="mb-1 text-xs font-bold text-primary">Đoạn {marker[1]}</p>}
                                  <p className="text-sm leading-7 text-foreground">{formatProse(content)}</p>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                      {selectedQuestion.source_selection === "matched_phrase" && <p className="text-xs text-amber-800 dark:text-amber-200">Đoạn liên quan được chọn theo cụm từ trùng khớp. Hãy kiểm tra lại trước khi học.</p>}
                      {selectedQuestion.source_selection === "cited_paragraphs" && <p className="text-xs text-muted-foreground">Gia sư chỉ nhận các đoạn được nêu đích danh trong câu hỏi.</p>}
                      {selectedQuestion.ideas.length > 0 && (
                        <div className="space-y-2 border-t pt-4">
                          <h4 className="text-sm font-semibold">Các ý nhỏ</h4>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant={selectedId === selectedQuestion.id ? "default" : "outline"} onClick={() => selectQuestion(selectedQuestion)}>Toàn câu</Button>
                            {selectedQuestion.ideas.map((idea) => (
                              <Button key={idea.id} type="button" size="sm" variant={selectedId === idea.id ? "default" : "outline"}
                                onClick={() => selectIdea(idea)}>Ý {idea.label}</Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  )}
                  {!selectedQuestion && selectedBlock && (
                    <article className="min-w-0 space-y-4 rounded-xl border bg-background p-4 shadow-sm sm:p-6">
                      <header className="border-b pb-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Khối nội dung đã chọn · Trang {selectedBlock.page}</p>
                        <h3 className="mt-1 text-xl font-semibold">Sẵn sàng học Socratic</h3>
                      </header>
                      <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Nội dung làm điểm bắt đầu</h4>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{selectedBlock.text}</p>
                      </section>
                      <p className="text-sm text-muted-foreground">Em có thể sửa nội dung bên dưới trước khi bắt đầu. Gia sư sẽ dùng khối này để đặt câu hỏi gợi mở.</p>
                    </article>
                  )}
                </div>
                <div className="space-y-3 border-t pt-4">
                  {structure.excluded.length > 0 && (
                    <details className="rounded-md border p-3 text-xs">
                      <summary className="cursor-pointer font-medium">Nội dung đã loại khỏi phiên học ({structure.excluded.length} dòng)</summary>
                      {structure.excluded.map((line, index) => (
                        <p key={`${index}-${line.page}`} className="mt-2 whitespace-pre-wrap">{line.page ? `Trang/ảnh ${line.page}: ` : ""}{line.text}</p>
                      ))}
                    </details>
                  )}
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Kiểm tra hoặc sửa nội dung gửi gia sư · {prompt.length.toLocaleString("vi-VN")} ký tự</summary>
                    <label className="mt-3 block text-sm font-medium">
                      Nội dung của câu/ý đang chọn để gia sư dùng
                      <Textarea className="mt-1.5 min-h-36" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                    </label>
                  </details>
                </div>
              </section>
            )}
            <Button
              className="w-full"
              type="submit"
              disabled={busy || !structure || !selectedId || title.trim().length < 5 ||
                prompt.trim().length < 15}
            >
              {busy ? "Đang xử lý…" : selectedBlockId ? "Xác nhận nội dung này & bắt đầu học" : "Xác nhận câu này & bắt đầu học"}
            </Button>
          </form>
          <div className="mt-6 text-xs text-muted-foreground leading-relaxed">
            Hệ thống đọc PDF scan/ảnh bằng OCR khi máy chủ đã cài Tesseract tiếng Việt.
            Em cần kiểm tra lại chữ, thứ tự và ranh giới câu/ý trước khi xác nhận. Gia sư hiện dùng kịch bản, chưa gọi AI.
          </div>
        </Panel>
        <div className="xl:col-span-3 space-y-4">
          {query.isPending || query.error ? (
            <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />
          ) : (
            query.data?.map((a) => (
              <Panel key={a.id}>
                <div className="flex flex-col md:flex-row gap-5">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{a.author}</span>·<span>{a.grade}</span>·<span>Hạn {a.due}</span>
                    </div>
                    <h3 className="font-semibold mt-1">{a.title}</h3>
                    <p className="text-sm text-foreground/80 mt-2">{a.prompt}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Mục tiêu</span>
                      <BloomBadge level={a.target} />
                    </div>
                  </div>
                  <div className="flex md:flex-col items-center md:items-end justify-between gap-3">
                    <span className="text-xs rounded-full bg-muted px-2.5 py-1">{a.status}</span>
                    <Button
                      asChild
                      variant={a.status === "Đã nộp" ? "outline" : "default"}
                      size="sm"
                    >
                      {a.status === "Đã nộp" ? (
                        <Link to="/tien-trinh">Xem kết quả</Link>
                      ) : (
                        <Link to="/phien-hoc" search={{ assignment: a.id }}>
                          Học với gia sư <ArrowRight />
                        </Link>
                      )}
                    </Button>
                  </div>
                </div>
              </Panel>
            ))
          )}
        </div>
      </div>
    </>
  );
}
