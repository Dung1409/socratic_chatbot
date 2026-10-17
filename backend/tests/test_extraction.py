import io

import pytest
from PIL import Image
from pypdf import PdfWriter

from backend.app import extraction


def test_image_ocr_keeps_source_and_low_confidence_warning(monkeypatch):
    image = Image.new("RGB", (500, 300), "white")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    monkeypatch.setattr(extraction, "_ocr_image", lambda _: ("Câu 1. Em hãy đọc đoạn văn sau.", 54.0))
    result = extraction.extract_document("trang-1.png", stream.getvalue())
    assert result["pages"][0]["method"] == "ocr"
    assert result["pages"][0]["confidence"] == 54.0
    assert result["warnings"]
    assert any("dù điểm tin cậy cao" in warning for warning in result["warnings"])


def test_scan_pdf_uses_ocr_per_page(monkeypatch):
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    stream = io.BytesIO()
    writer.write(stream)
    monkeypatch.setattr(extraction, "_ocr_image", lambda _: ("Câu 1. Nêu ý chính của văn bản.", 88.0))
    result = extraction.extract_document("de.pdf", stream.getvalue())
    assert result["pages"][0]["label"] == "Trang 1"
    assert result["pages"][0]["method"] == "ocr"


def test_invalid_image_and_missing_ocr_are_actionable(monkeypatch):
    with pytest.raises(extraction.ExtractionError, match="PNG không hợp lệ"):
        extraction.extract_document("fake.png", b"not an image")
    image = Image.new("RGB", (500, 300), "white")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    import pytesseract
    def missing(*_, **__):
        raise pytesseract.TesseractNotFoundError()
    monkeypatch.setattr(pytesseract, "image_to_data", missing)
    with pytest.raises(extraction.ExtractionError, match="Tesseract"):
        extraction.extract_document("real.png", stream.getvalue())
