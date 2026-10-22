# Triển khai Socratic Chatbot trên Northflank và Vercel

## 1. Kiến trúc

- React/Vite SPA trên Vercel gọi API cùng origin qua `/api`.
- Một Deployment Service **`socratic-api`**, một replica, chạy FastAPI port 8000 và một worker
  trong **cùng container** bằng `RUN_MODE=combined`; không tạo Worker Service riêng.
- Một PostgreSQL 16 Addon lưu dữ liệu, auth session và queue `jobs`.
- Giữ Build Service và Migration Job độc lập hiện có; Job phải thành công trước release.
- Một volume **`socratic-files`, 6 GB, ReadWriteOnce (Single Read/Write)**, mount `/app/storage`
  vào `socratic-api`. API và worker thấy cùng filesystem trong container.
- OpenAI chỉ gọi từ API. Không thêm Redis, Celery, S3; không thay policy Socratic/rubric.

Thực hiện staging trước production. Repository không tự push/deploy. Không dùng DB production cho tests.
Đây là cấu hình cho tài nguyên Free đã có của project; kiểm tra quota thực tế trong tài khoản,
không giả định mọi region/gói Free đều cấp 1 GiB RAM hoặc cùng hạn mức volume/Job.

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
| DATABASE_URL | Connection URL PostgreSQL addon, dùng chung cho combined và Migration Job |
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
| TRUST_PROXY_HEADERS | false mặc định; dùng cho staging chưa xác minh ingress |
| FORWARDED_ALLOW_IPS | Chỉ bắt buộc khi TRUST_PROXY_HEADERS=true; proxy IP/CIDR đã xác minh |
| PUBLIC_API_ORIGIN | Origin HTTPS frontend staging, ví dụ https://study.example.com; bắt buộc production khi không trust proxy |
| AUTH_LOGIN_GLOBAL_LIMIT / AUTH_REGISTER_GLOBAL_LIMIT | 300 / 60 attempts toàn hệ thống mỗi 15 phút |
| TUTOR_MODE | openai |
| OPENAI_API_KEY | Project key riêng, chỉ cấp cho API |
| OPENAI_TUTOR_MODEL / OPENAI_ASSESSMENT_MODEL | gpt-6.1-sol / gpt-6.1-sol, model hiện có trong source |
| DOCUMENT_AI_MODEL | gpt-6.1-sol để đọc và sắp xếp nội dung ảnh, PDF, tài liệu; dùng cùng OPENAI_API_KEY |
| AI_REQUESTS_PER_HOUR | 60 mặc định, theo tài khoản; điều chỉnh theo ngân sách/quota |
| UPLOADS_PER_HOUR | 20 mặc định, theo tài khoản |
| BACKGROUND_JOBS | true |
| STORAGE_PATH | /app/storage |
| RUN_MODE | combined trên `socratic-api`; mặc định image vẫn là api |
| SHUTDOWN_GRACE_SECONDS | 120; supervisor từ chối giá trị dưới 60 |
| WORKER_JOB_TIMEOUT_SECONDS | 300 |
| DOCUMENT_AI_TIMEOUT_SECONDS | 30; mỗi lần đọc, tự giữ bản cục bộ khi hết thời gian dành cho AI |
| WORKER_PARSER_MEMORY_MB | 256 để bắt đầu thử nghiệm container khoảng 1 GiB |

Tạo JWT key trong môi trường riêng bằng `python -c "import secrets; print(secrets.token_urlsafe(48))"`,
đưa vào secret manager. Không lưu kết quả vào log/issue/chat và không tạo lại mỗi lần deploy.

### Worker trong combined và frontend

