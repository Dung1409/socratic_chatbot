# Triển khai Socratic Chatbot trên Northflank và Vercel

## 1. Kiến trúc

- React/Vite SPA trên Vercel gọi API cùng origin qua `/api`.
- FastAPI trên Northflank, port 8000; PostgreSQL 16 Addon lưu dữ liệu, auth session và queue `jobs`.
- Worker riêng dùng cùng backend image, PostgreSQL và shared persistent volume với API.
- Migration là Northflank Job, phải thành công trước khi phát hành API/worker.
- Một volume **Multi Read/Write**, cùng subpath, mount `/app/storage` cho cả API và worker.
- OpenAI chỉ gọi từ API. Không thêm Redis, Celery, S3; không thay policy Socratic/rubric.

Thực hiện staging trước production. Repository không tự push/deploy. Không dùng DB production cho tests.

## 2. PostgreSQL 16

1. Tạo project và PostgreSQL Addon phiên bản 16 cùng region với backend.
2. Giữ database trên mạng nội bộ; bật backup theo yêu cầu lưu giữ dữ liệu.
3. Liên kết connection URL của addon qua Secret Group thành `DATABASE_URL` cho API, worker, Job.
4. URL phải có scheme `postgresql://` hoặc `postgres://`, host và database name.
   Nếu tự ghép URL, percent-encode ký tự đặc biệt trong user/password.
5. Cấu hình TLS theo addon. Khi có CA và hostname phù hợp, ưu tiên `sslmode=verify-full`.
   `sslmode=require` mã hóa nhưng không thay thế xác minh danh tính đầy đủ.

Production bắt buộc có DATABASE_URL; bộ PGHOST không thay thế URL ở chế độ này.
SQLite local được giữ nguyên. Migration schema không tự chuyển dữ liệu SQLite sang PostgreSQL.

## 3. Secret Groups và biến môi trường

Tham khảo `backend/.env.example`, thay tất cả placeholder trước khi chạy. Không đưa key/URL thật
vào Git, build arguments hoặc Vercel. Production chỉ đọc process environment; development đọc
`.env` gốc với process variables có ưu tiên cao hơn. `backend/.env.example` không được tự nạp.

### Nhóm chung cho API, worker, migration

| Biến | Giá trị |
| --- | --- |
| APP_ENV | production |
| DATABASE_URL | Connection URL PostgreSQL addon, cùng database cho ba workload |
| AUTO_MIGRATE | false |
| DB_STATEMENT_TIMEOUT_MS | 30000; có thể tăng riêng cho Job sau khi thử migration trên staging |
| DB_LOCK_TIMEOUT_MS | 5000; điều tra lock trước khi chạy lại Job |
| LOG_LEVEL | INFO, WARNING hoặc ERROR |

Nên dùng role migration có DDL và role runtime chỉ đủ SELECT/INSERT/UPDATE/DELETE, quyền
sequence cần thiết. Nếu tách role, bảo đảm quyền trên bảng/sequence mới và thử trên staging.

### Nhóm API

| Biến | Giá trị |
| --- | --- |
| JWT_SECRET | Khóa ngẫu nhiên riêng, ít nhất 32 byte; giữ ổn định qua restart/rollback |
| AUTH_COOKIE_SECURE | true |
| AUTH_ACCESS_SECONDS / AUTH_REFRESH_SECONDS | 900 / 604800 |
| AUTH_ALLOWED_ORIGINS | Origin HTTPS frontend chính xác, nhiều origin phân tách bằng dấu phẩy |
| CORS_ORIGINS | Origin được phép, phải nằm trong AUTH_ALLOWED_ORIGINS |
| FORWARDED_ALLOW_IPS | IP/CIDR proxy đã xác minh, xem mục 9 |
| TUTOR_MODE | openai |
| OPENAI_API_KEY | Project key riêng, chỉ cấp cho API |
| OPENAI_TUTOR_MODEL / OPENAI_ASSESSMENT_MODEL | gpt-6.1-sol / gpt-6.1-sol, model hiện có trong source |
| AI_REQUESTS_PER_HOUR | 60 mặc định, theo tài khoản; điều chỉnh theo ngân sách/quota |
| UPLOADS_PER_HOUR | 20 mặc định, theo tài khoản |
| BACKGROUND_JOBS | true |
| STORAGE_PATH | /app/storage |

