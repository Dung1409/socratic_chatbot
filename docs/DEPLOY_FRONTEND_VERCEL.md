# Deploy frontend lên Vercel

Workflow [frontend-vercel.yml](../.github/workflows/frontend-vercel.yml) chạy lint, unit test và build khi PR hoặc push lên `main` thay đổi `frontend/`. Vercel Git integration hiện đã kết nối với repo và tự deploy commit lên Vercel. Vì vậy bước deploy bằng Vercel CLI trong workflow chỉ chạy khi bật biến repository `VERCEL_CLI_DEPLOY=true`.

## Thiết lập một lần

1. Tạo Vercel project cho repo, đặt **Root Directory** là `frontend`, framework **Vite**, Build Command `npm run build`, Output Directory `dist`. Giữ Git integration bật để Vercel tự deploy sau mỗi commit.
2. Thay `https://YOUR-BACKEND-DOMAIN.invalid` trong [frontend/vercel.json](../frontend/vercel.json) bằng origin HTTPS thật của backend cho Production. File này proxy `/api` cùng origin để cookie đăng nhập hoạt động. Giữ `VITE_API_URL` trống. Với Preview, cần backend staging riêng trước khi phát hành Preview; không trỏ Preview vào dữ liệu Production. Xem [hướng dẫn Northflank/Vercel](DEPLOY_NORTHFLANK_VERCEL.md) để cấu hình backend, origin và kiểm tra staging.
3. Nếu muốn dùng GitHub Actions để deploy thay Git integration, tạo [Vercel access token](https://vercel.com/account/tokens). Tại thư mục gốc repo, chạy `vercel link` để liên kết project, rồi lấy `orgId` và `projectId` trong `.vercel/project.json`. File này chỉ lưu trên máy, không commit.
4. Trong **GitHub → Settings → Secrets and variables → Actions**, thêm ba repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID` và `VERCEL_PROJECT_ID`, rồi thêm repository variable `VERCEL_CLI_DEPLOY=true`. Sau đó tắt Git auto-deploy của Vercel để tránh deploy hai lần cho một commit.

Chế độ CLI từ chối deploy khi `frontend/vercel.json` vẫn chứa backend placeholder. Sau khi thêm secrets và địa chỉ backend thật, chạy workflow từ tab **Actions** trên `main` hoặc push thay đổi frontend lên `main`. Deployment URL xuất hiện trong log bước deploy.

`frontend/vercel.json` đặt API rewrite trước SPA fallback; các URL trang con tải trực tiếp hoặc refresh sẽ không bị 404.
