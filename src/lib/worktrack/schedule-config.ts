export const WORKTRACK_SCHEDULE = {
  timezone: "Africa/Lagos",
  workingDays: [1, 2, 3, 4, 5] as const,
  startTime: "09:00",
  endTime: "17:00",
  reportingIntervalMinutes: 60,
  breakAllowanceMinutes: 60,
} as const;

export type SchedulePeriod = "before_shift" | "normal_hours" | "after_shift" | "non_working_day";

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKTRACK_SCHEDULE.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAY_NUMBERS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getZonedDateParts(
  date: Date,
  timeZone: string = WORKTRACK_SCHEDULE.timezone
): ZonedDateParts {
  const formatter =
    timeZone === WORKTRACK_SCHEDULE.timezone
      ? partsFormatter
      : new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
          weekday: "short",
        });
  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = values.get("weekday");
  if (!weekday || WEEKDAY_NUMBERS[weekday] === undefined) {
    throw new Error(`Unsupported weekday returned for timezone ${timeZone}.`);
  }
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
    weekday: WEEKDAY_NUMBERS[weekday],
  };
}

function getTimeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = getZonedDateParts(new Date(instantMs), timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - Math.floor(instantMs / 1000) * 1000;
}

export function zonedDateTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = WORKTRACK_SCHEDULE.timezone
): Date {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = targetUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = targetUtc - getTimeZoneOffsetMs(instant, timeZone);
    if (next === instant) {
      break;
    }
    instant = next;
  }
  return new Date(instant);
}

export function getZonedDateKey(date: Date, timeZone = WORKTRACK_SCHEDULE.timezone): string {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getSchedulePeriod(
  date: Date,
  schedule = WORKTRACK_SCHEDULE
): SchedulePeriod {
  const parts = getZonedDateParts(date, schedule.timezone);
  if (!schedule.workingDays.includes(parts.weekday as (typeof schedule.workingDays)[number])) {
    return "non_working_day";
  }
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const [startHour, startMinute] = schedule.startTime.split(":").map(Number);
  const [endHour, endMinute] = schedule.endTime.split(":").map(Number);
  if (minuteOfDay < startHour * 60 + startMinute) {
    return "before_shift";
  }
  if (minuteOfDay < endHour * 60 + endMinute) {
    return "normal_hours";
  }
  return "after_shift";
}

export function getScheduleBoundaryInstants(
  from: Date,
  to: Date,
  schedule = WORKTRACK_SCHEDULE
): Date[] {
  const fromParts = getZonedDateParts(from, schedule.timezone);
  const day = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day));
  const boundaries: Date[] = [];

  while (day.getTime() <= to.getTime() + 2 * 86_400_000) {
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const date = day.getUTCDate();
    for (const time of ["00:00", schedule.startTime, schedule.endTime]) {
      const [hour, minute] = time.split(":").map(Number);
      const boundary = zonedDateTimeToDate(year, month, date, hour, minute, schedule.timezone);
      if (boundary.getTime() > from.getTime() && boundary.getTime() < to.getTime()) {
        boundaries.push(boundary);
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return boundaries.sort((left, right) => left.getTime() - right.getTime());
}

export function classifyWorkInterval(
  startedAt: Date,
  endedAt: Date,
  schedule = WORKTRACK_SCHEDULE
): Array<{ startedAt: Date; endedAt: Date; classification: "NORMAL" | "OVERTIME" }> {
  if (endedAt.getTime() <= startedAt.getTime()) {
    return [];
  }
  const boundaries = [
    startedAt,
    ...getScheduleBoundaryInstants(startedAt, endedAt, schedule),
    endedAt,
  ];
  const segments: Array<{ startedAt: Date; endedAt: Date; classification: "NORMAL" | "OVERTIME" }> = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const period = getSchedulePeriod(new Date(start.getTime() + Math.min(1, end.getTime() - start.getTime())), schedule);
    segments.push({
      startedAt: start,
      endedAt: end,
      classification: period === "normal_hours" ? "NORMAL" : "OVERTIME",
    });
  }
  return segments;
}