Tạo JWT key trong môi trường riêng bằng `python -c "import secrets; print(secrets.token_urlsafe(48))"`,
đưa vào secret manager. Không lưu kết quả vào log/issue/chat và không tạo lại mỗi lần deploy.

### Nhóm worker và frontend

Worker thêm STORAGE_PATH=/app/storage, WORKER_JOB_TIMEOUT_SECONDS=45,
WORKER_PARSER_MEMORY_MB=512. Không cấp JWT/OpenAI key, CORS hoặc proxy settings cho worker.
Giới hạn bộ nhớ parser áp dụng trên Linux; bắt đầu container từ 1 GiB rồi đo thực tế.
Đặt termination grace period ít nhất 60 giây để hoàn tất job hoặc deadline.

Frontend: VITE_API_URL để trống hoặc bỏ qua; production luôn gọi `/api` cùng origin.
Biến này chỉ là override development, không có `/api` ở cuối. API_PROXY_TARGET chỉ dành cho
Vite development. Không đưa secret backend vào biến VITE_*.

## 4. Build Docker image

Tạo Northflank build service từ repo, Dockerfile `backend/Dockerfile`, build context/work directory
`backend/`. Context phải chứa `requirements.txt` và `app/`; không dùng context root với Dockerfile này.
Build một lần và chọn cùng immutable image/digest cho API, worker và migration Job.

Kiểm tra local từ repository root:

```powershell
docker build --file backend/Dockerfile --tag socratic-backend:RELEASE_TAG backend
```

Không truyền runtime secrets lúc build. `.dockerignore` loại `.env`, DB/data local và test.
Image dùng UID/GID `10001:10001`, không có ENTRYPOINT cản command override. Dockerfile root
dành cho image frontend/backend chung, không cần dùng khi frontend ở Vercel.
Image mặc định production; Compose đặt development để giữ local HTTP và dữ liệu cũ.

## 5. Migration Job

Tạo Job dùng image của release, nhóm DB, không cần storage/JWT/OpenAI. Command:

```text
python -m backend.app.migrate
```

Tắt HTTP health check kế thừa. Chạy Job và chỉ tiếp tục khi exit 0. Lỗi trả exit 1,
log loại lỗi, không in URL DB. AUTO_MIGRATE=false không vô hiệu hóa command độc lập.
Migration có transaction và version, chạy lại qua runner sau khi kiểm tra nguyên nhân lỗi.
Không sửa migration đã áp, không reset schema/database. Ba migration hiện có giữ nguyên.
Dữ liệu legacy owner_id=NULL được giữ, cần kế hoạch gán owner riêng nếu muốn chuyển dữ liệu cũ.

Tắt auto-deploy API/worker theo source change, hoặc cấu hình workflow chặn release:
build thành công → migration Job thành công → deploy API/worker cùng digest.
Không để workload mới tự deploy trước khi Job hoàn tất.

## 6. API Deployment

Liên kết nhóm chung + API, dùng image đã migration thành công, expose HTTP port 8000, bật HTTPS ingress.
Command mặc định:

```text
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --no-access-log
```

Biến PORT không thay command này. Gắn storage trước khi chạy. Cấu hình startup/readiness
HTTP `/api/ready`, liveness `/api/health`, port 8000, timeout 10 giây, period 15–30 giây.
Thiếu DB/JWT/origins/proxy/AI key hoặc cấu hình production không hợp lệ sẽ chặn startup.

Health kiểm tra tiến trình sống. Ready kiểm tra DB/schema, thực sự ghi/đọc storage và AI key
có cấu hình; không gọi OpenAI tính phí, không chứng minh model access/quota. Giám sát worker riêng.

## 7. Worker Deployment và health check

Dùng cùng image với API, nhóm DB + worker, không expose HTTP port. Override command:

```text
python -m backend.app.worker
```

Override HTTP health check của image bằng CMD probe:

```text
python -c "from backend.app.worker import check_health; check_health()"
```

Khuyến nghị period 10 giây, timeout 10 giây, startup delay 10 giây, failure threshold 3.
Probe kiểm tra heartbeat dưới 60 giây, DB/schema và storage I/O. Không dùng cho migration Job.

