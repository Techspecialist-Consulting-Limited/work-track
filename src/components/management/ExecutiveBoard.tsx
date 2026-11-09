"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Download,
  ExternalLink,
  FileText,
  Folder,
  X,
  Zap,
} from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { ExecutiveMobile } from "./mobile/ExecutiveMobile";
import { InviteChairman } from "./InviteChairman";
import { Avatar } from "./mobile/shared";
import {
  buildEmployeeHierarchy,
  getRecoveredDaySummary,
  LegacyTaskList,
  RecoveredDayPanel,
  TaskGroupList,
  VerificationBadge,
  type EmployeeHierarchy,
  type HierarchyTask,
} from "./TaskHierarchy";
import {
  getDatabaseSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getServerSnapshot,
  getSessionUser,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
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

const STATUS_LABELS_SHORT: Record<TaskStatus, string> = {
  ongoing: "Ongoing",
  done: "Done",
  blocked: "Blocked",
  dropped: "Dropped",
};

type BoardFilter = "all" | "logged" | "break" | "none";
type BoardView = "staff" | "tasks";

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
  const [boardView, setBoardView] = useState<BoardView>("staff");
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

  const hierarchies = useMemo(
    () =>
      db.employees
        .map((employee) => buildEmployeeHierarchy(db, employee.id, activeKey))
        .filter((hierarchy): hierarchy is EmployeeHierarchy => hierarchy !== null),
    [db, activeKey]
  );
  const hierarchyById = new Map(hierarchies.map((hierarchy) => [hierarchy.employee.id, hierarchy]));
  const visibleHierarchies = visibleEmployees
    .map(({ employee }) => hierarchyById.get(employee.id))
    .filter((hierarchy): hierarchy is EmployeeHierarchy => Boolean(hierarchy));
  const visibleTaskItems = visibleHierarchies.flatMap((hierarchy) => hierarchy.tasks);
  const visibleLegacyTasks = visibleHierarchies.flatMap((hierarchy) => hierarchy.legacyTasks);
  const recovered = useMemo(() => getRecoveredDaySummary(db, activeKey), [db, activeKey]);

  const staffLogged = employeeDays.filter((e) => e.day.entries.length > 0).length;
  const workEntries = employeeDays.reduce((s, e) => s + e.day.entries.length, 0);
  const tasksDone = db.tasks.filter((t) => t.completedAt && dateKeyOf(t.completedAt) === activeKey).length;
  const overtimeMinutes = employeeDays.reduce((s, e) => s + e.day.overtimeMinutes, 0);
  const officeMinutes = employeeDays.reduce((s, e) => s + e.day.officeMinutes, 0);
  const homeMinutes = employeeDays.reduce((s, e) => s + e.day.homeMinutes, 0);
  const unknownMinutes = employeeDays.reduce((s, e) => s + e.day.unknownMinutes, 0);

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
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : getSessionRole() === "chairman" ? "Chairman" : "HR / Head of Operations"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={canEditProfile}
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
          <div
            role="group"
            aria-label="Board view"
            className="inline-flex items-center gap-1 rounded-xl border border-[#E7E6F0] bg-white p-1 shadow-sm"
          >
            {(["staff", "tasks"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={boardView === option}
                onClick={() => setBoardView(option)}
                className={`min-h-8 rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                  boardView === option ? "bg-[#6C45F5] text-white" : "text-[#53506B] hover:bg-[#F5F1FF]"
                }`}
              >
                {option === "staff" ? "By Staff" : "By Tasks"}
              </button>
            ))}
          </div>
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

        {recovered ? <RecoveredDayPanel summary={recovered} dateKey={activeKey} className="mb-4 shrink-0" /> : null}

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
            {unknownMinutes > 0 ? ` · Location unknown ${formatMinutes(unknownMinutes)}` : ""}
          </p>
        </section>
        <p className="mb-3 text-xs text-[#777A91] md:hidden">
          Office {formatMinutes(officeMinutes)} · Home {formatMinutes(homeMinutes)}
          {unknownMinutes > 0 ? ` · Location unknown ${formatMinutes(unknownMinutes)}` : ""}
        </p>
        {exportError ? <p role="alert" className="mb-3 shrink-0 text-xs text-[#B43A3A]">{exportError}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {boardView === "tasks" ? (
          <div className="space-y-5">
            <section>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-[#39364F]">Tasks with timed work</h2>
                <span className="text-[11px] font-medium text-[#8B8B9A]">
                  {visibleTaskItems.length} {visibleTaskItems.length === 1 ? "task" : "tasks"} ·{" "}
                  {visibleTaskItems.reduce((total, item) => total + item.entryCount, 0)} entries
                </span>
              </div>
              <TaskGroupList
                items={visibleTaskItems}
                showEmployee
                emptyMessage="No timed tasks for this date."
              />
            </section>
            <LegacyTaskList tasks={visibleLegacyTasks} />
          </div>
        ) : (
          <>
        {/* Desktop table */}
        <div className="hidden overflow-x-auto rounded-2xl border border-[#E7E6F0] bg-white shadow-sm md:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-[#EEEAF2] bg-[#FCFBFF] text-[11px] font-semibold uppercase tracking-wide text-[#8B8B9A]">
                <th className="px-4 py-3">Employee</th>
                <th className="w-[120px] px-4 py-3">Role</th>
                <th className="w-[90px] px-4 py-3 text-right">Work time</th>
                <th className="w-[70px] px-4 py-3 text-right">Entries</th>
                <th className="w-[70px] px-4 py-3 text-right">Tasks</th>
                <th className="w-[140px] px-4 py-3">Verification</th>
                <th className="w-[170px] px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map(({ employee, day, status, snapshot }) => {
                const hierarchy = hierarchyById.get(employee.id);
                const taskCount = hierarchy?.tasks.length ?? 0;
                return (
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
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[#17172F]">{employee.name}</span>
                        <span className="block truncate text-[11px] text-[#8B8B9A]" title={snapshot}>
                          {snapshot}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="break-words px-4 py-3 text-[#53506B]">{employee.role}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-[#17172F]">
                    {formatMinutes(day.workMinutes)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#17172F]">{day.entries.length}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#17172F]">{taskCount}</td>
                  <td className="px-4 py-3">
                    {taskCount > 0 && hierarchy ? (
                      <VerificationBadge verification={hierarchy.verification} />
                    ) : (
                      <span className="text-[11px] text-[#A6A3BC]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadges status={status} hasBreak={day.breaks.length > 0} hasOvertime={day.overtimeMinutes > 0} />
                  </td>
                </tr>
                );
              })}
              {visibleEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#777A91]">
                    No employees match this search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="space-y-2 md:hidden">
          {visibleEmployees.map(({ employee, day, status, snapshot }) => {
            const hierarchy = hierarchyById.get(employee.id);
            const taskCount = hierarchy?.tasks.length ?? 0;
            return (
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
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[#8B8B9A]">
                  <span>{day.entries.length} work {day.entries.length === 1 ? "entry" : "entries"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatMinutes(day.workMinutes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{taskCount} {taskCount === 1 ? "task" : "tasks"}</span>
                  {taskCount > 0 && hierarchy ? (
                    <VerificationBadge verification={hierarchy.verification} />
                  ) : null}
                </p>
              </button>
            </li>
            );
          })}
          {visibleEmployees.length === 0 ? (
            <li className="rounded-2xl border border-[#E7E6F0] bg-white px-4 py-8 text-center text-sm text-[#777A91]">
              No employees match this search.
            </li>
          ) : null}
        </ul>
          </>
        )}
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

const ACTIVITY_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  ongoing: "bg-[#EFF6FF] text-[#1D4ED8]",
  done: "bg-[#ECFDF5] text-[#047857]",
  blocked: "bg-[#FFFBEB] text-[#B45309]",
  dropped: "bg-[#F1F1F5] text-[#6B6B7E]",
};

function ActivityStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${ACTIVITY_STATUS_BADGE_CLASSES[status]}`}
    >
      {STATUS_LABELS_SHORT[status]}
    </span>
  );
}

function activityLocationLabel(location: WorkEntry["workLocation"]): string {
  return location === "unknown" ? "—" : WORK_LOCATION_LABELS[location];
}

function ActivityMetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E7E6F0] bg-white px-3.5 py-3">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#F3EEFF] text-[#6C45F5]"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">{label}</span>
        <span className="block text-lg font-bold leading-6 text-[#17172F]">{value}</span>
      </span>
    </div>
  );
}

function ActivityEntryRow({
  entry,
  name,
  status,
}: {
  entry: WorkEntry;
  name: string;
  status: TaskStatus;
}) {
  return (
    <tr className="align-top border-t border-[#F5F3FB] bg-white">
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="block text-xs font-semibold text-[#17172F]">
          {formatTime(entry.startAt)} – {formatTime(entry.endAt)}
        </span>
      </td>
      <td className="max-w-[180px] px-3 py-2.5 text-xs font-medium text-[#39364F]">
        <span className="break-words">{name}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-[#8B8B9A]">—</td>
      <td className="max-w-[280px] px-3 py-2.5 text-xs leading-5 text-[#53506B]">
        <span className="whitespace-pre-wrap break-words">{entry.description}</span>
        {entry.evidenceLink ? (
          <a
            href={entry.evidenceLink}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 font-semibold text-[#6C45F5] hover:underline"
          >
            <ExternalLink size={10} aria-hidden="true" /> Evidence
          </a>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <ActivityStatusBadge status={status} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#53506B]">{activityLocationLabel(entry.workLocation)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-[#17172F]">
        {formatMinutes(durationMinutes(entry.startAt, entry.endAt))}
        {entry.overtimeMinutes > 0 ? (
          <span
            className="ml-1.5 rounded bg-[#FFF1E8] px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#B45309]"
            title="Includes overtime"
          >
            OT
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function ActivityTaskRows({
  item,
  open,
  onToggle,
}: {
  item: HierarchyTask;
  open: boolean;
  onToggle: () => void;
}) {
  const { task } = item;
  const directEntries = item.entries.filter((entry) => !entry.subtaskId);
  const sortedEntries = [...item.entries].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const intervalsTitle = sortedEntries
    .map((entry) => `${formatTime(entry.startAt)} – ${formatTime(entry.endAt)}`)
    .join("\n");
  const taskTimeLabel =
    item.entries.length === 1
      ? `${formatTime(item.entries[0].startAt)} – ${formatTime(item.entries[0].endAt)}`
      : `${item.entries.length} ${item.entries.length === 1 ? "entry" : "entries"}`;
  return (
    <>
      <tr className="bg-[#F5F2FD] align-top">
        <td className="whitespace-nowrap px-3 py-2.5" title={item.entries.length > 1 ? intervalsTitle : undefined}>
          <span className="block text-xs font-semibold text-[#17172F]">{taskTimeLabel}</span>
        </td>
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`shrink-0 text-[#DC2626] transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <Folder size={14} aria-hidden="true" className="shrink-0 text-[#6C45F5]" />
            <span className="break-words text-xs font-bold text-[#17172F]">{task.title}</span>
          </button>
          {item.entryCount > 1 ? (
            <span className="mt-0.5 block pl-6 text-[10px] font-medium text-[#8B8B9A]">
              {item.entryCount} work {item.entryCount === 1 ? "entry" : "entries"}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-xs leading-5 text-[#53506B]">
          {open ? <span className="whitespace-pre-wrap break-words">{task.description ?? "—"}</span> : <span className="text-[#8B8B9A]">—</span>}
        </td>
        <td className="px-3 py-2.5 text-xs text-[#8B8B9A]">—</td>
        <td className="px-3 py-2.5">
          <ActivityStatusBadge status={task.currentStatus} />
        </td>
        <td className="px-3 py-2.5 text-xs text-[#8B8B9A]">—</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-bold text-[#17172F]">
          {item.minutes > 0 ? formatMinutes(item.minutes) : "—"}
        </td>
      </tr>
      {open ? (
        <>
          {item.subtasks.map((sub) => (
            <Fragment key={sub.subtask.id}>
              <tr className="bg-[#FBFAFE] align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="block text-[11px] font-semibold text-[#39364F]">
                    {sub.entries.length > 0
                      ? `${sub.entries.length} ${sub.entries.length === 1 ? "entry" : "entries"}`
                      : "—"}
                  </span>
                </td>
                <td className="px-3 py-2 pl-9 text-xs font-semibold text-[#39364F]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3.5 w-px bg-[#D8D0F2]" aria-hidden="true" />
                    <span className="break-words">{sub.subtask.title}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs leading-5 text-[#777A91]">
                  <span className="whitespace-pre-wrap break-words">{sub.subtask.description ?? "—"}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-[#8B8B9A]">—</td>
                <td className="px-3 py-2.5">
                  <ActivityStatusBadge status={sub.subtask.status} />
                </td>
                <td className="px-3 py-2.5 text-xs text-[#8B8B9A]">—</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-[#53506B]">
                  —
                </td>
              </tr>
              {sub.entries.map((entry) => (
                <ActivityEntryRow key={entry.id} entry={entry} name={sub.subtask.title} status={sub.subtask.status} />
              ))}
            </Fragment>
          ))}
          {directEntries.map((entry) => (
            <ActivityEntryRow key={entry.id} entry={entry} name={task.title} status={task.currentStatus} />
          ))}
        </>
      ) : (
        sortedEntries.map((entry) => {
          const sub = entry.subtaskId
            ? item.subtasks.find((candidate) => candidate.subtask.id === entry.subtaskId)
            : undefined;
          return (
            <ActivityEntryRow
              key={entry.id}
              entry={entry}
              name={sub ? sub.subtask.title : task.title}
              status={sub ? sub.subtask.status : task.currentStatus}
            />
          );
        })
      )}
    </>
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
  const [closedTasks, setClosedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const syncKey = `${employee.id}:${dateKey}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setViewDate(dateKey);
    setClosedTasks(new Set());
  }

  const toggleTask = (taskId: string) => {
    setClosedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const day = getDaySummary(db, employee.id, viewDate, new Date());
  const hierarchy = buildEmployeeHierarchy(db, employee.id, viewDate);

  const blocks = [
    ...(hierarchy?.tasks ?? []).map((item) => ({ kind: "task" as const, at: item.firstStartAt, item })),
    ...day.breaks.map((brk) => ({ kind: "break" as const, at: brk.startAt, brk })),
  ].sort((a, b) => a.at.localeCompare(b.at));

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
        className="m-2 flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:m-4 sm:h-[calc(100dvh-2rem)] sm:w-[min(84vw,1400px)] sm:min-w-[min(900px,84vw)]"
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

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[#EEEAF2] px-4 py-3 sm:px-6 lg:grid-cols-4">
          <ActivityMetricCard
            icon={<Clock size={15} aria-hidden="true" />}
            label="Total Work Time"
            value={formatMinutes(day.workMinutes)}
          />
          <ActivityMetricCard
            icon={<Coffee size={15} aria-hidden="true" />}
            label="Break Time"
            value={formatMinutes(day.breakMinutes)}
          />
          <ActivityMetricCard
            icon={<Zap size={15} aria-hidden="true" />}
            label="Overtime"
            value={formatMinutes(day.overtimeMinutes)}
          />
          <ActivityMetricCard
            icon={<FileText size={15} aria-hidden="true" />}
            label="Work Entries"
            value={String(day.entries.length)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3 sm:px-6">
          <div className="overflow-x-auto rounded-xl border border-[#E7E6F0]">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#F1EDFB] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5C5478]">
                  <th scope="col" className="px-3 py-2.5">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Task / Subtask
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Task Description
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Work Performed (This Period)
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Location
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {blocks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-sm text-[#777A91]">
                      No work entries recorded for this date.
                    </td>
                  </tr>
                ) : (
                  blocks.map((block) =>
                    block.kind === "break" ? (
                      <tr key={`break-${block.brk.id}`} className="border-t border-[#F6E7CF] bg-[#FFF9ED] align-top">
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="block text-xs font-semibold text-[#8A5A00]">
                            {formatTime(block.brk.startAt)} –{" "}
                            {block.brk.endAt ? formatTime(block.brk.endAt) : "In progress"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#B45309]">
                            <Coffee size={12} aria-hidden="true" />
                            Break
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-xs italic text-[#8A5A00]">Break</td>
                        <td className="px-3 py-2.5 text-xs text-[#8A5A00]">—</td>
                        <td className="px-3 py-2.5 text-xs text-[#8A5A00]">—</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-[#8A5A00]">
                          {block.brk.endAt
                            ? formatMinutes(durationMinutes(block.brk.startAt, block.brk.endAt))
                            : "—"}
                        </td>
                      </tr>
                    ) : (
                      <ActivityTaskRows
                        key={block.item.task.id}
                        item={block.item}
                        open={!closedTasks.has(block.item.task.id)}
                        onToggle={() => toggleTask(block.item.task.id)}
                      />
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#EEEAF2] px-4 py-2.5 sm:px-6">
          <p className="text-[11px] text-[#8B8B9A]">Reviewing {formatDateLabel(viewDate)}</p>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6C45F5] px-4 text-xs font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            {exporting ? "Preparing…" : "Export This Day"}
          </button>
        </footer>
      </aside>
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
