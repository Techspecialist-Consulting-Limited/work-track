import "server-only";
import { and, asc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./index";
import {
  auditEvents,
  employees,
  employeeTeams,
  invitations,
  memberships,
  subtaskStatusHistory,
  taskCategories,
  taskProgressUpdateRevisions,
  taskProgressUpdates,
  taskStatusHistory,
  taskSubtasks,
  tasks,
  teamProjects,
  teams,
  timeEntries,
} from "./schema";
import { loadWorkLogDb } from "./worklog-data";
import { getAuthorizedTeamIds, isEmployeeInTeam, type WorkTrackMembership } from "@/lib/auth/authorize";
import {
  resolveBreakEnd,
  validateBreakAllowance,
  validateBreakStart,
  validateBreakWindow,
  validateDescription,
  validateProgressBody,
  validateReason,
  validateSubtaskTitle,
  validateTaskTitle,
} from "@/lib/worklog/validation";
import { checkParentCanBeDone, checkSubtaskStatusChange, isTaskStatus } from "@/lib/worklog/status-rules";
import { getZonedDateKey, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
import { splitIntervalMinutes } from "@/lib/worklog/time";
import type { TaskStatus, WorkLogDatabase } from "@/lib/worklog/types";

export type ActionResult =
  | {
      ok: true;
      taskId?: string;
      subtaskId?: string;
      progressUpdateId?: string;
      adjustedEntry?: boolean;
      teamId?: string;
      projectId?: string;
      duplicateProjectId?: string;
      duplicateProjectName?: string;
    }
  | {
      ok: false;
      message: string;
      /** Set when a staff project add collides with an existing project name. */
      duplicateProjectId?: string;
      duplicateProjectName?: string;
    };

interface EntryInput {
  employeeId: string;
  taskId: string;
  subtaskId?: string | null;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: "office" | "home";
  evidenceLink?: string;
  isReportedOvertime?: boolean;
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

async function ownedTask(employeeId: string, taskId: string) {
  return (
    await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.employeeId, employeeId)))
      .limit(1)
  )[0];
}

async function ownedSubtask(taskId: string, subtaskId: string) {
  return (
    await db
      .select()
      .from(taskSubtasks)
      .where(and(eq(taskSubtasks.id, subtaskId), eq(taskSubtasks.taskId, taskId)))
      .limit(1)
  )[0];
}

/** Snapshot for reconciliation — "team"/"config" scope is privileged. */
export async function snapshotFor(
  membership: WorkTrackMembership,
  scope?: string
): Promise<WorkLogDatabase> {
  const isManagement = membership.role === "hr" || membership.role === "chairman";
  if (scope === "team" && isManagement) return loadWorkLogDb();
  if (scope === "config" && membership.isConfigAdmin) return loadWorkLogDb();
  return membership.employeeId ? loadWorkLogDb({ employeeId: membership.employeeId }) : loadWorkLogDb();
}

/* ------------------------------------------------------------------ */
/* Teams and project library                                          */
/* ------------------------------------------------------------------ */

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function configAdminOnly(membership: WorkTrackMembership): ActionResult | null {
  if (!membership.isConfigAdmin) {
    return { ok: false, message: "Configuration admin access required." };
  }
  return null;
}

async function activeTeam(teamId: string) {
  return (
    await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  )[0];
}

async function findDuplicateProject(teamId: string, name: string, ignoreId?: string) {
  const rows = await db
    .select()
    .from(teamProjects)
    .where(and(eq(teamProjects.teamId, teamId), isNull(teamProjects.archivedAt)));
  const target = normalizeName(name);
  return rows.find((row) => row.id !== ignoreId && normalizeName(row.name) === target);
}

