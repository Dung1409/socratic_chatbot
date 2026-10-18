import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  LineChart,
  Menu,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Plus,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/brand";

const studentNav = [
  { to: "/", label: "Bài học của tôi", icon: BookOpen },
  { to: "/tien-trinh", label: "Thống kê học tập", icon: LineChart },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({
    select: (s) => s.location.search as { session?: string; assignment?: string },
  });
  const activePath = path === "/tien-trinh" ? "/tien-trinh" : "/";
  const learning = path === "/phien-hoc" && Boolean(search.session || search.assignment);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("learning:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleNavigation = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem("learning:sidebar-collapsed", String(!value));
      } catch {
        /* Layout remains usable. */
      }
      return !value;
    });
  const [signingOut, setSigningOut] = useState(false);
  const app = useRef<HTMLDivElement>(null);
  const auth = useAuth();

  // Match the visible viewport when a phone's software keyboard opens. This is
  // layout-only and does not remount the session or change its cached data.
  useEffect(() => {
    if (!learning || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 767px)");
    const element = app.current;
    const update = () => {
      if (!mobile.matches) {
        element?.style.removeProperty("--learning-viewport-height");
        if (element) delete element.dataset["compactHeight"];
        return;
      }
      element?.style.setProperty("--learning-viewport-height", `${viewport.height}px`);
      if (element) element.dataset["compactHeight"] = String(viewport.height < 520);
    };
    update();
    viewport.addEventListener("resize", update);
    mobile.addEventListener("change", update);
    return () => {
      viewport.removeEventListener("resize", update);
      mobile.removeEventListener("change", update);
      element?.style.removeProperty("--learning-viewport-height");
      if (element) delete element.dataset["compactHeight"];
    };
  }, [learning]);

  const logout = () => {
    setSigningOut(true);
    void auth
      .logout()
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Chưa đăng xuất được. Vui lòng thử lại.",
        );
      })
      .finally(() => setSigningOut(false));
  };

  const sidebar = (drawer = false) => {
    const compact = !drawer;
    const label = compact && collapsed ? "sr-only" : "";
    return (
      <>
        <div
          className={cn(
            "flex h-24 shrink-0 items-center gap-2.5 border-b px-5",
            compact && "h-[89px] justify-center px-4",
            compact && !collapsed && "justify-start px-5",
          )}
        >
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap aria-hidden="true" className="size-[18px]" />
          </div>
          <div className={cn("min-w-0 leading-tight", label)}>
            <p className="text-sm font-semibold">{APP_NAME}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Phát triển năng lực tư duy
            </p>
          </div>
        </div>
        <div className={cn("shrink-0 px-3 pt-4", compact && collapsed && "px-2")}>
          <Button asChild className="min-h-11 w-full px-2 shadow-none">
            <Link
              to="/de-bai"
              search={{ tab: "quick" }}
              aria-label="Thêm bài học"
              onClick={() => setOpen(false)}
            >
              <Plus aria-hidden="true" />
              <span className={label}>Thêm bài học</span>
            </Link>
          </Button>
        </div>
        <nav
          aria-label="Điều hướng chính"
          className={cn(
            "min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pt-6",
            compact && "px-2",
            compact && !collapsed && "px-3",
          )}
        >
          <p
            className={cn(
              "mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
              label,
            )}
          >
            Không gian tự học
          </p>
          <TooltipProvider delayDuration={300}>
            {studentNav.map((item) => (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.to}
                    aria-label={item.label}
                    aria-current={activePath === item.to ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                      activePath === item.to
                        ? "bg-primary-soft font-semibold text-primary"
                        : "text-foreground/75 hover:bg-muted",
                      compact && "justify-center px-0",
                      compact && !collapsed && "justify-start px-3",
                    )}
                  >
                    <item.icon
                      aria-hidden="true"
                      className="size-[18px] shrink-0"
                      strokeWidth={1.75}
                    />
                    <span className={label}>{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-foreground text-white">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </nav>
        <div
          className={cn(
            "space-y-3 border-t p-4",
            compact && "px-2",
            compact && !collapsed && "px-4",
          )}
        >
          {compact && (
            <Button
              variant="ghost"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
              title={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
              className={cn(
                "flex h-11 w-full text-muted-foreground",
                !collapsed && "justify-start px-2",
              )}
              onClick={toggleNavigation}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
              <span className={label}>Thu gọn điều hướng</span>
            </Button>
          )}
          <div
            className={cn(
              "flex items-center gap-3",
              compact && "justify-center",
              compact && !collapsed && "justify-start",
            )}
          >
            <div
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
              title={auth.user?.display_name}
            >
              {auth.user?.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div className={cn("min-w-0 text-sm leading-tight", label)}>
              <p className="truncate font-medium">{auth.user?.display_name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{auth.user?.email}</p>
            </div>
          </div>
          <Button
            className="h-10 w-full bg-card px-2 shadow-none"
            size="sm"
            variant={compact ? "ghost" : "outline"}
            disabled={signingOut}
            aria-label={signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
            title="Đăng xuất"
            onClick={logout}
          >
            <LogOut aria-hidden="true" />
            <span className={label}>{signingOut ? "Đang đăng xuất…" : "Đăng xuất"}</span>
          </Button>
        </div>
      </>
    );
  };

  return (
    <div
      ref={app}
      className={cn(
        "learning-theme min-h-[100dvh] bg-background",
        learning && "learning-app h-[100dvh] min-h-0 overflow-hidden",
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3 focus:text-primary"
      >
        Đến nội dung chính
      </a>
      <aside
        aria-label="Thanh điều hướng"
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r bg-sidebar",
          "md:flex",
          collapsed ? "w-16" : "w-[248px]",
        )}
      >
        {sidebar()}
      </aside>
      <div
        className={cn(
          learning && "flex h-full min-h-0 flex-col",
          collapsed ? "md:pl-16" : "md:pl-[248px]",
        )}
      >
        <header
          className={cn(
            "learning-mobile-header sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4",
            "md:hidden",
          )}
        >
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="size-11" aria-label="Mở menu">
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className={cn(
                "flex w-72 max-w-[calc(100%-32px)] flex-col gap-0 bg-sidebar p-0 motion-reduce:animate-none motion-reduce:transition-none",
                learning && "learning-theme",
              )}
            >
              <SheetTitle className="sr-only">Menu {APP_NAME}</SheetTitle>
              <SheetDescription className="sr-only">Điều hướng không gian tự học</SheetDescription>
              {sidebar(true)}
            </SheetContent>
          </Sheet>
          <p className="text-sm font-semibold">{APP_NAME}</p>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={learning ? "flex min-h-0 flex-1 flex-col overflow-hidden" : undefined}
        >
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
