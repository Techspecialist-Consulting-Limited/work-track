import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { auditEvents, employees, invitations, tasks, taskStatusHistory, timeEntries } from "./schema";
import { loadWorkLogDb } from "./worklog-data";
import type { WorkTrackMembership } from "@/lib/auth/authorize";
import { validateDescription, validateReason } from "@/lib/worklog/validation";
import { WORKLOG_RULES } from "@/lib/worklog/config";
import { splitIntervalMinutes } from "@/lib/worklog/time";
import type { TaskStatus, WorkLogDatabase } from "@/lib/worklog/types";

export type ActionResult =
  | { ok: true; taskId?: string; adjustedEntry?: boolean }
  | { ok: false; message: string };

interface EntryInput {
  employeeId: string;
  taskId: string;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: "office" | "home";
  evidenceLink?: string;
  isReportedOvertime?: boolean;
  statusAfterEntry?: TaskStatus;
  statusReason?: string;
}

function minutesBetween(startAt: string, endAt: string): number {
  return Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
}

function splitFor(input: { startAt: string; endAt: string; isReportedOvertime?: boolean }) {
  if (input.isReportedOvertime) {
    return { normalMinutes: 0, overtimeMinutes: minutesBetween(input.startAt, input.endAt) };
  }
  return splitIntervalMinutes(input.startAt, input.endAt);
}

async function audit(
  membership: WorkTrackMembership,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValues: unknown,
  newValues: unknown
) {
  await db.insert(auditEvents).values({
    actorMembershipId: membership.membershipId,
    action,
    entityType,
    entityId,
    oldValues: oldValues == null ? null : JSON.parse(JSON.stringify(oldValues)),
    newValues: newValues == null ? null : JSON.parse(JSON.stringify(newValues)),
  });
}

/** Staff and HR members with a linked employee can log their own work. Chairman cannot. */
function staffEmployeeId(membership: WorkTrackMembership): string {
  if (membership.role === "chairman" || !membership.employeeId) {
    throw new Error("FORBIDDEN");
  }
  return membership.employeeId;
}

/** Snapshot for reconciliation — "team" scope is management-only. */
export async function snapshotFor(
  membership: WorkTrackMembership,
  scope?: string
): Promise<WorkLogDatabase> {
  const isManagement = membership.role === "hr" || membership.role === "chairman";
  if (scope === "team" && isManagement) return loadWorkLogDb();
  return membership.employeeId ? loadWorkLogDb({ employeeId: membership.employeeId }) : loadWorkLogDb();
}

export async function addWorkEntryAction(
  membership: WorkTrackMembership,
  input: EntryInput & { id: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (input.employeeId !== employeeId) return { ok: false, message: "You can only log your own work." };
  const desc = validateDescription(input.description);
  if (!desc.ok) return desc;

  const task = (
    await db.select().from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.employeeId, employeeId))).limit(1)
  )[0];
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

  const split = splitFor(input);
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(timeEntries).values({
        id: input.id,
        employeeId,
        entryType: "work",
        taskId: task.id,
        description: input.description.trim(),
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        durationMinutes: minutesBetween(input.startAt, input.endAt),
        normalMinutes: split.normalMinutes,
        overtimeMinutes: split.overtimeMinutes,
        workLocation: input.workLocation,
        workType: split.overtimeMinutes >= minutesBetween(input.startAt, input.endAt) ? "overtime" : "normal",
        taskStatusSnapshot: input.statusAfterEntry ?? task.currentStatus,
        evidenceLink: input.evidenceLink?.trim() || null,
        isReportedOvertime: Boolean(input.isReportedOvertime),
        createdByMembershipId: membership.membershipId,
      });

      if (input.statusAfterEntry && input.statusAfterEntry !== task.currentStatus) {
        const next = input.statusAfterEntry;
        await tx
          .update(tasks)
          .set({
            currentStatus: next,
            blockerReason: next === "blocked" ? input.statusReason?.trim() : null,
            droppedReason: next === "dropped" ? input.statusReason?.trim() : null,
            completedAt: next === "completed" ? task.completedAt ?? now : null,
            updatedAt: now,
          })
          .where(eq(tasks.id, task.id));
        await tx.insert(taskStatusHistory).values({
          taskId: task.id,
          previousStatus: task.currentStatus,
          newStatus: next,
          changedByMembershipId: membership.membershipId,
          changeNote: input.statusReason?.trim() || null,
        });
      }
      await audit(membership, "entry.create", "time_entry", input.id, null, {
        employeeId,
        taskId: task.id,
        startAt: input.startAt,
        endAt: input.endAt,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("time_entries_no_overlap") || msg.includes("23P01")) {
      return { ok: false, message: "This overlaps an existing entry. Adjust the time and try again." };
    }
    throw e;
  }
  return { ok: true };
}

