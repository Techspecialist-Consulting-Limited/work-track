export type EmployeeId = string;
export type TaskId = string;
export type SubtaskId = string;
export type EntryId = string;
export type BreakId = string;
export type ProgressUpdateId = string;

/** "unknown" is a recorded absence of data, not a guess between office/home. */
export type WorkLocation = "office" | "home" | "other" | "unknown";

export type RecoveryStatusSource = "recorded" | "recovery_default";
export type RecoveryDetailsSource = "recorded" | "recovery_default" | "recovery_provisional";

/** The four valid task/subtask statuses. There is deliberately no "not started". */
export type TaskStatus = "ongoing" | "done" | "blocked" | "dropped";

export type ManagementReviewStatus = "accepted" | "needs_changes";

export type ScheduleSegmentKind = "normal" | "overtime";

/** 'in_house' staff report against projects/tasks; 'client_site' staff report against a client catalogue. */
export type WorkArrangement = "in_house" | "client_site";

export type OrganisationKind = "employer" | "client";

/** Catalogue lifecycle: staff suggestions start 'pending' until an admin reviews them. */
export type CatalogueApprovalStatus = "approved" | "pending" | "rejected";

export interface Employee {
  id: EmployeeId;
  name: string;
  role: string;
  department: string;
  avatarUrl?: string;
  workArrangement: WorkArrangement;
  /** Organisation that employs the employee — never the client site. */
  employerOrganisationId?: string;
  employerOrganisationName?: string;
  /** Client organisation the employee is deployed to; only set for client_site staff. */
  clientOrganisationId?: string;
  clientOrganisationName?: string;
}

export interface Organisation {
  id: string;
  name: string;
  kind: OrganisationKind;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientCategory {
  id: string;
  clientOrganisationId: string;
  clientOrganisationName?: string;
  name: string;
  approvalStatus: CatalogueApprovalStatus;
  isActive: boolean;
  createdByEmployeeId?: EmployeeId;
  createdByName?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientSubcategory {
  id: string;
  clientOrganisationId: string;
  clientOrganisationName?: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  approvalStatus: CatalogueApprovalStatus;
  isActive: boolean;
  createdByEmployeeId?: EmployeeId;
  createdByName?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCategory {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  /** 'backfill' teams were auto-created from departments and need verification. */
  origin: "admin" | "backfill";
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeTeam {
  id: string;
  employeeId: EmployeeId;
  teamId: string;
  createdAt: string;
}

export interface TeamProject {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  isActive: boolean;
  /** 'staff' projects were added by staff from the work form. */
  origin: "admin" | "staff";
  createdByEmployeeId?: EmployeeId;
  createdByName?: string;
  promotedAt?: string;
  promotedByName?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: TaskId;
  employeeId: EmployeeId;
  title: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  teamId?: string;
  projectId?: string;
  currentStatus: TaskStatus;
  blockerReason?: string;
  droppedReason?: string;
  createdAt: string;
  updatedAt: string;
  statusUpdatedAt: string;
  completedAt?: string;
  /** The status change that created this task, if known. */
  initialStatusPending?: boolean;
  managementReview?: {
    status: ManagementReviewStatus;
    note?: string;
    reviewedAt: string;
  };
  archivedAt?: string;
  /** "recovery_default" means the status was never recorded; show it as unverified. */
  statusSource?: RecoveryStatusSource;
  /** "recovery_provisional" means the details were reconstructed, not recorded. */
  detailsSource?: RecoveryDetailsSource;
  recoveryImportId?: string;
}

export interface Subtask {
  id: SubtaskId;
  taskId: TaskId;
  title: string;
  description?: string;
  status: TaskStatus;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  statusUpdatedAt: string;
  completedAt?: string;
  archivedAt?: string;
  statusSource?: RecoveryStatusSource;
  detailsSource?: RecoveryDetailsSource;
  recoveryImportId?: string;
}

export interface ProgressUpdateRevision {
  id: string;
  progressUpdateId: ProgressUpdateId;
  previousBody: string;
  revisedBy?: string;
  revisedByName?: string;
  revisedAt: string;
  revisionReason?: string;
}

export interface ProgressUpdate {
  id: ProgressUpdateId;
  taskId: TaskId;
  subtaskId?: SubtaskId;
  authorEmployeeId: EmployeeId;
  authorName?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  editedBy?: string;
  editedByName?: string;
  revisions: ProgressUpdateRevision[];
}

export interface WorkEntryRevision {
  revisedAt: string;
  previousDescription: string;
  previousStartAt: string;
  previousEndAt: string;
  previousWorkLocation: WorkLocation;
}

export interface WorkEntry {
  id: EntryId;
  employeeId: EmployeeId;
  /**
   * In-house entries are task-linked. Client-site entries have no task —
   * the database enforces exactly one of taskId or the client pair below.
   */
  taskId?: TaskId;
  /** Optional subtask within the task, when the work relates to one deliverable. */
  subtaskId?: SubtaskId;
  /** Client-site reporting: category and subcategory from the employee's assigned client catalogue. */
  clientCategoryId?: string;
  clientSubcategoryId?: string;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: WorkLocation;
  /** Minutes inside the 09:00–17:00 working window on a working day. */
  normalMinutes: number;
  /** Minutes outside the working window, or on a non-working day. */
  overtimeMinutes: number;
  /** True when the entry was reported manually as overtime rather than timed. */
  isReportedOvertime: boolean;
  evidenceLink?: string;
  createdAt: string;
  updatedAt?: string;
  revisions: WorkEntryRevision[];
  recoveryImportId?: string;
}

export interface BreakEntry {
  id: BreakId;
  employeeId: EmployeeId;
  startAt: string;
  /** Null while the break is still running. */
  endAt: string | null;
  createdAt: string;
  updatedAt?: string;
  recoveryImportId?: string;
}

export interface StatusHistoryEvent {
  id: string;
  taskId: TaskId;
  subtaskId?: SubtaskId;
  previousStatus: TaskStatus | null;
  newStatus: TaskStatus;
  changedBy?: string;
  changedByName?: string;
  changeNote?: string;
  changedAt: string;
}

export interface WorkLogDatabase {
  version: 2;
  employees: Employee[];
  organisations: Organisation[];
  clientCategories: ClientCategory[];
  clientSubcategories: ClientSubcategory[];
  teams: Team[];
  employeeTeams: EmployeeTeam[];
  projects: TeamProject[];
  categories: TaskCategory[];
  tasks: Task[];
  subtasks: Subtask[];
  progressUpdates: ProgressUpdate[];
  entries: WorkEntry[];
  breaks: BreakEntry[];
  statusHistory: StatusHistoryEvent[];
}
