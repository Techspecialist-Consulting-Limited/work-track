import { splitIntervalMinutes } from "./time";
import {
  validateDescription,
  validateEntryTimes,
  validateEvidenceLink,
  validateReason,
  validateTaskTitle,
  type ValidationResult,
} from "./validation";
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

/** Chains follow-up syncs (e.g. addEntry) behind a just-created task's insert. */
const pendingSyncs = new Map<string, Promise<unknown>>();

function queueAfter(taskId: string | undefined, send: () => void) {
  const prior = taskId ? pendingSyncs.get(taskId) : undefined;
  if (prior) void prior.then(send);
  else send();
}

const EMPTY_DB: WorkLogDatabase = { version: 1, employees: [], tasks: [], entries: [], breaks: [] };

const listeners = new Set<Listener>();
let cache: WorkLogDatabase | null = null;
let sessionEmployeeId: string | null = null;
let sessionUser: { name: string | null; email: string | null } | null = null;
let sessionRole: string | null = null;
let loadPromise: Promise<void> | null = null;
let hydrated = false;

interface StateResponse {
  db?: WorkLogDatabase;
  employeeId?: string | null;
  role?: string;
  user?: { name: string | null; email: string | null } | null;
  error?: string;
}

function isDatabase(value: unknown): value is WorkLogDatabase {
  if (!value || typeof value !== "object") return false;
  const db = value as Partial<WorkLogDatabase>;
  return db.version === 1 && Array.isArray(db.employees) && Array.isArray(db.tasks) && Array.isArray(db.entries) && Array.isArray(db.breaks);
}

function emit(db: WorkLogDatabase) {
  cache = db;
  listeners.forEach((listener) => listener());
}

function currentScope(): "me" | "team" {
  if (typeof window === "undefined") return "me";
  return window.location.pathname.startsWith("/executive") ? "team" : "me";
}

