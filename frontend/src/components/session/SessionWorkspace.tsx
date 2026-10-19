import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  CheckCircle2,
  Clock3,
  PanelRightClose,
  PanelRightOpen,
  ArrowLeft,
  Save,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssessmentReport } from "@/components/AssessmentReport";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { type Session } from "@/lib/api";
import { readableLessonTitle } from "@/lib/lessons";
import { AssignmentQuestionImages } from "./AssignmentQuestionImages";
import { LearningPanel } from "./LearningPanel";

type Props = {
  session: Session;
  children: ReactNode;
  composer?: ReactNode;
  activity?: boolean;
  onSelectItem?: (itemId: string) => void;
  onSaveDraft?: () => Promise<boolean>;
  navigationBusy?: boolean;
  assessmentOpen?: boolean;
  onAssessmentOpenChange?: (open: boolean) => void;
};

export function SessionWorkspace({
  session,
  children,
  composer,
  activity = false,
  onSelectItem,
  onSaveDraft,
  navigationBusy = false,
  assessmentOpen,
  onAssessmentOpenChange,
}: Props) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const showAssessment = assessmentOpen ?? resultOpen;
  const setShowAssessment = onAssessmentOpenChange ?? setResultOpen;
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
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const [showJump, setShowJump] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const nearBottom = useRef(true);
  const previousSubmitted = useRef(false);
  const assignment = session.assignment;
  const taskType = session.plan?.task_type ?? assignment.task_type;
  const activeItem = assignment.items?.find((item) => item.id === assignment.active_item_id);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const update = () => {
      setDesktop(media.matches);
      if (media.matches) setDrawerOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (desktop && !panelOpen) infoButton.current?.focus();
  }, [desktop, panelOpen]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (session.submitted && !previousSubmitted.current) {
      const report = element.querySelector<HTMLElement>('[aria-label="Báo cáo tư duy cuối phiên"]');
      if (report) report.scrollIntoView({ block: "start" });
      else if (nearBottom.current || activity) element.scrollTop = element.scrollHeight;
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
      sessions={[session, ...(siblings.data?.filter((entry) => entry.id !== session.id) ?? [])]}
      onJump={jump}
      onViewAssignment={viewAssignment}
      {...(onSelectItem ? { onSelectItem } : {})}
      navigationBusy={navigationBusy || activity}
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
        <header
          className={`learning-session-header relative grid min-h-28 shrink-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-center gap-x-2 gap-y-1 border-b bg-card px-6 py-2 lg:px-10 ${desktop && !panelOpen ? "sm:pr-16" : ""}`}
        >
          <Button
            variant="ghost"
            className="h-8 shrink-0 justify-self-start px-1 text-xs"
            disabled={leaving || navigationBusy}
            aria-label="Về bài học của tôi"
            onClick={() => void leave(false)}
          >
            <ArrowLeft aria-hidden="true" />
            <span className="hidden sm:inline">Bài học của tôi</span>
          </Button>
          <div className="col-span-2 row-start-2 min-w-0 self-center">
            <h1
              className="truncate text-xl font-semibold leading-7 tracking-tight"
              title={assignment.title}
            >
              {readableLessonTitle(assignment.title)}
            </h1>
            <div className="learning-session-meta mt-1 flex flex-wrap items-center gap-x-2 text-xs leading-4 text-muted-foreground">
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
          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1">
            {!desktop && (
              <Button
                ref={infoButton}
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-expanded={drawerOpen}
                aria-label="Mở thông tin học tập"
                title="Mở thông tin học tập"
                onClick={() => setDrawerOpen(true)}
              >
                <PanelRightOpen aria-hidden="true" />
              </Button>
            )}
            {!session.submitted && (
              <Button
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={leaving || navigationBusy}
                title={leaving ? "Đang lưu…" : "Lưu và học sau"}
                onClick={() => void leave()}
              >
                <Save aria-hidden="true" />
                <span className="hidden md:inline">{leaving ? "Đang lưu…" : "Lưu"}</span>
              </Button>
            )}
          </div>
          {desktop && !panelOpen && (
            <Button
              ref={infoButton}
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 z-10 size-11 -translate-y-1/2 rounded-r-none border border-r-0 bg-card text-muted-foreground shadow-none"
              aria-expanded={false}
              aria-controls="learning-panel"
              aria-label="Mở thông tin học tập"
              title="Mở thông tin học tập"
              onClick={() => setPanelOpen(true)}
            >
              <PanelRightOpen aria-hidden="true" />
            </Button>
          )}
        </header>
        <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
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
                {readableLessonTitle(assignment.title)}
              </h2>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Nội dung đề</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {assignment.prompt.trim() === "Read the question directly in the attached image."
                    ? "Nội dung câu hỏi nằm trong ảnh bên dưới."
                    : assignment.prompt}
                </p>
                <AssignmentQuestionImages
                  documentId={assignment.document_id}
                  visualIds={assignment.visual_refs ?? []}
                />
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
        {session.submitted && (
          <footer className="learning-composer shrink-0 border-t bg-card px-4 pt-3 sm:px-6">
            <div className="learning-chat-content mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 aria-hidden="true" className="size-4" /> Phiên học đã được lưu
              </span>
              {session.assessment && (
                <Button
                  variant="link"
                  className="h-10 px-0"
                  onClick={() => setShowAssessment(true)}
                >
                  Xem phiếu đánh giá
                </Button>
              )}
            </div>
          </footer>
        )}
        <Dialog open={showAssessment} onOpenChange={setShowAssessment}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Kết quả {activeItem?.label ?? "câu này"}</DialogTitle>
              <DialogDescription>Phiếu đánh giá của câu trong phiên chat này.</DialogDescription>
            </DialogHeader>
            {session.assessment && <AssessmentReport report={session.assessment} />}
            <DialogFooter>
              <Button onClick={() => setShowAssessment(false)}>Đóng phiếu đánh giá</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
      {desktop && panelOpen && (
        <aside
          id="learning-panel"
          aria-label="Thông tin học tập"
          className="learning-panel flex min-h-0 shrink-0 flex-col border-x bg-card"
        >
          <div className="relative flex h-28 shrink-0 items-center border-b px-5">
            <h2 className="text-lg font-semibold">Thông tin học tập</h2>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-r-none border border-r-0 bg-card text-muted-foreground shadow-none"
              aria-label="Thu gọn panel học tập"
              title="Thu gọn panel học tập"
              onClick={() => setPanelOpen(false)}
            >
              <PanelRightClose aria-hidden="true" />
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
