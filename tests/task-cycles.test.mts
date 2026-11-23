import assert from "node:assert/strict";
import test from "node:test";
import {
  getLatestPriorCycle,
  getSubtasksForDate,
  getTaskCycleForDate,
  isValidWorkDate,
  normalizeTaskTitle,
} from "../src/lib/worklog/task-cycles";
import type { Subtask, TaskCycle, WorkLogDatabase } from "../src/lib/worklog/types";

function subtask(
  id: string,
  title: string,
  workDate?: string,
  displayOrder = 0,
  taskId = "task-1"
): Subtask {
  return {
    id,
    taskId,
    title,
    status: "done",
    displayOrder,
    createdAt: "2026-11-20T08:00:00.000Z",
    updatedAt: "2026-11-20T08:00:00.000Z",
    statusUpdatedAt: "2026-11-20T08:00:00.000Z",
    workDate,
  };
}

function cycle(workDate: string, finishedAt?: string): TaskCycle {
  return {
    id: `cycle-${workDate}`,
    taskId: "task-1",
    workDate,
    finishedAt,
    createdAt: `${workDate}T00:00:00.000Z`,
    updatedAt: `${workDate}T00:00:00.000Z`,
  };
}

function database(subtasks: Subtask[], cycles: TaskCycle[]): WorkLogDatabase {
  return {
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
    subtasks,
    taskCycles: cycles,
    progressUpdates: [],
    entries: [],
    breaks: [],
    attachments: [],
    statusHistory: [],
  };
}

test("free-title task keys ignore case, edge spaces and repeated whitespace", () => {
  assert.equal(normalizeTaskTitle("  Monthly   Report "), "monthly report");
  assert.equal(normalizeTaskTitle("MONTHLY report"), "monthly report");
});

test("work dates are real YYYY-MM-DD calendar dates", () => {
  assert.equal(isValidWorkDate("2026-11-23"), true);
  assert.equal(isValidWorkDate("2026-02-30"), false);
  assert.equal(isValidWorkDate("2026-11-23T00:00:00Z"), false);
  assert.equal(isValidWorkDate(null), false);
});

test("subtasks are scoped to the selected working date", () => {
  const db = database(
    [
      subtask("a", "Yesterday", "2026-11-22", 0),
      subtask("b", "Today", "2026-11-23", 0),
      subtask("legacy", "Undated", undefined, 1),
      subtask("other", "Another task", "2026-11-23", 0, "task-2"),
    ],
    []
  );
  const today = getSubtasksForDate(db.subtasks, "task-1", "2026-11-23");
  assert.deepEqual(today.map((row) => row.id), ["b", "legacy"]);
  assert.equal(today[0].status, "done");
});

test("the previous checklist is the newest earlier cycle containing subtasks", () => {
  const db = database(
    [
      subtask("a", "Old", "2026-11-20"),
      subtask("b", "Recent", "2026-11-22"),
    ],
    [cycle("2026-11-20"), cycle("2026-11-21"), cycle("2026-11-22")]
  );
  assert.equal(getLatestPriorCycle(db, "task-1", "2026-11-23")?.workDate, "2026-11-22");
  assert.equal(getLatestPriorCycle(db, "unknown", "2026-11-23"), undefined);
  assert.equal(getTaskCycleForDate(db, "task-1", "2026-11-23"), undefined);
});
