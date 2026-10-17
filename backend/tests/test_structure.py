from backend.app.structure import question_context, structure_text


def test_parts_questions_and_shared_passage_are_kept_separate():
    text = """ĐỀ KIỂM TRA NGỮ VĂN
PHẦN I. ĐỌC HIỂU
Đọc đoạn trích sau:
Mùa xuân đến trên cánh đồng.
Câu 1. Chỉ ra hình ảnh trong đoạn trích.
a) Hình ảnh nào xuất hiện?
b) Em có nhận xét gì?
Câu 2: Nêu tác dụng của hình ảnh đó.
PHẦN II. VIẾT
Câu 1. Viết đoạn văn về mùa xuân.
ĐÁP ÁN
Câu 1. Đáp án không được gửi cho học sinh.
"""
    result = structure_text(text)
    assert len(result["parts"]) == 2
    assert [len(part["questions"]) for part in result["parts"]] == [2, 1]
    assert result["parts"][0]["questions"][0]["subquestions"] == ["a", "b"]
    assert len(result["parts"][0]["questions"][0]["ideas"]) == 2
    first = question_context(result["global_context"], result["parts"][0], result["parts"][0]["questions"][0])
    assert first == result["parts"][0]["questions"][0]["context"]
    assert "Mùa xuân đến" in first
    assert "Câu 2" not in first
    assert "Đáp án không được gửi" not in first
    assert result["excluded"][0]["reason"] == "answer_key"
    assert "Hình ảnh nào" in result["parts"][0]["questions"][0]["ideas"][0]["context"]
    assert "Em có nhận xét" not in result["parts"][0]["questions"][0]["ideas"][0]["context"]


def test_unlabeled_text_requires_review_without_forcing_student_to_shorten():
    result = structure_text("Hãy phân tích vai trò của dẫn chứng trong bài nghị luận.")
    assert result["parts"][0]["questions"][0]["label"] == "Nội dung chưa tách được"
    assert result["warnings"]
    long_result = structure_text("PHẦN I. ĐỌC HIỂU\n" + "Văn bản mẫu. " * 800 + "\nCâu 1. Em hiểu gì?")
    assert not any("rút gọn" in warning for warning in long_result["warnings"])
    assert len(long_result["parts"][0]["questions"][0]["context"]) > 8000


def test_page_provenance_order_warning_and_end_exclusion():
    pages = [
        {"number": 1, "label": "Ảnh 1", "text": "PHẦN I. ĐỌC HIỂU\nĐọc văn bản:\nMùa xuân đến.\nCâu 1. Tìm hình ảnh.\nTrang 2/2"},
        {"number": 2, "label": "Ảnh 2", "text": "a) Hình ảnh trong câu đầu?\n— HẾT —\nĐÁP ÁN\nHình ảnh mẫu"},
    ]
    result = structure_text("\n\n".join(page["text"] for page in pages), pages)
    question = result["parts"][0]["questions"][0]
    assert question["source_pages"] == [1, 2]
    assert question["ideas"][0]["source_pages"] == [2]
    assert any("thứ tự" in warning for warning in result["warnings"])
    assert "Hình ảnh mẫu" not in question["context"]
    assert "Trang 2/2" not in question["context"]
    assert any(line["reason"] == "page_number" for line in result["excluded"])
    assert result["excluded"][-1]["reason"] == "after_end"


def test_multiline_question_stem_is_not_lost():
    result = structure_text("Câu 1. Đọc đoạn thơ sau\nVà nêu cảm nhận của em.\na) Chỉ ra hình ảnh thơ.")
    question = result["parts"][0]["questions"][0]
    assert "Và nêu cảm nhận" in question["text"]
    assert question["text"].count("Và nêu cảm nhận") == 1
    assert "Và nêu cảm nhận" in question["context"]


def test_ocr_page_label_with_leading_punctuation_is_excluded():
    result = structure_text("II. VIẾT\nCâu 2. Phân tích bài thơ sau:\nNhững chiếc lá\n: Trang 2/2")
    question = result["parts"][0]["questions"][0]
    assert "Trang 2/2" not in question["materials"]
    assert any(item["reason"] == "page_number" for item in result["excluded"])


def test_ocr_section_prefix_keeps_reading_and_writing_parts_separate():
    result = structure_text("1L ĐỌC HIÈU (4,0 điểm)\nCâu 1. Đọc văn bản.\nII. VIẾT (6,0 điểm)\nCâu 1. Viết đoạn văn.")
    assert [len(part["questions"]) for part in result["parts"]] == [1, 1]
    assert result["parts"][0]["title"].startswith("1L ĐỌC")


