export type EmployeeId = string;
export type TaskId = string;
export type EntryId = string;
export type BreakId = string;

export type WorkLocation = "office" | "home" | "other";

export type TaskStatus = "not_started" | "ongoing" | "blocked" | "completed" | "dropped";

export type ManagementReviewStatus = "accepted" | "needs_changes";

export type ScheduleSegmentKind = "normal" | "overtime";

export interface Employee {
  id: EmployeeId;
  name: string;
  role: string;
  department: string;
  avatarUrl?: string;
}

export interface Task {
  id: TaskId;
  employeeId: EmployeeId;
  title: string;
  currentStatus: TaskStatus;
  blockerReason?: string;
  droppedReason?: string;
  createdAt: string;
  completedAt?: string;
  droppedAt?: string;
  managementReview?: {
    status: ManagementReviewStatus;
    note?: string;
    reviewedAt: string;
  };
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
  taskId: TaskId;
  description: string;
  startAt: string;
  endAt: string;
  workLocation: WorkLocation;
  /** Status recorded for this entry — the status chosen when logging (defaults to the task's status). Never changes after creation. */
  statusAtEntry: TaskStatus;
  /** Minutes inside the 09:00–17:00 working window on a working day. */
  normalMinutes: number;
  /** Minutes outside the working window, or on a non-working day. */
  overtimeMinutes: number;
  /** True when the entry was reported manually as overtime rather than timed. */
  isReportedOvertime: boolean;
  evidenceLink?: string;
  createdAt: string;
  revisions: WorkEntryRevision[];
}

export interface BreakEntry {
  id: BreakId;
  employeeId: EmployeeId;
  startAt: string;
  /** Null while the break is still running. */
  endAt: string | null;
  createdAt: string;
}

export interface StatusHistoryEvent {
  id: string;
  taskId: TaskId;
  previousStatus: TaskStatus | null;
  newStatus: TaskStatus;
  changedBy?: string;
  changeNote?: string;
  changedAt: string;
}

export interface WorkLogDatabase {
  version: 1;
  employees: Employee[];
  tasks: Task[];
  entries: WorkEntry[];
  breaks: BreakEntry[];
  statusHistory: StatusHistoryEvent[];
}
