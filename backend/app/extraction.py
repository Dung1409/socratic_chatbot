"""Read student documents into ordered, reviewable source units.

OCR is local: Tesseract must be installed with Vietnamese language data. The
original upload is retained by the job queue; extraction never sends it to AI.
"""

import io
import os
import unicodedata
import zipfile
from pathlib import Path

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 150_000
MAX_PDF_PAGES = 30
MAX_IMAGE_PIXELS = 20_000_000
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class ExtractionError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def validate_upload(filename: str, data: bytes):
    suffix = Path(filename).suffix.lower()
    if suffix not in {".txt", ".pdf", ".docx", *IMAGE_SUFFIXES}:
        raise ExtractionError("Chỉ hỗ trợ TXT, PDF, DOCX, PNG, JPG/JPEG và WEBP.", 415)
    if not data:
        raise ExtractionError("Tệp rỗng")
    if len(data) > MAX_FILE_BYTES:
        raise ExtractionError("Tệp vượt quá 10MB", 413)
    if suffix == ".pdf" and not data.startswith(b"%PDF-"):
        raise ExtractionError("Tệp PDF không hợp lệ")
    if suffix == ".docx" and not zipfile.is_zipfile(io.BytesIO(data)):
        raise ExtractionError("Tệp DOCX không hợp lệ", 415)
    if suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ExtractionError("Tệp PNG không hợp lệ", 415)
    if suffix in {".jpg", ".jpeg"} and not data.startswith(b"\xff\xd8"):
        raise ExtractionError("Tệp JPG không hợp lệ", 415)
    if suffix == ".webp" and not (data.startswith(b"RIFF") and data[8:12] == b"WEBP"):
        raise ExtractionError("Tệp WEBP không hợp lệ", 415)


def _image(data: bytes):
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise ExtractionError("Ảnh quá lớn để OCR; tối đa 20 triệu điểm ảnh")
        image = ImageOps.exif_transpose(image)
        image.load()
        return image.convert("RGB")
    except ExtractionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ExtractionError("Không đọc được ảnh; hãy kiểm tra định dạng hoặc chụp lại") from exc


def _ocr_image(image) -> tuple[str, float | None]:
    import pytesseract
    from PIL import ImageEnhance, ImageOps
    from pytesseract import Output

    if os.getenv("OCR_TESSERACT_CMD"):
        pytesseract.pytesseract.tesseract_cmd = os.environ["OCR_TESSERACT_CMD"]

    try:
        words = pytesseract.image_to_data(
            image, lang="vie", config="--psm 3", output_type=Output.DICT, timeout=35,
        )
    except pytesseract.TesseractNotFoundError as exc:
        raise ExtractionError("Máy chủ chưa cài Tesseract OCR; cần cài Tesseract và dữ liệu tiếng Việt 'vie'.") from exc
    except (pytesseract.TesseractError, RuntimeError) as exc:
        raise ExtractionError("OCR ảnh thất bại hoặc quá thời gian; hãy thử ảnh rõ hơn.") from exc

    lines = []
    current_key = None
    line_words = []
    line_indexes = []
    scores = []

    def plain(value: str) -> str:
        decomposed = unicodedata.normalize("NFD", value.upper().replace("Đ", "D"))
        return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")

    def accent_count(value: str) -> int:
        return sum(unicodedata.category(char) == "Mn" for char in unicodedata.normalize("NFD", value))

    def flush():
        if line_words:
            value = " ".join(line_words)
            # Short all-caps headings are especially prone to missed Vietnamese
            # accents. Retry only their own crop, never replace unrelated lines.
            if (value.isupper() and 2 <= len(line_words) <= 12 and len(value) <= 80
                    and not any(char.isdigit() for char in value)):
                left = min(words["left"][i] for i in line_indexes)
                top = min(words["top"][i] for i in line_indexes)
                right = max(words["left"][i] + words["width"][i] for i in line_indexes)
                bottom = max(words["top"][i] + words["height"][i] for i in line_indexes)
                crop = image.crop((max(0, left - 15), max(0, top - 15),
                                   min(image.width, right + 15), min(image.height, bottom + 15)))
                prepared = ImageEnhance.Contrast(ImageOps.grayscale(crop)).enhance(1.6)
                try:
                    candidate = " ".join(pytesseract.image_to_string(
                        prepared, lang="vie", config="--psm 6", timeout=10).split())
                    if plain(candidate) == plain(value) and accent_count(candidate) > accent_count(value):
                        value = candidate
                except (pytesseract.TesseractError, RuntimeError):
                    pass
            lines.append(value)
            line_words.clear()
            line_indexes.clear()

    for index, value in enumerate(words["text"]):
        value = value.strip()
        if not value:
            continue
        try:
            confidence = float(words["conf"][index])
        except (ValueError, TypeError):
            confidence = -1
        if confidence < 0:
            continue
        key = (words["block_num"][index], words["par_num"][index], words["line_num"][index])
        if current_key is not None and key != current_key:
            flush()
        current_key = key
        line_words.append(value)
        line_indexes.append(index)
        scores.append(confidence)
    flush()
    return "\n".join(lines).strip(), round(sum(scores) / len(scores), 1) if scores else None


