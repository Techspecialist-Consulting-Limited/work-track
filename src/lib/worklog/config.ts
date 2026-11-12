import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import type { TaskStatus } from "./types";

export const WORKLOG_RULES = {
  timezone: WORKTRACK_SCHEDULE.timezone,
  workStartHour: 9,
  workEndHour: 17,
  maxBreakMinutesPerDay: 60,
  descriptionMinLength: 0,
  descriptionMaxLength: 500,
  taskTitleMaxLength: 120,
  subtaskTitleMaxLength: 120,
  progressUpdateMaxLength: 2000,
  progressRevisionReasonMaxLength: 300,
  reasonMaxLength: 300,
} as const;

export const WORK_LOCATION_LABELS = {
  office: "Office",
  home: "Home",
  other: "Other",
  unknown: "Unknown",
} as const;

export const TASK_STATUS_LABELS = {
  ongoing: "Ongoing",
  done: "Done",
  blocked: "Blocked",
  dropped: "Dropped",
} as const;

export const TASK_STATUSES: TaskStatus[] = ["ongoing", "done", "blocked", "dropped"];

export const TASK_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  ongoing: "bg-[#EFF6FF] text-[#1D4ED8]",
  done: "bg-[#ECFDF5] text-[#047857]",
  blocked: "bg-[#FFFBEB] text-[#B45309]",
  dropped: "bg-[#FEF3F2] text-[#B42318]",
};

export const TASK_STATUS_DOT_CLASSES: Record<TaskStatus, string> = {
  ongoing: "bg-[#3B82F6]",
  done: "bg-[#10B981]",
  blocked: "bg-[#F59E0B]",
  dropped: "bg-[#B42318]",
};
