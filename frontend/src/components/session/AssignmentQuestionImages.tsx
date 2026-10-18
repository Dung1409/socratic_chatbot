export function AssignmentQuestionImages({
  documentId,
  visualIds,
}: {
  documentId?: string | null;
  visualIds: string[];
}) {
  if (!documentId || visualIds.length === 0) return null;

  return (
    <section className="mt-4 space-y-3" aria-label="Nội dung câu hỏi bằng ảnh">
      <h3 className="text-sm font-semibold">Nội dung câu hỏi</h3>
      {visualIds.map((visualId, index) => {
        const imageUrl = `/api/documents/${encodeURIComponent(documentId)}/visuals/${encodeURIComponent(visualId)}/image`;
        return (
          <figure key={visualId} className="overflow-hidden rounded-lg border bg-background">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Mở ảnh câu hỏi ${index + 1} kích thước đầy đủ`}
              className="block bg-muted/20 p-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            >
              <img
                src={imageUrl}
                alt={`Ảnh câu hỏi đính kèm ${index + 1}`}
                loading={index === 0 ? "eager" : "lazy"}
                className="max-h-[560px] w-full rounded-md object-contain"
              />
            </a>
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              Ảnh {index + 1} · Chọn ảnh để mở lớn
            </figcaption>
          </figure>
        );
      })}
    </section>
  );
}
