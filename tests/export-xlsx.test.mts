import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildWorkLogWorkbook, XLSX_MIME_TYPE } from "../src/lib/worklog/export-xlsx";
import type { WorkLogDatabase } from "../src/lib/worklog/types";

function database(): WorkLogDatabase {
  return {
    version: 2,
    employees: [
      { id: "emp-1", name: "Alex Doe", role: "Developer", department: "Engineering", workArrangement: "in_house" },
      { id: "emp-2", name: "Sam Lee", role: "Analyst", department: "Finance", workArrangement: "in_house" },
    ],
    organisations: [],
    clientCategories: [],
    clientSubcategories: [],
    teams: [
      {
        id: "team-eng",
        name: "Engineering",
        isActive: true,
        isDefault: true,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
      {
        id: "team-fin",
        name: "Finance",
        isActive: true,
        isDefault: false,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
    ],
    employeeTeams: [
      { id: "et-1", employeeId: "emp-1", teamId: "team-eng", createdAt: "2026-11-01T08:00:00.000Z" },
      { id: "et-2", employeeId: "emp-2", teamId: "team-fin", createdAt: "2026-11-01T08:00:00.000Z" },
    ],
    projects: [
      {
        id: "proj-eng",
        teamId: "team-eng",
        name: "Platform Migration",
        description: "Move services to the new platform.",
        isActive: true,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
      {
        id: "proj-fin",
        teamId: "team-fin",
        name: "Budget Review",
        isActive: true,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
    ],
    categories: [],
    tasks: [
      {
        id: "task-eng",
        employeeId: "emp-1",
        title: "Platform Migration",
        description: "Task description",
        teamId: "team-eng",
        projectId: "proj-eng",
        currentStatus: "ongoing",
        createdAt: "2026-11-02T08:00:00.000Z",
        updatedAt: "2026-11-02T08:00:00.000Z",
        statusUpdatedAt: "2026-11-02T08:00:00.000Z",
      },
      {
        id: "task-fin",
        employeeId: "emp-2",
        title: "Budget Review",
        teamId: "team-fin",
        projectId: "proj-fin",
        currentStatus: "done",
        createdAt: "2026-11-02T08:00:00.000Z",
        updatedAt: "2026-11-02T08:00:00.000Z",
        statusUpdatedAt: "2026-11-02T08:00:00.000Z",
      },
    ],
    subtasks: [
      {
        id: "sub-eng",
        taskId: "task-eng",
        title: "Cut over database",
        status: "ongoing",
        displayOrder: 0,
        createdAt: "2026-11-02T08:00:00.000Z",
        updatedAt: "2026-11-02T08:00:00.000Z",
        statusUpdatedAt: "2026-11-02T08:00:00.000Z",
      },
    ],
    progressUpdates: [],
    entries: [
      {
        id: "entry-eng",
        employeeId: "emp-1",
        taskId: "task-eng",
        subtaskId: "sub-eng",
        description: "Migrated the staging database",
        startAt: "2026-11-06T09:00:00+01:00",
        endAt: "2026-11-06T11:00:00+01:00",
        workLocation: "office",
        normalMinutes: 120,
        overtimeMinutes: 0,
        isReportedOvertime: false,
        createdAt: "2026-11-06T11:00:00+01:00",
        revisions: [],
      },
      {
        id: "entry-fin",
        employeeId: "emp-2",
        taskId: "task-fin",
        description: "Reviewed the Q4 budget",
        startAt: "2026-11-06T09:00:00+01:00",
        endAt: "2026-11-06T10:30:00+01:00",
        workLocation: "home",
        normalMinutes: 90,
        overtimeMinutes: 0,
        isReportedOvertime: false,
        createdAt: "2026-11-06T10:30:00+01:00",
        revisions: [],
      },
    ],
    breaks: [
      {
        id: "break-eng",
        employeeId: "emp-1",
        startAt: "2026-11-06T12:00:00+01:00",
        endAt: "2026-11-06T12:30:00+01:00",
        createdAt: "2026-11-06T12:00:00+01:00",
      },
      {
        id: "break-fin",
        employeeId: "emp-2",
        startAt: "2026-11-06T12:00:00+01:00",
        endAt: "2026-11-06T12:15:00+01:00",
        createdAt: "2026-11-06T12:00:00+01:00",
      },
    ],
    statusHistory: [],
  };
}

test("workbook is genuine OOXML that an Excel parser can read back", async () => {
  const db = database();
  const workbook = await buildWorkLogWorkbook(db, { fromKey: "2026-11-01", toKey: "2026-11-30" });
  const buffer = await workbook.xlsx.writeBuffer();

  // ExcelJS reads OOXML back from the zip, which proves the buffer is a real .xlsx package.
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer as ArrayBuffer);

  assert.deepEqual(
    reopened.worksheets.map((sheet) => sheet.name),
    ["Work Log", "Tasks", "Employee Summary", "Breaks", "Overtime", "Work Location Comparison"]
  );

  const log = reopened.getWorksheet("Work Log");
  assert.ok(log);
  const headers = (log.getRow(1).values as unknown[]).slice(1);
  assert.deepEqual(headers, [
    "Date",
    "Employee",
    "Employer",
    "Client",
    "Category",
    "Subcategory",
    "Team",
    "Project",
    "Project description",
    "Subtask",
    "Work performed",
    "Start",
    "End",
    "Location",
    "Status",
    "Duration (h)",
    "Overtime (h)",
    "Reported overtime",
    "Evidence",
  ]);

  const rows = (log.getSheetValues() as unknown[][]).slice(2).filter(Boolean);
  const alexRow = rows.find((row) => row[2] === "Alex Doe") as unknown[];
  assert.ok(alexRow, "Alex's entry should be exported");
  assert.equal(alexRow[7], "Engineering");
  assert.equal(alexRow[8], "Platform Migration");
  assert.equal(alexRow[9], "Move services to the new platform.");
  assert.equal(alexRow[10], "Cut over database");
  assert.equal(alexRow[11], "Migrated the staging database");
  assert.equal(alexRow[16], 2);
});

test("export respects the team filter on entries, breaks and summaries", async () => {
  const db = database();
  const workbook = await buildWorkLogWorkbook(db, { fromKey: "2026-11-01", toKey: "2026-11-30", teamId: "team-eng" });

  const log = workbook.getWorksheet("Work Log");
  assert.ok(log);
  const logRows = (log.getSheetValues() as unknown[][]).slice(2).filter(Boolean);
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0][2], "Alex Doe");

  const breaks = workbook.getWorksheet("Breaks");
  assert.ok(breaks);
  const breakRows = (breaks.getSheetValues() as unknown[][]).slice(2).filter(Boolean);
  assert.equal(breakRows.length, 1);
  assert.equal(breakRows[0][2], "Alex Doe");

  const summary = workbook.getWorksheet("Employee Summary");
  assert.ok(summary);
  const summaryRows = (summary.getSheetValues() as unknown[][]).slice(2).filter(Boolean);
  assert.equal(summaryRows.length, 1);
  assert.equal(summaryRows[0][1], "Alex Doe");
});

test("xlsx download uses the OOXML spreadsheet MIME type", () => {
  assert.equal(XLSX_MIME_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
