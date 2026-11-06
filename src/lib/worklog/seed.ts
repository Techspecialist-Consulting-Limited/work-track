import { splitIntervalMinutes } from "./time";
import type { BreakEntry, Employee, Task, TaskStatus, WorkEntry, WorkLocation, WorkLogDatabase } from "./types";
import { getZonedDateParts, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";

export const SIGNED_IN_EMPLOYEE_ID = "alex";

export const SEED_EMPLOYEES: Employee[] = [
  { id: "alex", name: "Alex Johnson", role: "Software Developer", department: "Engineering" },
  { id: "sarah", name: "Sarah Adams", role: "Business Analyst", department: "Product" },
  { id: "david", name: "David James", role: "DevOps Engineer", department: "Engineering" },
  { id: "esther", name: "Esther Michael", role: "Product Designer", department: "Design" },
  { id: "ibrahim", name: "Ibrahim Musa", role: "Customer Support Lead", department: "Support" },
];

const TASK_TITLES: Record<string, string[]> = {
  alex: ["Login page fixes", "Sprint API integration", "Release checklist"],
  sarah: ["Requirements for billing", "Stakeholder interviews", "Process map review"],
  david: ["Pipeline hardening", "Staging environment", "Monitoring alerts"],
  esther: ["Onboarding flow redesign", "Design system tokens", "Usability notes"],
  ibrahim: ["Ticket backlog triage", "Customer escalation playbook", "Weekly support report"],
};

const DESCRIPTIONS = [
  "Worked through the open items and updated the team.",
  "Reviewed feedback and made the agreed changes.",
  "Investigated the issue and documented the findings.",
  "Met with the team to agree the next steps.",
  "Built and tested the change locally.",
  "Prepared the update for the weekly review.",
];

/** Exercise window: Mon 26 Oct 2026 to Fri 6 Nov 2026 (Lagos calendar days). */
const WINDOW_START = { year: 2026, month: 10, day: 26 };
const WINDOW_END = { year: 2026, month: 11, day: 6 };
/** Alex has no entries on this day, so the empty State A shows. */
const OPEN_DAY = { employeeId: SIGNED_IN_EMPLOYEE_ID, month: 11, day: 4 };

export const EXERCISE_START = WINDOW_START;
export const EXERCISE_END = WINDOW_END;

type CalendarDay = { year: number; month: number; day: number };

function calendarDays(): CalendarDay[] {
  const days: CalendarDay[] = [];
  let cursor = Date.UTC(WINDOW_START.year, WINDOW_START.month - 1, WINDOW_START.day);
  const end = Date.UTC(WINDOW_END.year, WINDOW_END.month - 1, WINDOW_END.day);
  while (cursor <= end) {
    const d = new Date(cursor);
    days.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    cursor += 86_400_000;
  }
  return days;
}

function lagosIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return zonedDateTimeToDate(year, month, day, hour, minute).toISOString();
}

function buildTasks(employee: Employee): Task[] {
  const titles = TASK_TITLES[employee.id] ?? [];
  const createdAt = lagosIso(WINDOW_START.year, WINDOW_START.month, WINDOW_START.day, 9, 0);
  return titles.map((title, index) => {
    const status: TaskStatus = index === 0 ? "ongoing" : index === 1 ? "blocked" : "completed";
    const task: Task = {
      id: `${employee.id}-task-${index + 1}`,
      employeeId: employee.id,
      title,
      currentStatus: status,
      createdAt,
    };
    if (status === "blocked") task.blockerReason = "Waiting for access to the staging server.";
    if (status === "completed") {
      task.completedAt = lagosIso(2026, 10, 30, 17, 0);
      if (index === 2 && employee.id !== SIGNED_IN_EMPLOYEE_ID) {
        task.managementReview = {
          status: "accepted",
          note: "Clear result. Thanks.",
          reviewedAt: lagosIso(2026, 10, 31, 10, 0),
        };
      }
    }
    return task;
  });
}

