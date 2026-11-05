"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  House,
  MapPin,
  Pencil,
  Plus,
  Save,
  Square,
  X,
  Zap,
} from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { getSchedulePeriod, getZonedDateKey, getZonedDateParts, WORKTRACK_SCHEDULE, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
import { SIGNED_IN_EMPLOYEE_ID } from "@/lib/worklog/seed";
import { TASK_STATUS_LABELS, WORK_LOCATION_LABELS, WORKLOG_RULES } from "@/lib/worklog/config";
import {
  addWorkEntry,
  createTask,
  editWorkEntry,
  endBreak,
  getDatabaseSnapshot,
  getServerSnapshot,
  startBreak,
  subscribeToDatabase,
  type EntryInput,
} from "@/lib/worklog/repository";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { dateKeyOf, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getDaySummary, getOpenTasks, getTaskById } from "@/lib/worklog/selectors";
import type { BreakEntry, TaskStatus, WorkEntry, WorkLocation } from "@/lib/worklog/types";

const NEW_TASK = "__new_task__";
const SCHEDULED_MINUTES = (() => {
  const [startHour, startMinute] = WORKTRACK_SCHEDULE.startTime.split(":").map(Number);
  const [endHour, endMinute] = WORKTRACK_SCHEDULE.endTime.split(":").map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
})();
const INPUT_CLASS = "mt-1 min-h-11 w-full rounded-xl border border-[#E7E6F0] bg-white px-3 py-2.5 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";
const STATUS_OPTIONS: TaskStatus[] = ["ongoing", "completed", "blocked", "dropped"];
const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: TASK_STATUS_LABELS.not_started,
  ongoing: TASK_STATUS_LABELS.ongoing,
  blocked: TASK_STATUS_LABELS.blocked,
  completed: "Done",
  dropped: TASK_STATUS_LABELS.dropped,
};
const LOCATION_ICONS = {
  office: Building2,
  home: House,
  other: MapPin,
} satisfies Record<WorkLocation, typeof Building2>;

const subscribeNoop = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

interface WorkSlot {
  key: string;
  start: string;
  end: string;
  label: string;
  available: boolean;
  current: boolean;
}

function dateParts(dateKey: string): [number, number, number] {
  return dateKey.split("-").map(Number) as [number, number, number];
}

function toLagosIso(dateKey: string, time: string): string {
  const [year, month, day] = dateParts(dateKey);
  const [hour, minute] = time.split(":").map(Number);
  return zonedDateTimeToDate(year, month, day, hour, minute).toISOString();
}

