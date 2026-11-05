"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Coffee,
  Download,
  Home,
  ListOrdered,
  MapPin,
} from "lucide-react";
import { WORK_LOCATION_LABELS } from "@/lib/worklog/config";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { getDaySummary, getTaskById, type DaySummary } from "@/lib/worklog/selectors";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime12 } from "@/lib/worklog/time";
import type { BreakEntry, Employee, Task, WorkEntry, WorkLogDatabase } from "@/lib/worklog/types";
import { Avatar, BottomSheet, MetricCard, SheetOption, dateKeyParts, pad2, primaryLocation, LOCATION_LABELS, shiftDateKey } from "./shared";

type DetailTab = "overview" | "history" | "breaks" | "overtime";
type HistoryFilter = "all" | "work" | "breaks" | "overtime";
type TimelineItem =
  | { kind: "entry"; at: string; entry: WorkEntry }
  | { kind: "break"; at: string; brk: BreakEntry };

const TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "Work History" },
  { id: "breaks", label: "Breaks" },
  { id: "overtime", label: "Overtime" },
];

const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All Records" },
  { id: "work", label: "Work" },
  { id: "breaks", label: "Breaks" },
  { id: "overtime", label: "Overtime" },
];

function LocationIcon({ location, size = 13 }: { location: ReturnType<typeof primaryLocation>; size?: number }) {
  const cls = "text-[#666783]";
  if (location === "office") return <Building2 size={size} className={cls} aria-hidden="true" />;
  if (location === "home") return <Home size={size} className={cls} aria-hidden="true" />;
  if (location === "mixed") return <ArrowLeftRight size={size} className={cls} aria-hidden="true" />;
  if (location === "other") return <MapPin size={size} className={cls} aria-hidden="true" />;
  return null;
}

function timeRange(startAt: string, endAt: string | null) {
  return `${formatTime12(startAt)} – ${endAt ? formatTime12(endAt) : "In progress"}`;
}

