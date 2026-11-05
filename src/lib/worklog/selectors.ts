import { WORKTRACK_SCHEDULE, getZonedDateKey, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
import { WORKLOG_RULES } from "./config";
import { dateKeyOf, durationMinutes } from "./time";
import type { BreakEntry, Employee, EmployeeId, Task, WorkEntry, WorkLocation, WorkLogDatabase } from "./types";

export const SHIFT_MINUTES =
  (WORKLOG_RULES.workEndHour - WORKLOG_RULES.workStartHour) * 60;

export interface DaySummary {
  dateKey: string;
  entries: WorkEntry[];
  breaks: BreakEntry[];
  workMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
  /** Minutes inside the shift window that have passed but have no entry or break. */
  notLoggedMinutes: number;
  shiftMinutes: number;
  reportedOvertimeMinutes: number;
  officeMinutes: number;
  homeMinutes: number;
  otherMinutes: number;
  activeBreak: BreakEntry | null;
  isWorkingDay: boolean;
  isToday: boolean;
  isFuture: boolean;
}

function breakMinutesOf(brk: BreakEntry, now: Date): number {
  const end = brk.endAt ? new Date(brk.endAt) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(brk.startAt).getTime()) / 60_000));
}

export function getDaySummary(db: WorkLogDatabase, employeeId: EmployeeId, dateKey: string, now: Date = new Date()): DaySummary {
  const entries = db.entries
    .filter((e) => e.employeeId === employeeId && dateKeyOf(e.startAt) === dateKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const breaks = db.breaks
    .filter((b) => b.employeeId === employeeId && dateKeyOf(b.startAt) === dateKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const isWorkingDay = WORKTRACK_SCHEDULE.workingDays.includes((weekday === 0 ? 7 : weekday) as 1);

  const todayKey = getZonedDateKey(now);
  const isToday = todayKey === dateKey;
  const isFuture = dateKey > todayKey;

  const workMinutes = entries.reduce((total, e) => total + durationMinutes(e.startAt, e.endAt), 0);
  const normalMinutes = entries.reduce((total, e) => total + e.normalMinutes, 0);
  const overtimeMinutes = entries.reduce((total, e) => total + e.overtimeMinutes, 0);
  const reportedOvertimeMinutes = entries
    .filter((e) => e.isReportedOvertime)
    .reduce((total, e) => total + e.overtimeMinutes, 0);
  const officeMinutes = entries
    .filter((e) => e.workLocation === "office")
    .reduce((total, e) => total + durationMinutes(e.startAt, e.endAt), 0);
  const homeMinutes = entries
    .filter((e) => e.workLocation === "home")
    .reduce((total, e) => total + durationMinutes(e.startAt, e.endAt), 0);
  const otherMinutes = entries
    .filter((e) => e.workLocation === "other")
    .reduce((total, e) => total + durationMinutes(e.startAt, e.endAt), 0);
  const breakMinutes = breaks.reduce((total, b) => total + breakMinutesOf(b, now), 0);

  let shiftMinutes = 0;
  if (isWorkingDay && !isFuture) {
    if (isToday) {
      const [sh, sm] = WORKTRACK_SCHEDULE.startTime.split(":").map(Number);
      const start = zonedDateTimeToDate(y, m, d, sh, sm).getTime();
      const cap = Math.min(now.getTime(), zonedDateTimeToDate(y, m, d, WORKLOG_RULES.workEndHour, 0).getTime());
      shiftMinutes = Math.max(0, Math.round((cap - start) / 60_000));
    } else {
      shiftMinutes = SHIFT_MINUTES;
    }
  }

  const notLoggedMinutes = Math.max(0, shiftMinutes - normalMinutes - breakMinutes);

  return {
    dateKey,
    entries,
    breaks,
    workMinutes,
    normalMinutes,
    overtimeMinutes,
    breakMinutes,
    notLoggedMinutes,
    shiftMinutes,
    reportedOvertimeMinutes,
    officeMinutes,
    homeMinutes,
    otherMinutes,
    activeBreak: breaks.find((b) => b.endAt === null) ?? null,
    isWorkingDay,
    isToday,
    isFuture,
  };
}

export function getOpenTasks(db: WorkLogDatabase, employeeId: EmployeeId): Task[] {
  return db.tasks.filter(
    (t) => t.employeeId === employeeId && (t.currentStatus === "not_started" || t.currentStatus === "ongoing" || t.currentStatus === "blocked")
  );
}

export function getTaskById(db: WorkLogDatabase, taskId: string): Task | undefined {
  return db.tasks.find((t) => t.id === taskId);
}

export function getEmployee(db: WorkLogDatabase, employeeId: EmployeeId): Employee | undefined {
  return db.employees.find((e) => e.id === employeeId);
}

export interface RangeFilter {
  fromKey: string;
  toKey: string;
  employeeId?: EmployeeId | "all";
  location?: WorkLocation | "all";
  statusAtEntry?: Task["currentStatus"] | "all";
  hours?: "all" | "normal" | "overtime";
}

export function filterEntries(db: WorkLogDatabase, filter: RangeFilter): WorkEntry[] {
  return db.entries
    .filter((e) => {
      const key = dateKeyOf(e.startAt);
      if (key < filter.fromKey || key > filter.toKey) return false;
      if (filter.employeeId && filter.employeeId !== "all" && e.employeeId !== filter.employeeId) return false;
      if (filter.location && filter.location !== "all" && e.workLocation !== filter.location) return false;
      if (filter.statusAtEntry && filter.statusAtEntry !== "all" && e.statusAtEntry !== filter.statusAtEntry) return false;
      if (filter.hours === "normal" && e.normalMinutes === 0) return false;
      if (filter.hours === "overtime" && e.overtimeMinutes === 0) return false;
      return true;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
