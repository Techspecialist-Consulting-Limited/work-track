import { TASK_STATUSES } from "./config";
import type { Subtask, Task, TaskStatus } from "./types";

export type StatusCheck = { ok: true } | { ok: false; message: string };

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as string[]).includes(value);
}

/** Tasks/subtasks that can accept new work. Done and Dropped must be reopened first. */
export function isOpenStatus(status: TaskStatus): boolean {
  return status === "ongoing" || status === "blocked";
}

/** Completed/dropped tasks are logically closed; new work requires an explicit reopen. */
export function isClosedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "dropped";
}

/**
 * Parent tasks may only be marked Done when every subtask is Done or Dropped.
 * An Ongoing or Blocked subtask blocks parent completion.
 */
export function checkParentCanBeDone(subtasks: Pick<Subtask, "status" | "title">[]): StatusCheck {
  const incomplete = subtasks.filter((subtask) => subtask.status === "ongoing" || subtask.status === "blocked");
  if (incomplete.length === 0) return { ok: true };
  const names = incomplete.slice(0, 3).map((subtask) => `“${subtask.title}”`).join(", ");
  const remaining = incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : "";
  return {
    ok: false,
    message: `Finish or drop the remaining subtasks before marking this task Done: ${names}${remaining}.`,
  };
}

/**
 * A subtask may only be reopened after its parent task has been reopened.
 * Sibling subtasks are never touched by a status change.
 */
export function checkSubtaskStatusChange(
  task: Pick<Task, "currentStatus">,
  subtask: Pick<Subtask, "status">,
  next: TaskStatus
): StatusCheck {
  if (!isTaskStatus(next)) return { ok: false, message: "Choose a valid status." };
  if (task.currentStatus === "dropped" && next !== "dropped") {
    return { ok: false, message: "Reopen the main task before changing its subtasks." };
  }
  if (task.currentStatus === "done" && subtask.status === "done" && next !== "done") {
    return { ok: false, message: "Reopen the main task before reopening one of its subtasks." };
  }
  return { ok: true };
}

/** Completion timestamps belong to the status change, never to a work interval. */
export function nextCompletedAt(status: TaskStatus, now: string): string | undefined {
  return status === "done" ? now : undefined;
}

export function subtaskSummary(subtasks: Pick<Subtask, "status">[]): {
  total: number;
  done: number;
  dropped: number;
  label: string;
  allSettled: boolean;
} {
  const total = subtasks.length;
  const done = subtasks.filter((subtask) => subtask.status === "done").length;
  const dropped = subtasks.filter((subtask) => subtask.status === "dropped").length;
  const allSettled = total > 0 && done + dropped === total;
  return {
    total,
    done,
    dropped,
    label: total === 0 ? "No subtasks" : `${done} of ${total} subtasks complete`,
    allSettled,
  };
}

export function validateSubtaskBelongsToTask(
  subtask: Pick<Subtask, "taskId"> | undefined,
  taskId: string
): StatusCheck {
  if (!subtask) return { ok: false, message: "Choose a subtask that belongs to the selected task." };
  if (subtask.taskId !== taskId) return { ok: false, message: "That subtask does not belong to the selected task." };
  return { ok: true };
}
