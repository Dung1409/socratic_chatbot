import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/dang-nhap")({
  head: () => seo("Đăng nhập", "Đăng nhập để tiếp tục không gian tự học của bạn."),
  component: () => <AuthForm />,
});
