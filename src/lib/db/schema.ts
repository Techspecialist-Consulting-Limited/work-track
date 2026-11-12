import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", ["staff", "hr", "chairman"]);
export const taskStatusEnum = pgEnum("task_status", ["ongoing", "done", "blocked", "dropped"]);
export const entryTypeEnum = pgEnum("entry_type", ["work", "break"]);
export const workLocationEnum = pgEnum("work_location", ["office", "home", "unknown"]);
export const workTypeEnum = pgEnum("work_type", ["normal", "overtime"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeCode: text("employee_code"),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title").notNull(),
  department: text("department").notNull().default(""),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const memberships = pgTable(
  "worktrack_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").references(() => employees.id),
    role: membershipRoleEnum("role").notNull(),
    microsoftTenantId: text("microsoft_tenant_id").notNull(),
    microsoftObjectId: text("microsoft_object_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /** Configuration permission, independent of HR/chairman reporting access. */
    isConfigAdmin: boolean("is_config_admin").notNull().default(false),
    /** Last team the staff member selected; validated against employee_teams on use. */
    activeTeamId: uuid("active_team_id").references((): AnyPgColumn => teams.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_oid_role_key").on(
      t.microsoftTenantId,
      t.microsoftObjectId,
      t.role
    ),
    index("memberships_employee_idx").on(t.employeeId),
    index("memberships_active_team_idx").on(t.activeTeamId),
    check(
      "memberships_staff_requires_employee",
      sql`role <> 'staff' OR employee_id IS NOT NULL`
    ),
  ]
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /** Exactly one default team keeps auto-provisioned staff usable. */
    isDefault: boolean("is_default").notNull().default(false),
    /** 'backfill' marks teams auto-created from employee departments, unverified. */
    origin: text("origin").notNull().default("admin"),
    createdByMembershipId: uuid("created_by_membership_id").references((): AnyPgColumn => memberships.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("teams_name_key").on(sql`lower(${t.name})`),
    uniqueIndex("teams_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    index("teams_active_idx").on(t.isActive),
    check("teams_name_not_blank", sql`length(btrim(name)) > 0`),
    check("teams_origin_check", sql`origin IN ('admin', 'backfill')`),
  ]
);

export const employeeTeams = pgTable(
  "employee_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_teams_employee_team_key").on(t.employeeId, t.teamId),
    index("employee_teams_team_idx").on(t.teamId),
  ]
);

export const teamProjects = pgTable(
  "team_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /** 'staff' projects were added from the staff form and may await promotion. */
    origin: text("origin").notNull().default("admin"),
    createdByEmployeeId: uuid("created_by_employee_id").references(() => employees.id),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedByMembershipId: uuid("promoted_by_membership_id").references(() => memberships.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("team_projects_team_name_key")
      .on(t.teamId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    index("team_projects_team_idx").on(t.teamId, t.isActive),
    check("team_projects_name_not_blank", sql`length(btrim(name)) > 0`),
    check("team_projects_origin_check", sql`origin IN ('admin', 'staff')`),
  ]
);

export const taskCategories = pgTable(
  "task_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("task_categories_name_key").on(t.name)]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    categoryId: uuid("category_id").references(() => taskCategories.id),
    /** Team the task belongs to; null on legacy tasks created before teams existed. */
    teamId: uuid("team_id").references(() => teams.id),
    /** Catalog project this task represents; null on legacy tasks. */
    projectId: uuid("project_id").references(() => teamProjects.id),
    title: text("title").notNull(),
    description: text("description"),
    currentStatus: taskStatusEnum("current_status").notNull().default("ongoing"),
    blockerReason: text("blocker_reason"),
    droppedReason: text("dropped_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
    managementReview: jsonb("management_review").$type<{
      status: "accepted" | "needs_changes";
      note?: string;
      reviewedAt: string;
    } | null>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    /** 'recovery_default' when the status was not recorded and a default was used. */
    statusSource: text("status_source").notNull().default("recorded"),
    /** 'recovery_provisional' when the description/details were never recorded. */
    detailsSource: text("details_source").notNull().default("recorded"),
    recoveryImportId: uuid("recovery_import_id").references(() => recoveryImports.id),
    ...timestamps,
  },
  (t) => [
    index("tasks_employee_idx").on(t.employeeId),
    index("tasks_category_idx").on(t.categoryId),
    index("tasks_team_idx").on(t.teamId),
    index("tasks_project_idx").on(t.projectId),
    uniqueIndex("tasks_employee_project_key")
      .on(t.employeeId, t.projectId)
      .where(sql`${t.projectId} IS NOT NULL AND ${t.archivedAt} IS NULL`),
    index("tasks_recovery_import_idx").on(t.recoveryImportId),
    check(
      "tasks_status_source_check",
      sql`status_source IN ('recorded', 'recovery_default')`
    ),
    check(
      "tasks_details_source_check",
      sql`details_source IN ('recorded', 'recovery_default', 'recovery_provisional')`
    ),
  ]
);

export const taskSubtasks = pgTable(
  "task_subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("ongoing"),
    displayOrder: integer("display_order").notNull().default(0),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    statusSource: text("status_source").notNull().default("recorded"),
    detailsSource: text("details_source").notNull().default("recorded"),
    recoveryImportId: uuid("recovery_import_id").references(() => recoveryImports.id),
    ...timestamps,
  },
  (t) => [
    index("task_subtasks_task_order_idx").on(t.taskId, t.displayOrder),
    index("task_subtasks_recovery_import_idx").on(t.recoveryImportId),
    check("task_subtasks_title_not_blank", sql`length(btrim(title)) > 0`),
    check(
      "task_subtasks_status_source_check",
      sql`status_source IN ('recorded', 'recovery_default')`
    ),
    check(
      "task_subtasks_details_source_check",
      sql`details_source IN ('recorded', 'recovery_default', 'recovery_provisional')`
    ),
  ]
);