/** Staff pick which of their assigned teams they are logging against. */
export async function selectTeamAction(
  membership: WorkTrackMembership,
  input: { teamId: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const team = await activeTeam(input.teamId);
  if (!team || !team.isActive) return { ok: false, message: "Choose an active team." };
  if (!(await isEmployeeInTeam(employeeId, team.id))) {
    return { ok: false, message: "You are not assigned to that team." };
  }
  await db
    .update(memberships)
    .set({ activeTeamId: team.id, updatedAt: new Date() })
    .where(eq(memberships.id, membership.membershipId));
  await audit(membership, "team.select", "team", team.id, null, { teamId: team.id });
  return { ok: true };
}

/**
 * Staff add a project that is missing from their team's library. Duplicates are
 * never merged silently: the caller gets the colliding project back and decides.
 */
export async function createStaffProjectAction(
  membership: WorkTrackMembership,
  input: { id: string; teamId: string; name: string; description?: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) {
    return { ok: false, message: "Enter a project name between 2 and 160 characters." };
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    return { ok: false, message: "Project description must be 2000 characters or fewer." };
  }
  const team = await activeTeam(input.teamId);
  if (!team || !team.isActive) return { ok: false, message: "Choose an active team." };
  if (!(await isEmployeeInTeam(employeeId, team.id))) {
    return { ok: false, message: "You can only add projects to a team you belong to." };
  }

  const duplicate = await findDuplicateProject(team.id, name);
  if (duplicate) {
    return {
      ok: false,
      message: `"${duplicate.name}" already exists in ${team.name}. Use the existing project instead.`,
      duplicateProjectId: duplicate.id,
      duplicateProjectName: duplicate.name,
    };
  }

  try {
    await db.insert(teamProjects).values({
      id: input.id,
      teamId: team.id,
      name,
      description,
      origin: "staff",
      createdByEmployeeId: employeeId,
      createdByMembershipId: membership.membershipId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("team_projects_team_name_key") || msg.includes("duplicate key")) {
      const raced = await findDuplicateProject(team.id, name);
      return {
        ok: false,
        message: raced
          ? `"${raced.name}" already exists in ${team.name}. Use the existing project instead.`
          : "That project was just added by someone else. Refresh and choose it.",
        duplicateProjectId: raced?.id,
        duplicateProjectName: raced?.name,
      };
    }
    throw e;
  }
  await audit(membership, "project.create", "team_project", input.id, null, {
    teamId: team.id,
    name,
    origin: "staff",
  });
  return { ok: true, projectId: input.id };
}

/* ------------------------- configuration admins ------------------------- */

export async function createTeamAction(
  membership: WorkTrackMembership,
  input: { id: string; name: string; description?: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, message: "Enter a team name between 2 and 80 characters." };
  }
  const existing = (
    await db.select({ id: teams.id }).from(teams).where(sql`lower(${teams.name}) = ${name.toLocaleLowerCase()}`).limit(1)
  )[0];
  if (existing) return { ok: false, message: "A team with that name already exists." };

  await db.insert(teams).values({
    id: input.id,
    name,
    description: input.description?.trim() || null,
    origin: "admin",
    createdByMembershipId: membership.membershipId,
  });
  await audit(membership, "team.create", "team", input.id, null, { name });
  return { ok: true, teamId: input.id };
}

export async function updateTeamAction(
  membership: WorkTrackMembership,
  input: { teamId: string; name?: string; description?: string | null; isActive?: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const team = await activeTeam(input.teamId);
  if (!team) return { ok: false, message: "Team not found." };

  const set: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      return { ok: false, message: "Enter a team name between 2 and 80 characters." };
    }
    const clash = (
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(sql`lower(${teams.name}) = ${name.toLocaleLowerCase()}`, sql`${teams.id} <> ${team.id}`))
        .limit(1)
    )[0];
    if (clash) return { ok: false, message: "A team with that name already exists." };
    set.name = name;
  }
  if (input.description !== undefined) set.description = input.description?.trim() || null;
  if (input.isActive !== undefined) {
    if (!input.isActive && team.isDefault) {
      return { ok: false, message: "The default team cannot be deactivated. Set another team as default first." };
    }
    set.isActive = input.isActive;
  }

  await db.update(teams).set(set).where(eq(teams.id, team.id));
  await audit(membership, "team.update", "team", team.id, { name: team.name, isActive: team.isActive }, set);
  return { ok: true };
}