Worker có lease 120 giây được gia hạn. Parser chạy subprocess, bị terminate khi hết deadline;
lỗi tạm thời retry tối đa ba attempts, file sai định dạng kết thúc thất bại.
Kill giữa job: worker khác nhận lại sau khi lease hết hạn. Lease token chặn kết quả cũ ghi đè.
Parser có thể thực thi lại; không cam kết exactly-once. SIGTERM ngừng nhận job mới sau job hiện tại.

## 8. Shared persistent volume

Tạo **một volume Multi Read/Write**, gắn cùng volume/subpath vào API và worker tại `/app/storage`.
Hai volume khác nhau có cùng mount path không chia sẻ dữ liệu. Single Read/Write không phù hợp.
Nếu region/plan không hỗ trợ, dừng triển khai và xác nhận với Northflank; không tự đổi storage.

Docker build chỉ tạo thư mục; persistent volume phải được gắn ở runtime. Mount có thể che quyền
thư mục trong image: cấu hình owner/group 10001:10001 bằng nền tảng. Production Linux yêu cầu
STORAGE_PATH là mount point; quên gắn volume sẽ chặn startup thay vì lưu vào container tạm. Không chạy app bằng root
hoặc chmod 777. Startup/readiness thực hiện probe I/O để phát hiện lỗi quyền/mount read-only.

Trên staging: upload TXT qua API, worker chuyển sang needs_review, restart riêng API/worker
và đọc lại tài liệu. Backup volume cùng kế hoạch backup DB. Chưa có tự dọn file mồ côi/retention;
cần giám sát dung lượng và chính sách vận hành trước khi sử dụng quy mô lớn.

## 9. Cookie, CORS và reverse proxy

Cookie host-only có HttpOnly, Secure, SameSite=Lax; access Path=/api, refresh Path=/api/auth.
Vercel rewrite phải giữ hai path, Cookie và Set-Cookie. Browser nhìn thấy origin frontend;
không đổi SameSite sang None hoặc đặt Cookie Domain Northflank.

Allowlist dùng origin frontend, ví dụ https://study.example.com, không phải URL backend,
không có path. Chỉ thêm preview origin cụ thể nếu có staging backend/DB riêng; không dùng wildcard.
X-CSRF-Token tiếp tục được kiểm tra. CORS không thay authentication hoặc CSRF.

Uvicorn chỉ tin forwarded headers từ FORWARDED_ALLOW_IPS. Repo không đoán CIDR Northflank:
xác minh ingress peer IP/CIDR của project với nền tảng. So sánh request trực tiếp và qua Vercel,
thử từ hai client IP khác nhau, kiểm tra proxy chuẩn hóa header và toàn chuỗi hop tin cậy.
Không dùng `*`, `0.0.0.0/0`, `::/0` hoặc tin toàn mạng để che lỗi; production từ chối wildcard và /0.

Login/register rate limit và AI/upload quota lưu trong PostgreSQL, trả 429 + Retry-After.
Quota AI tính cả lần gọi lỗi; retry có thể tính thêm request. Retry đã hoàn tất không gọi provider lại.
Quota theo tài khoản không phải ngân sách toàn hệ thống: thêm hạn mức/cảnh báo OpenAI project,
giám sát số tài khoản, chi phí, backlog và storage. Không bật SDK debug hay body logging ở proxy.
Log API chỉ ghi request ID do server tạo, method, route template, status, thời gian; không query/body/cookie.

## 10. Frontend Vercel

1. Thay `https://YOUR-BACKEND-DOMAIN.invalid` trong `frontend/vercel.json` bằng HTTPS origin thật
   của API, không trailing slash. Placeholder cố ý không hoạt động; Vercel không tự nội suy VITE_API_URL.
2. Giữ API rewrite trước SPA fallback, destination `/api/:path*` để giữ prefix.
3. Import repo: Root Directory frontend, framework Vite, Install npm ci, Build npm run build,
   Output dist, Node 22.12+ hoặc phiên bản phù hợp lockfile.
4. VITE_API_URL trống; không cần key/database credentials trên Vercel.
5. Tắt auto production deploy nếu phát hành thủ công; preview dùng backend/DB staging riêng.

