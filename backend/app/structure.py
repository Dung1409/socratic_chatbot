"""Reviewable exam structure: source lines -> parts -> questions -> small ideas.

This module does not interpret student answers or call a model. Anything
excluded from the study context remains visible in ``excluded`` for review.
"""

import re
import unicodedata
from collections import Counter

SECTION = re.compile(
    r"^\s*(?:PHAN\s+)?(?:[IVXILl1]+|\d{1,2})\s*[.):\-–]?\s+"
    r"(?:DOC HIEU|LAM VAN|VIET|TIENG VIET|NGHI LUAN)\b",
    re.IGNORECASE,
)
QUESTION = re.compile(
    r"^\s*(Câu|Bài)\s*(\d{1,3})(?=\s|[:.)\-–]|$)"
    r"(?:\s*\((\d+(?:[,.]\d+)?\s*(?:điểm|diem))\))?"
    r"\s*(?:[:.)\-–]\s*)?(.*)$",
    re.IGNORECASE,
)
INLINE_QUESTION = re.compile(r"(?<=[.!?])\s+(?=(?:Câu|Bài)\s*(?:\d{1,3}|[Šš])\s*[.):])")
OCR_QUESTION_NUMBER = re.compile(r"^(\s*(?:Câu|Bài)\s*)[Šš](?=\s*[.):])")
IDEA = re.compile(r"^\s*(?:\(([a-h])\)|([a-h])[.)])\s+(.+)$", re.IGNORECASE)
ANSWER_KEY = re.compile(r"^\s*(?:ĐÁP ÁN|HƯỚNG DẪN CHẤM|GỢI Ý ĐÁP ÁN|THANG ĐIỂM)\b", re.IGNORECASE)
PAGE_NUMBER = re.compile(r"[:;.,\-–]?\s*(?:trang|page)\s*(\d{1,3})(?:\s*(?:/|trên|of)\s*\d{1,3})?\s*$", re.IGNORECASE)
NUMBERED_PARAGRAPH = re.compile(r"^\s*\((\d{1,2})\)\s+")
PARAGRAPH_REFERENCE = re.compile(r"\bDOAN\s*\(?\s*(\d{1,2})\s*\)?")
FOOTNOTE = re.compile(r"^\s*([1-9¹²³!])(?:[.)])?\s+(.+)$")


def _fold(value: str) -> str:
    value = value.upper().replace("Đ", "D")
    return "".join(char for char in unicodedata.normalize("NFD", value)
                   if unicodedata.category(char) != "Mn")


def _is_section(value: str) -> bool:
    return bool(SECTION.match(_fold(value)))


def _is_end_marker(value: str) -> bool:
    letters = re.sub(r"[^A-Z]", "", _fold(value))
    return letters in {"HET", "HETDE", "KETTHUC"} or bool(re.fullmatch(r".?HET.?", letters))


def _is_exam_header(value: str) -> bool:
    folded = _fold(value).strip()
    return folded.startswith(("BO GIAO DUC", "KY THI", "DE THI", "(DE THI CO",
                              "THOI GIAN LAM BAI", "HO, TEN THI SINH", "HO TEN THI SINH",
                              "SO BAO DANH", "MON THI:"))


def _text(lines):
    return "\n".join(item["text"] for item in lines).strip()


def _split_question_content(part_title: str, text: str) -> tuple[str, str]:
    """Separate a writing instruction from its attached prompt or quoted work."""
    if not any(word in _fold(part_title) for word in ("VIET", "LAM VAN", "NGHI LUAN")):
        return text, ""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        folded = _fold(line).strip()
        inline_task = re.search(r"\b(?:TU GOI DAN TREN|TU NOI DUNG TREN|TU VAN BAN TREN)\b", folded)
        if inline_task and inline_task.start() > 0:
            preceding = [*lines[:index], line[:inline_task.start()].strip()]
            following = [line[inline_task.start():].strip(), *lines[index + 1:]]
            return "\n".join(following).strip(), "\n".join(preceding).strip()
        inline_material = re.search(
            r"\b(?:BAI THO|DOAN THO|VAN BAN|NGU LIEU|TRICH DOAN)\s+SAU\s*:\s*\S", folded)
        if inline_material:
            boundary = inline_material.end() - 1
            return "\n".join([*lines[:index], line[:boundary].strip()]).strip(), \
                "\n".join([line[boundary:].strip(), *lines[index + 1:]]).strip()
        if index > 0 and (folded.startswith(("TU GOI DAN", "TU NOI DUNG", "TU VAN BAN",
                                              "ANH/CHI HAY", "EM HAY", "HAY VIET"))
                          or re.search(r"\bHAY\s+(?:VIET|TRINH BAY|PHAN TICH|NEU)\b", folded)):
            return "\n".join(lines[index:]).strip(), "\n".join(lines[:index]).strip()
        if index < len(lines) - 1 and ":" in line and re.search(
                r"\b(?:BAI THO|DOAN THO|VAN BAN|NGU LIEU|TRICH DOAN)\s+SAU\b", folded):
            return "\n".join(lines[:index + 1]).strip(), "\n".join(lines[index + 1:]).strip()
    return text, ""


