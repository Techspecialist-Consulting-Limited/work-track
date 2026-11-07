"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getSchedulePeriod, getZonedDateKey, WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import { TASK_STATUS_LABELS } from "@/lib/worklog/config";
import {
  addProgressUpdate,
  addWorkEntry,
  createSubtask,
  createTask,
  deleteWorkEntry,
  editProgressUpdate,
  editWorkEntry,
  endBreak,
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  startBreak,
  subscribeToDatabase,
  updateBreak,
  updateSubtask,
  updateSubtaskStatus,
  updateTask,
  updateTaskStatus,
  type EntryInput,
  type MutationResult,
} from "@/lib/worklog/repository";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { dateKeyOf, formatTime } from "@/lib/worklog/time";
import { breakDeadline } from "@/lib/worklog/validation";
import { getDaySummary, getOpenTasks, getSubtasksForTask, getTaskById } from "@/lib/worklog/selectors";
import type { TaskStatus, WorkEntry, WorkLocation } from "@/lib/worklog/types";
import {
  getTaskStatusCounts,
  makeWorkSlots,
  NEW_TASK,
  SCHEDULED_MINUTES,
  slotEndInstant,
  toLagosIso,
} from "./shared";

const subscribeNoop = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export function useWorkLogController() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const meId = getSessionEmployeeId() ?? db.employees[0]?.id ?? "";
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted);
  const [now, setNow] = useState<Date>(() => new Date());
  const [taskSearch, setTaskSearch] = useState("");
  const [taskMode, setTaskMode] = useState<"continue" | "new">(() =>
    getOpenTasks(getServerSnapshot(), meId).length ? "continue" : "new"
  );
  const initialOpenTasks = getOpenTasks(getServerSnapshot(), meId);
  const [taskChoice, setTaskChoice] = useState(initialOpenTasks[0]?.id ?? "");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [newTaskNote, setNewTaskNote] = useState("");
  const [newTaskSubtasks, setNewTaskSubtasks] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState<WorkLocation>("office");
  const [evidenceLink, setEvidenceLink] = useState("");
  const [showEvidenceLink, setShowEvidenceLink] = useState(false);
  const [isReportedOvertime, setIsReportedOvertime] = useState(false);
  const [showTimeAdjustment, setShowTimeAdjustment] = useState(false);
  const [slotLocked, setSlotLocked] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDateKey, setEditingDateKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [subtaskChoice, setSubtaskChoice] = useState("");
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
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [taskDetailsTaskId, setTaskDetailsTaskId] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const submissionLock = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const todayKey = getZonedDateKey(now);
  const recordsDateKey = recordsDate || todayKey;
  const summary = useMemo(
    () => getDaySummary(db, meId, todayKey, now),
    [db, meId, todayKey, now]
  );
  const recordsSummary = useMemo(
    () => getDaySummary(db, meId, recordsDateKey, now),
    [db, meId, recordsDateKey, now]
  );
  const openTasks = getOpenTasks(db, meId);
  const employeeTasks = useMemo(
    () => db.tasks.filter((task) => task.employeeId === meId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [db.tasks, meId]
  );
  const activeBreak = db.breaks.find((brk) => brk.employeeId === meId && brk.endAt === null) ?? null;
  const selectedTask = taskChoice && taskChoice !== NEW_TASK ? getTaskById(db, taskChoice) : undefined;
  const selectedTaskSubtasks = selectedTask ? getSubtasksForTask(db, selectedTask.id) : [];
  const detailTask = taskDetailsTaskId ? getTaskById(db, taskDetailsTaskId) : undefined;
  const slots = useMemo(
    () => makeWorkSlots(todayKey, db.entries.filter((entry) => entry.employeeId === meId), db.breaks.filter((brk) => brk.employeeId === meId), now),
    [db.entries, db.breaks, meId, todayKey, now]
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
    ? "Workday active"
    : workdayPeriod === "non_working_day"
      ? "Weekend"
      : workdayPeriod === "before_shift"
        ? `Starts at ${WORKTRACK_SCHEDULE.startTime}`
        : "Outside scheduled hours";
  const isHistoricalEdit = Boolean(editingDateKey && editingDateKey !== todayKey);
  const effectiveTaskMode = openTasks.length === 0 && !editingId ? "new" : taskMode;
  const categories = db.categories;

  const nowMs = now.getTime();
  const nextAvailableSlot =
    slots.find((slot) => slot.current && slot.available) ??
    slots.find((slot) => slot.available && slotEndInstant(todayKey, slot) > nowMs) ??
    slots.find((slot) => slot.available) ??
    null;

  useEffect(() => {
    if (editingId || activeBreak || selectedSlot || showTimeAdjustment || slotLocked || !nextAvailableSlot) return;
    const slot = nextAvailableSlot;
    const id = window.setTimeout(() => {
      setSelectedSlot(slot.key);
      setStartTime(slot.start);
      setEndTime(slot.end);
      setIsReportedOvertime(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, [nextAvailableSlot, editingId, activeBreak, selectedSlot, showTimeAdjustment, slotLocked]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!recordsOpen && !taskDetailsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (taskDetailsOpen) closeTaskDetails();
      else setRecordsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [recordsOpen, taskDetailsOpen]);

  function lockAutoSlot() {
    setSlotLocked(true);
  }

  function resetForm() {
    const availableTasks = getOpenTasks(getDatabaseSnapshot(), meId);
    setTaskMode(availableTasks.length ? "continue" : "new");
    setTaskChoice(availableTasks[0]?.id ?? "");
    setNewTaskTitle("");
    setNewTaskCategory("");
    setNewTaskNote("");
    setNewTaskSubtasks([]);
    setTaskSearch("");
    setDescription("");
    setEvidenceLink("");
    setShowEvidenceLink(false);
    setIsReportedOvertime(false);
    setShowTimeAdjustment(false);
    setSlotLocked(false);
    setEditingId(null);
    setEditingDateKey(null);
    setSelectedSlot("");
    setSubtaskChoice("");
    setLocation("office");
    setError(null);
  }

  function beginEdit(entry: WorkEntry) {
    const dayKey = dateKeyOf(entry.startAt);
    setEditingId(entry.id);
    setEditingDateKey(dayKey);
    setTaskMode("continue");
    setTaskChoice(entry.taskId);
    setSubtaskChoice(entry.subtaskId ?? "");
    setDescription(entry.description);
    setStartTime(formatTime(entry.startAt));
    setEndTime(formatTime(entry.endAt));
    setLocation(entry.workLocation);
    setEvidenceLink(entry.evidenceLink ?? "");
    setShowEvidenceLink(Boolean(entry.evidenceLink));
    setIsReportedOvertime(entry.isReportedOvertime);
    setShowTimeAdjustment(false);
    setSlotLocked(true);
    setSelectedSlot("");
    setError(null);
    setRecordsOpen(false);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function selectTaskMode(mode: "continue" | "new") {
    setTaskMode(mode);
    setTaskChoice(mode === "continue" ? openTasks[0]?.id ?? "" : NEW_TASK);
    setSubtaskChoice("");
    setError(null);
  }

  function chooseTask(taskId: string) {
    setTaskChoice(taskId);
    setSubtaskChoice("");
  }

  function selectSlot(slot: { key: string; start: string; end: string; available: boolean }) {
    if (!slot.available || activeBreak) return;
    setSelectedSlot(slot.key);
    setStartTime(slot.start);
    setEndTime(slot.end);
    setShowTimeAdjustment(false);
    setIsReportedOvertime(false);
    setError(null);
  }

  function addNewTaskSubtask() {
    setNewTaskSubtasks((current) => [...current, ""]);
  }

  function updateNewTaskSubtask(index: number, value: string) {
    setNewTaskSubtasks((current) => current.map((title, itemIndex) => (itemIndex === index ? value : title)));
  }

  function removeNewTaskSubtask(index: number) {
    setNewTaskSubtasks((current) => current.filter((_, itemIndex) => itemIndex !== index));
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
      const created = createTask({
        employeeId: meId,
        title: newTaskTitle,
        categoryId: newTaskCategory || undefined,
        initialNote: newTaskNote || undefined,
        subtasks: newTaskSubtasks
          .filter((title) => title.trim())
          .map((title) => ({ title })),
      });
      if (!created.ok) {
        setError(created.message);
        return;
      }
      taskId = created.taskId;
      setTaskChoice(taskId);
      setTaskMode("continue");
      setSubtaskChoice("");
    }

    const input: EntryInput = {
      employeeId: meId,
      taskId,
      subtaskId: subtaskChoice || undefined,
      description,
      startAt: toLagosIso(effectiveDateKey, startTime),
      endAt: toLagosIso(effectiveDateKey, endTime),
      workLocation: location,
      evidenceLink: evidenceLink || undefined,
      isReportedOvertime,
    };
    const result = editingId ? editWorkEntry(editingId, input) : addWorkEntry(input);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setNotice(editingId ? "Work entry updated." : "Work entry saved.");
    resetForm();
  }

  function deleteEntry(entryId: string) {
    const result = deleteWorkEntry(entryId);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice("Work entry deleted.");
      setRecordsOpen(false);
    }
  }

  function handleStartBreak() {
    const result = startBreak(meId);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice(result.adjustedEntry ? "Break started. Active work entry ended at now." : "Break started.");
    }
  }

  function handleEndBreak(auto = false) {
    if (!activeBreak) return;
    const result = endBreak(activeBreak.id);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice(auto ? "Break ended automatically (daily allowance or end of workday reached)." : "Break ended.");
    }
  }

  useEffect(() => {
    if (!activeBreak || now.getTime() < breakDeadline(db.breaks, activeBreak).getTime()) return;
    const timer = window.setTimeout(() => handleEndBreak(true), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBreak, now]);

  function openRecords() {
    setRecordsOpen(true);
    setRecordsTab("log");
    setRecordsDate(todayKey);
    setExportFrom(todayKey);
    setExportTo(todayKey);
  }

  function openTaskDetails(taskId?: string) {
    setTaskDetailsTaskId(taskId ?? null);
    setTaskDetailsOpen(true);
  }

  function closeTaskDetails() {
    setTaskDetailsOpen(false);
    setTaskDetailsTaskId(null);
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
        { fromKey: exportFrom, toKey: exportTo, employeeId: meId },
        `worktrack-my-records_${exportFrom}_to_${exportTo}.xlsx`
      );
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "The workbook could not be created.");
    } finally {
      setExporting(false);
    }
  }

  /* Task and subtask actions are returned to dialogs so they can show inline errors. */
  function saveTask(input: {
    taskId: string;
    title: string;
    description?: string;
    categoryId?: string | null;
  }): MutationResult {
    const result = updateTask(input);
    if (result.ok) setNotice("Task details saved.");
    return result;
  }

  function changeTaskStatus(
    taskId: string,
    status: TaskStatus,
    reason?: string,
    note?: string
  ): MutationResult {
    const result = updateTaskStatus(taskId, status, reason, note);
    if (result.ok) setNotice(`Task moved to ${TASK_STATUS_LABELS[status]}.`);
    return result;
  }

  function addSubtask(taskId: string, title: string, description?: string): MutationResult {
    const result = createSubtask({ taskId, title, description });
    if (result.ok) setNotice("Subtask added.");
    return result;
  }

  function saveSubtask(input: {
    subtaskId: string;
    title: string;
    description?: string;
  }): MutationResult {
    const result = updateSubtask(input);
    if (result.ok) setNotice("Subtask saved.");
    return result;
  }

  function changeSubtaskStatus(
    subtaskId: string,
    status: TaskStatus,
    reason?: string
  ): MutationResult {
    const result = updateSubtaskStatus(subtaskId, status, reason);
    if (result.ok) setNotice(`Subtask moved to ${TASK_STATUS_LABELS[status]}.`);
    return result;
  }

  function addProgress(taskId: string, subtaskId: string | null, body: string): MutationResult {
    const result = addProgressUpdate({ taskId, subtaskId, body });
    if (result.ok) setNotice("Progress update added.");
    return result;
  }

  function saveProgress(
    progressUpdateId: string,
    body: string,
    revisionReason?: string
  ): MutationResult {
    const result = editProgressUpdate({ progressUpdateId, body, revisionReason });
    if (result.ok) setNotice("Progress update edited. The previous version is kept.");
    return result;
  }

  function changeBreak(
    breakId: string,
    dateKey: string,
    start: string,
    end: string | null
  ): MutationResult {
    const result = updateBreak({
      breakId,
      startAt: toLagosIso(dateKey, start),
      endAt: end ? toLagosIso(dateKey, end) : null,
    });
    if (result.ok) setNotice("Break updated.");
    return result;
  }

  const workMinutes = Math.min(summary.normalMinutes, SCHEDULED_MINUTES);
  const progressBreak = Math.min(summary.breakMinutes, Math.max(0, SCHEDULED_MINUTES - workMinutes));
  const coveredMinutes = workMinutes + progressBreak;
  const remainingMinutes = Math.max(0, SCHEDULED_MINUTES - workMinutes - progressBreak);
  const progressWorkWidth = (workMinutes / SCHEDULED_MINUTES) * 100;
  const progressBreakWidth = (progressBreak / SCHEDULED_MINUTES) * 100;
  const progressRemainingWidth = (remainingMinutes / SCHEDULED_MINUTES) * 100;
  const employee = db.employees.find((item) => item.id === meId);
  const initials = employee?.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() ?? "WT";
  const dateEntries = recordsSummary.entries;
  const taskStatusCounts = getTaskStatusCounts(db.tasks, dateEntries);

  const timeline = [
    ...dateEntries.map((entry) => ({ kind: "entry" as const, at: entry.startAt, entry })),
    ...recordsSummary.breaks.map((brk) => ({ kind: "break" as const, at: brk.startAt, brk })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    mounted,
    db,
    now,
    todayKey,
    summary,
    recordsSummary,
    recordsDateKey,
    openTasks,
    employeeTasks,
    activeBreak,
    selectedTask,
    selectedTaskSubtasks,
    detailTask,
    slots,
    nextAvailableSlot,
    matchingTasks,
    taskOptions,
    taskSearch,
    setTaskSearch,
    taskMode,
    taskChoice,
    setTaskChoice: chooseTask,
    newTaskTitle,
    setNewTaskTitle,
    newTaskCategory,
    setNewTaskCategory,
    newTaskNote,
    setNewTaskNote,
    newTaskSubtasks,
    addNewTaskSubtask,
    updateNewTaskSubtask,
    removeNewTaskSubtask,
    categories,
    description,
    setDescription,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    location,
    setLocation,
    evidenceLink,
    setEvidenceLink,
    showEvidenceLink,
    setShowEvidenceLink,
    isReportedOvertime,
    setIsReportedOvertime,
    showTimeAdjustment,
    setShowTimeAdjustment,
    slotLocked,
    lockAutoSlot,
    editingId,
    editingDateKey,
    selectedSlot,
    setSelectedSlot,
    subtaskChoice,
    setSubtaskChoice,
    error,
    setError,
    notice,
    recordsOpen,
    setRecordsOpen,
    recordsTab,
    setRecordsTab,
    recordsDate,
    setRecordsDate,
    exportFrom,
    setExportFrom,
    exportTo,
    setExportTo,
    exportError,
    exporting,
    submitting,
    formRef,
    effectiveDateKey,
    workdayStatus,
    isHistoricalEdit,
    effectiveTaskMode,
    taskDetailsOpen,
    taskDetailsTaskId,
    resetForm,
    beginEdit,
    deleteEntry,
    selectTaskMode,
    selectSlot,
    submitEntry,
    handleStartBreak,
    handleEndBreak: () => handleEndBreak(),
    openRecords,
    exportRecords,
    openTaskDetails,
    closeTaskDetails,
    saveTask,
    changeTaskStatus,
    addSubtask,
    saveSubtask,
    changeSubtaskStatus,
    addProgress,
    saveProgress,
    changeBreak,
    coveredMinutes,
    remainingMinutes,
    progressWorkWidth,
    progressBreakWidth,
    progressRemainingWidth,
    employee,
    initials,
    taskStatusCounts,
    timeline,
  };
}

export type WorkLogController = ReturnType<typeof useWorkLogController>;
