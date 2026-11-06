"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Download, SlidersHorizontal, X } from "lucide-react";
import { getDatabaseSnapshot, getServerSnapshot, getSessionEmployeeId, getSessionRole, getSessionUser, subscribeToDatabase } from "@/lib/worklog/repository";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import { BottomSheet } from "@/components/management/mobile/shared";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { filterEntries, type RangeFilter } from "@/lib/worklog/selectors";
import { TASK_STATUS_LABELS, WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getZonedDateKey } from "@/lib/worktrack/schedule-config";
import type { TaskStatus, WorkLocation } from "@/lib/worklog/types";

const selectClass = "h-11 w-full rounded-xl border border-[#E2E2EE] bg-white px-3 text-base text-[#17172B] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/25 lg:h-9 lg:text-[13px]";

function defaultFilter(): RangeFilter {
  return {
    fromKey: "2026-10-26",
    toKey: getZonedDateKey(new Date()),
    employeeId: "all",
    location: "all",
    statusAtEntry: "all",
    hours: "all",
  };
}

export function WorkLogReports() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const meEmployee = db.employees.find((e) => e.id === getSessionEmployeeId());
  const canEditProfile = Boolean(meEmployee) && getSessionRole() !== "chairman";
  const [defaults] = useState(defaultFilter);
  const [filter, setFilter] = useState<RangeFilter>(defaults);
  const [draft, setDraft] = useState<RangeFilter>(defaults);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const update = (patch: Partial<RangeFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const updateDraft = (patch: Partial<RangeFilter>) => setDraft((f) => ({ ...f, ...patch }));
  const entries = filterEntries(db, filter);
  const totalMinutes = entries.reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);

  const openSheet = () => {
    setDraft(filter);
    setSheetOpen(true);
  };
  const applyDraft = () => {
    setFilter(draft);
    setSheetOpen(false);
  };
  const resetFilters = () => {
    setDraft(defaults);
    setFilter(defaults);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadWorkLogWorkbook(db, filter, `worktrack-work-log_${filter.fromKey}_to_${filter.toKey}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  // Active-filter bookkeeping for the badge and removable chips.
  const datesActive = filter.fromKey !== defaults.fromKey || filter.toKey !== defaults.toKey;
  const activeCount =
    (datesActive ? 1 : 0) +
    (filter.employeeId !== "all" ? 1 : 0) +
    (filter.location !== "all" ? 1 : 0) +
    (filter.statusAtEntry !== "all" ? 1 : 0) +
    (filter.hours !== "all" ? 1 : 0);

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (datesActive) {
    chips.push({
      key: "dates",
      label: `${formatDateLabel(filter.fromKey)} → ${formatDateLabel(filter.toKey)}`,
      clear: () => update({ fromKey: defaults.fromKey, toKey: defaults.toKey }),
    });
  }
  if (filter.employeeId !== "all") {
    const emp = db.employees.find((e) => e.id === filter.employeeId);
    chips.push({
      key: "employee",
      label: emp?.name ?? "Employee",
      clear: () => update({ employeeId: "all" }),
    });
  }
  if (filter.location !== "all") {
    chips.push({
      key: "location",
      label: WORK_LOCATION_LABELS[filter.location as WorkLocation],
      clear: () => update({ location: "all" }),
    });
  }
  if (filter.statusAtEntry !== "all") {
    chips.push({
      key: "status",
      label: TASK_STATUS_LABELS[filter.statusAtEntry as TaskStatus],
      clear: () => update({ statusAtEntry: "all" }),
    });
  }
  if (filter.hours !== "all") {
    chips.push({
      key: "hours",
      label: filter.hours === "normal" ? "Normal hours" : "Overtime",
      clear: () => update({ hours: "all" }),
    });
  }

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-8 text-wt-ink md:px-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/executive"
          className="mb-4 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#B42318] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#912018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2 lg:hidden"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Team Board
        </Link>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-semibold">Reports</h1>
              <nav className="flex items-center gap-2 text-xs font-semibold" aria-label="Executive">
                <Link href="/executive" className="text-[#777A91] hover:text-[#17172F]">Team Board</Link>
                <span className="text-[#D8D5E6]" aria-hidden="true">·</span>
                <span className="text-[#6C45F5]">Reports</span>
              </nav>
            </div>
            <p className="mt-0.5 text-[12px] text-[#737A96]">Filter work entries and export them to Excel.</p>
          </div>
          <div className="flex items-center gap-2">
            <ProfileMenu
              name={meEmployee?.name ?? getSessionUser()?.name ?? "Account"}
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : getSessionRole() === "chairman" ? "Chairman" : "HR"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={canEditProfile}
              required={canEditProfile && !meEmployee?.avatarUrl}
            />
            <button type="button" onClick={onExport} disabled={exporting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-wt-violet px-4 text-[13px] font-medium text-white disabled:opacity-60">
              <Download className="h-4 w-4" /> {exporting ? "Preparing…" : "Export .xlsx"}
            </button>
          </div>
        </header>

        {/* Toolbar: result summary + compact filter control (mobile/tablet) */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-[#737A96]">{entries.length} entries · {formatMinutes(totalMinutes)} logged</p>
          <button
            type="button"
            onClick={openSheet}
            className="relative inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[#E2E2EE] bg-white px-3.5 text-[13px] font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] lg:hidden"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Filters
            {activeCount > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#6C45F5] px-1 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            ) : null}
          </button>
        </div>

        {/* Active filter chips — removable without reopening the sheet */}
        {chips.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                aria-label={`Remove filter: ${chip.label}`}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#D8D0F5] bg-[#F5F1FF] px-3 text-[11px] font-semibold text-[#4F31D0] transition hover:bg-[#EFE9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                {chip.label}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex min-h-8 items-center rounded-full px-2 text-[11px] font-semibold text-[#8B8B9A] underline-offset-2 transition hover:text-[#B42318] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              Reset all
            </button>
          </div>
        ) : null}

        {/* Desktop: compact inline filter panel */}
        <section className="mb-6 hidden rounded-2xl border border-[#E2E2EE] bg-white p-4 lg:grid lg:grid-cols-6">
          <FilterFields value={filter} onChange={update} employees={db.employees} />
        </section>

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

      {/* Mobile filter sheet */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
        <div className="grid max-h-[60dvh] gap-3 overflow-y-auto overscroll-contain">
          <FilterFields value={draft} onChange={updateDraft} employees={db.employees} />
        </div>
        <div className="mt-4 flex gap-2 border-t border-[#EEEAF2] pt-4">
          <button
            type="button"
            onClick={resetFilters}
            className="min-h-11 flex-1 rounded-xl border border-[#E2E2EE] px-4 text-sm font-semibold text-[#4A4665] transition hover:bg-[#F7F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={applyDraft}
            className="min-h-11 flex-1 rounded-xl bg-[#6C45F5] px-4 text-sm font-bold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2"
          >
            Apply Filters
          </button>
        </div>
      </BottomSheet>
    </main>
  );
}

function FilterFields({
  value,
  onChange,
  employees,
}: {
  value: RangeFilter;
  onChange: (patch: Partial<RangeFilter>) => void;
  employees?: { id: string; name: string }[];
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96] lg:col-span-1">From
        <input type="date" value={value.fromKey} onChange={(e) => e.target.value && onChange({ fromKey: e.target.value })} className={selectClass} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">To
        <input type="date" value={value.toKey} onChange={(e) => e.target.value && onChange({ toKey: e.target.value })} className={selectClass} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Employee
        <select value={value.employeeId} onChange={(e) => onChange({ employeeId: e.target.value })} className={selectClass}>
          <option value="all">All employees</option>
          {(employees ?? []).map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Location
        <select value={value.location} onChange={(e) => onChange({ location: e.target.value as WorkLocation | "all" })} className={selectClass}>
          <option value="all">All</option>
          <option value="office">{WORK_LOCATION_LABELS.office}</option>
          <option value="home">{WORK_LOCATION_LABELS.home}</option>
          <option value="other">{WORK_LOCATION_LABELS.other}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Task status at entry
        <select value={value.statusAtEntry} onChange={(e) => onChange({ statusAtEntry: e.target.value as TaskStatus | "all" })} className={selectClass}>
          <option value="all">All</option>
          {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#737A96]">Hours
        <select value={value.hours} onChange={(e) => onChange({ hours: e.target.value as RangeFilter["hours"] })} className={selectClass}>
          <option value="all">All</option>
          <option value="normal">Normal hours only</option>
          <option value="overtime">Overtime only</option>
        </select>
      </label>
    </>
  );
}
