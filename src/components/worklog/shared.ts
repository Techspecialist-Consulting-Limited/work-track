import { WORKTRACK_SCHEDULE, getZonedDateKey, getZonedDateParts, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/worklog/config";
import { dateKeyOf } from "@/lib/worklog/time";
import type { BreakEntry, Task, TaskStatus, WorkEntry } from "@/lib/worklog/types";

export const NEW_TASK = "__new_task__";
export const NEW_PROJECT_OPTION = "__new_project__";

export const SCHEDULED_MINUTES = (() => {
  const [startHour, startMinute] = WORKTRACK_SCHEDULE.startTime.split(":").map(Number);
  const [endHour, endMinute] = WORKTRACK_SCHEDULE.endTime.split(":").map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
})();

export const STATUS_OPTIONS: TaskStatus[] = [...TASK_STATUSES];

export const STATUS_LABELS: Record<TaskStatus, string> = { ...TASK_STATUS_LABELS };

export const BASE_INPUT_CLASS =
  "min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-2 text-[13px] text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15 sm:text-sm";
export const INPUT_CLASS = `mt-1 ${BASE_INPUT_CLASS}`;

/* 16px minimum on touch layouts so iOS does not auto-zoom the viewport on focus. */
export const MOBILE_BASE_INPUT_CLASS =
  "min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2.5 text-base text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";
export const MOBILE_INPUT_CLASS = `mt-1 ${MOBILE_BASE_INPUT_CLASS}`;

export interface WorkSlot {
  key: string;
  start: string;
  end: string;
  label: string;
  available: boolean;
  current: boolean;
}

export function dateParts(dateKey: string): [number, number, number] {
  return dateKey.split("-").map(Number) as [number, number, number];
}

export function toLagosIso(dateKey: string, time: string): string {
  const [year, month, day] = dateParts(dateKey);
  const [hour, minute] = time.split(":").map(Number);
  return zonedDateTimeToDate(year, month, day, hour, minute).toISOString();
}

export function dateKeyAfter(dateKey: string, days: number): string {
  const [year, month, day] = dateParts(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatClock(dateKey: string, minutes: number): string {
  const [year, month, day] = dateParts(dateKey);
  const date = zonedDateTimeToDate(year, month, day, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WORKTRACK_SCHEDULE.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function slotEndInstant(dateKey: string, slot: WorkSlot): number {
  return new Date(toLagosIso(dateKey, slot.end)).getTime();
}

export function makeWorkSlots(dateKey: string, entries: WorkEntry[], breaks: BreakEntry[], now: Date): WorkSlot[] {
  const [year, month, day] = dateParts(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const dayNumber = weekday === 0 ? 7 : weekday;
  if (!WORKTRACK_SCHEDULE.workingDays.includes(dayNumber as (typeof WORKTRACK_SCHEDULE.workingDays)[number])) return [];

  const [startHour, startMinute] = WORKTRACK_SCHEDULE.startTime.split(":").map(Number);
  const [endHour, endMinute] = WORKTRACK_SCHEDULE.endTime.split(":").map(Number);
  const startOfDay = startHour * 60 + startMinute;
  const endOfDay = endHour * 60 + endMinute;
  const interval = WORKTRACK_SCHEDULE.reportingIntervalMinutes;
  const today = getZonedDateKey(now) === dateKey;
  const nowParts = getZonedDateParts(now);
  const currentMinute = nowParts.hour * 60 + nowParts.minute;
  const dayEntries = entries.filter((entry) => dateKeyOf(entry.startAt) === dateKey);
  const dayBreaks = breaks.filter((brk) => dateKeyOf(brk.startAt) === dateKey);
  const nowMs = now.getTime();

  const slots: WorkSlot[] = [];
  for (let start = startOfDay; start + interval <= endOfDay; start += interval) {
    const end = start + interval;
    const startAt = zonedDateTimeToDate(year, month, day, Math.floor(start / 60), start % 60).getTime();
    const endAt = zonedDateTimeToDate(year, month, day, Math.floor(end / 60), end % 60).getTime();
    const occupiedByEntry = dayEntries.some((entry) =>
      startAt < new Date(entry.endAt).getTime() && new Date(entry.startAt).getTime() < endAt
    );
    const occupiedByBreak = dayBreaks.some((brk) => {
      const breakEnd = brk.endAt ? new Date(brk.endAt).getTime() : nowMs;
      const breakStart = new Date(brk.startAt).getTime();
      return breakEnd > breakStart && startAt < breakEnd && breakStart < endAt;
    });
    slots.push({
      key: `${start}-${end}`,
      start: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
      end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      label: `${formatClock(dateKey, start).replace(/\s[AP]M$/, "")}–${formatClock(dateKey, end).replace(/\s[AP]M$/, "")}`,
      available: !occupiedByEntry && !occupiedByBreak,
      current: today && currentMinute >= start && currentMinute < end,
    });
  }
  return slots;
}

export function getTaskStatusCounts(dbTasks: Task[], entries: WorkEntry[]) {
  const taskIds = new Set(entries.map((entry) => entry.taskId));
  const tasks = dbTasks.filter((task) => taskIds.has(task.id));
  return {
    done: tasks.filter((task) => task.currentStatus === "done").length,
    ongoing: tasks.filter((task) => task.currentStatus === "ongoing").length,
    blocked: tasks.filter((task) => task.currentStatus === "blocked").length,
    dropped: tasks.filter((task) => task.currentStatus === "dropped").length,
  };
}
