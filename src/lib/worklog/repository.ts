import { splitIntervalMinutes } from "./time";
import {
  resolveBreakEnd,
  validateBreakStart,
  validateDescription,
  validateEntryTimes,
  validateEvidenceLink,
  validateProgressBody,
  validateReason,
  validateSubtaskTitle,
  validateTaskTitle,
  type ValidationResult,
} from "./validation";
import { checkParentCanBeDone, checkSubtaskStatusChange, nextCompletedAt } from "./status-rules";
import { isSelectableForEntry } from "./client-catalogue";
import type {
  BreakEntry,
  EmployeeId,
  ManagementReviewStatus,
  ProgressUpdate,
  Subtask,
  Task,
  TaskCategory,
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

const EMPTY_DB: WorkLogDatabase = {
  version: 2,
  employees: [],
  organisations: [],
  clientCategories: [],
  clientSubcategories: [],
  teams: [],
  employeeTeams: [],
  projects: [],
  categories: [],
  tasks: [],
  subtasks: [],
  progressUpdates: [],
  entries: [],
  breaks: [],
  statusHistory: [],
};

const listeners = new Set<Listener>();
let cache: WorkLogDatabase | null = null;
let sessionEmployeeId: string | null = null;
let sessionUser: { name: string | null; email: string | null } | null = null;
let sessionRole: string | null = null;
let sessionIsConfigAdmin = false;
let sessionActiveTeamId: string | null = null;
let loadPromise: Promise<void> | null = null;
let hydrated = false;

interface StateResponse {
  db?: WorkLogDatabase;
  employeeId?: string | null;
  role?: string;
  isConfigAdmin?: boolean;
  activeTeamId?: string | null;
  user?: { name: string | null; email: string | null } | null;
  error?: string;
}

function isDatabase(value: unknown): value is WorkLogDatabase {
  if (!value || typeof value !== "object") return false;
  const db = value as Partial<WorkLogDatabase>;
  return (
    db.version === 2 &&
    Array.isArray(db.employees) &&
    Array.isArray(db.organisations) &&
    Array.isArray(db.clientCategories) &&
    Array.isArray(db.clientSubcategories) &&
    Array.isArray(db.teams) &&
    Array.isArray(db.employeeTeams) &&
    Array.isArray(db.projects) &&
    Array.isArray(db.tasks) &&
    Array.isArray(db.subtasks) &&
    Array.isArray(db.progressUpdates) &&
    Array.isArray(db.entries) &&
    Array.isArray(db.breaks)
  );
}

function emit(db: WorkLogDatabase) {
  cache = db;
  listeners.forEach((listener) => listener());
}

function currentScope(): "me" | "team" | "config" {
  if (typeof window === "undefined") return "me";
  if (window.location.pathname.startsWith("/admin")) return "config";
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
  sessionIsConfigAdmin = Boolean(data.isConfigAdmin);
  sessionActiveTeamId = data.activeTeamId ?? null;
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

export function getSessionIsConfigAdmin(): boolean {
  return sessionIsConfigAdmin;
}

export function getSessionActiveTeamId(): string | null {
  return sessionActiveTeamId;
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

interface SyncResponse {
  ok: boolean;
  message?: string;
  taskId?: string;
  subtaskId?: string;
  progressUpdateId?: string;
  adjustedEntry?: boolean;
  teamId?: string;
  projectId?: string;
  duplicateProjectId?: string;
  duplicateProjectName?: string;
  organisationId?: string;
  clientCategoryId?: string;
  clientSubcategoryId?: string;
}

async function syncAction(action: string, payload: Record<string, unknown>): Promise<SyncResponse | null> {
  try {
    const res = await fetch("/api/worklog/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload, scope: currentScope() }),
    });
    const data = (await res.json()) as StateResponse & SyncResponse;
    if (data.db && isDatabase(data.db)) emit(data.db);
    if (!res.ok || data.ok === false) {
      // Server rejected — resync from authoritative state.
      resetDatabase();
      return { ok: false, message: data.message ?? "Could not save. Try again." };
    }
    return data;
  } catch {
    resetDatabase();
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

export type MutationResult = { ok: true } | { ok: false; message: string };

export interface EntryInput {
  employeeId: EmployeeId;
  /** In-house entries are task-linked; client-site entries omit taskId and carry the client pair. */
  taskId?: string;
  /** Optional subtask that belongs to the selected task. */
  subtaskId?: string | null;
  clientCategoryId?: string;
  clientSubcategoryId?: string;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: WorkLocation;
  evidenceLink?: string;
  isReportedOvertime?: boolean;
}

export interface TaskInput {
  employeeId: EmployeeId;
  title?: string;
  description?: string;
  teamId?: string;
  projectId?: string;
  subtasks?: { title: string; description?: string }[];
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function splitFor(input: Pick<EntryInput, "startAt" | "endAt" | "isReportedOvertime">) {
  return input.isReportedOvertime
    ? {
        normalMinutes: 0,
        overtimeMinutes: Math.round(
          (new Date(input.endAt).getTime() - new Date(input.startAt).getTime()) / 60_000
        ),
      }
    : splitIntervalMinutes(input.startAt, input.endAt);
}

function checkEntryInput(db: WorkLogDatabase, input: EntryInput, ignoreId?: string): ValidationResult {
  const description = validateDescription(input.description);
  if (!description.ok) return description;
  const link = validateEvidenceLink(input.evidenceLink);
  if (!link.ok) return link;
  return validateEntryTimes(db, input.employeeId, input.startAt, input.endAt, ignoreId);
}

function subtaskBelongsTo(db: WorkLogDatabase, taskId: string, subtaskId?: string | null): ValidationResult {
  if (!subtaskId) return { ok: true };
  const subtask = db.subtasks.find((item) => item.id === subtaskId);
  if (!subtask || subtask.taskId !== taskId) {
    return { ok: false, message: "That subtask does not belong to the selected task." };
  }
  return { ok: true };
}

/**
 * Client-site entries reference the employee's assigned client catalogue.
 * The pair must belong together, belong to that client, and be selectable
 * (approved+active, or the employee's own pending suggestion).
 */
function clientPairCheck(
  db: WorkLogDatabase,
  employeeId: string,
  input: EntryInput,
  /** Edits are scoped to the entry's original client, which may differ from the current assignment. */
  allowedClientOrgId?: string
): { ok: true; categoryId: string; subcategoryId: string } | { ok: false; message: string } {
  const fail = { ok: false as const, message: "Choose a category and subcategory from your client's list." };
  if (!input.clientCategoryId || !input.clientSubcategoryId) return fail;
  const employee = db.employees.find((item) => item.id === employeeId);
  if (!employee) return { ok: false, message: "Your account is not assigned to a client." };
  const orgId =
    allowedClientOrgId ??
    (employee.workArrangement === "client_site" ? employee.clientOrganisationId : undefined);
  if (!orgId) {
    return { ok: false, message: "Your account is not assigned to a client." };
  }
  const category = db.clientCategories.find((item) => item.id === input.clientCategoryId);
  const subcategory = db.clientSubcategories.find((item) => item.id === input.clientSubcategoryId);
  if (
    !category ||
    !subcategory ||
    category.clientOrganisationId !== orgId ||
    subcategory.clientOrganisationId !== orgId ||
    subcategory.categoryId !== category.id ||
    !isSelectableForEntry(category, employeeId) ||
    !isSelectableForEntry(subcategory, employeeId)
  ) {
    return fail;
  }
  return { ok: true, categoryId: category.id, subcategoryId: subcategory.id };
}

export function addWorkEntry(input: EntryInput): MutationResult {
  const db = getDatabaseSnapshot();
  const check = checkEntryInput(db, input);
  if (!check.ok) return check;
  const isClientEntry = Boolean(input.clientCategoryId || input.clientSubcategoryId);
  let task: Task | undefined;
  let clientPair: { categoryId: string; subcategoryId: string } | undefined;
  if (isClientEntry) {
    const pair = clientPairCheck(db, input.employeeId, input);
    if (!pair.ok) return pair;
    clientPair = pair;
    if (input.taskId || input.subtaskId) {
      return { ok: false, message: "Client-site entries cannot be linked to a task." };
    }
  } else {
    if (!input.taskId) return { ok: false, message: "Choose a task first." };
    task = db.tasks.find((t) => t.id === input.taskId && t.employeeId === input.employeeId);
    if (!task) return { ok: false, message: "Choose a task first." };
    if (task.currentStatus === "done" || task.currentStatus === "dropped") {
      return { ok: false, message: "This task is closed. Start a new task or continue an open one." };
    }
    const belongs = subtaskBelongsTo(db, task.id, input.subtaskId);
    if (!belongs.ok) return belongs;
  }

  const split = splitFor(input);
  const id = newId();
  const entry: WorkEntry = {
    id,
    employeeId: input.employeeId,
    taskId: task?.id,
    subtaskId: input.subtaskId?.trim() || undefined,
    clientCategoryId: clientPair?.categoryId,
    clientSubcategoryId: clientPair?.subcategoryId,
    description: input.description.trim(),
    startAt: input.startAt,
    endAt: input.endAt,
    workLocation: input.workLocation,
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    isReportedOvertime: Boolean(input.isReportedOvertime),
    evidenceLink: input.evidenceLink?.trim() || undefined,
    createdAt: new Date().toISOString(),
    revisions: [],
  };
  emit({ ...db, entries: [...db.entries, entry] });
  queueAfter(task?.id, () => void syncAction("addEntry", { id, input }));
  return { ok: true };
}

export function editWorkEntry(entryId: string, input: EntryInput): MutationResult {
  const db = getDatabaseSnapshot();
  const existing = db.entries.find((e) => e.id === entryId);
  if (!existing) return { ok: false, message: "This entry no longer exists." };
  const check = checkEntryInput(db, input, entryId);
  if (!check.ok) return check;
  const isClientEntry = Boolean(input.clientCategoryId || input.clientSubcategoryId);
  const wasClientEntry = Boolean(existing.clientCategoryId || existing.clientSubcategoryId);
  if (isClientEntry !== wasClientEntry) {
    return { ok: false, message: "This entry cannot switch between task and client-site reporting." };
  }
  let task: Task | undefined;
  let clientPair: { categoryId: string; subcategoryId: string } | undefined;
  if (isClientEntry) {
    // Edits stay within the entry's original client organisation, even if the
    // employee has since been reassigned — the client can never be switched
    // through the entry-editing interface.
    const existingOrgId = existing.clientCategoryId
      ? db.clientCategories.find((row) => row.id === existing.clientCategoryId)?.clientOrganisationId
      : existing.clientSubcategoryId
        ? db.clientSubcategories.find((row) => row.id === existing.clientSubcategoryId)?.clientOrganisationId
        : undefined;
    const pair = existingOrgId
      ? clientPairCheck(db, input.employeeId, input, existingOrgId)
      : ({ ok: false, message: "Choose a category and subcategory from your client's list." } as const);
    if (!pair.ok) {
      // Editing may keep the entry's existing pair even when it is no longer
      // selectable for new entries (e.g. a since-rejected suggestion) — the
      // historical reference is preserved rather than silently replaced.
      const keepExisting =
        input.clientCategoryId === existing.clientCategoryId &&
        input.clientSubcategoryId === existing.clientSubcategoryId &&
        existing.clientCategoryId &&
        existing.clientSubcategoryId;
      if (!keepExisting || !existing.clientCategoryId || !existing.clientSubcategoryId) return pair;
      clientPair = { categoryId: existing.clientCategoryId, subcategoryId: existing.clientSubcategoryId };
    } else {
      clientPair = pair;
    }
    if (input.taskId || input.subtaskId) {
      return { ok: false, message: "Client-site entries cannot be linked to a task." };
    }
  } else {
    if (!input.taskId) return { ok: false, message: "Choose a task that belongs to you." };
    task = db.tasks.find((t) => t.id === input.taskId && t.employeeId === input.employeeId);
    if (!task) return { ok: false, message: "Choose a task that belongs to you." };
    // Corrections keep an entry on its closed task, but never move it to another closed task.
    if ((task.currentStatus === "done" || task.currentStatus === "dropped") && existing.taskId !== task.id) {
      return { ok: false, message: "This task is closed. Reopen it or choose an open task." };
    }
    const belongs = subtaskBelongsTo(db, task.id, input.subtaskId);
    if (!belongs.ok) return belongs;
  }

  const split = splitFor(input);
  const updated: WorkEntry = {
    ...existing,
    taskId: task?.id,
    subtaskId: isClientEntry ? undefined : input.subtaskId?.trim() || undefined,
    clientCategoryId: clientPair?.categoryId,
    clientSubcategoryId: clientPair?.subcategoryId,
    description: input.description.trim(),
    startAt: input.startAt,
    endAt: input.endAt,
    workLocation: input.workLocation,
    evidenceLink: input.evidenceLink?.trim() || undefined,
    isReportedOvertime: Boolean(input.isReportedOvertime),
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    updatedAt: new Date().toISOString(),
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

export function createTask(input: TaskInput): { ok: true; taskId: string } | { ok: false; message: string } {
  const db = getDatabaseSnapshot();
  const project = input.projectId
    ? db.projects.find((candidate) => candidate.id === input.projectId)
    : undefined;

  let title: string;
  if (input.projectId) {
    if (!project || project.archivedAt || !project.isActive) {
      return { ok: false, message: "Choose an active project from your team." };
    }
    title = project.name;
    const existing = db.tasks.find(
      (task) => task.employeeId === input.employeeId && task.projectId === project.id && !task.archivedAt
    );
    if (existing) return { ok: true, taskId: existing.id };
  } else {
    const check = validateTaskTitle(input.title ?? "");
    if (!check.ok) return check;
    title = input.title!.trim();
  }

  const now = new Date().toISOString();
  const taskId = newId();
  const task: Task = {
    id: taskId,
    employeeId: input.employeeId,
    title,
    description: input.description?.trim() || undefined,
    teamId: project?.teamId ?? input.teamId,
    projectId: project?.id,
    currentStatus: "ongoing",
    createdAt: now,
    updatedAt: now,
    statusUpdatedAt: now,
  };

  const subtaskRows: Subtask[] = [];
  const requestedSubtasks = (input.subtasks ?? []).filter((subtask) => subtask.title.trim());
  for (let index = 0; index < requestedSubtasks.length; index += 1) {
    const requested = requestedSubtasks[index];
    const titleCheck = validateSubtaskTitle(requested.title);
    if (!titleCheck.ok) return titleCheck;
    subtaskRows.push({
      id: newId(),
      taskId,
      title: requested.title.trim(),
      description: requested.description?.trim() || undefined,
      status: "ongoing",
      displayOrder: index,
      createdAt: now,
      updatedAt: now,
      statusUpdatedAt: now,
    });
  }

  emit({
    ...db,
    tasks: [...db.tasks, task],
    subtasks: [...db.subtasks, ...subtaskRows],
  });
  const sync = syncAction("createTask", {
    employeeId: input.employeeId,
    title,
    description: input.description,
    teamId: task.teamId,
    projectId: task.projectId,
    id: taskId,
    subtasks: requestedSubtasks.map((subtask, index) => ({ ...subtask, id: subtaskRows[index].id })),
  });
  pendingSyncs.set(taskId, sync);
  void sync.finally(() => pendingSyncs.delete(taskId));
  return { ok: true, taskId };
}

export function updateTask(input: {
  taskId: string;
  title: string;
  description?: string;
  categoryId?: string | null;
}): MutationResult {
  const check = validateTaskTitle(input.title);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  const categoryId = input.categoryId?.trim() || undefined;
  emit({
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === input.taskId
        ? {
            ...t,
            title: input.title.trim(),
            description: input.description?.trim() || undefined,
            categoryId,
            categoryName: categoryId
              ? db.categories.find((category) => category.id === categoryId)?.name
              : undefined,
            updatedAt: new Date().toISOString(),
          }
        : t
    ),
  });
  void syncAction("updateTask", { ...input, categoryId: categoryId ?? null });
  return { ok: true };
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  reason?: string,
  note?: string
): MutationResult {
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus === status) return { ok: true };
  if (status === "blocked" || status === "dropped") {
    const check = validateReason(reason, status === "blocked" ? "being blocked" : "dropping this task");
    if (!check.ok) return check;
  }
  if (status === "done") {
    const check = checkParentCanBeDone(db.subtasks.filter((subtask) => subtask.taskId === taskId));
    if (!check.ok) return check;
  }
  const now = new Date().toISOString();
  const updated: Task = {
    ...task,
    currentStatus: status,
    blockerReason: status === "blocked" ? reason?.trim() : undefined,
    droppedReason: status === "dropped" ? reason?.trim() : undefined,
    completedAt: nextCompletedAt(status, now),
    statusUpdatedAt: now,
    updatedAt: now,
  };
  emit({ ...db, tasks: db.tasks.map((t) => (t.id === taskId ? updated : t)) });
  void syncAction("updateTaskStatus", { taskId, status, reason, note: note ?? reason });
  return { ok: true };
}

export function createSubtask(input: { taskId: string; title: string; description?: string }): MutationResult {
  const check = validateSubtaskTitle(input.title);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus === "done" || task.currentStatus === "dropped") {
    return { ok: false, message: "Reopen the main task before adding a subtask." };
  }
  const now = new Date().toISOString();
  const siblings = db.subtasks.filter((subtask) => subtask.taskId === input.taskId);
  const displayOrder = siblings.length
    ? Math.max(...siblings.map((subtask) => subtask.displayOrder)) + 1
    : 0;
  const id = newId();
  const subtask: Subtask = {
    id,
    taskId: input.taskId,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    status: "ongoing",
    displayOrder,
    createdAt: now,
    updatedAt: now,
    statusUpdatedAt: now,
  };
  emit({ ...db, subtasks: [...db.subtasks, subtask] });
  const sync = syncAction("createSubtask", { ...input, id });
  pendingSyncs.set(input.taskId, sync);
  void sync.finally(() => pendingSyncs.delete(input.taskId));
  return { ok: true };
}

export function updateSubtask(input: {
  subtaskId: string;
  title: string;
  description?: string;
}): MutationResult {
  const check = validateSubtaskTitle(input.title);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const subtask = db.subtasks.find((item) => item.id === input.subtaskId);
  if (!subtask) return { ok: false, message: "Subtask not found." };
  emit({
    ...db,
    subtasks: db.subtasks.map((item) =>
      item.id === input.subtaskId
        ? {
            ...item,
            title: input.title.trim(),
            description: input.description?.trim() || undefined,
            updatedAt: new Date().toISOString(),
          }
        : item
    ),
  });
  void syncAction("updateSubtask", input);
  return { ok: true };
}

export function updateSubtaskStatus(
  subtaskId: string,
  status: TaskStatus,
  reason?: string
): MutationResult {
  const db = getDatabaseSnapshot();
  const subtask = db.subtasks.find((item) => item.id === subtaskId);
  if (!subtask) return { ok: false, message: "Subtask not found." };
  const task = db.tasks.find((item) => item.id === subtask.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (subtask.status === status) return { ok: true };
  const allowed = checkSubtaskStatusChange(task, subtask, status);
  if (!allowed.ok) return allowed;
  if (status === "blocked" || status === "dropped") {
    const check = validateReason(
      reason,
      status === "blocked" ? "blocking this subtask" : "dropping this subtask"
    );
    if (!check.ok) return check;
  }
  const now = new Date().toISOString();
  emit({
    ...db,
    subtasks: db.subtasks.map((item) =>
      item.id === subtaskId
        ? {
            ...item,
            status,
            completedAt: nextCompletedAt(status, now),
            statusUpdatedAt: now,
            updatedAt: now,
          }
        : item
    ),
  });
  void syncAction("updateSubtaskStatus", { subtaskId, status, reason });
  return { ok: true };
}

export function addProgressUpdate(input: {
  taskId: string;
  subtaskId?: string | null;
  body: string;
}): MutationResult {
  const check = validateProgressBody(input.body);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const task = db.tasks.find((t) => t.id === input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  const belongs = subtaskBelongsTo(db, task.id, input.subtaskId);
  if (!belongs.ok) return belongs;
  const employeeId = sessionEmployeeId;
  if (!employeeId) return { ok: false, message: "No employee record linked." };
  const now = new Date().toISOString();
  const id = newId();
  const update: ProgressUpdate = {
    id,
    taskId: input.taskId,
    subtaskId: input.subtaskId?.trim() || undefined,
    authorEmployeeId: employeeId,
    authorName: sessionUser?.name ?? undefined,
    body: input.body.trim(),
    createdAt: now,
    updatedAt: now,
    revisions: [],
  };
  emit({ ...db, progressUpdates: [...db.progressUpdates, update] });
  void syncAction("addProgressUpdate", { ...input, id });
  return { ok: true };
}

export function editProgressUpdate(input: {
  progressUpdateId: string;
  body: string;
  revisionReason?: string;
}): MutationResult {
  const check = validateProgressBody(input.body);
  if (!check.ok) return check;
  const db = getDatabaseSnapshot();
  const update = db.progressUpdates.find((item) => item.id === input.progressUpdateId);
  if (!update) return { ok: false, message: "Progress update not found." };
  const nextBody = input.body.trim();
  if (nextBody === update.body) return { ok: true };
  const now = new Date().toISOString();
  emit({
    ...db,
    progressUpdates: db.progressUpdates.map((item) =>
      item.id === input.progressUpdateId
        ? {
            ...item,
            body: nextBody,
            editedAt: now,
            editedByName: sessionUser?.name ?? undefined,
            updatedAt: now,
            revisions: [
              ...item.revisions,
              {
                id: newId(),
                progressUpdateId: item.id,
                previousBody: item.body,
                revisedByName: sessionUser?.name ?? undefined,
                revisedAt: now,
                revisionReason: input.revisionReason?.trim() || undefined,
              },
            ],
          }
        : item
    ),
  });
  void syncAction("editProgressUpdate", input);
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
  if (task.currentStatus !== "done") return { ok: false, message: "Only Done tasks can be reviewed." };
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
  const nowDate = new Date();
  const check = validateBreakStart(
    db.breaks,
    db.entries.filter((entry) => entry.employeeId === employeeId),
    employeeId,
    nowDate
  );
  if (!check.ok) return check;
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
      updatedAt: now,
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
  const endAt = resolveBreakEnd(db.breaks, brk, new Date()).toISOString();
  emit({
    ...db,
    breaks: db.breaks.map((b) => (b.id === breakId ? { ...b, endAt, updatedAt: endAt } : b)),
  });
  void syncAction("endBreak", { breakId });
  return { ok: true };
}

/** Correct a break's start/end. Breaks never carry a task or subtask. */
export function updateBreak(input: {
  breakId: string;
  startAt: string;
  endAt?: string | null;
}): MutationResult {
  const db = getDatabaseSnapshot();
  const brk = db.breaks.find((b) => b.id === input.breakId);
  if (!brk) return { ok: false, message: "Break not found." };
  const start = new Date(input.startAt);
  const end = input.endAt ? new Date(input.endAt) : null;
  if (Number.isNaN(start.getTime())) return { ok: false, message: "Enter a valid break start time." };
  if (end && (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime())) {
    return { ok: false, message: "Break end must be after break start." };
  }
  const rangeEnd = end ? end.getTime() : Number.POSITIVE_INFINITY;
  const clash = db.entries.find(
    (entry) =>
      entry.employeeId === brk.employeeId &&
      start.getTime() < new Date(entry.endAt).getTime() &&
      new Date(entry.startAt).getTime() < rangeEnd
  );
  if (clash) {
    return { ok: false, message: "This break overlaps a work entry. Adjust the time." };
  }
  const breakClash = db.breaks.find(
    (other) =>
      other.id !== brk.id &&
      other.employeeId === brk.employeeId &&
      start.getTime() <
        (other.endAt ? new Date(other.endAt).getTime() : Number.POSITIVE_INFINITY) &&
      new Date(other.startAt).getTime() < rangeEnd
  );
  if (breakClash) {
    return { ok: false, message: "This break overlaps another break. Adjust the time." };
  }
  emit({
    ...db,
    breaks: db.breaks.map((b) =>
      b.id === input.breakId
        ? { ...b, startAt: start.toISOString(), endAt: end?.toISOString() ?? null, updatedAt: new Date().toISOString() }
        : b
    ),
  });
  void syncAction("updateBreak", input);
  return { ok: true };
}

/** Staff select one of their assigned teams for logging. */
export function selectTeam(teamId: string): MutationResult {
  sessionActiveTeamId = teamId;
  void syncAction("selectTeam", { teamId });
  return { ok: true };
}

export function createStaffProject(input: {
  teamId: string;
  name: string;
  description?: string;
}): Promise<SyncResponse | null> {
  return syncAction("createStaffProject", { id: newId(), ...input });
}

export function createTeam(input: { name: string; description?: string }): Promise<SyncResponse | null> {
  return syncAction("createTeam", { id: newId(), ...input });
}

export function updateTeam(input: {
  teamId: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("updateTeam", input);
}

export function assignEmployeeTeam(input: {
  employeeId: string;
  teamId: string;
  assigned: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("assignEmployeeTeam", input);
}

export function createTeamProject(input: {
  teamId: string;
  name: string;
  description?: string;
}): Promise<SyncResponse | null> {
  return syncAction("createTeamProject", { id: newId(), ...input });
}

export function updateTeamProject(input: {
  projectId: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("updateTeamProject", input);
}

export function archiveTeamProject(projectId: string, archived: boolean): Promise<SyncResponse | null> {
  return syncAction("archiveTeamProject", { projectId, archived });
}

export function promoteTeamProject(projectId: string): Promise<SyncResponse | null> {
  return syncAction("promoteTeamProject", { projectId });
}

/* ------------------- client-site reporting configuration ------------------- */

export function createClientOrganisation(input: {
  name: string;
  description?: string;
}): Promise<SyncResponse | null> {
  return syncAction("createClientOrganisation", { id: newId(), ...input });
}

export function updateOrganisation(input: {
  organisationId: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("updateOrganisation", input);
}

export function assignEmployeeClient(input: {
  employeeId: string;
  workArrangement: "in_house" | "client_site";
  clientOrganisationId?: string | null;
}): Promise<SyncResponse | null> {
  return syncAction("assignEmployeeClient", input);
}

export function createClientCategory(input: {
  clientOrganisationId: string;
  name: string;
}): Promise<SyncResponse | null> {
  return syncAction("createClientCategory", { id: newId(), ...input });
}

export function updateClientCategory(input: {
  categoryId: string;
  name?: string;
  isActive?: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("updateClientCategory", input);
}

export function createClientSubcategory(input: {
  categoryId: string;
  name: string;
}): Promise<SyncResponse | null> {
  return syncAction("createClientSubcategory", { id: newId(), ...input });
}

export function updateClientSubcategory(input: {
  subcategoryId: string;
  name?: string;
  isActive?: boolean;
}): Promise<SyncResponse | null> {
  return syncAction("updateClientSubcategory", input);
}

export function reviewClientSuggestion(input: {
  itemKind: "category" | "subcategory";
  id: string;
  decision: "approve" | "reject";
  name?: string;
  note?: string;
}): Promise<SyncResponse | null> {
  return syncAction("reviewClientSuggestion", input);
}

/** Staff-facing suggestions (used by the client-site form in Phase 4). */
export function suggestClientCategory(name: string): Promise<SyncResponse | null> {
  return syncAction("suggestClientCategory", { id: newId(), name });
}

export function suggestClientSubcategory(input: {
  categoryId: string;
  name: string;
}): Promise<SyncResponse | null> {
  return syncAction("suggestClientSubcategory", { id: newId(), ...input });
}

/** Convenience for pickers: active categories from the snapshot. */
export function getCategories(db: WorkLogDatabase): TaskCategory[] {
  return db.categories;
}

// Refresh the snapshot when the tab regains focus so other sessions'
// changes (e.g. a new profile photo) appear without a manual reload.
if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && hydrated) {
      void fetchState().catch(() => {});
    }
  });
}
