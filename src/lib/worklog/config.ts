import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import type { TaskStatus } from "./types";

export const WORKLOG_STORAGE_KEY = "worktrack:worklog:v3";

export const WORKLOG_RULES = {
  timezone: WORKTRACK_SCHEDULE.timezone,
  workStartHour: 9,
  workEndHour: 17,
  maxBreakMinutesPerDay: 60,
  descriptionMinLength: 1,
  descriptionMaxLength: 500,
  taskTitleMaxLength: 120,
  reasonMaxLength: 300,
} as const;

export const WORK_LOCATION_LABELS = {
  office: "Office",
  home: "Home",
  other: "Other",
} as const;

export const TASK_STATUS_LABELS = {
  not_started: "Not started",
  ongoing: "Ongoing",
  blocked: "Blocked",
  completed: "Completed",
  dropped: "Dropped",
} as const;

export const TASK_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  not_started: "bg-[#F1F1F5] text-[#6B6B7E]",
  ongoing: "bg-[#EFF6FF] text-[#1D4ED8]",
  blocked: "bg-[#FFFBEB] text-[#B45309]",
  completed: "bg-[#ECFDF5] text-[#047857]",
  dropped: "bg-[#FEF3F2] text-[#B42318]",
};

export const TASK_STATUS_DOT_CLASSES: Record<TaskStatus, string> = {
  not_started: "bg-[#8B8B9A]",
  ongoing: "bg-[#3B82F6]",
  blocked: "bg-[#F59E0B]",
  completed: "bg-[#10B981]",
  dropped: "bg-[#B42318]",
};