export async function editWorkEntryAction(
  membership: WorkTrackMembership,
  entryId: string,
  input: EntryInput
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (input.employeeId !== employeeId) return { ok: false, message: "You can only edit your own work." };
  const desc = validateDescription(input.description);
  if (!desc.ok) return desc;

  const existing = (
    await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.employeeId, employeeId), eq(timeEntries.entryType, "work"), isNull(timeEntries.voidedAt)))
      .limit(1)
  )[0];
  if (!existing) return { ok: false, message: "This entry no longer exists." };

  const task = (
    await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.employeeId, employeeId))).limit(1)
  )[0];
  if (!task) return { ok: false, message: "Choose a task that belongs to you." };

  const split = splitFor(input);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(timeEntries)
        .set({
          taskId: input.taskId,
          description: input.description.trim(),
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          durationMinutes: minutesBetween(input.startAt, input.endAt),
          normalMinutes: split.normalMinutes,
          overtimeMinutes: split.overtimeMinutes,
          workLocation: input.workLocation,
          workType: split.overtimeMinutes >= minutesBetween(input.startAt, input.endAt) ? "overtime" : "normal",
          evidenceLink: input.evidenceLink?.trim() || null,
          isReportedOvertime: Boolean(input.isReportedOvertime),
          revisionCount: sql`${timeEntries.revisionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, entryId));
      await audit(membership, "entry.update", "time_entry", entryId, null, {
        startAt: input.startAt,
        endAt: input.endAt,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("time_entries_no_overlap") || msg.includes("23P01")) {
      return { ok: false, message: "This overlaps an existing entry. Adjust the time and try again." };
    }
    throw e;
  }
  return { ok: true };
}

/** Staff void their own work entry so the slot frees up and they can re-enter. */
export async function voidWorkEntryAction(
  membership: WorkTrackMembership,
  entryId: string
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const entry = (
    await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, entryId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.entryType, "work"),
          isNull(timeEntries.voidedAt)
        )
      )
      .limit(1)
  )[0];
  if (!entry) return { ok: false, message: "This entry no longer exists." };

  await db
    .update(timeEntries)
    .set({ voidedAt: new Date(), voidReason: "Deleted by staff", updatedAt: new Date() })
    .where(eq(timeEntries.id, entryId));
  await audit(membership, "entry.void", "time_entry", entryId, null, {
    startAt: entry.startAt.toISOString(),
    endAt: entry.endAt?.toISOString() ?? null,
  });
  return { ok: true };
}

export async function createTaskAction(
  membership: WorkTrackMembership,
  input: { employeeId: string; title: string; id: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (input.employeeId !== employeeId) return { ok: false, message: "You can only create your own tasks." };
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the task a short title." };
  if (title.length > WORKLOG_RULES.taskTitleMaxLength) {
    return { ok: false, message: `Keep the task title under ${WORKLOG_RULES.taskTitleMaxLength} characters.` };
  }
  await db.insert(tasks).values({
    id: input.id,
    employeeId,
    title,
    currentStatus: "ongoing",
  });
  await audit(membership, "task.create", "task", input.id, null, { title });
  return { ok: true, taskId: input.id };
}

export async function updateTaskStatusAction(
  membership: WorkTrackMembership,
  taskId: string,
  status: TaskStatus,
  reason?: string
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const task = (
    await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.employeeId, employeeId))).limit(1)
  )[0];
  if (!task) return { ok: false, message: "Task not found." };
  if (status === "blocked" || status === "dropped") {
    const check = validateReason(reason, status === "blocked" ? "being blocked" : "dropping this task");
    if (!check.ok) return check;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        currentStatus: status,
        blockerReason: status === "blocked" ? reason?.trim() : null,
        droppedReason: status === "dropped" ? reason?.trim() : null,
        completedAt: status === "completed" ? task.completedAt ?? now : task.completedAt,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId));
    await tx.insert(taskStatusHistory).values({
      taskId,
      previousStatus: task.currentStatus,
      newStatus: status,
      changedByMembershipId: membership.membershipId,
      changeNote: reason?.trim() || null,
    });
    await audit(membership, "task.status", "task", taskId, { status: task.currentStatus }, { status });
  });
  return { ok: true };
}

export async function setManagementReviewAction(
  membership: WorkTrackMembership,
  taskId: string,
  status: "accepted" | "needs_changes",
  note?: string
): Promise<ActionResult> {
  if (membership.role !== "hr" && membership.role !== "chairman") {
    return { ok: false, message: "Management access required." };
  }
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0];
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus !== "completed") {
    return { ok: false, message: "Only completed tasks can be reviewed." };
  }
  if (status === "needs_changes") {
    const check = validateReason(note, "requesting changes");
    if (!check.ok) return check;
  }
  await db
    .update(tasks)
    .set({
      managementReview: {
        status,
        note: note?.trim() || undefined,
        reviewedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  await audit(membership, "task.review", "task", taskId, null, { status, note });
  return { ok: true };
}

export async function startBreakAction(
  membership: WorkTrackMembership,
  input: { id: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const running = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        eq(timeEntries.entryType, "break"),
        isNull(timeEntries.endAt),
        isNull(timeEntries.voidedAt)
      )
    )
    .limit(1);
  if (running.length) return { ok: false, message: "A break is already running." };

  const now = new Date();
  const nowIso = now.toISOString();

  // End any in-progress work entry at now, mirroring client behaviour.
  const active = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        eq(timeEntries.entryType, "work"),
        isNull(timeEntries.voidedAt),
        sql`${timeEntries.startAt} <= ${now}`,
        sql`${timeEntries.endAt} > ${now}`
      )
    );

  let adjustedEntry = false;
  for (const entry of active) {
    adjustedEntry = true;
    const split = entry.isReportedOvertime
      ? { normalMinutes: 0, overtimeMinutes: minutesBetween(entry.startAt.toISOString(), nowIso) }
      : splitIntervalMinutes(entry.startAt.toISOString(), nowIso);
    await db
      .update(timeEntries)
      .set({
        endAt: now,
        durationMinutes: minutesBetween(entry.startAt.toISOString(), nowIso),
        normalMinutes: split.normalMinutes,
        overtimeMinutes: split.overtimeMinutes,
        revisionCount: sql`${timeEntries.revisionCount} + 1`,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, entry.id));
  }

  await db.insert(timeEntries).values({
    id: input.id,
    employeeId,
    entryType: "break",
    startAt: now,
    endAt: null,
    durationMinutes: null,
    createdByMembershipId: membership.membershipId,
  });
  await audit(membership, "break.start", "time_entry", input.id, null, { employeeId });
  return { ok: true, adjustedEntry };
}

const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;
const AVATAR_MAX_CHARS = 400_000; // ~300KB binary

export async function updateProfileAction(
  membership: WorkTrackMembership,
  input: { fullName?: string; avatarUrl?: string | null }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const employee = (await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1))[0];
  if (!employee) return { ok: false, message: "Employee record not found." };

  const set: Partial<typeof employees.$inferInsert> = { updatedAt: new Date() };
  if (input.fullName !== undefined) {
    const name = input.fullName.trim();
    if (name.length < 2 || name.length > 120) {
      return { ok: false, message: "Enter your full name (2–120 characters)." };
    }
    set.fullName = name;
  }
  if (input.avatarUrl !== undefined) {
    if (input.avatarUrl === null || input.avatarUrl === "") {
      set.avatarUrl = null;
    } else if (input.avatarUrl.startsWith("https://")) {
      set.avatarUrl = input.avatarUrl.slice(0, 2000);
    } else if (AVATAR_DATA_URL.test(input.avatarUrl) && input.avatarUrl.length <= AVATAR_MAX_CHARS) {
      set.avatarUrl = input.avatarUrl;
    } else {
      return { ok: false, message: "Photo must be a PNG, JPG or WebP image under ~300KB, or an https image link." };
    }
  }
  await db.update(employees).set(set).where(eq(employees.id, employeeId));
  await audit(membership, "profile.update", "employee", employeeId, null, {
    fullName: set.fullName ?? null,
    avatarChanged: input.avatarUrl !== undefined,
  });
  return { ok: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** HR/Chairman invite the chairman by email; redeemed on their first Entra sign-in. */
export async function inviteChairmanAction(
  membership: WorkTrackMembership,
  input: { email: string }
): Promise<ActionResult> {
  if (membership.role !== "hr" && membership.role !== "chairman") {
    return { ok: false, message: "Management access required." };
  }
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (membership.user.email && email === membership.user.email.toLowerCase()) {
    return { ok: false, message: "That's your own account." };
  }

  await db
    .insert(invitations)
    .values({
      email,
      role: "chairman",
      invitedByMembershipId: membership.membershipId,
    })
    .onConflictDoUpdate({
      target: [invitations.email, invitations.role],
      set: {
        invitedByMembershipId: membership.membershipId,
        acceptedAt: null,
        updatedAt: new Date(),
      },
    });
  await audit(membership, "member.invite", "invitation", null, null, { email, role: "chairman" });
  return { ok: true };
}

export async function endBreakAction(
  membership: WorkTrackMembership,
  breakId: string
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const brk = (
    await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, breakId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.entryType, "break"),
          isNull(timeEntries.endAt),
          isNull(timeEntries.voidedAt)
        )
      )
      .limit(1)
  )[0];
  if (!brk) return { ok: false, message: "No running break found." };
  const end = new Date();
  await db
    .update(timeEntries)
    .set({
      endAt: end,
      durationMinutes: minutesBetween(brk.startAt.toISOString(), end.toISOString()),
      updatedAt: end,
    })
    .where(eq(timeEntries.id, breakId));
  await audit(membership, "break.end", "time_entry", breakId, null, { endAt: end.toISOString() });
  return { ok: true };
}
