"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { TASK_STATUS_LABELS, WORKLOG_RULES } from "@/lib/worklog/config";
import { getSubtaskById, getSubtasksForTask, getTaskById } from "@/lib/worklog/selectors";
import type { TaskStatus } from "@/lib/worklog/types";
import { StatusBadge } from "./StatusBadge";
import { STATUS_LABELS, STATUS_OPTIONS } from "./shared";
import type { WorkLogController } from "./useWorkLogController";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-2 text-base text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15 lg:min-h-9 lg:text-[13px]";

export function UpdateProgressDialog({ c }: { c: WorkLogController }) {
  const taskId = c.progressUpdateTaskId;
  const [syncedTaskId, setSyncedTaskId] = useState<string | null>(taskId);
  const [targetId, setTargetId] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progressSaved, setProgressSaved] = useState(false);

  if (!taskId) return null;
  const task = getTaskById(c.db, taskId);
  if (!task) return null;
  const subtasks = getSubtasksForTask(c.db, taskId);
  const safeTaskId = taskId;
  const targetSubtask = targetId ? getSubtaskById(c.db, targetId) : undefined;
  const targetLabel = targetSubtask ? targetSubtask.title : task.title;
  const currentStatus: TaskStatus = targetSubtask ? targetSubtask.status : task.currentStatus;

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setTargetId("");
    setBody("");
    setStatus("");
    setReason("");
    setError(null);
    setProgressSaved(false);
  }

  function close() {
    c.closeUpdateProgress();
  }

  function save() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Describe the progress you made.");
      return;
    }
    const wantsStatus = status !== "" && status !== currentStatus;
    if (wantsStatus && (status === "blocked" || status === "dropped") && !reason.trim()) {
      setError(`Add a reason for ${TASK_STATUS_LABELS[status].toLowerCase()}.`);
      return;
    }
    const result = c.addProgress(safeTaskId, targetId || null, trimmed);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setProgressSaved(true);
    if (wantsStatus) {
      const needsReason = status === "blocked" || status === "dropped";
      const trimmedReason = needsReason ? reason.trim() || undefined : undefined;
      const statusResult = targetSubtask
        ? c.changeSubtaskStatus(targetSubtask.id, status as TaskStatus, trimmedReason)
        : c.changeTaskStatus(safeTaskId, status as TaskStatus, trimmedReason);
      if (!statusResult.ok) {
        setError(`Progress saved, but the status change failed: ${statusResult.message}`);
        return;
      }
    }
    close();
  }

  return (
    <div
      className="staff-workspace fixed inset-0 z-[60] flex items-center justify-center bg-[#17172F]/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-progress-title"
        className="flex max-h-[90dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EEEAF2] px-4 py-3">
          <div className="min-w-0">
            <h2 id="update-progress-title" className="text-base font-bold text-[#17172F]">
              Update Progress
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[#777A91]">{task.title}</p>
          </div>
          <button
            type="button"
            aria-label="Close update progress"
            onClick={close}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {error ? (
            <p role="alert" className="rounded-lg bg-[#FDEEEE] px-3 py-2 text-xs text-[#B43A3A]">
              {error}
            </p>
          ) : null}

          <fieldset>
            <legend className="text-xs font-semibold text-[#53506B]">What are you updating?</legend>
            <div className="mt-1.5 space-y-1.5">
              <button
                type="button"
                onClick={() => setTargetId("")}
                aria-pressed={targetId === ""}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                  targetId === ""
                    ? "border-[#6C45F5] bg-[#F5F1FF]"
                    : "border-[#E7E6F0] bg-white hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-[#17172F]">{task.title}</span>
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-[#9A97AD]">Main task</span>
                </span>
                <StatusBadge status={task.currentStatus} />
              </button>
              {subtasks.map((subtask) => (
                <button
                  key={subtask.id}
                  type="button"
                  onClick={() => setTargetId(subtask.id)}
                  aria-pressed={targetId === subtask.id}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                    targetId === subtask.id
                      ? "border-[#6C45F5] bg-[#F5F1FF]"
                      : "border-[#E7E6F0] bg-white hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-[#17172F]">{subtask.title}</span>
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-[#9A97AD]">Subtask</span>
                  </span>
                  <StatusBadge status={subtask.status} />
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-semibold text-[#53506B]">
            Progress update
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={WORKLOG_RULES.progressUpdateMaxLength}
              placeholder="Describe what has changed or what progress you have made..."
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>

          <fieldset>
            <legend className="text-xs font-semibold text-[#53506B]">Status change (optional)</legend>
            <p className="mt-0.5 text-[10px] leading-4 text-[#9A97AD]">
              Applies to {targetSubtask ? `the subtask “${targetLabel}”` : `the main task “${targetLabel}”`} — currently{" "}
              {TASK_STATUS_LABELS[currentStatus]}.
            </p>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus | "")}
              className={INPUT_CLASS}
              aria-label="New status"
            >
              <option value="">No status change</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </select>
            {status === "blocked" || status === "dropped" ? (
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={WORKLOG_RULES.reasonMaxLength}
                placeholder={status === "blocked" ? "What is blocking it?" : "Why drop it?"}
                className={INPUT_CLASS}
              />
            ) : null}
          </fieldset>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EEEAF2] px-4 py-3">
          <button
            type="button"
            onClick={close}
            className="min-h-10 rounded-lg px-4 text-xs font-semibold text-[#53506B] transition hover:bg-[#F7F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={progressSaved}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-4 text-xs font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={14} aria-hidden="true" />
            {progressSaved ? "Progress saved" : "Save Update"}
          </button>
        </footer>
      </section>
    </div>
  );
}
