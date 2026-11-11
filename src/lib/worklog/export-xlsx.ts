import ExcelJS from "exceljs";
import { WORK_LOCATION_LABELS, TASK_STATUS_LABELS } from "./config";
import { dateKeyOf, durationMinutes, formatDateLabel } from "./time";
import { filterEntries, getTaskProjectName, type RangeFilter } from "./selectors";
import type { EmployeeId, WorkLogDatabase, WorkEntry } from "./types";
import { getZonedDateParts, WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B3FD9" } };

/** Correct OOXML MIME so Excel opens the file as a workbook instead of a renamed archive. */
export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function hours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function excelLocalDateTime(iso: string): Date {
  const parts = getZonedDateParts(new Date(iso), WORKTRACK_SCHEDULE.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function styleSheet(sheet: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  sheet.columns = headers.map((header, i) => ({ header, key: `c${i}`, width: widths[i] }));
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function entryRow(db: WorkLogDatabase, e: WorkEntry) {
  const employee = db.employees.find((x) => x.id === e.employeeId);
  const task = db.tasks.find((t) => t.id === e.taskId);
  const subtask = e.subtaskId ? db.subtasks.find((s) => s.id === e.subtaskId) : undefined;
  const project = task?.projectId ? db.projects.find((p) => p.id === task.projectId) : undefined;
  const team = task?.teamId ? db.teams.find((t) => t.id === task.teamId) : undefined;
  return {
    date: formatDateLabel(dateKeyOf(e.startAt)),
    employee: employee?.name ?? e.employeeId,
    team: team?.name ?? "",
    task: task?.title ?? "",
    project: task ? getTaskProjectName(db, task) : "",
    projectDescription: project?.description ?? "",
    subtask: subtask?.title ?? "",
    taskDescription: task?.description ?? "",
    subtaskDescription: subtask?.description ?? "",
    description: e.description,
    location: WORK_LOCATION_LABELS[e.workLocation],
    /** Work entries do not own status; this is the task's current status. */
    taskStatus: task ? TASK_STATUS_LABELS[task.currentStatus] : "",
    start: excelLocalDateTime(e.startAt),
    end: excelLocalDateTime(e.endAt),
    durationHours: hours(durationMinutes(e.startAt, e.endAt)),
    normalHours: hours(e.normalMinutes),
    overtimeHours: hours(e.overtimeMinutes),
    reportedOvertime: e.isReportedOvertime ? "Yes" : "No",
    evidence: e.evidenceLink ?? "",
    revisions: e.revisions.length,
  };
}

/** Employees assigned to the filtered team, used for sheets without a task/team link (breaks, summary). */
function teamEmployeeIds(db: WorkLogDatabase, filter: RangeFilter): Set<EmployeeId> | null {
  if (!filter.teamId || filter.teamId === "all") return null;
  return new Set(db.employeeTeams.filter((row) => row.teamId === filter.teamId).map((row) => row.employeeId));
}

/** Builds the six-sheet work log workbook. All figures come from the same stored data the UI reads. */
export async function buildWorkLogWorkbook(db: WorkLogDatabase, filter: RangeFilter): Promise<ExcelJS.Workbook> {
  const entries = filterEntries(db, filter);
  const teamMembers = teamEmployeeIds(db, filter);
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  // 1. Work Log — chronological entries per employee, matching the Team Board detail view.
  const logSheet = workbook.addWorksheet("Work Log");
  styleSheet(
    logSheet,
    ["Date", "Employee", "Team", "Project", "Project description", "Subtask", "Work performed", "Start", "End", "Location", "Status", "Duration (h)", "Overtime (h)", "Reported overtime", "Evidence"],
    [14, 20, 18, 30, 30, 24, 40, 8, 8, 12, 14, 12, 13, 17, 30]
  );
  const logEntries = [...entries].sort((a, b) =>
    a.employeeId === b.employeeId ? a.startAt.localeCompare(b.startAt) : a.employeeId.localeCompare(b.employeeId)
  );
  for (const e of logEntries) {
    const r = entryRow(db, e);
    logSheet.addRow([r.date, r.employee, r.team, r.project, r.projectDescription, r.subtask, r.description, r.start, r.end, r.location, r.taskStatus, r.durationHours, r.overtimeHours, r.reportedOvertime, r.evidence]);
  }
  logSheet.getColumn(8).numFmt = "hh:mm";
  logSheet.getColumn(9).numFmt = "hh:mm";

  // 2. Tasks
  const tasksSheet = workbook.addWorksheet("Tasks");
  styleSheet(
    tasksSheet,
    ["Employee", "Team", "Project / Task", "Description", "Current status", "Blocker reason", "Dropped reason", "Created", "Completed", "Management review", "Review note"],
    [20, 18, 32, 36, 16, 30, 30, 14, 14, 18, 30]
  );
  const employeeName = (id: string) => db.employees.find((x) => x.id === id)?.name ?? id;
  const includedTaskIds = new Set(entries.map((entry) => entry.taskId));
  for (const t of db.tasks) {
    if (filter.employeeId && filter.employeeId !== "all" && t.employeeId !== filter.employeeId) continue;
    if (filter.teamId && filter.teamId !== "all" && t.teamId !== filter.teamId) continue;
    if (filter.employeeId && filter.employeeId !== "all" && !includedTaskIds.has(t.id)) continue;
    tasksSheet.addRow([
      employeeName(t.employeeId),
      t.teamId ? (db.teams.find((team) => team.id === t.teamId)?.name ?? "") : "",
      getTaskProjectName(db, t),
      t.description ?? "",
      TASK_STATUS_LABELS[t.currentStatus],
      t.blockerReason ?? "",
      t.droppedReason ?? "",
      formatDateLabel(dateKeyOf(t.createdAt)),
      t.completedAt ? formatDateLabel(dateKeyOf(t.completedAt)) : "",
      t.managementReview ? (t.managementReview.status === "accepted" ? "Accepted" : "Needs changes") : "Not reviewed",
      t.managementReview?.note ?? "",
    ]);
  }

  // 3. Employee Summary
  const summarySheet = workbook.addWorksheet("Employee Summary");
  styleSheet(
    summarySheet,
    ["Employee", "Department", "Entries", "Total logged (h)", "Normal (h)", "Overtime (h)", "Break (h)", "Office (h)", "Home (h)", "Other (h)", "Unknown (h)", "Office share"],
    [20, 22, 10, 17, 12, 13, 12, 12, 12, 12, 12, 13]
  );
  for (const emp of db.employees) {
    if (filter.employeeId && filter.employeeId !== "all" && filter.employeeId !== emp.id) continue;
    if (teamMembers && !teamMembers.has(emp.id)) continue;
    const mine = entries.filter((e) => e.employeeId === emp.id);
    const total = mine.reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    const normal = mine.reduce((s, e) => s + e.normalMinutes, 0);
    const overtime = mine.reduce((s, e) => s + e.overtimeMinutes, 0);
    const office = mine.filter((e) => e.workLocation === "office").reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    const home = mine.filter((e) => e.workLocation === "home").reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    const other = mine.filter((e) => e.workLocation === "other").reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    const unknown = mine.filter((e) => e.workLocation === "unknown").reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    const breakMin = db.breaks
      .filter((b) => b.employeeId === emp.id && b.endAt && dateKeyOf(b.startAt) >= filter.fromKey && dateKeyOf(b.startAt) <= filter.toKey)
      .reduce((s, b) => s + durationMinutes(b.startAt, b.endAt as string), 0);
    summarySheet.addRow([
      emp.name,
      emp.department,
      mine.length,
      hours(total),
      hours(normal),
      hours(overtime),
      hours(breakMin),
      hours(office),
      hours(home),
      hours(other),
      hours(unknown),
      total > 0 ? Math.round((office / total) * 1000) / 10 : 0,
    ]);
  }

  // 4. Breaks
  const breaksSheet = workbook.addWorksheet("Breaks");
  styleSheet(breaksSheet, ["Date", "Employee", "Start", "End", "Duration (min)", "Status"], [14, 20, 9, 9, 15, 12]);
  for (const b of db.breaks) {
    const key = dateKeyOf(b.startAt);
    if (key < filter.fromKey || key > filter.toKey) continue;
    if (filter.employeeId && filter.employeeId !== "all" && b.employeeId !== filter.employeeId) continue;
    if (teamMembers && !teamMembers.has(b.employeeId)) continue;
    breaksSheet.addRow([
      formatDateLabel(key),
      employeeName(b.employeeId),
      excelLocalDateTime(b.startAt),
      b.endAt ? excelLocalDateTime(b.endAt) : "",
      b.endAt ? Math.round(durationMinutes(b.startAt, b.endAt)) : "",
      b.endAt ? "Ended" : "Running",
    ]);
  }
  breaksSheet.getColumn(3).numFmt = "yyyy-mm-dd hh:mm";
  breaksSheet.getColumn(4).numFmt = "yyyy-mm-dd hh:mm";

  // 5. Overtime
  const overtimeSheet = workbook.addWorksheet("Overtime");
  styleSheet(overtimeSheet, ["Work entry ID", "Date", "Employee", "Project", "Start", "End", "Overtime (h)", "Reported manually"], [30, 14, 20, 30, 19, 19, 13, 18]);
  for (const e of entries.filter((x) => x.overtimeMinutes > 0)) {
    const r = entryRow(db, e);
    overtimeSheet.addRow([e.id, r.date, r.employee, r.project, r.start, r.end, r.overtimeHours, r.reportedOvertime]);
  }
  overtimeSheet.getColumn(5).numFmt = "yyyy-mm-dd hh:mm";
  overtimeSheet.getColumn(6).numFmt = "yyyy-mm-dd hh:mm";

  // 6. Work Location Comparison
  const locationSheet = workbook.addWorksheet("Work Location Comparison");
  styleSheet(locationSheet, ["Location", "Entries", "Hours", "Share of logged time"], [20, 10, 12, 20]);
  const totalAll = entries.reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
  for (const loc of ["office", "home", "other", "unknown"] as const) {
    const mine = entries.filter((e) => e.workLocation === loc);
    const minutes = mine.reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);
    locationSheet.addRow([
      WORK_LOCATION_LABELS[loc],
      mine.length,
      hours(minutes),
      totalAll > 0 ? Math.round((minutes / totalAll) * 1000) / 10 : 0,
    ]);
  }

  return workbook;
}

export async function downloadWorkLogWorkbook(db: WorkLogDatabase, filter: RangeFilter, fileName: string): Promise<void> {
  const workbook = await buildWorkLogWorkbook(db, filter);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
