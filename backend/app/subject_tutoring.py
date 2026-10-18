"""Subject-specific Socratic guidance without excluding unlisted subjects."""

import unicodedata


def _fold(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", value.lower())
                   if unicodedata.category(char) != "Mn")


LITERATURE = """Môn Ngữ văn: giữ đúng cách dạy đọc hiểu, nghị luận xã hội và nghị luận văn học.
Hỏi về khái niệm, chi tiết văn bản, lựa chọn dẫn chứng, mối liên hệ luận điểm,
nghệ thuật và khả năng phản biện. Không viết hộ đoạn/bài văn hoàn chỉnh."""
MATH = """Môn Toán: làm rõ giả thiết, đại lượng, điều kiện xác định và mục tiêu cần tìm.
Với hình vẽ/đồ thị, yêu cầu đọc đúng ký hiệu, trục, tỉ lệ trước khi suy luận.
Hỏi vì sao chọn phép biến đổi/định lý, kiểm tra bước trung gian và nghiệm ngoại lai.
Không đưa ngay công thức áp dụng hoặc đáp số."""
PHYSICS = """Môn Vật lý: xác định hệ vật, đại lượng, đơn vị, chiều dương và điều kiện áp dụng định luật.
Đọc hình, mạch và đồ thị từ ảnh gốc; tách dữ kiện đã cho khỏi suy luận.
Gợi học sinh lập quan hệ, kiểm tra thứ nguyên, dấu và giới hạn của kết quả.
Không tự bịa số liệu, thang đo hoặc đáp số."""
CHEMISTRY = """Môn Hóa học: nhận diện chất, điều kiện phản ứng, cấu trúc và dữ kiện định lượng.
Gợi kiểm tra phương trình cân bằng, bảo toàn nguyên tố/điện tích/khối lượng,
đơn vị và giả định. Với hình cấu trúc, yêu cầu đối chiếu liên kết và ký hiệu gốc.
Không suy đoán công thức hay hệ số từ hình mờ; không hướng dẫn thí nghiệm nguy hiểm."""
BIOLOGY = """Môn Sinh học: phân biệt cấu trúc, quá trình, nguyên nhân và hệ quả.
Đọc nhãn trên sơ đồ, biểu đồ hoặc bảng trước khi kết luận; hỏi về biến đối chứng,
chứng cứ, ngoại lệ và khả năng áp dụng trong tình huống mới.
Không khẳng định chi tiết không nhìn rõ trong hình."""
GENERAL = """Xác định môn học từ yêu cầu và ngữ liệu đã bóc tách, kể cả môn chưa có
profile riêng. Dùng đúng thuật ngữ và cách lập luận của môn đó; hỏi về dữ kiện,
giả định, phương pháp và cách kiểm tra kết quả. Không từ chối chỉ vì môn học
không thuộc Ngữ văn/Toán/Lý/Hóa/Sinh. Nếu thiếu hình hoặc chữ để kiểm chứng,
yêu cầu nguồn rõ hơn thay vì bịa dữ kiện."""


def tutor_profile(assignment: dict) -> tuple[str, str]:
    """Return a safe fixed instruction; the subject label itself remains untrusted data."""
    subject = _fold(str(assignment.get("subject") or ""))
    if "ngu van" in subject or "van hoc" in subject:
        return "literature", LITERATURE
    if "toan" in subject or subject == "math":
        return "math", MATH
    if "vat ly" in subject or "physics" in subject:
        return "physics", PHYSICS
    if "hoa hoc" in subject or "chemistry" in subject:
        return "chemistry", CHEMISTRY
    if "sinh hoc" in subject or "biology" in subject:
        return "biology", BIOLOGY
    if not subject or subject == "chua xac dinh":
        if assignment.get("task_type") in {"reading", "social", "literary"}:
            return "literature", LITERATURE
    return "other", GENERAL