Hai subprocess kế thừa cùng environment, gồm DATABASE_URL, STORAGE_PATH và các secret API;
worker chỉ sử dụng cấu hình cần thiết và không log secret. Nếu tách worker trong tương lai,
chỉ cấp nhóm DB/storage/worker cho service đó. Combined chạy trên Linux/POSIX container.
Giới hạn bộ nhớ parser áp dụng trên Linux; mặc định combined là 256 MiB nếu chưa đặt biến.
Bắt đầu container từ khoảng 1 GiB rồi đo thực tế với PDF/DOCX và tải API đồng thời.
Không đặt `--reload`, không tăng Uvicorn workers, không nhân bản worker hoặc bật autoscaling.
Đặt **termination grace period của nền tảng 150 giây**, lớn hơn supervisor 120 giây,
để chờ job, DB finish và thu hồi subprocess. Nếu tăng parser/DB timeout, tăng cả hai grace periods.
Giới hạn parser không phải giới hạn RAM toàn container; OOM vẫn có thể xảy ra khi tải cao.

Frontend: VITE_API_URL để trống hoặc bỏ qua; production luôn gọi `/api` cùng origin.
Biến này chỉ là override development, không có `/api` ở cuối. API_PROXY_TARGET chỉ dành cho
Vite development. Không đưa secret backend vào biến VITE_*.

## 4. Build Docker image

Tạo Northflank build service từ repo, Dockerfile `backend/Dockerfile`, build context/work directory
`backend/`. Context phải chứa `requirements.txt` và `app/`; không dùng context root với Dockerfile này.
Build một lần và chọn cùng immutable image/digest cho `socratic-api` và Migration Job.

Kiểm tra local từ repository root:

```powershell
docker build --file backend/Dockerfile --tag socratic-backend:RELEASE_TAG backend
```

Không truyền runtime secrets lúc build. `.dockerignore` loại `.env`, DB/data local và test.
Image dùng UID/GID `10001:10001`, không có ENTRYPOINT cản command override. Dockerfile root
hiện là backend-only để Northflank không build frontend; frontend được deploy trên Vercel.
`Dockerfile.combined` chỉ dành cho trường hợp cần đóng gói frontend/backend chung.
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

Tắt auto-deploy `socratic-api` theo source change, hoặc cấu hình workflow chặn release:
build thành công → migration Job thành công → deploy combined cùng digest.
Không để workload mới tự deploy trước khi Job hoàn tất.

## 6. Deployment Service `socratic-api`

Liên kết nhóm chung + API/worker, dùng image đã migration thành công, expose HTTP port 8000,
bật HTTPS ingress, một replica. Đặt `RUN_MODE=combined`, giữ CMD mặc định mới:

```text
python -m backend.app.entrypoint
```

Nếu service đang override CMD bằng Uvicorn cũ, **xóa override** hoặc thay bằng:

```text
python -m backend.app.combined
```

Vẫn phải đặt `RUN_MODE=combined` khi override trực tiếp để CMD health probe chọn đúng mode.
Supervisor khởi chạy đúng một Uvicorn process (`--workers 1`) và một `python -m backend.app.worker`.
Log hai tiến trình đi thẳng stdout/stderr. Không có shell background hoặc migration lúc startup;
combined từ chối `AUTO_MIGRATE=true` và `BACKGROUND_JOBS=false`.
Biến PORT không đổi port cố định 8000. Gắn volume trước khi chạy.
Thiếu DB/JWT/origins/public origin/AI key hoặc cấu hình production không hợp lệ chặn startup.
`FORWARDED_ALLOW_IPS` chỉ bắt buộc khi chủ động bật `TRUST_PROXY_HEADERS=true`.
Luôn dùng dispatcher/combined để chọn đúng Uvicorn flags; command Uvicorn override cũ có thể
không áp dụng chính sách mới, cần xóa override đó khi cập nhật release.

API/worker thoát trước yêu cầu shutdown, kể cả exit 0: supervisor dừng process còn lại và exit 1
để nền tảng restart. SIGTERM/SIGINT chuyển tới cả hai; worker hoàn tất job đang chạy rồi thoát.
Khi quá deadline, supervisor kill process groups, thu hồi parser mồ côi và wait/reap children;
job bị gián đoạn vẫn phục hồi qua lease/attempt hiện có. Không cam kết hoàn tất khi bị SIGKILL/OOM.

