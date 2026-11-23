import type { Subtask, TaskCycle, WorkLogDatabase } from "./types";

/** Case, edge-space and internal-whitespace insensitive key for free-title tasks. */
export function normalizeTaskTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Accepts only a real calendar date in YYYY-MM-DD form. */
export function isValidWorkDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function getTaskCycleForDate(
  db: WorkLogDatabase,
  taskId: string | undefined,
  workDate: string
): TaskCycle | undefined {
  if (!taskId) return undefined;
  return (db.taskCycles ?? []).find(
    (cycle) => cycle.taskId === taskId && cycle.workDate === workDate
  );
}

/** Subtasks belong to the selected working date; undated legacy rows stay visible. */
export function getSubtasksForDate(
  subtasks: Subtask[],
  taskId: string,
  workDate: string
): Subtask[] {
  return subtasks
    .filter((subtask) => subtask.taskId === taskId && (!subtask.workDate || subtask.workDate === workDate))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt));
}

/** Latest earlier cycle that actually has subtasks to copy. */
export function getLatestPriorCycle(
  db: WorkLogDatabase,
  taskId: string | undefined,
  workDate: string
): TaskCycle | undefined {
  if (!taskId) return undefined;
  const datesWithSubtasks = new Set(
    db.subtasks
      .filter(
        (subtask) =>
          subtask.taskId === taskId &&
          !subtask.archivedAt &&
          Boolean(subtask.workDate) &&
          subtask.workDate! < workDate
      )
      .map((subtask) => subtask.workDate!)
  );
  return (db.taskCycles ?? [])
    .filter(
      (cycle) =>
        cycle.taskId === taskId &&
        cycle.workDate < workDate &&
        datesWithSubtasks.has(cycle.workDate)
    )
    .sort((a, b) => b.workDate.localeCompare(a.workDate))[0];
}
