import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";

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
