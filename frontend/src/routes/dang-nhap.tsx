import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";
import { seo } from "@/lib/seo";
import { safeReturnTo } from "@/lib/auth-redirect";

export const Route = createFileRoute("/dang-nhap")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeReturnTo(search["redirect"]),
  }),
  head: () => seo("Đăng nhập", "Đăng nhập để tiếp tục không gian tự học của bạn."),
  component: () => <AuthForm />,
});
