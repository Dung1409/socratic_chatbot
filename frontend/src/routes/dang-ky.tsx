import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/dang-ky")({
  head: () => seo("Đăng ký", "Tạo tài khoản tự học Ngữ văn với đề bài riêng của bạn."),
  component: () => <AuthForm register />,
});
