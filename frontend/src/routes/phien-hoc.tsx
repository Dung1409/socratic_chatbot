import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiState } from "@/components/ApiState";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { AdaptiveSessionView } from "@/components/AdaptiveSessionView";
import { TemplateSessionView } from "@/components/session/TemplateSessionView";

export const Route = createFileRoute("/phien-hoc")({
  validateSearch: (search: Record<string, unknown>): { assignment?: string; session?: string; item?: string } => ({
    ...(typeof search["assignment"] === "string" ? { assignment: search["assignment"] } : {}),
    ...(typeof search["session"] === "string" ? { session: search["session"] } : {}),
    ...(typeof search["item"] === "string" ? { item: search["item"] } : {}),
  }),
  head: () =>
    seo(
      "Học cùng AI",
      "Trao đổi với trợ lý AI bằng chuỗi câu hỏi gợi mở theo thang Bloom và gợi ý tăng dần.",
    ),
  component: Session,
});

function Session() {
  const { assignment, session, item } = Route.useSearch();
  const queryKey = ["session", session ?? assignment ?? "latest", item ?? ""];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (session) return api.prepareSession(session);
      if (assignment) {
        const started = await api.start(assignment);
        const selected = item && started.assignment.items?.some((entry) => entry.id === item)
          && started.assignment.active_item_id !== item
          ? await api.selectSessionItem(started.id, item)
          : started;
        return api.prepareSession(selected.id);
      }
      const sessions = await api.sessions();
      const latest = sessions.find((s) => !s.submitted) ?? sessions[0] ?? null;
      return latest ? api.prepareSession(latest.id) : null;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pending_action?.status === "processing" ? 2000 : false,
  });
  if (query.isPending || query.isError)
    return <ApiState loading={query.isPending} error={query.error} retry={query.refetch} />;
  if (!query.data)
    return (
      <div className="p-6 lg:p-10 space-y-4">
        <h1 className="text-2xl font-semibold">Bắt đầu phiên tự học đầu tiên</h1>
        <p className="text-muted-foreground">
          Tải lên hoặc nhập đề riêng để học cùng trợ lý AI.
        </p>
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