function dateKeyAfter(dateKey: string, days: number): string {
  const [year, month, day] = dateParts(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatClock(dateKey: string, minutes: number): string {
  const [year, month, day] = dateParts(dateKey);
  const date = zonedDateTimeToDate(year, month, day, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WORKTRACK_SCHEDULE.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function makeWorkSlots(dateKey: string, entries: WorkEntry[], breaks: BreakEntry[], now: Date): WorkSlot[] {
  const [year, month, day] = dateParts(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const dayNumber = weekday === 0 ? 7 : weekday;
  if (!WORKTRACK_SCHEDULE.workingDays.includes(dayNumber as (typeof WORKTRACK_SCHEDULE.workingDays)[number])) return [];

  const [startHour, startMinute] = WORKTRACK_SCHEDULE.startTime.split(":").map(Number);
  const [endHour, endMinute] = WORKTRACK_SCHEDULE.endTime.split(":").map(Number);
  const startOfDay = startHour * 60 + startMinute;
  const endOfDay = endHour * 60 + endMinute;
  const interval = WORKTRACK_SCHEDULE.reportingIntervalMinutes;
  const today = getZonedDateKey(now) === dateKey;
  const nowParts = getZonedDateParts(now);
  const currentMinute = nowParts.hour * 60 + nowParts.minute;
  const dayEntries = entries.filter((entry) => dateKeyOf(entry.startAt) === dateKey);
  const dayBreaks = breaks.filter((brk) => dateKeyOf(brk.startAt) === dateKey);
  const nowMs = now.getTime();

  const slots: WorkSlot[] = [];
  for (let start = startOfDay; start + interval <= endOfDay; start += interval) {
    const end = start + interval;
    const startAt = zonedDateTimeToDate(year, month, day, Math.floor(start / 60), start % 60).getTime();
    const endAt = zonedDateTimeToDate(year, month, day, Math.floor(end / 60), end % 60).getTime();
    const occupiedByEntry = dayEntries.some((entry) =>
      startAt < new Date(entry.endAt).getTime() && new Date(entry.startAt).getTime() < endAt
    );
    const occupiedByBreak = dayBreaks.some((brk) => {
      const breakEnd = brk.endAt ? new Date(brk.endAt).getTime() : nowMs;
      const breakStart = new Date(brk.startAt).getTime();
      return breakEnd > breakStart && startAt < breakEnd && breakStart < endAt;
    });
    slots.push({
      key: `${start}-${end}`,
      start: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
      end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      label: `${formatClock(dateKey, start)} – ${formatClock(dateKey, end)}`,
      available: !occupiedByEntry && !occupiedByBreak,
      current: today && currentMinute >= start && currentMinute < end,
    });
  }
  return slots;
}

function getTaskStatusCounts(dbTasks: ReturnType<typeof getOpenTasks>, entries: WorkEntry[]) {
  const taskIds = new Set(entries.map((entry) => entry.taskId));
  const tasks = dbTasks.filter((task) => taskIds.has(task.id));
  return {
    completed: tasks.filter((task) => task.currentStatus === "completed").length,
    ongoing: tasks.filter((task) => task.currentStatus === "ongoing" || task.currentStatus === "not_started").length,
    blocked: tasks.filter((task) => task.currentStatus === "blocked").length,
    dropped: tasks.filter((task) => task.currentStatus === "dropped").length,
  };
}

export function MyWorkLog() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted);
  const [now, setNow] = useState<Date>(() => new Date());
  const [taskSearch, setTaskSearch] = useState("");
  const [taskMode, setTaskMode] = useState<"continue" | "new">(() =>
    getOpenTasks(getServerSnapshot(), SIGNED_IN_EMPLOYEE_ID).length ? "continue" : "new"
  );
  const initialOpenTasks = getOpenTasks(getServerSnapshot(), SIGNED_IN_EMPLOYEE_ID);
  const [taskChoice, setTaskChoice] = useState(initialOpenTasks[0]?.id ?? "");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState<WorkLocation>("office");
  const [evidenceLink, setEvidenceLink] = useState("");
  const [showEvidenceLink, setShowEvidenceLink] = useState(false);
  const [isReportedOvertime, setIsReportedOvertime] = useState(false);
  const [showTimeAdjustment, setShowTimeAdjustment] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDateKey, setEditingDateKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [statusChoice, setStatusChoice] = useState<TaskStatus>("ongoing");
  const [statusReason, setStatusReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsTab, setRecordsTab] = useState<"log" | "summary">("log");
  const [recordsDate, setRecordsDate] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const submissionLock = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const todayKey = getZonedDateKey(now);
  const recordsDateKey = recordsDate || todayKey;
  const summary = useMemo(
    () => getDaySummary(db, SIGNED_IN_EMPLOYEE_ID, todayKey, now),
    [db, todayKey, now]
  );
  const recordsSummary = useMemo(
    () => getDaySummary(db, SIGNED_IN_EMPLOYEE_ID, recordsDateKey, now),
    [db, recordsDateKey, now]
  );
  const openTasks = getOpenTasks(db, SIGNED_IN_EMPLOYEE_ID);
  const activeBreak = db.breaks.find((brk) => brk.employeeId === SIGNED_IN_EMPLOYEE_ID && brk.endAt === null) ?? null;
  const selectedTask = taskChoice && taskChoice !== NEW_TASK ? getTaskById(db, taskChoice) : undefined;
  const slots = useMemo(
    () => makeWorkSlots(todayKey, db.entries.filter((entry) => entry.employeeId === SIGNED_IN_EMPLOYEE_ID), db.breaks.filter((brk) => brk.employeeId === SIGNED_IN_EMPLOYEE_ID), now),
    [db.entries, db.breaks, todayKey, now]
  );
  const matchingTasks = openTasks.filter((task) => task.title.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()));
  const taskOptions = [
    ...matchingTasks.map((task) => ({
      value: task.id,
      label: task.title,
      description: TASK_STATUS_LABELS[task.currentStatus],
    })),
    ...(selectedTask && !openTasks.some((task) => task.id === selectedTask.id)
      ? [{ value: selectedTask.id, label: selectedTask.title, description: TASK_STATUS_LABELS[selectedTask.currentStatus], disabled: false }]
      : []),
    { value: NEW_TASK, label: "Start a new task", description: "Create a task and log work on it" },
  ];
  const effectiveDateKey = editingDateKey ?? todayKey;
  const workdayPeriod = getSchedulePeriod(now);
  const workdayStatus = workdayPeriod === "normal_hours"
    ? "Workday Active"
    : workdayPeriod === "non_working_day"
      ? "Non-working day"
      : workdayPeriod === "before_shift"
        ? `Starts at ${WORKTRACK_SCHEDULE.startTime}`
        : "Outside scheduled hours";
  const isHistoricalEdit = Boolean(editingDateKey && editingDateKey !== todayKey);
  const effectiveTaskMode = openTasks.length === 0 && !editingId ? "new" : taskMode;

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!recordsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [recordsOpen]);

  if (!mounted) {
    return <div className="grid min-h-dvh place-items-center text-sm text-[#777A91]">Loading your work log…</div>;
  }

  function resetForm() {
    const availableTasks = getOpenTasks(getDatabaseSnapshot(), SIGNED_IN_EMPLOYEE_ID);
    setTaskMode(availableTasks.length ? "continue" : "new");
    setTaskChoice(availableTasks[0]?.id ?? "");
    setNewTaskTitle("");
    setTaskSearch("");
    setDescription("");
    setEvidenceLink("");
    setShowEvidenceLink(false);
    setIsReportedOvertime(false);
    setShowTimeAdjustment(false);
    setEditingId(null);
    setEditingDateKey(null);
    setSelectedSlot("");
    setStatusChoice("ongoing");
    setStatusReason("");
    setLocation("office");
    setError(null);
  }

  function beginEdit(entry: WorkEntry) {
    const dayKey = dateKeyOf(entry.startAt);
    setEditingId(entry.id);
    setEditingDateKey(dayKey);
    setTaskMode("continue");
    setTaskChoice(entry.taskId);
    setDescription(entry.description);
    setStartTime(formatTime(entry.startAt));
    setEndTime(formatTime(entry.endAt));
    setLocation(entry.workLocation);
    setEvidenceLink(entry.evidenceLink ?? "");
    setShowEvidenceLink(Boolean(entry.evidenceLink));
    setIsReportedOvertime(entry.isReportedOvertime);
    setShowTimeAdjustment(true);
    setSelectedSlot("");
    setStatusChoice(entry.statusAtEntry);
    setError(null);
    setRecordsOpen(false);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function selectTaskMode(mode: "continue" | "new") {
    setTaskMode(mode);
    setTaskChoice(mode === "continue" ? openTasks[0]?.id ?? "" : NEW_TASK);
    const task = mode === "continue" ? openTasks[0] : undefined;
    setStatusChoice(task && task.currentStatus !== "not_started" ? task.currentStatus : "ongoing");
    setStatusReason("");
    setError(null);
  }

  function selectSlot(slot: WorkSlot) {
    if (!slot.available || activeBreak) return;
    setSelectedSlot(slot.key);
    setStartTime(slot.start);
    setEndTime(slot.end);
    setShowTimeAdjustment(false);
    setIsReportedOvertime(false);
    setError(null);
  }

  function submitEntry() {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    try {
      submitEntryOnce();
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  function submitEntryOnce() {
    setError(null);
    if (activeBreak) {
      setError("End your break before saving a work entry.");
      return;
    }
    if (!selectedSlot && !showTimeAdjustment && !editingId) {
      setError("Select an available time slot or adjust the time manually.");
      return;
    }
    if (!startTime || !endTime || endTime <= startTime) {
      setError("Choose a valid time period. The end must be after the start.");
      return;
    }
    if (effectiveTaskMode === "continue" && (!taskChoice || taskChoice === NEW_TASK)) {
      setError("Choose an existing task or start a new one.");
      return;
    }

    let taskId = taskChoice;
    if (effectiveTaskMode === "new") {
      const created = createTask({ employeeId: SIGNED_IN_EMPLOYEE_ID, title: newTaskTitle });
      if (!created.ok) {
        setError(created.message);
        return;
      }
      taskId = created.taskId;
      setTaskChoice(taskId);
      setTaskMode("continue");
    }

    const input: EntryInput = {
      employeeId: SIGNED_IN_EMPLOYEE_ID,
      taskId,
      description,
      startAt: toLagosIso(effectiveDateKey, startTime),
      endAt: toLagosIso(effectiveDateKey, endTime),
      workLocation: location,
      evidenceLink: evidenceLink || undefined,
      isReportedOvertime,
      statusAfterEntry: editingId ? undefined : statusChoice,
      statusReason: statusReason || undefined,
    };
    const result = editingId ? editWorkEntry(editingId, input) : addWorkEntry(input);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setNotice(editingId ? "Work entry updated." : "Work entry saved.");
    resetForm();
  }

  function handleStartBreak() {
    const result = startBreak(SIGNED_IN_EMPLOYEE_ID);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice("Break started.");
    }
  }

  function handleEndBreak() {
    if (!activeBreak) return;
    const result = endBreak(activeBreak.id);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice("Break ended.");
    }
  }

  async function exportRecords() {
    setExportError(null);
    if (!exportFrom || !exportTo || exportFrom > exportTo) {
      setExportError("Choose a valid date range.");
      return;
    }
    setExporting(true);
    try {
      await downloadWorkLogWorkbook(
        db,
        { fromKey: exportFrom, toKey: exportTo, employeeId: SIGNED_IN_EMPLOYEE_ID },
        `worktrack-my-records_${exportFrom}_to_${exportTo}.xlsx`
      );
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "The workbook could not be created.");
    } finally {
      setExporting(false);
    }
  }

  const workMinutes = Math.min(summary.normalMinutes, SCHEDULED_MINUTES);
  const progressBreak = Math.min(summary.breakMinutes, Math.max(0, SCHEDULED_MINUTES - workMinutes));
  const remainingMinutes = Math.max(0, SCHEDULED_MINUTES - workMinutes - progressBreak);
  const progressWorkWidth = (workMinutes / SCHEDULED_MINUTES) * 100;
  const progressBreakWidth = (progressBreak / SCHEDULED_MINUTES) * 100;
  const progressRemainingWidth = (remainingMinutes / SCHEDULED_MINUTES) * 100;
  const employee = db.employees.find((item) => item.id === SIGNED_IN_EMPLOYEE_ID);
  const initials = employee?.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() ?? "WT";
  const nextAvailableSlot = slots.find((slot) => slot.current && slot.available)
    ?? slots.find((slot) => slot.available);
  const dateEntries = recordsSummary.entries;
  const taskStatusCounts = getTaskStatusCounts(db.tasks, dateEntries);

  const timeline = [
    ...dateEntries.map((entry) => ({ kind: "entry" as const, at: entry.startAt, entry })),
    ...recordsSummary.breaks.map((brk) => ({ kind: "break" as const, at: brk.startAt, brk })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[linear-gradient(145deg,#fff_0%,#F7F7FC_60%,#F5F1FF_100%)] px-3 py-3 sm:px-6 sm:py-4">
      <div className={`mx-auto flex h-full min-h-0 w-full flex-col ${recordsOpen ? "max-w-[1000px]" : "max-w-[640px]"}`}>
        <header className={`mb-3 flex min-h-12 shrink-0 items-center justify-between rounded-2xl border border-[#E7E6F0] bg-white/90 px-3 shadow-sm sm:mb-4 sm:min-h-14 sm:px-5 ${recordsOpen ? "" : "mx-auto w-full max-w-[640px]"}`}>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#6C45F5] text-white">
              <Zap size={17} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-[#17172F]">WorkTrack</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setRecordsOpen(true);
                setRecordsTab("log");
                setRecordsDate(todayKey);
                setExportFrom(todayKey);
                setExportTo(todayKey);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#E7E6F0] px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <CalendarDays size={16} aria-hidden="true" />
              My Records
            </button>
            <span aria-label={employee?.name ?? "Employee"} className="grid h-9 w-9 place-items-center rounded-full bg-[#F0EDFF] text-xs font-bold text-[#5A3ED0]">
              {initials}
            </span>
          </div>
        </header>

        <section ref={formRef} id="work-form" className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border border-[#E7E6F0] bg-white p-3 shadow-[0_18px_56px_rgba(47,39,92,0.08)] sm:p-5 lg:p-5 ${recordsOpen ? "mr-auto max-w-[640px]" : "mx-auto max-w-[640px]"}`}>
          <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-[#17172F] sm:text-[26px]">
                  {editingId ? "Edit work entry" : "Log Your Work"}
                </h1>
                {editingId ? <button type="button" onClick={resetForm} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]">Cancel</button> : null}
              </div>
              <p className="mt-0.5 text-xs text-[#777A91] sm:text-sm">
                {isHistoricalEdit ? `Editing a record from ${formatDateLabel(effectiveDateKey)}.` : "Record what you worked on today."}
              </p>
            </div>
            <div className="rounded-xl bg-[#F7F7FC] px-2 py-1.5 text-right sm:px-3 sm:py-2">
              <p className="text-xs font-semibold text-[#383650] sm:text-sm">{new Intl.DateTimeFormat("en-US", { timeZone: WORKTRACK_SCHEDULE.timezone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(now)}</p>
              <p className={`mt-0.5 text-xs font-semibold ${workdayPeriod === "normal_hours" ? "text-[#16A779]" : "text-[#777A91]"}`}>
                {workdayStatus}
              </p>
            </div>
          </div>

          <section aria-labelledby="progress-heading" className="mb-2 shrink-0 rounded-2xl border border-[#EEEAF8] bg-[#FCFBFF] p-2 sm:mb-3 sm:p-2">
            <div className="mb-1.5 flex flex-wrap items-end justify-between gap-1">
              <div>
                <h2 id="progress-heading" className="text-sm font-semibold text-[#17172F]">Today’s progress</h2>
                <p className="mt-0.5 text-xs text-[#777A91] sm:text-sm">
                  <span className="font-semibold text-[#4F36C8]">{formatMinutes(summary.workMinutes)}</span> total · {formatMinutes(summary.normalMinutes)} of {formatMinutes(SCHEDULED_MINUTES)}
                </p>
              </div>
              <p className="text-xs text-[#777A91]">{formatMinutes(remainingMinutes)} remaining</p>
            </div>
            <div
              role="progressbar"
              aria-label="Today's workday progress"
              aria-valuemin={0}
              aria-valuemax={SCHEDULED_MINUTES}
              aria-valuenow={Math.min(SCHEDULED_MINUTES, summary.normalMinutes + summary.breakMinutes)}
              className="flex h-3 overflow-hidden rounded-full bg-[#ECEBF2]"
            >
              <span className="bg-[#6C45F5] transition-[width]" style={{ width: `${progressWorkWidth}%` }} />
              <span className="bg-[#F59E0B] transition-[width]" style={{ width: `${progressBreakWidth}%` }} />
              <span className="bg-[#ECEBF2]" style={{ width: `${progressRemainingWidth}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] sm:text-xs text-[#777A91]">
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#6C45F5]" />Work {formatMinutes(summary.normalMinutes)}</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#F59E0B]" />Break {formatMinutes(summary.breakMinutes)}</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#D9D9E2]" />Remaining {formatMinutes(remainingMinutes)}</span>
            </div>
          </section>

          <div className="space-y-2 sm:space-y-1">
            <section aria-labelledby="time-slots-heading" className={`relative ${activeBreak ? "hidden" : ""}`}>
              <div className="relative mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 id="time-slots-heading" className="text-[15px] font-semibold text-[#17172F]">Choose a time</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTimeAdjustment((value) => !value)}
                  aria-expanded={showTimeAdjustment}
                  className="min-h-10 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                >
                  {showTimeAdjustment ? "Hide time adjustment" : "Adjust time / overtime"}
                </button>
              </div>
              {slots.length ? (
                <div className="flex max-w-full gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
                  {slots.map((slot) => {
                    const selected = selectedSlot === slot.key;
                    const isNext = !selected && nextAvailableSlot?.key === slot.key;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        disabled={!slot.available || Boolean(activeBreak)}
                        onClick={() => selectSlot(slot)}
                        aria-pressed={selected}
                        title={!slot.available ? "This time is already logged or covered by a break" : undefined}
                        className={`relative min-h-11 min-w-[138px] shrink-0 rounded-xl border px-2 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-0 ${
                          selected
                            ? "border-[#6C45F5] bg-[#6C45F5] text-white"
                            : isNext
                              ? "border-[#B8A8F8] bg-[#F5F1FF] text-[#4E35C6]"
                            : slot.available
                              ? "border-[#E7E6F0] bg-white text-[#39364F] hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
                              : "border-[#E7E6F0] bg-[#F7F7FA] text-[#9999A8] line-through"
                        }`}
                      >
                        {selected ? <Check size={13} aria-hidden="true" className="absolute right-2 top-2" /> : null}
                        <span className="block leading-5">{slot.label}</span>
                        {slot.current && slot.available ? <span className="sr-only">Current hour</span> : isNext ? <span className="sr-only">Next available</span> : null}
                        {!slot.available ? <span className="block text-[10px] font-medium no-underline">Already recorded</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-[#F7F7FC] px-3 py-3 text-sm text-[#777A91]">
                  No standard work slots today. Use the time adjustment to record weekend overtime.
                </p>
              )}
              {showTimeAdjustment ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 grid gap-2 rounded-xl border border-[#EEEAF8] bg-white p-3 shadow-xl sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className={`${activeBreak ? "hidden " : ""}block text-xs font-semibold text-[#53506B]`}>
                    Start time
                    <input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setSelectedSlot(""); }} className={INPUT_CLASS} />
                  </label>
                  <label className="block text-xs font-semibold text-[#53506B]">
                    End time
                    <input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setSelectedSlot(""); }} className={INPUT_CLASS} />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-[#53506B]">
                    <input
                      type="checkbox"
                      checked={isReportedOvertime}
                      onChange={(event) => setIsReportedOvertime(event.target.checked)}
                      className="h-4 w-4 accent-[#6C45F5]"
                    />
                    Report as overtime
                  </label>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="task-heading" className={activeBreak ? "hidden" : ""}>
              <div className="mb-2 flex items-center justify-between gap-2 sm:block">
                <h2 id="task-heading" className="text-[15px] font-semibold text-[#17172F] sm:mb-2">Task</h2>
                <div className="inline-flex min-w-0 rounded-xl bg-[#F4F3F8] p-0.5 sm:mb-3 sm:w-full sm:p-1">
                <button type="button" aria-label="Continue existing task" onClick={() => selectTaskMode("continue")} className={`min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold transition sm:min-h-10 sm:px-3 sm:text-sm ${effectiveTaskMode === "continue" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#777A91] hover:text-[#39364F]"}`}>
                  <span className="sm:hidden">Continue</span><span className="hidden sm:inline">Continue existing task</span>
                </button>
                <button type="button" aria-label="Start a new task" onClick={() => selectTaskMode("new")} className={`min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold transition sm:min-h-10 sm:px-3 sm:text-sm ${effectiveTaskMode === "new" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#777A91] hover:text-[#39364F]"}`}>
                  <span className="sm:hidden">New task</span><span className="hidden sm:inline">Start a new task</span>
                </button>
                </div>
              </div>
              {effectiveTaskMode === "continue" ? (
                <div className="grid grid-cols-2 items-end gap-2">
                  <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} aria-label="Search ongoing or blocked tasks" placeholder="Search tasks..." className={INPUT_CLASS} disabled={Boolean(editingId)} />
                  <WorkTrackSelect
                    label="Choose a task"
                    value={taskChoice}
                    placeholder="Select a task"
                    disabled={Boolean(editingId)}
                    onChange={(value) => {
                      if (value === NEW_TASK) selectTaskMode("new");
                      else {
                        setTaskChoice(value);
                        const task = getTaskById(db, value);
                        setStatusChoice(task && task.currentStatus !== "not_started" ? task.currentStatus : "ongoing");
                      }
                    }}
                    options={taskOptions}
                  />
                </div>
              ) : (
                <label className={`${activeBreak ? "hidden " : ""}block text-xs font-semibold text-[#53506B]`}>
                  Task title
                  <input value={newTaskTitle} maxLength={WORKLOG_RULES.taskTitleMaxLength} onChange={(event) => setNewTaskTitle(event.target.value)} placeholder="Give this task a clear name" className={INPUT_CLASS} />
                </label>
              )}
            </section>

            <label className="block text-xs font-semibold text-[#53506B]">
              What did you do during this time?
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={WORKLOG_RULES.descriptionMaxLength}
                placeholder="Briefly describe what you worked on during this period..."
                className={`${INPUT_CLASS} min-h-20 resize-y`}
              />
            </label>

            <div className={`${activeBreak ? "hidden " : ""}grid grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start gap-2 sm:gap-4`}>
              <fieldset className="min-w-0">
                <legend className="mb-1.5 text-xs font-semibold text-[#53506B]">Where did you work?</legend>
                <div className="grid grid-cols-3 gap-1 sm:gap-2">
                  {(["office", "home", "other"] as const).map((item) => {
                    const Icon = LOCATION_ICONS[item];
                    const selected = location === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setLocation(item)}
                        aria-label={WORK_LOCATION_LABELS[item]}
                        aria-pressed={selected}
                        className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-0.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] sm:flex-row sm:gap-2 sm:px-2 sm:text-sm ${
                          selected ? "border-[#6C45F5] bg-[#F5F1FF] text-[#5A3ED0]" : "border-[#E7E6F0] bg-white text-[#53506B] hover:bg-[#FCFBFF]"
                        }`}
                      >
                        <Icon size={15} aria-hidden="true" />
                        {WORK_LOCATION_LABELS[item]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="relative min-w-0 space-y-1.5">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-[#53506B]">Status</p>
                  <WorkTrackSelect
                    label="Task status"
                    value={statusChoice}
                    disabled={Boolean(editingId)}
                    onChange={setStatusChoice}
                    options={STATUS_OPTIONS.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
                  />
                </div>
                {statusChoice === "blocked" || statusChoice === "dropped" ? (
                  <label className="block text-[10px] font-semibold text-[#53506B] sm:text-xs">
                    {statusChoice === "blocked" ? "What is blocking the task?" : "Why is the task being dropped?"}
                    <input value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={WORKLOG_RULES.reasonMaxLength} placeholder="Add a short reason" className="mt-1 h-8 w-full rounded-lg border border-[#E7E6F0] bg-white px-2 text-xs text-[#17172F] outline-none focus:border-[#6C45F5]" disabled={Boolean(editingId)} />
                  </label>
                ) : null}
                {(!(statusChoice === "blocked" || statusChoice === "dropped") || editingId) ? (
                  <button type="button" onClick={() => setShowEvidenceLink((value) => !value)} aria-expanded={showEvidenceLink} className="min-h-8 text-left text-[10px] font-semibold text-[#6C45F5] hover:underline sm:text-xs">
                    {showEvidenceLink ? "Hide evidence link" : "Add evidence link (optional)"}
                  </button>
                ) : null}
                {showEvidenceLink ? (
                  <label className="absolute bottom-full left-0 right-0 z-30 mb-1 block rounded-xl border border-[#E7E6F0] bg-white p-2 text-[10px] font-medium text-[#777A91] shadow-lg sm:text-xs">
                    Evidence link
                    <input value={evidenceLink} onChange={(event) => setEvidenceLink(event.target.value)} placeholder="https://" className={INPUT_CLASS} />
                  </label>
                ) : null}
              </div>
            </div>

            {isHistoricalEdit ? (
              <p className={`rounded-xl bg-[#F7F7FC] px-3 py-2 text-xs text-[#777A91] ${activeBreak ? "hidden" : ""}`}>
                This edit changes only the selected historical entry. It will not change today’s logging date or the task’s current status.
              </p>
            ) : null}
            {error ? <p role="alert" className="rounded-xl bg-[#FDEEEE] px-3 py-2.5 text-sm text-[#B43A3A]">{error}</p> : null}

            {activeBreak ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F6D99A] bg-[#FFF6E5] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#9A6200]">
                  <Coffee size={17} aria-hidden="true" />
                  On break since {formatTime(activeBreak.startAt)}
                </div>
                <button type="button" onClick={handleEndBreak} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F59E0B] px-4 text-sm font-semibold text-white transition hover:bg-[#DB8A08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-2">
                  <Square size={14} aria-hidden="true" /> End Break
                </button>
              </div>
            ) : null}

            {!activeBreak ? <div className="grid grid-cols-[0.9fr_1.1fr] gap-2 border-t border-[#EEEAF2] pt-2 sm:grid-cols-[0.8fr_1.7fr] sm:gap-3 sm:pt-3">
              <button
                type="button"
                onClick={handleStartBreak}
                disabled={Boolean(activeBreak) || Boolean(editingId)}
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-[#F3C56B] bg-[#FFF6E5] px-2 text-xs font-semibold text-[#9A6200] transition hover:bg-[#FFEFCE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-12 sm:gap-2 sm:px-5 sm:text-sm sm:min-w-36"
              >
                <Coffee size={16} aria-hidden="true" /> Take Break
              </button>
              <button
                type="button"
                onClick={submitEntry}
                disabled={Boolean(activeBreak) || submitting}
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#6C45F5] px-2 text-xs font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-12 sm:gap-2 sm:px-6 sm:text-sm sm:min-w-52"
              >
                {editingId ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {editingId ? "Save Changes" : "Save Work Entry"}
              </button>
            </div> : null}
          </div>
        </section>
      </div>

      {recordsOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#17172F]/35 backdrop-blur-[2px] lg:pointer-events-none lg:bg-transparent lg:backdrop-blur-0" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordsOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="records-title" className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:m-4 sm:h-[calc(100%-2rem)] sm:max-w-[500px] sm:rounded-[24px] lg:pointer-events-auto lg:fixed lg:left-[calc(50%+156px)] lg:top-[88px] lg:bottom-auto lg:m-0 lg:h-[min(680px,calc(100dvh-120px))] lg:w-[340px] lg:max-w-none lg:rounded-[24px]">
            <header className="flex items-center justify-between border-b border-[#EEEAF2] px-5 py-4 sm:px-6">
              <div>
                <h2 id="records-title" className="text-lg font-bold text-[#17172F]">My Records</h2>
                <p className="mt-0.5 text-xs text-[#777A91]">Your work history and daily summary</p>
              </div>
              <button type="button" autoFocus aria-label="Close My Records" onClick={() => setRecordsOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl text-[#777A91] hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]">
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="grid grid-cols-2 gap-1 border-b border-[#EEEAF2] px-5 pt-3 sm:px-6">
              <button type="button" onClick={() => setRecordsTab("log")} aria-current={recordsTab === "log" ? "page" : undefined} className={`min-h-11 border-b-2 text-sm font-semibold ${recordsTab === "log" ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#777A91]"}`}>My Log</button>
              <button type="button" onClick={() => setRecordsTab("summary")} aria-current={recordsTab === "summary" ? "page" : undefined} className={`min-h-11 border-b-2 text-sm font-semibold ${recordsTab === "summary" ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#777A91]"}`}>Summary</button>
            </div>

            {recordsTab === "log" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-[#F0EEF5] px-5 py-3 sm:px-6">
                  <button type="button" aria-label="Previous day" onClick={() => setRecordsDate(dateKeyAfter(recordsDateKey, -1))} className="grid h-11 w-11 place-items-center rounded-xl border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC]">
                    <ChevronLeft size={17} aria-hidden="true" />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                    <input aria-label="Select records date" type="date" max={todayKey} value={recordsDateKey} onChange={(event) => setRecordsDate(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-[#E7E6F0] px-2 text-sm font-semibold text-[#39364F]" />
                    <button type="button" onClick={() => setRecordsDate(todayKey)} className="min-h-10 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]">Today</button>
                  </div>
                  <button type="button" aria-label="Next day" disabled={recordsDateKey >= todayKey} onClick={() => setRecordsDate(dateKeyAfter(recordsDateKey, 1))} className="grid h-11 w-11 place-items-center rounded-xl border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC] disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-semibold text-[#39364F]">{formatDateLabel(recordsDateKey)}{recordsDateKey === todayKey ? " · Today" : " · Historical"}</p>
                    <p className="text-xs text-[#777A91]">{formatMinutes(recordsSummary.workMinutes)} work</p>
                  </div>
                  {timeline.length ? (
                    <ol className="space-y-3">
                      {timeline.map((item) => item.kind === "entry" ? (
                        <li key={item.entry.id} className="rounded-xl border border-[#E7E6F0] p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#777A91]">{formatTime(item.entry.startAt)} – {formatTime(item.entry.endAt)}</p>
                              <p className="mt-1 break-words text-sm font-semibold text-[#17172F]">{getTaskById(db, item.entry.taskId)?.title ?? "Task"}</p>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[#53506B]">{item.entry.description}</p>
                              <p className="mt-2 text-xs text-[#777A91]">
                                {WORK_LOCATION_LABELS[item.entry.workLocation]} · {STATUS_LABELS[item.entry.statusAtEntry]}
                                {item.entry.overtimeMinutes > 0 ? ` · Overtime ${formatMinutes(item.entry.overtimeMinutes)}` : ""}
                                {item.entry.isReportedOvertime ? " · Reported overtime" : ""}
                              </p>
                            </div>
                            <button type="button" aria-label={`Edit ${getTaskById(db, item.entry.taskId)?.title ?? "work entry"}`} onClick={() => beginEdit(item.entry)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F5F1FF] hover:text-[#5A3ED0]">
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      ) : (
                        <li key={item.brk.id} className="flex items-center justify-between rounded-xl border border-[#F6D99A] bg-[#FFF9ED] p-3.5">
                          <div>
                            <p className="text-sm font-semibold text-[#8A5A00]">Break</p>
                            <p className="mt-1 text-xs text-[#9A742C]">{formatTime(item.brk.startAt)} – {item.brk.endAt ? formatTime(item.brk.endAt) : "In progress"}</p>
                          </div>
                          <Coffee size={17} className="text-[#F59E0B]" aria-hidden="true" />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="rounded-xl bg-[#F7F7FC] px-4 py-5 text-center text-sm text-[#777A91]">No work or break records for this day.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                <p className="mb-4 text-sm font-semibold text-[#39364F]">{formatDateLabel(recordsDateKey)}</p>
                <dl className="grid grid-cols-2 gap-2.5">
                  <SummaryStat label="Recorded work" value={formatMinutes(recordsSummary.workMinutes)} />
                  <SummaryStat label="Break time" value={formatMinutes(recordsSummary.breakMinutes)} />
                  <SummaryStat label="Overtime" value={formatMinutes(recordsSummary.overtimeMinutes)} />
                  <SummaryStat label="Office" value={formatMinutes(recordsSummary.officeMinutes)} />
                  <SummaryStat label="Home" value={formatMinutes(recordsSummary.homeMinutes)} />
                  <SummaryStat label="Other" value={formatMinutes(recordsSummary.otherMinutes)} />
                  <SummaryStat label="Work entries" value={String(dateEntries.length)} />
                  <SummaryStat label="Tasks done" value={String(taskStatusCounts.completed)} />
                  <SummaryStat label="Tasks ongoing" value={String(taskStatusCounts.ongoing)} />
                  <SummaryStat label="Tasks blocked" value={String(taskStatusCounts.blocked)} />
                  <SummaryStat label="Tasks dropped" value={String(taskStatusCounts.dropped)} />
                </dl>
                <section className="mt-5">
                  <h3 className="mb-2 text-sm font-semibold text-[#39364F]">Daily timeline</h3>
                  {timeline.length ? (
                    <ol className="space-y-2 border-l border-[#E6E1F7] pl-3">
                      {timeline.map((item) => item.kind === "entry" ? (
                        <li key={`summary-${item.entry.id}`} className="relative rounded-lg bg-[#FCFBFF] p-2.5 before:absolute before:-left-[18px] before:top-3 before:h-2 before:w-2 before:rounded-full before:bg-[#6C45F5]">
                          <p className="text-xs font-semibold text-[#777A91]">{formatTime(item.entry.startAt)}–{formatTime(item.entry.endAt)}</p>
                          <p className="mt-0.5 text-sm font-medium text-[#39364F]">{getTaskById(db, item.entry.taskId)?.title ?? "Task"}</p>
                        </li>
                      ) : (
                        <li key={`summary-${item.brk.id}`} className="relative rounded-lg bg-[#FFF9ED] p-2.5 before:absolute before:-left-[18px] before:top-3 before:h-2 before:w-2 before:rounded-full before:bg-[#F59E0B]">
                          <p className="text-xs font-semibold text-[#9A742C]">{formatTime(item.brk.startAt)}–{item.brk.endAt ? formatTime(item.brk.endAt) : "In progress"}</p>
                          <p className="mt-0.5 text-sm font-medium text-[#8A5A00]">Break</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="rounded-lg bg-[#F7F7FC] p-3 text-sm text-[#777A91]">No timeline records for this day.</p>}
                </section>
                <section className="mt-6 border-t border-[#EEEAF2] pt-4">
                  <h3 className="mb-2 text-sm font-semibold text-[#39364F]">Export your records</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-semibold text-[#53506B]">From<input type="date" max={todayKey} value={exportFrom || todayKey} onChange={(event) => setExportFrom(event.target.value)} className={INPUT_CLASS} /></label>
                    <label className="text-xs font-semibold text-[#53506B]">To<input type="date" max={todayKey} value={exportTo || todayKey} onChange={(event) => setExportTo(event.target.value)} className={INPUT_CLASS} /></label>
                  </div>
                  {exportError ? <p role="alert" className="mt-2 text-xs text-[#B43A3A]">{exportError}</p> : null}
                  <button type="button" onClick={exportRecords} disabled={exporting} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50">
                    <Save size={15} aria-hidden="true" /> {exporting ? "Preparing export…" : "Export to Excel"}
                  </button>
                </section>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {notice ? <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-[#17172F] px-4 py-3 text-sm font-medium text-white shadow-xl">{notice}</div> : null}
    </main>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F7F7FC] p-3">
      <dt className="text-xs text-[#777A91]">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-[#17172F]">{value}</dd>
    </div>
  );
}
