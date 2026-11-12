import "server-only";
import { asc, eq, inArray, or } from "drizzle-orm";
import { db } from "./index";
import {
  clientCategories,
  clientSubcategories,
  employees,
  employeeTeams,
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
import type {
  BreakEntry,
  ClientCategory,
  ClientSubcategory,
  Employee,
  EmployeeTeam,
  Organisation,
  ProgressUpdate,
  ProgressUpdateRevision,
  StatusHistoryEvent,
  Subtask,
  Task,
  TaskCategory,
  Team,
  TeamProject,
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
  if (employeeIds.length === 0) return empty;

  const [categoryRows, membershipRows, taskRows, entryRows, teamRows, employeeTeamRows, organisationRows] =
    await Promise.all([
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
      db.select().from(teams).orderBy(asc(teams.name)),
      db.select().from(employeeTeams).where(inArray(employeeTeams.employeeId, employeeIds)),
      db.select().from(organisations).orderBy(asc(organisations.name)),
    ]);

  const employeeNames = new Map(employeeRows.map((row) => [row.id, row.fullName]));
  const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));
  const organisationNames = new Map(organisationRows.map((row) => [row.id, row.name]));

  // Staff only see catalogue entries for their assigned client; management sees all clients.
  const staffClientOrgId = scope.employeeId ? employeeRows[0]?.clientOrganisationId : undefined;
  const visibleClientOrgIds = scope.employeeId
    ? staffClientOrgId
      ? [staffClientOrgId]
      : []
    : organisationRows.filter((row) => row.kind === "client").map((row) => row.id);

  // Staff must not see other employees' pending/rejected suggestions, but rows
  // their own entries already reference stay resolvable for history — including
  // rows under a client they have since been reassigned away from.
  const referencedCategoryIds = new Set(
    entryRows.map((row) => row.clientCategoryId).filter((id): id is string => Boolean(id))
  );
  const referencedSubcategoryIds = new Set(
    entryRows.map((row) => row.clientSubcategoryId).filter((id): id is string => Boolean(id))
  );

  let clientCategoryRows: (typeof clientCategories.$inferSelect)[] = [];
  let clientSubcategoryRows: (typeof clientSubcategories.$inferSelect)[] = [];
  if (scope.employeeId) {
    const orgIds = staffClientOrgId ? [staffClientOrgId] : [];
    const refSubIds = [...referencedSubcategoryIds];
    clientSubcategoryRows =
      orgIds.length || refSubIds.length
        ? await db
            .select()
            .from(clientSubcategories)
            .where(
              or(
                orgIds.length ? inArray(clientSubcategories.clientOrganisationId, orgIds) : undefined,
                refSubIds.length ? inArray(clientSubcategories.id, refSubIds) : undefined
              )
            )
            .orderBy(asc(clientSubcategories.name))
        : [];
    const catIds = new Set(referencedCategoryIds);
    for (const row of clientSubcategoryRows) catIds.add(row.categoryId);
    const idList = [...catIds];
    clientCategoryRows =
      orgIds.length || idList.length
        ? await db
            .select()
            .from(clientCategories)
            .where(
              or(
                orgIds.length ? inArray(clientCategories.clientOrganisationId, orgIds) : undefined,
                idList.length ? inArray(clientCategories.id, idList) : undefined
              )
            )
            .orderBy(asc(clientCategories.name))
        : [];
  } else if (visibleClientOrgIds.length) {
    [clientCategoryRows, clientSubcategoryRows] = await Promise.all([
      db
        .select()
        .from(clientCategories)
        .where(inArray(clientCategories.clientOrganisationId, visibleClientOrgIds))
        .orderBy(asc(clientCategories.name)),
      db
        .select()
        .from(clientSubcategories)
        .where(inArray(clientSubcategories.clientOrganisationId, visibleClientOrgIds))
        .orderBy(asc(clientSubcategories.name)),
    ]);
  }
  const visibleClientCategories = scope.employeeId
    ? clientCategoryRows.filter(
        (row) =>
          row.approvalStatus === "approved" ||
          row.createdByEmployeeId === scope.employeeId ||
          referencedCategoryIds.has(row.id)
      )
    : clientCategoryRows;
  const visibleClientSubcategories = scope.employeeId
    ? clientSubcategoryRows.filter(
        (row) =>
          row.approvalStatus === "approved" ||
          row.createdByEmployeeId === scope.employeeId ||
          referencedSubcategoryIds.has(row.id)
      )
    : clientSubcategoryRows;

  // Staff only see the teams they belong to; management sees every team.
  const visibleTeamIds = scope.employeeId
    ? new Set(employeeTeamRows.map((row) => row.teamId))
    : new Set(teamRows.map((row) => row.id));

  const projectRows = visibleTeamIds.size
    ? await db
        .select()
        .from(teamProjects)
        .where(inArray(teamProjects.teamId, [...visibleTeamIds]))
        .orderBy(asc(teamProjects.name))
    : [];

  const membershipNames = new Map(membershipRows.map((row) => [row.id, row.name ?? undefined]));
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
        recoveryImportId: row.recoveryImportId ?? undefined,
      });
      continue;
    }
    // Work entries are either in-house (task-linked) or client-site
    // (category + subcategory pair); the DB check enforces the XOR.
    const isInHouse = row.taskId != null;
    const isClientSite = row.clientCategoryId != null && row.clientSubcategoryId != null;
    if ((!isInHouse && !isClientSite) || !row.workLocation || !row.endAt || row.durationMinutes == null) continue;
    workEntries.push({
      id: row.id,
      employeeId: row.employeeId,
      taskId: row.taskId ?? undefined,
      subtaskId: row.subtaskId ?? undefined,
      clientCategoryId: row.clientCategoryId ?? undefined,
      clientSubcategoryId: row.clientSubcategoryId ?? undefined,
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
      recoveryImportId: row.recoveryImportId ?? undefined,
    });
  }

  const mappedTasks: Task[] = taskRows.map((t) => ({
    id: t.id,
    employeeId: t.employeeId,
    title: t.title,
    description: t.description ?? undefined,
    categoryId: t.categoryId ?? undefined,
    categoryName: t.categoryId ? categoryNames.get(t.categoryId) : undefined,
    teamId: t.teamId ?? undefined,
    projectId: t.projectId ?? undefined,
    currentStatus: t.currentStatus,
    blockerReason: t.blockerReason ?? undefined,
    droppedReason: t.droppedReason ?? undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    statusUpdatedAt: t.statusUpdatedAt.toISOString(),
    completedAt: toIso(t.completedAt),
    managementReview: t.managementReview ?? undefined,
    archivedAt: toIso(t.archivedAt),
    statusSource: t.statusSource as Task["statusSource"],
    detailsSource: t.detailsSource as Task["detailsSource"],
    recoveryImportId: t.recoveryImportId ?? undefined,
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
      archivedAt: toIso(row.archivedAt),
      statusSource: row.statusSource as Subtask["statusSource"],
      detailsSource: row.detailsSource as Subtask["detailsSource"],
      recoveryImportId: row.recoveryImportId ?? undefined,
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
    workArrangement: e.workArrangement as Employee["workArrangement"],
    employerOrganisationId: e.employerOrganisationId ?? undefined,
    employerOrganisationName: e.employerOrganisationId
      ? organisationNames.get(e.employerOrganisationId)
      : undefined,
    clientOrganisationId: e.clientOrganisationId ?? undefined,
    clientOrganisationName: e.clientOrganisationId
      ? organisationNames.get(e.clientOrganisationId)
      : undefined,
  }));

  const mappedOrganisations: Organisation[] = organisationRows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as Organisation["kind"],
    description: row.description ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const mappedClientCategories: ClientCategory[] = visibleClientCategories.map((row) => ({
    id: row.id,
    clientOrganisationId: row.clientOrganisationId,
    clientOrganisationName: organisationNames.get(row.clientOrganisationId),
    name: row.name,
    approvalStatus: row.approvalStatus as ClientCategory["approvalStatus"],
    isActive: row.isActive,
    createdByEmployeeId: row.createdByEmployeeId ?? undefined,
    createdByName: row.createdByEmployeeId ? employeeNames.get(row.createdByEmployeeId) : undefined,
    reviewedByName: row.reviewedByMembershipId ? membershipNames.get(row.reviewedByMembershipId) : undefined,
    reviewedAt: toIso(row.reviewedAt),
    reviewNote: row.reviewNote ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const clientCategoryNames = new Map(visibleClientCategories.map((row) => [row.id, row.name]));
  const mappedClientSubcategories: ClientSubcategory[] = visibleClientSubcategories.map((row) => ({
    id: row.id,
    clientOrganisationId: row.clientOrganisationId,
    clientOrganisationName: organisationNames.get(row.clientOrganisationId),
    categoryId: row.categoryId,
    categoryName: clientCategoryNames.get(row.categoryId),
    name: row.name,
    approvalStatus: row.approvalStatus as ClientSubcategory["approvalStatus"],
    isActive: row.isActive,
    createdByEmployeeId: row.createdByEmployeeId ?? undefined,
    createdByName: row.createdByEmployeeId ? employeeNames.get(row.createdByEmployeeId) : undefined,
    reviewedByName: row.reviewedByMembershipId ? membershipNames.get(row.reviewedByMembershipId) : undefined,
    reviewedAt: toIso(row.reviewedAt),
    reviewNote: row.reviewNote ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const mappedCategories: TaskCategory[] = categoryRows.map((row) => ({ id: row.id, name: row.name }));

  const mappedTeams: Team[] = teamRows
    .filter((row) => visibleTeamIds.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isActive: row.isActive,
      isDefault: row.isDefault,
      origin: row.origin as Team["origin"],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

  const mappedEmployeeTeams: EmployeeTeam[] = employeeTeamRows
    .filter((row) => visibleTeamIds.has(row.teamId))
    .map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      teamId: row.teamId,
      createdAt: row.createdAt.toISOString(),
    }));

  const mappedProjects: TeamProject[] = projectRows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description ?? undefined,
    isActive: row.isActive,
    origin: row.origin as TeamProject["origin"],
    createdByEmployeeId: row.createdByEmployeeId ?? undefined,
    createdByName: row.createdByEmployeeId
      ? employeeNames.get(row.createdByEmployeeId)
      : undefined,
    promotedAt: toIso(row.promotedAt),
    promotedByName: row.promotedByMembershipId
      ? membershipNames.get(row.promotedByMembershipId)
      : undefined,
    archivedAt: toIso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

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
    version: 2,
    employees: mappedEmployees,
    organisations: mappedOrganisations,
    clientCategories: mappedClientCategories,
    clientSubcategories: mappedClientSubcategories,
    teams: mappedTeams,
    employeeTeams: mappedEmployeeTeams,
    projects: mappedProjects,
    categories: mappedCategories,
    tasks: mappedTasks,
    subtasks: mappedSubtasks,
    progressUpdates: mappedProgress,
    entries: workEntries,
    breaks,
    statusHistory,
  };
}
