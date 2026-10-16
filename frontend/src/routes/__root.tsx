import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  HeadContent,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";

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
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster />
    </QueryClientProvider>
  );
}
