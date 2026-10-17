import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  BookOpen,
  LayoutDashboard,
  MessagesSquare,
  LineChart,
  Menu,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";

const studentNav = [
  { to: "/", label: "Tổng quan", icon: LayoutDashboard },
  { to: "/de-bai", label: "Đề bài của tôi", icon: BookOpen },
  { to: "/phien-hoc", label: "Phiên học Socratic", icon: MessagesSquare },
  { to: "/tien-trinh", label: "Tiến trình tự học", icon: LineChart },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const auth = useAuth();

  const NavGroup = ({
    title,
    items,
  }: {
    title: string;
    items: readonly { to: string; label: string; icon: typeof BookOpen }[];
  }) => (
    <div className="mb-6 space-y-2">
      <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.map((i) => {
        const active = i.to === "/" ? path === "/" : path === i.to;
        return (
          <Link
            key={i.to}
            to={i.to}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              active
                ? "bg-primary-soft text-primary font-semibold"
                : "text-foreground/75 hover:bg-muted",
            )}
          >
            <i.icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
            {i.label}
          </Link>
        );
      })}
    </div>
  );

  const sidebar = (
    <>
      <div className="h-24 shrink-0 flex items-center gap-2.5 px-5 border-b">
        <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center">
          <GraduationCap className="h-4.5 w-4.5" />
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-sm">
            Socra<span className="text-primary">Văn</span>
          </p>
          <p className="text-[11px] text-muted-foreground">Gia sư AI · Socratic × Bloom</p>
        </div>
      </div>
      <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto p-4 pt-6">
        <NavGroup title="Không gian tự học" items={studentNav} />
      </nav>
      <div className="border-t p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full grid place-items-center text-xs font-semibold bg-primary-soft text-primary">
            {auth.user?.display_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="text-sm leading-tight min-w-0">
            <p className="font-medium truncate">{auth.user?.display_name}</p>
            <p className="text-xs text-muted-foreground truncate">{auth.user?.email}</p>
          </div>
        </div>
        <Button
          className="h-10 w-full bg-card shadow-none"
          size="sm"
          variant="outline"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void auth
              .logout()
              .catch((error: unknown) => {
                toast.error(
                  error instanceof Error ? error.message : "Chưa đăng xuất được. Vui lòng thử lại.",
                );
              })
              .finally(() => setSigningOut(false));
          }}
        >
          {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3 focus:text-primary"
      >
        Đến nội dung chính
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        {sidebar}
      </aside>
      <div className="lg:pl-64">
        <header className="lg:hidden h-14 border-b bg-card flex items-center px-4 gap-3 sticky top-0 z-20">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="size-11" aria-label="Mở menu">
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-72 max-w-[calc(100%-32px)] flex-col gap-0 bg-sidebar p-0 motion-reduce:animate-none motion-reduce:transition-none"
            >
              <SheetTitle className="sr-only">Menu SocraVăn</SheetTitle>
              <SheetDescription className="sr-only">Điều hướng không gian tự học</SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
          <p className="font-semibold text-sm">
            Socra<span className="text-primary">Văn</span>
          </p>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  desc,
  action,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between px-6 lg:px-10 pt-8 pb-6 border-b bg-card">
      <div>
        {eyebrow && (
          <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {desc && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function BloomBadge({ level }: { level: number }) {
  const names = ["Nhớ", "Hiểu", "Vận dụng", "Phân tích", "Đánh giá", "Sáng tạo"];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ["bg-bloom-1", "bg-bloom-2", "bg-bloom-3", "bg-bloom-4", "bg-bloom-5", "bg-bloom-6"][
            level - 1
          ],
        )}
      />
      Bloom {level} · {names[level - 1]}
    </span>
  );
}