## 7. Health check cho cả API và worker

Trên `socratic-api`, cấu hình startup, readiness và liveness bằng **CMD probe**:

```text
python -m backend.app.healthcheck
```

Khuyến nghị startup delay 10 giây, period 15 giây, timeout 40 giây, failure threshold 3;
startup cho phép ít nhất 90 giây trước khi kết luận thất bại. Nền tảng cần cấu hình probes rõ ràng,
không dựa vào việc tự nhập Docker HEALTHCHECK. Docker image cũng có cùng CMD probe.
Northflank hỗ trợ [CMD probes](https://northflank.com/docs/v1/application/observe/configure-health-checks).

Probe gọi `/api/ready`: DB/schema, storage I/O, cấu hình AI key (không gọi OpenAI),
supervisor/API/worker còn sống và worker `check_health()` với heartbeat dưới 60 giây.
Worker bị treo sẽ thành unhealthy khi heartbeat stale, dù HTTP API vẫn phục vụ được.
Supervisor xóa state readiness ngay khi drain. `/api/health` chỉ là API liveness cơ bản;
**không dùng riêng endpoint này để kết luận combined healthy**. Response contract của API giữ nguyên.
State/heartbeat ở `/tmp`, không lưu trên persistent volume, được làm mới mỗi lần combined khởi động.

Migration Job vẫn override command `python -m backend.app.migrate`, **tắt mọi health probe**,
không mount `socratic-files`; RUN_MODE không can thiệp command override.

Worker có lease 120 giây được gia hạn. Parser chạy subprocess, bị terminate khi hết deadline;
lỗi tạm thời retry tối đa ba attempts, file sai định dạng kết thúc thất bại.
Kill giữa job: worker sau restart nhận lại sau khi lease hết hạn. Lease token chặn kết quả cũ ghi đè.
Parser có thể thực thi lại; không cam kết exactly-once. SIGTERM ngừng nhận job mới sau job hiện tại.

## 8. ReadWriteOnce persistent volume

Dùng volume có sẵn **`socratic-files`, 6 GB, ReadWriteOnce**, gắn duy nhất vào `socratic-api`
tại `/app/storage` (mount point thật, không trỏ STORAGE_PATH tới subdirectory).
ReadWriteOnce phù hợp vì API và worker trong cùng container; không cần Multi Read/Write.
Không gắn volume này vào Worker Service hoặc Migration Job riêng.
Giữ một replica và chọn rollout **dừng container cũ trước khi tạo container mới**, tránh
hai revision cùng ghi volume hoặc hai worker chạy chồng. Chấp nhận downtime ngắn khi release;
không dùng rolling surge/blue-green với cấu hình volume này.
Northflank mô tả access mode tại [persistent volumes](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume).

Docker build chỉ tạo thư mục; persistent volume phải được gắn ở runtime. Mount có thể che quyền
thư mục trong image: cấu hình owner/group 10001:10001 bằng nền tảng. Production Linux yêu cầu
STORAGE_PATH là mount point; quên gắn volume sẽ chặn startup thay vì lưu vào container tạm. Không chạy app bằng root
hoặc chmod 777. Startup/readiness thực hiện probe I/O để phát hiện lỗi quyền/mount read-only.

Trên staging: upload TXT qua API, worker chuyển sang needs_review, restart container combined
và đọc lại tài liệu. Backup volume cùng kế hoạch backup DB. Chưa có tự dọn file mồ côi/retention;
cần giám sát dung lượng và chính sách vận hành trước khi sử dụng quy mô lớn.

## 9. Cookie, CORS và reverse proxy

Cookie host-only có HttpOnly, Secure, SameSite=Lax; access Path=/api, refresh Path=/api/auth.
Vercel rewrite phải giữ hai path, Cookie và Set-Cookie. Browser nhìn thấy origin frontend;
không đổi SameSite sang None hoặc đặt Cookie Domain Northflank.

Allowlist dùng origin frontend, ví dụ https://study.example.com, không phải URL backend,
không có path. Chỉ thêm preview origin cụ thể nếu có staging backend/DB riêng; không dùng wildcard.
X-CSRF-Token tiếp tục được kiểm tra. CORS không thay authentication hoặc CSRF.

### Staging khi chưa xác minh ingress

Đặt `TRUST_PROXY_HEADERS=false` (mặc định), không khai báo `FORWARDED_ALLOW_IPS`.
Dispatcher/combined truyền `--no-proxy-headers`, bỏ qua X-Forwarded-For/Proto; application
không tự đọc những header này. Một warning lúc API startup nhắc rằng client IP có thể là peer ingress.
Không điền IP/CIDR giả, không coi địa chỉ ingress là địa chỉ học sinh.

Đặt `PUBLIC_API_ORIGIN` bằng **một origin HTTPS frontend staging**, không có path/query.
Middleware dùng origin tĩnh này cho scheme/host của URL generation và redirect nếu route tạo redirect;
không lấy scheme hoặc host từ forwarded headers. Backend image riêng có thể slash-redirect về HTTPS
frontend; root image chứa SPA vẫn giữ hành vi catch-all cũ. Origin nội bộ có thể là HTTP,
nhưng browser vẫn HTTPS và cookie luôn Secure/HttpOnly/SameSite=Lax. Giữ AUTH_COOKIE_SECURE=true;
không thêm HTTPS redirect dựa trên scheme của kết nối nội bộ để tránh loop.
Khi đổi domain, cập nhật đồng thời PUBLIC_API_ORIGIN, AUTH_ALLOWED_ORIGINS và CORS_ORIGINS.
Đây là canonical origin cho mọi request, kể cả khi truy cập backend trực tiếp.

### Bật trust sau khi xác minh

Đặt `TRUST_PROXY_HEADERS=true` và `FORWARDED_ALLOW_IPS` bằng danh sách IP/CIDR proxy đã xác minh.
Validator chuẩn hóa CIDR có host bits thành canonical CIDR, truyền danh sách chuẩn qua
`--forwarded-allow-ips` của Uvicorn. Hostname, wildcard, CIDR `/0`, phần tử trống và scoped IPv6
bị từ chối; repo không tự đoán proxy IP. Chế độ này yêu cầu allowlist cả trong development/test.
PUBLIC_API_ORIGIN có thể tiếp tục giữ canonical URL, hoặc bỏ sau khi kiểm chứng forwarding đúng.
Xác minh TCP peer và toàn chuỗi hop Northflank/Vercel, cách append/overwrite header;
thử qua rewrite và trực tiếp backend với XFF giả. Chỉ tin ingress chưa chắc lấy được IP người dùng
nếu chuỗi vẫn có Vercel egress. Danh sách trust không phải ACL chặn truy cập backend.

### Authentication khi IP bị gộp

Các giới hạn trong PostgreSQL đều có window 15 phút và trả 429 + Retry-After:

| Thao tác | Theo peer IP (giữ nguyên) | Theo email | Toàn hệ thống |
| --- | --- | --- | --- |
| Login | 100 | 10 | AUTH_LOGIN_GLOBAL_LIMIT, mặc định 300 |
| Register | 20 | 3 | AUTH_REGISTER_GLOBAL_LIMIT, mặc định 60 |

Email được chuẩn hóa; các bucket dùng hash, không lưu email/IP thô trong bảng limiter.
Khi nhiều người chung ingress, **20 đăng ký hoặc 100 login/15 phút là giới hạn dùng chung cho peer**,
không phải mỗi học sinh. Giới hạn tổng thể còn chặn việc đổi ingress và email để phân tán request.
Attempts bao gồm thành công và thất bại, các request đã bị limiter chặn không thực hiện hash password.
Giữ quota AI/upload theo user ID, JWT/CSRF/origin checks; không tăng hoặc tắt limiter chỉ để che lỗi IP.
Staging chỉ phù hợp nhóm nhỏ; account lockout hoặc chung peer/global bucket có thể gây từ chối dịch vụ.
Không coi những giới hạn này là WAF/DDoS protection hay ngân sách AI toàn hệ thống.

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
- Kill API và kill worker riêng: container exit khác 0, restart có đúng một API/một worker.
- SIGTERM khi job đang chạy: worker hoàn tất trong grace; SIGINT dừng cả hai; không còn zombie.
- Bỏ mount hoặc mount read-only: combined startup thất bại. Heartbeat stale: ready 503/CMD exit 1.
- Cookie đúng Secure/HttpOnly/path: login → reload → access hết hạn → refresh → logout.
- CSRF/origin sai bị từ chối; hai tài khoản không đọc dữ liệu nhau; logout thu hồi token cũ.
- Không trust: thiếu allowlist vẫn startup, IP/scheme giả không được sử dụng; shared-peer/email/global quota trả 429.
- Trust: kiểm chứng IP/rate limit qua chuỗi proxy; header giả không vượt hạn mức.
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
5. Deploy một `socratic-api` combined sau Job exit 0, dừng revision cũ trước; chờ readiness/health.
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
| Worker unhealthy | CMD probe trên socratic-api, heartbeat, DB, mount và deadline |
| Upload đứng uploaded | Worker có chạy, cùng DB/volume, backlog và attempts |
| Login/refresh 403 | Origin allowlist, CSRF, prefix /api có giữ nguyên |
| Reload mất session | HTTPS, Set-Cookie, path, frontend có cùng origin |
| Nhiều người chung 429 | Khi không trust, bucket ingress là dùng chung; kiểm tra shared peer/email/global limits, không bỏ limiter |
| AI lỗi | Quota ứng dụng/provider, Retry-After, model access, giữ input để thử lại |
| Trang con 404 / API trả HTML | Root Directory Vercel, rewrite order và backend destination |

## 14. Kiểm thử local có thể lặp lại

Từ repository root, dùng Python environment đã cài `backend/requirements-dev.txt`:

```powershell
python -m pytest backend/tests -q
docker build -f backend/Dockerfile -t socratic-backend:combined-test backend
python scripts/test_combined_container.py
```

Script chỉ tạo PostgreSQL 16/container/network/volume tên `socratic-test-<random>-...`,
không đọc `.env`, không nhận DATABASE_URL ngoài, và dọn tài nguyên nó đã tạo khi kết thúc.
Nó chạy migration độc lập, storage âm tính, combined với memory limit 1 GiB, upload qua API,
heartbeat stale, kill từng child, restart, SIGTERM trong job, SIGINT và hai mode độc lập;
sau đó chạy suite backend với schema PostgreSQL tạm. Chỉ dùng credentials test và template tutor,
không gọi OpenAI tính phí. Docker named volume mô phỏng storage dùng chung, không chứng minh
CSI/ReadWriteOnce fencing hoặc rollout của Northflank. Không xem smoke test này là load test.
Suite có mô phỏng browser HTTPS → Vercel `/api` rewrite → HTTP origin để kiểm tra cookie,
CSRF, refresh/logout và redirect; đây không phải kiểm thử trên Vercel/Northflank thật.
Các bài supervisor dành cho POSIX được skip khi chạy pytest trực tiếp trên Windows;
cần chạy chúng trên Linux để kiểm chứng nhánh process group/subreaper.

## Tài liệu nền tảng

- [Northflank shared volumes](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)
- [Northflank health checks và CMD probe](https://northflank.com/docs/v1/application/observe/configure-health-checks)
- [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Vite SPA trên Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel external proxy timeout](https://vercel.com/docs/limits)
- [GPT-6.1 Sol và Structured Outputs](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
