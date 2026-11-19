import assert from "node:assert/strict";
import test from "node:test";
import { getDaySummary, getOpenTasks, filterEntries } from "../src/lib/worklog/selectors";
import {
  validateDescription,
  validateEvidenceLink,
  validateProgressBody,
  validateReason,
  validateSubtaskTitle,
  validateTaskTitle,
  validateEntryTimes,
} from "../src/lib/worklog/validation";
import { findOverlappingWorkEntries, makeWorkSlots } from "../src/components/worklog/shared";
import type {
  BreakEntry,
  Task,
  TaskStatus,
  WorkEntry,
  WorkLogDatabase,
} from "../src/lib/worklog/types";

function task(id: string, status: TaskStatus): Task {
  return {
    id,
    employeeId: "emp-1",
    title: `Task ${id}`,
    currentStatus: status,
    createdAt: "2026-11-02T08:00:00.000Z",
    updatedAt: "2026-11-02T08:00:00.000Z",
    statusUpdatedAt: "2026-11-02T08:00:00.000Z",
  };
}

function entry(id: string, taskId: string, startAt: string, endAt: string, normalMinutes: number): WorkEntry {
  return {
    id,
    employeeId: "emp-1",
    taskId,
    description: "Did the work",
    startAt,
    endAt,
    workLocation: "office",
    normalMinutes,
    overtimeMinutes: 0,
    isReportedOvertime: false,
    createdAt: startAt,
    revisions: [],
  };
}

function database(overrides: Partial<WorkLogDatabase> = {}): WorkLogDatabase {
  return {
    version: 2,
    employees: [{ id: "emp-1", name: "Alex", role: "Developer", department: "Engineering", workArrangement: "in_house" }],
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
    attachments: [],
    statusHistory: [],
    ...overrides,
  };
}

test("task and subtask titles are required and length-limited", () => {
  assert.equal(validateTaskTitle("  ").ok, false);
  assert.equal(validateTaskTitle("Ship the migration").ok, true);
  assert.equal(validateTaskTitle("x".repeat(121)).ok, false);
  assert.equal(validateSubtaskTitle("  ").ok, false);
  assert.equal(validateSubtaskTitle("Write tests").ok, true);
  assert.equal(validateSubtaskTitle("x".repeat(121)).ok, false);
});

test("progress updates are required and length-limited", () => {
  assert.equal(validateProgressBody("   ").ok, false);
  assert.equal(validateProgressBody("Finished the first subtask.").ok, true);
  assert.equal(validateProgressBody("x".repeat(2001)).ok, false);
});

test("existing entry validators still apply", () => {
  assert.equal(validateDescription("").ok, true);
  assert.equal(validateDescription("   ").ok, true);
  assert.equal(validateDescription("x".repeat(501)).ok, false);
  assert.equal(validateDescription("Reviewed the change.").ok, true);
  assert.equal(validateEvidenceLink("https://example.com/proof").ok, true);
  assert.equal(validateEvidenceLink("javascript:alert(1)").ok, false);
  assert.equal(validateReason(undefined, "blocking this task").ok, false);
  assert.equal(validateReason("Waiting on access", "blocking this task").ok, true);
});

test("open tasks are Ongoing or Blocked only", () => {
  const db = database({
    tasks: [task("a", "ongoing"), task("b", "blocked"), task("c", "done"), task("d", "dropped")],
  });
  assert.deepEqual(getOpenTasks(db, "emp-1").map((t) => t.id).sort(), ["a", "b"]);
});

