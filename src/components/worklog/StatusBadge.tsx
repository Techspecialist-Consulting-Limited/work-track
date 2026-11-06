import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABELS } from "@/lib/worklog/config";
import type { TaskStatus } from "@/lib/worklog/types";

export function StatusBadge({
  status,
  label,
  className = "",
}: {
  status: TaskStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${TASK_STATUS_BADGE_CLASSES[status]} ${className}`}
    >
      {label ?? TASK_STATUS_LABELS[status]}
    </span>
  );
}
