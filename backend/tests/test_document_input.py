import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app
from backend.app.jobs import JobQueue
from backend.app.extraction import extract_image_archive
from backend.app.schemas import MultiAssignmentInput


@pytest.fixture
def client(database, tmp_path, authorize):
    with TestClient(create_app(database.path, storage_path=tmp_path / "uploads")) as api:
        authorize(api)
        yield api


def test_text_review_survives_reopening_and_is_private(client, database, tmp_path, authorize):
    text = "Hãy phân tích vai trò của dẫn chứng trong bài nghị luận."
    result = client.post("/api/documents/text", json={"title": "Đề bài nhập tay", "text": text, "mode": "single"})
    assert result.status_code == 201
    doc = result.json()
    assert doc["structure"]["parts"][0]["questions"][0]["task"] == text
    question = doc["structure"]["parts"][0]["questions"][0]
    assert doc["review"]["selected_ids"] == [question["id"]]
    question.update(task="Yêu cầu đã chỉnh sửa", context="Yêu cầu đã chỉnh sửa")
    review = {"title": "Đề bài đã kiểm tra", "text": text, "structure": doc["structure"],
              "selected_ids": [question["id"]], "mode": "single"}
    assert client.put(f"/api/documents/{doc['document_id']}/review", json=review).status_code == 200
    saved = client.get(f"/api/documents/{doc['document_id']}").json()
    assert saved["structure"]["parts"][0]["questions"][0]["task"] == "Yêu cầu đã chỉnh sửa"
    assert saved["review"]["selected_ids"] == [question["id"]]
    assert client.get("/api/documents").json()[0]["title"] == "Đề bài đã kiểm tra"
    assert client.get(f"/api/documents/{doc['document_id']}/original").content == text.encode()
    with TestClient(create_app(database.path, storage_path=tmp_path / "uploads")) as other:
        authorize(other, email="other-student@example.com")
        assert other.get(f"/api/documents/{doc['document_id']}").status_code == 404
        assert other.get(f"/api/documents/{doc['document_id']}/original").status_code == 404
        assert other.put(f"/api/documents/{doc['document_id']}/review", json=review).status_code == 404


def test_image_batch_is_queued_with_originals_and_order(database, tmp_path, authorize, monkeypatch):
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    storage = tmp_path / "images"
    pictures = []
    for color in ("white", "black"):
        stream = io.BytesIO()
        Image.new("RGB", (20, 20), color).save(stream, format="PNG")
        pictures.append(stream.getvalue())
    with TestClient(create_app(database.path, storage_path=storage)) as api:
        authorize(api)
        result = api.post("/api/uploads/extract-batch", files=[
            ("files", ("second.png", pictures[1], "image/png")),
            ("files", ("first.png", pictures[0], "image/png"))])
        assert result.status_code == 202
        queue = JobQueue(database, storage)
        job = queue.claim()
        original = queue.read_file(job)
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            assert archive.read("01.png") == pictures[1]
            assert archive.read("02.png") == pictures[0]
        monkeypatch.setattr("backend.app.extraction._ocr_image", lambda image: (
            "Câu 1. Đề từ ảnh thứ hai." if image.getpixel((0, 0))[0] == 0 else "Câu 2. Đề từ ảnh thứ nhất.", 90))
        extracted = extract_image_archive(original)
        assert extracted["text"].index("Câu 1") < extracted["text"].index("Câu 2")
        assert queue.finish(job, text=extracted["text"], pages=extracted["pages"], warnings=extracted["warnings"])
        assert api.get(f"/api/documents/{result.json()['document_id']}").json()["status"] == "needs_review"


def test_multi_assignment_rejects_pending_document(client):
    pending = client.post("/api/documents", files={"file": ("de.txt", b"A sufficiently long source text.")}).json()
    result = client.post("/api/learning/assignments", json={"title": "Tài liệu đang chờ", "document_id": pending["document_id"],
        "items": [{"label": "Câu 1", "prompt": "Yêu cầu học"}]})
    assert result.status_code == 409


