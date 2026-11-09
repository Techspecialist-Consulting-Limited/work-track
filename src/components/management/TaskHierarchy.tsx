"use client";

import { useState } from "react";
import { ChevronDown, History, ListChecks } from "lucide-react";
import { StatusBadge } from "@/components/worklog/StatusBadge";
import {
  getDaySummary,
  getProgressUpdatesForTask,
  getSubtasksForTask,
  type DaySummary,
} from "@/lib/worklog/selectors";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import type {
  Employee,
  ProgressUpdate,
  Subtask,
  Task,
  WorkEntry,
  WorkLogDatabase,
} from "@/lib/worklog/types";

export type VerificationLevel = "verified" | "unverified" | "provisional";

export interface TaskVerification {
  level: VerificationLevel;
  label: string;
  title: string;
}

export interface HierarchySubtask {
  subtask: Subtask;
  entries: WorkEntry[];
  minutes: number;
  entryCount: number;
  progressUpdates: ProgressUpdate[];
  verification: TaskVerification;
}

export interface HierarchyTask {
  task: Task;
  employee: Employee;
  entries: WorkEntry[];
  minutes: number;
  entryCount: number;
  directEntryCount: number;
  subtasks: HierarchySubtask[];
  progressUpdates: ProgressUpdate[];
  verification: TaskVerification;
  firstStartAt: string;
}

export interface EmployeeHierarchy {
  employee: Employee;
  day: DaySummary;
  tasks: HierarchyTask[];
  legacyTasks: Task[];
  verification: TaskVerification;
}

export interface RecoveredDaySummary {
  staffCount: number;
  entryCount: number;
  workMinutes: number;
  breakMinutes: number;
  taskCount: number;
}

function minutesOf(entries: WorkEntry[]): number {
  return entries.reduce((total, entry) => total + durationMinutes(entry.startAt, entry.endAt), 0);
}

export function verificationOf(source: {
  statusSource?: Task["statusSource"];
  detailsSource?: Task["detailsSource"];
}): TaskVerification {
  if (source.detailsSource === "recovery_provisional") {
    return {
      level: "provisional",
      label: "Provisional",
      title: "This subtask was reconstructed from the task title. No subtask record, description or status was recovered.",
    };
  }
  if (source.statusSource === "recovery_default" || source.detailsSource === "recovery_default") {
    return {
      level: "unverified",
      label: "Status unverified",
      title: "Recovered from audit metadata. The task details and status were never recorded.",
    };
  }
  return {
    level: "verified",
    label: "Verified",
    title: "The task status and details were recorded in WorkTrack.",
  };
}

function summaryVerification(tasks: HierarchyTask[]): TaskVerification {
  if (tasks.some((task) => task.verification.level === "provisional")) {
    return {
      level: "provisional",
      label: "Provisional",
      title: "Some records were reconstructed and need verification.",
    };
  }
  if (tasks.some((task) => task.verification.level === "unverified")) {
    return {
      level: "unverified",
      label: "Unverified",
      title: "Some task statuses were recovered without a recorded status.",
    };
  }
  return {
    level: "verified",
    label: "Verified",
    title: "All tasks in this view have recorded statuses and details.",
  };
}

