import io
import zipfile
from pathlib import Path

MAX_FILE_BYTES = 10 * 1024 * 1024


class ExtractionError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def validate_upload(filename: str, data: bytes):
    if Path(filename).suffix.lower() not in {".txt", ".pdf", ".docx"}:
        raise ExtractionError("Chỉ hỗ trợ TXT, PDF có chữ và DOCX. Ảnh và PDF scan cần OCR, chưa được hỗ trợ.", 415)
    if len(data) > MAX_FILE_BYTES:
        raise ExtractionError("Tệp vượt quá 10MB", 413)


def extract_text(filename: str, data: bytes) -> str:
    validate_upload(filename, data)
    try:
        suffix = Path(filename).suffix.lower()
        if suffix == ".txt":
            text = data.decode("utf-8-sig")
        elif suffix == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted or len(reader.pages) > 30:
                raise ExtractionError("PDF phải không mã hóa và tối đa 30 trang")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            from docx import Document
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if len(archive.infolist()) > 1000 or sum(i.file_size for i in archive.infolist()) > 30 * 1024 * 1024:
                    raise ExtractionError("DOCX có kích thước giải nén quá lớn")
            doc = Document(io.BytesIO(data))
            text = "\n".join([p.text for p in doc.paragraphs] + [cell.text for table in doc.tables for row in table.rows for cell in row.cells])
        text = text.strip()
        if len(text) < 15:
            raise ExtractionError("Không đủ văn bản để tạo đề. PDF scan cần OCR; hãy nhập nội dung trực tiếp.")
        if len(text) > 30000:
            raise ExtractionError("Nội dung quá dài (tối đa 30.000 ký tự); hãy chia nhỏ đề bài.")
        return text
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("Không đọc được tệp. Kiểm tra định dạng và thử lại.") from exc


if __name__ == "__main__":
    import json
    import sys
    from .config import positive_integer

    if sys.platform == "linux":
        import resource
        memory = positive_integer("WORKER_PARSER_MEMORY_MB", 512) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))

    # Only the file extension is an argument; content travels over stdin and is
    # never logged. The parent worker enforces the process execution deadline.
    try:
        output = {"text": extract_text("document" + sys.argv[1], sys.stdin.buffer.read(MAX_FILE_BYTES + 1))}
    except ExtractionError as error:
        output = {"error": str(error), "status_code": error.status_code}
    sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False).encode("utf-8"))