def test_large_source_can_be_saved_without_truncation(client):
    text = "x" * 60000
    doc = client.post("/api/documents/text", json={"text": text, "mode": "single"}).json()
    q = doc["structure"]["parts"][0]["questions"][0]
    body = {"title": "Tài liệu dài", "document_id": doc["document_id"], "source_text": text,
            "prompt": q["task"], "items": [{"label": q["label"], "prompt": q["task"], "context": q["context"]}]}
    MultiAssignmentInput(**body)
    response = client.post("/api/learning/assignments", json=body)
    assert response.status_code == 201
    assert len(response.json()["items"][0]["prompt"]) == 60000


def test_structure_rejects_pages_from_an_older_text_revision(client):
    response = client.post("/api/uploads/structure", json={"text": "Nội dung mới đã được sửa.",
        "pages": [{"number": 1, "label": "Trang 1", "text": "Nội dung của bản cũ."}]})
    assert response.status_code == 422


def test_failed_extraction_keeps_original_and_can_retry_without_reupload(client, monkeypatch):
    from backend.app.extraction import ExtractionError
    text = b"Cau 1. A complete request for studying a passage."
    with monkeypatch.context() as failure:
        def fail(*args):
            raise ExtractionError("Temporary extraction failure")
        failure.setattr("backend.app.main.extract_document", fail)
        assert client.post("/api/uploads/extract", files={"file": ("retry-document.txt", text)}).status_code == 422
    doc = client.get("/api/documents").json()[0]
    assert doc["status"] == "failed"
    assert client.get(f"/api/documents/{doc['document_id']}/original").content == text
    assert client.post(f"/api/documents/{doc['document_id']}/retry").status_code == 202
    assert client.get(f"/api/documents/{doc['document_id']}").json()["status"] == "needs_review"
    assert client.post(f"/api/documents/{doc['document_id']}/retry").status_code == 409


def test_review_keeps_all_questions_when_only_a_subset_is_selected(client):
    text = "I. ĐỌC HIỂU\nNgữ liệu dùng chung.\n" + "\n".join(f"Câu {i}. Nêu một nhận xét." for i in range(1, 102))
    doc = client.post("/api/documents/text", json={"text": text, "mode": "auto"}).json()
    selected = doc["structure"]["parts"][0]["questions"][0]["id"]
    response = client.put(f"/api/documents/{doc['document_id']}/review", json={
        "title": "Bộ đề nhiều câu", "text": text, "structure": doc["structure"], "selected_ids": [selected], "mode": "auto"})
    assert response.status_code == 200
    assert len(response.json()["structure"]["parts"][0]["questions"]) == 101


def test_quick_start_automatically_creates_one_task_with_separate_materials(client):
    prompt = "Hãy phân tích vai trò của dẫn chứng trong bài nghị luận."
    materials = "Đoạn trích cần được giữ nguyên để học sinh đối chiếu."
    response = client.post("/api/learning/quick-start", json={"prompt": prompt, "materials": materials})
    assert response.status_code == 201
    assignment = response.json()
    assert len(assignment["items"]) == 1
    assert assignment["title"] == prompt
    assert assignment["items"][0]["prompt"] == prompt
    assert materials in assignment["items"][0]["context"]
    assert not assignment["items"][0]["metadata"]["source_only"]
    assert client.post("/api/sessions", json={"assignment_id": assignment["id"]}).status_code == 200
    reviewed = client.get(f"/api/documents/{assignment['document_id']}").json()
    assert reviewed["review"]["selected_ids"]


def test_quick_start_excludes_answer_keys_from_task_and_materials(client):
    response = client.post("/api/learning/quick-start", json={
        "prompt": "Phân tích ý nghĩa của việc đọc sách.\nĐÁP ÁN\nSECRET_TASK_ANSWER",
        "materials": "Ngữ liệu cần dùng để học.\nĐÁP ÁN\nSECRET_SOURCE_ANSWER"})
    assert response.status_code == 201
    item = response.json()["items"][0]
    assert "SECRET_" not in item["prompt"]
    assert "SECRET_" not in item["context"]
    assert "Ngữ liệu cần dùng" in item["context"]


def test_quick_start_validates_prompt_and_total_size(client):
    assert client.post("/api/learning/quick-start", json={"prompt": ""}).status_code == 422
    assert client.post("/api/learning/quick-start", json={"prompt": "x" * 100000, "materials": "x" * 60000}).status_code == 422
