# SocraVăn — Socratic × Bloom

Ứng dụng tự học **đọc hiểu và nghị luận xã hội**: học sinh nhập/tải đề và ngữ liệu, đối thoại Socratic thích ứng với OpenAI, tự tổng hợp bài làm và nhận báo cáo Bloom–tự lực cuối phiên. Không yêu cầu chọn bậc Bloom trước khi học. Phiên kịch bản cũ vẫn xem lại và tiếp tục được.

Giao diện phát triển từ [Toan0409/bloom-guided-scribe](https://github.com/Toan0409/bloom-guided-scribe), commit `64c30dd7eb11b2745d17d0548c214f668cb67c91`. Backend sử dụng **FastAPI**, chạy **PostgreSQL** và worker khi dùng Docker Compose; vẫn hỗ trợ **SQLite** khi chạy Python trực tiếp.

## Kết nối OpenAI và đánh giá tư duy

Hướng dẫn production: [Northflank + Vercel](docs/DEPLOY_NORTHFLANK_VERCEL.md).
Docker image mặc định `APP_ENV=production`; Compose đặt rõ `development` cho local.
Production bắt buộc PostgreSQL, Secure cookie, origin allowlist và migration Job riêng;
proxy allowlist chỉ bắt buộc khi bật `TRUST_PROXY_HEADERS=true`.
Northflank Free: một Deployment Service `socratic-api` đặt `RUN_MODE=combined`, chạy một
API và một worker trong cùng container, dùng volume `socratic-files` 6 GB ReadWriteOnce
mount `/app/storage`; không tạo Worker Service riêng. CMD mới là
`python -m backend.app.entrypoint`; có thể override bằng `python -m backend.app.combined`.
Đặt `AUTO_MIGRATE=false`, `BACKGROUND_JOBS=true`, `SHUTDOWN_GRACE_SECONDS=120` và termination
grace của nền tảng 150 giây. Probe: `python -m backend.app.healthcheck`.
Staging chưa xác minh ingress: đặt `TRUST_PROXY_HEADERS=false`, bỏ `FORWARDED_ALLOW_IPS`,
đặt `PUBLIC_API_ORIGIN=https://<frontend-staging>` để redirect/URL dùng HTTPS từ cấu hình tĩnh.
Cookie vẫn Secure; login/register có thể dùng chung bucket IP ingress, xem giới hạn trong tài liệu deploy.
Mặc định image vẫn `RUN_MODE=api`; `RUN_MODE=worker` và command migration độc lập vẫn dùng được.
Docker Compose local bên dưới vẫn minh họa cách chạy API/worker thành service riêng.

Sau khi khởi tạo môi trường, cấu hình `OPENAI_API_KEY` trong `.env` gốc trước khi bắt đầu phiên AI. Backend tự đọc `.env`; biến môi trường tiến trình có ưu tiên cao hơn. Khóa chỉ dùng ở backend, không đưa vào frontend hoặc Git.

```dotenv
TUTOR_MODE=openai
OPENAI_API_KEY=
OPENAI_TUTOR_MODEL=gpt-6.1-sol
OPENAI_ASSESSMENT_MODEL=gpt-6.1-sol
```

Hai model có thể cấu hình độc lập. Thiếu khóa hoặc API lỗi: báo rõ và giữ đề/bài làm để thử lại; không tự chuyển sang câu hỏi mẫu hoặc tạo điểm giả. `TUTOR_MODE=template` chỉ dùng cho chế độ kịch bản cũ, không chấm điểm AI. Compose truyền cấu hình từ `.env` cho backend; khởi tạo lại service sau khi đổi biến.

- AI phân tích đề, xác định mục tiêu bằng lời dễ hiểu và chọn câu hỏi theo câu trả lời thực tế. Sáu nhóm Socratic không phải sáu bước bắt buộc hay sáu bậc Bloom tương ứng.
- Thiếu đoạn trích: AI yêu cầu bổ sung; lượt cung cấp ngữ liệu không được chấm như câu trả lời tự suy luận.
- Mỗi lượt hỗ trợ bổ sung thực sự được lưu tính một sự kiện N, dù học sinh xin gợi ý hay AI chủ động hỗ trợ do bế tắc. Câu hỏi Socratic thông thường và yêu cầu bổ sung ngữ liệu không tính N. Lý do hỗ trợ được lưu và hiển thị.
- Chuỗi hỗ trợ giữ câu hỏi và mục tiêu gốc ở server. AI kiểm tra riêng độ bám mục tiêu, hỗ trợ mới và nguy cơ làm thay trước khi lưu; gợi ý bị từ chối không tăng N. Ví dụ phải nối lại câu hỏi gốc trong cùng lượt. Kiểm tra ngữ nghĩa vẫn phụ thuộc model.
- Sau 3 gợi ý chưa có phản hồi mới, học sinh chọn chỗ vướng (hiểu câu hỏi, tìm ý, diễn đạt) hoặc thử trả lời để tiếp tục. Đây không phải giới hạn tổng số gợi ý. Lựa chọn được lưu là `purpose=clarification`, không tính là câu trả lời, bằng chứng chấm hay một sự kiện N riêng. Hỗ trợ mới được giao sau lựa chọn vẫn tính N; lựa chọn và mã yêu cầu được giữ qua lỗi/reload để retry đúng một lần.
- Học sinh có thể kết thúc đối thoại sau ít nhất một câu trả lời hoặc tiếp tục trao đổi trước khi nộp phần tổng hợp. Giới hạn 40 câu trả lời/phiên; khi chạm giới hạn, chuyển sang tổng hợp.
- Chấm đúng **ba tầng 30–35–35**: Cơ bản (Nhớ–Hiểu), Vận dụng (Áp dụng–Phân tích), Bậc cao (Đánh giá–Sáng tạo). Không chia thành sáu tiêu chí có trọng số riêng. Mốc chất lượng trong mỗi tầng nằm ở `backend/app/assessment.py`, là hướng dẫn vận hành hóa v1 cần đối chiếu với bài chấm mẫu của giáo viên.
- `B = Cơ bản + Vận dụng + Bậc cao`; `A = max(0.3, 1 - 0.1*N)`; `S = B*A`. Backend dùng Decimal, làm tròn khi hiển thị và xếp loại từ giá trị gốc: `[80,100]` Xuất sắc, `[65,80)` Khá, `[50,65)` Trung bình, dưới 50 Cần Rèn Luyện.
- AI phải trích nguyên văn và chỉ đúng ID câu trả lời/bài tổng hợp làm bằng chứng; backend từ chối điểm vượt thang, bằng chứng không tồn tại hoặc trích từ AI/ngữ liệu bổ sung. Báo cáo có điểm từng tầng, B, N, A, S, xếp loại, điểm mạnh và bước luyện tiếp theo.
- Thiếu bằng chứng cho cả ba tầng: `insufficient_evidence`, giữ điểm từng tầng đã quan sát, B/S/xếp loại là `null`; không quy thiếu dữ liệu thành 0. Xếp loại mô tả kết quả phiên, không phải năng lực ổn định hay bảng xếp hạng giữa các đề khác nhau.
- Trước khi chốt điểm, AI rà soát cơ hội quan sát của từng tầng và điểm mạnh có bằng chứng. Chỉ đặt câu hỏi hoặc đưa tình huống phụ chưa được học sinh trả lời không đủ để gán 0; tầng chưa thể đánh giá được chuyển về `observed=false, points=null`.
- OpenAI dùng Responses API + Structured Outputs, `store=false`, chạy ngoài giao dịch database. Yêu cầu đang xử lý/lỗi được lưu bền vững để thử lại hoặc hủy sau khi tải lại trang. Lease đối thoại/đánh giá 180 giây bao gồm lượt sinh và lượt rà soát; khóa phiên bản ngăn phản hồi cũ ghi đè; gửi lại cùng mã không tạo thêm câu trả lời hoặc sự kiện hỗ trợ.
- Phiên mới lưu model đối thoại, model đánh giá, phiên bản chính sách và phiên bản chấm điểm. Thay model cấu hình không tự đổi model của phiên đang học.

Kiểm thử dùng provider giả lập và kiểm tra SDK thật qua HTTP mock; không chứng minh chất lượng sư phạm hoặc độ chính xác chấm điểm của model. Cần chạy tập bài giữ lại có giáo viên chấm đối chiếu trước khi dùng điểm trong nghiên cứu chính thức.

### Đề xuất công thức mới — chưa áp dụng

Giữ `B` theo bằng chứng học sinh thực sự tạo ra, đề xuất `A = 0.3 + 0.7 / (1 + N/7)` và `S = B*A`. A bắt đầu bằng 1, giảm chậm dần và tiến về sàn 0.3. Với N=6/7, A khoảng 0.677/0.65 thay vì 0.4/0.3; ngay cả lượt hỗ trợ đầu cũng giảm nhẹ hơn công thức cũ (0.9125 thay vì 0.9). Mỗi lần xin thêm có tác động nhỏ dần, vẫn ghi nhận thành quả sau nhiều lượt hỗ trợ. Không cộng điểm chỉ vì bấm gợi ý hoặc nộp lời đáp; phần do AI cung cấp không thành bằng chứng tự lực.

Sàn 0.3 và mốc 7 là giả thuyết thiết kế cần hiệu chỉnh bằng bài chấm đối chiếu và phản hồi học sinh, không phải hằng số suy ra từ ZPD. N toàn phiên phụ thuộc số mục tiêu và độ dài bài; không dùng đơn độc để so sánh năng lực giữa các bài. Nên ưu tiên hiển thị B và tiến bộ, mô tả A là bối cảnh hỗ trợ; xem xét lại nhãn xếp loại theo S để tránh diễn giải chất lượng đạt được với hỗ trợ thành năng lực độc lập thấp. Cơ sở định hướng về động lực: [Ryan & Deci (2000)](https://www.selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf); nghiên cứu này không xác nhận công thức số học nêu trên. Công thức đang chạy và báo cáo đã lưu vẫn giữ nguyên cho tới khi chốt phiên bản tính điểm mới.

## Chạy trên Windows

Yêu cầu: Python 3.11+ và Node.js 22.12+ (đã kiểm tra với Python 3.11, Node.js 24).

Chạy trong thư mục gốc dự án:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend ci
.\.venv\Scripts\python.exe scripts\init_env.py
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

- Giao diện: http://127.0.0.1:5173
- Swagger API: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/api/health

`Ctrl+C` dừng cả hai tiến trình. Log nằm trong `artifacts/`.

Hoặc chạy hai terminal riêng để backend tự tải lại khi sửa code:

```powershell
# Terminal 1, tại thư mục gốc
$env:JWT_SECRET = .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000 --no-proxy-headers
```

```powershell
# Terminal 2, tại thư mục gốc
npm --prefix frontend run dev
```

## Chạy bằng Docker Compose

Yêu cầu: Docker Engine và Docker Compose v2 (hoặc Docker Desktop đang chạy).
Tại thư mục gốc dự án:

```powershell
python scripts/init_env.py
docker compose up -d --build
docker compose ps
```

`init_env.py` tạo `.env` từ cấu hình mẫu nếu chưa có, sinh khóa ký JWT ngẫu
nhiên khi còn trống và giữ nguyên các giá trị đã cấu hình. Không in khóa ra
terminal, không ghi `.env` vào Git. API từ chối khởi động nếu `JWT_SECRET` thiếu
hoặc ngắn hơn 32 byte. Khóa phải giữ ổn định qua các lần restart để các phiên
đăng nhập tiếp tục hợp lệ.

Nếu máy chỉ có Docker, có thể tạo `.env` bằng Python trong container trước:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace python:3.11-slim-bookworm python scripts/init_env.py
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
| `migrate` | Áp migration có phiên bản, rồi thoát với mã 0 | PostgreSQL sẵn sàng |
| `backend` | FastAPI, ghi nhận upload và tạo job; user thường | Migration thành công; health check `/api/ready` kiểm tra DB và kho tệp |
| `worker` | Trích xuất TXT, DOCX, PDF có chữ; nhận job từ PostgreSQL | Migration thành công; health check heartbeat và DB |
| `frontend` | Build React bằng Node.js, phục vụ SPA bằng Nginx | API và worker khỏe |

`migrate` ở trạng thái `Exited (0)` sau khi chạy là bình thường. API và worker
dùng cùng `backend/Dockerfile`, có lệnh khởi động riêng. Migration có thể chạy
lại; không tự tạo đề mẫu hoặc ghi đè nội dung học tập đã lưu.

Nginx chuyển tiếp `/api/` sang `backend:8000`, giữ nguyên tiền tố `/api`.
Frontend gọi API cùng origin, không cần `VITE_API_URL` hoặc cấu hình CORS riêng.
PostgreSQL chỉ nằm trên network nội bộ, không mở cổng ra máy. Local dùng HTTP;
khi triển khai ngoài local cần bổ sung reverse proxy kết thúc TLS và cấu hình
bí mật theo môi trường. Bản Compose local dùng HTTP; đặt `AUTH_COOKIE_SECURE=true`
và `AUTH_ALLOWED_ORIGINS=https://ten-mien-cua-ban` khi chạy qua HTTPS.

Kho tệp local là volume dùng chung giữa API và worker, phù hợp lựa chọn trong
tài liệu. Chưa cần MinIO/S3 riêng. Hàng đợi dùng bảng `jobs`, không cần Redis,
Celery hoặc RabbitMQ. Truy xuất vector, pgvector và OCR vẫn là phần mở rộng.

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
bảng trống nếu PostgreSQL chưa được khởi tạo. Migration `002_self_study` ẩn các
đề mẫu cũ khỏi danh sách tạo phiên mới; vẫn giữ lịch sử phiên học và các đề
người dùng đã tạo, không xóa dữ liệu học tập.

Trong Compose, upload trả `202` cùng `document_id` và `job_id`. Frontend truy
vấn `GET /api/documents/{id}` cho đến khi trạng thái là `needs_review`, rồi
hiển thị nội dung để người dùng kiểm tra. Có thể tạo job trực tiếp bằng
`POST /api/documents`. PDF tối đa 30 trang, tệp tối đa 10 MB.

Worker claim job bằng khóa hàng `FOR UPDATE SKIP LOCKED`, có lease 120 giây,
gia hạn khi xử lý, retry lỗi tạm thời tối đa ba lần và nhận lại job có lease
hết hạn sau khi tiến trình bị dừng. Token của lease ngăn worker cũ ghi đè kết
quả mới. Job và dữ liệu gốc vẫn còn nếu API/worker restart. Worker xử lý trích xuất;
đối thoại và đánh giá OpenAI chạy qua API phiên học, ngoài giao dịch database.

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

- Đăng ký, đăng nhập, đăng xuất và tự làm mới phiên bằng JWT trong HttpOnly Cookie; tài khoản và phiên đăng nhập lưu trong PostgreSQL khi dùng Compose.
- Đề, tệp và phiên học được kiểm tra chủ sở hữu trên từng request. Các tài khoản không đọc hoặc sửa dữ liệu của nhau.
- Tải đề riêng bằng TXT UTF-8, DOCX hoặc PDF có chữ (tối đa 10MB, PDF tối đa 30 trang), hoặc nhập nội dung trực tiếp. Chọn đọc hiểu/nghị luận xã hội, bổ sung ngữ liệu và khối lớp nếu có.
- Danh sách chỉ hiển thị các đề người dùng tạo. Bản cài mới bắt đầu trống; mở trang phiên học khi chưa có dữ liệu sẽ hướng dẫn thêm đề thay vì tự tạo phiên mẫu.
- Bắt đầu đúng đề đã chọn; lưu đối thoại, các lượt hỗ trợ và bài viết cuối phiên vào PostgreSQL hoặc SQLite. Tải lại trang để tiếp tục. Bản nháp lưu trong trình duyệt; yêu cầu AI chưa hoàn tất còn được lưu ở backend.
- Chống gửi trùng bằng `client_message_id`, chống ghi đè khi nhiều yêu cầu gửi cùng lúc bằng phiên bản trạng thái.
- Lưu bài viết để hoàn thành phiên, xem lại đối thoại và bài viết trong nhật ký tự học.
- Tổng quan và tiến trình hiển thị hoạt động theo Bloom; phiên AI mới có báo cáo B–N–A–S, xếp loại và bằng chứng. Không có quy trình chờ giáo viên hoặc API giáo viên/rubric/review.

## Phạm vi bản local

Gia sư mặc định dùng **OpenAI** cho đọc hiểu và nghị luận xã hội. Phiên kịch bản cũ không được tự gán điểm hoặc chuyển sang AI. Biểu đồ Bloom vẫn đếm hoạt động; điểm đánh giá nằm riêng trong báo cáo cuối phiên.

Đã có tài khoản và tách dữ liệu theo người dùng. PostgreSQL, migration và worker trích xuất lưu tệp gốc chạy trong Compose. Chưa hỗ trợ OCR ảnh/PDF scan hoặc xuất dữ liệu nghiên cứu. Dữ liệu nghiệp vụ giữ cấu trúc JSON trong bảng `documents`; trường phiên AI mới không yêu cầu di chuyển/xóa phiên cũ.

## Đăng ký và đăng nhập

Mở `/dang-ky` để tạo tài khoản bằng tên hiển thị, email và mật khẩu tối thiểu
8 ký tự. Đăng ký thành công đăng nhập luôn. `/dang-nhap` cho tài khoản đã có;
các trang học tập tự chuyển đến trang đăng nhập nếu chưa được xác thực.

- Mật khẩu băm bằng Argon2id qua `pwdlib`; email chuẩn hóa chữ thường và có ràng buộc duy nhất trong database.
- Access JWT mặc định 15 phút, refresh JWT tối đa 7 ngày, có `iss`, `aud`, `exp`, `nbf`, `sub`, `sid`, `jti` và loại token riêng. Server chỉ chấp nhận thuật toán HS256 đã cấu hình.
- Hai cookie host-only `socratic_access` (`Path=/api`) và `socratic_refresh` (`Path=/api/auth`) có `HttpOnly`, `SameSite=Lax`; `Secure` cấu hình theo môi trường. JWT không được trả trong JSON hay lưu trong localStorage/sessionStorage.
- Refresh token được xoay vòng; database chỉ lưu hash của token. Phát hiện dùng lại refresh token cũ sẽ thu hồi phiên. Đăng xuất thu hồi phiên ở database nên access token đã sao chép cũng không còn dùng được.
- Các request ghi dữ liệu cần header `X-CSRF-Token` gắn với phiên và nguồn trang phải nằm trong `AUTH_ALLOWED_ORIGINS`. Frontend tự thêm header và gửi cookie với `credentials: include`.
- Frontend tự refresh khi access token hết hạn, phối hợp request trong tab và dùng Web Locks khi trình duyệt hỗ trợ để tránh refresh trùng giữa các tab.
- Giới hạn thử đăng nhập được lưu trong database: tối đa 10 lần/email và 100 lần/IP trong 15 phút; đăng ký tối đa 20 lần/IP trong 15 phút. Chưa tự tin cậy header IP do client gửi; khi dùng reverse proxy cần cấu hình proxy tin cậy trước khi áp hạn mức cho hệ thống lớn.
- Đăng xuất xóa cache học tập và bản nháp của tài khoản trong tab. Bản nháp dùng sessionStorage theo user ID, tồn tại qua reload trong cùng tab; bài viết đã hoàn thành vẫn ở database.

| Endpoint | Chức năng |
| --- | --- |
| `POST /api/auth/register` | Tạo tài khoản và cookie đăng nhập |
| `POST /api/auth/login` | Kiểm tra tài khoản, tạo phiên |
| `GET /api/auth/me` | Thông tin người dùng và CSRF token; không trả JWT |
| `GET /api/auth/csrf` | Lấy CSRF token khi chỉ còn refresh cookie hợp lệ |
| `POST /api/auth/refresh` | Xoay refresh token và cấp access cookie mới |
| `POST /api/auth/logout` | Thu hồi phiên, xóa hai cookie |

Migration `003_auth` bổ sung `users`, `auth_sessions`, hạn mức đăng nhập và
`owner_id` cho dữ liệu học tập. Dữ liệu từ bản dùng chung vẫn được giữ với
chủ sở hữu trống, không tự cấp cho tài khoản đăng ký đầu tiên. Việc chuyển
dữ liệu cũ sang tài khoản cụ thể cần được thực hiện riêng có chủ đích.

Chưa triển khai xác minh email, quên mật khẩu hoặc đăng nhập mạng xã hội.

Khi chạy Python trực tiếp, SQLite tự tạo tại `backend/data/socratic.db`; đổi vị trí bằng `DATABASE_PATH`. Đặt `DATABASE_URL` để dùng PostgreSQL, hoặc bộ biến `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`; PostgreSQL có ưu tiên cao hơn đường dẫn SQLite. `AUTO_MIGRATE=true` tự áp migration lúc khởi động khi chạy trực tiếp. Compose đặt `AUTO_MIGRATE=false` và chạy service `migrate` trước.

Chạy trực tiếp mặc định trích xuất đồng bộ. Muốn dùng worker, đặt `BACKGROUND_JOBS=true`, cùng cấu hình DB và `STORAGE_PATH` cho API lẫn worker, rồi chạy thêm `python -m backend.app.worker` trong terminal riêng. Không bật xử lý nền nếu chưa chạy worker.

Xem cấu hình mẫu ở `.env.example`, `backend/.env.example` và `frontend/.env.example`. Backend đọc biến môi trường của tiến trình; `dev.ps1` đọc riêng khóa JWT từ `.env` gốc nếu tiến trình chưa cấu hình. Khi chạy khác origin, cần cấu hình cả `AUTH_ALLOWED_ORIGINS`, `CORS_ORIGINS` và dùng cùng hostname để cookie `SameSite=Lax` hoạt động. API frontend dùng tiền tố `/api`; Vite chuyển tiếp đến cổng 8000.

## Build và chạy một cổng

```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m backend.app.entrypoint
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

E2E dùng Chrome, backend riêng ở cổng 8011, khóa ký thử nghiệm và database riêng trong `backend/data/`. Kiểm tra đăng ký/đăng nhập/đăng xuất, tự refresh cookie, cô lập hai tài khoản, nhập/tải đề, học–lưu bài–xem lại, bản nháp và mobile. Kiểm thử API kiểm tra mật khẩu băm, JWT hết hạn/giả mạo/sai loại, refresh replay, CSRF, nguồn trang, hạn mức và quyền sở hữu. Đặt `TEST_DATABASE_URL` trỏ tới PostgreSQL thử nghiệm để chạy cùng bộ test trong schema riêng từng test. Ảnh chụp nằm trong `artifacts/`.

## Cấu trúc

```text
backend/
  app/main.py       # FastAPI routes và phục vụ bản build frontend
  app/db.py         # PostgreSQL/SQLite, giao dịch và khởi tạo dữ liệu
  app/auth.py       # Tài khoản, Argon2id, JWT cookie, CSRF và phiên đăng nhập
  app/migrate.py    # Lệnh áp migration
  app/migrations/   # Migration có phiên bản cho PostgreSQL và SQLite
  app/jobs.py       # Job bền vững, lease, retry và kho tệp
  app/worker.py     # Tiến trình trích xuất chạy riêng
  app/extraction.py # Trích xuất TXT, DOCX, PDF có chữ
  app/schemas.py    # Kiểm tra dữ liệu đầu vào
  app/tutor.py      # Chuỗi câu hỏi ở chế độ kịch bản
  app/ai_tutor.py   # OpenAI Responses và chính sách Socratic
  app/adaptive.py   # Phiên AI, yêu cầu bền vững, lease và chống gửi trùng
  app/assessment.py # Ba tầng Bloom, kiểm tra bằng chứng, tính B–A–S
  tests/            # Kiểm thử nghiệp vụ và API
frontend/
  src/routes/       # Các màn hình React/TanStack Router
  src/lib/api.ts    # API client và các kiểu dữ liệu
  e2e/              # Kiểm thử trình duyệt
scripts/dev.ps1     # Chạy frontend và backend trên Windows
docs/               # Tài liệu kỹ thuật có sẵn
```
