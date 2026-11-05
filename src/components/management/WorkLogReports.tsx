"use client";

import { useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { getDatabaseSnapshot, getServerSnapshot, subscribeToDatabase } from "@/lib/worklog/repository";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { filterEntries, type RangeFilter } from "@/lib/worklog/selectors";
import { TASK_STATUS_LABELS, WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getZonedDateKey } from "@/lib/worktrack/schedule-config";
import type { TaskStatus, WorkLocation } from "@/lib/worklog/types";

const selectClass = "h-9 rounded-lg border border-[#E2E2EE] bg-white px-3 text-[13px]";

export function WorkLogReports() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const today = getZonedDateKey(new Date());
  const [filter, setFilter] = useState<RangeFilter>({
    fromKey: "2026-10-26",
    toKey: today,
    employeeId: "all",
    location: "all",
    statusAtEntry: "all",
    hours: "all",
  });
  const [exporting, setExporting] = useState(false);

  const update = (patch: Partial<RangeFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const entries = filterEntries(db, filter);
  const totalMinutes = entries.reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadWorkLogWorkbook(db, filter, `worktrack-work-log_${filter.fromKey}_to_${filter.toKey}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-8 text-wt-ink md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-wt-violet">Reports</p>
            <h1 className="text-2xl font-semibold">Work log reports</h1>
          </div>
          <button type="button" onClick={onExport} disabled={exporting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-wt-violet px-4 text-[13px] font-medium text-white disabled:opacity-60">
            <Download className="h-4 w-4" /> {exporting ? "Preparing…" : "Export .xlsx"}
          </button>
        </header>

        <section className="mb-6 grid gap-3 rounded-2xl border border-[#E2E2EE] bg-white p-4 md:grid-cols-3 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">From
            <input type="date" value={filter.fromKey} onChange={(e) => e.target.value && update({ fromKey: e.target.value })} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">To
            <input type="date" value={filter.toKey} onChange={(e) => e.target.value && update({ toKey: e.target.value })} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Employee
            <select value={filter.employeeId} onChange={(e) => update({ employeeId: e.target.value })} className={selectClass}>
              <option value="all">All employees</option>
              {db.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Location
            <select value={filter.location} onChange={(e) => update({ location: e.target.value as WorkLocation | "all" })} className={selectClass}>
              <option value="all">All</option>
              <option value="office">{WORK_LOCATION_LABELS.office}</option>
              <option value="home">{WORK_LOCATION_LABELS.home}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Task status at entry
            <select value={filter.statusAtEntry} onChange={(e) => update({ statusAtEntry: e.target.value as TaskStatus | "all" })} className={selectClass}>
              <option value="all">All</option>
              {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Hours
            <select value={filter.hours} onChange={(e) => update({ hours: e.target.value as RangeFilter["hours"] })} className={selectClass}>
              <option value="all">All</option>
              <option value="normal">Normal hours only</option>
              <option value="overtime">Overtime only</option>
            </select>
          </label>
        </section>

        <p className="mb-3 text-[13px] text-[#737A96]">{entries.length} entries · {formatMinutes(totalMinutes)} logged</p>

        <div className="overflow-x-auto rounded-2xl border border-[#E2E2EE] bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#E2E2EE] bg-[#F7F7FC] text-[12px] text-[#737A96]">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Status at entry</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-[#737A96]">No entries match these filters.</td></tr>
              )}
              {entries.map((e) => {
                const employee = db.employees.find((x) => x.id === e.employeeId);
                const task = db.tasks.find((t) => t.id === e.taskId);
                return (
                  <tr key={e.id} className="border-b border-[#F1F1F8] last:border-0">
                    <td className="px-4 py-3">{formatDateLabel(dateKeyOf(e.startAt))}</td>
                    <td className="px-4 py-3">{employee?.name ?? e.employeeId}</td>
                    <td className="px-4 py-3">{task?.title ?? "—"}</td>
                    <td className="px-4 py-3">{formatTime(e.startAt)}–{formatTime(e.endAt)}</td>
                    <td className="px-4 py-3">{WORK_LOCATION_LABELS[e.workLocation]}</td>
                    <td className="px-4 py-3">{TASK_STATUS_LABELS[e.statusAtEntry]}</td>
                    <td className="px-4 py-3">{formatMinutes(durationMinutes(e.startAt, e.endAt))}</td>
                    <td className="px-4 py-3">{e.overtimeMinutes > 0 ? formatMinutes(e.overtimeMinutes) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
