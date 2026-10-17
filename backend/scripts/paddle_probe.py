"""Compare optional PaddleOCR with the current OCR on the local exam images.

Run in an isolated environment with paddlepaddle and paddleocr installed.
This does not change the application's OCR provider.
"""

import sys
import time
import os
from pathlib import Path

from backend.app.extraction import extract_document


CHECKS = {
    "de-trang-1.jpg": [
        "ĐỌC HIỂU", "Năm 1440", "trí thức", "sự nhân bản công nghiệp của tri thức",
        "First Folio", "dưới 5%",
    ],
    "trang-2.jpg": [
        "Câu 5", "NHỮNG CHIẾC LÁ", "Những chiều thu", "Đến hôm nay", "chú bé",
    ],
}


def main(paths: list[str]) -> None:
    baseline_by_name = {}
    for name in paths if not os.getenv("PADDLE_PROBE_SKIP_BASELINE") else []:
        path = Path(name)
        started = time.monotonic()
        baseline_by_name[path.name] = (
            extract_document(path.name, path.read_bytes())["text"],
            round(time.monotonic() - started, 1),
        )
    if os.getenv("PADDLE_PROBE_TESSERACT_ONLY"):
        for name in paths:
            path = Path(name)
            baseline, seconds = baseline_by_name[path.name]
            print(f"\n{path.name}: Tesseract {seconds}s")
            for expected in CHECKS.get(path.name, []):
                print(f"  {expected}: {expected.casefold() in baseline.casefold()}")
        return
    from paddleocr import PaddleOCR

    print("Loading PP-OCRv5 Vietnamese models", flush=True)
    paddle = PaddleOCR(
        lang="vi", ocr_version="PP-OCRv5", device="cpu",
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
        text_det_limit_side_len=1280,
        text_det_limit_type="max",
        cpu_threads=2,
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    for name in paths:
        path = Path(name)
        started = time.monotonic()
        result = next(iter(paddle.predict(str(path))))
        lines = result.json["res"]["rec_texts"]
        paddle_text = "\n".join(lines)
        paddle_seconds = round(time.monotonic() - started, 1)

        baseline, baseline_seconds = baseline_by_name.get(path.name, (None, None))
        checks = CHECKS.get(path.name, [])
        comparison = f", Tesseract {baseline_seconds}s" if baseline_seconds is not None else ""
        print(f"\n{path.name}: Paddle {paddle_seconds}s{comparison}", flush=True)
        for expected in checks:
            baseline_hit = expected.casefold() in baseline.casefold() if baseline is not None else "not run"
            print(f"  {expected}: Paddle={expected.casefold() in paddle_text.casefold()} "
                  f"Tesseract={baseline_hit}", flush=True)
        print("Paddle lines (first 25 and selected markers):", flush=True)
        for index, line in enumerate(lines):
            if index < 25 or any(marker in line.casefold() for marker in
                                 ("1440", "5%", "folio", "câu 5", "chiều thu", "hôm nay")):
                print(f"  {index:03}: {line}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
