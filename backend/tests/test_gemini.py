"""Gemini enhancement remains optional and preserves local extraction on error."""

import io

from PIL import Image
from fastapi.testclient import TestClient
import pytest

from backend.app import extraction, gemini
from backend.app.main import create_app
from backend.app.structure import structure_text


@pytest.fixture(autouse=True)
def legacy_gemini_provider(monkeypatch):
    monkeypatch.setenv("DOCUMENT_AI_PROVIDER", "gemini")


def _png() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(output, format="PNG")
    return output.getvalue()


def test_two_images_are_read_together_and_split_into_question_material(monkeypatch):
    monkeypatch.setenv("GG_API_KEY", "test-key")
    seen = []

    def fake_request(batch):
        seen.append([unit["id"] for unit in batch])
        return {
            "p1": "I. ĐỌC HIỂU\nĐọc văn bản:\n(1) Tri thức cần được chia sẻ.\nCâu 1. Theo văn bản, tri thức cần làm gì?",
            "p2": "II. VIẾT\nCâu 1. Nước Mĩ có Steve Jobs.\nTừ gợi dẫn trên, hãy viết đoạn văn nghị luận về sáng tạo.",
        }, []

    monkeypatch.setattr(gemini, "_request", fake_request)
    result = extraction.extract_image_batch([("one.png", _png()), ("two.png", _png())])
    structure = structure_text(result["text"], result["pages"])

    assert seen == [["p1", "p2"]]
    assert [page["method"] for page in result["pages"]] == ["gemini", "gemini"]
    assert [part["title"] for part in structure["parts"]] == ["I. ĐỌC HIỂU", "II. VIẾT"]
    writing = structure["parts"][1]["questions"][0]
    assert writing["materials"] == "Nước Mĩ có Steve Jobs."
    assert writing["task"].startswith("Từ gợi dẫn trên")


def test_text_upload_is_normalized_and_failed_model_keeps_original(monkeypatch):
    monkeypatch.setenv("GG_API_KEY", "test-key")
    original = "Câu 1. Hãy nêu vai trò của tri thức trong xã hội hiện đại."
    monkeypatch.setattr(gemini, "_request", lambda batch: ({"p1-1": original.replace("Hãy", "Em hãy")}, []))
    improved = extraction.extract_document("de.txt", original.encode("utf-8"))
    assert improved["pages"][0]["method"] == "gemini"
    assert "Em hãy" in improved["text"]

    def fail(_batch):
        raise ValueError("upstream unavailable")

    monkeypatch.setattr(gemini, "_request", fail)
    fallback = extraction.extract_document("de.txt", original.encode("utf-8"))
    assert fallback["text"] == original
    assert fallback["pages"][0]["method"] == "text"
    assert any("Gemini không xử lý được" in warning for warning in fallback["warnings"])


def test_image_batch_endpoint_returns_one_combined_document(database, authorize, monkeypatch):
    monkeypatch.setenv("GG_API_KEY", "test-key")
    monkeypatch.setattr(gemini, "_request", lambda batch: ({
        "p1": "I. ĐỌC HIỂU\nĐọc văn bản:\n(1) Chia sẻ tri thức giúp con người học hỏi. Câu chữ rõ ràng.",
        "p2": "Câu 1. Theo văn bản, chia sẻ tri thức giúp con người làm gì?",
    }, []))
    with TestClient(create_app(database.path)) as client:
        authorize(client)
        response = client.post("/api/uploads/extract-batch", files=[
            ("files", ("one.png", _png(), "image/png")),
            ("files", ("two.png", _png(), "image/png")),
        ])
    assert response.status_code == 200
    combined = response.json()["combined"]
    assert len(combined["pages"]) == 2
    assert combined["structure"]["parts"][0]["questions"][0]["label"] == "Câu 1"


def test_long_text_page_is_chunked_without_losing_characters():
    content = ("Một đoạn văn học tập.\n" * 900).strip()
    units = list(gemini._pieces([{"number": 1, "text": content}], {}))
    assert len(units) > 1
    assert "".join(unit["text"] for unit in units) == content
    assert len({unit["id"] for unit in units}) == len(units)
