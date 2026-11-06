"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Download,
  ExternalLink,
  FileText,
  X,
  Zap,
} from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { ExecutiveMobile } from "./mobile/ExecutiveMobile";
import { InviteChairman } from "./InviteChairman";
import { Avatar } from "./mobile/shared";
import {
  getDatabaseSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getServerSnapshot,
  getSessionUser,
  setManagementReview,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { EXERCISE_END, EXERCISE_START } from "@/lib/worklog/seed";
import { getDaySummary, getTaskById } from "@/lib/worklog/selectors";
import { WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getZonedDateKey, WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import type { Employee, TaskStatus, WorkEntry, WorkLogDatabase } from "@/lib/worklog/types";
import type { DaySummary } from "@/lib/worklog/selectors";

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const EXERCISE_START_KEY = `${EXERCISE_START.year}-${pad2(EXERCISE_START.month)}-${pad2(EXERCISE_START.day)}`;
const EXERCISE_END_KEY = `${EXERCISE_END.year}-${pad2(EXERCISE_END.month)}-${pad2(EXERCISE_END.day)}`;

const STATUS_LABELS_SHORT: Record<TaskStatus, string> = {
  not_started: "Not started",
  ongoing: "Ongoing",
  blocked: "Blocked",
  completed: "Done",
  dropped: "Dropped",
};

type BoardFilter = "all" | "logged" | "break" | "none";

interface EmployeeDay {
  employee: Employee;
  day: DaySummary;
  status: "on_break" | "logged" | "none" | "upcoming";
  snapshot: string;
}

function workSnapshot(entries: WorkEntry[], db: WorkLogDatabase): string {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const entry of entries) {
    const title = getTaskById(db, entry.taskId)?.title ?? "Task";
    if (seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
    if (titles.length === 3) break;
  }
  const remaining = new Set(entries.map((e) => getTaskById(db, e.taskId)?.title ?? "Task")).size - titles.length;
  if (!titles.length) return "No work logged";
  return titles.join(" · ") + (remaining > 0 ? ` · +${remaining} more` : "");
}

function employeeStatus(day: DaySummary): EmployeeDay["status"] {
  if (day.isFuture) return "upcoming";
  if (day.isToday && day.activeBreak) return "on_break";
  if (day.entries.length > 0) return "logged";
  return "none";
}

function ExecutiveDesktopBoard() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const meEmployee = db.employees.find((e) => e.id === getSessionEmployeeId());
  const canEditProfile = Boolean(meEmployee) && getSessionRole() !== "chairman";
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const togglePicker = useCallback(() => setPickerOpen((v) => !v), []);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const triggerRef = useRef<HTMLElement | null>(null);

  const todayKey = getZonedDateKey(now);
  const activeKey = dateKey ?? todayKey;
  const selected = db.employees.find((e) => e.id === selectedId) ?? null;
  const outsideExercise = activeKey < EXERCISE_START_KEY || activeKey > EXERCISE_END_KEY;

  const employeeDays = useMemo(
    () =>
      db.employees.map((employee) => {
        const day = getDaySummary(db, employee.id, activeKey, now);
        return {
          employee,
          day,
          status: employeeStatus(day),
          snapshot: workSnapshot(day.entries, db),
        } satisfies EmployeeDay;
      }),
    [db, activeKey, now]
  );

  const visibleEmployees = employeeDays.filter(({ employee, status }) => {
    if (query && !employee.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "logged") return status === "logged";
    if (filter === "break") return status === "on_break";
    return status === "none" || status === "upcoming";
  });

  const staffLogged = employeeDays.filter((e) => e.day.entries.length > 0).length;
  const workEntries = employeeDays.reduce((s, e) => s + e.day.entries.length, 0);
  const tasksDone = db.tasks.filter((t) => t.completedAt && dateKeyOf(t.completedAt) === activeKey).length;
  const overtimeMinutes = employeeDays.reduce((s, e) => s + e.day.overtimeMinutes, 0);
  const officeMinutes = employeeDays.reduce((s, e) => s + e.day.officeMinutes, 0);
  const homeMinutes = employeeDays.reduce((s, e) => s + e.day.homeMinutes, 0);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [selected]);

  function openEmployee(employee: Employee, el: HTMLElement) {
    triggerRef.current = el;
    setSelectedId(employee.id);
  }

  function closeDrawer() {
    setSelectedId(null);
    triggerRef.current?.focus({ preventScroll: true });
  }

  async function exportDay(employeeId?: string) {
    setExportError(null);
    setExporting(true);
    try {
      const suffix = employeeId ? `_${db.employees.find((e) => e.id === employeeId)?.name.replace(/\s+/g, "-") ?? employeeId}` : "";
      await downloadWorkLogWorkbook(
        db,
        { fromKey: activeKey, toKey: activeKey, employeeId: employeeId ?? "all" },
        `WorkTrack_Team_Report_${activeKey}${suffix}.xlsx`
      );
    } catch {
      setExportError("The workbook could not be created. Try again.");
    } finally {
      setExporting(false);
    }
  }

  if (!mounted) {
    return <div className="grid min-h-dvh place-items-center text-sm text-[#737A96]">Loading team board…</div>;
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#F7F7FC] px-4 py-5 text-[#17172F] md:px-8 md:py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#6C45F5] text-white">
              <Zap size={17} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-lg font-bold tracking-tight">Team Board</h1>
              </div>
              <p className="text-[11px] text-[#777A91]">
                Work exercise: {formatDateLabel(EXERCISE_START_KEY)} – {formatDateLabel(EXERCISE_END_KEY)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/executive/reports"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <FileText size={15} aria-hidden="true" />
              Reports
            </Link>
            {getSessionEmployeeId() && getSessionRole() !== "chairman" ? (
              <Link
                href="/"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                My Work Log
              </Link>
            ) : null}
            <InviteChairman />
            <ProfileMenu
              name={meEmployee?.name ?? getSessionUser()?.name ?? "Account"}
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : getSessionRole() === "chairman" ? "Chairman" : "HR"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={canEditProfile}
              required={canEditProfile && !meEmployee?.avatarUrl}
            />
            <button
              type="button"
              onClick={() => exportDay()}
              disabled={exporting}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <Download size={15} aria-hidden="true" />
              {exporting ? "Preparing…" : "Export to Excel"}
            </button>
          </div>
        </header>

        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-[#E7E6F0] bg-white p-1 shadow-sm">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setDateKey(shiftDateKey(activeKey, -1))}
              className="grid h-9 w-9 place-items-center rounded-lg text-[#53506B] transition hover:bg-[#F5F1FF] hover:text-[#4E35C6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <BoardDatePicker
              dateKey={activeKey}
              onSelect={(key) => {
                setDateKey(key);
                setPickerOpen(false);
              }}
              open={pickerOpen}
              onToggle={togglePicker}
            />
            <button
              type="button"
              aria-label="Next day"
              onClick={() => setDateKey(shiftDateKey(activeKey, 1))}
              className="grid h-9 w-9 place-items-center rounded-lg text-[#53506B] transition hover:bg-[#F5F1FF] hover:text-[#4E35C6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDateKey(null)}
            className="min-h-10 rounded-xl border border-[#E7E6F0] bg-white px-3 text-xs font-semibold text-[#5A3ED0] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            Today
          </button>
          <p className="text-sm font-semibold text-[#17172F]">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: WORKTRACK_SCHEDULE.timezone,
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date(`${activeKey}T12:00:00Z`))}
          </p>
        </div>

        {outsideExercise ? (
          <p className="mb-4 shrink-0 rounded-xl border border-[#F3C56B] bg-[#FFF6E5] px-4 py-2.5 text-xs font-medium text-[#8A5A00]">
            This date is outside the work exercise ({formatDateLabel(EXERCISE_START_KEY)} – {formatDateLabel(EXERCISE_END_KEY)}).
            Any records found are still shown.
          </p>
        ) : null}

        <section aria-label="Daily summary" className="mb-4 grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <SummaryCard label="Staff who logged work" value={`${staffLogged} of ${db.employees.length}`} />
          <SummaryCard label="Work entries" value={String(workEntries)} />
          <SummaryCard label="Tasks done" value={String(tasksDone)} />
          <SummaryCard label="Overtime" value={formatMinutes(overtimeMinutes)} />
        </section>

        <section className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-52">
            <span className="sr-only">Search employees</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees"
              className="min-h-11 w-full rounded-xl border border-[#E7E6F0] bg-white px-3.5 text-base text-[#17172F] outline-none transition placeholder:text-[#A6A3BC] focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15"
            />
          </label>
          <WorkTrackSelect<BoardFilter>
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            className="w-44"
            options={[
              { value: "all", label: "All staff" },
              { value: "logged", label: "Work logged" },
              { value: "break", label: "On break" },
              { value: "none", label: "No work logged" },
            ]}
          />
          <p className="ml-auto hidden text-xs text-[#777A91] md:block">
            Office {formatMinutes(officeMinutes)} · Home {formatMinutes(homeMinutes)}
          </p>
        </section>
        <p className="mb-3 text-xs text-[#777A91] md:hidden">
          Office {formatMinutes(officeMinutes)} · Home {formatMinutes(homeMinutes)}
        </p>
        {exportError ? <p role="alert" className="mb-3 shrink-0 text-xs text-[#B43A3A]">{exportError}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-[#E7E6F0] bg-white shadow-sm md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#EEEAF2] bg-[#FCFBFF] text-[11px] font-semibold uppercase tracking-wide text-[#8B8B9A]">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Today’s work</th>
                <th className="px-4 py-3 text-right">Entries</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map(({ employee, day, status, snapshot }) => (
                <tr
                  key={employee.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${employee.name}'s work details`}
                  onClick={(e) => openEmployee(employee, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEmployee(employee, e.currentTarget);
                    }
                  }}
                  className="cursor-pointer border-b border-[#F1F0F6] transition last:border-0 hover:bg-[#FCFBFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C45F5]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={32} />
                      <span className="font-semibold text-[#17172F]">{employee.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#53506B]">{employee.role}</td>
                  <td className="max-w-0 px-4 py-3">
                    <span className="block truncate text-[#53506B]" title={snapshot}>{snapshot}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#17172F]">{day.entries.length}</td>
                  <td className="px-4 py-3">
                    <StatusBadges status={status} hasBreak={day.breaks.length > 0} hasOvertime={day.overtimeMinutes > 0} />
                  </td>
                </tr>
              ))}
              {visibleEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#777A91]">
                    No employees match this search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="space-y-2 md:hidden">
          {visibleEmployees.map(({ employee, day, status, snapshot }) => (
            <li key={employee.id}>
              <button
                type="button"
                onClick={(e) => openEmployee(employee, e.currentTarget)}
                className="w-full rounded-2xl border border-[#E7E6F0] bg-white p-4 text-left shadow-sm transition active:bg-[#FCFBFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[#17172F]">{employee.name}</span>
                      <span className="block truncate text-[11px] text-[#777A91]">{employee.role}</span>
                    </span>
                  </div>
                  <StatusBadges status={status} hasBreak={day.breaks.length > 0} hasOvertime={day.overtimeMinutes > 0} />
                </div>
                <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-[#53506B]">{snapshot}</p>
                <p className="mt-1.5 text-[11px] font-medium text-[#8B8B9A]">
                  {day.entries.length} work {day.entries.length === 1 ? "entry" : "entries"}
                </p>
              </button>
            </li>
          ))}
          {visibleEmployees.length === 0 ? (
            <li className="rounded-2xl border border-[#E7E6F0] bg-white px-4 py-8 text-center text-sm text-[#777A91]">
              No employees match this search.
            </li>
          ) : null}
        </ul>
        </div>
      </div>

      {selected ? (
        <EmployeeDrawer
          db={db}
          employee={selected}
          dateKey={activeKey}
          todayKey={todayKey}
          onClose={closeDrawer}
          onExport={() => exportDay(selected.id)}
          exporting={exporting}
        />
      ) : null}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E7E6F0] bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-[#777A91]">{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight text-[#17172F]">{value}</p>
    </div>
  );
}

function StatusBadges({ status, hasBreak, hasOvertime }: { status: EmployeeDay["status"]; hasBreak: boolean; hasOvertime: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === "on_break" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3D6] px-2 py-0.5 text-[10px] font-semibold text-[#9A6200]">
          <Coffee size={10} aria-hidden="true" /> On break
        </span>
      ) : status === "logged" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF8F0] px-2 py-0.5 text-[10px] font-semibold text-[#15803D]">
          <Check size={10} aria-hidden="true" /> Work logged
        </span>
      ) : status === "upcoming" ? (
        <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#8B8B9A]">Upcoming</span>
      ) : (
        <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#8B8B9A]">No work logged</span>
      )}
      {hasBreak && status !== "on_break" ? (
        <span className="rounded-full bg-[#FFF6E5] px-2 py-0.5 text-[10px] font-semibold text-[#9A6200]" title="Break recorded">
          Break
        </span>
      ) : null}
      {hasOvertime ? (
        <span className="rounded-full bg-[#FDF0E7] px-2 py-0.5 text-[10px] font-semibold text-[#B45309]" title="Overtime recorded">
          Overtime
        </span>
      ) : null}
    </span>
  );
}

function BoardDatePicker({
  dateKey,
  onSelect,
  open,
  onToggle,
}: {
  dateKey: string;
  onSelect: (key: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [view, setView] = useState(() => {
    const [y, m] = dateKey.split("-").map(Number);
    return { y, m };
  });
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const [y, m] = dateKey.split("-").map(Number);
      setView({ y, m });
    }
  }
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onToggle();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onToggle]);

  const daysInMonth = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay() + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(view.y, view.m - 1, 1))
  );

  const moveMonth = (delta: number) => {
    const d = new Date(Date.UTC(view.y, view.m - 1 + delta, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-9 min-w-[150px] items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-[#39364F] transition hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
      >
        {formatDateLabel(dateKey)}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute left-1/2 top-full z-50 mt-2 w-[280px] -translate-x-1/2 rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-[#53506B] hover:bg-[#F5F1FF]">
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <p className="text-xs font-bold text-[#17172F]">{monthLabel}</p>
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="grid h-8 w-8 place-items-center rounded-lg text-[#53506B] hover:bg-[#F5F1FF]">
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-[#8B8B9A]">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
              <span key={d} className="py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const key = `${view.y}-${pad2(view.m)}-${pad2(day)}`;
              const selected = key === dateKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-pressed={selected}
                  aria-label={formatDateLabel(key)}
                  className={`grid h-8 w-full place-items-center rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                    selected ? "bg-[#6C45F5] text-white" : "text-[#39364F] hover:bg-[#F5F1FF]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmployeeDrawer({
  db,
  employee,
  dateKey,
  todayKey,
  onClose,
  onExport,
  exporting,
}: {
  db: WorkLogDatabase;
  employee: Employee;
  dateKey: string;
  todayKey: string;
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const [viewDate, setViewDate] = useState(dateKey);
  const [syncedKey, setSyncedKey] = useState(`${employee.id}:${dateKey}`);
  const syncKey = `${employee.id}:${dateKey}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setViewDate(dateKey);
  }

  const day = getDaySummary(db, employee.id, viewDate, new Date());
  const timeline = [
    ...day.entries.map((entry) => ({ kind: "entry" as const, at: entry.startAt, entry })),
    ...day.breaks.map((brk) => ({ kind: "break" as const, at: brk.startAt, brk })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const referencedTaskIds = new Set(day.entries.map((e) => e.taskId));
  const referencedTasks = db.tasks.filter((t) => referencedTaskIds.has(t.id));
  const taskCounts = {
    done: referencedTasks.filter((t) => t.currentStatus === "completed").length,
    ongoing: referencedTasks.filter((t) => t.currentStatus === "ongoing" || t.currentStatus === "not_started").length,
    blocked: referencedTasks.filter((t) => t.currentStatus === "blocked").length,
    dropped: referencedTasks.filter((t) => t.currentStatus === "dropped").length,
  };

  const completedTasks = db.tasks.filter((t) => t.employeeId === employee.id && t.currentStatus === "completed");
  const employeeTaskIds = new Set(db.tasks.filter((t) => t.employeeId === employee.id).map((t) => t.id));
  const statusEvents = db.statusHistory
    .filter((e) => employeeTaskIds.has(e.taskId))
    .slice()
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
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
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#17172F]/35 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${employee.name} work details`}
        className="flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:w-[70vw] sm:max-w-[720px] sm:rounded-l-2xl lg:w-[62vw] lg:max-w-[1000px]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[#EEEAF2] px-4 py-3 sm:px-6">
          <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-[#17172F]">{employee.name}</h2>
            <p className="truncate text-[11px] text-[#777A91]">
              {employee.role} · {employee.department}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close employee details"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-[#F0EEF5] px-3 py-2 sm:px-5">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setViewDate(shiftDateKey(viewDate, -1))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
            <span className="truncate text-xs font-semibold text-[#39364F]">{formatDateLabel(viewDate)}</span>
            <button
              type="button"
              onClick={() => setViewDate(todayKey)}
              className="min-h-9 shrink-0 rounded-lg px-1.5 text-[11px] font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]"
            >
              Today
            </button>
          </div>
          <button
            type="button"
            aria-label="Next day"
            disabled={viewDate >= todayKey}
            onClick={() => setViewDate(shiftDateKey(viewDate, 1))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          <p className="mb-2 text-xs font-semibold text-[#39364F]">
            {day.entries.length} work {day.entries.length === 1 ? "entry" : "entries"}
            {day.overtimeMinutes > 0 ? ` · ${formatMinutes(day.overtimeMinutes)} overtime` : ""}
          </p>

          <h3 className="mb-2 text-[13px] font-semibold text-[#39364F]">Work log</h3>
          {timeline.length === 0 ? (
            <p className="rounded-xl bg-[#F7F7FC] px-4 py-5 text-center text-sm text-[#777A91]">
              {day.isFuture ? "This date is in the future." : "No work or break records for this day."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E7E6F0]">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-[#F7F7FC] text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Time</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Type</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Task</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Description</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Location</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2">Status</th>
                    <th scope="col" className="border-b border-[#E7E6F0] px-3 py-2 text-right">Overtime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F0F6]">
                  {timeline.map((item) =>
                    item.kind === "entry" ? (
                      <tr key={item.entry.id} className="align-top">
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="block text-xs font-semibold text-[#17172F]">
                            {formatTime(item.entry.startAt)} – {formatTime(item.entry.endAt)}
                          </span>
                          <span className="block text-[10px] font-medium text-[#A6A3BC]">
                            {formatMinutes(durationMinutes(item.entry.startAt, item.entry.endAt))}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-semibold text-[#5A3ED0]">Work</td>
                        <td className="max-w-[220px] px-3 py-2.5 text-xs font-semibold text-[#17172F]">
                          <span className="break-words">{getTaskById(db, item.entry.taskId)?.title ?? "Task"}</span>
                        </td>
                        <td className="max-w-[300px] px-3 py-2.5 text-xs leading-5 text-[#53506B]">
                          <span className="whitespace-pre-wrap break-words">{item.entry.description}</span>
                          {item.entry.evidenceLink ? (
                            <a
                              href={item.entry.evidenceLink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 font-semibold text-[#6C45F5] hover:underline"
                            >
                              <ExternalLink size={10} aria-hidden="true" /> Evidence
                            </a>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[#53506B]">
                          {WORK_LOCATION_LABELS[item.entry.workLocation]}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[#53506B]">
                          {STATUS_LABELS_SHORT[item.entry.statusAtEntry]}
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-semibold text-[#B45309]"
                          title={item.entry.isReportedOvertime ? "Reported overtime" : undefined}
                        >
                          {item.entry.overtimeMinutes > 0 ? formatMinutes(item.entry.overtimeMinutes) : "—"}
                        </td>
                      </tr>
                    ) : (
                      <tr key={item.brk.id} className="bg-[#FFF9ED] align-top">
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="block text-xs font-semibold text-[#8A5A00]">
                            {formatTime(item.brk.startAt)} – {item.brk.endAt ? formatTime(item.brk.endAt) : "In progress"}
                          </span>
                          {item.brk.endAt ? (
                            <span className="block text-[10px] font-medium text-[#C99B4A]">
                              {formatMinutes(durationMinutes(item.brk.startAt, item.brk.endAt))}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] font-semibold text-[#B45309]">Break</td>
                        <td className="px-3 py-2.5 text-xs text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-xs text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-[11px] text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-[11px] text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-right text-[11px] text-[#8A5A00]">—</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}

          <dl className="mb-3 mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <DrawerStat label="Work time" value={formatMinutes(day.workMinutes)} />
            <DrawerStat label="Break time" value={formatMinutes(day.breakMinutes)} />
            <DrawerStat label="Overtime" value={formatMinutes(day.overtimeMinutes)} />
            <DrawerStat label="Office" value={formatMinutes(day.officeMinutes)} />
            <DrawerStat label="Home" value={formatMinutes(day.homeMinutes)} />
            <DrawerStat label="Entries" value={String(day.entries.length)} />
            <DrawerStat label="Tasks done" value={String(taskCounts.done)} />
            <DrawerStat label="Tasks ongoing" value={String(taskCounts.ongoing)} />
            <DrawerStat label="Tasks blocked" value={String(taskCounts.blocked)} />
            <DrawerStat label="Tasks dropped" value={String(taskCounts.dropped)} />
          </dl>

          <section className="mt-4 border-t border-[#EEEAF2] pt-3">
            <h3 className="mb-2 text-[13px] font-semibold text-[#39364F]">Completed tasks</h3>
            {completedTasks.length === 0 ? (
              <p className="text-[13px] text-[#777A91]">No completed tasks.</p>
            ) : (
              <ul className="space-y-2">
                {completedTasks.map((t) => (
                  <li key={t.id} className="rounded-xl border border-[#E7E6F0] p-3">
                    <p className="text-sm font-semibold text-[#17172F]">{t.title}</p>
                    <p className="mt-0.5 text-[11px] text-[#777A91]">
                      Review:{" "}
                      {t.managementReview
                        ? t.managementReview.status === "accepted"
                          ? "Accepted"
                          : `Needs changes — ${t.managementReview.note ?? ""}`
                        : "Not reviewed"}
                    </p>
                    {noteFor === t.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={2}
                          aria-label="Reason for changes"
                          className="w-full rounded-lg border border-[#E7E6F0] p-2 text-base text-[#17172F] outline-none focus:border-[#6C45F5] lg:text-[13px]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => review(t.id, "needs_changes", note)}
                            className="rounded-lg bg-[#F59E0B] px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Send
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNoteFor(null);
                              setNote("");
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#53506B]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => review(t.id, "accepted")}
                          className="rounded-lg bg-[#6C45F5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5935DE]"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => setNoteFor(t.id)}
                          className="rounded-lg border border-[#E7E6F0] px-3 py-1.5 text-xs font-semibold text-[#53506B]"
                        >
                          Needs changes
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {error ? <p role="alert" className="mt-2 text-xs text-[#B43A3A]">{error}</p> : null}
          </section>

          {statusEvents.length > 0 ? (
            <section className="mt-4 border-t border-[#EEEAF2] pt-3">
              <h3 className="mb-2 text-[13px] font-semibold text-[#39364F]">Status changes</h3>
              <ol className="space-y-1.5">
                {statusEvents.map((e) => {
                  const task = getTaskById(db, e.taskId);
                  return (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F7F7FC] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#17172F]">{task?.title ?? "Task"}</p>
                        <p className="text-[11px] text-[#777A91]">
                          {e.previousStatus ? `${STATUS_LABELS_SHORT[e.previousStatus]} → ` : ""}
                          <span className="font-semibold text-[#5A3ED0]">{STATUS_LABELS_SHORT[e.newStatus]}</span>
                          {e.changeNote ? ` — ${e.changeNote}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-[#8B8B9A]">
                        {formatDateLabel(dateKeyOf(e.changedAt))} {formatTime(e.changedAt)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#EEEAF2] px-4 py-2.5 sm:px-6">
          <p className="text-[11px] text-[#8B8B9A]">Reviewing {formatDateLabel(viewDate)}</p>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#E7E6F0] px-3.5 text-xs font-semibold text-[#5A3ED0] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            {exporting ? "Preparing…" : "Export this day"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DrawerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F7F7FC] px-3 py-2">
      <dt className="text-[10px] font-medium text-[#8B8B9A]">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-[#17172F]">{value}</dd>
    </div>
  );
}

export function ExecutiveBoard() {
  return (
    <>
      <div className="lg:hidden">
        <ExecutiveMobile />
      </div>
      <div className="hidden lg:block">
        <ExecutiveDesktopBoard />
      </div>
    </>
  );
}
