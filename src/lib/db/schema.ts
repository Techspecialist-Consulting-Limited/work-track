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
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", ["staff", "hr", "chairman"]);
export const taskStatusEnum = pgEnum("task_status", [
  "not_started",
  "ongoing",
  "blocked",
  "completed",
  "dropped",
]);
export const entryTypeEnum = pgEnum("entry_type", ["work", "break"]);
export const workLocationEnum = pgEnum("work_location", ["office", "home"]);
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
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_oid_role_key").on(
      t.microsoftTenantId,
      t.microsoftObjectId,
      t.role
    ),
    index("memberships_employee_idx").on(t.employeeId),
    check(
      "memberships_staff_requires_employee",
      sql`role <> 'staff' OR employee_id IS NOT NULL`
    ),
  ]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    title: text("title").notNull(),
    description: text("description"),
    currentStatus: taskStatusEnum("current_status").notNull().default("not_started"),
    blockerReason: text("blocker_reason"),
    droppedReason: text("dropped_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    managementReview: jsonb("management_review").$type<{
      status: "accepted" | "needs_changes";
      note?: string;
      reviewedAt: string;
    } | null>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("tasks_employee_idx").on(t.employeeId)]
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

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    entryType: entryTypeEnum("entry_type").notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** Null while a break is still running. */
    endAt: timestamp("end_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    normalMinutes: integer("normal_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    workLocation: workLocationEnum("work_location"),
    workType: workTypeEnum("work_type"),
    taskStatusSnapshot: taskStatusEnum("task_status_snapshot"),
    evidenceLink: text("evidence_link"),
    isReportedOvertime: boolean("is_reported_overtime").notNull().default(false),
    revisionCount: integer("revision_count").notNull().default(0),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => [
    index("time_entries_employee_start_idx").on(t.employeeId, t.startAt),
    index("time_entries_start_idx").on(t.startAt),
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
      sql`entry_type <> 'break' OR (task_id IS NULL AND work_location IS NULL AND work_type IS NULL)`
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

export const worktrackSettings = pgTable("worktrack_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