export const taskProgressUpdates = pgTable(
  "task_progress_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    subtaskId: uuid("subtask_id").references(() => taskSubtasks.id),
    authorEmployeeId: uuid("author_employee_id")
      .notNull()
      .references(() => employees.id),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editedByMembershipId: uuid("edited_by_membership_id").references(() => memberships.id),
    ...timestamps,
  },
  (t) => [
    index("task_progress_updates_task_idx").on(t.taskId),
    index("task_progress_updates_subtask_idx").on(t.subtaskId),
    check("task_progress_updates_body_not_blank", sql`length(btrim(body)) > 0`),
  ]
);

export const taskProgressUpdateRevisions = pgTable(
  "task_progress_update_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    progressUpdateId: uuid("progress_update_id")
      .notNull()
      .references(() => taskProgressUpdates.id),
    previousBody: text("previous_body").notNull(),
    revisedByMembershipId: uuid("revised_by_membership_id").references(() => memberships.id),
    revisedAt: timestamp("revised_at", { withTimezone: true }).notNull().defaultNow(),
    revisionReason: text("revision_reason"),
  },
  (t) => [index("task_progress_update_revisions_update_idx").on(t.progressUpdateId)]
);

export const taskStatusHistory = pgTable(
  "task_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    previousStatus: taskStatusEnum("previous_status"),
    newStatus: taskStatusEnum("new_status").notNull(),
    changedByMembershipId: uuid("changed_by_membership_id").references(() => memberships.id),
    changeNote: text("change_note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_status_history_task_idx").on(t.taskId)]
);

export const subtaskStatusHistory = pgTable(
  "subtask_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subtaskId: uuid("subtask_id")
      .notNull()
      .references(() => taskSubtasks.id),
    previousStatus: taskStatusEnum("previous_status"),
    newStatus: taskStatusEnum("new_status").notNull(),
    changedByMembershipId: uuid("changed_by_membership_id").references(() => memberships.id),
    changeNote: text("change_note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subtask_status_history_subtask_idx").on(t.subtaskId)]
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    entryType: entryTypeEnum("entry_type").notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    subtaskId: uuid("subtask_id").references(() => taskSubtasks.id),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** Null while a break is still running. */
    endAt: timestamp("end_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    normalMinutes: integer("normal_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    workLocation: workLocationEnum("work_location"),
    workType: workTypeEnum("work_type"),
    evidenceLink: text("evidence_link"),
    isReportedOvertime: boolean("is_reported_overtime").notNull().default(false),
    revisionCount: integer("revision_count").notNull().default(0),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    updatedByMembershipId: uuid("updated_by_membership_id").references(() => memberships.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    recoveryImportId: uuid("recovery_import_id").references(() => recoveryImports.id),
    ...timestamps,
  },
  (t) => [
    index("time_entries_employee_start_idx").on(t.employeeId, t.startAt),
    index("time_entries_start_idx").on(t.startAt),
    index("time_entries_task_idx").on(t.taskId),
    index("time_entries_subtask_idx").on(t.subtaskId),
    index("time_entries_recovery_import_idx").on(t.recoveryImportId),
    check(
      "time_entries_end_after_start",
      sql`end_at IS NULL OR end_at > start_at`
    ),
    check(
      "time_entries_work_fields",
      sql`entry_type <> 'work' OR (task_id IS NOT NULL AND work_location IS NOT NULL AND work_type IS NOT NULL AND end_at IS NOT NULL AND duration_minutes IS NOT NULL)`
    ),
    check(
      "time_entries_break_fields",
      sql`entry_type <> 'break' OR (task_id IS NULL AND subtask_id IS NULL AND work_location IS NULL AND work_type IS NULL)`
    ),
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorMembershipId: uuid("actor_membership_id").references(() => memberships.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId)]
);

export const recoveryImports = pgTable(
  "recovery_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importKey: text("import_key").notNull(),
    sourceFile: text("source_file").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sourceExportedAt: timestamp("source_exported_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recovery_imports_key_key").on(t.importKey)]
);

export const recoveryImportRecords = pgTable(
  "recovery_import_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => recoveryImports.id),
    entityType: text("entity_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetId: uuid("target_id"),
    canonicalSourceId: uuid("canonical_source_id"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recovery_import_records_unique").on(t.importId, t.entityType, t.sourceId),
    index("recovery_import_records_target_idx").on(t.entityType, t.targetId),
  ]
);

export const invitations = pgTable(
  "worktrack_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: membershipRoleEnum("role").notNull(),
    invitedByMembershipId: uuid("invited_by_membership_id").references(() => memberships.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("invitations_email_role_key").on(t.email, t.role)]
);

export const worktrackSettings = pgTable("worktrack_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