/** Add or remove an employee from a team. Staff always keep at least one team. */
export async function assignEmployeeTeamAction(
  membership: WorkTrackMembership,
  input: { employeeId: string; teamId: string; assigned: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const employee = (
    await db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId)).limit(1)
  )[0];
  if (!employee) return { ok: false, message: "Employee not found." };
  const team = await activeTeam(input.teamId);
  if (!team) return { ok: false, message: "Team not found." };

  if (input.assigned) {
    await db
      .insert(employeeTeams)
      .values({ employeeId: employee.id, teamId: team.id, createdByMembershipId: membership.membershipId })
      .onConflictDoNothing();
  } else {
    const others = await getAuthorizedTeamIds(employee.id);
    if (others.filter((id) => id !== team.id).length === 0) {
      return { ok: false, message: "Staff need at least one team. Assign another team before removing this one." };
    }
    await db
      .delete(employeeTeams)
      .where(and(eq(employeeTeams.employeeId, employee.id), eq(employeeTeams.teamId, team.id)));
    await db
      .update(memberships)
      .set({ activeTeamId: null, updatedAt: new Date() })
      .where(and(eq(memberships.employeeId, employee.id), eq(memberships.activeTeamId, team.id)));
  }
  await audit(membership, input.assigned ? "team.assign" : "team.unassign", "employee_team", null, null, {
    employeeId: employee.id,
    teamId: team.id,
  });
  return { ok: true };
}

export async function createTeamProjectAction(
  membership: WorkTrackMembership,
  input: { id: string; teamId: string; name: string; description?: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) {
    return { ok: false, message: "Enter a project name between 2 and 160 characters." };
  }
  const team = await activeTeam(input.teamId);
  if (!team) return { ok: false, message: "Team not found." };
  const duplicate = await findDuplicateProject(team.id, name);
  if (duplicate) {
    return {
      ok: false,
      message: `"${duplicate.name}" already exists in ${team.name}.`,
      duplicateProjectId: duplicate.id,
      duplicateProjectName: duplicate.name,
    };
  }
  await db.insert(teamProjects).values({
    id: input.id,
    teamId: team.id,
    name,
    description: input.description?.trim() || null,
    origin: "admin",
    createdByMembershipId: membership.membershipId,
    promotedAt: new Date(),
    promotedByMembershipId: membership.membershipId,
  });
  await audit(membership, "project.create", "team_project", input.id, null, { teamId: team.id, name });
  return { ok: true, projectId: input.id };
}

export async function updateTeamProjectAction(
  membership: WorkTrackMembership,
  input: { projectId: string; name?: string; description?: string | null; isActive?: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const project = (
    await db.select().from(teamProjects).where(eq(teamProjects.id, input.projectId)).limit(1)
  )[0];
  if (!project || project.archivedAt) return { ok: false, message: "Project not found." };

  const set: Partial<typeof teamProjects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 160) {
      return { ok: false, message: "Enter a project name between 2 and 160 characters." };
    }
    const duplicate = await findDuplicateProject(project.teamId, name, project.id);
    if (duplicate) return { ok: false, message: `"${duplicate.name}" already exists in this team.` };
    set.name = name;
  }
  if (input.description !== undefined) set.description = input.description?.trim() || null;
  if (input.isActive !== undefined) set.isActive = input.isActive;

  await db.update(teamProjects).set(set).where(eq(teamProjects.id, project.id));
  await audit(membership, "project.update", "team_project", project.id, { name: project.name }, set);
  return { ok: true, projectId: project.id };
}

