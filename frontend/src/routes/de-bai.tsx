import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FileText, ChevronDown } from "lucide-react";
import { PageHeader, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api, type ContentBlock, type DocumentDetail, type DocumentStructure, type ParsedQuestion, type SourcePage } from "@/lib/api";
import { editQuestionTask, editSharedMaterials, editSharedParagraph } from "@/lib/document-source-edits";
import { classifyTextLayout, filterSourceParagraphs, formatProse, sourceParagraphListClass, splitProseParagraphs } from "@/lib/text-layout";
import { ApiState } from "@/components/ApiState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/de-bai")({
  head: () =>
    seo("Tài liệu của tôi", "Tải đề bài hoặc tài liệu học tập và bắt đầu phiên học cùng gia sư Socratic."),
  component: Page,
});

const MAX_IMAGES = 12;
const IMAGE_TYPES = /\.(png|jpe?g|webp)$/i;
type ImageItem = { id: string; file: File; preview: string };

function Page() {
  const [file, setFile] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [structure, setStructure] = useState<DocumentStructure | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sourcePages, setSourcePages] = useState<SourcePage[] | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [documentType, setDocumentType] = useState("reference_document");
  const [subject, setSubject] = useState("chưa xác định");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [detailDocument, setDetailDocument] = useState<DocumentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSelection, setDetailSelection] = useState<string>("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEditable, setDetailEditable] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [questionListOpen, setQuestionListOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const previews = useRef<string[]>([]);
  const documentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const documentsQuery = useQuery({ queryKey: ["documents"], queryFn: api.documents });
  const client = useQueryClient();
  const navigate = useNavigate();
  const applyStructure = (parsed: DocumentStructure) => {
    setStructure(parsed);
    setQuestionsOpen(true);
    setQuestionListOpen(true);
    const firstPart = parsed.parts.find((part) => part.questions.length);
    const firstQuestion = firstPart?.questions[0];
    setSelectedId(firstQuestion?.id ?? "");
    setSelectedIds(firstQuestion?.label === "Nội dung chưa tách được" ? [firstQuestion.id] : []);
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
      setDocumentId(result.document_id);
      setSourcePages(result.pages ?? null);
      setSourceWarnings(result.warnings ?? []);
      setContentBlocks(result.blocks ?? []);
      setSelectedBlockId("");
      setSelectedIds([]);
      setDocumentType(result.document_type ?? "reference_document");
      setSubject(result.subject ?? "chưa xác định");
      applyStructure(result.structure ?? await api.structure(result.text, result.pages));
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      previews.current = [];
      setImages([]);
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
      setFile(null);
      setText("");
      setDocumentId(undefined);
      setStructure(null);
      setSourcePages(null);
      setSourceWarnings([]);
      setContentBlocks([]);
      setSelectedBlockId("");
      setDocumentType("reference_document");
      setSubject("chưa xác định");
      setSelectedId("");
      setSelectedIds([]);
      setPrompt("");
      setTitle("Đề từ ảnh của em");
    } else if (selected.length === 1 && !IMAGE_TYPES.test(selected[0]!.name)) {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      previews.current = [];
      setImages([]);
      void upload(selected[0]);
    } else {
      toast.error("Chọn một tệp PDF/Word/ODT/văn bản hoặc nhiều ảnh cùng một tài liệu");
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
    try {
      const batch = await api.extractBatch(images.map((item) => item.file));
      const result = batch.combined;
      if (!result) throw new Error("Máy chủ chưa trả về nội dung bộ ảnh.");
      setFile(`${images.length} ảnh theo thứ tự đã xác nhận`);
      setText(result.text);
      setDocumentId(result.document_id);
      setSourcePages(result.pages ?? null);
      setSourceWarnings(result.warnings ?? []);
      setContentBlocks(result.blocks ?? []);
      setSelectedBlockId("");
      setDocumentType(result.document_type ?? "image_note");
      setSubject(result.subject ?? "chưa xác định");
      applyStructure(result.structure ?? await api.structure(result.text, result.pages));
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
    setSelectedBlockId("");
    setSelectedId(question.id);
    setPrompt(question.context);
  };
  const toggleQuestion = (questionId: string) => {
    setSelectedIds((current) => current.includes(questionId)
      ? current.filter((id) => id !== questionId)
      : [...current, questionId]);
  };
  const selectIdea = (idea: ParsedQuestion["ideas"][number]) => {
    setSelectedBlockId("");
    setSelectedId(idea.id);
    const parent = structure?.parts.flatMap((part) => part.questions)
      .find((question) => question.ideas.some((item) => item.id === idea.id));
    setPrompt(parent?.context ?? idea.context);
  };
  const confirm = async () => {
    if (busy || !structure || selectedIds.length === 0 || title.trim().length < 5) return;
    setBusy(true);
    try {
      const allQuestions = structure.parts.flatMap((part) => part.questions.map((question) => ({ part, question })));
      const selectedItems = allQuestions.filter(({ question }) => selectedIds.includes(question.id))
        .map(({ part, question }) => ({
          item_type: question.label === "Nội dung chưa tách được" ? "reading" as const
            : part.title.toUpperCase().includes("ĐỌC") ? "reading" as const
            : part.title.toUpperCase().includes("XÃ HỘI") ? "social" as const : "literary" as const,
          label: question.label === "Nội dung chưa tách được" ? "Nội dung đầu vào" : `${part.title} · ${question.label}`,
          prompt: question.label === "Nội dung chưa tách được"
            ? "Hãy cùng em khám phá nội dung chính và các ý đáng suy nghĩ trong tài liệu này."
            : question.task || question.text,
          context: question.context,
          source_pages: question.source_pages,
          metadata: { part_id: part.id, question_id: question.id, points: question.points,
            source_only: question.label === "Nội dung chưa tách được" },
        }));
      const result = await api.createMultiAssignment({
        title: title.trim(),
        prompt: selectedItems[0]?.prompt ?? prompt.trim(),
        ...(selectedItems.length > 1 ? { task_type: "mixed" as const } : selectedItems[0]?.item_type ? { task_type: selectedItems[0].item_type } : {}),
        source_text: text.trim(),
        ...(documentId ? { document_id: documentId } : {}),
        items: selectedItems,
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
  const sharedParagraphs = filterSourceParagraphs(selectedPart?.paragraphs ?? []);
  const sharedSourceLayout = classifyTextLayout(sharedParagraphs.map((paragraph) => paragraph.text).join("\n"));
  const selectedIdea = selectedQuestion?.ideas.find((idea) => idea.id === selectedId);
  const selectedBlock = contentBlocks.find((block) => block.id === selectedBlockId);
  const sourceOnly = structure?.parts.some((part) => part.questions.some((question) =>
    question.label === "Nội dung chưa tách được" && selectedIds.includes(question.id))) ?? false;
  const openDocumentDetail = async (id: string) => {
    setDetailEditable(false);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailSelection("");
    try {
      const detail = await api.document(id);
      setDetailDocument(detail);
      const firstQuestion = detail.structure?.parts.flatMap((part) => part.questions)[0];
      setDetailSelection(firstQuestion?.id ?? detail.structure?.parts[0]?.id ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được bản tách");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };
  const openCurrentDetail = () => {
    if (!structure) return;
    setDetailEditable(true);
    setDetailDocument({
      document_id: documentId ?? "current",
      filename: file ?? title,
      title: title || file || "Tài liệu đang xử lý",
      status: "needs_review",
      document_type: documentType,
      subject,
      page_count: sourcePages?.length ?? 0,
      part_count: structure.parts.length,
      question_count: structure.parts.reduce((total, part) => total + part.questions.length, 0),
      warning_count: sourceWarnings.length + structure.warnings.length,
      groups: [],
      text,
      structure,
      pages: sourcePages ?? [],
      blocks: contentBlocks,
      extraction_warnings: [...sourceWarnings, ...structure.warnings],
    });
    const firstQuestion = structure.parts.flatMap((part) => part.questions)[0];
    setDetailSelection(firstQuestion?.id ?? structure.parts[0]?.id ?? "");
    setDetailOpen(true);
  };
  const editExtractedQuestion = (questionId: string, field: "task" | "materials", value: string) => {
    const edit = (current: DocumentStructure) => field === "task"
      ? editQuestionTask(current, questionId, value) : editSharedMaterials(current, questionId, value);
    setStructure((current) => current ? edit(current) : current);
    setDetailDocument((current) => current?.structure ? { ...current, structure: edit(current.structure) } : current);
  };
  const editExtractedParagraph = (paragraphId: string, value: string) => {
    setStructure((current) => current ? editSharedParagraph(current, paragraphId, value) : current);
    setDetailDocument((current) => current?.structure
      ? { ...current, structure: editSharedParagraph(current.structure, paragraphId, value) } : current);
  };
  const detailStructure = detailDocument?.structure ?? null;
  const detailPart = detailStructure?.parts.find((part) =>
    part.id === detailSelection || part.questions.some((question) => question.id === detailSelection));
  const detailQuestion = detailPart?.questions.find((question) => question.id === detailSelection);
  const detailParagraphs = detailQuestion?.paragraphs.length ? detailQuestion.paragraphs
    : detailPart?.paragraphs.length ? detailPart.paragraphs : detailStructure?.global_paragraphs ?? [];
  const visibleDetailParagraphs = filterSourceParagraphs(detailParagraphs);
  const detailSourceText = detailQuestion?.materials?.trim()
    || visibleDetailParagraphs.map((paragraph) => paragraph.text).join("\n\n").trim()
    || detailDocument?.groups?.find((group) => group.question_ids.includes(detailQuestion?.id ?? ""))?.text?.trim()
    || detailDocument?.text?.trim()
    || "";
  const detailPartCount = detailStructure?.parts.length || detailDocument?.part_count || detailDocument?.groups?.length || 0;
  const detailQuestionCount = detailStructure?.parts.reduce((total, part) => total + part.questions.length, 0)
    || detailDocument?.question_count
    || detailDocument?.groups?.reduce((total, group) => total + group.question_labels.length, 0)
    || 0;
  return (
    <>
      <PageHeader
        eyebrow="Học sinh"
        title="Tài liệu của tôi"
        desc="Tải đề bài hoặc tài liệu học tập lên. Nếu không có câu hỏi tường minh, nội dung vẫn được giữ nguyên."
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-3">
        <Panel title="Tải tài liệu lên" className="xl:col-span-3">
          <details open={!structure} className="rounded-lg border bg-background p-3">
            <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">
              {structure ? "Đổi tài liệu đã tải lên" : "Bước 1 · Tải tài liệu hoặc nhập văn bản"}
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
                Chọn ảnh tài liệu
              </Button>
              <Button type="button" variant="outline" disabled={busy}
                onClick={() => documentInput.current?.click()}>
                Chọn PDF/Word/TXT
              </Button>
            </div>
            <span className="text-xs text-muted-foreground mt-3">
              Tối đa 12 ảnh JPG/PNG/WEBP hoặc một tệp PDF/DOC/DOCX/ODT/TXT/MD/CSV/RTF/HTML · mỗi tệp tối đa 10MB
            </span>
            <input
              ref={imageInput}
              aria-label="Chọn ảnh tài liệu"
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
              aria-label="Chọn tệp PDF, Word hoặc văn bản"
              disabled={busy}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.odt,.txt,.md,.csv,.rtf,.html,.htm"
              onChange={(e) => {
                chooseFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            </div>
          </details>
          {images.length > 0 && (
            <details className="mt-4 rounded-lg border bg-background p-3" open={!structure}>
              <summary className="cursor-pointer text-sm font-semibold">Kiểm tra thứ tự trang · {images.length} ảnh</summary>
              <div className="mt-3 space-y-3" aria-label="Thứ tự ảnh của bộ đề">
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
            </details>
          )}
          {file && (
            <div className="mt-4 rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-secondary" />
                <span className="truncate">{file}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {structure?.parts.length ?? 0} phần · {structure?.parts.reduce((total, part) => total + part.questions.length, 0) ?? 0} câu
              </p>
              {structure && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={openCurrentDetail}>Xem bản tách</Button>}
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
            {!structure && <details className="rounded-md border p-3" open>
              <summary className="cursor-pointer text-sm font-medium">
                Nhập văn bản tài liệu
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
      setSelectedIds([]);
                    setPrompt("");
                  }}
                  placeholder="Nhập đề trực tiếp hoặc kiểm tra văn bản từ tệp…"
                  maxLength={150000}
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                Dùng khi em muốn dán nội dung trực tiếp thay vì tải tệp lên.
              </p>
            </details>}
            {!structure && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void analyze()}
                disabled={busy || text.trim().length < 15}>
                Tách phần và câu hỏi
              </Button>
            )}
            {structure && (
              <section className="rounded-xl border bg-muted/10 p-3" aria-label="Chọn câu để học">
                <button type="button" aria-expanded={questionsOpen} aria-controls="question-picker-content"
                  onClick={() => setQuestionsOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm font-semibold hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary">
                  <span>Chọn câu để học · {structure.parts.reduce((total, part) => total + part.questions.length, 0)} câu · Đã chọn {selectedIds.length}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                    {questionsOpen ? "Thu gọn" : "Mở ra"}
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${questionsOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                <div id="question-picker-content" hidden={!questionsOpen} className="mt-4 space-y-5" aria-label="Cấu trúc bộ đề">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                  <div>
                    <h2 className="text-lg font-semibold">{sourceOnly ? "Học theo nội dung tài liệu" : "Chọn câu để học"}</h2>
                    <p className="text-sm text-muted-foreground">{sourceOnly ? "Chưa tìm thấy câu hỏi rõ ràng. Em có thể học theo toàn bộ nội dung đầu vào." : `Đã tách ${structure.parts.length} phần · ${structure.parts.reduce((total, part) => total + part.questions.length, 0)} câu`}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-sm font-medium">Đã chọn <span className="text-primary">{selectedIds.length}</span> {sourceOnly ? "tài liệu" : "câu"}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelectedIds(structure.parts.flatMap((part) => part.questions.map((question) => question.id)))}>Chọn tất cả</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>Bỏ chọn</Button>
                  </div>
                </div>
                <div className={`grid gap-5 lg:items-start ${questionListOpen ? "lg:grid-cols-[minmax(220px,290px)_minmax(0,1fr)]" : "lg:grid-cols-1"}`}>
                  <nav className="space-y-3" aria-label="Danh sách câu hỏi">
                    <div className="sticky top-2 z-10 flex items-center justify-between gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur-sm">
                      <span className="px-1 text-sm font-semibold">Danh sách câu hỏi</span>
                      <Button type="button" size="sm" variant="outline" aria-expanded={questionListOpen} aria-controls="question-list-content"
                        aria-label={questionListOpen ? "Thu gọn danh sách câu hỏi" : "Mở danh sách câu hỏi"}
                        onClick={() => setQuestionListOpen((open) => !open)}>
                        {questionListOpen ? "Thu gọn" : "Mở danh sách"}
                        <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${questionListOpen ? "rotate-180" : ""}`} />
                      </Button>
                    </div>
                    <div id="question-list-content" hidden={!questionListOpen} className="space-y-4">
                    {structure.parts.map((part) => (
                      <div key={part.id} className="overflow-hidden rounded-xl border bg-background">
                        <h3 className="border-b bg-muted/50 px-4 py-3 text-sm font-semibold">{part.title}</h3>
                        <div className="space-y-1 p-2">
                          {part.questions.map((question) => {
                            const active = selectedQuestion?.id === question.id;
                            return (
                              <div key={question.id} className={`flex items-start gap-2 rounded-lg border px-3 py-3 transition-colors ${active ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/50"}`}>
                                <input type="checkbox" aria-label={`Chọn ${question.label}`} checked={selectedIds.includes(question.id)} onChange={() => toggleQuestion(question.id)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                                <button type="button" aria-current={active ? "true" : undefined}
                                  onClick={() => selectQuestion(question)}
                                  className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-primary">
                                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                                  <span>{question.label}</span>
                                  {question.points && <span className="text-xs font-medium text-muted-foreground">{question.points}</span>}
                                </span>
                                <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{formatProse(question.task || question.text)}</span>
                                {question.materials && <span className="mt-2 inline-block rounded bg-background/80 px-2 py-0.5 text-[11px] font-medium text-primary">Có ngữ liệu riêng</span>}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    </div>
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
                      {selectedQuestion.task ? (
                        <section aria-label="Yêu cầu của câu hỏi" className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">01 · Yêu cầu cần làm</h4>
                          <p className="mt-3 max-w-prose whitespace-pre-wrap text-base font-medium leading-7 text-foreground">{formatProse(selectedQuestion.task)}</p>
                        </section>
                      ) : (
                        <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">Tài liệu này không có câu hỏi tường minh. Nội dung gốc được giữ nguyên bên dưới để em đọc và đặt câu hỏi học tập.</p>
                      )}
                      {selectedIdea && (
                        <section className="rounded-lg border border-primary/30 p-4" aria-label="Ý nhỏ đang chọn">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Ý {selectedIdea.label} đang chọn</h4>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{selectedIdea.text}</p>
                        </section>
                      )}
                      {selectedQuestion.materials && (
                        <section aria-label="Ngữ liệu đi kèm" className="rounded-lg border bg-muted/30 p-4 sm:p-5">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/70">{selectedQuestion.task ? "02 · Ngữ liệu đi kèm" : "Nội dung tài liệu"}</h4>
                          {selectedQuestion.task && <p className="mt-1 text-xs text-muted-foreground">Dùng để phân tích hoặc làm dẫn chứng; đây không phải yêu cầu cần trả lời.</p>}
                          <div className="mt-4 min-w-0 rounded-md border bg-background p-4" aria-label="Nội dung ngữ liệu riêng">
                            {classifyTextLayout(selectedQuestion.materials, selectedQuestion.task || selectedQuestion.text) === "poetry"
                              ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{selectedQuestion.materials}</p>
                              : <div className="space-y-4">{splitProseParagraphs(selectedQuestion.materials).map((paragraph, index) => (
                                <p key={index} className="w-full break-words text-sm leading-7">{paragraph}</p>
                              ))}</div>}
                          </div>
                        </section>
                      )}
                      {sharedParagraphs.length > 0 && (
                        <details className="group rounded-lg border bg-background p-4">
                          <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">
                            03 · Đọc ngữ liệu chung của phần này ({sharedParagraphs.length} mục)
                          </summary>
                          <p className="mt-2 text-xs text-muted-foreground">Các đoạn liên quan được hiển thị riêng để em đọc và đối chiếu với câu hỏi.</p>
                          <div className={sourceParagraphListClass(sharedSourceLayout)} aria-label={`Ngữ liệu của ${selectedPart.title}`}>
                            {sharedParagraphs.map((paragraph) => {
                              const marker = /^\((\d{1,2})\)\s*/.exec(paragraph.text);
                              const content = marker ? paragraph.text.slice(marker[0].length) : paragraph.text;
                              return (
                                <div key={paragraph.id} className="w-full min-w-0 rounded-lg border border-l-2 border-l-primary/40 bg-muted/20 p-4">
                                  {marker && <p className="mb-1 text-xs font-bold text-primary">Đoạn {marker[1]}</p>}
                                  <p className={`break-words text-sm leading-7 text-foreground ${sharedSourceLayout === "poetry" ? "whitespace-pre-wrap" : "w-full"}`}>{sharedSourceLayout === "poetry" ? content : formatProse(content)}</p>
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
                      <p className="text-sm text-muted-foreground">Em có thể kiểm tra và sửa nội dung trong bản tách trước khi bắt đầu.</p>
                    </article>
                  )}
                </div>
                </div>
              </section>
            )}
            <Button
              className="w-full"
              type="submit"
              disabled={busy || !structure || selectedIds.length === 0 || title.trim().length < 5}
            >
              {busy ? "Đang xử lý…" : sourceOnly || selectedBlockId ? "Bắt đầu học với nội dung này" : `Bắt đầu học với ${selectedIds.length} câu`}
            </Button>
          </form>
        </Panel>
        <div className="xl:col-span-3 space-y-4">
          <details className="rounded-lg border bg-card p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-semibold">Lịch sử tài liệu · {documentsQuery.data?.length ?? 0}</summary>
            <div className="mt-4">
            {documentsQuery.isPending ? <p className="text-sm text-muted-foreground">Đang tải lịch sử…</p> : documentsQuery.error ? <ApiState loading={false} error={documentsQuery.error} retry={documentsQuery.refetch} /> : documentsQuery.data?.length ? (
              <div className="space-y-3">
                {documentsQuery.data.map((document) => (
                  <article key={document.document_id} className="rounded-xl border bg-background p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{document.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{document.filename} · {document.page_count || "—"} trang · {document.part_count} phần · {document.question_count} câu</p>
                      </div>
                      {document.status === "failed" && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">Không đọc được</span>}
                    </div>
                    <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void openDocumentDetail(document.document_id)}>
                      Xem bản tách
                    </Button>
                  </article>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Chưa có tài liệu nào được tách.</p>}
            </div>
          </details>
        </div>
      </div>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5 pr-14">
            <DialogTitle>Bản tách nội dung</DialogTitle>
            <DialogDescription>
              {detailDocument?.title ?? "Tài liệu"} · {detailDocument?.pages?.length ?? detailDocument?.page_count ?? 0} trang · {detailPartCount} phần · {detailQuestionCount} câu
            </DialogDescription>
            {detailEditable && <p className="text-xs text-muted-foreground">Sửa trực tiếp yêu cầu và ngữ liệu dưới đây. Ngữ liệu dùng chung sẽ cập nhật ở mọi câu liên quan. Thay đổi dùng cho phiên học sắp tạo, chưa lưu vào lịch sử tài liệu.</p>}
          </DialogHeader>
          {detailLoading ? (
            <div className="grid min-h-[420px] place-items-center p-8 text-sm text-muted-foreground">Đang tải bản tách…</div>
          ) : detailDocument ? (
            <div className="grid max-h-[min(78vh,760px)] min-h-[520px] lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="overflow-y-auto border-b bg-muted/20 p-4 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cấu trúc tài liệu</p>
                <div className="space-y-4">
                  {detailStructure?.parts.map((part) => (
                    <div key={part.id}>
                      <p className="mb-1 px-2 text-xs font-semibold text-foreground">{part.title}</p>
                      <div className="space-y-1">
                        {filterSourceParagraphs(part.paragraphs).length > 0 && (
                          <button type="button" onClick={() => setDetailSelection(part.id)} className={`w-full rounded-md px-2 py-2 text-left text-xs ${detailSelection === part.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                            Ngữ liệu chung · {filterSourceParagraphs(part.paragraphs).length} đoạn
                          </button>
                        )}
                        {part.questions.map((question) => (
                          <button key={question.id} type="button" onClick={() => setDetailSelection(question.id)} className={`w-full rounded-md px-2 py-2 text-left text-xs ${detailSelection === question.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                            {question.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!detailStructure?.parts.length && <p className="text-xs text-muted-foreground">Chưa phát hiện câu hỏi cụ thể.</p>}
                </div>
              </aside>
              <section className="min-w-0 overflow-y-auto p-5 sm:p-7">
                {detailQuestion ? (
                  <div className="mx-auto max-w-3xl space-y-5">
                    <div className="border-b pb-4">
                      <p className="text-xs font-medium text-muted-foreground">{detailPart?.title}</p>
                      <h3 className="mt-1 text-xl font-semibold">{detailQuestion.label}</h3>
                    </div>
                    <section className="rounded-xl border border-primary/25 bg-primary/5 p-5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Yêu cầu cần làm</p>
                      {detailEditable ? (
                        <Textarea aria-label={`Sửa yêu cầu ${detailQuestion.label}`} className="mt-3 min-h-28 bg-background text-base leading-7"
                          value={detailQuestion.task || detailQuestion.text}
                          onChange={(event) => editExtractedQuestion(detailQuestion.id, "task", event.target.value)} />
                      ) : <p className="mt-3 whitespace-pre-wrap text-base leading-7">{formatProse(detailQuestion.task || detailQuestion.text)}</p>}
                    </section>
                    <section className="rounded-xl border p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ngữ liệu liên quan</p>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{detailPart && filterSourceParagraphs(detailPart.paragraphs).length ? `Ngữ liệu chung · Trang ${detailQuestion.source_pages.join(", ") || "—"}` : "Không có ngữ liệu riêng"}</span>
                      </div>
                      {detailEditable && detailQuestion.materials ? (
                        <Textarea aria-label={`Sửa ngữ liệu của ${detailQuestion.label}`} className="mt-4 min-h-64 bg-background text-sm leading-7"
                          value={detailQuestion.materials}
                          onChange={(event) => editExtractedQuestion(detailQuestion.id, "materials", event.target.value)} />
                      ) : detailEditable && detailParagraphs.length > 0 ? (
                        <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto">
                          {detailParagraphs.map((paragraph, index) => (
                            <label key={paragraph.id} className="block text-xs font-medium text-muted-foreground">
                              Đoạn {index + 1}
                              <Textarea className="mt-1 min-h-28 bg-background text-sm leading-7" value={paragraph.text}
                                onChange={(event) => editExtractedParagraph(paragraph.id, event.target.value)} />
                            </label>
                          ))}
                        </div>
                      ) : detailSourceText ? (
                        <div className="mt-4 max-h-[30rem] overflow-y-auto rounded-lg border bg-background p-4">
                          {classifyTextLayout(detailSourceText, detailQuestion.task || detailQuestion.text) === "poetry"
                            ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{detailSourceText}</p>
                            : <div className="space-y-4">{splitProseParagraphs(detailSourceText).map((paragraph, index) => (
                              <p key={index} className="break-words text-sm leading-7">{paragraph}</p>
                            ))}</div>}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">Chưa tìm thấy ngữ liệu liên quan trong bản tách này.</p>
                      )}
                    </section>
                  </div>
                ) : detailParagraphs.length > 0 || Boolean(detailDocument.text) ? (
                  <div className="mx-auto max-w-3xl space-y-5">
                    <div className="border-b pb-4">
                      <p className="text-xs font-medium text-muted-foreground">Ngữ liệu tham khảo</p>
                      <h3 className="mt-1 text-xl font-semibold">Ngữ liệu chung</h3>
                    </div>
                    {detailEditable && detailParagraphs.length > 0 ? (
                      <div className="space-y-4">
                        {detailParagraphs.map((paragraph, index) => (
                          <label key={paragraph.id} className="block text-xs font-medium text-muted-foreground">
                            Đoạn {index + 1}
                            <Textarea className="mt-1 min-h-28 bg-background text-sm leading-7" value={paragraph.text}
                              onChange={(event) => editExtractedParagraph(paragraph.id, event.target.value)} />
                          </label>
                        ))}
                      </div>
                    ) : visibleDetailParagraphs.length > 0 ? (
                      <div className="space-y-6">
                        {visibleDetailParagraphs.map((paragraph, index) => (
                          <div key={paragraph.id} className="border-l-2 border-primary/40 pl-4">
                            <p className="mb-1 text-xs font-bold text-primary">Đoạn {index + 1}</p>
                            <p className="whitespace-pre-wrap break-words text-sm leading-7">{classifyTextLayout(visibleDetailParagraphs.map((item) => item.text).join("\n")) === "poetry"
                              ? paragraph.text : formatProse(paragraph.text)}</p>
                          </div>
                        ))}
                      </div>
                    ) : <p className="whitespace-pre-wrap break-words text-sm leading-7">{classifyTextLayout(detailDocument.text ?? "") === "poetry"
                      ? detailDocument.text : splitProseParagraphs(detailDocument.text ?? "").join("\n\n")}</p>}
                  </div>
                ) : (
                  <div className="mx-auto max-w-xl rounded-xl border border-dashed p-8 text-center">
                    <p className="font-semibold">Chưa phát hiện câu hỏi cụ thể</p>
                    <p className="mt-2 text-sm text-muted-foreground">Tài liệu vẫn có thể được dùng để học theo nội dung.</p>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
