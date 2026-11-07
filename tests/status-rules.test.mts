import assert from "node:assert/strict";
import test from "node:test";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "../src/lib/worklog/config";
import {
  checkParentCanBeDone,
  checkSubtaskStatusChange,
  isClosedStatus,
  isOpenStatus,
  isTaskStatus,
  nextCompletedAt,
  subtaskSummary,
  validateSubtaskBelongsToTask,
} from "../src/lib/worklog/status-rules";
import type { Subtask, Task, TaskStatus } from "../src/lib/worklog/types";

function subtask(overrides: Partial<Subtask> & { status: TaskStatus }): Subtask {
  return {
    id: "sub-1",
    taskId: "task-1",
    title: "A subtask",
    displayOrder: 0,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    statusUpdatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> & { currentStatus: TaskStatus }): Task {
  return {
    id: "task-1",
    employeeId: "emp-1",
    title: "A task",
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    statusUpdatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

test("only Ongoing, Done, Blocked and Dropped are valid statuses", () => {
  assert.deepEqual([...TASK_STATUSES].sort(), ["blocked", "done", "dropped", "ongoing"]);
  assert.deepEqual(Object.keys(TASK_STATUS_LABELS).sort(), ["blocked", "done", "dropped", "ongoing"]);
  for (const status of TASK_STATUSES) assert.equal(isTaskStatus(status), true);
  assert.equal(isTaskStatus("not_started"), false);
  assert.equal(isTaskStatus("completed"), false);
  assert.equal(isTaskStatus(""), false);
  assert.equal(isTaskStatus(null), false);
});

test("open and closed status helpers", () => {
  assert.equal(isOpenStatus("ongoing"), true);
  assert.equal(isOpenStatus("blocked"), true);
  assert.equal(isOpenStatus("done"), false);
  assert.equal(isOpenStatus("dropped"), false);
  assert.equal(isClosedStatus("done"), true);
  assert.equal(isClosedStatus("dropped"), true);
  assert.equal(isClosedStatus("ongoing"), false);
});

test("a parent with no subtasks can be marked Done", () => {
  assert.deepEqual(checkParentCanBeDone([]), { ok: true });
});

test("a parent can be marked Done when every subtask is Done or Dropped", () => {
  const checklist = [
    subtask({ id: "a", status: "done" }),
    subtask({ id: "b", status: "dropped" }),
    subtask({ id: "c", status: "done" }),
  ];
  assert.deepEqual(checkParentCanBeDone(checklist), { ok: true });
});

test("a parent cannot be marked Done while any subtask is Ongoing or Blocked", () => {
  const result = checkParentCanBeDone([
    subtask({ id: "a", status: "done" }),
    subtask({ id: "b", status: "ongoing", title: "Write the migration" }),
    subtask({ id: "c", status: "blocked", title: "Deploy to staging" }),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /Write the migration/);
  assert.match(result.message, /Deploy to staging/);
});

test("status changes never auto-close the parent and completion timestamps follow status", () => {
  const now = "2026-11-06T12:00:00.000Z";
  assert.equal(nextCompletedAt("done", now), now);
  assert.equal(nextCompletedAt("ongoing", now), undefined);
  assert.equal(nextCompletedAt("blocked", now), undefined);
  assert.equal(nextCompletedAt("dropped", now), undefined);
});

test("subtask status changes respect the parent task", () => {
  const droppedParent = task({ currentStatus: "dropped" });
  const doneParent = task({ currentStatus: "done" });
  const openParent = task({ currentStatus: "ongoing" });
  const doneSubtask = subtask({ status: "done" });

  assert.equal(checkSubtaskStatusChange(droppedParent, subtask({ status: "ongoing" }), "done").ok, false);
  assert.equal(checkSubtaskStatusChange(doneParent, doneSubtask, "ongoing").ok, false);
  assert.equal(checkSubtaskStatusChange(openParent, subtask({ status: "ongoing" }), "done").ok, true);
  assert.equal(checkSubtaskStatusChange(openParent, doneSubtask, "blocked").ok, true);
});

test("invalid subtask statuses are rejected at the rule boundary", () => {
  const result = checkSubtaskStatusChange(
    task({ currentStatus: "ongoing" }),
    subtask({ status: "ongoing" }),
    "completed" as TaskStatus
  );
  assert.equal(result.ok, false);
});

test("subtask summary counts settled work without changing anything", () => {
  assert.deepEqual(subtaskSummary([]), {
    total: 0,
    done: 0,
    dropped: 0,
    label: "No subtasks",
    allSettled: false,
  });
  const summary = subtaskSummary([
    subtask({ id: "a", status: "done" }),
    subtask({ id: "b", status: "dropped" }),
    subtask({ id: "c", status: "ongoing" }),
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.done, 1);
  assert.equal(summary.dropped, 1);
  assert.equal(summary.allSettled, false);
  assert.equal(summary.label, "1 of 3 subtasks complete");
});

test("a subtask must belong to the selected task", () => {
  assert.equal(validateSubtaskBelongsToTask(undefined, "task-1").ok, false);
  assert.equal(validateSubtaskBelongsToTask({ taskId: "task-2" }, "task-1").ok, false);
  assert.equal(validateSubtaskBelongsToTask({ taskId: "task-1" }, "task-1").ok, true);
});
