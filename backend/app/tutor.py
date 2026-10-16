import json
from pathlib import Path

SEED = json.loads(Path(__file__).with_name("seed.json").read_text(encoding="utf-8"))
BLOOM_NAMES = ["Nhớ", "Hiểu", "Vận dụng", "Phân tích", "Đánh giá", "Sáng tạo"]


def lesson_steps(assignment):
    """Template mode: no AI grading or inferred student ability."""
    if assignment["id"] == "vo-nhat":
        return SEED["socraticSteps"]
    questions = [
        "Em hãy đọc yêu cầu đề bài và xác định vấn đề chính cần giải quyết bằng lời của mình.",
        "Em hiểu vấn đề đó như thế nào? Hãy giải thích một khái niệm hoặc ý chính trong đề.",
        "Em chọn chi tiết hoặc ví dụ nào để hỗ trợ ý kiến của mình? Hãy nêu rõ nguồn dẫn chứng.",
        "Dẫn chứng vừa chọn liên hệ với luận điểm của em như thế nào?",
        "Một người có quan điểm khác có thể phản biện ý của em ra sao? Em sẽ trả lời thế nào?",
        "Em hãy đề xuất một cách diễn đạt hoặc hướng triển khai của riêng mình và giải thích lựa chọn đó.",
    ]
    return [
        {"level": level, "q": questions[level - 1], "hints": [
            "Đọc lại yêu cầu và chọn một ý để tập trung trả lời.",
            "Tìm một chi tiết trong ngữ liệu đã có. Nếu còn thiếu văn bản, hãy bổ sung trước khi trích dẫn.",
            "Thử dùng khung: Ý kiến của em là…; căn cứ là…; căn cứ này thuyết phục vì…",
        ]}
        for level in range(1, assignment["target"] + 1)
    ]


def tutor_turn(step, steps):
    return {"kind": "tutor", "step": step, "text": steps[step]["q"], "level": steps[step]["level"]}
