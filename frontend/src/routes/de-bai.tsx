import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FileText, ArrowRight } from "lucide-react";
import { PageHeader, Panel, BloomBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { seo } from "@/lib/seo";
import { BLOOM } from "@/lib/data";

export const Route = createFileRoute("/de-bai")({
  head: () =>
    seo("Đề bài của tôi", "Tải lên hoặc nhập đề Ngữ văn của bạn để tự học cùng gia sư Socratic."),
  component: Page,
});

function Page() {
  const [file, setFile] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [target, setTarget] = useState(4);
  const query = useQuery({ queryKey: ["assignments"], queryFn: api.assignments });
  const client = useQueryClient();
  const navigate = useNavigate();
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đọc được tệp");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (busy || title.trim().length < 5 || text.trim().length < 15) return;
    setBusy(true);
    try {
      const result = await api.createAssignment({
        title: title.trim(),
        prompt: text.trim(),
        target,
        ...(documentId ? { document_id: documentId } : {}),
      });
      await client.invalidateQueries({ queryKey: ["assignments"] });
      await navigate({ to: "/phien-hoc", search: { assignment: result.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được đề bài");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Học sinh"
        title="Đề bài của tôi"
        desc="Tải lên hoặc nhập đề riêng, kiểm tra nội dung và bắt đầu tự học."
      />
      <div className="p-6 lg:p-10 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          {query.isPending || query.error ? (
            <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />
          ) : query.data?.length === 0 ? (
            <Panel title="Chưa có đề tự học">
              <p className="text-sm text-muted-foreground">
                Thêm đề đầu tiên bằng cách tải tệp hoặc nhập nội dung trong biểu mẫu bên cạnh. Đề
                chỉ được lưu sau khi bạn xác nhận nội dung.
              </p>
            </Panel>
          ) : (
            query.data?.map((a) => (
              <Panel key={a.id}>
                <div className="flex flex-col md:flex-row gap-5">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Đề tự học của bạn</p>
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
                      variant={a.status === "Đã hoàn thành" ? "outline" : "default"}
                      size="sm"
                    >
                      <Link to="/phien-hoc" search={{ assignment: a.id }}>
                        {a.status === "Đã hoàn thành" ? "Xem lại phiên học" : "Học với gia sư"}{" "}
                        <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ))
          )}
        </div>
        <Panel title="Thêm đề tự học">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files[0]);
            }}
            className="flex flex-col items-center justify-center text-center border border-dashed rounded-lg py-10 px-4 cursor-pointer hover:bg-muted/50"
          >
            <FileUp className="h-6 w-6 text-primary mb-3" />
            <span className="text-sm font-medium">
              {busy ? "Đang xử lý…" : "Kéo thả hoặc chọn tệp"}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              PDF có chữ, DOCX, TXT · tối đa 10MB
            </span>
            <input
              aria-label="Chọn tệp đề bài"
              disabled={busy}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {file && (
            <div className="mt-4 rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-secondary" />
                <span className="truncate">{file}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Đã trích xuất văn bản. Em hãy kiểm tra và chỉnh sửa bên dưới trước khi bắt đầu.
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
            <label className="block text-sm font-medium">
              Nội dung đề
              <Textarea
                className="mt-1.5 min-h-40"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Nhập đề trực tiếp hoặc kiểm tra văn bản từ tệp…"
                maxLength={30000}
              />
            </label>
            <label className="block text-sm font-medium">
              Mục tiêu luyện tập
              <select
                className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={target}
                onChange={(event) => setTarget(Number(event.target.value))}
              >
                {BLOOM.map((bloom) => (
                  <option key={bloom.level} value={bloom.level}>
                    Bloom {bloom.level} · {bloom.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="w-full"
              type="submit"
              disabled={busy || title.trim().length < 5 || text.trim().length < 15}
            >
              {busy ? "Đang xử lý…" : "Xác nhận đề & bắt đầu học"}
            </Button>
          </form>
          <div className="mt-6 text-xs text-muted-foreground leading-relaxed">
            Bạn chọn mục tiêu luyện tập cho từng đề. Gia sư hiện đặt câu hỏi theo kịch bản; chưa hỗ
            trợ OCR ảnh chụp hoặc tự phân tích đề bằng AI.
          </div>
        </Panel>
      </div>
    </>
  );
}
