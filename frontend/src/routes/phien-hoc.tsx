import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { AdaptiveSessionView } from "@/components/AdaptiveSessionView";
import { TemplateSessionView } from "@/components/session/TemplateSessionView";

export const Route = createFileRoute("/phien-hoc")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { assignment?: string; session?: string; item?: string } => ({
    ...(typeof search["assignment"] === "string" ? { assignment: search["assignment"] } : {}),
    ...(typeof search["session"] === "string" ? { session: search["session"] } : {}),
    ...(typeof search["item"] === "string" ? { item: search["item"] } : {}),
  }),
  head: () =>
    seo(
      "Học cùng Trợ lý ảo",
      "Chọn phiên học và rèn luyện tư duy cùng Trợ lý ảo bằng câu hỏi gợi mở.",
    ),
  component: Session,
});

function Session() {
  const { assignment, session, item } = Route.useSearch();
  return assignment || session ? (
    <SelectedSession assignment={assignment} session={session} item={item} />
  ) : (
    <Navigate to="/" search={{}} replace />
  );
}

function SelectedSession({
  assignment,
  session,
  item,
}: {
  assignment: string | undefined;
  session: string | undefined;
  item: string | undefined;
}) {
  const navigate = useNavigate();
  const queryKey = ["session", session ?? assignment ?? "latest", item ?? ""];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (session) return api.prepareSession(session);
      if (assignment) {
        const started = await api.start(assignment, item);
        return api.prepareSession(started.id);
      }
      return null;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pending_action?.status === "processing" ? 2000 : false,
  });
  useEffect(() => {
    if (assignment && query.data)
      void navigate({ to: "/phien-hoc", search: { session: query.data.id }, replace: true });
  }, [assignment, query.data, navigate]);
  if (query.isPending || query.isError)
    return (
      <div className="overflow-y-auto">
        <Button asChild variant="link">
          <Link to="/" search={{}}>
            Về bài học của tôi
          </Link>
        </Button>
        <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />
      </div>
    );
  if (!query.data)
    return (
      <div className="p-6 lg:p-10 space-y-4">
        <h1 className="text-2xl font-semibold">Bắt đầu phiên tự học đầu tiên</h1>
        <p className="text-muted-foreground">Tải lên hoặc nhập đề riêng để học cùng Trợ lý ảo.</p>
        <Button asChild>
          <Link to="/de-bai">Thêm đề tự học</Link>
        </Button>
      </div>
    );
  return query.data.tutor_mode === "openai" ? (
    <AdaptiveSessionView key={query.data.id} session={query.data} queryKey={queryKey} />
  ) : (
    <TemplateSessionView key={query.data.id} session={query.data} queryKey={queryKey} />
  );
}
