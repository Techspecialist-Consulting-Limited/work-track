import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import {
  employees,
  memberships,
  subtaskStatusHistory,
  taskCategories,
  taskProgressUpdateRevisions,
  taskProgressUpdates,
  taskStatusHistory,
  taskSubtasks,
  tasks,
  timeEntries,
} from "./schema";
import type {
  BreakEntry,
  Employee,
  ProgressUpdate,
  ProgressUpdateRevision,
  StatusHistoryEvent,
  Subtask,
  Task,
  TaskCategory,
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
  const empty: WorkLogDatabase = {
    version: 1,
    employees: [],
    categories: [],
    tasks: [],
    subtasks: [],
    progressUpdates: [],
    entries: [],
    breaks: [],
    statusHistory: [],
  };
  if (employeeIds.length === 0) return empty;

  const [categoryRows, membershipRows, taskRows, entryRows] = await Promise.all([
    db.select().from(taskCategories).where(eq(taskCategories.isActive, true)).orderBy(asc(taskCategories.name)),
    db
      .select({ id: memberships.id, name: employees.fullName })
      .from(memberships)
      .leftJoin(employees, eq(memberships.employeeId, employees.id)),
    db.select().from(tasks).where(inArray(tasks.employeeId, employeeIds)).orderBy(asc(tasks.createdAt)),
    db
      .select()
      .from(timeEntries)
      .where(inArray(timeEntries.employeeId, employeeIds))
      .orderBy(asc(timeEntries.startAt)),
  ]);

  const membershipNames = new Map(membershipRows.map((row) => [row.id, row.name ?? undefined]));
  const employeeNames = new Map(employeeRows.map((row) => [row.id, row.fullName]));
  const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));
  const taskIds = taskRows.map((t) => t.id);

  const [subtaskRows, progressRows, taskHistoryRows, subtaskHistoryRows] = taskIds.length
    ? await Promise.all([
        db
          .select()
          .from(taskSubtasks)
          .where(inArray(taskSubtasks.taskId, taskIds))
          .orderBy(asc(taskSubtasks.displayOrder), asc(taskSubtasks.createdAt)),
        db
          .select()
          .from(taskProgressUpdates)
          .where(inArray(taskProgressUpdates.taskId, taskIds))
          .orderBy(asc(taskProgressUpdates.createdAt)),
        db
          .select()
          .from(taskStatusHistory)
          .where(inArray(taskStatusHistory.taskId, taskIds))
          .orderBy(asc(taskStatusHistory.changedAt)),
        db
          .select()
          .from(subtaskStatusHistory)
          .innerJoin(taskSubtasks, eq(subtaskStatusHistory.subtaskId, taskSubtasks.id))
          .where(inArray(taskSubtasks.taskId, taskIds))
          .orderBy(asc(subtaskStatusHistory.changedAt)),
      ])
    : [[], [], [], []];

  const progressIds = progressRows.map((row) => row.id);
  const revisionRows = progressIds.length
    ? await db
        .select()
        .from(taskProgressUpdateRevisions)
        .where(inArray(taskProgressUpdateRevisions.progressUpdateId, progressIds))
        .orderBy(asc(taskProgressUpdateRevisions.revisedAt))
    : [];

  const revisionsByUpdate = new Map<string, ProgressUpdateRevision[]>();
  for (const row of revisionRows) {
    const list = revisionsByUpdate.get(row.progressUpdateId) ?? [];
    list.push({
      id: row.id,
      progressUpdateId: row.progressUpdateId,
      previousBody: row.previousBody,
      revisedBy: row.revisedByMembershipId ?? undefined,
      revisedByName: row.revisedByMembershipId ? membershipNames.get(row.revisedByMembershipId) : undefined,
      revisedAt: row.revisedAt.toISOString(),
      revisionReason: row.revisionReason ?? undefined,
    });
    revisionsByUpdate.set(row.progressUpdateId, list);
  }

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
        updatedAt: row.updatedAt.toISOString(),
      });
      continue;
    }
    if (!row.taskId || !row.workLocation || !row.endAt || row.durationMinutes == null) continue;
    workEntries.push({
      id: row.id,
      employeeId: row.employeeId,
      taskId: row.taskId,
      subtaskId: row.subtaskId ?? undefined,
      description: row.description ?? "",
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      workLocation: row.workLocation,
      normalMinutes: row.normalMinutes ?? row.durationMinutes,
      overtimeMinutes: row.overtimeMinutes ?? 0,
      isReportedOvertime: row.isReportedOvertime,
      evidenceLink: row.evidenceLink ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      revisions: [],
    });
  }

  const mappedTasks: Task[] = taskRows.map((t) => ({
    id: t.id,
    employeeId: t.employeeId,
    title: t.title,
    description: t.description ?? undefined,
    categoryId: t.categoryId ?? undefined,
    categoryName: t.categoryId ? categoryNames.get(t.categoryId) : undefined,
    currentStatus: t.currentStatus,
    blockerReason: t.blockerReason ?? undefined,
    droppedReason: t.droppedReason ?? undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    statusUpdatedAt: t.statusUpdatedAt.toISOString(),
    completedAt: toIso(t.completedAt),
    managementReview: t.managementReview ?? undefined,
  }));

  const mappedSubtasks: Subtask[] = subtaskRows
    .filter((row) => !row.archivedAt)
    .map((row) => ({
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      statusUpdatedAt: row.statusUpdatedAt.toISOString(),
      completedAt: toIso(row.completedAt),
    }));

  const mappedProgress: ProgressUpdate[] = progressRows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    subtaskId: row.subtaskId ?? undefined,
    authorEmployeeId: row.authorEmployeeId,
    authorName: employeeNames.get(row.authorEmployeeId),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: toIso(row.editedAt),
    editedBy: row.editedByMembershipId ?? undefined,
    editedByName: row.editedByMembershipId ? membershipNames.get(row.editedByMembershipId) : undefined,
    revisions: revisionsByUpdate.get(row.id) ?? [],
  }));

  const mappedEmployees: Employee[] = employeeRows.map((e) => ({
    id: e.id,
    name: e.fullName,
    role: e.jobTitle,
    department: e.department,
    avatarUrl: e.avatarUrl ?? undefined,
  }));

  const mappedCategories: TaskCategory[] = categoryRows.map((row) => ({ id: row.id, name: row.name }));

  const statusHistory: StatusHistoryEvent[] = [
    ...taskHistoryRows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      changedBy: row.changedByMembershipId ?? undefined,
      changedByName: row.changedByMembershipId ? membershipNames.get(row.changedByMembershipId) : undefined,
      changeNote: row.changeNote ?? undefined,
      changedAt: row.changedAt.toISOString(),
    })),
    ...subtaskHistoryRows.map((row) => ({
      id: row.subtask_status_history.id,
      taskId: row.task_subtasks.taskId,
      subtaskId: row.subtask_status_history.subtaskId,
      previousStatus: row.subtask_status_history.previousStatus,
      newStatus: row.subtask_status_history.newStatus,
      changedBy: row.subtask_status_history.changedByMembershipId ?? undefined,
      changedByName: row.subtask_status_history.changedByMembershipId
        ? membershipNames.get(row.subtask_status_history.changedByMembershipId)
        : undefined,
      changeNote: row.subtask_status_history.changeNote ?? undefined,
      changedAt: row.subtask_status_history.changedAt.toISOString(),
    })),
  ].sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  return {
    version: 1,
    employees: mappedEmployees,
    categories: mappedCategories,
    tasks: mappedTasks,
    subtasks: mappedSubtasks,
    progressUpdates: mappedProgress,
    entries: workEntries,
    breaks,
    statusHistory,
  };
}
