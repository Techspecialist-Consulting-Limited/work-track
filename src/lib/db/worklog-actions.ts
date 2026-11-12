import "server-only";
import { and, asc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./index";
import {
  auditEvents,
  clientCategories,
  clientSubcategories,
  employees,
  employeeTeams,
  invitations,
  memberships,
  organisations,
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
import {
  canReviewSuggestion,
  findCatalogueDuplicate,
  validateCatalogueName,
} from "@/lib/worklog/client-catalogue";
import { getZonedDateKey, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
import { splitIntervalMinutes } from "@/lib/worklog/time";
import {
  encryptInvitationToken,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  invitationStatus,
  normalizeEmail,
  validateInvitationAssignment,
  type InvitableRole,
} from "@/lib/worklog/invitations";
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
      organisationId?: string;
      clientCategoryId?: string;
      clientSubcategoryId?: string;
      /** Raw single-use token — returned once so the admin can copy the link. */
      inviteToken?: string;
      inviteId?: string;
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
  taskId?: string;
  subtaskId?: string | null;
  clientCategoryId?: string | null;
  clientSubcategoryId?: string | null;
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

/**
 * Validates a client-site entry pair against the employee's assigned client.
 * Only approved+active rows or the employee's own pending suggestions may be
 * attached to a new entry; the category/subcategory must belong together and
 * to the same client organisation.
 */
async function clientEntryPair(
  employeeId: string,
  categoryId: string | null | undefined,
  subcategoryId: string | null | undefined,
  /** Edits are scoped to the entry's original client org, which may differ from the current assignment. */
  clientOrgId?: string
): Promise<
  | { ok: true; categoryId: string; subcategoryId: string }
  | { ok: false; message: string }
> {
  const fail = { ok: false as const, message: "Choose a category and subcategory from your client's list." };
  if (!categoryId || !subcategoryId) return fail;
  let orgId = clientOrgId;
  if (!orgId) {
    const employee = (
      await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1)
    )[0];
    if (!employee || employee.workArrangement !== "client_site" || !employee.clientOrganisationId) {
      return { ok: false, message: "Your account is not assigned to a client." };
    }
    orgId = employee.clientOrganisationId;
  }
  const org = await clientOrganisation(orgId);
  if (!org || (!clientOrgId && !org.isActive)) {
    return { ok: false, message: "Your client organisation is not active." };
  }
  const category = (
    await db.select().from(clientCategories).where(eq(clientCategories.id, categoryId)).limit(1)
  )[0];
  const subcategory = (
    await db.select().from(clientSubcategories).where(eq(clientSubcategories.id, subcategoryId)).limit(1)
  )[0];
  const selectable = (row: { approvalStatus: string; isActive: boolean; createdByEmployeeId: string | null } | undefined) =>
    Boolean(row && row.isActive && (row.approvalStatus === "approved" ||
      (row.approvalStatus === "pending" && row.createdByEmployeeId === employeeId)));
  if (
    !selectable(category) ||
    !selectable(subcategory) ||
    category!.clientOrganisationId !== org.id ||
    subcategory!.clientOrganisationId !== org.id ||
    subcategory!.categoryId !== category!.id
  ) {
    return fail;
  }
  return { ok: true, categoryId: category!.id, subcategoryId: subcategory!.id };
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

  const isClientEntry = Boolean(input.clientCategoryId || input.clientSubcategoryId);
  let taskId: string | null = null;
  let subtaskId: string | null = null;
  let clientCategoryId: string | null = null;
  let clientSubcategoryId: string | null = null;

  if (isClientEntry) {
    if (!input.description.trim()) {
      return { ok: false, message: "Describe what you worked on for this client entry." };
    }
    if (input.taskId || input.subtaskId) {
      return { ok: false, message: "Client-site entries cannot be linked to a task." };
    }
    const pair = await clientEntryPair(employeeId, input.clientCategoryId, input.clientSubcategoryId);
    if (!pair.ok) return pair;
    clientCategoryId = pair.categoryId;
    clientSubcategoryId = pair.subcategoryId;
  } else {
    if (!input.taskId) return { ok: false, message: "Choose a task first." };
    const task = await ownedTask(employeeId, input.taskId);
    if (!task) return { ok: false, message: "Choose a task first." };
    if (task.currentStatus === "done" || task.currentStatus === "dropped") {
      return { ok: false, message: "This task is closed. Reopen it or continue another open task." };
    }
    taskId = task.id;
    subtaskId = input.subtaskId?.trim() || null;
    if (subtaskId) {
      const subtask = await ownedSubtask(taskId, subtaskId);
      if (!subtask) return { ok: false, message: "That subtask does not belong to the selected task." };
    }
  }

  const split = splitFor(input);
  const duration = minutesBetween(input.startAt, input.endAt);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(timeEntries).values({
        id: input.id,
        employeeId,
        entryType: "work",
        taskId,
        subtaskId,
        clientCategoryId,
        clientSubcategoryId,
        description: input.description.trim(),
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        durationMinutes: duration,
        normalMinutes: split.normalMinutes,
        overtimeMinutes: split.overtimeMinutes,
        workLocation: input.workLocation,
        workType: split.overtimeMinutes >= duration ? "overtime" : "normal",
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
    taskId,
    subtaskId,
    clientCategoryId,
    clientSubcategoryId,
    startAt: input.startAt,
    endAt: input.endAt,
  });
  return { ok: true, taskId: taskId ?? undefined };
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

  const isClientEntry = Boolean(input.clientCategoryId || input.clientSubcategoryId);
  const wasClientEntry = Boolean(existing.clientCategoryId || existing.clientSubcategoryId);
  if (isClientEntry !== wasClientEntry) {
    return { ok: false, message: "This entry cannot switch between task and client-site reporting." };
  }
  if (isClientEntry && !input.description.trim()) {
    return { ok: false, message: "Describe what you worked on for this client entry." };
  }

  let taskId: string | null = null;
  let subtaskId: string | null = null;
  let clientCategoryId: string | null = null;
  let clientSubcategoryId: string | null = null;

  if (isClientEntry) {
    if (input.taskId || input.subtaskId) {
      return { ok: false, message: "Client-site entries cannot be linked to a task." };
    }
    // The edit stays within the entry's original client organisation — resolved
    // from the stored reference, never from the employee's current assignment.
    const existingOrgId = existing.clientCategoryId
      ? (
          await db
            .select({ clientOrganisationId: clientCategories.clientOrganisationId })
            .from(clientCategories)
            .where(eq(clientCategories.id, existing.clientCategoryId))
            .limit(1)
        )[0]?.clientOrganisationId
      : existing.clientSubcategoryId
        ? (
            await db
              .select({ clientOrganisationId: clientSubcategories.clientOrganisationId })
              .from(clientSubcategories)
              .where(eq(clientSubcategories.id, existing.clientSubcategoryId))
              .limit(1)
          )[0]?.clientOrganisationId
        : undefined;
    const pair = existingOrgId
      ? await clientEntryPair(employeeId, input.clientCategoryId, input.clientSubcategoryId, existingOrgId)
      : ({ ok: false as const, message: "Choose a category and subcategory from your client's list." });
    if (!pair.ok) {
      // Keep the entry's existing pair when it is unchanged, even if the
      // catalogue row is no longer selectable (e.g. rejected after use).
      const keepExisting =
        input.clientCategoryId === existing.clientCategoryId &&
        input.clientSubcategoryId === existing.clientSubcategoryId &&
        existing.clientCategoryId &&
        existing.clientSubcategoryId;
      if (!keepExisting) return pair;
      clientCategoryId = existing.clientCategoryId;
      clientSubcategoryId = existing.clientSubcategoryId;
    } else {
      clientCategoryId = pair.categoryId;
      clientSubcategoryId = pair.subcategoryId;
    }
  } else {
    if (!input.taskId) return { ok: false, message: "Choose a task that belongs to you." };
    const task = await ownedTask(employeeId, input.taskId);
    if (!task) return { ok: false, message: "Choose a task that belongs to you." };
    // Existing entries keep their task even if it is now closed (corrections are
    // allowed), but an edit must not move work onto a different closed task.
    if ((task.currentStatus === "done" || task.currentStatus === "dropped") && existing.taskId !== task.id) {
      return { ok: false, message: "This task is closed. Reopen it or choose an open task." };
    }
    taskId = task.id;
    subtaskId = input.subtaskId?.trim() || null;
    if (subtaskId) {
      const subtask = await ownedSubtask(taskId, subtaskId);
      if (!subtask) return { ok: false, message: "That subtask does not belong to the selected task." };
    }
  }

  const split = splitFor(input);
  const duration = minutesBetween(input.startAt, input.endAt);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(timeEntries)
        .set({
          taskId,
          subtaskId,
          clientCategoryId,
          clientSubcategoryId,
          description: input.description.trim(),
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          durationMinutes: duration,
          normalMinutes: split.normalMinutes,
          overtimeMinutes: split.overtimeMinutes,
          workLocation: input.workLocation,
          workType: split.overtimeMinutes >= duration ? "overtime" : "normal",
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
      taskId,
      subtaskId,
      clientCategoryId,
      clientSubcategoryId,
      description: input.description.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      workLocation: input.workLocation,
    }
  );
  return { ok: true, taskId: taskId ?? undefined };
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

/* ------------------------------------------------------------------ */
/* Client-site reporting: organisations, catalogue, suggestions         */
/* ------------------------------------------------------------------ */

async function clientOrganisation(organisationId: string) {
  return (
    await db.select().from(organisations).where(eq(organisations.id, organisationId)).limit(1)
  )[0];
}

/** Normalised-name duplicate check within one organisation kind. */
async function findOrganisationDuplicate(kind: string, name: string, ignoreId?: string) {
  const rows = await db.select().from(organisations).where(eq(organisations.kind, kind));
  const key = name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return rows.find(
    (row) => row.id !== ignoreId && row.name.trim().toLocaleLowerCase().replace(/\s+/g, " ") === key
  );
}

/** Config admins create client organisations; employer orgs are not created here. */
export async function createClientOrganisationAction(
  membership: WorkTrackMembership,
  input: { id: string; name: string; description?: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;
  const duplicate = await findOrganisationDuplicate("client", checked.name);
  if (duplicate) {
    return { ok: false, message: `A client organisation named "${duplicate.name}" already exists.` };
  }
  try {
    await db.insert(organisations).values({
      id: input.id,
      name: checked.name,
      kind: "client",
      description: input.description?.trim() || null,
      createdByMembershipId: membership.membershipId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("organisations_kind_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: "A client organisation with that name already exists." };
    }
    throw e;
  }
  await audit(membership, "organisation.create", "organisation", input.id, null, {
    name: checked.name,
    kind: "client",
  });
  return { ok: true, organisationId: input.id };
}

/** Edit organisation details. Kind is immutable (DB trigger) and never accepted here. */
export async function updateOrganisationAction(
  membership: WorkTrackMembership,
  input: { organisationId: string; name?: string; description?: string | null; isActive?: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const org = await clientOrganisation(input.organisationId);
  if (!org) return { ok: false, message: "Organisation not found." };

  const set: Partial<typeof organisations.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const checked = validateCatalogueName(input.name);
    if (!checked.ok) return checked;
    const duplicate = await findOrganisationDuplicate(org.kind, checked.name, org.id);
    if (duplicate) {
      return { ok: false, message: `An organisation named "${duplicate.name}" already exists.` };
    }
    set.name = checked.name;
  }
  if (input.description !== undefined) set.description = input.description?.trim() || null;
  if (input.isActive !== undefined) set.isActive = input.isActive;

  await db.update(organisations).set(set).where(eq(organisations.id, org.id));
  await audit(membership, "organisation.update", "organisation", org.id, { name: org.name, isActive: org.isActive }, set);
  return { ok: true, organisationId: org.id };
}

/**
 * Manage an employee's work arrangement and client deployment.
 * Reverting to in_house is always allowed. Switching to client_site requires
 * an active client organisation; the employee's employer assignment is kept.
 */
export async function assignEmployeeClientAction(
  membership: WorkTrackMembership,
  input: { employeeId: string; workArrangement: "in_house" | "client_site"; clientOrganisationId?: string | null }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const employee = (
    await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1)
  )[0];
  if (!employee) return { ok: false, message: "Employee not found." };

  if (input.workArrangement === "in_house") {
    await db
      .update(employees)
      .set({ workArrangement: "in_house", clientOrganisationId: null, updatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    await audit(membership, "employee.arrangement", "employee", employee.id,
      { workArrangement: employee.workArrangement, clientOrganisationId: employee.clientOrganisationId },
      { workArrangement: "in_house", clientOrganisationId: null });
    return { ok: true };
  }

  // client_site — enabled now that the client-site staff form exists (Phase 4).
  const clientOrg = input.clientOrganisationId ? await clientOrganisation(input.clientOrganisationId) : undefined;
  if (!clientOrg || clientOrg.kind !== "client") {
    return { ok: false, message: "Choose a valid client organisation." };
  }
  if (!clientOrg.isActive) {
    return { ok: false, message: "That client organisation is inactive." };
  }
  await db
    .update(employees)
    .set({ workArrangement: "client_site", clientOrganisationId: clientOrg.id, updatedAt: new Date() })
    .where(eq(employees.id, employee.id));
  await audit(membership, "employee.arrangement", "employee", employee.id,
    { workArrangement: employee.workArrangement, clientOrganisationId: employee.clientOrganisationId },
    { workArrangement: "client_site", clientOrganisationId: clientOrg.id });
  return { ok: true };
}

async function categoriesForClient(clientOrganisationId: string) {
  return db
    .select()
    .from(clientCategories)
    .where(eq(clientCategories.clientOrganisationId, clientOrganisationId));
}

/** Admin-created catalogue rows are approved immediately. */
export async function createClientCategoryAction(
  membership: WorkTrackMembership,
  input: { id: string; clientOrganisationId: string; name: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const org = await clientOrganisation(input.clientOrganisationId);
  if (!org || org.kind !== "client") return { ok: false, message: "Choose a valid client organisation." };
  if (!org.isActive) return { ok: false, message: "That client organisation is inactive." };
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;

  const duplicate = findCatalogueDuplicate(await categoriesForClient(org.id), checked.name);
  if (duplicate) {
    return { ok: false, message: `"${duplicate.name}" already exists for ${org.name}. Use the existing category instead.` };
  }
  try {
    await db.insert(clientCategories).values({
      id: input.id,
      clientOrganisationId: org.id,
      name: checked.name,
      approvalStatus: "approved",
      createdByEmployeeId: membership.employeeId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("client_categories_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: `A category named "${checked.name}" already exists for ${org.name}.` };
    }
    throw e;
  }
  await audit(membership, "client_category.create", "client_category", input.id, null, {
    clientOrganisationId: org.id,
    name: checked.name,
  });
  return { ok: true, clientCategoryId: input.id };
}

export async function updateClientCategoryAction(
  membership: WorkTrackMembership,
  input: { categoryId: string; name?: string; isActive?: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const category = (
    await db.select().from(clientCategories).where(eq(clientCategories.id, input.categoryId)).limit(1)
  )[0];
  if (!category) return { ok: false, message: "Category not found." };

  const set: Partial<typeof clientCategories.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const checked = validateCatalogueName(input.name);
    if (!checked.ok) return checked;
    const duplicate = findCatalogueDuplicate(await categoriesForClient(category.clientOrganisationId), checked.name, category.id);
    if (duplicate) {
      return { ok: false, message: `"${duplicate.name}" already exists for this client.` };
    }
    set.name = checked.name;
  }
  if (input.isActive !== undefined) set.isActive = input.isActive;

  await db.update(clientCategories).set(set).where(eq(clientCategories.id, category.id));
  await audit(membership, "client_category.update", "client_category", category.id, { name: category.name }, set);
  return { ok: true, clientCategoryId: category.id };
}

/** Subcategory's client is derived from its parent category — scoping is enforced structurally. */
export async function createClientSubcategoryAction(
  membership: WorkTrackMembership,
  input: { id: string; categoryId: string; name: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const category = (
    await db.select().from(clientCategories).where(eq(clientCategories.id, input.categoryId)).limit(1)
  )[0];
  if (!category) return { ok: false, message: "Category not found." };
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;

  const siblings = await db
    .select()
    .from(clientSubcategories)
    .where(eq(clientSubcategories.categoryId, category.id));
  const duplicate = findCatalogueDuplicate(siblings, checked.name);
  if (duplicate) {
    return { ok: false, message: `"${duplicate.name}" already exists under ${category.name}.` };
  }
  try {
    await db.insert(clientSubcategories).values({
      id: input.id,
      clientOrganisationId: category.clientOrganisationId,
      categoryId: category.id,
      name: checked.name,
      approvalStatus: "approved",
      createdByEmployeeId: membership.employeeId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("client_subcategories_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: `A subcategory named "${checked.name}" already exists under ${category.name}.` };
    }
    throw e;
  }
  await audit(membership, "client_subcategory.create", "client_subcategory", input.id, null, {
    categoryId: category.id,
    clientOrganisationId: category.clientOrganisationId,
    name: checked.name,
  });
  return { ok: true, clientSubcategoryId: input.id };
}

export async function updateClientSubcategoryAction(
  membership: WorkTrackMembership,
  input: { subcategoryId: string; name?: string; isActive?: boolean }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const subcategory = (
    await db.select().from(clientSubcategories).where(eq(clientSubcategories.id, input.subcategoryId)).limit(1)
  )[0];
  if (!subcategory) return { ok: false, message: "Subcategory not found." };

  const set: Partial<typeof clientSubcategories.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const checked = validateCatalogueName(input.name);
    if (!checked.ok) return checked;
    const siblings = await db
      .select()
      .from(clientSubcategories)
      .where(eq(clientSubcategories.categoryId, subcategory.categoryId));
    const duplicate = findCatalogueDuplicate(siblings, checked.name, subcategory.id);
    if (duplicate) {
      return { ok: false, message: `"${duplicate.name}" already exists under this category.` };
    }
    set.name = checked.name;
  }
  if (input.isActive !== undefined) set.isActive = input.isActive;

  await db.update(clientSubcategories).set(set).where(eq(clientSubcategories.id, subcategory.id));
  await audit(membership, "client_subcategory.update", "client_subcategory", subcategory.id, { name: subcategory.name }, set);
  return { ok: true, clientSubcategoryId: subcategory.id };
}

/**
 * Approve or reject a pending staff suggestion. Rejection preserves the row
 * and any historical references; approval (optionally after a rename) makes
 * the item available to every staff member on that client. Staff cannot
 * review their own suggestions.
 */
export async function reviewClientSuggestionAction(
  membership: WorkTrackMembership,
  input: {
    itemKind: "category" | "subcategory";
    id: string;
    decision: "approve" | "reject";
    name?: string;
    note?: string;
  }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;

  const isCategory = input.itemKind === "category";
  const categoryRow = isCategory
    ? (await db.select().from(clientCategories).where(eq(clientCategories.id, input.id)).limit(1))[0]
    : undefined;
  const subcategoryRow = isCategory
    ? undefined
    : (await db.select().from(clientSubcategories).where(eq(clientSubcategories.id, input.id)).limit(1))[0];
  const row = categoryRow ?? subcategoryRow;
  if (!row) return { ok: false, message: "Suggestion not found." };
  if (row.approvalStatus !== "pending") {
    return { ok: false, message: "That suggestion has already been reviewed." };
  }
  if (!canReviewSuggestion(row.createdByEmployeeId, membership.employeeId)) {
    return { ok: false, message: "You cannot review a suggestion you submitted yourself." };
  }

  const reviewedAt = new Date();
  const nextStatus = input.decision === "approve" ? "approved" : "rejected";
  const reviewNote = input.note?.trim() || null;
  let nextName: string | undefined;

  if (input.decision === "approve" && input.name !== undefined) {
    const checked = validateCatalogueName(input.name);
    if (!checked.ok) return checked;
    const siblings = isCategory
      ? await categoriesForClient(row.clientOrganisationId)
      : await db
          .select()
          .from(clientSubcategories)
          .where(eq(clientSubcategories.categoryId, subcategoryRow!.categoryId));
    const duplicate = findCatalogueDuplicate(siblings, checked.name, row.id);
    if (duplicate) {
      return { ok: false, message: `"${duplicate.name}" already exists. Approve under that name or reject this suggestion.` };
    }
    nextName = checked.name;
  }

  if (categoryRow) {
    await db
      .update(clientCategories)
      .set({
        approvalStatus: nextStatus,
        reviewedByMembershipId: membership.membershipId,
        reviewedAt,
        reviewNote,
        ...(nextName !== undefined ? { name: nextName } : {}),
        updatedAt: reviewedAt,
      })
      .where(eq(clientCategories.id, categoryRow.id));
  } else if (subcategoryRow) {
    await db
      .update(clientSubcategories)
      .set({
        approvalStatus: nextStatus,
        reviewedByMembershipId: membership.membershipId,
        reviewedAt,
        reviewNote,
        ...(nextName !== undefined ? { name: nextName } : {}),
        updatedAt: reviewedAt,
      })
      .where(eq(clientSubcategories.id, subcategoryRow.id));
  }
  await audit(
    membership,
    input.decision === "approve" ? "client_suggestion.approve" : "client_suggestion.reject",
    isCategory ? "client_category" : "client_subcategory",
    row.id,
    { name: row.name, approvalStatus: row.approvalStatus },
    { name: nextName ?? row.name, approvalStatus: nextStatus }
  );
  return { ok: true };
}

/* ------------------------- staff suggestions --------------------------- */

/** Client-site staff suggest a missing category for their assigned client. */
export async function suggestClientCategoryAction(
  membership: WorkTrackMembership,
  input: { id: string; name: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const employee = (
    await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1)
  )[0];
  if (!employee || employee.workArrangement !== "client_site" || !employee.clientOrganisationId) {
    return { ok: false, message: "Only client-site staff can suggest client categories." };
  }
  const org = await clientOrganisation(employee.clientOrganisationId);
  if (!org || !org.isActive) return { ok: false, message: "Your client organisation is not active." };
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;

  const existing = findCatalogueDuplicate(await categoriesForClient(org.id), checked.name);
  if (existing) {
    return {
      ok: false,
      message:
        existing.approvalStatus === "pending"
          ? `"${existing.name}" is already awaiting review. You can keep using it for your reports.`
          : `"${existing.name}" already exists for ${org.name}. Use the existing category instead.`,
    };
  }
  try {
    await db.insert(clientCategories).values({
      id: input.id,
      clientOrganisationId: org.id,
      name: checked.name,
      approvalStatus: "pending",
      createdByEmployeeId: employeeId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("client_categories_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: `"${checked.name}" already exists or is awaiting review for ${org.name}.` };
    }
    throw e;
  }
  await audit(membership, "client_category.suggest", "client_category", input.id, null, {
    clientOrganisationId: org.id,
    name: checked.name,
  });
  return { ok: true, clientCategoryId: input.id };
}

/** Client-site staff suggest a missing subcategory under an approved category of their client. */
export async function suggestClientSubcategoryAction(
  membership: WorkTrackMembership,
  input: { id: string; categoryId: string; name: string }
): Promise<ActionResult> {
  const employeeId = staffEmployeeId(membership);
  const employee = (
    await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1)
  )[0];
  if (!employee || employee.workArrangement !== "client_site" || !employee.clientOrganisationId) {
    return { ok: false, message: "Only client-site staff can suggest client subcategories." };
  }
  const category = (
    await db.select().from(clientCategories).where(eq(clientCategories.id, input.categoryId)).limit(1)
  )[0];
  // The category must belong to the employee's own client and be usable:
  // approved+active, or the employee's own pending suggestion (so staff can
  // suggest a subcategory under a category they just proposed).
  const categoryUsable =
    category &&
    category.clientOrganisationId === employee.clientOrganisationId &&
    category.isActive &&
    (category.approvalStatus === "approved" ||
      (category.approvalStatus === "pending" && category.createdByEmployeeId === employeeId));
  if (!categoryUsable) {
    return { ok: false, message: "Choose a category from your client's catalogue." };
  }
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;

  const siblings = await db
    .select()
    .from(clientSubcategories)
    .where(eq(clientSubcategories.categoryId, category.id));
  const existing = findCatalogueDuplicate(siblings, checked.name);
  if (existing) {
    return {
      ok: false,
      message:
        existing.approvalStatus === "pending"
          ? `"${existing.name}" is already awaiting review. You can keep using it for your reports.`
          : `"${existing.name}" already exists under ${category.name}. Use the existing subcategory instead.`,
    };
  }
  try {
    await db.insert(clientSubcategories).values({
      id: input.id,
      clientOrganisationId: category.clientOrganisationId,
      categoryId: category.id,
      name: checked.name,
      approvalStatus: "pending",
      createdByEmployeeId: employeeId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("client_subcategories_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: `"${checked.name}" already exists or is awaiting review under ${category.name}.` };
    }
    throw e;
  }
  await audit(membership, "client_subcategory.suggest", "client_subcategory", input.id, null, {
    categoryId: category.id,
    clientOrganisationId: category.clientOrganisationId,
    name: checked.name,
  });
  return { ok: true, clientSubcategoryId: input.id };
}

/* ------------------------------------------------------------------ */
/* Employee invitations (config-admin managed, token-based)            */
/* ------------------------------------------------------------------ */

async function employeeInvitationRow(invitationId: string) {
  return (
    await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1)
  )[0];
}

/** Creates or refreshes a pending employee invitation and returns the raw token once. */
export async function createEmployeeInvitationAction(
  membership: WorkTrackMembership,
  input: {
    id: string;
    email: string;
    role: string;
    employerOrganisationId: string;
    workArrangement: string;
    clientOrganisationId?: string | null;
    teamId?: string | null;
  }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;

  const email = normalizeEmail(input.email);
  const checked = validateInvitationAssignment({ ...input, email });
  if (!checked.ok) return checked;

  const employer = await clientOrganisation(input.employerOrganisationId);
  if (!employer || employer.kind !== "employer" || !employer.isActive) {
    return { ok: false, message: "Select an active employer organisation." };
  }
  if (input.workArrangement === "client_site") {
    const client = input.clientOrganisationId ? await clientOrganisation(input.clientOrganisationId) : undefined;
    if (!client || client.kind !== "client" || !client.isActive) {
      return { ok: false, message: "Select an active client organisation for client-site staff." };
    }
  }
  if (input.teamId) {
    const team = (await db.select().from(teams).where(eq(teams.id, input.teamId)).limit(1))[0];
    if (!team || !team.isActive) return { ok: false, message: "Select an active team." };
  }

  const token = generateInvitationToken();
  const values = {
    email,
    role: input.role as InvitableRole | "chairman",
    invitedByMembershipId: membership.membershipId,
    tokenHash: hashInvitationToken(token),
    tokenCipher: encryptInvitationToken(token),
    expiresAt: invitationExpiry(),
    revokedAt: null,
    acceptedAt: null,
    employerOrganisationId: input.employerOrganisationId,
    clientOrganisationId: input.workArrangement === "client_site" ? input.clientOrganisationId! : null,
    workArrangement: input.workArrangement,
    teamId: input.teamId ?? null,
    updatedAt: new Date(),
  };
  try {
    await db
      .insert(invitations)
      .values({ id: input.id, ...values })
      .onConflictDoUpdate({
        target: [invitations.email, invitations.role],
        set: values,
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("duplicate key")) {
      return { ok: false, message: "A pending invitation already exists for this email and role." };
    }
    throw e;
  }
  await audit(membership, "member.invite_employee", "invitation", input.id, null, {
    email,
    role: input.role,
    employerOrganisationId: input.employerOrganisationId,
    workArrangement: input.workArrangement,
    clientOrganisationId: values.clientOrganisationId,
  });
  return { ok: true, inviteId: input.id, inviteToken: token };
}

/** Regenerates the token and expiry for a pending invitation (resend). */
export async function resendEmployeeInvitationAction(
  membership: WorkTrackMembership,
  input: { invitationId: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const invite = await employeeInvitationRow(input.invitationId);
  if (!invite) return { ok: false, message: "Invitation not found." };
  if (invitationStatus(invite) !== "pending") {
    return { ok: false, message: "Only pending invitations can be resent." };
  }
  const token = generateInvitationToken();
  await db
    .update(invitations)
    .set({
      tokenHash: hashInvitationToken(token),
      tokenCipher: encryptInvitationToken(token),
      expiresAt: invitationExpiry(),
      updatedAt: new Date(),
    })
    .where(eq(invitations.id, invite.id));
  await audit(membership, "member.invite_resend", "invitation", invite.id, null, { email: invite.email });
  return { ok: true, inviteId: invite.id, inviteToken: token };
}

export async function revokeEmployeeInvitationAction(
  membership: WorkTrackMembership,
  input: { invitationId: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const invite = await employeeInvitationRow(input.invitationId);
  if (!invite) return { ok: false, message: "Invitation not found." };
  if (invitationStatus(invite) !== "pending") {
    return { ok: false, message: "Only pending invitations can be revoked." };
  }
  await db
    .update(invitations)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitations.id, invite.id));
  await audit(membership, "member.invite_revoke", "invitation", invite.id, null, { email: invite.email });
  return { ok: true };
}

/**
 * Redeems a token invitation after Entra sign-in. The invited email must match
 * the authenticated identity; all assignments come from the stored invitation.
 */
export async function acceptEmployeeInvitation(
  identity: { oid?: string; tid?: string; email?: string | null; name?: string | null },
  rawToken: string
): Promise<{ ok: true; role: "staff" | "hr" } | { ok: false; message: string }> {
  if (!identity.oid || !identity.tid || !identity.email) {
    return { ok: false, message: "Your Microsoft account could not be verified." };
  }
  const tokenHash = hashInvitationToken(rawToken);
  const invite = (
    await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1)
  )[0];
  if (!invite || !invite.tokenHash) {
    return { ok: false, message: "This invitation link is invalid." };
  }
  const status = invitationStatus(invite);
  if (status === "accepted") return { ok: false, message: "This invitation has already been used." };
  if (status === "revoked") return { ok: false, message: "This invitation has been revoked." };
  if (status === "expired") return { ok: false, message: "This invitation has expired. Ask your administrator for a new one." };
  if (invite.email !== normalizeEmail(identity.email)) {
    return { ok: false, message: "This invitation was issued to a different email address." };
  }
  if (invite.role !== "staff" && invite.role !== "hr") {
    return { ok: false, message: "This invitation cannot be redeemed here." };
  }

  // Reuse an existing employee profile for this Entra identity when present.
  const existingMemberships = await db
    .select({ employeeId: memberships.employeeId })
    .from(memberships)
    .where(
      and(
        eq(memberships.microsoftTenantId, identity.tid),
        eq(memberships.microsoftObjectId, identity.oid)
      )
    );
  let employeeId = existingMemberships.find((row) => row.employeeId)?.employeeId ?? null;

  if (employeeId) {
    await db
      .update(employees)
      .set({
        employerOrganisationId: invite.employerOrganisationId ?? undefined,
        workArrangement: invite.workArrangement ?? "in_house",
        clientOrganisationId: invite.workArrangement === "client_site" ? invite.clientOrganisationId : null,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId));
  } else {
    const employeeCode = `emp-${identity.oid.slice(0, 8)}`;
    const fullName =
      identity.name?.trim() ||
      identity.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    employeeId = (
      await db
        .insert(employees)
        .values({
          employeeCode,
          fullName,
          jobTitle: "Team Member",
          department: "",
          employerOrganisationId: invite.employerOrganisationId ?? null,
          workArrangement: invite.workArrangement ?? "in_house",
          clientOrganisationId: invite.workArrangement === "client_site" ? invite.clientOrganisationId : null,
        })
        .returning({ id: employees.id })
    )[0]?.id ?? null;
  }
 
  if (!employeeId) return { ok: false, message: "Your employee profile could not be created." };

  if (invite.teamId) {
    await db
      .insert(employeeTeams)
      .values({ employeeId, teamId: invite.teamId })
      .onConflictDoNothing();
  }

  await db
    .insert(memberships)
    .values({
      role: invite.role,
      microsoftTenantId: identity.tid,
      microsoftObjectId: identity.oid,
      employeeId,
      isActive: true,
      activeTeamId: invite.teamId ?? null,
    })
    .onConflictDoNothing();
  await db
    .update(memberships)
    .set({ isActive: true, employeeId, activeTeamId: invite.teamId ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.microsoftTenantId, identity.tid),
        eq(memberships.microsoftObjectId, identity.oid),
        eq(memberships.role, invite.role),
        eq(memberships.isActive, false)
      )
    );

  await db
    .update(invitations)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitations.id, invite.id));
  await db.insert(auditEvents).values({
    action: "member.invite_accept",
    entityType: "invitation",
    entityId: invite.id,
    newValues: { email: invite.email, role: invite.role, employeeId },
  });
  return { ok: true, role: invite.role as "staff" | "hr" };
}

/** Config admins can create employer organisations (kind is immutable). */
export async function createEmployerOrganisationAction(
  membership: WorkTrackMembership,
  input: { id: string; name: string; description?: string }
): Promise<ActionResult> {
  const denied = configAdminOnly(membership);
  if (denied) return denied;
  const checked = validateCatalogueName(input.name);
  if (!checked.ok) return checked;
  const duplicate = await findOrganisationDuplicate("employer", checked.name);
  if (duplicate) {
    return { ok: false, message: `An employer organisation named "${duplicate.name}" already exists.` };
  }
  try {
    await db.insert(organisations).values({
      id: input.id,
      name: checked.name,
      kind: "employer",
      description: input.description?.trim() || null,
      createdByMembershipId: membership.membershipId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("organisations_kind_name_key") || msg.includes("duplicate key")) {
      return { ok: false, message: "An employer organisation with that name already exists." };
    }
    throw e;
  }
  await audit(membership, "organisation.create", "organisation", input.id, null, {
    name: checked.name,
    kind: "employer",
  });
  return { ok: true, organisationId: input.id };
}