def _pages(lines):
    return sorted({item["page"] for item in lines if item["page"] is not None})


def _paragraphs(lines, prefix):
    paragraphs = []
    group = []
    for line in [*lines, {"text": "", "page": None}]:
        if not line["text"].strip():
            if group:
                paragraphs.append({"id": f"{prefix}-paragraph-{len(paragraphs) + 1}",
                                   "text": _text(group), "source_pages": _pages(group)})
                group = []
        else:
            if group and NUMBERED_PARAGRAPH.match(line["text"]):
                paragraphs.append({"id": f"{prefix}-paragraph-{len(paragraphs) + 1}",
                                   "text": _text(group), "source_pages": _pages(group)})
                group = []
            group.append(line)
    return paragraphs


def _source_lines(text, pages):
    if pages:
        for page in pages:
            for raw in page["text"].replace("\r\n", "\n").replace("\r", "\n").split("\n"):
                yield {"text": raw, "page": page.get("number")}
    else:
        for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            yield {"text": raw, "page": None}


def _question_source_lines(lines):
    """Recover question boundaries lost when OCR joins two lines."""
    for line in lines:
        for value in INLINE_QUESTION.split(line["text"]):
            yield {**line, "text": OCR_QUESTION_NUMBER.sub(r"\g<1>5", value)}


def _repeated_edges(pages):
    if not pages or len(pages) < 2:
        return set()
    candidates = []
    for page in pages:
        lines = [line.strip() for line in page["text"].splitlines() if line.strip()]
        candidates.extend(set(line for line in [*lines[:1], *lines[-1:]]
                              if len(line) <= 100 and not QUESTION.match(line) and not _is_section(line)))
    return {line for line, count in Counter(candidates).items() if count >= 2}


def _page_order_warnings(pages):
    warnings = []
    for position, page in enumerate(pages or [], start=1):
        lines = [line.strip() for line in page["text"].splitlines() if line.strip()]
        markers = [PAGE_NUMBER.search(line) for line in [*lines[:3], *lines[-3:]]]
        marker = next((match for match in markers if match), None)
        if marker and int(marker.group(1)) != position:
            warnings.append(f"{page['label']} có dấu trang in là {marker.group(1)}; hãy kiểm tra thứ tự ảnh/trang.")
    return warnings


def _printed_page_lines(pages):
    markers = set()
    for page in pages or []:
        lines = [line.strip() for line in page["text"].splitlines() if line.strip()]
        for line in [*lines[:3], *lines[-3:]]:
            if PAGE_NUMBER.fullmatch(line):
                markers.add((page["number"], line))
    return markers


def _extract_footnotes(lines):
    """Read footnotes near page bottoms, including ones printed after HẾT."""
    groups = {}
    for index, line in enumerate(lines):
        groups.setdefault(line["page"], []).append(index)
    footnotes = []
    consumed = set()
    for indices in groups.values():
        nonempty = [index for index in indices if lines[index]["text"].strip()]
        tail = set(nonempty[-12:])
        active = None
        for index in indices:
            value = lines[index]["text"].strip()
            if index not in tail or not value or PAGE_NUMBER.search(value) or _is_end_marker(value):
                active = None
                continue
            marker = FOOTNOTE.match(value)
            if marker and not _is_section(value):
                raw_number = marker.group(1).translate(str.maketrans("¹²³", "123"))
                number = 1 if raw_number == "!" else int(raw_number)
                active = {"number": number, "text": marker.group(2),
                          "source_pages": _pages([lines[index]])}
                footnotes.append(active)
                consumed.add(index)
            elif active is not None:
                active["text"] += " " + value
                consumed.add(index)
    return footnotes, consumed


