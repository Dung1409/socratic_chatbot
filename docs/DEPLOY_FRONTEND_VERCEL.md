# Deploy frontend lên Vercel bằng GitHub Actions

Workflow [frontend-vercel.yml](../.github/workflows/frontend-vercel.yml) chạy lint, unit test và build khi có PR hoặc push lên `main` thay đổi `frontend/`. PR từ cùng repo được deploy Preview; push lên `main` được deploy Production. PR từ fork chỉ chạy CI vì GitHub không cấp secrets cho workflow đó.

## Thiết lập một lần

1. Tạo Vercel project cho repo này. Trong **Settings → Build and Deployment**, đặt **Root Directory** là `frontend`. Chọn framework **Vite**, Build Command `npm run build`, Output Directory `dist`. Tắt tự động deploy qua Git integration nếu đã bật để tránh tạo hai deployment cho cùng commit.
2. Tạo [Vercel access token](https://vercel.com/account/tokens). Tại thư mục gốc repo, chạy `vercel link` để liên kết project, rồi lấy `orgId` và `projectId` trong `.vercel/project.json`. File này chỉ lưu trên máy, không commit.
3. Trong **GitHub → Settings → Secrets and variables → Actions**, thêm ba **repository secrets**: `VERCEL_TOKEN` (access token), `VERCEL_ORG_ID` (`orgId`) và `VERCEL_PROJECT_ID` (`projectId`).
4. Trong **Vercel → Project Settings → Environment Variables**, đặt `VITE_API_URL` cho Production và Preview thành origin HTTPS của backend, ví dụ `https://api.example.com` (không thêm `/api` ở cuối). Frontend sẽ gọi `${VITE_API_URL}/api/...`. Backend phải được deploy riêng; Vercel project này chỉ chứa frontend.
5. Với frontend và backend ở khác origin, cấu hình backend `AUTH_ALLOWED_ORIGINS` và `CORS_ORIGINS` chứa URL frontend, `AUTH_COOKIE_SECURE=true`. Cookie hiện dùng `SameSite=Lax`, nên đăng nhập cần frontend và backend cùng site, ví dụ `app.example.com` và `api.example.com`. URL Preview mặc định `*.vercel.app` ở khác site với backend tùy chỉnh sẽ không duy trì phiên đăng nhập; dùng một domain Preview cùng site nếu cần kiểm thử đăng nhập trên Preview.

Sau khi thêm secrets và biến môi trường, chạy workflow thủ công từ tab **Actions** hoặc push thay đổi frontend lên `main`. Deployment URL xuất hiện trong log bước `Deploy production` hoặc `Deploy preview`. Nếu project Vercel vẫn tự deploy từ Git, một commit có thể tạo thêm deployment ngoài workflow này.

`frontend/vercel.json` chuyển các URL của client router về `index.html`, để tải trực tiếp hoặc refresh các trang con không bị 404.
