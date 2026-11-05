import { classifyWorkInterval, getZonedDateKey, WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";

export interface MinuteSplit {
  normalMinutes: number;
  overtimeMinutes: number;
}

export function splitIntervalMinutes(startAt: string, endAt: string): MinuteSplit {
  const segments = classifyWorkInterval(new Date(startAt), new Date(endAt));
  let normalMinutes = 0;
  let overtimeMinutes = 0;
  for (const segment of segments) {
    const minutes = Math.round((segment.endedAt.getTime() - segment.startedAt.getTime()) / 60_000);
    if (segment.classification === "NORMAL") {
      normalMinutes += minutes;
    } else {
      overtimeMinutes += minutes;
    }
  }
  return { normalMinutes, overtimeMinutes };
}

export function durationMinutes(startAt: string, endAt: string): number {
  return Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
}

export function dateKeyOf(iso: string): string {
  return getZonedDateKey(new Date(iso));
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: WORKTRACK_SCHEDULE.timezone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: WORKTRACK_SCHEDULE.timezone,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const time12Formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKTRACK_SCHEDULE.timezone,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatTime12(iso: string): string {
  return time12Formatter.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}