export function EmployeeDetailMobile({
  db,
  employee,
  boardDateKey,
  todayKey,
  onClose,
}: {
  db: WorkLogDatabase;
  employee: Employee;
  boardDateKey: string;
  todayKey: string;
  onClose: () => void;
}) {
  const [viewDate, setViewDate] = useState(boardDateKey);
  const [syncedKey, setSyncedKey] = useState(`${employee.id}:${boardDateKey}`);
  const syncKey = `${employee.id}:${boardDateKey}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setViewDate(boardDateKey);
  }

  const [tab, setTab] = useState<DetailTab>("overview");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const day = getDaySummary(db, employee.id, viewDate, now);
  const location = primaryLocation(day);

  const tasksRecorded = new Set(day.entries.map((e) => e.taskId)).size;

  const completedTasks = useMemo(() => {
    return db.tasks.filter(
      (t) => t.employeeId === employee.id && t.currentStatus === "completed" && t.completedAt && dateKeyOf(t.completedAt) === viewDate
    );
  }, [db.tasks, employee.id, viewDate]);

  const taskMinutesOnDay = (taskId: string) =>
    day.entries.filter((e) => e.taskId === taskId).reduce((s, e) => s + durationMinutes(e.startAt, e.endAt), 0);

  const overtimeEntries = day.entries.filter((e) => e.overtimeMinutes > 0);

  async function exportDay() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadWorkLogWorkbook(
        db,
        { fromKey: viewDate, toKey: viewDate, employeeId: employee.id },
        `WorkTrack_${employee.name.replace(/\s+/g, "-")}_${viewDate}.xlsx`
      );
    } catch {
      setExportError("The workbook could not be created. Try again.");
    } finally {
      setExporting(false);
    }
  }

  function showWorkHistory() {
    setHistoryFilter("all");
    setTab("history");
  }

  const timeline = useMemo(() => {
    const items = [
      ...day.entries.map((entry) => ({ kind: "entry" as const, at: entry.startAt, entry })),
      ...day.breaks.map((brk) => ({ kind: "break" as const, at: brk.startAt, brk })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    if (historyFilter === "work") return items.filter((i) => i.kind === "entry");
    if (historyFilter === "breaks") return items.filter((i) => i.kind === "break");
    if (historyFilter === "overtime")
      return items.filter((i) => i.kind === "entry" && i.entry.overtimeMinutes > 0);
    return items;
  }, [day.entries, day.breaks, historyFilter]);

  const emptyMessage =
    historyFilter === "all"
      ? day.isFuture
        ? "This date is in the future."
        : "No work logged for this date."
      : historyFilter === "work"
        ? "No work records match this filter."
        : historyFilter === "breaks"
          ? "No break records."
          : "No overtime recorded.";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F7F6FC] lg:hidden">
      <header
        className="flex shrink-0 items-center border-b border-[#EAE8F2] bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ minHeight: "calc(56px + env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to Team Board"
          className="grid h-10 w-10 place-items-center rounded-full bg-[#B42318] text-white shadow-sm transition hover:bg-[#912018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="flex-1 text-center text-[15px] font-bold text-[#17172B]">Employee Details</h1>
        <span className="h-10 w-10" aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-5">
          {/* Profile */}
          <section className="flex items-center gap-4">
            <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={72} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-[#17172B]">{employee.name}</h2>
              <p className="truncate text-[13px] text-[#666783]">
                {employee.role} · {employee.department}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-[#666783]">
                <LocationIcon location={location} />
                {LOCATION_LABELS[location]}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-[#666783]">
                <Clock size={12} aria-hidden="true" />
                Total: {formatMinutes(day.workMinutes)}
              </p>
            </div>
          </section>

          {/* Date navigator */}
          <div className="mt-4 flex items-center justify-center gap-1 rounded-2xl border border-[#EAE8F2] bg-white px-2 py-1.5">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setViewDate(shiftDateKey(viewDate, -1))}
              className="grid h-9 w-9 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setDateSheetOpen(true)}
              className="flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-[#17172B] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
            >
              <Calendar size={14} className="shrink-0 text-[#6040E8]" aria-hidden="true" />
              <span className="truncate">{formatDateLabel(viewDate)}</span>
            </button>
            <button
              type="button"
              aria-label="Next day"
              disabled={viewDate >= todayKey}
              onClick={() => setViewDate(shiftDateKey(viewDate, 1))}
              className="grid h-9 w-9 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Employee detail sections"
            className="mt-4 grid grid-cols-4 gap-1 rounded-2xl bg-[#ECEAF6] p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`min-h-10 rounded-xl px-1 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] sm:text-xs ${
                  tab === t.id ? "bg-[#6040E8] text-white shadow-sm" : "text-[#666783] hover:text-[#17172B]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === "overview" ? (
              <OverviewTab
                day={day}
                viewDate={viewDate}
                tasksRecorded={tasksRecorded}
                completedTasks={completedTasks}
                taskMinutesOnDay={taskMinutesOnDay}
                onViewHistory={showWorkHistory}
              />
            ) : tab === "history" ? (
              <HistoryTab
                timeline={timeline}
                db={db}
                filter={historyFilter}
                emptyMessage={emptyMessage}
                onOpenFilter={() => setFilterSheetOpen(true)}
                onResetFilter={() => setHistoryFilter("all")}
                viewDate={viewDate}
                onExport={exportDay}
                exporting={exporting}
                exportError={exportError}
              />
            ) : tab === "breaks" ? (
              <BreaksTab day={day} />
            ) : (
              <OvertimeTab day={day} overtimeEntries={overtimeEntries} db={db} />
            )}
          </div>
        </div>
      </div>

      {/* Date picker sheet */}
      <DateSheet
        open={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        viewDate={viewDate}
        todayKey={todayKey}
        onSelect={(key) => {
          setViewDate(key);
          setDateSheetOpen(false);
        }}
      />

      {/* History filter sheet */}
      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter records">
        <div className="flex flex-col gap-1">
          {HISTORY_FILTERS.map((f) => (
            <SheetOption
              key={f.id}
              label={f.label}
              selected={historyFilter === f.id}
              onClick={() => {
                setHistoryFilter(f.id);
                setFilterSheetOpen(false);
              }}
            />
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}

function OverviewTab({
  day,
  viewDate,
  tasksRecorded,
  completedTasks,
  taskMinutesOnDay,
  onViewHistory,
}: {
  day: DaySummary;
  viewDate: string;
  tasksRecorded: number;
  completedTasks: Task[];
  taskMinutesOnDay: (taskId: string) => number;
  onViewHistory: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold text-[#17172B]">Daily Summary</h3>
        <span className="text-[11px] font-medium text-[#9292A8]">{formatDateLabel(viewDate)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <MetricCard
          icon={<ClipboardCheck size={18} className="text-[#159947]" aria-hidden="true" />}
          iconClass="bg-[#EAF8EF]"
          value={String(tasksRecorded)}
          label="Tasks Recorded"
        />
        <MetricCard
          icon={<CheckCircle2 size={18} className="text-[#6040E8]" aria-hidden="true" />}
          iconClass="bg-[#EFEAFF]"
          value={formatMinutes(day.workMinutes)}
          label="Work Time"
        />
        <MetricCard
          icon={<Coffee size={18} className="text-[#E99A16]" aria-hidden="true" />}
          iconClass="bg-[#FFF5E5]"
          value={formatMinutes(day.breakMinutes)}
          label="Break Time"
        />
        <MetricCard
          icon={<Clock size={18} className="text-[#B45309]" aria-hidden="true" />}
          iconClass="bg-[#FFF5E5]"
          value={formatMinutes(day.overtimeMinutes)}
          label="Overtime"
        />
      </div>

      <section className="mt-6">
        <h3 className="text-[15px] font-bold text-[#17172B]">
          Tasks Completed ({completedTasks.length})
        </h3>
        {completedTasks.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-[#EAE8F2] bg-white px-4 py-5 text-center text-[13px] text-[#666783]">
            No tasks completed on this date.
          </p>
        ) : (
          <ol className="mt-3">
            {completedTasks.map((task) => {
              const minutes = taskMinutesOnDay(task.id);
              return (
                <li key={task.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
                  <span className="relative flex flex-col items-center">
                    <span className="z-10 mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-white bg-[#6040E8] shadow" aria-hidden="true" />
                    <span className="absolute top-4 h-full w-px bg-[#EAE8F2]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-[#EAE8F2] bg-white px-3.5 py-3">
                    <p className="break-words text-[13px] font-semibold leading-5 text-[#17172B]">{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {minutes > 0 ? (
                        <span className="text-[11px] font-medium text-[#9292A8]">{formatMinutes(minutes)} recorded</span>
                      ) : null}
                      <span className="rounded-full bg-[#EAF8EF] px-2 py-0.5 text-[10px] font-bold text-[#159947]">
                        Completed
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <button
        type="button"
        onClick={onViewHistory}
        className="mt-6 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#6040E8] text-sm font-bold text-white shadow-sm transition hover:bg-[#4F31D0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] focus-visible:ring-offset-2"
      >
        <ListOrdered size={16} aria-hidden="true" />
        View Full Work History
      </button>
    </div>
  );
}

function HistoryTab({
  timeline,
  db,
  filter,
  emptyMessage,
  onOpenFilter,
  onResetFilter,
  viewDate,
  onExport,
  exporting,
  exportError,
}: {
  timeline: TimelineItem[];
  db: WorkLogDatabase;
  filter: HistoryFilter;
  emptyMessage: string;
  onOpenFilter: () => void;
  onResetFilter: () => void;
  viewDate: string;
  onExport: () => void;
  exporting: boolean;
  exportError: string | null;
}) {
  const filterLabel = HISTORY_FILTERS.find((f) => f.id === filter)?.label ?? "All Records";
  return (
    <div>
      <button
        type="button"
        onClick={onOpenFilter}
        className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[#EAE8F2] bg-white px-4 text-sm font-semibold text-[#17172B] transition hover:border-[#D8D4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
      >
        {filterLabel}
        <ChevronDown size={16} className="text-[#9292A8]" aria-hidden="true" />
      </button>

      <div className="mb-2 mt-4 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold text-[#17172B]">Daily Work Log</h3>
        <span className="text-[11px] font-medium text-[#9292A8]">{formatDateLabel(viewDate)}</span>
      </div>

      {timeline.length === 0 ? (
        <div className="rounded-2xl border border-[#EAE8F2] bg-white px-4 py-6 text-center">
          <p className="text-[13px] text-[#666783]">{emptyMessage}</p>
          {filter !== "all" ? (
            <button
              type="button"
              onClick={onResetFilter}
              className="mt-3 min-h-10 rounded-full bg-[#EFEAFF] px-4 text-[12px] font-bold text-[#4F31D0] transition hover:bg-[#E4DEFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
            >
              Show all records
            </button>
          ) : null}
        </div>
      ) : (
        <ol className="divide-y divide-[#ECEAF6] rounded-2xl border border-[#EAE8F2] bg-white">
          {timeline.map((item) =>
            item.kind === "entry" ? (
              <WorkRow key={item.entry.id} db={db} entry={item.entry} />
            ) : (
              <BreakRow key={item.brk.id} brk={item.brk} />
            )
          )}
        </ol>
      )}

      {exportError ? <p role="alert" className="mt-3 text-xs text-[#B43A3A]">{exportError}</p> : null}
      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="mt-5 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-[#DCD6F5] bg-[#F3F0FE] text-sm font-bold text-[#4F31D0] transition hover:bg-[#ECE7FD] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
      >
        <Download size={16} aria-hidden="true" />
        {exporting ? "Preparing…" : "Export Daily Report (Excel)"}
      </button>
    </div>
  );
}

function WorkRow({ db, entry }: { db: WorkLogDatabase; entry: WorkEntry }) {
  const isOvertime = entry.overtimeMinutes > 0;
  const task = getTaskById(db, entry.taskId);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          isOvertime ? "bg-[#FFF5E5]" : "bg-[#EAF8EF]"
        }`}
      >
        {isOvertime ? (
          <Clock size={17} className="text-[#E99A16]" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={17} className="text-[#159947]" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#17172B]">
          {isOvertime ? "Overtime · " : ""}
          {task?.title ?? "Task"}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#9292A8]">
          {timeRange(entry.startAt, entry.endAt)} · {WORK_LOCATION_LABELS[entry.workLocation]}
          {isOvertime ? ` · ${formatMinutes(entry.overtimeMinutes)} OT` : ""}
          {entry.isReportedOvertime ? " · Reported" : ""}
        </p>
      </div>
      <span className="shrink-0 text-[12px] font-bold text-[#17172B]">
        {formatMinutes(durationMinutes(entry.startAt, entry.endAt))}
      </span>
    </li>
  );
}

function BreakRow({ brk }: { brk: BreakEntry }) {
  return (
    <li className="flex items-center gap-3 bg-[#FFF9ED]/60 px-4 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF5E5]">
        <Coffee size={17} className="text-[#E99A16]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#17172B]">Break</p>
        <p className="mt-0.5 text-[11px] text-[#9292A8]">{timeRange(brk.startAt, brk.endAt)}</p>
      </div>
      <span className="shrink-0 text-[12px] font-bold text-[#17172B]">
        {brk.endAt ? formatMinutes(durationMinutes(brk.startAt, brk.endAt)) : "—"}
      </span>
    </li>
  );
}

function BreaksTab({ day }: { day: DaySummary }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold text-[#17172B]">Breaks</h3>
        <span className="rounded-full bg-[#FFF5E5] px-2.5 py-1 text-[11px] font-bold text-[#B45309]">
          Total {formatMinutes(day.breakMinutes)}
        </span>
      </div>
      {day.breaks.length === 0 ? (
        <p className="rounded-2xl border border-[#EAE8F2] bg-white px-4 py-6 text-center text-[13px] text-[#666783]">
          No break records.
        </p>
      ) : (
        <ol className="divide-y divide-[#ECEAF6] rounded-2xl border border-[#EAE8F2] bg-white">
          {day.breaks.map((brk) => (
            <BreakRow key={brk.id} brk={brk} />
          ))}
        </ol>
      )}
    </div>
  );
}

function OvertimeTab({
  day,
  overtimeEntries,
  db,
}: {
  day: DaySummary;
  overtimeEntries: WorkEntry[];
  db: WorkLogDatabase;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold text-[#17172B]">Overtime</h3>
        <span className="rounded-full bg-[#FFF5E5] px-2.5 py-1 text-[11px] font-bold text-[#B45309]">
          Total {formatMinutes(day.overtimeMinutes)}
        </span>
      </div>
      {overtimeEntries.length === 0 ? (
        <p className="rounded-2xl border border-[#EAE8F2] bg-white px-4 py-6 text-center text-[13px] text-[#666783]">
          No overtime recorded.
        </p>
      ) : (
        <ol className="divide-y divide-[#ECEAF6] rounded-2xl border border-[#EAE8F2] bg-white">
          {overtimeEntries.map((entry) => {
            const task = getTaskById(db, entry.taskId);
            return (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF5E5]">
                  <Clock size={17} className="text-[#E99A16]" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#17172B]">
                    Overtime · {task?.title ?? "Task"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[#9292A8]">
                    {timeRange(entry.startAt, entry.endAt)} · {WORK_LOCATION_LABELS[entry.workLocation]}
                    {entry.isReportedOvertime ? " · Reported" : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] font-bold text-[#B45309]">
                  {formatMinutes(entry.overtimeMinutes)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function DateSheet({
  open,
  onClose,
  viewDate,
  todayKey,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  viewDate: string;
  todayKey: string;
  onSelect: (key: string) => void;
}) {
  const [view, setView] = useState(() => {
    const { y, m } = dateKeyParts(viewDate);
    return { y, m };
  });
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const { y, m } = dateKeyParts(viewDate);
      setView({ y, m });
    }
  }

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
    <BottomSheet open={open} onClose={onClose} title="Choose a date">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
          className="grid h-10 w-10 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <p className="text-sm font-bold text-[#17172B]">{monthLabel}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => moveMonth(1)}
          className="grid h-10 w-10 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-[#9292A8]">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} className="py-1.5">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const key = `${view.y}-${pad2(view.m)}-${pad2(day)}`;
          const selected = key === viewDate;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={selected}
              aria-label={formatDateLabel(key)}
              className={`grid h-10 w-full place-items-center rounded-xl text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
                selected
                  ? "bg-[#6040E8] text-white"
                  : isToday
                    ? "bg-[#EFEAFF] text-[#4F31D0]"
                    : "text-[#17172B] hover:bg-[#F5F4FB]"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onSelect(todayKey)}
        className="mt-3 min-h-11 w-full rounded-xl bg-[#EFEAFF] text-sm font-bold text-[#4F31D0] transition hover:bg-[#E4DEFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
      >
        Today
      </button>
    </BottomSheet>
  );
}
