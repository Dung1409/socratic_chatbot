"""Provider-neutral document understanding adapter.

Extraction depends on this module instead of a vendor SDK. Set
DOCUMENT_AI_PROVIDER to ``openai`` for production (GPT-5 mini) or ``gemini``
for the local Gemini path.
"""

import base64
import json
import os

from . import gemini


def provider() -> str:
    return os.getenv("DOCUMENT_AI_PROVIDER", "gemini").strip().lower()


def enabled() -> bool:
    if provider() == "openai":
        return bool(os.getenv("OPENAI_API_KEY", "").strip())
    return gemini.enabled()


def _openai_request(batch: list[dict]) -> tuple[dict[str, dict], list[dict]]:
    from openai import OpenAI

    content = [{"type": "text", "text": gemini.INSTRUCTION + gemini.TAG_INSTRUCTION}]
    for unit in batch:
        content.append({"type": "text", "text": f"Đơn vị {unit['id']} (trang/ảnh {unit['number']}):"})
        if "image" in unit:
            content.append({"type": "image_url", "image_url": {
                "url": "data:image/jpeg;base64," + base64.b64encode(unit["image"]).decode("ascii")
            }})
        else:
            content.append({"type": "text", "text": unit["text"] or "[Trang không có chữ]"})
    try:
        with OpenAI(timeout=110, max_retries=0) as client:
            response = client.chat.completions.create(
                model=os.getenv("DOCUMENT_AI_MODEL", "gpt-5-mini"),
                messages=[{"role": "user", "content": content}],
                response_format={"type": "json_object"},
            )
        parsed = json.loads(response.choices[0].message.content or "{}")
        values = parsed["units"]
        expected = {unit["id"] for unit in batch}
        if (not isinstance(values, list) or len(values) != len(batch)
                or {item.get("id") for item in values} != expected):
            raise ValueError("Document AI returned incomplete units")
        return {item["id"]: {"text": item["text"].strip(), "tags": item.get("tags", [])}
                for item in values}, parsed.get("uncertain", [])
    except Exception as exc:
        raise ValueError("Document AI request failed") from exc


def _apply(pages, images, request):
    replacements = {}
    warnings = []
    for batch in gemini._batches(gemini._pieces(pages, images)):
        try:
            values, uncertain = request(batch)
            replacements.update(values)
            for item in uncertain if isinstance(uncertain, list) else []:
                if isinstance(item, dict) and item.get("id"):
                    warnings.append(f"AI chưa chắc chữ ở {item['id']}; hãy đối chiếu bản gốc.")
        except ValueError:
            warnings.append("AI không xử lý được một số đơn vị; đã giữ bản trích xuất cục bộ.")
    result = []
    for page in pages:
        pieces = [unit for unit in gemini._pieces([page], images) if unit["id"] in replacements]
        all_units = list(gemini._pieces([page], images))
        if pieces and len(pieces) == len(all_units):
            values = [replacements[unit["id"]] for unit in pieces]
            text = "\n".join(value["text"] for value in values if value["text"]).strip()
            if text:
                tags, seen = [], set()
                for value in values:
                    for tag in value.get("tags", []):
                        if isinstance(tag, dict) and tag.get("id") not in seen:
                            tags.append(tag)
                            seen.add(tag["id"])
                result.append({**page, "text": text, "method": provider(), "confidence": None,
                               **({"tags": tags} if tags else {})})
                continue
        result.append(page)
    if any(page["method"] == provider() for page in result):
        warnings.append(f"Nội dung đã được {provider()} đọc và gắn nhãn; vẫn cần xác nhận.")
    return result, warnings


def improve_pages(pages, images=None):
    images = images or {}
    if not enabled():
        return pages, []
    if provider() == "openai":
        return _apply(pages, images, _openai_request)
    return gemini.improve_pages(pages, images)
