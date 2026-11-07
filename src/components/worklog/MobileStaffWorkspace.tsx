"use client";

import { useEffect, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coffee,
  House,
  ListChecks,
  Plus,
  Search,
  Square,
  X,
  Zap,
} from "lucide-react";
import { WORK_LOCATION_LABELS, WORKLOG_RULES } from "@/lib/worklog/config";
import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import type { WorkLocation } from "@/lib/worklog/types";
import { ProfileMenu } from "./ProfileMenu";
import { StatusBadge } from "./StatusBadge";
import {
  MOBILE_BASE_INPUT_CLASS,
  MOBILE_INPUT_CLASS,
  SCHEDULED_MINUTES,
} from "./shared";
import type { WorkLogController } from "./useWorkLogController";
import type { WorkSlot } from "./shared";

const LOCATION_ICONS = {
  office: Building2,
  home: House,
} satisfies Record<Exclude<WorkLocation, "other">, typeof Building2>;

export function MobileStaffWorkspace({ c }: { c: WorkLogController }) {
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [adjustSheetOpen, setAdjustSheetOpen] = useState(false);
  const [confirmBreak, setConfirmBreak] = useState(false);
  const [sheetQuery, setSheetQuery] = useState("");
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset > 40 ? inset : 0);
    };
    const init = window.setTimeout(update, 0);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      window.clearTimeout(init);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const filteredSheetTasks = c.openTasks.filter((task) =>
    task.title.toLocaleLowerCase().includes(sheetQuery.trim().toLocaleLowerCase())
  );

  const formDirty = Boolean(
    c.description.trim() ||
      c.newTaskTitle.trim() ||
      c.newTaskNote.trim() ||
      c.newTaskSubtasks.some((title) => title.trim()) ||
      c.evidenceLink.trim() ||
      c.editingId
  );

  function requestBreak() {
    if (formDirty) {
      setConfirmBreak(true);
      return;
    }
    c.handleStartBreak();
  }

  function confirmStartBreak() {
    setConfirmBreak(false);
    c.handleStartBreak();
  }

  function chooseTask(taskId: string) {
    c.setTaskChoice(taskId);
    c.setError(null);
    setTaskSheetOpen(false);
    setSheetQuery("");
  }

  function pickSlot(slot: WorkSlot) {
    c.selectSlot(slot);
    setAdjustSheetOpen(false);
  }

  function openAdjustSheet() {
    c.lockAutoSlot();
    c.setShowTimeAdjustment(true);
    setAdjustSheetOpen(true);
  }

  const breakElapsed = c.activeBreak
    ? formatMinutes(Math.max(0, Math.round((c.now.getTime() - new Date(c.activeBreak.startAt).getTime()) / 60_000)))
    : "";

  const selectedTaskTitle = c.selectedTask?.title;
  const canContinue = c.openTasks.length > 0 || Boolean(c.editingId);

  return (
    <div className="staff-workspace flex min-h-dvh flex-col bg-[#F7F7FC] text-[#17172F] lg:hidden">
      <header className="sticky top-0 z-40 border-b border-[#ECEAF4] bg-[#F7F7FC]/90 backdrop-blur-md">
        <div
          className="mx-auto flex h-14 w-full max-w-[560px] items-center justify-between px-4"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#6C45F5] text-white">
              <Zap size={16} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
            </span>
            <span className="text-sm font-bold tracking-tight text-[#17172F]">WorkTrack</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => c.openTaskDetails()}
              aria-label="My tasks"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-2.5 text-xs font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <ListChecks size={15} aria-hidden="true" />
              <span className="hidden min-[380px]:inline">My Tasks</span>
            </button>
            <button
              type="button"
              onClick={c.openRecords}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-2.5 text-xs font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <CalendarDays size={15} aria-hidden="true" />
              My Records
            </button>
            <ProfileMenu
              name={c.employee?.name ?? "Employee"}
              role={c.employee ? `${c.employee.role} · ${c.employee.department}` : "Staff"}
              avatarUrl={c.employee?.avatarUrl}
              editable
              required={Boolean(c.employee && !c.employee.avatarUrl)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-32 pt-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-[-0.02em] text-[#17172F]">
              {c.editingId ? "Edit work entry" : "Log Your Work"}
            </h1>
            <p className="mt-0.5 text-xs text-[#777A91]">
              {c.isHistoricalEdit
                ? `Editing a record from ${formatDateLabel(c.effectiveDateKey)}.`
                : "Record what you worked on today."}
            </p>
          </div>
          {c.editingId ? (
            <button
              type="button"
              onClick={c.resetForm}
              className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-2.5 text-[11px] font-semibold text-[#383650]">
            <CalendarDays size={13} aria-hidden="true" className="text-[#777A91]" />
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: WORKTRACK_SCHEDULE.timezone,
              weekday: "short",
              day: "numeric",
              month: "short",
            }).format(c.now)}
          </span>
          <span
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ${
              c.workdayStatus === "Workday active"
                ? "bg-[#EAF8F0] text-[#15803D]"
                : "bg-[#F1F0F6] text-[#6B6880]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${c.workdayStatus === "Workday active" ? "bg-[#16A34A]" : "bg-[#A1A1B2]"}`}
            />
            {c.workdayStatus === "Workday active" ? "Workday active" : c.workdayStatus}
          </span>
        </div>

        {c.activeBreak ? (
          <section
            aria-label="Active break"
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#F6D99A] bg-[#FFF6E5] p-4"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#9A6200]">
              <Coffee size={17} aria-hidden="true" />
              On break since {formatTime(c.activeBreak.startAt)}
              <span className="ml-auto rounded-full bg-[#FDEBC8] px-2 py-0.5 text-[11px] font-bold text-[#8A5A00]">
                {breakElapsed} elapsed
              </span>
            </div>
            <button
              type="button"
              onClick={c.handleEndBreak}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] px-4 text-sm font-semibold text-white transition hover:bg-[#DB8A08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-2"
            >
              <Square size={14} aria-hidden="true" /> End Break
            </button>
          </section>
        ) : (
          <div className="space-y-4">
            <section aria-labelledby="mobile-task-heading">
              <h2 id="mobile-task-heading" className="mb-2 text-sm font-semibold text-[#17172F]">
                What are you working on?
              </h2>
              <div className="mb-2 grid grid-cols-2 rounded-xl bg-[#ECEAF4] p-1" role="tablist" aria-label="Task mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={c.effectiveTaskMode === "continue"}
                  disabled={!canContinue}
                  onClick={() => c.selectTaskMode("continue")}
                  className={`min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:opacity-45 ${
                    c.effectiveTaskMode === "continue" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#6B6880]"
                  }`}
                >
                  Continue task
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={c.effectiveTaskMode === "new"}
                  onClick={() => c.selectTaskMode("new")}
                  className={`min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                    c.effectiveTaskMode === "new" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#6B6880]"
                  }`}
                >
                  New task
                </button>
              </div>

              {c.effectiveTaskMode === "continue" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSheetQuery("");
                      setTaskSheetOpen(true);
                    }}
                    className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border-2 px-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                      selectedTaskTitle
                        ? "border-[#CFC8F3] bg-white hover:border-[#B8A8F8]"
                        : "border-[#6C45F5]/40 bg-[#F5F1FF]/60 hover:border-[#6C45F5]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#8B7BE8]">
                        Current task
                      </span>
                      <span className={`block truncate text-[15px] font-bold ${selectedTaskTitle ? "text-[#17172F]" : "text-[#6C45F5]"}`}>
                        {selectedTaskTitle ?? "Select a task"}
                      </span>
                      {selectedTaskTitle && c.selectedTask ? (
                        <span className="mt-0.5 block">
                          <StatusBadge status={c.selectedTask.currentStatus} />
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-[#9A93C0]" aria-hidden="true" />
                  </button>
                  {c.selectedTaskSubtasks.length ? (
                    <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                      Subtask (optional)
                      <select
                        value={c.subtaskChoice}
                        onChange={(event) => c.setSubtaskChoice(event.target.value)}
                        disabled={Boolean(c.editingId)}
                        className={`${MOBILE_INPUT_CLASS} min-h-11`}
                      >
                        <option value="">No specific subtask</option>
                        {c.selectedTaskSubtasks.map((subtask) => (
                          <option key={subtask.id} value={subtask.id}>
                            {subtask.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-[#53506B]">
                    Task title
                    <input
                      value={c.newTaskTitle}
                      maxLength={WORKLOG_RULES.taskTitleMaxLength}
                      onChange={(event) => c.setNewTaskTitle(event.target.value)}
                      placeholder="Give this task a clear name"
                      className={`${MOBILE_INPUT_CLASS} min-h-12`}
                    />
                  </label>
                  <label className="block text-[11px] font-semibold text-[#53506B]">
                    Category (optional)
                    <select
                      value={c.newTaskCategory}
                      onChange={(event) => c.setNewTaskCategory(event.target.value)}
                      className={`${MOBILE_INPUT_CLASS} min-h-11`}
                    >
                      <option value="">No category</option>
                      {c.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {c.newTaskSubtasks.map((subtask, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <label className="block flex-1 text-[11px] font-semibold text-[#53506B]">
                        Subtask {index + 1}
                        <input
                          value={subtask}
                          maxLength={WORKLOG_RULES.subtaskTitleMaxLength}
                          onChange={(event) => c.updateNewTaskSubtask(index, event.target.value)}
                          placeholder="A smaller piece of this task"
                          className={`${MOBILE_INPUT_CLASS} min-h-11`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => c.removeNewTaskSubtask(index)}
                        aria-label={`Remove subtask ${index + 1}`}
                        className="mb-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#E7E6F0] text-[#777A91]"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={c.addNewTaskSubtask}
                    className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[#6C45F5]"
                  >
                    <Plus size={13} aria-hidden="true" /> Add subtask
                  </button>
                  <label className="block text-[11px] font-semibold text-[#53506B]">
                    Initial progress note (optional)
                    <textarea
                      value={c.newTaskNote}
                      onChange={(event) => c.setNewTaskNote(event.target.value)}
                      rows={2}
                      maxLength={WORKLOG_RULES.progressUpdateMaxLength}
                      placeholder="Where are you starting from?"
                      className={`${MOBILE_INPUT_CLASS} min-h-[64px] resize-y`}
                    />
                  </label>
                </div>
              )}
            </section>

            <section aria-labelledby="mobile-desc-heading">
              <label htmlFor="mobile-description" className="mb-1.5 block text-sm font-semibold text-[#17172F]">
                What did you work on?
              </label>
              <textarea
                id="mobile-description"
                value={c.description}
                onChange={(event) => c.setDescription(event.target.value)}
                rows={3}
                maxLength={WORKLOG_RULES.descriptionMaxLength}
                placeholder="Briefly describe what you worked on…"
                className={`${MOBILE_INPUT_CLASS} min-h-[84px] resize-y`}
              />
            </section>

            <section aria-labelledby="mobile-time-heading">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id="mobile-time-heading" className="text-sm font-semibold text-[#17172F]">
                  Time
                </h2>
                <button
                  type="button"
                  onClick={openAdjustSheet}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                >
                  <Clock3 size={14} aria-hidden="true" />
                  Adjust time / overtime
                </button>
              </div>

              {c.slots.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {c.slots.map((slot) => {
                    const selected = c.selectedSlot === slot.key;
                    const isNext = c.nextAvailableSlot?.key === slot.key;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => pickSlot(slot)}
                        aria-pressed={selected}
                        className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:cursor-not-allowed disabled:opacity-55 ${
                          selected
                            ? "border-[#6C45F5] bg-[#F5F1FF] text-[#4E35C6]"
                            : slot.available
                              ? isNext
                                ? "border-[#B8A8F8] bg-[#F5F1FF]/60 text-[#39364F] hover:bg-[#F5F1FF]"
                                : "border-[#E7E6F0] bg-white text-[#39364F] hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
                              : "border-[#E7E6F0] bg-[#F1F1F5] text-[#8B8B9A]"
                        }`}
                      >
                        {selected ? <Check size={14} aria-hidden="true" className="shrink-0" /> : null}
                        <span className="truncate">{slot.label}</span>
                        {!slot.available ? <span className="shrink-0 text-[9px] font-medium">Recorded</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-[#EEEAF8] bg-white p-3.5">
                  <p className="text-xs leading-5 text-[#777A91]">
                    No standard hourly slots today. Use{" "}
                    <button type="button" onClick={openAdjustSheet} className="font-semibold text-[#6C45F5] underline">
                      adjust time / overtime
                    </button>{" "}
                    to log work outside 9:00–17:00 or on a weekend.
                  </p>
                </div>
              )}

              {c.showTimeAdjustment && !c.selectedSlot ? (
                <p className="mt-2 rounded-lg bg-[#F1F0F6] px-3 py-2 text-[11px] font-medium text-[#6B6880]">
                  Custom time: {c.startTime} – {c.endTime}
                  {c.isReportedOvertime ? " · reported as overtime" : ""}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="mobile-location-heading">
              <h2 id="mobile-location-heading" className="mb-1.5 text-sm font-semibold text-[#17172F]">
                Where did you work?
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {(["office", "home"] as const).map((item) => {
                  const Icon = LOCATION_ICONS[item];
                  const selected = c.location === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => c.setLocation(item)}
                      aria-pressed={selected}
                      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                        selected
                          ? "border-[#6C45F5] bg-[#F5F1FF] text-[#5A3ED0]"
                          : "border-[#E7E6F0] bg-white text-[#53506B] hover:bg-[#FCFBFF]"
                      }`}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {WORK_LOCATION_LABELS[item]}
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="mobile-evidence-heading">
              <h2 id="mobile-evidence-heading" className="mb-1.5 text-sm font-semibold text-[#17172F]">
                Evidence
              </h2>
              <button
                type="button"
                onClick={() => c.setShowEvidenceLink((value) => !value)}
                aria-expanded={c.showEvidenceLink}
                className="inline-flex min-h-9 items-center text-xs font-semibold text-[#6C45F5] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                {c.showEvidenceLink ? "Hide evidence" : "Add evidence (optional)"}
              </button>
              {c.showEvidenceLink ? (
                <label className="mt-1 block text-[11px] font-semibold text-[#53506B]">
                  Evidence link
                  <input
                    value={c.evidenceLink}
                    onChange={(event) => c.setEvidenceLink(event.target.value)}
                    placeholder="https://"
                    inputMode="url"
                    className={`${MOBILE_INPUT_CLASS} min-h-11`}
                  />
                </label>
              ) : null}
            </section>

            {c.isHistoricalEdit ? (
              <p className="rounded-xl bg-[#F1F0F6] px-3 py-2.5 text-xs leading-5 text-[#6B6880]">
                This edit changes only the selected historical entry. It will not change today’s logging date or the
                task’s current status.
              </p>
            ) : null}
            {c.error ? (
              <p role="alert" className="rounded-xl bg-[#FDEEEE] px-3 py-2.5 text-sm text-[#B43A3A]">
                {c.error}
              </p>
            ) : null}
          </div>
        )}

        <section
          aria-labelledby="mobile-progress-heading"
          className="mt-5 rounded-2xl border border-[#EEEAF8] bg-white p-3 shadow-[0_4px_14px_rgba(47,39,92,0.05)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="mobile-progress-heading" className="text-xs font-semibold text-[#17172F]">
              Today’s Progress
            </h2>
            <p className="text-[11px] text-[#777A91]">
              <span className="text-base font-bold leading-none text-[#6C45F5]">{formatMinutes(c.coveredMinutes)}</span>
              <span className="ml-1">of {formatMinutes(SCHEDULED_MINUTES)}</span>
            </p>
          </div>
          <div
            role="progressbar"
            aria-label="Today's workday progress"
            aria-valuemin={0}
            aria-valuemax={SCHEDULED_MINUTES}
            aria-valuenow={Math.min(SCHEDULED_MINUTES, c.summary.normalMinutes + c.summary.breakMinutes)}
            className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#ECEBF2]"
          >
            <span className="bg-[#6C45F5] transition-[width]" style={{ width: `${c.progressWorkWidth}%` }} />
            <span className="bg-[#F59E0B] transition-[width]" style={{ width: `${c.progressBreakWidth}%` }} />
            <span className="bg-[#DCDCE8] transition-[width]" style={{ width: `${c.progressRemainingWidth}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#777A91]">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#6C45F5]" />
              Work {formatMinutes(c.summary.normalMinutes)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
              Break {formatMinutes(c.summary.breakMinutes)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#D0D0DF]" />
              Remaining {formatMinutes(c.remainingMinutes)}
            </span>
          </div>
        </section>
      </main>

      {!c.activeBreak ? (
        <div
          className="fixed inset-x-0 z-40 border-t border-[#ECEAF4] bg-white/95 backdrop-blur-md"
          style={{
            bottom: keyboardInset,
            paddingBottom: keyboardInset ? 0 : "env(safe-area-inset-bottom)",
          }}
        >
          <div className="mx-auto flex w-full max-w-[560px] items-stretch gap-2 px-4 py-3">
            {confirmBreak ? (
              <>
                <p className="flex min-w-0 flex-1 items-center text-[11px] font-medium leading-4 text-[#6B6880]">
                  You have an unsaved entry. Start a break anyway?
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmBreak(false)}
                  className="min-h-12 shrink-0 rounded-xl border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B]"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={confirmStartBreak}
                  className="min-h-12 shrink-0 rounded-xl bg-[#F59E0B] px-3 text-xs font-semibold text-white"
                >
                  Start break
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={requestBreak}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#F3C56B] bg-[#FFF6E5] px-2 text-xs font-semibold text-[#9A6200] transition hover:bg-[#FFEFCE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]"
                >
                  <Coffee size={16} aria-hidden="true" />
                  Take Break
                </button>
                <button
                  type="button"
                  onClick={c.submitEntry}
                  disabled={c.submitting}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] px-2 text-xs font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {c.editingId ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                  {c.editingId ? "Save Changes" : "Save Work Entry"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <MobileSheet
        open={taskSheetOpen}
        onClose={() => {
          setTaskSheetOpen(false);
          setSheetQuery("");
        }}
        title="Choose a task"
      >
        <label className="relative mb-2 block">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9A93C0]" />
          <input
            autoFocus
            value={sheetQuery}
            onChange={(event) => setSheetQuery(event.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className={`${MOBILE_BASE_INPUT_CLASS} min-h-11 pl-9`}
          />
        </label>
        <div className="space-y-1.5">
          {filteredSheetTasks.map((task) => {
            const selected = c.taskChoice === task.id;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => chooseTask(task.id)}
                aria-pressed={selected}
                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                  selected ? "border-[#6C45F5] bg-[#F5F1FF]" : "border-[#E7E6F0] bg-white"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#17172F]">{task.title}</span>
                  <span className="mt-0.5 block">
                    <StatusBadge status={task.currentStatus} />
                  </span>
                </span>
                {selected ? <Check size={18} className="shrink-0 text-[#6C45F5]" aria-hidden="true" /> : null}
              </button>
            );
          })}
          {filteredSheetTasks.length === 0 ? (
            <p className="rounded-xl bg-[#F7F7FC] px-4 py-5 text-center text-sm text-[#777A91]">
              No matching tasks. Start a new one below.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            c.selectTaskMode("new");
            setTaskSheetOpen(false);
            setSheetQuery("");
          }}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#CFC8F3] text-sm font-semibold text-[#5A3ED0]"
        >
          <Plus size={16} aria-hidden="true" />
          Start a new task
        </button>
      </MobileSheet>

      <MobileSheet open={adjustSheetOpen} onClose={() => setAdjustSheetOpen(false)} title="Adjust time / overtime">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-semibold text-[#53506B]">
            Start time
            <input
              type="time"
              value={c.startTime}
              onChange={(event) => {
                c.setStartTime(event.target.value);
                c.setSelectedSlot("");
              }}
              className={`${MOBILE_INPUT_CLASS} min-h-12`}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[#53506B]">
            End time
            <input
              type="time"
              value={c.endTime}
              onChange={(event) => {
                c.setEndTime(event.target.value);
                c.setSelectedSlot("");
              }}
              className={`${MOBILE_INPUT_CLASS} min-h-12`}
            />
          </label>
        </div>
        <label className="mt-3 flex min-h-12 items-center gap-2.5 text-sm text-[#53506B]">
          <input
            type="checkbox"
            checked={c.isReportedOvertime}
            onChange={(event) => c.setIsReportedOvertime(event.target.checked)}
            className="h-4 w-4 accent-[#6C45F5]"
          />
          Report as overtime
        </label>
        <p className="mt-2 text-[11px] leading-5 text-[#8B8B9A]">
          Use this for work before 9:00, after 17:00, or on weekends. Overlapping recorded entries and breaks are
          rejected when you save.
        </p>
        <button
          type="button"
          onClick={() => setAdjustSheetOpen(false)}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#6C45F5] text-sm font-semibold text-white"
        >
          Done
        </button>
      </MobileSheet>
    </div>
  );
}

function MobileSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#17172F]/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-[#E0DDEC]" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between border-b border-[#EEEAF2] px-4 py-3">
          <h2 className="text-base font-bold text-[#17172F]">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] hover:text-[#17172F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
      </section>
    </div>
  );
}