/** Archive keeps history intact: tasks and entries still resolve the project. */
export async function archiveTeamProjectAction(
  membership: WorkTrackMembership,
  input: { projectId: string; archived: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const project = (
    await db.select().from(teamProjects).where(eq(teamProjects.id, input.projectId)).limit(1)
  )[0];
  if (!project) return { ok: false, message: "Project not found." };

  await db
    .update(teamProjects)
    .set({
      isActive: !input.archived,
      archivedAt: input.archived ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(teamProjects.id, project.id));
  await audit(membership, input.archived ? "project.archive" : "project.restore", "team_project", project.id, null, {
    archived: input.archived,
  });
  return { ok: true, projectId: project.id };
}

/** Promote a staff-added project so it is marked as reviewed by an admin. */
export async function promoteTeamProjectAction(
  membership: WorkTrackMembership,
  input: { projectId: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const project = (
    await db.select().from(teamProjects).where(eq(teamProjects.id, input.projectId)).limit(1)
  )[0];
  if (!project) return { ok: false, message: "Project not found." };
  if (project.origin !== "staff") return { ok: true, projectId: project.id };

  await db
    .update(teamProjects)
    .set({
      promotedAt: new Date(),
      promotedByMembershipId: membership.membershipId,
      updatedAt: new Date(),
    })
    .where(eq(teamProjects.id, project.id));
  await audit(membership, "project.promote", "team_project", project.id, null, { name: project.name });
  return { ok: true, projectId: project.id };
}

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export async function createTaskAction(
  membership: WorkTrackMembership,
  input: {
    id: string;
    employeeId?: string;
    title?: string;
    description?: string;
    teamId?: string | null;
    projectId?: string | null;
    subtasks?: { id?: string; title: string; description?: string }[];
  }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (input.employeeId && input.employeeId !== employeeId) {
    return { ok: false, message: "You can only create your own tasks." };
  }

  let title: string;
  let teamId: string | null = input.teamId?.trim() || null;
  const projectId: string | null = input.projectId?.trim() || null;

  if (projectId) {
    const project = (
      await db.select().from(teamProjects).where(eq(teamProjects.id, projectId)).limit(1)
    )[0];
    if (!project || project.archivedAt || !project.isActive) {
      return { ok: false, message: "Choose an active project from your team." };
    }
    if (!(await isEmployeeInTeam(employeeId, project.teamId))) {
      return { ok: false, message: "That project belongs to a team you are not assigned to." };
    }
    teamId = project.teamId;
    title = project.name;
  } else {
    const checked = validateTaskTitle(input.title ?? "");
    if (!checked.ok) return checked;
    title = input.title!.trim();
  }

  const subtasks = (input.subtasks ?? []).filter((subtask) => subtask.title.trim());
  if (subtasks.length > 20) return { ok: false, message: "Add at most 20 subtasks at a time." };
  for (const subtask of subtasks) {
    const check = validateSubtaskTitle(subtask.title);
    if (!check.ok) return check;
  }

  // A project maps to exactly one open task per employee: reuse it if it exists.
  if (projectId) {
    const existing = (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.employeeId, employeeId),
            eq(tasks.projectId, projectId),
            isNull(tasks.archivedAt)
          )
        )
        .limit(1)
    )[0];
    if (existing) return { ok: true, taskId: existing.id, projectId };
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tasks).values({
        id: input.id,
        employeeId,
        teamId,
        projectId,
        title,
        description: input.description?.trim() || null,
        currentStatus: "ongoing",
        statusUpdatedAt: now,
        createdByMembershipId: membership.membershipId,
      });
      await tx.insert(taskStatusHistory).values({
        taskId: input.id,
        previousStatus: null,
        newStatus: "ongoing",
        changedByMembershipId: membership.membershipId,
        changeNote: projectId ? "Task created from a team project" : "Task created",
        changedAt: now,
      });
      for (let index = 0; index < subtasks.length; index += 1) {
        const subtask = subtasks[index];
        const subtaskId = subtask.id ?? randomUUID();
        await tx.insert(taskSubtasks).values({
          id: subtaskId,
          taskId: input.id,
          title: subtask.title.trim(),
          description: subtask.description?.trim() || null,
          status: "ongoing",
          displayOrder: index,
          statusUpdatedAt: now,
          createdByMembershipId: membership.membershipId,
        });
        await tx.insert(subtaskStatusHistory).values({
          subtaskId,
          previousStatus: null,
          newStatus: "ongoing",
          changedByMembershipId: membership.membershipId,
          changeNote: "Subtask created",
          changedAt: now,
        });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("tasks_pkey") || msg.includes("duplicate key")) {
      return { ok: false, message: "That task already exists. Refresh and try again." };
    }
    throw e;
  }
  await audit(membership, "task.create", "task", input.id, null, {
    title,
    teamId,
    projectId,
    subtasks: subtasks.length,
  });
  return { ok: true, taskId: input.id, projectId: projectId ?? undefined };
}

