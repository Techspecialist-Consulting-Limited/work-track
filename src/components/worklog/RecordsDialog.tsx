"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Coffee, Pencil, Save, Trash2, X } from "lucide-react";
import { WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getSubtaskById, getTaskById } from "@/lib/worklog/selectors";
import { dateKeyAfter } from "./shared";
import { StatusBadge } from "./StatusBadge";
import type { WorkLogController } from "./useWorkLogController";

/* 16px on touch layouts prevents iOS focus zoom; smaller on desktop panels. */
const DIALOG_INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-2 text-base text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15 lg:min-h-9 lg:text-[13px]";

export function RecordsDialog({ c }: { c: WorkLogController }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [breakEdit, setBreakEdit] = useState<{ id: string; start: string; end: string } | null>(null);
  const [breakError, setBreakError] = useState<string | null>(null);
  if (!c.recordsOpen) return null;
  const { recordsSummary, recordsDateKey, todayKey, timeline, taskStatusCounts } = c;

  return (
    <div
      className="staff-workspace fixed inset-0 z-50 flex items-end justify-center bg-[#17172F]/35 backdrop-blur-[2px] sm:items-stretch sm:justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) c.setRecordsOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="records-title"
        className="flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-[#E7E6F0] bg-white shadow-2xl sm:h-dvh sm:w-[440px] sm:rounded-l-2xl sm:rounded-tr-none sm:border-l"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[#E0DDEC] sm:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between border-b border-[#EEEAF2] px-4 py-3 sm:px-5">
          <div>
            <h2 id="records-title" className="text-base font-bold text-[#17172F] sm:text-lg">My Records</h2>
            <p className="mt-0.5 text-[11px] text-[#777A91] sm:text-xs">Your work history and daily summary</p>
          </div>
          <button
            type="button"
            autoFocus
            aria-label="Close My Records"
            onClick={() => c.setRecordsOpen(false)}
            className="grid h-10 w-10 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="grid shrink-0 grid-cols-2 border-b border-[#EEEAF2] px-4 sm:px-5" role="tablist" aria-label="Records view">
          <button
            type="button"
            role="tab"
            aria-selected={c.recordsTab === "log"}
            onClick={() => c.setRecordsTab("log")}
            className={`min-h-11 border-b-2 text-xs font-semibold sm:text-sm ${c.recordsTab === "log" ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#777A91]"}`}
          >
            My Log
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={c.recordsTab === "summary"}
            onClick={() => c.setRecordsTab("summary")}
            className={`min-h-11 border-b-2 text-xs font-semibold sm:text-sm ${c.recordsTab === "summary" ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#777A91]"}`}
          >
            Summary
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-[#F0EEF5] px-3 py-2.5 sm:px-4">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => c.setRecordsDate(dateKeyAfter(recordsDateKey, -1))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC]"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
            <input
              aria-label="Select records date"
              type="date"
              max={todayKey}
              value={recordsDateKey}
              onChange={(event) => c.setRecordsDate(event.target.value)}
              className="min-h-9 min-w-0 w-full rounded-lg border border-[#E7E6F0] px-1 text-base font-semibold text-[#39364F] sm:px-2 lg:text-sm"
            />
            <button
              type="button"
              onClick={() => c.setRecordsDate(todayKey)}
              className="min-h-9 shrink-0 rounded-lg px-1.5 text-[11px] font-semibold text-[#6C45F5] hover:bg-[#F5F1FF] sm:px-2 sm:text-xs"
            >
              Today
            </button>
          </div>
          <button
            type="button"
            aria-label="Next day"
            disabled={recordsDateKey >= todayKey}
            onClick={() => c.setRecordsDate(dateKeyAfter(recordsDateKey, 1))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        {c.recordsTab === "log" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#39364F] sm:text-sm">
                {formatDateLabel(recordsDateKey)}
                {recordsDateKey === todayKey ? " · Today" : " · Historical"}
              </p>
              <p className="shrink-0 text-[11px] text-[#777A91]">{formatMinutes(recordsSummary.workMinutes)} work</p>
            </div>
            {timeline.length ? (
              <ol className="space-y-2">
                {timeline.map((item) =>
                  item.kind === "entry" ? (
                    <li key={item.entry.id} className="rounded-xl border border-[#E7E6F0] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-[#777A91]">
                            {formatTime(item.entry.startAt)} – {formatTime(item.entry.endAt)}
                          </p>
                          <p className="mt-0.5 break-words text-[13px] font-semibold text-[#17172F]">
                            {getTaskById(c.db, item.entry.taskId)?.title ?? "Task"}
                          </p>
                          {item.entry.subtaskId ? (
                            <p className="text-[11px] font-medium text-[#777A91]">
                              Subtask: {getSubtaskById(c.db, item.entry.subtaskId)?.title ?? "Removed subtask"}
                            </p>
                          ) : null}
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-4 text-[#53506B]">{item.entry.description}</p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[#777A91]">
                            {WORK_LOCATION_LABELS[item.entry.workLocation]} · Task status{" "}
                            <StatusBadge status={getTaskById(c.db, item.entry.taskId)?.currentStatus ?? "ongoing"} />
                            {item.entry.overtimeMinutes > 0 ? ` · Overtime ${formatMinutes(item.entry.overtimeMinutes)}` : ""}
                            {item.entry.isReportedOvertime ? " · Reported overtime" : ""}
                          </p>
                        </div>
                        {confirmDeleteId === item.entry.id ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label="Confirm delete entry"
                              onClick={() => {
                                c.deleteEntry(item.entry.id);
                                setConfirmDeleteId(null);
                              }}
                              className="grid h-9 w-9 place-items-center rounded-lg bg-[#B42318] text-white transition hover:bg-[#912018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318]"
                            >
                              <Check size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel delete"
                              onClick={() => setConfirmDeleteId(null)}
                              className="grid h-9 w-9 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F7F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                            >
                              <X size={15} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Edit ${getTaskById(c.db, item.entry.taskId)?.title ?? "work entry"}`}
                              onClick={() => c.beginEdit(item.entry)}
                              className="grid h-9 w-9 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F5F1FF] hover:text-[#5A3ED0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${getTaskById(c.db, item.entry.taskId)?.title ?? "work entry"}`}
                              onClick={() => setConfirmDeleteId(item.entry.id)}
                              className="grid h-9 w-9 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#FDECEC] hover:text-[#B42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318]"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </span>
                        )}
                      </div>
                    </li>
                  ) : (
                    <li key={item.brk.id} className="rounded-xl border border-[#F6D99A] bg-[#FFF9ED] p-3">
                      {breakEdit?.id === item.brk.id ? (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#8A5A00]">Edit break</p>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] font-semibold text-[#8A5A00]">
                              Start
                              <input
                                type="time"
                                value={breakEdit.start}
                                onChange={(event) => setBreakEdit({ ...breakEdit, start: event.target.value })}
                                className={DIALOG_INPUT_CLASS}
                              />
                            </label>
                            <label className="text-[11px] font-semibold text-[#8A5A00]">
                              End
                              <input
                                type="time"
                                value={breakEdit.end}
                                onChange={(event) => setBreakEdit({ ...breakEdit, end: event.target.value })}
                                className={DIALOG_INPUT_CLASS}
                              />
                            </label>
                          </div>
                          {breakError ? <p role="alert" className="text-xs text-[#B43A3A]">{breakError}</p> : null}
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setBreakEdit(null);
                                setBreakError(null);
                              }}
                              className="min-h-9 rounded-lg px-3 text-xs font-semibold text-[#8A5A00]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const result = c.changeBreak(
                                  item.brk.id,
                                  recordsDateKey,
                                  breakEdit.start,
                                  breakEdit.end || null
                                );
                                if (!result.ok) {
                                  setBreakError(result.message);
                                  return;
                                }
                                setBreakEdit(null);
                                setBreakError(null);
                              }}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#F59E0B] px-3 text-xs font-semibold text-white hover:bg-[#DB8A08]"
                            >
                              <Save size={13} aria-hidden="true" /> Save break
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[#8A5A00]">Break</p>
                            <p className="mt-1 text-xs text-[#9A742C]">
                              {formatTime(item.brk.startAt)} – {item.brk.endAt ? formatTime(item.brk.endAt) : "In progress"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              aria-label="Edit break"
                              onClick={() => {
                                setBreakEdit({
                                  id: item.brk.id,
                                  start: formatTime(item.brk.startAt),
                                  end: item.brk.endAt ? formatTime(item.brk.endAt) : "",
                                });
                                setBreakError(null);
                              }}
                              className="grid h-9 w-9 place-items-center rounded-lg text-[#9A742C] transition hover:bg-[#FDEBC8] hover:text-[#8A5A00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <Coffee size={17} className="text-[#F59E0B]" aria-hidden="true" />
                          </div>
                        </div>
                      )}
                    </li>
                  )
                )}
              </ol>
            ) : (
              <p className="rounded-xl bg-[#F7F7FC] px-4 py-5 text-center text-sm text-[#777A91]">
                No work or break records for this day.
              </p>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            <p className="mb-3 text-xs font-semibold text-[#39364F] sm:text-sm">{formatDateLabel(recordsDateKey)}</p>
            <dl className="grid grid-cols-2 gap-2">
              <SummaryStat label="Total work" value={formatMinutes(recordsSummary.workMinutes)} />
              <SummaryStat label="Break time" value={formatMinutes(recordsSummary.breakMinutes)} />
              <SummaryStat label="Overtime" value={formatMinutes(recordsSummary.overtimeMinutes)} />
              <SummaryStat label="Office" value={formatMinutes(recordsSummary.officeMinutes)} />
              <SummaryStat label="Home" value={formatMinutes(recordsSummary.homeMinutes)} />
              <SummaryStat label="Entries" value={String(recordsSummary.entries.length)} />
              <SummaryStat label="Tasks done" value={String(taskStatusCounts.done)} />
              <SummaryStat label="Tasks ongoing" value={String(taskStatusCounts.ongoing)} />
              <SummaryStat label="Tasks blocked" value={String(taskStatusCounts.blocked)} />
              <SummaryStat label="Tasks dropped" value={String(taskStatusCounts.dropped)} />
            </dl>
            <section className="mt-4">
              <h3 className="mb-2 text-[13px] font-semibold text-[#39364F]">Daily timeline</h3>
              {timeline.length ? (
                <ol className="space-y-2 border-l border-[#E6E1F7] pl-3">
                  {timeline.map((item) =>
                    item.kind === "entry" ? (
                      <li
                        key={`summary-${item.entry.id}`}
                        className="relative rounded-lg bg-[#FCFBFF] p-2.5 before:absolute before:-left-[18px] before:top-3 before:h-2 before:w-2 before:rounded-full before:bg-[#6C45F5]"
                      >
                        <p className="text-xs font-semibold text-[#777A91]">
                          {formatTime(item.entry.startAt)}–{formatTime(item.entry.endAt)}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-[#39364F]">
                          {getTaskById(c.db, item.entry.taskId)?.title ?? "Task"}
                        </p>
                      </li>
                    ) : (
                      <li
                        key={`summary-${item.brk.id}`}
                        className="relative rounded-lg bg-[#FFF9ED] p-2.5 before:absolute before:-left-[18px] before:top-3 before:h-2 before:w-2 before:rounded-full before:bg-[#F59E0B]"
                      >
                        <p className="text-xs font-semibold text-[#9A742C]">
                          {formatTime(item.brk.startAt)}–{item.brk.endAt ? formatTime(item.brk.endAt) : "In progress"}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-[#8A5A00]">Break</p>
                      </li>
                    )
                  )}
                </ol>
              ) : (
                <p className="rounded-lg bg-[#F7F7FC] p-3 text-sm text-[#777A91]">No timeline records for this day.</p>
              )}
            </section>
            <section className="mt-5 border-t border-[#EEEAF2] pt-3">
              <h3 className="mb-2 text-[13px] font-semibold text-[#39364F]">Export your records</h3>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-[#53506B]">
                  From
                  <input
                    type="date"
                    max={todayKey}
                    value={c.exportFrom || todayKey}
                    onChange={(event) => c.setExportFrom(event.target.value)}
                    className={DIALOG_INPUT_CLASS}
                  />
                </label>
                <label className="text-xs font-semibold text-[#53506B]">
                  To
                  <input
                    type="date"
                    max={todayKey}
                    value={c.exportTo || todayKey}
                    onChange={(event) => c.setExportTo(event.target.value)}
                    className={DIALOG_INPUT_CLASS}
                  />
                </label>
              </div>
              {c.exportError ? <p role="alert" className="mt-2 text-xs text-[#B43A3A]">{c.exportError}</p> : null}
              <button
                type="button"
                onClick={c.exportRecords}
                disabled={c.exporting}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"
              >
                <Save size={15} aria-hidden="true" /> {c.exporting ? "Preparing export…" : "Export to Excel"}
              </button>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F7F7FC] p-2.5">
      <dt className="text-[11px] text-[#777A91]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[#17172F]">{value}</dd>
    </div>
  );
}
