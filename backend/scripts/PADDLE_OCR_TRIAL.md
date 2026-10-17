# PP-OCRv5 Vietnamese trial

This is an isolated benchmark, not a production OCR provider. It uses the two
local images in `document_template/Picture/` and 11 exact phrases confirmed
against the source scans. Exact-phrase hits are a smoke test, not CER/WER.

| Engine | Exact phrases | Page 1 | Page 2 |
| --- | ---: | ---: | ---: |
| Current Tesseract pipeline | 7/11 | 24.7 s | 18.6 s |
| PP-OCRv5 mobile detection + Latin recognition (`lang=vi`) | 4/11 | 62.4 s | 48.3 s |

PP-OCRv5 recognized `First Folio`, which Tesseract missed, but systematically
dropped Vietnamese diacritics: for example, `NHỮNG CHIẾC LÁ` became
`NHNG CHIC LÁ`. The server detection model ran out of memory in the local
Docker VM (about 4 GB RAM). Do not replace the current OCR with this tested
configuration.

To repeat the trial, build the disposable image:

```sh
docker build -t socratic-paddle-probe:local -f backend/scripts/Dockerfile.paddle-probe .
docker run --rm -v "$PWD:/repo:ro" --entrypoint python socratic-paddle-probe:local /repo/backend/scripts/paddle_probe.py /repo/document_template/Picture/de-trang-1.jpg /repo/document_template/Picture/trang-2.jpg
```

The first run downloads the official models. The benchmark script has a
`PADDLE_PROBE_TESSERACT_ONLY=1` mode that runs without PaddleOCR installed.