export async function updateTaskAction(
  membership: WorkTrackMembership,
  input: { taskId: string; title: string; description?: string; categoryId?: string | null }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const task = await ownedTask(employeeId, input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  const title = validateTaskTitle(input.title);
  if (!title.ok) return title;

  const categoryId = input.categoryId?.trim() || null;
  if (categoryId) {
    const category = (
      await db.select({ id: taskCategories.id }).from(taskCategories).where(eq(taskCategories.id, categoryId)).limit(1)
    )[0];
    if (!category) return { ok: false, message: "Choose a valid category." };
  }

  await db
    .update(tasks)
    .set({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      categoryId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId));
  await audit(
    membership,
    "task.update",
    "task",
    input.taskId,
    { title: task.title, description: task.description, categoryId: task.categoryId },
    { title: input.title.trim(), description: input.description?.trim() || null, categoryId }
  );
  return { ok: true, taskId: input.taskId };
}

export async function updateTaskStatusAction(
  membership: WorkTrackMembership,
  taskId: string,
  status: TaskStatus,
  reason?: string,
  note?: string
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (!isTaskStatus(status)) return { ok: false, message: "Choose a valid status." };
  const task = await ownedTask(employeeId, taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus === status) return { ok: true, taskId };

  if (status === "blocked" || status === "dropped") {
    const check = validateReason(reason, status === "blocked" ? "being blocked" : "dropping this task");
    if (!check.ok) return check;
  }
  if (status === "done") {
    const subtaskRows = await db.select().from(taskSubtasks).where(eq(taskSubtasks.taskId, taskId));
    const check = checkParentCanBeDone(subtaskRows.filter((row) => !row.archivedAt));
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
        // Reopening a Done task clears the current completion, history keeps the event.
        completedAt: status === "done" ? now : null,
        statusUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId));
    await tx.insert(taskStatusHistory).values({
      taskId,
      previousStatus: task.currentStatus,
      newStatus: status,
      changedByMembershipId: membership.membershipId,
      changeNote: (note ?? reason)?.trim() || null,
      changedAt: now,
    });
  });
  await audit(membership, "task.status", "task", taskId, { status: task.currentStatus }, { status, note: note ?? reason ?? null });
  return { ok: true, taskId };
}

/* ------------------------------------------------------------------ */
/* Subtasks                                                           */
/* ------------------------------------------------------------------ */

export async function createSubtaskAction(
  membership: WorkTrackMembership,
  input: { id: string; taskId: string; title: string; description?: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const task = await ownedTask(employeeId, input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.currentStatus === "done" || task.currentStatus === "dropped") {
    return { ok: false, message: "Reopen the main task before adding a subtask." };
  }
  const title = validateSubtaskTitle(input.title);
  if (!title.ok) return title;

  const existing = await db
    .select({ displayOrder: taskSubtasks.displayOrder })
    .from(taskSubtasks)
    .where(eq(taskSubtasks.taskId, input.taskId))
    .orderBy(asc(taskSubtasks.displayOrder));
  const displayOrder = existing.length ? existing[existing.length - 1].displayOrder + 1 : 0;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(taskSubtasks).values({
      id: input.id,
      taskId: input.taskId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: "ongoing",
      displayOrder,
      statusUpdatedAt: now,
      createdByMembershipId: membership.membershipId,
    });
    await tx.insert(subtaskStatusHistory).values({
      subtaskId: input.id,
      previousStatus: null,
      newStatus: "ongoing",
      changedByMembershipId: membership.membershipId,
      changeNote: "Subtask created",
      changedAt: now,
    });
  });
  await audit(membership, "subtask.create", "subtask", input.id, null, { title: input.title.trim(), taskId: input.taskId });
  return { ok: true, taskId: input.taskId, subtaskId: input.id };
}

