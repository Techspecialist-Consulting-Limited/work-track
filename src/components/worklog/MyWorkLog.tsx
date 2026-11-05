"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Coffee, Pencil, Plus, Save, Square, X, Zap } from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { getZonedDateKey, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";
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
  updateTaskStatus,
  type EntryInput,
} from "@/lib/worklog/repository";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import { getDaySummary, getOpenTasks, getTaskById } from "@/lib/worklog/selectors";
import type { TaskStatus, WorkEntry, WorkLocation } from "@/lib/worklog/types";

const NEW_TASK = "__new_task__";
const STATUS_OPTIONS: TaskStatus[] = ["ongoing", "blocked", "completed", "dropped"];
const INPUT_CLASS = "mt-1 w-full rounded-xl border border-wt-ink/15 bg-white px-3 py-2 text-sm";

const subscribeNoop = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

function lagosDayParts(dateKey: string): [number, number, number] {
  const [y, m, d] = dateKey.split("-").map(Number);
  return [y, m, d];
}

function toLagosIso(dateKey: string, time: string): string {
  const [y, m, d] = lagosDayParts(dateKey);
  const [h, min] = time.split(":").map(Number);
  return zonedDateTimeToDate(y, m, d, h, min).toISOString();
}

function roundedLagosTime(at: Date): string {
  const [y, m, d] = lagosDayParts(getZonedDateKey(at));
  const dayStart = zonedDateTimeToDate(y, m, d, 0, 0).getTime();
  const minutes = Math.min(23 * 60 + 45, Math.ceil((at.getTime() - dayStart) / 60_000 / 15) * 15);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function MyWorkLog() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const todayKey = getZonedDateKey(now);
  const summary = useMemo(
    () => getDaySummary(db, SIGNED_IN_EMPLOYEE_ID, todayKey, now),
    [db, todayKey, now]
  );
  const openTasks = getOpenTasks(db, SIGNED_IN_EMPLOYEE_ID);
  const hasToday = summary.entries.length > 0 || summary.breaks.length > 0;

  const [taskChoice, setTaskChoice] = useState<string>("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState<WorkLocation>("office");
  const [evidenceLink, setEvidenceLink] = useState("");
  const [isReportedOvertime, setIsReportedOvertime] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusChoice, setStatusChoice] = useState<TaskStatus>("ongoing");
  const [statusReason, setStatusReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTask = taskChoice && taskChoice !== NEW_TASK ? getTaskById(db, taskChoice) : undefined;

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!mounted) {
    return <div className="grid min-h-dvh place-items-center text-sm text-wt-ink/60">Loading your work log…</div>;
  }

  function resetForm() {
    setTaskChoice("");
    setNewTaskTitle("");
    setDescription("");
    setEvidenceLink("");
    setIsReportedOvertime(false);
    setEditingId(null);
    setError(null);
    setStartTime(roundedLagosTime(now));
    setEndTime(roundedLagosTime(new Date(now.getTime() + 60 * 60_000)));
  }

  function beginEdit(entry: WorkEntry) {
    setEditingId(entry.id);
    setTaskChoice(entry.taskId);
    setDescription(entry.description);
    setStartTime(formatTime(entry.startAt));
    setEndTime(formatTime(entry.endAt));
    setLocation(entry.workLocation);
    setEvidenceLink(entry.evidenceLink ?? "");
    setIsReportedOvertime(entry.isReportedOvertime);
    setError(null);
  }

  function submitEntry() {
    setError(null);
    if (!taskChoice) {
      setError("Choose a task first.");
      return;
    }
    let taskId = taskChoice;
    if (taskId === NEW_TASK) {
      const created = createTask({ employeeId: SIGNED_IN_EMPLOYEE_ID, title: newTaskTitle });
      if (!created.ok) {
        setError(created.message);
        return;
      }
      taskId = created.taskId;
    }
    const input: EntryInput = {
      employeeId: SIGNED_IN_EMPLOYEE_ID,
      taskId,
      description,
      startAt: toLagosIso(todayKey, startTime),
      endAt: toLagosIso(todayKey, endTime),
      workLocation: location,
      evidenceLink: evidenceLink || undefined,
      isReportedOvertime,
    };
    const result = editingId ? editWorkEntry(editingId, input) : addWorkEntry(input);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(editingId ? "Entry updated." : "Entry saved.");
    resetForm();
  }

  function applyStatus() {
    if (!selectedTask) return;
    const result = updateTaskStatus(selectedTask.id, statusChoice, statusReason);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStatusReason("");
    setError(null);
    setNotice(`Task marked ${TASK_STATUS_LABELS[statusChoice].toLowerCase()}.`);
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
    if (!summary.activeBreak) return;
    const result = endBreak(summary.activeBreak.id);
    if (!result.ok) setError(result.message);
    else {
      setError(null);
      setNotice("Break ended.");
    }
  }

  const logForm = (
    <section aria-labelledby="log-work-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="log-work-heading" className="text-base font-semibold text-wt-ink">
          {editingId ? "Edit work entry" : "Log work"}
        </h2>
        {editingId ? (
          <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-xs font-medium text-wt-ink/70 hover:text-wt-ink">
            <X size={14} aria-hidden="true" /> Cancel edit
          </button>
        ) : null}
      </div>

      <WorkTrackSelect
        label="Task"
        value={taskChoice}
        placeholder="Choose a task"
        onChange={(value) => setTaskChoice(value)}
        options={[
          ...openTasks.map((task) => ({
            value: task.id,
            label: task.title,
            description: TASK_STATUS_LABELS[task.currentStatus],
          })),
          { value: NEW_TASK, label: "New task…", description: "Create a task and log work on it" },
        ]}
      />

      {taskChoice === NEW_TASK ? (
        <label className="block text-sm">
          <span className="font-medium text-wt-ink">New task title</span>
          <input value={newTaskTitle} maxLength={WORKLOG_RULES.taskTitleMaxLength + 20} onChange={(e) => setNewTaskTitle(e.target.value)} className={INPUT_CLASS} />
        </label>
      ) : null}

      <label className="block text-sm">
        <span className="font-medium text-wt-ink">What did you work on?</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={WORKLOG_RULES.descriptionMaxLength + 20} className={INPUT_CLASS} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="font-medium text-wt-ink">Start</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-wt-ink">End</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      <WorkTrackSelect
        label="Where did you work?"
        value={location}
        onChange={(value) => setLocation(value as WorkLocation)}
        options={[
          { value: "office", label: WORK_LOCATION_LABELS.office },
          { value: "home", label: WORK_LOCATION_LABELS.home },
        ]}
      />

      <label className="flex items-center gap-2 text-sm text-wt-ink">
        <input type="checkbox" checked={isReportedOvertime} onChange={(e) => setIsReportedOvertime(e.target.checked)} />
        Report as overtime
      </label>

      <label className="block text-sm">
        <span className="font-medium text-wt-ink">Evidence link (optional)</span>
        <input value={evidenceLink} onChange={(e) => setEvidenceLink(e.target.value)} placeholder="https://" className={INPUT_CLASS} />
      </label>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={submitEntry} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-wt-violet px-4 py-2.5 text-sm font-semibold text-white">
        {editingId ? <Save size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        {editingId ? "Save changes" : "Save entry"}
      </button>

      {selectedTask ? (
        <div className="space-y-2 rounded-xl border border-wt-ink/10 bg-white/70 p-3">
          <p className="text-sm font-medium text-wt-ink">Current task status: {TASK_STATUS_LABELS[selectedTask.currentStatus]}</p>
          <WorkTrackSelect
            label="Change task status"
            value={statusChoice}
            onChange={(value) => setStatusChoice(value as TaskStatus)}
            options={STATUS_OPTIONS.map((status) => ({ value: status, label: TASK_STATUS_LABELS[status] }))}
          />
          {statusChoice === "blocked" || statusChoice === "dropped" ? (
            <input
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder={statusChoice === "blocked" ? "What is blocking this?" : "Why is this being dropped?"}
              className={INPUT_CLASS}
            />
          ) : null}
          <button type="button" onClick={applyStatus} className="text-sm font-semibold text-wt-violet">
            Update status
          </button>
        </div>
      ) : null}
    </section>
  );

  const breakButton = summary.activeBreak ? (
    <button type="button" onClick={handleEndBreak} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
      <Square size={14} aria-hidden="true" /> End break
    </button>
  ) : (
    <button type="button" onClick={handleStartBreak} className="inline-flex items-center gap-2 rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-700">
      <Coffee size={15} aria-hidden="true" /> Start break
    </button>
  );

  const toast = notice ? (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-wt-ink px-4 py-2 text-sm text-white shadow-lg">
      {notice}
    </div>
  ) : null;

  const header = (
    <header className="mb-6 flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[linear-gradient(145deg,#9a83ff_0%,#7257ff_46%,#5a3df0_100%)] text-white">
        <Zap size={15} strokeWidth={2.1} fill="currentColor" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-[13px] font-semibold leading-none text-wt-ink">My Work Log</h1>
        <p className="mt-1 text-xs text-wt-ink/60">{formatDateLabel(todayKey)}</p>
      </div>
    </header>
  );

  if (!hasToday) {
    return (
      <main className="wt-preview-canvas grid min-h-dvh place-items-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
          {header}
          <p className="mb-5 text-sm text-wt-ink/70">Nothing logged yet today. Start with your first piece of work.</p>
          {logForm}
          <div className="mt-5 flex justify-center">{breakButton}</div>
        </div>
        {toast}
      </main>
    );
  }

  return (
    <main className="wt-preview-canvas min-h-dvh px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {header}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-xl">{logForm}</div>

          <div className="space-y-5 rounded-3xl bg-white p-6 shadow-xl">
            <section aria-labelledby="today-heading" className="space-y-3">
              <h2 id="today-heading" className="text-base font-semibold text-wt-ink">Today</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Work" value={formatMinutes(summary.workMinutes)} />
                <Stat label="Break" value={formatMinutes(summary.breakMinutes)} />
                <Stat label="Not logged" value={formatMinutes(summary.notLoggedMinutes)} />
                <Stat label="Overtime" value={formatMinutes(summary.overtimeMinutes)} />
                <Stat label="Office" value={formatMinutes(summary.officeMinutes)} />
                <Stat label="Home" value={formatMinutes(summary.homeMinutes)} />
              </dl>
              <div className="flex items-center justify-between gap-3">
                {breakButton}
                {summary.activeBreak ? <span className="text-xs text-amber-700">Break started {formatTime(summary.activeBreak.startAt)}</span> : null}
              </div>
            </section>

            <section aria-labelledby="entries-heading" className="space-y-2">
              <h2 id="entries-heading" className="text-sm font-semibold text-wt-ink">Entries</h2>
              <ul className="space-y-2">
                {summary.entries.map((entry) => {
                  const task = getTaskById(db, entry.taskId);
                  return (
                    <li key={entry.id} className="flex items-start justify-between gap-3 rounded-xl border border-wt-ink/10 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-wt-ink">
                          {formatTime(entry.startAt)}–{formatTime(entry.endAt)} · {task?.title ?? "Task"}
                        </p>
                        <p className="truncate text-wt-ink/70">{entry.description}</p>
                        <p className="text-xs text-wt-ink/60">
                          {WORK_LOCATION_LABELS[entry.workLocation]} · Status then: {TASK_STATUS_LABELS[entry.statusAtEntry]}
                          {entry.overtimeMinutes > 0 ? ` · Overtime ${formatMinutes(entry.overtimeMinutes)}` : ""}
                          {entry.isReportedOvertime ? " · Reported" : ""}
                          {entry.revisions.length > 0 ? " · Edited" : ""}
                        </p>
                      </div>
                      <button type="button" onClick={() => beginEdit(entry)} aria-label="Edit entry" className="shrink-0 rounded-lg p-1.5 text-wt-ink/70 hover:bg-wt-ink/5">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>
      </div>
      {toast}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-wt-canvas p-3">
      <dt className="text-xs text-wt-ink/60">{label}</dt>
      <dd className="text-base font-semibold text-wt-ink">{value}</dd>
    </div>
  );
}
