"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getDatabaseSnapshot, getServerSnapshot, setManagementReview, subscribeToDatabase } from "@/lib/worklog/repository";
import { getDaySummary, getOpenTasks } from "@/lib/worklog/selectors";
import { TASK_STATUS_LABELS, WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getZonedDateKey } from "@/lib/worktrack/schedule-config";
import type { Employee, WorkLogDatabase } from "@/lib/worklog/types";

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

export function ExecutiveBoard() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const todayKey = getZonedDateKey(new Date());
  const activeKey = dateKey ?? todayKey;
  const selected = db.employees.find((e) => e.id === selectedId) ?? null;

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-8 text-wt-ink md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-wt-violet">Executive board</p>
            <h1 className="text-2xl font-semibold">Team work log</h1>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous day" onClick={() => setDateKey(shiftDateKey(activeKey, -1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#E2E2EE] bg-white">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              aria-label="Board date"
              value={activeKey}
              onChange={(e) => e.target.value && setDateKey(e.target.value)}
              className="h-9 rounded-lg border border-[#E2E2EE] bg-white px-3 text-[13px]"
            />
            <button type="button" aria-label="Next day" onClick={() => setDateKey(shiftDateKey(activeKey, 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#E2E2EE] bg-white">
              <ChevronRight className="h-4 w-4" />
            </button>
            {dateKey !== null && (
              <button type="button" onClick={() => setDateKey(null)} className="h-9 rounded-lg px-3 text-[13px] text-wt-violet">
                Today
              </button>
            )}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {db.employees.map((employee) => (
            <EmployeeSnapshot key={employee.id} db={db} employee={employee} dateKey={activeKey} onOpen={() => setSelectedId(employee.id)} />
          ))}
        </div>
      </div>

      {selected && <EmployeeDrawer db={db} employee={selected} dateKey={activeKey} onClose={() => setSelectedId(null)} />}
    </main>
  );
}

function EmployeeSnapshot({ db, employee, dateKey, onOpen }: { db: WorkLogDatabase; employee: Employee; dateKey: string; onOpen: () => void }) {
  const day = getDaySummary(db, employee.id, dateKey);
  const open = getOpenTasks(db, employee.id).length;
  const pct = (part: number) => (day.workMinutes > 0 ? Math.round((part / day.workMinutes) * 100) : 0);

  return (
    <button type="button" onClick={onOpen} className="rounded-2xl border border-[#E2E2EE] bg-white p-5 text-left shadow-sm transition hover:border-wt-violet">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{employee.name}</p>
          <p className="text-[12px] text-[#737A96]">{employee.role} · {employee.department}</p>
        </div>
        {day.activeBreak && <span className="rounded-full bg-wt-amber/15 px-2 py-0.5 text-[11px] font-medium text-wt-amber">On break</span>}
      </div>

      {day.isFuture || !day.isWorkingDay && day.workMinutes === 0 ? (
        <p className="mt-4 text-[13px] text-[#737A96]">{day.isFuture ? "Not started yet." : "Non-working day."}</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-[#737A96]">Logged</dt><dd className="font-semibold">{formatMinutes(day.workMinutes)}</dd></div>
          <div><dt className="text-[#737A96]">Normal / overtime</dt><dd className="font-semibold">{formatMinutes(day.normalMinutes)} / {formatMinutes(day.overtimeMinutes)}</dd></div>
          <div><dt className="text-[#737A96]">Break</dt><dd className="font-semibold">{formatMinutes(day.breakMinutes)}</dd></div>
          <div><dt className="text-[#737A96]">Not logged</dt><dd className="font-semibold">{formatMinutes(day.notLoggedMinutes)}</dd></div>
          <div className="col-span-2">
            <dt className="text-[#737A96]">Location</dt>
            <dd className="font-semibold">Office {pct(day.officeMinutes)}% · Home {pct(day.homeMinutes)}%</dd>
          </div>
          <div className="col-span-2 text-[12px] text-[#737A96]">{open} open task{open === 1 ? "" : "s"}</div>
        </dl>
      )}
    </button>
  );
}

function EmployeeDrawer({ db, employee, dateKey, onClose }: { db: WorkLogDatabase; employee: Employee; dateKey: string; onClose: () => void }) {
  const day = getDaySummary(db, employee.id, dateKey);
  const completed = db.tasks.filter((t) => t.employeeId === employee.id && t.currentStatus === "completed");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const review = (taskId: string, status: "accepted" | "needs_changes", reviewNote?: string) => {
    const result = setManagementReview(taskId, status, reviewNote);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setNoteFor(null);
    setNote("");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0F0F1A]/30" role="dialog" aria-modal="true" aria-label={`${employee.name} details`}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{employee.name}</h2>
            <p className="text-[12px] text-[#737A96]">{formatDateLabel(dateKey)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#F1F1F8]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#737A96]">Entries</h3>
        {day.entries.length === 0 ? (
          <p className="text-[13px] text-[#737A96]">No entries for this day.</p>
        ) : (
          <ul className="mb-6 space-y-3">
            {day.entries.map((e) => {
              const task = db.tasks.find((t) => t.id === e.taskId);
              return (
                <li key={e.id} className="rounded-xl border border-[#E2E2EE] p-3 text-[13px]">
                  <p className="font-medium">{task?.title ?? "Unknown task"}</p>
                  <p className="text-[#737A96]">
                    {formatTime(e.startAt)}–{formatTime(e.endAt)} · {WORK_LOCATION_LABELS[e.workLocation]} · at entry: {TASK_STATUS_LABELS[e.statusAtEntry]}
                  </p>
                  <p className="mt-1">{e.description}</p>
                  {e.overtimeMinutes > 0 && <p className="mt-1 text-wt-amber">Overtime {formatMinutes(e.overtimeMinutes)}</p>}
                </li>
              );
            })}
          </ul>
        )}

        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#737A96]">Completed tasks</h3>
        {completed.length === 0 && <p className="text-[13px] text-[#737A96]">No completed tasks.</p>}
        <ul className="space-y-3">
          {completed.map((t) => (
            <li key={t.id} className="rounded-xl border border-[#E2E2EE] p-3 text-[13px]">
              <p className="font-medium">{t.title}</p>
              <p className="text-[#737A96]">
                Review: {t.managementReview ? (t.managementReview.status === "accepted" ? "Accepted" : `Needs changes — ${t.managementReview.note ?? ""}`) : "Not reviewed"}
              </p>
              {noteFor === t.id ? (
                <div className="mt-2 space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label="Reason for changes" className="w-full rounded-lg border border-[#E2E2EE] p-2 text-[13px]" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => review(t.id, "needs_changes", note)} className="rounded-lg bg-wt-amber px-3 py-1.5 text-[12px] font-medium text-white">Send</button>
                    <button type="button" onClick={() => { setNoteFor(null); setNote(""); }} className="rounded-lg px-3 py-1.5 text-[12px]">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => review(t.id, "accepted")} className="rounded-lg bg-wt-violet px-3 py-1.5 text-[12px] font-medium text-white">Accept</button>
                  <button type="button" onClick={() => setNoteFor(t.id)} className="rounded-lg border border-[#E2E2EE] px-3 py-1.5 text-[12px]">Needs changes</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p>}
      </aside>
    </div>
  );
}
