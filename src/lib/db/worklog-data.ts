import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { employees, tasks, timeEntries } from "./schema";
import type {
  BreakEntry,
  Employee,
  Task,
  WorkEntry,
  WorkLogDatabase,
} from "@/lib/worklog/types";

export interface WorkLogScope {
  /** When set, only this employee's records are returned (staff view). */
  employeeId?: string;
}

function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

/** Loads worklog data from Postgres shaped as the existing client WorkLogDatabase. */
export async function loadWorkLogDb(scope: WorkLogScope = {}): Promise<WorkLogDatabase> {
  const employeeRows = scope.employeeId
    ? await db.select().from(employees).where(eq(employees.id, scope.employeeId))
    : await db.select().from(employees).where(eq(employees.isActive, true));

  const employeeIds = employeeRows.map((e) => e.id);
  if (employeeIds.length === 0) {
    return { version: 1, employees: [], tasks: [], entries: [], breaks: [] };
  }

  const [taskRows, entryRows] = await Promise.all([
    db.select().from(tasks).where(inArray(tasks.employeeId, employeeIds)).orderBy(asc(tasks.createdAt)),
    db
      .select()
      .from(timeEntries)
      .where(inArray(timeEntries.employeeId, employeeIds))
      .orderBy(asc(timeEntries.startAt)),
  ]);

  const taskUuidToClient = new Map(taskRows.map((t) => [t.id, t.id]));

  const workEntries: WorkEntry[] = [];
  const breaks: BreakEntry[] = [];

  for (const row of entryRows) {
    if (row.voidedAt) continue;
    if (row.entryType === "break") {
      breaks.push({
        id: row.id,
        employeeId: row.employeeId,
        startAt: row.startAt.toISOString(),
        endAt: toIso(row.endAt) ?? null,
        createdAt: row.createdAt.toISOString(),
      });
      continue;
    }
    if (!row.taskId || !row.workLocation || !row.endAt || row.durationMinutes == null) continue;
    const task = taskRows.find((t) => t.id === row.taskId);
    workEntries.push({
      id: row.id,
      employeeId: row.employeeId,
      taskId: taskUuidToClient.get(row.taskId) ?? row.taskId,
      description: row.description ?? "",
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      workLocation: row.workLocation,
      statusAtEntry: row.taskStatusSnapshot ?? task?.currentStatus ?? "not_started",
      normalMinutes: row.normalMinutes ?? row.durationMinutes,
      overtimeMinutes: row.overtimeMinutes ?? 0,
      isReportedOvertime: row.isReportedOvertime,
      evidenceLink: row.evidenceLink ?? undefined,
      createdAt: row.createdAt.toISOString(),
      revisions: [],
    });
  }

  const mappedTasks: Task[] = taskRows.map((t) => ({
    id: t.id,
    employeeId: t.employeeId,
    title: t.title,
    currentStatus: t.currentStatus,
    blockerReason: t.blockerReason ?? undefined,
    droppedReason: t.droppedReason ?? undefined,
    createdAt: t.createdAt.toISOString(),
    completedAt: toIso(t.completedAt),
    managementReview: t.managementReview ?? undefined,
  }));

  const mappedEmployees: Employee[] = employeeRows.map((e) => ({
    id: e.id,
    name: e.fullName,
    role: e.jobTitle,
    department: e.department,
    avatarUrl: e.avatarUrl ?? undefined,
  }));

  return { version: 1, employees: mappedEmployees, tasks: mappedTasks, entries: workEntries, breaks };
}
