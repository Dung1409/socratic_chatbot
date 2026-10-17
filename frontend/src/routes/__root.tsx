import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  HeadContent,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: () => (
    <div className="p-10 text-center">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang</h1>
      <Link to="/" className="text-primary">
        Về tổng quan
      </Link>
    </div>
  ),
  errorComponent: ({ error, reset }: ErrorComponentProps) => (
    <div role="alert" className="p-10">
      <p>{error instanceof Error ? error.message : "Không tải được trang"}</p>
      <button className="text-primary mt-3" onClick={reset}>
        Thử lại
      </button>
    </div>
  ),
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <AuthProvider>
        <AccessGate />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AccessGate() {
  const auth = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const publicPage = path === "/dang-nhap" || path === "/dang-ky";
  if (auth.pending)
    return (
      <div role="status" className="min-h-screen grid place-items-center text-muted-foreground">
        Đang kiểm tra phiên đăng nhập…
      </div>
    );
  if (auth.error)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{auth.error}</p>
        <Button onClick={auth.retry}>Thử lại</Button>
      </div>
    );
  if (!auth.user) return publicPage ? <Outlet /> : <Navigate to="/dang-nhap" replace />;
  if (publicPage) return <Navigate to="/" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