/** Tasks with timed work on this day, with their subtasks, progress and provenance. */
export function buildEmployeeHierarchy(
  db: WorkLogDatabase,
  employeeId: string,
  dateKey: string
): EmployeeHierarchy | null {
  const employee = db.employees.find((row) => row.id === employeeId);
  if (!employee) return null;

  const day = getDaySummary(db, employeeId, dateKey);
  const entriesByTask = new Map<string, WorkEntry[]>();
  for (const entry of day.entries) {
    const list = entriesByTask.get(entry.taskId) ?? [];
    list.push(entry);
    entriesByTask.set(entry.taskId, list);
  }

  const tasks: HierarchyTask[] = [];
  for (const [taskId, entries] of entriesByTask) {
    const task = db.tasks.find((row) => row.id === taskId);
    if (!task) continue;

    const allUpdates = getProgressUpdatesForTask(db, taskId);
    const subtasks = getSubtasksForTask(db, taskId).map((subtask) => {
      const subtaskEntries = entries.filter((entry) => entry.subtaskId === subtask.id);
      return {
        subtask,
        entries: subtaskEntries,
        minutes: minutesOf(subtaskEntries),
        entryCount: subtaskEntries.length,
        progressUpdates: allUpdates.filter((update) => update.subtaskId === subtask.id),
        verification: verificationOf(subtask),
      } satisfies HierarchySubtask;
    });

    tasks.push({
      task,
      employee,
      entries,
      minutes: minutesOf(entries),
      entryCount: entries.length,
      directEntryCount: entries.filter((entry) => !entry.subtaskId).length,
      subtasks,
      progressUpdates: allUpdates.filter((update) => !update.subtaskId),
      verification: verificationOf(task),
      firstStartAt: entries.reduce((earliest, entry) => (entry.startAt < earliest ? entry.startAt : earliest), entries[0].startAt),
    });
  }
  tasks.sort((a, b) => a.firstStartAt.localeCompare(b.firstStartAt));

  // Tasks created for this day that never received any timed work (legacy records).
  const tasksWithAnyEntry = new Set(db.entries.map((entry) => entry.taskId));
  const legacyTasks = db.tasks
    .filter(
      (task) =>
        task.employeeId === employeeId &&
        !tasksWithAnyEntry.has(task.id) &&
        dateKeyOf(task.createdAt) === dateKey
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { employee, day, tasks, legacyTasks, verification: summaryVerification(tasks) };
}

/** All employees with timed work on the selected day, for the By Tasks view. */
export function buildDayHierarchies(db: WorkLogDatabase, dateKey: string): EmployeeHierarchy[] {
  return db.employees
    .map((employee) => buildEmployeeHierarchy(db, employee.id, dateKey))
    .filter((hierarchy): hierarchy is EmployeeHierarchy => hierarchy !== null && hierarchy.tasks.length > 0)
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}

/** Total of only the recovered records for the selected day, kept separate from team totals. */
export function getRecoveredDaySummary(db: WorkLogDatabase, dateKey: string): RecoveredDaySummary | null {
  const entries = db.entries.filter(
    (entry) => entry.recoveryImportId && dateKeyOf(entry.startAt) === dateKey
  );
  if (entries.length === 0) return null;

  const breaks = db.breaks.filter(
    (brk) => brk.recoveryImportId && dateKeyOf(brk.startAt) === dateKey
  );
  const breakMinutes = breaks.reduce(
    (total, brk) => (brk.endAt ? total + durationMinutes(brk.startAt, brk.endAt) : total),
    0
  );

  return {
    staffCount: new Set(entries.map((entry) => entry.employeeId)).size,
    entryCount: entries.length,
    workMinutes: minutesOf(entries),
    breakMinutes,
    taskCount: new Set(entries.map((entry) => entry.taskId)).size,
  };
}

export function VerificationBadge({
  verification,
  className = "",
}: {
  verification: TaskVerification;
  className?: string;
}) {
  const styles =
    verification.level === "provisional"
      ? "bg-[#F3EEFF] text-[#5A3ED0]"
      : verification.level === "unverified"
        ? "bg-[#FFF4E0] text-[#9A6200]"
        : "bg-[#EAF8F0] text-[#15803D]";
  return (
    <span
      title={verification.title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${styles} ${className}`}
    >
      {verification.label}
    </span>
  );
}

function ProgressList({ updates, label }: { updates: ProgressUpdate[]; label: string }) {
  if (updates.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">{label}</p>
      <ul className="mt-1 space-y-1">
        {updates.slice(0, 2).map((update) => (
          <li key={update.id} className="rounded-lg bg-[#F7F5FE] px-2 py-1.5 text-[11px] leading-4 text-[#4A4665]">
            <span className="font-semibold text-[#39364F]">{update.authorName ?? "Update"}:</span>{" "}
            <span className="whitespace-pre-wrap break-words">{update.body}</span>
          </li>
        ))}
      </ul>
      {updates.length > 2 ? (
        <p className="mt-1 text-[10px] font-medium text-[#8B8B9A]">+{updates.length - 2} more update(s)</p>
      ) : null}
    </div>
  );
}

function SubtaskRow({ item }: { item: HierarchySubtask }) {
  const provisional = item.verification.level === "provisional";
  return (
    <li className="rounded-xl border border-[#ECEBF3] bg-[#FCFBFF] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-[#17172F]">{item.subtask.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-4 text-[#777A91]">
            {item.subtask.description ?? (provisional ? "No description was recovered." : "No description.")}
          </p>
          <p className="mt-1 text-[10px] font-medium text-[#8B8B9A]">
            {item.entryCount > 0
              ? `${formatMinutes(item.minutes)} · ${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`
              : "No time logged to this subtask"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={item.subtask.status} />
          {item.verification.level !== "verified" ? <VerificationBadge verification={item.verification} /> : null}
        </div>
      </div>
      <ProgressList updates={item.progressUpdates} label="Progress" />
    </li>
  );
}

export function TaskGroupCard({
  item,
  showEmployee = false,
  defaultOpen = false,
  className = "",
}: {
  item: HierarchyTask;
  showEmployee?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className={`rounded-2xl border border-[#E7E6F0] bg-white shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 rounded-2xl px-4 py-3.5 text-left transition hover:bg-[#FCFBFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
      >
        <span className="min-w-0 flex-1">
          {showEmployee ? (
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">
              {item.employee.name}
            </span>
          ) : null}
          <span className="block break-words text-sm font-semibold leading-5 text-[#17172F]">{item.task.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[#777A91]">
            <span>{formatMinutes(item.minutes)}</span>
            <span aria-hidden="true">·</span>
            <span>{item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</span>
            <span aria-hidden="true">·</span>
            <span>
              {item.subtasks.length} {item.subtasks.length === 1 ? "subtask" : "subtasks"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={item.task.currentStatus} />
          {item.verification.level !== "verified" ? <VerificationBadge verification={item.verification} /> : null}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-[#DC2626] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-t border-[#F0EEF5] px-4 pb-4 pt-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">Details</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-[#53506B]">
              {item.task.description ??
                (item.verification.level === "verified" ? "No description." : "No description was recorded.")}
            </p>
            {item.task.blockerReason ? (
              <p className="mt-1.5 rounded-lg bg-[#FFF6E5] px-2 py-1 text-[11px] text-[#8A5A00]">
                Blocked: {item.task.blockerReason}
              </p>
            ) : null}
            {item.task.droppedReason ? (
              <p className="mt-1.5 rounded-lg bg-[#FEF3F2] px-2 py-1 text-[11px] text-[#B42318]">
                Dropped: {item.task.droppedReason}
              </p>
            ) : null}
          </div>

          <ProgressList updates={item.progressUpdates} label="Task progress" />

          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">
              Subtasks ({item.subtasks.length})
            </p>
            {item.subtasks.length === 0 ? (
              <p className="mt-1 rounded-xl bg-[#F7F7FC] px-3 py-2.5 text-[11px] text-[#777A91]">
                No subtasks recorded.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {item.subtasks.map((subtask) => (
                  <SubtaskRow key={subtask.subtask.id} item={subtask} />
                ))}
              </ul>
            )}
            {item.directEntryCount > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-[#8B8B9A]">
                <ListChecks size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                {item.directEntryCount} work {item.directEntryCount === 1 ? "entry was" : "entries were"} logged on
                the task itself, not on a subtask.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function TaskGroupList({
  items,
  showEmployee = false,
  emptyMessage = "No timed tasks for this date.",
  className = "",
}: {
  items: HierarchyTask[];
  showEmployee?: boolean;
  emptyMessage?: string;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <p className={`rounded-2xl border border-[#E7E6F0] bg-white px-4 py-6 text-center text-xs text-[#777A91] ${className}`}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul className={`space-y-2.5 ${className}`}>
      {items.map((item) => (
        <TaskGroupCard key={`${item.employee.id}:${item.task.id}`} item={item} showEmployee={showEmployee} />
      ))}
    </ul>
  );
}

export function LegacyTaskList({ tasks, className = "" }: { tasks: Task[]; className?: string }) {
  if (tasks.length === 0) return null;
  return (
    <section className={className}>
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#39364F]">
        <History size={14} aria-hidden="true" />
        Legacy no-time records
      </h3>
      <p className="mt-1 text-[11px] leading-4 text-[#777A91]">
        Tasks created for this day that never received a time entry. They are kept for history and excluded from
        totals.
      </p>
      <ul className="mt-2 space-y-2">
        {tasks.map((task) => {
          const verification = verificationOf(task);
          return (
            <li key={task.id} className="rounded-xl border border-[#ECEBF3] bg-[#FCFBFF] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-xs font-semibold text-[#17172F]">{task.title}</p>
                  <p className="mt-0.5 text-[11px] text-[#777A91]">
                    Created {formatTime(task.createdAt)} · no time logged
                  </p>
                </div>
                {verification.level !== "verified" ? <VerificationBadge verification={verification} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RecoveredDayPanel({
  summary,
  dateKey,
  className = "",
}: {
  summary: RecoveredDaySummary;
  dateKey: string;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#DCD2FB] bg-[#F8F5FF] px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#5A3ED0]">
          <History size={11} aria-hidden="true" />
          Recovered
        </span>
        <p className="text-xs font-semibold text-[#39364F]">{formatDateLabel(dateKey)}</p>
        <p className="text-[11px] text-[#6B6785]">shown separately from team totals</p>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-[#53506B]">
        <div className="flex items-baseline gap-1">
          <dt className="sr-only">Staff</dt>
          <dd className="font-bold text-[#17172F]">{summary.staffCount}</dd>
          <span>staff</span>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="sr-only">Entries</dt>
          <dd className="font-bold text-[#17172F]">{summary.entryCount}</dd>
          <span>active entries</span>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="sr-only">Work time</dt>
          <dd className="font-bold text-[#17172F]">{formatMinutes(summary.workMinutes)}</dd>
          <span>work</span>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="sr-only">Break time</dt>
          <dd className="font-bold text-[#17172F]">{formatMinutes(summary.breakMinutes)}</dd>
          <span>break</span>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] leading-4 text-[#6B6785]">
        Imported from recovered audit data. Locations, descriptions and statuses were not recorded, so task statuses
        are shown as unverified and the title-derived subtasks are provisional. Voided entries are preserved and
        excluded from these totals.
      </p>
    </section>
  );
}