def _pdf_pages(data: bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted or len(reader.pages) > MAX_PDF_PAGES:
        raise ExtractionError("PDF phải không mã hóa và tối đa 30 trang")
    rendered = None
    pages = []
    try:
        for index, page in enumerate(reader.pages):
            text = (page.extract_text() or "").strip()
            method = "text"
            confidence = None
            if len(text) < 15 and (not text or len(page.images) > 0):
                import pypdfium2 as pdfium

                if rendered is None:
                    rendered = pdfium.PdfDocument(data)
                image = rendered[index].render(scale=2).to_pil()
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ExtractionError(f"Trang {index + 1} quá lớn để OCR")
                text, confidence = _ocr_image(image)
                method = "ocr"
            pages.append({"number": index + 1, "label": f"Trang {index + 1}", "text": text,
                          "method": method, "confidence": confidence})
    finally:
        if rendered is not None:
            rendered.close()
    return pages


def _docx_pages(data: bytes):
    from docx import Document

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > 1000 or sum(i.file_size for i in archive.infolist()) > 30 * 1024 * 1024:
            raise ExtractionError("DOCX có kích thước giải nén quá lớn")
    doc = Document(io.BytesIO(data))
    blocks = []
    for block in doc.iter_inner_content():
        if hasattr(block, "rows"):
            blocks.extend(" | ".join(cell.text for cell in row.cells) for row in block.rows)
        else:
            blocks.append(block.text)
    return [{"number": 1, "label": "Tài liệu Word", "text": "\n\n".join(blocks).strip(),
             "method": "text", "confidence": None}]


def extract_document(filename: str, data: bytes) -> dict:
    """Return text and ordered units; never silently discard an unreadable page."""
    validate_upload(filename, data)
    suffix = Path(filename).suffix.lower()
    try:
        if suffix == ".txt":
            text = data.decode("utf-8-sig")
            pages = [{"number": 1, "label": "Tệp TXT", "text": text.strip(),
                      "method": "text", "confidence": None}]
        elif suffix == ".pdf":
            pages = _pdf_pages(data)
        elif suffix == ".docx":
            pages = _docx_pages(data)
        else:
            text, confidence = _ocr_image(_image(data))
            pages = [{"number": 1, "label": "Ảnh 1", "text": text,
                      "method": "ocr", "confidence": confidence}]
        text = "\n\n".join(page["text"] for page in pages if page["text"]).strip()
        if len(text) < 15:
            raise ExtractionError("Không nhận diện đủ chữ; hãy dùng ảnh rõ hơn hoặc nhập nội dung trực tiếp.")
        if len(text) > MAX_TEXT_CHARS:
            raise ExtractionError("Nội dung vượt quá 150.000 ký tự; hãy chia tài liệu thành nhiều bộ đề.")
        warnings = [f"{page['label']} không đọc được chữ; cần kiểm tra bản gốc."
                    for page in pages if not page["text"]]
        if any(page["method"] == "ocr" for page in pages):
            warnings.append("OCR có thể đọc sai dấu hoặc từ dù điểm tin cậy cao; hãy đối chiếu ảnh gốc trước khi học.")
        warnings.extend(f"{page['label']} OCR chưa chắc chắn; cần xem lại chữ."
                        for page in pages if page["confidence"] is not None and page["confidence"] < 65)
        return {"text": text, "pages": pages, "warnings": warnings}
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("Không đọc được tệp. Kiểm tra định dạng và thử lại.") from exc


def extract_text(filename: str, data: bytes) -> str:
    """Compatibility helper for old callers/tests."""
    return extract_document(filename, data)["text"]
