import { CheckCircle2, Circle, Clock3 } from "lucide-react";
import { type Assignment } from "@/lib/api";

// Exact statuses from GET /assignments. Finishing the dialogue is not submitting the essay.
export const assignmentStates = [
  {
    key: "new",
    label: "Chưa học",
    backend: "Chưa bắt đầu",
    action: "Bắt đầu học",
    icon: Circle,
    style: "bg-muted text-slate-600",
  },
  {
    key: "active",
    label: "Đang học",
    backend: "Đang học",
    action: "Tiếp tục học",
    icon: Clock3,
    style: "bg-warning-soft text-amber-800",
  },
  {
    key: "complete",
    label: "Hoàn thành",
    backend: "Đã hoàn thành",
    action: "Xem kết quả",
    icon: CheckCircle2,
    style: "bg-secondary-soft text-secondary",
  },
] as const;

export function getAssignmentState(assignment: Assignment) {
  return (
    assignmentStates.find((state) => state.backend === assignment.status) ?? {
      key: "unknown",
      label: assignment.status || "Chưa rõ trạng thái",
      action: "Xem phiên học",
      icon: Circle,
      style: "bg-muted text-slate-600",
    }
  );
}