function buildEntry(
  employeeId: string,
  key: string,
  task: Task,
  startAt: string,
  endAt: string,
  workLocation: WorkLocation,
  descriptionIndex: number
): WorkEntry {
  const split = splitIntervalMinutes(startAt, endAt);
  return {
    id: `${employeeId}-entry-${key}`,
    employeeId,
    taskId: task.id,
    description: DESCRIPTIONS[descriptionIndex % DESCRIPTIONS.length],
    startAt,
    endAt,
    workLocation,
    statusAtEntry: task.currentStatus,
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    isReportedOvertime: false,
    createdAt: startAt,
    revisions: [],
  };
}

export function buildSeedDatabase(): WorkLogDatabase {
  const entries: WorkEntry[] = [];
  const breaks: BreakEntry[] = [];
  const tasks: Task[] = [];
  const days = calendarDays();
  const lastWorkingDay = days.filter((d) => isWorkingDay(d)).at(-1);

  for (const employee of SEED_EMPLOYEES) {
    const employeeTasks = buildTasks(employee);
    tasks.push(...employeeTasks);
    const offset = employee.id.length;

    for (const { year, month, day } of days) {
      if (!isWorkingDay({ year, month, day })) {
        if ((day + offset) % 3 === 0) {
          // Hourly entries, matching the staff logging grid.
          [[10, 11], [11, 12]].forEach(([sh, eh], i) => {
            entries.push(
              buildEntry(
                employee.id,
                `${month}-${day}-weekend-${i}`,
                employeeTasks[0],
                lagosIso(year, month, day, sh, 0),
                lagosIso(year, month, day, eh, 0),
                "home",
                day + i
              )
            );
          });
        }
        continue;
      }
      if (employee.id === OPEN_DAY.employeeId && month === OPEN_DAY.month && day === OPEN_DAY.day) continue;

      const isLastDay = lastWorkingDay !== undefined && lastWorkingDay.month === month && lastWorkingDay.day === day;
      // Hourly slots on the staff grid: 09–12 morning, 14–17 afternoon.
      // The last working day stops at lunch so the afternoon is still open.
      const usedSlots: Array<[number, number]> = isLastDay
        ? [[9, 10], [10, 11], [11, 12]]
        : [[9, 10], [10, 11], [11, 12], [14, 15], [15, 16], [16, 17]];

      breaks.push({
        id: `${employee.id}-break-${month}-${day}`,
        employeeId: employee.id,
        startAt: lagosIso(year, month, day, 13, 0),
        endAt: lagosIso(year, month, day, 14, 0),
        createdAt: lagosIso(year, month, day, 13, 0),
      });

      usedSlots.forEach(([sh, eh], slotIndex) => {
        // Morning stays on the primary task; afternoon rotates through the task list.
        const task =
          slotIndex < 3
            ? employeeTasks[0]
            : employeeTasks[(day + slotIndex + offset) % employeeTasks.length];
        const location: WorkLocation = (day + slotIndex + offset) % 3 === 0 ? "home" : "office";
        entries.push(
          buildEntry(
            employee.id,
            `${month}-${day}-${slotIndex}`,
            task,
            lagosIso(year, month, day, sh, 0),
            lagosIso(year, month, day, eh, 0),
            location,
            day + slotIndex
          )
        );
      });

      if ((day + offset) % 3 === 0 && !isLastDay) {
        entries.push(
          buildEntry(
            employee.id,
            `${month}-${day}-evening`,
            employeeTasks[1],
            lagosIso(year, month, day, 17, 0),
            lagosIso(year, month, day, 18, 0),
            "office",
            day
          )
        );
      }
    }
  }

  return { version: 1, employees: SEED_EMPLOYEES, tasks, entries, breaks, statusHistory: [] };
}

function isWorkingDay({ year, month, day }: CalendarDay): boolean {
  const weekday = getZonedDateParts(zonedDateTimeToDate(year, month, day, 12, 0)).weekday;
  return weekday >= 1 && weekday <= 5;
}
