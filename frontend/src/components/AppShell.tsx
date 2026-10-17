import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  BookOpen,
  LayoutDashboard,
  MessagesSquare,
  LineChart,
  Menu,
  X,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const studentNav = [
  { to: "/", label: "Tổng quan", icon: LayoutDashboard },
  { to: "/de-bai", label: "Đề bài của tôi", icon: BookOpen },
  { to: "/phien-hoc", label: "Phiên học Socratic", icon: MessagesSquare },
  { to: "/tien-trinh", label: "Tiến trình tự học", icon: LineChart },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const NavGroup = ({
    title,
    items,
  }: {
    title: string;
    items: readonly { to: string; label: string; icon: typeof BookOpen }[];
  }) => (
    <div className="mb-6">
      <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.map((i) => {
        const active = i.to === "/" ? path === "/" : path === i.to;
        return (
          <Link
            key={i.to}
            to={i.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-foreground/75 hover:bg-muted",
            )}
          >
            <i.icon className="h-4 w-4" />
            {i.label}
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r bg-sidebar flex flex-col transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="h-16 flex items-center gap-2.5 px-5 border-b">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center">
            <GraduationCap className="h-4.5 w-4.5" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold text-sm">
              Socra<span className="text-primary">Văn</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Gia sư AI · Socratic × Bloom</p>
          </div>
          <button
            className="ml-auto lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Đóng menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 pt-5">
          <NavGroup title="Không gian tự học" items={studentNav} />
        </nav>
        <div className="border-t p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full grid place-items-center text-xs font-semibold bg-primary-soft text-primary">
            HS
          </div>
          <div className="text-sm leading-tight">
            <p className="font-medium">Không gian của bạn</p>
            <p className="text-xs text-muted-foreground">Tự học Ngữ văn</p>
          </div>
        </div>
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="lg:pl-64">
        <header className="lg:hidden h-14 border-b bg-card flex items-center px-4 gap-3 sticky top-0 z-20">
          <button onClick={() => setOpen(true)} aria-label="Mở menu">
            <Menu className="h-5 w-5" />
          </button>
          <p className="font-semibold text-sm">
            Socra<span className="text-primary">Văn</span>
          </p>
        </header>
        <main>{children}</main>
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