async function fetchState(): Promise<void> {
  const res = await fetch(`/api/worklog/state?scope=${currentScope()}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Failed to load work log.");
  const data = (await res.json()) as StateResponse;
  if (!data.db || !isDatabase(data.db)) throw new Error("Invalid work log response.");
  sessionEmployeeId = data.employeeId ?? null;
  sessionUser = data.user ?? null;
  sessionRole = data.role ?? null;
  hydrated = true;
  emit(data.db);
}

function ensureLoaded() {
  if (hydrated || loadPromise) return;
  loadPromise = fetchState()
    .catch(() => {
      // Leave cache empty; UI shows its empty state. Retry on next mutation.
      hydrated = false;
    })
    .finally(() => {
      loadPromise = null;
    });
}

/** Kick off the initial server load. Safe to call multiple times. */
export function primeWorkLog(): void {
  if (typeof window === "undefined") return;
  ensureLoaded();
}

export function getServerSnapshot(): WorkLogDatabase {
  return EMPTY_DB;
}

export function getDatabaseSnapshot(): WorkLogDatabase {
  if (typeof window !== "undefined") ensureLoaded();
  return cache ?? EMPTY_DB;
}

export function getSessionEmployeeId(): string | null {
  return sessionEmployeeId;
}

export function getSessionUser(): { name: string | null; email: string | null } | null {
  return sessionUser;
}

export function getSessionRole(): string | null {
  return sessionRole;
}

/** Saves the staff member's own profile (name/photo). Resolves with the server result. */
export async function saveProfile(input: {
  fullName?: string;
  avatarUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/worklog/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateProfile", payload: input, scope: currentScope() }),
    });
    const data = (await res.json()) as StateResponse & { ok?: boolean; message?: string };
    if (data.db && isDatabase(data.db)) emit(data.db);
    if (!res.ok || data.ok === false) {
      return { ok: false, message: data.message ?? "Could not save your profile." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

/** HR/Chairman: invite the chairman by email. Resolves with the server result. */
export function inviteChairman(email: string) {
  return syncAction("inviteChairman", { email });
}

export function subscribeToDatabase(listener: Listener): () => void {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function resetDatabase(): void {
  hydrated = false;
  cache = null;
  loadPromise = null;
  ensureLoaded();
}

async function syncAction(
  action: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; message?: string; taskId?: string; adjustedEntry?: boolean } | null> {
  try {
    const res = await fetch("/api/worklog/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload, scope: currentScope() }),
    });
    const data = (await res.json()) as StateResponse & {
      ok?: boolean;
      message?: string;
      taskId?: string;
      adjustedEntry?: boolean;
    };
    if (data.db && isDatabase(data.db)) emit(data.db);
    if (!res.ok || data.ok === false) {
      // Server rejected — resync from authoritative state.
      resetDatabase();
      return { ok: false, message: data.message ?? "Could not save. Try again." };
    }
    return { ok: true, taskId: data.taskId, adjustedEntry: data.adjustedEntry };
  } catch {
    resetDatabase();
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

export type MutationResult = { ok: true } | { ok: false; message: string };

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

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  const id = newId();
  const entry: WorkEntry = {
    id,
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
      }
    : task;
  emit({
    ...db,
    entries: [...db.entries, entry],
    tasks: updatedTask === task ? db.tasks : db.tasks.map((item) => item.id === task.id ? updatedTask : item),
  });
  queueAfter(input.taskId, () => void syncAction("addEntry", { id, input }));
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
  queueAfter(existing.taskId, () => void syncAction("editEntry", { entryId, input }));
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
  const taskId = newId();
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
  const sync = syncAction("createTask", { ...input, id: taskId });
  pendingSyncs.set(taskId, sync);
  void sync.finally(() => pendingSyncs.delete(taskId));
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
  };
  emit({ ...db, tasks: db.tasks.map((t) => (t.id === taskId ? updated : t)) });
  void syncAction("updateTaskStatus", { taskId, status, reason });
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
  void syncAction("setReview", { taskId, status, note });
  return { ok: true };
}

export function startBreak(employeeId: EmployeeId): MutationResult & { adjustedEntry?: boolean } {
  const db = getDatabaseSnapshot();
  if (db.breaks.some((b) => b.employeeId === employeeId && b.endAt === null)) {
    return { ok: false, message: "A break is already running." };
  }
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  let adjustedEntry = false;
  const entries = db.entries.map((entry) => {
    const startMs = new Date(entry.startAt).getTime();
    const endMs = new Date(entry.endAt).getTime();
    if (entry.employeeId !== employeeId || startMs > nowMs || endMs <= nowMs) return entry;
    adjustedEntry = true;
    const split = entry.isReportedOvertime
      ? { normalMinutes: 0, overtimeMinutes: Math.round((nowMs - startMs) / 60_000) }
      : splitIntervalMinutes(entry.startAt, now);
    return {
      ...entry,
      endAt: now,
      normalMinutes: split.normalMinutes,
      overtimeMinutes: split.overtimeMinutes,
      revisions: [
        ...entry.revisions,
        {
          revisedAt: now,
          previousDescription: entry.description,
          previousStartAt: entry.startAt,
          previousEndAt: entry.endAt,
          previousWorkLocation: entry.workLocation,
        },
      ],
    };
  });
  const id = newId();
  const brk: BreakEntry = {
    id,
    employeeId,
    startAt: now,
    endAt: null,
    createdAt: now,
  };
  emit({ ...db, entries, breaks: [...db.breaks, brk] });
  void syncAction("startBreak", { id });
  return { ok: true, adjustedEntry };
}

/** Voids the staff member's own work entry (soft delete — frees the slot). */
export function deleteWorkEntry(entryId: string): MutationResult {
  const db = getDatabaseSnapshot();
  if (!db.entries.some((e) => e.id === entryId)) {
    return { ok: false, message: "This entry no longer exists." };
  }
  emit({ ...db, entries: db.entries.filter((e) => e.id !== entryId) });
  void syncAction("voidEntry", { entryId });
  return { ok: true };
}

export function endBreak(breakId: string): MutationResult {
  const db = getDatabaseSnapshot();
  const brk = db.breaks.find((b) => b.id === breakId);
  if (!brk || brk.endAt !== null) return { ok: false, message: "No running break found." };
  const endAt = new Date().toISOString();
  emit({ ...db, breaks: db.breaks.map((b) => (b.id === breakId ? { ...b, endAt } : b)) });
  void syncAction("endBreak", { breakId });
  return { ok: true };
}