def _notes_for_question(question_text, source_text, footnotes):
    question = _fold(question_text)
    source_words = set(re.findall(r"[A-Z]{7,}", _fold(source_text)))
    selected = []
    for note in footnotes:
        folded = _fold(note["text"])
        author = re.match(r"^(.{5,50}?)\s*\(\d{4}", folded)
        name_in_question = bool(author and author.group(1).strip() in question)
        distinctive_words = set(re.findall(r"[A-Z]{7,}", folded))
        if name_in_question or distinctive_words & source_words:
            selected.append(note)
    return selected


def structure_text(text: str, pages: list | None = None) -> dict:
    """Split an exam conservatively, keeping source references and exclusions."""
    parts = []
    global_lines = []
    excluded = []
    warnings = _page_order_warnings(pages)
    repeated = _repeated_edges(pages)
    printed_pages = _printed_page_lines(pages)
    source_lines = list(_question_source_lines(_source_lines(text, pages)))
    footnotes, footnote_lines = _extract_footnotes(source_lines)
    current_part = None
    current_question = None
    current_idea = None
    ended = False

    def get_part():
        nonlocal current_part
        if current_part is None:
            current_part = {"id": f"part-{len(parts) + 1}", "title": "Đề bài",
                            "_context": [], "questions": []}
            parts.append(current_part)
        return current_part

    for index, line in enumerate(source_lines):
        if index in footnote_lines:
            continue
        stripped = line["text"].strip()
        if ended:
            if stripped:
                excluded.append({**line, "reason": "after_end"})
            continue
        if ANSWER_KEY.match(stripped) or _is_end_marker(stripped):
            ended = True
            excluded.append({**line, "reason": "answer_key" if ANSWER_KEY.match(stripped) else "end_marker"})
            continue
        if stripped in repeated and stripped:
            excluded.append({**line, "reason": "repeated_header_footer"})
            continue
        if (line["page"], stripped) in printed_pages or PAGE_NUMBER.fullmatch(stripped):
            excluded.append({**line, "reason": "page_number"})
            continue
        if current_part is None and _is_exam_header(stripped):
            excluded.append({**line, "reason": "exam_header"})
            continue
        if _is_section(stripped):
            current_part = {"id": f"part-{len(parts) + 1}", "title": stripped,
                            "_context": [], "questions": []}
            parts.append(current_part)
            current_question = None
            current_idea = None
            continue
        question = QUESTION.match(stripped)
        if question:
            target = get_part()
            current_question = {"id": f"{target['id']}-question-{len(target['questions']) + 1}",
                                "label": f"{question.group(1).capitalize()} {question.group(2)}",
                                "points": question.group(3),
                                "_stem": [{"text": question.group(4), "page": line["page"]}],
                                "_body": [], "ideas": []}
            target["questions"].append(current_question)
            current_idea = None
            continue
        if current_question is not None:
            current_question["_body"].append(line)
            idea = IDEA.match(stripped)
            if idea:
                label = (idea.group(1) or idea.group(2)).lower()
                current_idea = {"id": f"{current_question['id']}-idea-{len(current_question['ideas']) + 1}",
                                "label": label, "_lines": [{"text": idea.group(3), "page": line["page"]}]}
                current_question["ideas"].append(current_idea)
            elif current_idea is not None:
                current_idea["_lines"].append(line)
            else:
                current_question["_stem"].append(line)
        elif current_part is not None:
            current_part["_context"].append(line)
        else:
            global_lines.append(line)

    if not any(part["questions"] for part in parts):
        # No reliable labels: retain the content, flag it, and let the learner edit.
        fallback = [*global_lines]
        for part in parts:
            fallback.append({"text": part["title"], "page": None})
            fallback.extend(part["_context"])
        parts = [{"id": "part-1", "title": "Đề bài", "_context": [], "questions": [
            {"id": "part-1-question-1", "label": "Nội dung chưa tách được",
             "_stem": fallback, "_body": [], "ideas": []}
        ]}]
        global_lines = []
        warnings.append("Chưa nhận diện được nhãn câu hỏi; cần kiểm tra và chỉnh sửa trước khi học.")

    global_context = _text(global_lines)
    for part in parts:
        context_lines = part.pop("_context")
        part["context"] = _text(context_lines)
        part["paragraphs"] = _paragraphs(context_lines, part["id"])
        part["source_pages"] = _pages(context_lines)
        for question in part["questions"]:
            stem = question.pop("_stem")
            body = question.pop("_body")
            question["stem"] = _text(stem)
            question["text"] = _text([*stem[:1], *body])
            question["task"], question["materials"] = _split_question_content(part["title"], question["text"])
            question["source_pages"] = _pages([*stem, *body])
            question["paragraphs"] = _paragraphs([*stem[:1], *body], question["id"])
            question["source_selection"] = _source_selection(part, question["text"])[1]
            source_text = _source_selection(part, question["text"])[0]
            question["footnotes"] = _notes_for_question(question["text"], source_text, footnotes)
            for idea in question["ideas"]:
                lines = idea.pop("_lines")
                idea["text"] = _text(lines)
                idea["source_pages"] = _pages(lines)
                idea["context"] = idea_context(global_context, part, question, idea)
            question["subquestions"] = [idea["label"] for idea in question["ideas"]]
            question["context"] = question_context(global_context, part, question)

    if excluded:
        warnings.append("Đã tách phần kết thúc/đáp án hoặc đầu-cuối trang lặp lại; xem mục nội dung loại khỏi phiên học.")
    return {"global_context": global_context,
            "global_paragraphs": _paragraphs(global_lines, "global"),
            "parts": parts, "footnotes": footnotes, "excluded": excluded, "warnings": warnings}


