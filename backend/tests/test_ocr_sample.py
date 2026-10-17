"""Regression check for the locally supplied THPT literature scan."""

import unittest
import shutil
from pathlib import Path

from backend.app.extraction import extract_document


SAMPLE = Path(__file__).resolve().parents[2] / "document_template/Picture/trang-2.jpg"
FIRST_PAGE = SAMPLE.with_name("de-trang-1.jpg")


@unittest.skipUnless(SAMPLE.exists() and shutil.which("tesseract"),
                     "Local exam image or Tesseract is not available")
class ExamScanOCRTest(unittest.TestCase):
    def test_poem_title_and_visible_words_keep_their_vietnamese_accents(self):
        result = extract_document(SAMPLE.name, SAMPLE.read_bytes())
        text = result["text"]
        self.assertIn("NHỮNG CHIẾC LÁ", text)
        self.assertIn("Chiều lạnh cóng", text)
        self.assertIn("um tùm", text)

    @unittest.skipUnless(FIRST_PAGE.exists(), "First exam page is not available")
    def test_reading_passage_keeps_a_key_concept(self):
        text = extract_document(FIRST_PAGE.name, FIRST_PAGE.read_bytes())["text"]
        self.assertIn("sự nhân bản công nghiệp của tri thức", text)
        self.assertIn("1440,", text.split("(1)", 1)[1].splitlines()[0])
        self.assertNotIn("7440", text)
        self.assertIn("năm 1623,", text)

    def test_question_number_five_is_read_as_a_digit(self):
        text = extract_document(SAMPLE.name, SAMPLE.read_bytes())["text"]
        self.assertIn("Câu 5.", text)
        self.assertNotIn("Câu Š.", text)


if __name__ == "__main__":
    unittest.main()
