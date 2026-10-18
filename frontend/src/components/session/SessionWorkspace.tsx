import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  BookOpen,
  CheckCircle2,
  Clock3,
  PanelRightClose,
  PanelRightOpen,
  X,
  ArrowLeft,
  Save,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { sessionLabel } from "@/lib/learning-state";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { type Session } from "@/lib/api";
import { LessonTabs } from "@/components/lessons/LessonTabs";
import { LearningPanel } from "./LearningPanel";

type Props = {
  session: Session;
  children: ReactNode;
  composer?: ReactNode;
  activity?: boolean;
  onSelectItem?: (itemId: string) => void;
  onSaveDraft?: () => Promise<boolean>;
  draftStatus?: ReactNode;
  navigationBusy?: boolean;
};

export function SessionWorkspace({
  session,
  children,
  composer,
  activity = false,
  onSelectItem,
  onSaveDraft,
  draftStatus,
  navigationBusy = false,
}: Props) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const siblings = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    enabled: (session.assignment.items?.length ?? 0) > 1,
  });
  const leave = async (saveFirst = true) => {
    if (leaving) return;
    setLeaving(true);
    try {
      if (saveFirst && onSaveDraft && !(await onSaveDraft())) return;
      if (saveFirst && !session.submitted)
        toast.success("Đã lưu bài học. Em có thể tiếp tục từ Bài học của tôi.");
      await navigate({ to: "/", search: {} });
    } finally {
      setLeaving(false);
    }
  };
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"assignment" | "journey">("assignment");
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [showJump, setShowJump] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const nearBottom = useRef(true);
  const previousSubmitted = useRef(false);
  const assignment = session.assignment;
  const taskType = session.plan?.task_type ?? assignment.task_type;

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => {
      setDesktop(media.matches);
      if (media.matches) setDrawerOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (session.submitted && !previousSubmitted.current) {
      const result = element.querySelector<HTMLElement>(
        '[aria-label="Báo cáo tư duy cuối phiên"], [data-session-complete]',
      );
      result?.scrollIntoView({ block: "start" });
    } else if (nearBottom.current || activity) {
      element.scrollTop = element.scrollHeight;
    }
    previousSubmitted.current = session.submitted;
  }, [
    session.turns.length,
    session.version,
    session.submitted,
    session.done,
    session.pending_action?.status,
    activity,
  ]);

  const jump = (index: number) => {
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      const turn = scroller.current?.querySelector<HTMLElement>(`#learning-turn-${index}`);
      turn?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
  };
  const viewAssignment = () => {
    setDrawerOpen(false);
    setSourceOpen(true);
  };
  const panel = (
    <LearningPanel
      session={session}
      onJump={jump}
      onViewAssignment={viewAssignment}
      tab={panelTab}
      onTabChange={setPanelTab}
    />
  );
  const status = session.submitted ? "Đã nộp" : session.done ? "Đang tổng hợp" : "Đang đối thoại";

  return (
    <div className="learning-workspace mx-auto flex h-0 min-h-0 min-w-0 flex-1 bg-background">
      <section
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Không gian học cùng Trợ lý ảo"
      >
        <header className="learning-session-header shrink-0 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
            <Button
              variant="ghost"
              className="h-10 px-1 text-xs sm:text-sm"
              disabled={leaving || navigationBusy}
              onClick={() => void leave(false)}
            >
              <ArrowLeft aria-hidden="true" /> Bài học của tôi
            </Button>
            {!session.submitted && (
              <Button
                variant="outline"
                className="h-10 text-xs sm:text-sm"
                disabled={leaving || navigationBusy}
                onClick={() => void leave()}
              >
                <Save aria-hidden="true" />
                {leaving ? "Đang lưu…" : "Lưu và học sau"}
              </Button>
            )}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-7" title={assignment.title}>
                {assignment.title}
              </h1>
              <div className="learning-session-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
                <span>
                  {taskType === "reading"
                    ? "Đọc hiểu"
                    : taskType === "social"
                      ? "Nghị luận xã hội"
                      : taskType === "literary"
                        ? "Nghị luận văn học"
                        : "Đề tự học"}
                  {assignment.grade ? ` · Lớp ${assignment.grade}` : ""}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {session.submitted ? (
                    <CheckCircle2 aria-hidden="true" className="size-3.5 text-primary" />
                  ) : (
                    <Clock3 aria-hidden="true" className="size-3.5" />
                  )}
                  {status}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-11 w-11 px-0 text-muted-foreground sm:w-auto sm:px-3"
                    aria-label="Xem đề bài"
                    title="Xem đề bài"
                  >
                    <BookOpen aria-hidden="true" />
                    <span className="hidden sm:inline">Xem đề bài</span>
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  closeLabel="Đóng đề bài"
                  className="learning-theme flex w-full flex-col gap-0 bg-card p-0 sm:max-w-xl"
                >
                  <div className="shrink-0 border-b px-5 py-5 pr-14">
                    <SheetTitle>Đề bài của em</SheetTitle>
                    <SheetDescription className="mt-1">
                      {taskType === "reading"
                        ? "Đọc hiểu"
                        : taskType === "social"
                          ? "Nghị luận xã hội"
                          : taskType === "literary"
                            ? "Nghị luận văn học"
                            : "Đề tự học"}
                      {assignment.grade ? ` · Lớp ${assignment.grade}` : ""}
                    </SheetDescription>
                  </div>
                  <div className="min-h-0 space-y-6 overflow-y-auto p-5">
                    <h2 className="break-words text-lg font-semibold leading-7">
                      {assignment.title}
                    </h2>
                    <section>
                      <h3 className="mb-2 text-sm font-semibold">Nội dung đề</h3>
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">
                        {assignment.prompt}
                      </p>
                    </section>
                    {assignment.source_text && (
                      <section className="border-t pt-5">
                        <h3 className="mb-2 text-sm font-semibold">Ngữ liệu / đoạn trích</h3>
                        <p className="whitespace-pre-wrap break-words text-sm leading-7">
                          {assignment.source_text}
                        </p>
                      </section>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
              <Button
                ref={infoButton}
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground"
                aria-expanded={desktop ? panelOpen : drawerOpen}
                aria-controls={desktop ? "learning-panel" : undefined}
                aria-label={
                  desktop && panelOpen ? "Đóng thông tin học tập" : "Mở thông tin học tập"
                }
                title={desktop && panelOpen ? "Đóng thông tin học tập" : "Mở thông tin học tập"}
                onClick={() => (desktop ? setPanelOpen((value) => !value) : setDrawerOpen(true))}
              >
                {desktop && panelOpen ? (
                  <PanelRightClose aria-hidden="true" />
                ) : (
                  <PanelRightOpen aria-hidden="true" />
                )}
              </Button>
            </div>
            {assignment.items && assignment.items.length > 1 && onSelectItem && (
              <label className="mt-3 block max-w-2xl text-xs font-medium text-muted-foreground">
                Câu đang học
                <select
                  className="mt-1 block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
                  value={assignment.active_item_id ?? assignment.items[0]?.id}
                  disabled={activity}
                  onChange={(event) => onSelectItem(event.target.value)}
                >
                  {assignment.items.map((item) => {
                    const saved = siblings.data?.find(
                      (entry) =>
                        entry.assignment_id === session.assignment_id &&
                        entry.assignment.active_item_id === item.id,
                    );
                    return (
                      <option key={item.id} value={item.id}>
                        {item.label} ·{" "}
                        {item.id === assignment.active_item_id
                          ? status
                          : saved
                            ? sessionLabel(saved)
                            : "Chưa bắt đầu"}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
          </div>
        </header>
        <div className="learning-lesson-tabs shrink-0 border-b bg-card px-4 pb-3 sm:px-6">
          <LessonTabs
            assignment={assignment}
            sessions={[
              session,
              ...(siblings.data?.filter((entry) => entry.id !== session.id) ?? []),
            ]}
            selected="study"
          />
        </div>
        <div
          className="relative flex h-0 min-h-0 flex-1 flex-col"
          onWheel={(event) => {
            const element = scroller.current;
            if (!element || event.deltaY === 0 || element.scrollHeight <= element.clientHeight)
              return;
            const atTop = element.scrollTop <= 0;
            const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
            if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) return;
            event.preventDefault();
            element.scrollTop += event.deltaY;
          }}
        >
          <div
            ref={scroller}
            className="learning-history h-0 min-h-0 flex-1 overflow-y-scroll overscroll-contain"
            role="region"
            aria-label="Lịch sử hội thoại"
            tabIndex={0}
            onScroll={(event) => {
              const element = event.currentTarget;
              const away = element.scrollHeight - element.scrollTop - element.clientHeight > 120;
              nearBottom.current = !away;
              setShowJump(away);
            }}
          >
            <div className="learning-conversation-content mx-auto w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8">
              <p className="text-xs font-medium text-muted-foreground">
                Học cùng Trợ lý ảo{session.tutor_mode !== "openai" ? " · Phiên kịch bản" : ""}
              </p>
              {children}
            </div>
          </div>
          {showJump && (
            <Button
              variant="outline"
              className="absolute bottom-3 right-4 h-10 gap-1.5 bg-card text-xs shadow-sm"
              onClick={() => {
                const element = scroller.current;
                if (element) element.scrollTop = element.scrollHeight;
              }}
            >
              <ArrowDown aria-hidden="true" /> Cuối hội thoại
            </Button>
          )}
        </div>
        {composer}
        {draftStatus && !session.submitted && (
          <div className="shrink-0 border-t bg-card px-4 py-1 text-xs text-muted-foreground">
            {draftStatus}
          </div>
        )}
        {session.submitted && (
          <footer className="learning-composer shrink-0 border-t bg-card px-4 pt-3 sm:px-6">
            <div className="learning-chat-content mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 aria-hidden="true" className="size-4" /> Phiên học đã được lưu
              </span>
              <Button asChild variant="link" className="h-10 px-0">
                <Link to="/" search={{ lesson: session.assignment_id, view: "results" }}>
                  Xem kết quả bài học
                </Link>
              </Button>
            </div>
          </footer>
        )}
      </section>
      {desktop && panelOpen && (
        <aside
          id="learning-panel"
          aria-label="Thông tin học tập"
          className="learning-panel flex min-h-0 shrink-0 flex-col border-x bg-card"
        >
          <div className="flex h-[89px] shrink-0 items-center justify-between gap-2 border-b px-5">
            <h2 className="text-sm font-semibold">Thông tin học tập</h2>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Thu gọn panel học tập"
              onClick={() => {
                setPanelOpen(false);
                infoButton.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
        </aside>
      )}
      <Sheet open={drawerOpen && !desktop} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          closeLabel="Đóng thông tin học tập"
          className="learning-theme flex w-full max-w-[400px] flex-col gap-0 bg-card p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            infoButton.current?.focus();
          }}
        >
          <div className="shrink-0 border-b px-5 py-5 pr-14">
            <SheetTitle>Thông tin học tập</SheetTitle>
            <SheetDescription className="mt-1">
              Đề bài, hành trình suy nghĩ và những điều em đã khám phá.
            </SheetDescription>
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