test("report filters use the task's current status, not a status stored on the entry", () => {
  const db = database({
    tasks: [task("a", "ongoing"), task("b", "done")],
    entries: [
      entry("e1", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", 60),
      entry("e2", "b", "2026-11-06T10:00:00+01:00", "2026-11-06T11:00:00+01:00", 60),
    ],
  });
  const doneOnly = filterEntries(db, { fromKey: "2026-11-06", toKey: "2026-11-06", taskStatus: "done" });
  assert.deepEqual(doneOnly.map((e) => e.id), ["e2"]);
  const all = filterEntries(db, { fromKey: "2026-11-06", toKey: "2026-11-06", taskStatus: "all" });
  assert.equal(all.length, 2);
});

test("breaks are excluded from productive work totals", () => {
  const breaks: BreakEntry[] = [
    {
      id: "brk-1",
      employeeId: "emp-1",
      startAt: "2026-11-06T12:00:00+01:00",
      endAt: "2026-11-06T13:00:00+01:00",
      createdAt: "2026-11-06T12:00:00+01:00",
    },
  ];
  const db = database({
    tasks: [task("a", "ongoing")],
    entries: [entry("e1", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T11:00:00+01:00", 120)],
    breaks,
  });
  const summary = getDaySummary(db, "emp-1", "2026-11-06", new Date("2026-11-06T14:00:00+01:00"));
  assert.equal(summary.workMinutes, 120);
  assert.equal(summary.normalMinutes, 120);
  assert.equal(summary.breakMinutes, 60);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.breaks.length, 1);
});

test("work entries can share a time slot, but breaks still block it", () => {
  const existing = entry("e1", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", 60);
  const workOnly = database({ tasks: [task("a", "ongoing")], entries: [existing] });
  assert.equal(validateEntryTimes(workOnly, "emp-1", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00").ok, true);

  const breakRow: BreakEntry = {
    id: "brk-overlap",
    employeeId: "emp-1",
    startAt: "2026-11-06T09:30:00+01:00",
    endAt: "2026-11-06T09:45:00+01:00",
    createdAt: "2026-11-06T09:30:00+01:00",
  };
  const withBreak = database({ entries: [existing], breaks: [breakRow] });
  assert.equal(validateEntryTimes(withBreak, "emp-1", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00").ok, false);
});

test("recorded work slots stay selectable while break slots remain blocked", () => {
  const now = new Date("2026-11-06T09:30:00+01:00");
  const work = [entry("e1", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", 60)];
  const workSlots = makeWorkSlots("2026-11-06", work, [], now);
  const nine = workSlots.find((slot) => slot.key === "540-600");
  assert.equal(nine?.recorded, true);
  assert.equal(nine?.available, true);

  const breakRow: BreakEntry = {
    id: "brk-slot",
    employeeId: "emp-1",
    startAt: "2026-11-06T09:30:00+01:00",
    endAt: "2026-11-06T09:45:00+01:00",
    createdAt: "2026-11-06T09:30:00+01:00",
  };
  const breakSlots = makeWorkSlots("2026-11-06", [], [breakRow], now);
  assert.equal(breakSlots.find((slot) => slot.key === "540-600")?.available, false);
});

test("reused time slots are detected for the warning without blocking repeats", () => {
  const first = entry("e1", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", 60);
  const otherEmployee = {
    ...entry("e2", "a", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", 60),
    employeeId: "emp-2",
  };
  const nextHour = entry("e3", "a", "2026-11-06T10:00:00+01:00", "2026-11-06T11:00:00+01:00", 60);
  const entries = [first, otherEmployee, nextHour];

  const overlaps = findOverlappingWorkEntries(entries, "emp-1", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00");
  assert.deepEqual(overlaps.map((item) => item.id), ["e1"]);
  assert.deepEqual(
    findOverlappingWorkEntries(entries, "emp-1", "2026-11-06T09:00:00+01:00", "2026-11-06T10:00:00+01:00", "e1"),
    []
  );
  assert.deepEqual(
    findOverlappingWorkEntries(entries, "emp-1", "2026-11-06T10:00:00+01:00", "2026-11-06T11:00:00+01:00"),
    [nextHour]
  );
  assert.deepEqual(
    findOverlappingWorkEntries(entries, "emp-1", "2026-11-06T11:00:00+01:00", "2026-11-06T10:00:00+01:00"),
    []
  );
});