export async function updateSubtaskAction(
  membership: WorkTrackMembership,
  input: { subtaskId: string; title: string; description?: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const subtask = (
    await db
      .select({ subtask: taskSubtasks, task: tasks })
      .from(taskSubtasks)
      .innerJoin(tasks, eq(taskSubtasks.taskId, tasks.id))
      .where(and(eq(taskSubtasks.id, input.subtaskId), eq(tasks.employeeId, employeeId)))
      .limit(1)
  )[0];
  if (!subtask) return { ok: false, message: "Subtask not found." };
  if (subtask.task.currentStatus === "dropped") {
    return { ok: false, message: "Reopen the main task before editing its subtasks." };
  }
  const title = validateSubtaskTitle(input.title);
  if (!title.ok) return title;

  await db
    .update(taskSubtasks)
    .set({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(taskSubtasks.id, input.subtaskId));
  await audit(
    membership,
    "subtask.update",
    "subtask",
    input.subtaskId,
    { title: subtask.subtask.title, description: subtask.subtask.description },
    { title: input.title.trim(), description: input.description?.trim() || null }
  );
  return { ok: true, taskId: subtask.task.id, subtaskId: input.subtaskId };
}

export async function updateSubtaskStatusAction(
  membership: WorkTrackMembership,
  subtaskId: string,
  status: TaskStatus,
  reason?: string
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (!isTaskStatus(status)) return { ok: false, message: "Choose a valid status." };
  const row = (
    await db
      .select({ subtask: taskSubtasks, task: tasks })
      .from(taskSubtasks)
      .innerJoin(tasks, eq(taskSubtasks.taskId, tasks.id))
      .where(and(eq(taskSubtasks.id, subtaskId), eq(tasks.employeeId, employeeId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: "Subtask not found." };
  if (row.subtask.status === status) return { ok: true, taskId: row.task.id, subtaskId };

  const allowed = checkSubtaskStatusChange(row.task, row.subtask, status);
  if (!allowed.ok) return allowed;
  if (status === "blocked" || status === "dropped") {
    const check = validateReason(reason, status === "blocked" ? "blocking this subtask" : "dropping this subtask");
    if (!check.ok) return check;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(taskSubtasks)
      .set({
        status,
        completedAt: status === "done" ? now : null,
        statusUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(taskSubtasks.id, subtaskId));
    await tx.insert(subtaskStatusHistory).values({
      subtaskId,
      previousStatus: row.subtask.status,
      newStatus: status,
      changedByMembershipId: membership.membershipId,
      changeNote: reason?.trim() || null,
      changedAt: now,
    });
  });
  await audit(membership, "subtask.status", "subtask", subtaskId, { status: row.subtask.status }, { status });
  return { ok: true, taskId: row.task.id, subtaskId };
}

/* ------------------------------------------------------------------ */
/* Progress updates                                                   */
/* ------------------------------------------------------------------ */

export async function addProgressUpdateAction(
  membership: WorkTrackMembership,
  input: { id: string; taskId: string; subtaskId?: string | null; body: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const task = await ownedTask(employeeId, input.taskId);
  if (!task) return { ok: false, message: "Task not found." };
  const body = validateProgressBody(input.body);
  if (!body.ok) return body;

  const subtaskId = input.subtaskId?.trim() || null;
  if (subtaskId) {
    const subtask = await ownedSubtask(input.taskId, subtaskId);
    if (!subtask) return { ok: false, message: "That subtask does not belong to the selected task." };
  }

  await db.insert(taskProgressUpdates).values({
    id: input.id,
    taskId: input.taskId,
    subtaskId,
    authorEmployeeId: employeeId,
    body: input.body.trim(),
  });
  await audit(membership, "progress.create", "progress_update", input.id, null, {
    taskId: input.taskId,
    subtaskId,
  });
  return { ok: true, taskId: input.taskId, progressUpdateId: input.id };
}

export async function editProgressUpdateAction(
  membership: WorkTrackMembership,
  input: { progressUpdateId: string; body: string; revisionReason?: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const row = (
    await db
      .select({ update: taskProgressUpdates, task: tasks })
      .from(taskProgressUpdates)
      .innerJoin(tasks, eq(taskProgressUpdates.taskId, tasks.id))
      .where(and(eq(taskProgressUpdates.id, input.progressUpdateId), eq(tasks.employeeId, employeeId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: "Progress update not found." };
  const body = validateProgressBody(input.body);
  if (!body.ok) return body;
  const nextBody = input.body.trim();
  if (nextBody === row.update.body) return { ok: true, taskId: row.task.id, progressUpdateId: input.progressUpdateId };

  const now = new Date();
  await db.transaction(async (tx) => {
    // Preserve the previous wording before replacing the current body.
    await tx.insert(taskProgressUpdateRevisions).values({
      progressUpdateId: input.progressUpdateId,
      previousBody: row.update.body,
      revisedByMembershipId: membership.membershipId,
      revisedAt: now,
      revisionReason: input.revisionReason?.trim() || null,
    });
    await tx
      .update(taskProgressUpdates)
      .set({
        body: nextBody,
        editedAt: now,
        editedByMembershipId: membership.membershipId,
        updatedAt: now,
      })
      .where(eq(taskProgressUpdates.id, input.progressUpdateId));
  });
  await audit(
    membership,
    "progress.edit",
    "progress_update",
    input.progressUpdateId,
    { body: row.update.body },
    { body: nextBody, revisionReason: input.revisionReason?.trim() || null }
  );
  return { ok: true, taskId: row.task.id, progressUpdateId: input.progressUpdateId };
}

/* ------------------------------------------------------------------ */
/* Work entries                                                       */
/* ------------------------------------------------------------------ */

export async function addWorkEntryAction(
  membership: WorkTrackMembership,
  input: EntryInput & { id: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  if (input.employeeId !== employeeId) return { ok: false, message: "You can only log your own work." };
  const desc = validateDescription(input.description);
  if (!desc.ok) return desc;

  const task = await ownedTask(employeeId, input.taskId);
  if (!task) return { ok: false, message: "Choose a task first." };
  if (task.currentStatus === "done" || task.currentStatus === "dropped") {
    return { ok: false, message: "This task is closed. Reopen it or continue another open task." };
  }
  const subtaskId = input.subtaskId?.trim() || null;
  if (subtaskId) {
    const subtask = await ownedSubtask(input.taskId, subtaskId);
    if (!subtask) return { ok: false, message: "That subtask does not belong to the selected task." };
  }

  const split = splitFor(input);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(timeEntries).values({
        id: input.id,
        employeeId,
        entryType: "work",
        taskId: task.id,
        subtaskId,
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
        createdByMembershipId: membership.membershipId,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("time_entries_no_overlap") || msg.includes("23P01")) {
      return { ok: false, message: "This overlaps an existing entry. Adjust the time and try again." };
    }
    throw e;
  }
  await audit(membership, "entry.create", "time_entry", input.id, null, {
    employeeId,
    taskId: task.id,
    subtaskId,
    startAt: input.startAt,
    endAt: input.endAt,
  });
  return { ok: true, taskId: task.id };
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

  const task = await ownedTask(employeeId, input.taskId);
  if (!task) return { ok: false, message: "Choose a task that belongs to you." };
  // Existing entries keep their task even if it is now closed (corrections are
  // allowed), but an edit must not move work onto a different closed task.
  if ((task.currentStatus === "done" || task.currentStatus === "dropped") && existing.taskId !== task.id) {
    return { ok: false, message: "This task is closed. Reopen it or choose an open task." };
  }
  const subtaskId = input.subtaskId?.trim() || null;
  if (subtaskId) {
    const subtask = await ownedSubtask(input.taskId, subtaskId);
    if (!subtask) return { ok: false, message: "That subtask does not belong to the selected task." };
  }

  const split = splitFor(input);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(timeEntries)
        .set({
          taskId: input.taskId,
          subtaskId,
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
          updatedByMembershipId: membership.membershipId,
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, entryId));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("time_entries_no_overlap") || msg.includes("23P01")) {
      return { ok: false, message: "This overlaps an existing entry. Adjust the time and try again." };
    }
    throw e;
  }
  await audit(
    membership,
    "entry.update",
    "time_entry",
    entryId,
    {
      taskId: existing.taskId,
      subtaskId: existing.subtaskId,
      description: existing.description,
      startAt: existing.startAt.toISOString(),
      endAt: existing.endAt?.toISOString() ?? null,
      workLocation: existing.workLocation,
    },
    {
      taskId: input.taskId,
      subtaskId,
      description: input.description.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      workLocation: input.workLocation,
    }
  );
  return { ok: true, taskId: input.taskId };
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

/* ------------------------------------------------------------------ */
/* Management review                                                  */
/* ------------------------------------------------------------------ */

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
  if (task.currentStatus !== "done") {
    return { ok: false, message: "Only Done tasks can be reviewed." };
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

/* ------------------------------------------------------------------ */
/* Breaks                                                             */
/* ------------------------------------------------------------------ */

export async function startBreakAction(
  membership: WorkTrackMembership,
  input: { id: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const now = new Date();
  const nowIso = now.toISOString();

  const [y, m, d] = getZonedDateKey(now).split("-").map(Number);
  const dayStart = zonedDateTimeToDate(y, m, d, 0, 0);
  const recent = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        isNull(timeEntries.voidedAt),
        or(gte(timeEntries.startAt, dayStart), isNull(timeEntries.endAt))
      )
    );
  const check = validateBreakStart(
    recent
      .filter((row) => row.entryType === "break")
      .map((row) => ({
        id: row.id,
        employeeId,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt ? row.endAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
    recent.filter((row) => row.entryType === "work").map((row) => ({ startAt: row.startAt.toISOString() })),
    employeeId,
    now
  );
  if (!check.ok) return check;

  // End any in-progress work entry at now, mirroring client behaviour.
  const active = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        eq(timeEntries.entryType, "work"),
        isNull(timeEntries.voidedAt),
        lte(timeEntries.startAt, now),
        gt(timeEntries.endAt, now)
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
        updatedByMembershipId: membership.membershipId,
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
  const dayStart = new Date(brk.startAt.getTime() - 86_400_000);
  const sameDay = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        eq(timeEntries.entryType, "break"),
        isNull(timeEntries.voidedAt),
        gte(timeEntries.startAt, dayStart)
      )
    );
  const toBreak = (row: typeof brk) => ({
    id: row.id,
    employeeId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
  const end = resolveBreakEnd(sameDay.map(toBreak), toBreak(brk), new Date());
  await db
    .update(timeEntries)
    .set({
      endAt: end,
      durationMinutes: minutesBetween(brk.startAt.toISOString(), end.toISOString()),
      updatedByMembershipId: membership.membershipId,
      updatedAt: end,
    })
    .where(eq(timeEntries.id, breakId));
  await audit(membership, "break.end", "time_entry", breakId, null, { endAt: end.toISOString() });
  return { ok: true };
}

/**
 * Correct an existing break. Breaks stay separate from work: no task/subtask is
 * ever attached, and the exclusion constraint rejects overlaps for this employee.
 */
export async function updateBreakAction(
  membership: WorkTrackMembership,
  input: { breakId: string; startAt: string; endAt?: string | null }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const brk = (
    await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, input.breakId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.entryType, "break"),
          isNull(timeEntries.voidedAt)
        )
      )
      .limit(1)
  )[0];
  if (!brk) return { ok: false, message: "Break not found." };

  const start = new Date(input.startAt);
  const end = input.endAt ? new Date(input.endAt) : null;
  if (Number.isNaN(start.getTime())) return { ok: false, message: "Enter a valid break start time." };
  if (end && (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime())) {
    return { ok: false, message: "Break end must be after break start." };
  }
  if (end) {
    const windowCheck = validateBreakWindow(start.toISOString(), end.toISOString());
    if (!windowCheck.ok) return windowCheck;
  }

  const dayStart = new Date(start.getTime() - 86_400_000);
  const dayEnd = new Date(start.getTime() + 2 * 86_400_000);
  const nearby = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employeeId),
        isNull(timeEntries.voidedAt),
        gte(timeEntries.startAt, dayStart),
        lte(timeEntries.startAt, dayEnd)
      )
    );

  const rangeEnd = end ? end.getTime() : Number.POSITIVE_INFINITY;
  const clash = nearby.find((row) => {
    if (row.id === brk.id) return false;
    const otherStart = row.startAt.getTime();
    const otherEnd = row.endAt ? row.endAt.getTime() : Number.POSITIVE_INFINITY;
    return start.getTime() < otherEnd && otherStart < rangeEnd;
  });
  if (clash) {
    return { ok: false, message: "This break overlaps another work entry or break. Adjust the time." };
  }

  if (end) {
    const tally = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.entryType, "break"),
          isNull(timeEntries.voidedAt),
          gte(timeEntries.startAt, dayStart),
          lte(timeEntries.startAt, dayEnd)
        )
      );
    const asBreaks = tally.map((row) => ({
      id: row.id,
      employeeId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt ? row.endAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
    const allowance = validateBreakAllowance(
      {
        version: 2,
        employees: [],
        teams: [],
        employeeTeams: [],
        projects: [],
        categories: [],
        tasks: [],
        subtasks: [],
        progressUpdates: [],
        entries: [],
        breaks: asBreaks,
        statusHistory: [],
      },
      employeeId,
      start.toISOString(),
      end.toISOString(),
      brk.id
    );
    if (!allowance.ok) return allowance;
  }

  const now = new Date();
  await db
    .update(timeEntries)
    .set({
      startAt: start,
      endAt: end,
      durationMinutes: end ? minutesBetween(start.toISOString(), end.toISOString()) : null,
      updatedByMembershipId: membership.membershipId,
      updatedAt: now,
    })
    .where(eq(timeEntries.id, brk.id));
  await audit(
    membership,
    "break.update",
    "time_entry",
    brk.id,
    { startAt: brk.startAt.toISOString(), endAt: brk.endAt?.toISOString() ?? null },
    { startAt: start.toISOString(), endAt: end?.toISOString() ?? null }
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Profile / invitations                                              */
/* ------------------------------------------------------------------ */

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