def test_ocr_question_five_marker_inside_previous_question_line():
    text = ("I. ĐỌC HIỂU (4,0 điểm)\n"
            "Câu 4. Nhận xét về mồi liên hệ giữa luận đề và các luận điểm trong văn bản. "
            "Câu Š. Trong bối cảnh cần có những đột phả về khoa học công nghệ hiện nay, "
            "từ góc nhìn của người trẻ, cần sử dụng trí tuệ nhân tạo (AI) như thế nào?")
    questions = structure_text(text)["parts"][0]["questions"]
    assert [question["label"] for question in questions] == ["Câu 4", "Câu 5"]
    assert "Câu Š" not in questions[0]["text"]
    assert "Trong bối cảnh" in questions[1]["text"]


def test_ocr_graduation_exam_is_split_into_two_sections_and_seven_questions():
    ocr = """BỘ GIÁO DỤC VÀ ĐÀO TẠO KY THỊ TOT NGHIỆP TRUNG HQC PHO THONG NĂM 2026
DE THI CHÍNH THUC Môn thi: NGỮ VAN
(Đề thi có 02 trang) Thời gian làm bài: 120 phút
Họ, tên thí sinh:........................
Số báo danh:........................
1. ĐỌC HIỂU (4,0 điểm)
Đọc văn bản:
(1) Năm 1440, Johannes Gutenberg phat minh ra may in.
(2) Trước năm 1440, tri thức là một dạng tài sản bị giam cam.
(4) Những bản in First Folio được xuất bản năm 1623.
(5) Tri thức trở thành nhiên liệu cho Phục Hưng và Cách mang Công nghiệp.
(6) Các Sultan của Dé quốc Ottoman cấm in ấn.
(CODE VÀ CAT - Những quyên lực công nghệ xoay chuyển thé giới, Phan Tuấn)
Trang 1/2
Thực hiện các yêu cầu:
Câu 1. Theo văn bản, trước năm 1440, tri thức được lưu giữ ở đâu?
Câu 2. Chỉ ra câu văn chứa đựng bằng chứng về vai trò của máy in đối với tác phẩm của William
Shakespeare trong đoạn (4).
Câu 3. Anh/Chị hiểu như thé nào về nghĩa của cụm từ tài sản bị giam cầm (đoạn 2) và từ nhiên liệu
(đoạn 5) được tác giả sử dụng khi nói về tri thức?
Câu 4. Nhận xét về mối liên hệ giữa luận đề và các luận điểm trong văn bản.
Câu 5. Từ góc nhìn người trẻ, cần sử dụng trí tuệ nhân tạo như thế nào?
Il. VIET (6,0 điểm)
Câu 1 (2,0 điểm)
Nước Mĩ có Steve Jobs, Mark Zuckerberg, Elon Musk.
Từ gợi dẫn trên, hãy viết đoạn văn khoảng 200 chữ về Steve Jobs Việt Nam.
Câu 2 (4,0 điểm)
Hãy viết bài văn khoảng 600 chữ phân tích bài thơ sau:
NHỮNG CHIÉC LÁ
Nguyễn Dinh Thi
Chiều lạnh cóng, vườn cây vắng tanh, những chiếc lá rụng trên mặt cỏ.
A, à, vậy chứ, những chiếc lá reo phù phù, nhảy nhói.
(Thơ Nguyễn Dinh Thi, NXB Kim Đồng, 2025)
_——e=== HET ----———-—--—----
— Thi sinh không được sử dung tài liệu.
— Giám thị không giải thích gì thêm.
Trang 2/2"""
    result = structure_text(ocr)
    assert [len(part["questions"]) for part in result["parts"]] == [5, 2]
    assert "Gutenberg" in result["parts"][0]["context"]
    assert len(result["parts"][0]["paragraphs"]) >= 5
    assert "Họ, tên thí sinh" not in result["parts"][0]["questions"][0]["context"]
    assert "Trang 1/2" not in result["parts"][0]["questions"][0]["context"]
    reading = result["parts"][0]["questions"]
    assert "(2) Trước năm" in reading[0]["context"]
    assert "(4) Những bản in" not in reading[0]["context"]
    assert reading[0]["source_selection"] == "matched_phrase"
    assert "(4) Những bản in" in reading[1]["context"]
    assert reading[1]["source_selection"] == "cited_paragraphs"
    assert "(2) Trước năm" not in reading[1]["context"]
    assert "(2) Trước năm" in reading[2]["context"]
    assert "(5) Tri thức" in reading[2]["context"]
    assert "(4) Những bản in" not in reading[2]["context"]
    writing = result["parts"][1]["questions"]
    assert writing[0]["points"] == "2,0 điểm"
    assert writing[1]["points"] == "4,0 điểm"
    assert "Steve Jobs" in writing[0]["materials"]
    assert "Từ gợi dẫn trên" in writing[0]["task"]
    assert "Nước Mĩ có" not in writing[0]["task"]
    assert "phân tích bài thơ sau" in writing[1]["task"]
    assert "NHỮNG CHIÉC LÁ" in writing[1]["materials"]
    assert "NHỮNG CHIÉC LÁ" not in writing[1]["task"]
    assert "Chiều lạnh cóng" in writing[1]["materials"]
    assert reading[0]["materials"] == ""
    assert "Yêu cầu:" in writing[1]["context"]
    assert "Ngữ liệu đi kèm:" in writing[1]["context"]
    assert "Steve Jobs" in writing[0]["context"]
    assert "NHỮNG CHIÉC LÁ" in writing[1]["context"]
    assert "Steve Jobs" not in writing[1]["context"]
    assert "Thi sinh không được" not in writing[1]["context"]
    assert any(line["reason"] == "end_marker" for line in result["excluded"])