API đặt no-store ở cả Vercel và backend. SPA fallback loại `/api`, `/assets` và path có phần mở rộng.
Kiểm tra refresh `/dang-nhap`, `/de-bai`, `/phien-hoc`, `/tien-trinh`; JS asset thật, asset không tồn tại
và `/api/does-not-exist`. API lỗi phải trả lỗi API, không trả HTML index; asset thiếu trả 404.

## 11. Kiểm tra staging trước GO

- DB đúng addon, đủ migration; restart API không tự migration.
- Health/ready 200; ready 503 khi mất DB/storage (chỉ thử lỗi trên staging).
- Worker CMD probe exit 0, API upload → worker → xem lại sau restart.
- Cookie đúng Secure/HttpOnly/path: login → reload → access hết hạn → refresh → logout.
- CSRF/origin sai bị từ chối; hai tài khoản không đọc dữ liệu nhau; logout thu hồi token cũ.
- IP/rate limit đúng qua chuỗi proxy; IP header giả không vượt hạn mức; quota trả 429.
- Bundle/log không secrets; smoke test Tutor/Assessment bằng project OpenAI test, kiểm tra quota/latency.
- Backup/restore DB và file đã diễn tập; cảnh báo chi phí/disk/backlog đã cấu hình.

OpenAI SDK hiện timeout 60 giây, không tự retry; frontend giữ pending input để thử lại/hủy.
External rewrite Vercel tối đa 120 giây. Đo tổng latency; không tăng retry/timeout vượt ngân sách
này mà chưa kiểm tra lại lease và UX. Không thay model/policy/rubric khi chỉ triển khai hạ tầng.

## 12. Deploy thủ công khi có commit mới

1. Chạy tests/build, review; chỉ push khi người vận hành quyết định.
2. Build image từ commit cụ thể, ghi digest mới và digest trước đó.
3. Backup trước migration thay đổi dữ liệu/schema; diễn tập staging.
4. Chạy migration Job image mới; lỗi thì dừng release, giữ API/worker cũ, điều tra.
5. Deploy API và worker cùng image mới sau Job exit 0; chờ readiness/health.
6. Smoke test backend, phát hành frontend Vercel commit tương ứng.
7. Kiểm tra cookie, upload, phiên học test; theo dõi lỗi và chi phí.

## 13. Rollback và xử lý sự cố

Rollback API và worker về digest cũ **tương thích schema**, frontend về bản tương ứng nếu cần.
Giữ JWT key. Migration chỉ tiến tới, chưa có downgrade tự động; rollback image không hoàn tác DB.
Nếu schema không tương thích, dừng ghi và dùng kế hoạch restore đã diễn tập. Restore có thể mất dữ liệu
sau backup nên cần quyết định của người vận hành. Không reset/xóa dữ liệu để sửa lỗi deploy.

| Triệu chứng | Kiểm tra |
| --- | --- |
| Startup thất bại | Tên biến trong lỗi: DB URL, JWT, Secure, origins, proxy, AI key; không in giá trị secret |
| Migration exit 1 | Kết nối/quyền, timeout/lock và schema_migrations qua công cụ bảo mật; không chạy lại mù quáng |
| Ready 503 | DB/schema, mount, UID/GID, dung lượng và storage I/O |
| Worker unhealthy | Override HTTP probe chưa, heartbeat, DB, mount và deadline |
| Upload đứng uploaded | Worker có chạy, cùng DB/volume, backlog và attempts |
| Login/refresh 403 | Origin allowlist, CSRF, prefix /api có giữ nguyên |
| Reload mất session | HTTPS, Set-Cookie, path, frontend có cùng origin |
| Nhiều người chung 429 | Xác minh client IP/trusted proxies; không bỏ limiter để che lỗi |
| AI lỗi | Quota ứng dụng/provider, Retry-After, model access, giữ input để thử lại |
| Trang con 404 / API trả HTML | Root Directory Vercel, rewrite order và backend destination |

## Tài liệu nền tảng

- [Northflank shared volumes](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)
- [Northflank health checks và CMD probe](https://northflank.com/docs/v1/application/observe/configure-health-checks)
- [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Vite SPA trên Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel external proxy timeout](https://vercel.com/docs/limits)
- [GPT-6.1 Sol và Structured Outputs](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
