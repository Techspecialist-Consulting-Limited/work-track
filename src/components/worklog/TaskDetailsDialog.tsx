"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  History,
  ListChecks,
  Pencil,
  Plus,
  Save,
  X,
} from "lucide-react";
import {
  TASK_STATUS_BADGE_CLASSES,
  TASK_STATUS_LABELS,
  WORKLOG_RULES,
} from "@/lib/worklog/config";
import { subtaskSummary } from "@/lib/worklog/status-rules";
import {
  getProgressUpdatesForTask,
  getSubtaskById,
  getSubtaskStatusHistory,
  getSubtasksForTask,
  getTaskById,
  getTaskStatusHistory,
} from "@/lib/worklog/selectors";
import { dateKeyOf, durationMinutes, formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import type { TaskStatus } from "@/lib/worklog/types";
import { StatusBadge } from "./StatusBadge";
import { dateKeyAfter, STATUS_LABELS, STATUS_OPTIONS } from "./shared";
import type { WorkLogController } from "./useWorkLogController";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-2 text-base text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15 lg:min-h-9 lg:text-[13px]";

type Tab = "details" | "subtasks" | "progress" | "history";

export function TaskDetailsDialog({ c }: { c: WorkLogController }) {
  const [selectedId, setSelectedId] = useState<string | null>(c.taskDetailsTaskId);
  const [syncedId, setSyncedId] = useState<string | null>(c.taskDetailsTaskId);
  const [tab, setTab] = useState<Tab>("details");
  const [error, setError] = useState<string | null>(null);

  if (!c.taskDetailsOpen) return null;

  if (c.taskDetailsTaskId !== syncedId) {
    setSyncedId(c.taskDetailsTaskId);
    setSelectedId(c.taskDetailsTaskId);
    setTab("details");
    setError(null);
  }

  function close() {
    c.closeTaskDetails();
  }

  function renderTaskCard(item: (typeof c.employeeTasks)[number], note?: string) {
    const subtasks = getSubtasksForTask(c.db, item.id);
    const summary = subtaskSummary(subtasks);
    const selected = selectedId === item.id;
    return (
      <div
        key={item.id}
        className={`rounded-xl border bg-white p-3 transition ${
          selected ? "border-[#6C45F5] bg-[#F5F1FF]" : "border-[#E7E6F0] hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words text-[13px] font-semibold text-[#17172F]">{item.title}</p>
          <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${TASK_STATUS_BADGE_CLASSES[item.currentStatus]}`}>
            {TASK_STATUS_LABELS[item.currentStatus]}
          </span>
        </div>
        {item.description ? (
          <p className="mt-1 line-clamp-2 break-words text-[11px] leading-4 text-[#777A91]">{item.description}</p>
        ) : null}
        <p className="mt-1 text-[10px] text-[#777A91]">
          {item.categoryName ? `${item.categoryName} · ` : ""}
          {summary.label}
        </p>
        {note ? <p className="mt-1 text-[10px] font-semibold text-[#B45309]">{note}</p> : null}
        {summary.total > 0 ? (
          <div
            role="progressbar"
            aria-label={`${item.title} subtask completion`}
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.done + summary.dropped}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#ECEBF2]"
          >
            <div
              className="h-full rounded-full bg-[#6C45F5] transition-[width]"
              style={{ width: `${((summary.done + summary.dropped) / summary.total) * 100}%` }}
            />
          </div>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => c.openUpdateProgress(item.id)}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-[#6C45F5] px-2 text-[11px] font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <Pencil size={11} aria-hidden="true" />
            Update Progress
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(item.id);
              setError(null);
            }}
            aria-pressed={selected}
            className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
              selected
                ? "border-[#6C45F5] bg-white text-[#4E35C6]"
                : "border-[#E7E6F0] bg-white text-[#4A4665] hover:border-[#CFC8F3] hover:bg-[#F5F1FF]"
            }`}
          >
            <Eye size={11} aria-hidden="true" />
            View Task
          </button>
        </div>
      </div>
    );
  }

  const task = selectedId ? getTaskById(c.db, selectedId) : undefined;

  return (
    <div
      className="staff-workspace fixed inset-0 z-50 flex items-stretch justify-center bg-[#17172F]/40 backdrop-blur-[2px] lg:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        className="flex h-dvh w-full max-w-[980px] flex-col overflow-hidden bg-white shadow-2xl lg:h-[88dvh] lg:rounded-2xl lg:border lg:border-[#E7E6F0]"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EEEAF2] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {task ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setError(null);
                }}
                aria-label="Back to task list"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] lg:hidden"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
            ) : null}
            <div className="min-w-0">
              <h2 id="task-details-title" className="truncate text-base font-bold text-[#17172F] sm:text-lg">
                My Tasks
              </h2>
              <p className="mt-0.5 text-[11px] text-[#777A91] sm:text-xs">
                Status, subtasks and progress for your tasks
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close My Tasks"
            onClick={close}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={`min-h-0 overflow-y-auto border-[#EEEAF2] lg:block lg:border-r ${task ? "hidden" : "block"}`}>
            <div className="flex items-center gap-1 border-b border-[#EEEAF2] px-2.5 py-2">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => c.setTasksDate(dateKeyAfter(c.tasksDateKey, -1))}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC]"
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <input
                aria-label="Select tasks date"
                type="date"
                max={c.todayKey}
                value={c.tasksDateKey}
                onChange={(event) => c.setTasksDate(event.target.value)}
                className="min-h-8 min-w-0 flex-1 rounded-lg border border-[#E7E6F0] px-1.5 text-xs font-semibold text-[#39364F]"
              />
              <button
                type="button"
                onClick={() => c.setTasksDate("")}
                className="min-h-8 shrink-0 rounded-lg px-1.5 text-[11px] font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]"
              >
                Today
              </button>
              <button
                type="button"
                aria-label="Next day"
                disabled={c.tasksDateKey >= c.todayKey}
                onClick={() => c.setTasksDate(dateKeyAfter(c.tasksDateKey, 1))}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] text-[#53506B] hover:bg-[#F7F7FC] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-1.5 p-3">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[#9A97AD]">
                {formatDateLabel(c.tasksDateKey)}
                {c.tasksDateKey === c.todayKey ? " · Today" : ""}
              </p>
              {c.tasksForDay.length === 0 && c.carriedOverTasks.length === 0 ? (
                <p className="rounded-xl bg-[#F7F7FC] px-3 py-6 text-center text-sm text-[#777A91]">
                  No tasks logged for this day.
                </p>
              ) : null}
              {c.tasksForDay.map((item) => renderTaskCard(item))}
              {c.carriedOverTasks.length ? (
                <>
                  <p className="mt-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-[#B45309]">
                    Carried over · still ongoing
                  </p>
                  {c.carriedOverTasks.map(({ task: item, lastEntryKey }) =>
                    renderTaskCard(item, `Last logged ${formatDateLabel(lastEntryKey)}`)
                  )}
                </>
              ) : null}
            </div>
          </aside>

          <div className={`min-h-0 overflow-y-auto ${task ? "block" : "hidden lg:block"}`}>
            {task ? (
              <TaskPanel c={c} taskId={task.id} tab={tab} setTab={setTab} error={error} setError={setError} />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center">
                <div>
                  <ListChecks size={28} className="mx-auto text-[#C3BDEB]" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-[#39364F]">Select a task</p>
                  <p className="mt-0.5 text-xs text-[#777A91]">Choose a task to see its subtasks, progress and history.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function TaskPanel({
  c,
  taskId,
  tab,
  setTab,
  error,
  setError,
}: {
  c: WorkLogController;
  taskId: string;
  tab: Tab;
  setTab: (tab: Tab) => void;
  error: string | null;
  setError: (message: string | null) => void;
}) {
  const task = getTaskById(c.db, taskId);
  const subtasks = getSubtasksForTask(c.db, taskId);
  const progress = getProgressUpdatesForTask(c.db, taskId);
  const summary = subtaskSummary(subtasks);
  const entries = c.db.entries.filter((entry) => entry.taskId === taskId);
  const loggedMinutes = entries.reduce((total, entry) => total + durationMinutes(entry.startAt, entry.endAt), 0);

  const [draft, setDraft] = useState({ id: "", title: "", description: "", categoryId: "" });
  const [statusReason, setStatusReason] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState({ title: "", description: "" });
  const [editingSubtask, setEditingSubtask] = useState({ id: "", title: "", description: "" });
  const [subtaskPrompt, setSubtaskPrompt] = useState<{ id: string; status: TaskStatus; reason: string } | null>(null);
  const [progressDraft, setProgressDraft] = useState({ body: "", subtaskId: "" });
  const [editingProgress, setEditingProgress] = useState({ id: "", body: "", reason: "" });
  const [expandedRevisions, setExpandedRevisions] = useState<Record<string, boolean>>({});

  if (!task) return null;

  if (draft.id !== task.id) {
    setDraft({
      id: task.id,
      title: task.title,
      description: task.description ?? "",
      categoryId: task.categoryId ?? "",
    });
    setStatusReason("");
    setSubtaskDraft({ title: "", description: "" });
    setEditingSubtask({ id: "", title: "", description: "" });
    setSubtaskPrompt(null);
    setProgressDraft({ body: "", subtaskId: "" });
    setEditingProgress({ id: "", body: "", reason: "" });
    setError(null);
  }

  const taskHistory = getTaskStatusHistory(c.db, taskId);
  const subtaskHistory = subtasks.flatMap((subtask) =>
    getSubtaskStatusHistory(c.db, subtask.id).map((event) => ({ ...event, subtaskTitle: subtask.title }))
  );

  function saveDetails() {
    const result = c.saveTask({
      taskId,
      title: draft.title,
      description: draft.description,
      categoryId: draft.categoryId || null,
    });
    if (!result.ok) setError(result.message);
    else setError(null);
  }

  function changeTaskStatus(status: TaskStatus) {
    if (status === "blocked" || status === "dropped") {
      const result = c.changeTaskStatus(taskId, status, statusReason);
      if (!result.ok) setError(result.message);
      else {
        setStatusReason("");
        setError(null);
      }
      return;
    }
    const result = c.changeTaskStatus(taskId, status);
    if (!result.ok) setError(result.message);
    else setError(null);
  }

  function addSubtask() {
    const result = c.addSubtask(taskId, subtaskDraft.title, subtaskDraft.description);
    if (!result.ok) setError(result.message);
    else {
      setSubtaskDraft({ title: "", description: "" });
      setError(null);
    }
  }

  function saveSubtask() {
    const result = c.saveSubtask({
      subtaskId: editingSubtask.id,
      title: editingSubtask.title,
      description: editingSubtask.description,
    });
    if (!result.ok) setError(result.message);
    else {
      setEditingSubtask({ id: "", title: "", description: "" });
      setError(null);
    }
  }

  function requestSubtaskStatus(subtaskId: string, status: TaskStatus) {
    if (status === "blocked" || status === "dropped") {
      setSubtaskPrompt({ id: subtaskId, status, reason: "" });
      return;
    }
    const result = c.changeSubtaskStatus(subtaskId, status);
    if (!result.ok) setError(result.message);
    else {
      setSubtaskPrompt(null);
      setError(null);
    }
  }

  function confirmSubtaskPrompt() {
    if (!subtaskPrompt) return;
    const result = c.changeSubtaskStatus(subtaskPrompt.id, subtaskPrompt.status, subtaskPrompt.reason);
    if (!result.ok) setError(result.message);
    else {
      setSubtaskPrompt(null);
      setError(null);
    }
  }

  function addProgress() {
    const result = c.addProgress(taskId, progressDraft.subtaskId || null, progressDraft.body);
    if (!result.ok) setError(result.message);
    else {
      setProgressDraft({ body: "", subtaskId: progressDraft.subtaskId });
      setError(null);
    }
  }

  function saveProgress() {
    const result = c.saveProgress(editingProgress.id, editingProgress.body, editingProgress.reason);
    if (!result.ok) setError(result.message);
    else {
      setEditingProgress({ id: "", body: "", reason: "" });
      setError(null);
    }
  }

  return (
    <div className="pb-8">
      <div className="border-b border-[#EEEAF2] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-bold text-[#17172F]">{task.title}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#777A91]">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TASK_STATUS_BADGE_CLASSES[task.currentStatus]}`}>
                {TASK_STATUS_LABELS[task.currentStatus]}
              </span>
              {task.categoryName ? <span>{task.categoryName}</span> : null}
              <span>Created {formatDateLabel(dateKeyOf(task.createdAt))}</span>
              <span>{summary.label}</span>
            </p>
          </div>
          <div className="shrink-0 rounded-xl bg-[#F7F7FC] px-3 py-2 text-right">
            <p className="text-[10px] text-[#777A91]">Logged</p>
            <p className="text-sm font-bold text-[#17172F]">{formatMinutes(loggedMinutes)}</p>
          </div>
        </div>
        {task.blockerReason ? (
          <p className="mt-2 rounded-lg bg-[#FFFBEB] px-2.5 py-1.5 text-xs text-[#B45309]">Blocked: {task.blockerReason}</p>
        ) : null}
        {task.droppedReason ? (
          <p className="mt-2 rounded-lg bg-[#FEF3F2] px-2.5 py-1.5 text-xs text-[#B42318]">Dropped: {task.droppedReason}</p>
        ) : null}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[#EEEAF2] px-3 sm:px-5" role="tablist" aria-label="Task sections">
        {([
          ["details", "Details"],
          ["subtasks", `Subtasks${subtasks.length ? ` (${subtasks.length})` : ""}`],
          ["progress", `Progress${progress.length ? ` (${progress.length})` : ""}`],
          ["history", "History"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-10 whitespace-nowrap border-b-2 px-2.5 text-xs font-semibold transition sm:text-sm ${
              tab === key ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#777A91]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-lg bg-[#FDEEEE] px-3 py-2 text-xs text-[#B43A3A] sm:mx-5">
          {error}
        </p>
      ) : null}

      {tab === "details" ? (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <section aria-labelledby="task-status-heading">
            <h4 id="task-status-heading" className="text-[13px] font-semibold text-[#39364F]">
              Task status
            </h4>
            <p className="mt-0.5 text-[11px] text-[#777A91]">
              Status belongs to the task. Work entries never change it.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => changeTaskStatus(status)}
                  aria-pressed={task.currentStatus === status}
                  className={`min-h-10 rounded-lg border px-2 text-[11px] font-semibold transition ${
                    task.currentStatus === status
                      ? "border-[#6C45F5] bg-[#F5F1FF] text-[#4E35C6]"
                      : "border-[#E7E6F0] bg-white text-[#53506B] hover:bg-[#FCFBFF]"
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            {task.currentStatus !== "blocked" && task.currentStatus !== "dropped" ? (
              <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                Reason (needed for Blocked or Dropped)
                <input
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  maxLength={WORKLOG_RULES.reasonMaxLength}
                  placeholder="Explain a block or drop"
                  className={INPUT_CLASS}
                />
              </label>
            ) : (
              <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                Reason for reopening (optional)
                <input
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  maxLength={WORKLOG_RULES.reasonMaxLength}
                  placeholder="Why is this moving again?"
                  className={INPUT_CLASS}
                />
              </label>
            )}
            {summary.total > 0 && !summary.allSettled ? (
              <p className="mt-2 rounded-lg bg-[#F7F7FC] px-2.5 py-1.5 text-[11px] text-[#777A91]">
                Done requires every subtask to be Done or Dropped. {summary.label}.
              </p>
            ) : null}
            {summary.allSettled && task.currentStatus !== "done" ? (
              <button
                type="button"
                onClick={() => changeTaskStatus("done")}
                className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#A7E8C4] bg-[#ECFDF5] px-3 text-xs font-semibold text-[#047857] hover:bg-[#D8FBE8]"
              >
                <Check size={13} aria-hidden="true" /> All subtasks settled — mark task Done
              </button>
            ) : null}
          </section>

          <section aria-labelledby="task-edit-heading" className="border-t border-[#EEEAF2] pt-3">
            <h4 id="task-edit-heading" className="text-[13px] font-semibold text-[#39364F]">
              Task details
            </h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold text-[#53506B]">
                Title
                <input
                  value={draft.title}
                  maxLength={WORKLOG_RULES.taskTitleMaxLength}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#53506B]">
                Category
                <select
                  value={draft.categoryId}
                  onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="">No category</option>
                  {c.db.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
              Description
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={2}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
            <button
              type="button"
              onClick={saveDetails}
              className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE]"
            >
              <Save size={14} aria-hidden="true" /> Save details
            </button>
          </section>
        </div>
      ) : null}

      {tab === "subtasks" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          {subtasks.length === 0 ? (
            <p className="rounded-xl bg-[#F7F7FC] px-3 py-4 text-center text-xs text-[#777A91]">
              No subtasks yet. Break this task into smaller pieces below.
            </p>
          ) : null}
          {subtasks.map((subtask) => (
            <div key={subtask.id} className="rounded-xl border border-[#E7E6F0] p-3">
              {editingSubtask.id === subtask.id ? (
                <div className="space-y-2">
                  <input
                    value={editingSubtask.title}
                    maxLength={WORKLOG_RULES.subtaskTitleMaxLength}
                    onChange={(event) => setEditingSubtask({ ...editingSubtask, title: event.target.value })}
                    className={INPUT_CLASS}
                  />
                  <input
                    value={editingSubtask.description}
                    onChange={(event) => setEditingSubtask({ ...editingSubtask, description: event.target.value })}
                    placeholder="Description (optional)"
                    className={INPUT_CLASS}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingSubtask({ id: "", title: "", description: "" })}
                      className="min-h-9 rounded-lg px-3 text-xs font-semibold text-[#777A91]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveSubtask}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white"
                    >
                      <Save size={13} aria-hidden="true" /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-semibold text-[#17172F]">{subtask.title}</p>
                      {subtask.description ? (
                        <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[#777A91]">{subtask.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusBadge status={subtask.status} />
                      <button
                        type="button"
                        aria-label={`Edit subtask ${subtask.title}`}
                        onClick={() =>
                          setEditingSubtask({
                            id: subtask.id,
                            title: subtask.title,
                            description: subtask.description ?? "",
                          })
                        }
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#777A91] hover:bg-[#F5F1FF] hover:text-[#5A3ED0]"
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9A97AD]">Status</span>
                    <select
                      value={subtask.status}
                      onChange={(event) => requestSubtaskStatus(subtask.id, event.target.value as TaskStatus)}
                      className="min-h-8 rounded-lg border border-[#E7E6F0] bg-white px-2 text-xs text-[#39364F]"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {subtaskPrompt?.id === subtask.id ? (
                    <div className="mt-2 rounded-lg bg-[#FFF9ED] p-2">
                      <input
                        value={subtaskPrompt.reason}
                        onChange={(event) => setSubtaskPrompt({ ...subtaskPrompt, reason: event.target.value })}
                        maxLength={WORKLOG_RULES.reasonMaxLength}
                        placeholder={subtaskPrompt.status === "blocked" ? "What is blocking it?" : "Why drop it?"}
                        className={INPUT_CLASS}
                      />
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSubtaskPrompt(null)}
                          className="min-h-8 rounded-lg px-2 text-[11px] font-semibold text-[#777A91]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmSubtaskPrompt}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-[#F59E0B] px-2 text-[11px] font-semibold text-white"
                        >
                          <Check size={12} aria-hidden="true" /> Confirm
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}

          <section className="rounded-xl border border-dashed border-[#CFC8F3] bg-[#FCFBFF] p-3">
            <h4 className="text-[13px] font-semibold text-[#39364F]">Add a subtask</h4>
            <input
              value={subtaskDraft.title}
              maxLength={WORKLOG_RULES.subtaskTitleMaxLength}
              onChange={(event) => setSubtaskDraft({ ...subtaskDraft, title: event.target.value })}
              placeholder="Subtask title"
              className={INPUT_CLASS}
            />
            <input
              value={subtaskDraft.description}
              onChange={(event) => setSubtaskDraft({ ...subtaskDraft, description: event.target.value })}
              placeholder="Description (optional)"
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={addSubtask}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE]"
            >
              <Plus size={13} aria-hidden="true" /> Add subtask
            </button>
          </section>
        </div>
      ) : null}

      {tab === "progress" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <section className="rounded-xl border border-[#E7E6F0] bg-[#FCFBFF] p-3">
            <h4 className="text-[13px] font-semibold text-[#39364F]">Add a progress update</h4>
            <textarea
              value={progressDraft.body}
              onChange={(event) => setProgressDraft({ ...progressDraft, body: event.target.value })}
              rows={3}
              maxLength={WORKLOG_RULES.progressUpdateMaxLength}
              placeholder="What progress did you make?"
              className={`${INPUT_CLASS} resize-y`}
            />
            {subtasks.length ? (
              <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                Subtask (optional)
                <select
                  value={progressDraft.subtaskId}
                  onChange={(event) => setProgressDraft({ ...progressDraft, subtaskId: event.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="">Whole task</option>
                  {subtasks.map((subtask) => (
                    <option key={subtask.id} value={subtask.id}>
                      {subtask.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={addProgress}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE]"
            >
              <Plus size={13} aria-hidden="true" /> Add update
            </button>
          </section>

          {progress.length === 0 ? (
            <p className="rounded-xl bg-[#F7F7FC] px-3 py-4 text-center text-xs text-[#777A91]">
              No progress updates yet.
            </p>
          ) : null}

          <ol className="space-y-2 border-l border-[#E6E1F7] pl-3">
            {progress.map((update) => {
              const subtask = update.subtaskId ? getSubtaskById(c.db, update.subtaskId) : undefined;
              return (
                <li key={update.id} className="relative rounded-xl border border-[#E7E6F0] bg-white p-3 before:absolute before:-left-[18px] before:top-4 before:h-2 before:w-2 before:rounded-full before:bg-[#6C45F5]">
                  {editingProgress.id === update.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingProgress.body}
                        onChange={(event) => setEditingProgress({ ...editingProgress, body: event.target.value })}
                        rows={3}
                        maxLength={WORKLOG_RULES.progressUpdateMaxLength}
                        className={`${INPUT_CLASS} resize-y`}
                      />
                      <input
                        value={editingProgress.reason}
                        onChange={(event) => setEditingProgress({ ...editingProgress, reason: event.target.value })}
                        maxLength={WORKLOG_RULES.progressRevisionReasonMaxLength}
                        placeholder="Reason for the edit (optional)"
                        className={INPUT_CLASS}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingProgress({ id: "", body: "", reason: "" })}
                          className="min-h-9 rounded-lg px-3 text-xs font-semibold text-[#777A91]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveProgress}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white"
                        >
                          <Save size={13} aria-hidden="true" /> Save edit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10px] font-medium text-[#777A91]">
                          {update.authorName ?? "You"} · {formatDateLabel(dateKeyOf(update.createdAt))} {formatTime(update.createdAt)}
                          {update.editedAt ? " · edited" : ""}
                        </p>
                        <button
                          type="button"
                          aria-label="Edit progress update"
                          onClick={() => setEditingProgress({ id: update.id, body: update.body, reason: "" })}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F5F1FF] hover:text-[#5A3ED0]"
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      </div>
                      {subtask ? (
                        <p className="mt-0.5 inline-flex rounded bg-[#F5F1FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#5A3ED0]">
                          {subtask.title}
                        </p>
                      ) : null}
                      <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#39364F]">{update.body}</p>
                      {update.revisions.length ? (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRevisions((current) => ({ ...current, [update.id]: !current[update.id] }))
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#6C45F5] hover:underline"
                          >
                            <History size={11} aria-hidden="true" />
                            {update.revisions.length} previous {update.revisions.length === 1 ? "version" : "versions"}
                          </button>
                          {expandedRevisions[update.id] ? (
                            <ol className="mt-1 space-y-1">
                              {update.revisions.map((revision) => (
                                <li key={revision.id} className="rounded-lg bg-[#F7F7FC] px-2 py-1.5">
                                  <p className="text-[10px] text-[#9A97AD]">
                                    {formatDateLabel(dateKeyOf(revision.revisedAt))} {formatTime(revision.revisedAt)}
                                    {revision.revisedByName ? ` · ${revision.revisedByName}` : ""}
                                    {revision.revisionReason ? ` · ${revision.revisionReason}` : ""}
                                  </p>
                                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[#53506B]">{revision.previousBody}</p>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <section>
            <h4 className="text-[13px] font-semibold text-[#39364F]">Task status history</h4>
            <ol className="mt-2 space-y-1.5">
              {taskHistory.map((event) => (
                <li key={event.id} className="rounded-lg bg-[#F7F7FC] px-2.5 py-2">
                  <p className="text-[11px] font-semibold text-[#39364F]">
                    {event.previousStatus ? `${TASK_STATUS_LABELS[event.previousStatus]} → ` : "Created as "}
                    {TASK_STATUS_LABELS[event.newStatus]}
                  </p>
                  <p className="text-[10px] text-[#9A97AD]">
                    {formatDateLabel(dateKeyOf(event.changedAt))} {formatTime(event.changedAt)}
                    {event.changedByName ? ` · ${event.changedByName}` : ""}
                    {event.changeNote ? ` · ${event.changeNote}` : ""}
                  </p>
                </li>
              ))}
              {taskHistory.length === 0 ? <li className="text-xs text-[#777A91]">No status changes recorded.</li> : null}
            </ol>
          </section>
          <section>
            <h4 className="text-[13px] font-semibold text-[#39364F]">Subtask status history</h4>
            <ol className="mt-2 space-y-1.5">
              {subtaskHistory
                .slice()
                .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
                .map((event) => (
                  <li key={event.id} className="rounded-lg bg-[#F7F7FC] px-2.5 py-2">
                    <p className="text-[11px] font-semibold text-[#39364F]">{event.subtaskTitle}</p>
                    <p className="text-[11px] text-[#53506B]">
                      {event.previousStatus ? `${TASK_STATUS_LABELS[event.previousStatus]} → ` : "Created as "}
                      {TASK_STATUS_LABELS[event.newStatus]}
                    </p>
                    <p className="text-[10px] text-[#9A97AD]">
                      {formatDateLabel(dateKeyOf(event.changedAt))} {formatTime(event.changedAt)}
                      {event.changedByName ? ` · ${event.changedByName}` : ""}
                      {event.changeNote ? ` · ${event.changeNote}` : ""}
                    </p>
                  </li>
                ))}
              {subtaskHistory.length === 0 ? <li className="text-xs text-[#777A91]">No subtask changes recorded.</li> : null}
            </ol>
          </section>
        </div>
      ) : null}
    </div>
  );
}
