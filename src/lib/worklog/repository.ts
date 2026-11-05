import { WORKLOG_STORAGE_KEY } from "./config";
import { buildSeedDatabase } from "./seed";
import {
  validateDescription,
  validateEntryTimes,
  validateEvidenceLink,
  validateReason,
  validateTaskTitle,
  type ValidationResult,
} from "./validation";
import { splitIntervalMinutes } from "./time";
import type {
  BreakEntry,
  EmployeeId,
  ManagementReviewStatus,
  TaskStatus,
  WorkEntry,
  WorkLocation,
  WorkLogDatabase,
} from "./types";

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: WorkLogDatabase | null = null;
let serverSnapshot: WorkLogDatabase | null = null;

function isDatabase(value: unknown): value is WorkLogDatabase {
  if (!value || typeof value !== "object") return false;
  const db = value as Partial<WorkLogDatabase>;
  return db.version === 1 && Array.isArray(db.employees) && Array.isArray(db.tasks) && Array.isArray(db.entries) && Array.isArray(db.breaks);
}

function readFromStorage(): WorkLogDatabase {
  if (typeof window === "undefined") return getServerSnapshot();
  try {
    const raw = window.localStorage.getItem(WORKLOG_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isDatabase(parsed)) return parsed;
    }
  } catch {
    // Corrupt or unreadable storage falls back to the seed data below.
  }
  const seeded = buildSeedDatabase();
  persist(seeded);
  return seeded;
}

function persist(db: WorkLogDatabase) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKLOG_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Storage can be full or disabled; the in-memory copy still works for this session.
  }
}

function emit(db: WorkLogDatabase) {
  cache = db;
  persist(db);
  listeners.forEach((listener) => listener());
}

export function getServerSnapshot(): WorkLogDatabase {
  if (!serverSnapshot) serverSnapshot = buildSeedDatabase();
  return serverSnapshot;
}

export function getDatabaseSnapshot(): WorkLogDatabase {
  if (!cache) cache = readFromStorage();
  return cache;
}

