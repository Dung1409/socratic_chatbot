"""Provider-neutral document understanding adapter.

Extraction depends on this module instead of a vendor SDK. OpenAI is the
default for images and documents; the Gemini path remains available only
when explicitly selected for legacy use.
"""

import base64
import json
import logging
import os
import time

from . import gemini

logger = logging.getLogger(__name__)


def provider() -> str:
    return os.getenv("DOCUMENT_AI_PROVIDER", "openai").strip().lower()


def enabled() -> bool:
    if provider() == "openai":
        return bool(os.getenv("OPENAI_API_KEY", "").strip())
    return gemini.enabled()


def _openai_request(batch: list[dict]) -> tuple[dict[str, dict], list[dict]]:
    # Keep the vision prompt compact. Asking the model to emit a tag for every
    # line of a full scanned page can make generation take minutes; structural
    # tags are added by the local parser after transcription.
    content = [{"type": "input_text", "text": gemini.INSTRUCTION}]
    for unit in batch:
        content.append({"type": "input_text", "text": f"Đơn vị {unit['id']} (trang/ảnh {unit['number']}):"})
        if "image" in unit:
            content.append({"type": "input_image", "detail": "low", "image_url":
                            "data:image/jpeg;base64," + base64.b64encode(unit["image"]).decode("ascii")})
        else:
            content.append({"type": "input_text", "text": unit["text"] or "[Trang không có chữ]"})
    started = time.perf_counter()
    try:
        from urllib.request import Request, urlopen
        from .config import positive_integer
        body = json.dumps({
            "model": os.getenv("DOCUMENT_AI_MODEL", "gpt-6.1-sol"),
            "input": [{"role": "user", "content": content}],
            "text": {"format": {"type": "json_object"}},
        }, ensure_ascii=False).encode("utf-8")
        request = Request("https://api.openai.com/v1/responses", data=body,
                          headers={"Authorization": "Bearer " + os.getenv("OPENAI_API_KEY", ""),
                                   "Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=positive_integer("DOCUMENT_AI_TIMEOUT_SECONDS", 60)) as response:
            payload = json.load(response)
        raw = payload.get("output_text") or "".join(
            item.get("text", "") for output in payload.get("output", [])
            for item in output.get("content", []) if isinstance(item, dict)
        )
        parsed = json.loads(raw or "{}")
        values = parsed["units"]
        expected = {unit["id"] for unit in batch}
        if (not isinstance(values, list) or len(values) != len(batch)
                or {item.get("id") for item in values} != expected):
            raise ValueError("Document AI returned incomplete units")
        logger.info("Document AI batch completed model=%s units=%d duration_ms=%d",
                    os.getenv("DOCUMENT_AI_MODEL", "gpt-6.1-sol"), len(batch),
                    round((time.perf_counter() - started) * 1000))
        return {item["id"]: {"text": item["text"].strip(), "tags": item.get("tags", []),
                             "subject": item.get("subject") if isinstance(item.get("subject"), str) else None}
                for item in values}, parsed.get("uncertain", [])
    except Exception as exc:
        logger.warning("Document AI batch failed model=%s units=%d duration_ms=%d error=%s",
                       os.getenv("DOCUMENT_AI_MODEL", "gpt-6.1-sol"), len(batch),
                       round((time.perf_counter() - started) * 1000),
                       type(exc).__name__)
        raise ValueError("Document AI request failed") from exc


def _apply(pages, images, request):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    replacements = {}
    warnings = []
    uncertain_ids = []
    started = time.perf_counter()
    from .config import positive_integer
    call_timeout = positive_integer("DOCUMENT_AI_TIMEOUT_SECONDS", 30)
    deadline = time.monotonic() + max(0, positive_integer("WORKER_JOB_TIMEOUT_SECONDS", 300) - 10)
    batches = list(gemini._batches(gemini._pieces(pages, images)))
    logger.info("Document AI extraction started provider=%s model=%s pages=%d batches=%d",
                provider(), os.getenv("DOCUMENT_AI_MODEL", "gpt-6.1-sol"), len(pages), len(batches))
    active = batches if time.monotonic() + call_timeout <= deadline else []
    if not active and batches:
        warnings.append("Đã hết thời gian đọc bằng AI; giữ nội dung trích xuất cục bộ để em kiểm tra.")
    # Page requests are independent; a bounded pool avoids serial network waits.
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(active)))) as pool:
        futures = {pool.submit(request, batch): batch for batch in active}
        for future in as_completed(futures):
            try:
                values, uncertain = future.result()
                replacements.update(values)
                for item in uncertain if isinstance(uncertain, list) else []:
                    if isinstance(item, dict) and item.get("id"):
                        uncertain_ids.append(str(item["id"]))
            except (ValueError, TimeoutError):
                warnings.append("AI không xử lý được một số đơn vị; đã giữ bản trích xuất cục bộ.")
    if uncertain_ids:
        labels = ", ".join(dict.fromkeys(uncertain_ids))
        warnings.append(f"AI chưa chắc chữ ở {labels}; hãy đối chiếu bản gốc.")
    logger.info("Document AI extraction finished provider=%s pages=%d batches=%d successful_units=%d duration_ms=%d",
                provider(), len(pages), len(batches), len(replacements),
                round((time.perf_counter() - started) * 1000))
    result = []
    for page in pages:
        pieces = [unit for unit in gemini._pieces([page], images) if unit["id"] in replacements]
        all_units = list(gemini._pieces([page], images))
        if pieces and len(pieces) == len(all_units):
            values = [replacements[unit["id"]] for unit in pieces]
            text = "\n".join(value["text"] for value in values if value["text"]).strip()
            if text:
                tags, seen = [], set()
                subjects = [value["subject"][:100] for value in values
                            if isinstance(value.get("subject"), str) and value["subject"].strip()]
                for value in values:
                    for tag in value.get("tags", []):
                        if isinstance(tag, dict) and tag.get("id") not in seen:
                            tags.append(tag)
                            seen.add(tag["id"])
                result.append({**page, "text": text, "method": provider(), "confidence": None,
                               **({"subject_hint": subjects[0]} if subjects and len(set(subjects)) == 1 else {}),
                               **({"tags": tags} if tags else {})})
                continue
        result.append(page)
    return result, warnings


def improve_pages(pages, images=None):
    images = images or {}
    if not enabled():
        return pages, []
    if provider() == "openai":
        return _apply(pages, images, _openai_request)
    return gemini.improve_pages(pages, images)
