"""The default document path uses OpenAI for extracted content."""

import io

from PIL import Image

from backend.app import document_ai, extraction


def test_openai_is_default_document_provider(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    seen = []

    def fake_request(batch):
        seen.extend(unit["id"] for unit in batch)
        return ({unit["id"]: {"text": "Câu 1. Phân tích nhân vật trong tác phẩm.", "tags": []}
                 for unit in batch}, [])

    monkeypatch.setattr(document_ai, "_openai_request", fake_request)
    result = extraction.extract_document("de.txt", b"Cau 1. Phan tich nhan vat trong tac pham.")

    assert document_ai.provider() == "openai"
    assert seen
    assert result["pages"][0]["method"] == "openai"
    assert result["text"] == "Câu 1. Phân tích nhân vật trong tác phẩm."


def test_openai_receives_uploaded_image(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("backend.app.visual_layout.analyze_question_document", lambda _pages: {
        "subject_group": "literature", "subject_hint": "Ngữ văn", "subject_uncertain": False,
        "pages": {1: {"questions": []}}, "unresolved_regions": [],
    })
    seen = []

    def fake_request(batch):
        seen.extend(batch)
        return ({unit["id"]: {"text": "Câu 1. Đọc đoạn văn và trả lời.", "tags": []}
                 for unit in batch}, [])

    monkeypatch.setattr(document_ai, "_openai_request", fake_request)
    image = io.BytesIO()
    Image.new("RGB", (200, 100), "white").save(image, format="PNG")

    result = extraction.extract_image_batch([("de.png", image.getvalue())])

    assert len(seen) == 1 and seen[0]["image"].startswith(b"\xff\xd8")
    assert result["pages"][0]["method"] == "openai"