export function subscribeToDatabase(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === WORKLOG_STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function resetDatabase(): void {
  emit(buildSeedDatabase());
}

export type MutationResult = ValidationResult;

export interface EntryInput {
  employeeId: EmployeeId;
  taskId: string;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: WorkLocation;
  evidenceLink?: string;
  isReportedOvertime?: boolean;
  statusAfterEntry?: TaskStatus;
  statusReason?: string;
}

function checkEntryInput(db: WorkLogDatabase, input: EntryInput, ignoreId?: string): ValidationResult {
  const description = validateDescription(input.description);
  if (!description.ok) return description;
  const link = validateEvidenceLink(input.evidenceLink);
  if (!link.ok) return link;
  return validateEntryTimes(db, input.employeeId, input.startAt, input.endAt, ignoreId);
}

export function addWorkEntry(input: EntryInput): MutationResult {
  const db = getDatabaseSnapshot();
  const check = checkEntryInput(db, input);
  if (!check.ok) return check;
  const task = db.tasks.find((t) => t.id === input.taskId && t.employeeId === input.employeeId);
  if (!task) return { ok: false, message: "Choose a task first." };
  if (task.currentStatus === "completed" || task.currentStatus === "dropped") {
    return { ok: false, message: "This task is closed. Start a new task or continue an open one." };
  }
  if (input.statusAfterEntry === "blocked" || input.statusAfterEntry === "dropped") {
    const reason = validateReason(
      input.statusReason,
      input.statusAfterEntry === "blocked" ? "being blocked" : "dropping this task"
    );
    if (!reason.ok) return reason;
  }
  const split = input.isReportedOvertime
    ? { normalMinutes: 0, overtimeMinutes: Math.round((new Date(input.endAt).getTime() - new Date(input.startAt).getTime()) / 60_000) }
    : splitIntervalMinutes(input.startAt, input.endAt);
  const entry: WorkEntry = {
    id: `${input.employeeId}-entry-${Date.now().toString(36)}`,
    employeeId: input.employeeId,
    taskId: task.id,
    description: input.description.trim(),
    startAt: input.startAt,
    endAt: input.endAt,
    workLocation: input.workLocation,
    statusAtEntry: task.currentStatus,
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    isReportedOvertime: Boolean(input.isReportedOvertime),
    evidenceLink: input.evidenceLink?.trim() || undefined,
    createdAt: new Date().toISOString(),
    revisions: [],
  };
  const updatedTask = input.statusAfterEntry
    ? {
        ...task,
        currentStatus: input.statusAfterEntry,
        blockerReason: input.statusAfterEntry === "blocked" ? input.statusReason?.trim() : undefined,
        droppedReason: input.statusAfterEntry === "dropped" ? input.statusReason?.trim() : undefined,
        completedAt: input.statusAfterEntry === "completed" ? task.completedAt ?? new Date().toISOString() : undefined,
        droppedAt: input.statusAfterEntry === "dropped" ? new Date().toISOString() : undefined,
      }
    : task;
  emit({
    ...db,
    entries: [...db.entries, entry],
    tasks: updatedTask === task ? db.tasks : db.tasks.map((item) => item.id === task.id ? updatedTask : item),
  });
  return { ok: true };
}

export function editWorkEntry(entryId: string, input: EntryInput): MutationResult {
  const db = getDatabaseSnapshot();
  const existing = db.entries.find((e) => e.id === entryId);
  if (!existing) return { ok: false, message: "This entry no longer exists." };
  const check = checkEntryInput(db, input, entryId);
  if (!check.ok) return check;
  const split = input.isReportedOvertime
    ? { normalMinutes: 0, overtimeMinutes: Math.round((new Date(input.endAt).getTime() - new Date(input.startAt).getTime()) / 60_000) }
    : splitIntervalMinutes(input.startAt, input.endAt);
  const updated: WorkEntry = {
    ...existing,
    description: input.description.trim(),
    startAt: input.startAt,
    endAt: input.endAt,
    workLocation: input.workLocation,
    evidenceLink: input.evidenceLink?.trim() || undefined,
    isReportedOvertime: Boolean(input.isReportedOvertime),
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    revisions: [
      ...existing.revisions,
      {
        revisedAt: new Date().toISOString(),
        previousDescription: existing.description,
        previousStartAt: existing.startAt,
        previousEndAt: existing.endAt,
        previousWorkLocation: existing.workLocation,
      },
    ],
  };
  emit({ ...db, entries: db.entries.map((e) => (e.id === entryId ? updated : e)) });
  return { ok: true };
}

export interface TaskInput {
  employeeId: EmployeeId;
  title: string;
}

export function createTask(input: TaskInput): { ok: true; taskId: string } | { ok: false; message: string } {
  const check = validateTaskTitle(input.title);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const taskId = `${input.employeeId}-task-${Date.now().toString(36)}`;
  emit({
    ...db,
    tasks: [
      ...db.tasks,
      {
        id: taskId,
        employeeId: input.employeeId,
        title: input.title.trim(),
        currentStatus: "not_started",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  return { ok: true, taskId };
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  reason?: string
): MutationResult {
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (status === "blocked") {
    const check = validateReason(reason, "being blocked");
    if (!check.ok) return check;
  }
  if (status === "dropped") {
    const check = validateReason(reason, "dropping this task");
    if (!check.ok) return check;
  }
  const now = new Date().toISOString();
  const updated = {
    ...task,
    currentStatus: status,
    blockerReason: status === "blocked" ? reason?.trim() : undefined,
    droppedReason: status === "dropped" ? reason?.trim() : undefined,
    completedAt: status === "completed" ? task.completedAt ?? now : undefined,
    droppedAt: status === "dropped" ? now : undefined,
  };
  emit({ ...db, tasks: db.tasks.map((t) => (t.id === taskId ? updated : t)) });
  return { ok: true };
}

export function setManagementReview(
  taskId: string,
  status: ManagementReviewStatus,
  note?: string
): MutationResult {
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus !== "completed") return { ok: false, message: "Only completed tasks can be reviewed." };
  if (status === "needs_changes") {
    const check = validateReason(note, "requesting changes");
    if (!check.ok) return check;
  }
  emit({
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === taskId
        ? { ...t, managementReview: { status, note: note?.trim() || undefined, reviewedAt: new Date().toISOString() } }
        : t
    ),
  });
  return { ok: true };
}

export function startBreak(employeeId: EmployeeId): MutationResult {
  const db = getDatabaseSnapshot();
  if (db.breaks.some((b) => b.employeeId === employeeId && b.endAt === null)) {
    return { ok: false, message: "A break is already running." };
  }
  const now = new Date().toISOString();
  if (db.entries.some((entry) => entry.employeeId === employeeId && new Date(entry.endAt).getTime() > Date.now())) {
    return { ok: false, message: "Finish or adjust any work entry that extends past now before starting a break." };
  }
  const brk: BreakEntry = {
    id: `${employeeId}-break-${Date.now().toString(36)}`,
    employeeId,
    startAt: now,
    endAt: null,
    createdAt: now,
  };
  emit({ ...db, breaks: [...db.breaks, brk] });
  return { ok: true };
}

export function endBreak(breakId: string): MutationResult {
  const db = getDatabaseSnapshot();
  const brk = db.breaks.find((b) => b.id === breakId);
  if (!brk || brk.endAt !== null) return { ok: false, message: "No running break found." };
  const endAt = new Date().toISOString();
  emit({ ...db, breaks: db.breaks.map((b) => (b.id === breakId ? { ...b, endAt } : b)) });
  return { ok: true };
}
