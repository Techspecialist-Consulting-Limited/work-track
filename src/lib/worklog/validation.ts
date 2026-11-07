import { WORKLOG_RULES } from "./config";
import { durationMinutes } from "./time";
import type { BreakEntry, EmployeeId, WorkEntry, WorkLogDatabase } from "./types";
import { getZonedDateKey, getSchedulePeriod, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";

export type ValidationResult = { ok: true } | { ok: false; message: string };

const ok: ValidationResult = { ok: true };
const fail = (message: string): ValidationResult => ({ ok: false, message });

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

export function validateEntryTimes(
  db: WorkLogDatabase,
  employeeId: EmployeeId,
  startAt: string,
  endAt: string,
  ignoreEntryId?: string
): ValidationResult {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return fail("Enter a valid start and end time.");
  if (end <= start) return fail("End time must be after start time.");

  const clash = db.entries.find(
    (entry) =>
      entry.employeeId === employeeId &&
      entry.id !== ignoreEntryId &&
      overlaps(start, end, new Date(entry.startAt).getTime(), new Date(entry.endAt).getTime())
  );
  if (clash) return fail("This time overlaps another work entry. Choose a different time.");

  const breakClash = db.breaks.find(
    (brk) =>
      brk.employeeId === employeeId &&
      overlaps(
        start,
        end,
        new Date(brk.startAt).getTime(),
        brk.endAt ? new Date(brk.endAt).getTime() : Number.POSITIVE_INFINITY
      )
  );
  if (breakClash) return fail("This time overlaps a break. Choose a different time.");

  return ok;
}

export function validateDescription(description: string): ValidationResult {
  const trimmed = description.trim();
  if (trimmed.length < WORKLOG_RULES.descriptionMinLength) return fail("Describe what you worked on.");
  if (trimmed.length > WORKLOG_RULES.descriptionMaxLength) {
    return fail(`Keep the description under ${WORKLOG_RULES.descriptionMaxLength} characters.`);
  }
  return ok;
}

export function validateTaskTitle(title: string): ValidationResult {
  const trimmed = title.trim();
  if (!trimmed) return fail("Give the task a title.");
  if (trimmed.length > WORKLOG_RULES.taskTitleMaxLength) {
    return fail(`Keep the task title under ${WORKLOG_RULES.taskTitleMaxLength} characters.`);
  }
  return ok;
}

export function validateSubtaskTitle(title: string): ValidationResult {
  const trimmed = title.trim();
  if (!trimmed) return fail("Give the subtask a title.");
  if (trimmed.length > WORKLOG_RULES.subtaskTitleMaxLength) {
    return fail(`Keep the subtask title under ${WORKLOG_RULES.subtaskTitleMaxLength} characters.`);
  }
  return ok;
}

export function validateProgressBody(body: string): ValidationResult {
  const trimmed = body.trim();
  if (!trimmed) return fail("Write a progress update.");
  if (trimmed.length > WORKLOG_RULES.progressUpdateMaxLength) {
    return fail(`Keep the progress update under ${WORKLOG_RULES.progressUpdateMaxLength} characters.`);
  }
  return ok;
}

export function validateEvidenceLink(link: string | undefined): ValidationResult {
  if (!link) return ok;
  try {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    return ok;
  } catch {
    return fail("Evidence link must start with http:// or https://.");
  }
}

export function validateReason(reason: string | undefined, label: string): ValidationResult {
  if (!reason || !reason.trim()) return fail(`Add a reason for ${label}.`);
  if (reason.trim().length > WORKLOG_RULES.reasonMaxLength) {
    return fail(`Keep the reason under ${WORKLOG_RULES.reasonMaxLength} characters.`);
  }
  return ok;
}

export function validateBreakWindow(startAt: string, endAt: string): ValidationResult {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (end.getTime() <= start.getTime()) return fail("Break end must be after break start.");
  if (getSchedulePeriod(start) === "non_working_day") return fail("Breaks can only be logged on working days.");
  const dayKey = getZonedDateKey(start);
  const [y, m, d] = dayKey.split("-").map(Number);
  const windowStart = zonedDateTimeToDate(y, m, d, 9, 0);
  const windowEnd = zonedDateTimeToDate(y, m, d, 17, 0);
  if (start < windowStart || end > windowEnd) return fail("Breaks must fall within 09:00 to 17:00.");
  return ok;
}

export function breakMinutesOnDay(
  breaks: BreakEntry[],
  employeeId: EmployeeId,
  dayKey: string,
  now: Date = new Date()
): number {
  return breaks
    .filter((brk) => brk.employeeId === employeeId && getZonedDateKey(new Date(brk.startAt)) === dayKey)
    .reduce((total, brk) => {
      const endMs = brk.endAt ? new Date(brk.endAt).getTime() : now.getTime();
      return total + Math.max(0, Math.round((endMs - new Date(brk.startAt).getTime()) / 60_000));
    }, 0);
}

export function validateBreakAllowance(
  db: WorkLogDatabase,
  employeeId: EmployeeId,
  startAt: string,
  endAt: string,
  ignoreBreakId?: string
): ValidationResult {
  const dayKey = getZonedDateKey(new Date(startAt));
  const used = breakMinutesOnDay(
    db.breaks.filter((brk) => brk.id !== ignoreBreakId),
    employeeId,
    dayKey
  );
  const requested = durationMinutes(startAt, endAt);
  if (used + requested > WORKLOG_RULES.maxBreakMinutesPerDay) {
    return fail(`Breaks are limited to ${WORKLOG_RULES.maxBreakMinutesPerDay} minutes a day.`);
  }
  return ok;
}

/**
 * Latest instant a break may run until: the end of its working day or the
 * rest of that day's break allowance, whichever comes first.
 */
export function breakDeadline(breaks: BreakEntry[], brk: BreakEntry): Date {
  const start = new Date(brk.startAt);
  const dayKey = getZonedDateKey(start);
  const [y, m, d] = dayKey.split("-").map(Number);
  const dayEnd = zonedDateTimeToDate(y, m, d, WORKLOG_RULES.workEndHour, 0);
  const usedMs = breaks
    .filter(
      (other) =>
        other.id !== brk.id &&
        other.employeeId === brk.employeeId &&
        other.endAt !== null &&
        getZonedDateKey(new Date(other.startAt)) === dayKey
    )
    .reduce((total, other) => total + Math.max(0, new Date(other.endAt as string).getTime() - new Date(other.startAt).getTime()), 0);
  const allowanceEnd = start.getTime() + Math.max(0, WORKLOG_RULES.maxBreakMinutesPerDay * 60_000 - usedMs);
  return new Date(Math.min(dayEnd.getTime(), allowanceEnd));
}

/** End instant to record when a running break is stopped at `now`. */
export function resolveBreakEnd(breaks: BreakEntry[], brk: BreakEntry, now: Date): Date {
  const capped = Math.min(now.getTime(), breakDeadline(breaks, brk).getTime());
  // A break must last at least a minute so the end stays after the start.
  return new Date(Math.max(capped, new Date(brk.startAt).getTime() + 60_000));
}

export function validateBreakStart(
  breaks: BreakEntry[],
  entries: Pick<WorkEntry, "startAt">[],
  employeeId: EmployeeId,
  now: Date = new Date()
): ValidationResult {
  const mine = breaks.filter((brk) => brk.employeeId === employeeId);
  if (mine.some((brk) => brk.endAt === null)) return fail("A break is already running.");
  if (getSchedulePeriod(now) !== "normal_hours") {
    return fail("Breaks can only be taken on working days between 09:00 and 17:00.");
  }
  const todayKey = getZonedDateKey(now);
  if (breakMinutesOnDay(mine, employeeId, todayKey, now) >= WORKLOG_RULES.maxBreakMinutesPerDay) {
    return fail(`You have used your ${WORKLOG_RULES.maxBreakMinutesPerDay}-minute break allowance for today.`);
  }
  if (
    entries.some(
      (entry) =>
        new Date(entry.startAt).getTime() >= now.getTime() && getZonedDateKey(new Date(entry.startAt)) === todayKey
    )
  ) {
    return fail("You have work logged for later today. Delete it before starting a break.");
  }
  return ok;
}

export function entriesForEmployeeOnDay(
  entries: WorkEntry[],
  employeeId: EmployeeId,
  dayKey: string
): WorkEntry[] {
  return entries
    .filter((entry) => entry.employeeId === employeeId && getZonedDateKey(new Date(entry.startAt)) === dayKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