def test_standard_exam_keeps_footnotes_even_when_author_note_follows_end_marker():
    pages = [
        {"number": 1, "label": "Ảnh 1", "text": """I. ĐỌC HIỂU (4,0 điểm)
Đọc văn bản:
(1) First Folio! giúp lưu giữ các vở kịch của Shakespeare.
(2) Các Sultan của Đế quốc Ottoman hạn chế in ấn.
(Nguồn: Những quyền lực công nghệ, NXB Thế giới)
! Tuyển tập kịch đầu tiên của William Shakespeare.
2 Người nắm quyền lực tối cao ở Đế quốc Ottoman.
Trang 1/2"""},
        {"number": 2, "label": "Ảnh 2", "text": """Thực hiện các yêu cầu:
Câu 1. Chỉ ra bằng chứng trong đoạn (1).
II. VIẾT (6,0 điểm)
Câu 1 (4,0 điểm)
Phân tích bài thơ NHỮNG CHIẾC LÁ của Nguyễn Dinh Thi.
Những chiếc lá rụng trên mặt cỏ.
---------- HẾT ----------
— Thí sinh không được sử dụng tài liệu.
— Giám thị không giải thích gì thêm.
3 Nguyễn Đình Thi (1924-2003) là nhà thơ, nhà văn có đóng góp lớn.
Thơ Nguyễn Đình Thi mang phong cách tư duy hiện đại.
Trang 2/2"""},
    ]
    result = structure_text("\n\n".join(page["text"] for page in pages), pages)
    assert [note["number"] for note in result["footnotes"]] == [1, 2, 3]
    assert "Tuyển tập kịch" not in result["parts"][0]["context"]
    assert "1924-2003" in result["parts"][1]["questions"][0]["context"]
    assert "Thí sinh không được" not in result["parts"][1]["questions"][0]["context"]
    assert any("Giám thị" in line["text"] for line in result["excluded"])


def test_writing_prompt_and_instruction_can_share_one_ocr_line():
    text = ("II. VIẾT (6,0 điểm)\n"
            "Câu 1 (2,0 điểm) Nước Mĩ có Steve Jobs và Elon Musk. "
            "Từ gợi dẫn trên, hãy viết đoạn văn về sáng tạo.\n"
            "Câu 2 (4,0 điểm) Hãy phân tích bài thơ sau: NHỮNG CHIẾC LÁ\n"
            "Chiều lạnh cóng, những chiếc lá rụng trên mặt cỏ.")
    questions = structure_text(text)["parts"][0]["questions"]
    assert questions[0]["materials"] == "Nước Mĩ có Steve Jobs và Elon Musk."
    assert questions[0]["task"].startswith("Từ gợi dẫn trên")
    assert questions[1]["task"] == "Hãy phân tích bài thơ sau:"
    assert questions[1]["materials"].startswith("NHỮNG CHIẾC LÁ")
