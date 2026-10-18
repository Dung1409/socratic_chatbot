from .subject_tutoring import tutor_profile

BLOOM_NAMES = ["Nhớ", "Hiểu", "Vận dụng", "Phân tích", "Đánh giá", "Sáng tạo"]


def lesson_steps(assignment):
    """Template mode: no AI grading or inferred student ability."""
    questions = [
        "Em hãy đọc yêu cầu đề bài và xác định vấn đề chính cần giải quyết bằng lời của mình.",
        "Em hiểu vấn đề đó như thế nào? Hãy giải thích một khái niệm hoặc ý chính trong đề.",
        "Em chọn chi tiết hoặc ví dụ nào để hỗ trợ ý kiến của mình? Hãy nêu rõ nguồn dẫn chứng.",
        "Dẫn chứng vừa chọn liên hệ với luận điểm của em như thế nào?",
        "Một người có quan điểm khác có thể phản biện ý của em ra sao? Em sẽ trả lời thế nào?",
        "Em hãy đề xuất một cách diễn đạt hoặc hướng triển khai của riêng mình và giải thích lựa chọn đó.",
    ]
    subject, _ = tutor_profile(assignment)
    if subject in {"math", "physics", "chemistry", "biology"}:
        questions = [
            "Đề cho những dữ kiện nào, yêu cầu tìm hoặc giải thích điều gì? Hãy nêu bằng lời của em.",
            "Điều kiện, ký hiệu hoặc giả định nào cần làm rõ trước khi bắt đầu?",
            "Em chọn quy tắc, định luật hay mối quan hệ nào? Vì sao nó áp dụng được ở đây?",
            "Từ dữ kiện đến kết luận cần những bước trung gian nào? Em thử giải thích một bước.",
            "Nếu thay đổi một dữ kiện hoặc nhìn hình theo cách khác, kết quả có còn hợp lý không?",
            "Em hãy tự kiểm tra kết quả bằng đơn vị, trường hợp giới hạn hoặc cách giải khác.",
        ]
    elif subject == "other":
        questions = [
            "Em muốn giải quyết yêu cầu nào trong tài liệu, và dữ kiện nào liên quan trực tiếp?",
            "Thuật ngữ hoặc giả định nào trong yêu cầu cần làm rõ?",
            "Em sẽ dùng phương pháp hoặc căn cứ nào của môn học này? Vì sao?",
            "Các dữ kiện liên hệ với kết luận của em như thế nào?",
            "Có góc nhìn hoặc trường hợp ngoại lệ nào cần kiểm tra không?",
            "Em hãy tự tổng hợp hướng giải và nêu cách kiểm chứng kết quả.",
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