def _source_selection(part: dict, question_text: str) -> tuple[str, str]:
    """Use cited paragraphs, or an unambiguous phrase for short factual questions."""
    references = {int(value) for value in PARAGRAPH_REFERENCE.findall(_fold(question_text))}
    numbered = {}
    for paragraph in part["paragraphs"]:
        marker = NUMBERED_PARAGRAPH.match(paragraph["text"])
        if marker:
            numbered[int(marker.group(1))] = paragraph["text"]
    if references:
        if references.issubset(numbered):
            return "\n\n".join(numbered[number] for number in sorted(references)), "cited_paragraphs"
        return part["context"].strip(), "full_source"
    folded_question = _fold(question_text).strip()
    if not (folded_question.startswith(("THEO VAN BAN", "CHI RA", "XAC DINH", "NEU "))
            and len(numbered) > 1):
        return part["context"].strip(), "full_source"
    tokens = re.findall(r"[A-Z0-9]+", folded_question)
    phrases = {tuple(tokens[index:index + 3]) for index in range(len(tokens) - 2)}
    scores = {}
    for number, source in numbered.items():
        source_tokens = re.findall(r"[A-Z0-9]+", _fold(source))
        source_phrases = {tuple(source_tokens[index:index + 3])
                          for index in range(len(source_tokens) - 2)}
        scores[number] = len(phrases & source_phrases)
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    if ranked and ranked[0][1] > 0 and ranked[0][1] > ranked[1][1]:
        return numbered[ranked[0][0]], "matched_phrase"
    return part["context"].strip(), "full_source"


def _shared_context(global_context, part, question_text):
    return [global_context.strip(), part["title"].strip() if part["title"] != "Đề bài" else "",
            _source_selection(part, question_text)[0]]


def question_context(global_context: str, part: dict, question: dict) -> str:
    """Only the chosen question and shared material; no sibling questions."""
    notes = "\n".join(f"Chú thích {note['number']}: {note['text']}"
                      for note in question.get("footnotes", []))
    materials = question.get("materials", "").strip()
    task = question.get("task", question["text"]).strip()
    return "\n\n".join(value for value in [*_shared_context(global_context, part, question["text"]),
                                      f"{question['label']} — Yêu cầu: {task}",
                                      f"Ngữ liệu đi kèm:\n{materials}" if materials else "", notes] if value)


def idea_context(global_context: str, part: dict, question: dict, idea: dict) -> str:
    """One small idea with the question stem, not its sibling ideas."""
    return "\n\n".join(value for value in [*_shared_context(global_context, part,
                                                                 f"{question['stem']} {idea['text']}"),
                                      f"{question['label']}: {question['stem'].strip()}",
                                      f"{idea['label']}) {idea['text'].strip()}"] if value)
