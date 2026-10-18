import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";
import { seo } from "@/lib/seo";
import { safeReturnTo } from "@/lib/auth-redirect";

export const Route = createFileRoute("/dang-ky")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeReturnTo(search["redirect"]),
  }),
  head: () => seo("Đăng ký", "Tạo tài khoản tự học Ngữ văn với đề bài riêng của bạn."),
  component: () => <AuthForm register />,
});
