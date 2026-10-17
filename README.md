# SocraVăn — Socratic × Bloom

Giao diện được lấy từ [Toan0409/bloom-guided-scribe](https://github.com/Toan0409/bloom-guided-scribe), commit `64c30dd7eb11b2745d17d0548c214f668cb67c91`. Giữ bố cục, màu sắc, font và các màn hình học sinh/giáo viên của bản gốc. Backend sử dụng **FastAPI**, chạy **PostgreSQL** và worker khi dùng Docker Compose; vẫn hỗ trợ **SQLite** khi chạy Python trực tiếp.

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

## Chạy bằng Docker Compose

Yêu cầu: Docker Engine và Docker Compose v2 (hoặc Docker Desktop đang chạy).
Tại thư mục gốc dự án:

```powershell
docker compose up -d --build
docker compose ps
```

- Giao diện: http://127.0.0.1:8080
- Swagger API: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/api/health
- Readiness API: http://127.0.0.1:8000/api/ready

Theo mục 5.1 và 14.1 của [tài liệu triển khai](docs/TAI_LIEU_KY_THUAT_GIA_SU_AI_SOCRATIC.md),
Compose chạy bốn service thường trực và một service migration chạy một lần:

| Service | Chức năng | Điều kiện khởi động |
| --- | --- | --- |
| `postgres` | PostgreSQL 16, dữ liệu ứng dụng và bảng `jobs` bền vững | Health check `pg_isready` |
| `migrate` | Áp migration có phiên bản và tạo dữ liệu mẫu, rồi thoát với mã 0 | PostgreSQL sẵn sàng |
| `backend` | FastAPI, ghi nhận upload và tạo job; user thường | Migration thành công; health check `/api/ready` kiểm tra DB và kho tệp |
| `worker` | Trích xuất TXT, DOCX, PDF (gồm trang scan) và ảnh; nhận job từ PostgreSQL | Migration thành công; health check heartbeat và DB |
| `frontend` | Build React bằng Node.js, phục vụ SPA bằng Nginx | API và worker khỏe |

`migrate` ở trạng thái `Exited (0)` sau khi chạy là bình thường. API và worker
dùng cùng `backend/Dockerfile`, có lệnh khởi động riêng. Migration và seed có
thể chạy lại; chúng không ghi đè rubric hoặc dữ liệu đã lưu.

Nginx chuyển tiếp `/api/` sang `backend:8000`, giữ nguyên tiền tố `/api`.
Frontend gọi API cùng origin, không cần `VITE_API_URL` hoặc cấu hình CORS riêng.
PostgreSQL chỉ nằm trên network nội bộ, không mở cổng ra máy. Local dùng HTTP;
khi triển khai ngoài local cần bổ sung reverse proxy kết thúc TLS và cấu hình
bí mật theo môi trường. Bản Compose này chưa bật HTTPS hay xác thực người dùng.

Kho tệp local là volume dùng chung giữa API và worker, phù hợp lựa chọn trong
tài liệu. Chưa cần MinIO/S3 riêng. Hàng đợi dùng bảng `jobs`, không cần Redis,
Celery hoặc RabbitMQ. Truy xuất vector và pgvector vẫn là phần mở rộng. OCR dùng Tesseract cài trong image backend/worker.

Có thể build từng image độc lập từ thư mục gốc:

```powershell
docker build -t socratic-frontend ./frontend
docker build -t socratic-backend ./backend
```

Khi chạy frontend riêng, Nginx cần kết nối được hostname `backend` trên cùng
Docker network. Compose tự tạo network và hostname này.
`Dockerfile` tại thư mục gốc vẫn hỗ trợ cách đóng gói cả frontend và backend
chung một image; Compose hiện dùng hai Dockerfile riêng ở trên.

Hai named volume giữ dữ liệu khi restart, build lại hoặc `docker compose down`:

- `postgres_data`: dữ liệu PostgreSQL tại `/var/lib/postgresql/data`.
- `socratic_files`: tệp gốc tại `/app/storage`; văn bản trích xuất và trạng thái
  lưu trong PostgreSQL. Tệp dùng tên nội bộ ngẫu nhiên, không phục vụ công khai.

Database SQLite local và volume `socratic_data` của bản Compose cũ không được
tự động chuyển sang PostgreSQL. Dữ liệu cũ vẫn ở vị trí cũ; stack mới tạo dữ
liệu mẫu nếu PostgreSQL chưa được khởi tạo.

Trong Compose, upload trả `202` cùng `document_id` và `job_id`. Frontend truy
vấn `GET /api/documents/{id}` cho đến khi trạng thái là `needs_review`, rồi
hiển thị nội dung để người dùng kiểm tra. Có thể tạo job trực tiếp bằng
`POST /api/documents`. PDF tối đa 30 trang, tệp tối đa 10 MB.

Worker claim job bằng khóa hàng `FOR UPDATE SKIP LOCKED`, có lease 120 giây,
gia hạn khi xử lý, retry lỗi tạm thời tối đa ba lần và nhận lại job có lease
hết hạn sau khi tiến trình bị dừng. Token của lease ngăn worker cũ ghi đè kết
quả mới. Job và dữ liệu gốc vẫn còn nếu API/worker restart. Worker hiện xử lý
trích xuất; chấm điểm vẫn do giáo viên thực hiện, chưa có tác vụ đánh giá LLM.

```powershell
# Xem log
docker compose logs -f frontend backend worker migrate

# Chạy lại migration khi cần
docker compose run --rm migrate

# Dừng và gỡ container, giữ dữ liệu
docker compose down
```

Có thể sao chép `.env.example` thành `.env` để chỉnh cổng và thông tin DB.
Mật khẩu mặc định chỉ dành cho local. Thay `POSTGRES_PASSWORD` sau khi volume
đã có dữ liệu không tự đổi mật khẩu bên trong PostgreSQL; cần đổi bằng SQL
trước khi cập nhật biến môi trường của các service.

Muốn đổi cổng, đặt `FE_PORT=3000` và/hoặc
`BE_PORT=8001`, rồi chạy lại `docker compose up -d`. Ví dụ này mở giao diện tại
http://127.0.0.1:3000 và Swagger API tại http://127.0.0.1:8001/docs.
Nginx vẫn kết nối backend qua cổng nội bộ 8000 khi đổi cổng trên máy.
Compose mặc định chỉ mở cổng trên `127.0.0.1`, phù hợp chế độ local/demo hiện tại.
`docker compose down -v` sẽ xóa cả volume và toàn bộ dữ liệu trong đó.

## Chức năng đã nối API

- Xem danh sách đề; giáo viên tạo đề và chọn Bloom mục tiêu.
- Học sinh tải một tệp TXT UTF-8, DOCX, PDF hoặc tối đa 12 ảnh PNG/JPG/WEBP (mỗi tệp tối đa 10MB). PDF giữ ranh giới từng trang; trang scan và ảnh được OCR tiếng Việt + tiếng Anh. Với nhiều ảnh, học sinh xem trước, sắp lại thứ tự rồi mới xử lý; dấu trang in không khớp thứ tự sẽ được cảnh báo để kiểm tra.
- Server đề xuất tách phần, ngữ liệu chung, câu hỏi, ý nhỏ và đoạn bằng quy tắc; dòng kết thúc đề/đáp án được đánh dấu loại trừ, không đưa vào câu học. Học sinh kiểm tra và có thể sửa văn bản rồi phân tích lại. Khi xác nhận, chỉ câu hoặc ý được chọn cùng ngữ cảnh liên quan được lưu làm đề cho phiên học; không có ngưỡng cắt 8.000 ký tự tùy ý. Chưa tự động tạo phiên cho toàn bộ câu trong một lần upload.
- Bắt đầu đúng đề đã chọn; lưu đối thoại, ba mức gợi ý, tiến độ và bài nộp vào PostgreSQL hoặc SQLite. Tải lại trang để tiếp tục. Bản nháp lưu trong trình duyệt.
- Chống gửi trùng bằng `client_message_id`, chống ghi đè khi nhiều yêu cầu gửi cùng lúc bằng phiên bản trạng thái.
- Giáo viên sửa và lưu rubric tổng trọng số 100%. Mỗi phiên giữ bản rubric riêng để thay đổi rubric không ảnh hưởng phiên đang học.
- Xem bài nộp và lịch sử phiên; chấm từng tiêu chí và lưu nhận xét. Mỗi lần chấm tạo một bản ghi mới, giữ lịch sử trong cơ sở dữ liệu.
- Tổng quan, tiến trình, điểm và nhận xét lấy từ dữ liệu backend đã lưu.

## Phạm vi bản local

Gia sư hiện dùng **kịch bản câu hỏi**, chưa tích hợp LLM. Đề Vợ nhặt giữ kịch bản của repo gốc; các đề khác dùng chuỗi câu hỏi chung theo mục tiêu Bloom. Chưa đánh giá tự động câu trả lời hoặc kết luận năng lực Bloom; điểm do giáo viên nhập. Biểu đồ Bloom thể hiện số câu đã luyện tập.

Chưa có đăng nhập/phân quyền: toàn bộ phiên lưu cho hồ sơ Minh Anh; danh sách lớp có sáu hồ sơ mẫu. Chỉ chạy local; cần bổ sung xác thực và kiểm tra quyền tài nguyên trước khi triển khai nhiều người dùng. Đã có PostgreSQL, migration và worker trích xuất lưu tệp gốc trong Compose. Bộ tách phần/câu hiện dựa trên nhãn rõ như “PHẦN I”, “Câu 1”; đề không có nhãn, ảnh mờ hoặc bố cục phức tạp cần học sinh kiểm tra thủ công. OCR trên máy chạy trực tiếp cần cài Tesseract với gói ngôn ngữ `vie` và `eng` (có thể đặt `OCR_TESSERACT_CMD`); Compose đã cài sẵn. Chưa có đánh giá LLM, xuất dữ liệu nghiên cứu hoặc toàn bộ schema nghiệp vụ của tài liệu thiết kế. Dữ liệu nghiệp vụ hiện giữ cấu trúc JSON của bản demo trong bảng `documents`; các bảng quan hệ đầy đủ vẫn cần migration tiếp theo.

Khi chạy Python trực tiếp, SQLite tự tạo tại `backend/data/socratic.db`; đổi vị trí bằng `DATABASE_PATH`. Đặt `DATABASE_URL` để dùng PostgreSQL, hoặc bộ biến `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`; PostgreSQL có ưu tiên cao hơn đường dẫn SQLite. `AUTO_MIGRATE=true` tự áp migration lúc khởi động khi chạy trực tiếp. Compose đặt `AUTO_MIGRATE=false` và chạy service `migrate` trước.

Chạy trực tiếp mặc định trích xuất đồng bộ. Muốn dùng worker, đặt `BACKGROUND_JOBS=true`, cùng cấu hình DB và `STORAGE_PATH` cho API lẫn worker, rồi chạy thêm `python -m backend.app.worker` trong terminal riêng. Không bật xử lý nền nếu chưa chạy worker.

Xem cấu hình mẫu ở `.env.example`, `backend/.env.example` và `frontend/.env.example`. Chương trình đọc biến môi trường của tiến trình; không tự nạp `.env` của backend. API frontend hiện dùng tiền tố `/api`; chuyển sang `/api/v1` theo tài liệu vẫn cần thay đổi hợp đồng API riêng. Vite chuyển tiếp `/api` đến cổng 8000; dùng `API_PROXY_TARGET` hoặc `VITE_API_URL` khi cần chạy khác origin.

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
  app/db.py         # PostgreSQL/SQLite, giao dịch và khởi tạo dữ liệu
  app/migrate.py    # Lệnh áp migration và seed
  app/migrations/   # Migration có phiên bản cho PostgreSQL và SQLite
  app/jobs.py       # Job bền vững, lease, retry và kho tệp
  app/worker.py     # Tiến trình trích xuất chạy riêng
  app/extraction.py # Trích xuất TXT, DOCX, PDF và OCR ảnh/trang scan
  app/structure.py  # Tách phần, đoạn, câu, ý; ghép ngữ cảnh và loại phần kết thúc
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
