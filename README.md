# SocraVăn — Socratic × Bloom

Giao diện được lấy từ [Toan0409/bloom-guided-scribe](https://github.com/Toan0409/bloom-guided-scribe), commit `64c30dd7eb11b2745d17d0548c214f668cb67c91`. Giữ bố cục, màu sắc, font và các màn hình học sinh/giáo viên của bản gốc. Backend sử dụng **FastAPI**, lưu dữ liệu bằng **SQLite**.

## Chạy trên Windows

Yêu cầu: Python 3.11+ và Node.js 22.12+ (đã kiểm tra với Python 3.11, Node.js 24).

Chạy trong thư mục gốc dự án:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend ci
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

- Giao diện: http://127.0.0.1:5173
- Swagger API: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/api/health

`Ctrl+C` dừng cả hai tiến trình. Log nằm trong `artifacts/`.

Hoặc chạy hai terminal riêng để backend tự tải lại khi sửa code:

```powershell
# Terminal 1, tại thư mục gốc
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2, tại thư mục gốc
npm --prefix frontend run dev
```

## Chức năng đã nối API

- Xem danh sách đề; giáo viên tạo đề và chọn Bloom mục tiêu.
- Nhập đề trực tiếp hoặc trích xuất TXT UTF-8, DOCX và PDF có chữ (tối đa 10MB). Kiểm tra/sửa nội dung trước khi xác nhận.
- Bắt đầu đúng đề đã chọn; lưu đối thoại, ba mức gợi ý, tiến độ và bài nộp vào SQLite. Tải lại trang để tiếp tục. Bản nháp lưu trong trình duyệt.
- Chống gửi trùng bằng `client_message_id`, chống ghi đè khi nhiều yêu cầu gửi cùng lúc bằng phiên bản trạng thái.
- Giáo viên sửa và lưu rubric tổng trọng số 100%. Mỗi phiên giữ bản rubric riêng để thay đổi rubric không ảnh hưởng phiên đang học.
- Xem bài nộp và lịch sử phiên; chấm từng tiêu chí và lưu nhận xét. Mỗi lần chấm tạo một bản ghi mới, giữ lịch sử trong cơ sở dữ liệu.
- Tổng quan, tiến trình, điểm và nhận xét lấy từ dữ liệu backend đã lưu.

## Phạm vi bản local

Gia sư hiện dùng **kịch bản câu hỏi**, chưa tích hợp LLM. Đề Vợ nhặt giữ kịch bản của repo gốc; các đề khác dùng chuỗi câu hỏi chung theo mục tiêu Bloom. Chưa đánh giá tự động câu trả lời hoặc kết luận năng lực Bloom; điểm do giáo viên nhập. Biểu đồ Bloom thể hiện số câu đã luyện tập.

Chưa có đăng nhập/phân quyền: toàn bộ phiên lưu cho hồ sơ Minh Anh; danh sách lớp có sáu hồ sơ mẫu. Chỉ chạy local; cần bổ sung xác thực và kiểm tra quyền tài nguyên trước khi triển khai nhiều người dùng. Chưa hỗ trợ OCR ảnh/PDF scan, lưu tệp gốc, worker, PostgreSQL hoặc xuất dữ liệu nghiên cứu. Tài liệu thiết kế đầy đủ trong `docs/` là định hướng phát triển tiếp theo.

SQLite tự tạo tại `backend/data/socratic.db`. Đổi vị trí bằng biến môi trường `DATABASE_PATH`. Xem cấu hình mẫu ở `backend/.env.example` và `frontend/.env.example`. Chương trình đọc biến môi trường của tiến trình; không tự nạp các tệp `.env` của backend. API frontend mặc định dùng `/api`, Vite chuyển tiếp đến cổng 8000. Có thể đặt `API_PROXY_TARGET` cho Vite hoặc `VITE_API_URL` khi build giao diện chạy khác origin.

## Build và chạy một cổng

```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

FastAPI phục vụ cả `frontend/dist` và API tại http://127.0.0.1:8000. Phải khởi động lại backend sau khi build để nhận thư mục `dist`. Giao diện chạy React SPA, không cần server Node.js khi phục vụ bản build.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

E2E dùng Chrome đã cài trên máy, backend riêng ở cổng 8011 và database riêng trong `backend/data/`. Các bài kiểm tra chạy luồng học–nộp–chấm–xem kết quả, chọn đúng đề, tải tệp có xác nhận và điều hướng mobile. Ảnh chụp kết quả nằm trong `artifacts/`. Muốn dùng Chromium do Playwright quản lý, bỏ `launchOptions.channel` trong `frontend/playwright.config.ts` rồi chạy `npx playwright install chromium` từ thư mục `frontend`.

## Cấu trúc

```text
backend/
  app/main.py       # FastAPI routes và phục vụ bản build frontend
  app/db.py         # SQLite, giao dịch và khởi tạo dữ liệu
  app/schemas.py    # Kiểm tra dữ liệu đầu vào
  app/tutor.py      # Chuỗi câu hỏi ở chế độ kịch bản
  app/seed.json     # Đề bài, rubric, hồ sơ mẫu từ repo gốc
  tests/            # Kiểm thử nghiệp vụ và API
frontend/
  src/routes/       # Các màn hình React/TanStack Router
  src/lib/api.ts    # API client và các kiểu dữ liệu
  e2e/              # Kiểm thử trình duyệt
scripts/dev.ps1     # Chạy frontend và backend trên Windows
docs/               # Tài liệu kỹ thuật có sẵn
```
