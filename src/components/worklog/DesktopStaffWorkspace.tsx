"use client";

import {
  Building2,
  CalendarDays,
  Check,
  Coffee,
  House,
  ListChecks,
  Paperclip,
  Plus,
  Save,
  Square,
  X,
  Zap,
} from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import { WORK_LOCATION_LABELS, WORKLOG_RULES } from "@/lib/worklog/config";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import type { WorkLocation } from "@/lib/worklog/types";
import { ProfileMenu } from "./ProfileMenu";
import {
  BASE_INPUT_CLASS,
  INPUT_CLASS,
  NEW_TASK,
  SCHEDULED_MINUTES,
} from "./shared";
import type { WorkLogController } from "./useWorkLogController";

const LOCATION_ICONS = {
  office: Building2,
  home: House,
} satisfies Record<Exclude<WorkLocation, "other" | "unknown">, typeof Building2>;

export function DesktopStaffWorkspace({ c }: { c: WorkLogController }) {
  const {
    now,
    summary,
    slots,
    nextAvailableSlot,
    taskOptions,
    taskSearch,
    setTaskSearch,
    taskChoice,
    setTaskChoice,
    newTaskTitle,
    setNewTaskTitle,
    newTaskSubtasks,
    addNewTaskSubtask,
    updateNewTaskSubtask,
    removeNewTaskSubtask,
    selectedTaskSubtasks,
    subtaskChoice,
    setSubtaskChoice,
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
    editingId,
    selectedSlot,
    setSelectedSlot,
    error,
    activeBreak,
    submitting,
    formRef,
    effectiveDateKey,
    workdayStatus,
    isHistoricalEdit,
    effectiveTaskMode,
    resetForm,
    selectTaskMode,
    selectSlot,
    submitEntry,
    handleStartBreak,
    handleEndBreak,
    openRecords,
    openTaskDetails,
    coveredMinutes,
    remainingMinutes,
    progressWorkWidth,
    progressBreakWidth,
    progressRemainingWidth,
    employee,
    lockAutoSlot,
  } = c;

  return (
    <div className="hidden min-h-dvh bg-[#F7F7FC] px-6 py-3 text-[#17172F] lg:block">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-[1240px] flex-col">
        <header className="mb-3 flex min-h-12 shrink-0 items-center justify-between rounded-xl border border-[#E7E6F0] bg-white px-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#6C45F5] text-white">
              <Zap size={16} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
            </span>
            <span className="text-sm font-bold tracking-tight text-[#17172F]">WorkTrack</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openTaskDetails()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] px-2 text-xs font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] sm:px-3 sm:text-sm"
            >
              <ListChecks size={15} aria-hidden="true" />
              My Tasks
            </button>
            <button
              type="button"
              onClick={openRecords}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] px-2 text-xs font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] sm:px-3 sm:text-sm"
            >
              <CalendarDays size={15} aria-hidden="true" />
              My Records
            </button>
            <ProfileMenu
              name={employee?.name ?? "Employee"}
              role={employee ? `${employee.role} · ${employee.department}` : "Staff"}
              avatarUrl={employee?.avatarUrl}
              editable
              required={Boolean(employee && !employee.avatarUrl)}
            />
          </div>
        </header>

        <section
          ref={formRef}
          id="work-form"
          className="flex w-full flex-1 flex-col overflow-y-auto rounded-2xl border border-[#E7E6F0] bg-white p-6 shadow-[0_10px_32px_rgba(47,39,92,0.07)]"
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold leading-tight tracking-[-0.02em] text-[#17172F] sm:text-[22px]">
                  {editingId ? "Edit work entry" : "Log Your Work"}
                </h1>
                {editingId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[#6C45F5] hover:bg-[#F5F1FF]"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 text-[11px] text-[#777A91] sm:text-xs">
                {isHistoricalEdit
                  ? `Editing a record from ${formatDateLabel(effectiveDateKey)}.`
                  : "Record what you worked on today."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] bg-white px-1.5 text-[9px] font-medium text-[#383650] shadow-sm sm:gap-1.5 sm:px-2 sm:text-[10px]">
                <CalendarDays size={12} aria-hidden="true" className="shrink-0 text-[#777A91]" />
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: WORKTRACK_SCHEDULE.timezone,
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(now)}
              </span>
              <span
                className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[9px] font-semibold sm:gap-1.5 sm:px-2 sm:text-[10px] ${
                  workdayStatus === "Workday active"
                    ? "bg-[#EAF8F0] text-[#15803D]"
                    : "bg-[#F7F7FC] text-[#777A91]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${workdayStatus === "Workday active" ? "bg-[#16A34A]" : "bg-[#A1A1B2]"}`}
                />
                {workdayStatus}
              </span>
            </div>
          </div>

          <section
            aria-labelledby="progress-heading"
            className="mb-2 shrink-0 rounded-xl border border-[#EEEAF8] bg-[#FCFBFF] p-2.5 shadow-[0_4px_14px_rgba(47,39,92,0.04)]"
          >
            <div className="grid gap-2 min-[480px]:grid-cols-[minmax(104px,auto)_minmax(0,1fr)] min-[480px]:items-center min-[480px]:gap-4">
              <div>
                <h2 id="progress-heading" className="text-[10px] font-semibold text-[#17172F] sm:text-xs">
                  Today’s Progress
                </h2>
                <p className="mt-0.5 whitespace-nowrap text-[9px] text-[#777A91] sm:text-[10px]">
                  <span className="text-base font-bold leading-none text-[#6C45F5] sm:text-lg">{formatMinutes(coveredMinutes)}</span>
                  <span className="ml-1">of {formatMinutes(SCHEDULED_MINUTES)}</span>
                </p>
              </div>
              <div className="min-w-0">
                <div
                  role="progressbar"
                  aria-label="Today's workday progress"
                  aria-valuemin={0}
                  aria-valuemax={SCHEDULED_MINUTES}
                  aria-valuenow={Math.min(SCHEDULED_MINUTES, summary.normalMinutes + summary.breakMinutes)}
                  className="flex h-2.5 overflow-hidden rounded-full bg-[#ECEBF2]"
                >
                  <span className="bg-[#6C45F5] transition-[width]" style={{ width: `${progressWorkWidth}%` }} />
                  <span className="bg-[#F59E0B] transition-[width]" style={{ width: `${progressBreakWidth}%` }} />
                  <span className="bg-[#DCDCE8] transition-[width]" style={{ width: `${progressRemainingWidth}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[9px] text-[#777A91] sm:gap-x-3 sm:text-[10px]">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#6C45F5]" />
                    Work ({formatMinutes(summary.normalMinutes)})
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
                    Break ({formatMinutes(summary.breakMinutes)})
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#D0D0DF]" />
                    Remaining ({formatMinutes(remainingMinutes)})
                  </span>
                </div>
              </div>
            </div>
          </section>

          {activeBreak ? null : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <section aria-labelledby="task-heading" className="rounded-xl border border-[#E7E6F0] bg-[#FCFBFF] p-4">
                <h2 id="task-heading" className="text-[13px] font-semibold text-[#17172F] sm:text-[15px]">
                  Task Details
                </h2>
                <div className="mt-2 grid w-full grid-cols-2 rounded-lg bg-[#F4F3F8] p-0.5">
                  <button
                    type="button"
                    aria-label="Continue existing task"
                    aria-pressed={effectiveTaskMode === "continue"}
                    onClick={() => selectTaskMode("continue")}
                    className={`min-h-[38px] whitespace-nowrap rounded-md px-1 text-[10px] font-semibold transition sm:text-xs ${
                      effectiveTaskMode === "continue" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#777A91] hover:text-[#39364F]"
                    }`}
                  >
                    Continue existing task
                  </button>
                  <button
                    type="button"
                    aria-label="Start a new task"
                    aria-pressed={effectiveTaskMode === "new"}
                    onClick={() => selectTaskMode("new")}
                    className={`min-h-[38px] whitespace-nowrap rounded-md px-1 text-[10px] font-semibold transition sm:text-xs ${
                      effectiveTaskMode === "new" ? "bg-white text-[#4E35C6] shadow-sm" : "text-[#777A91] hover:text-[#39364F]"
                    }`}
                  >
                    Start new task
                  </button>
                </div>
                {effectiveTaskMode === "continue" ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 items-end gap-2">
                      <input
                        value={taskSearch}
                        onChange={(event) => setTaskSearch(event.target.value)}
                        aria-label="Search ongoing or blocked tasks"
                        placeholder="Search tasks..."
                        className={BASE_INPUT_CLASS}
                        disabled={Boolean(editingId)}
                      />
                      <WorkTrackSelect
                        label="Choose a task"
                        value={taskChoice}
                        placeholder="Select a task"
                        disabled={Boolean(editingId)}
                        onChange={(value) => {
                          if (value === NEW_TASK) selectTaskMode("new");
                          else setTaskChoice(value);
                        }}
                        options={taskOptions}
                      />
                    </div>
                    {selectedTaskSubtasks.length ? (
                      <WorkTrackSelect
                        label="Subtask (optional)"
                        value={subtaskChoice}
                        disabled={Boolean(editingId)}
                        onChange={setSubtaskChoice}
                        options={[
                          { value: "", label: "No specific subtask", description: "Log against the main task" },
                          ...selectedTaskSubtasks.map((subtask) => ({
                            value: subtask.id,
                            label: subtask.title,
                            description: subtask.status === "done" ? "Done" : subtask.status === "dropped" ? "Dropped" : "Open",
                          })),
                        ]}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs font-semibold text-[#53506B]">
                      Task title
                      <input
                        value={newTaskTitle}
                        maxLength={WORKLOG_RULES.taskTitleMaxLength}
                        onChange={(event) => setNewTaskTitle(event.target.value)}
                        placeholder="Give this task a clear name"
                        className={INPUT_CLASS}
                      />
                    </label>
                    <section aria-labelledby="new-subtasks-heading" className="rounded-lg border border-[#EEEAF2] bg-white p-3">
                      <h3 id="new-subtasks-heading" className="text-xs font-semibold text-[#39364F]">
                        Subtasks
                      </h3>
                      <p className="mt-0.5 text-[10px] leading-4 text-[#9A97AD]">
                        Break this task into smaller activities you can track and update separately.
                      </p>
                      <button
                        type="button"
                        onClick={addNewTaskSubtask}
                        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#CFC8F3] bg-white px-3 text-xs font-semibold text-[#5A3ED0] transition hover:border-[#B8A8F8] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                      >
                        <Plus size={13} aria-hidden="true" /> Add Subtask
                      </button>
                      {newTaskSubtasks.length ? (
                        <ul className="mt-2 space-y-1.5">
                          {newTaskSubtasks.map((subtask, index) => (
                            <li key={index} className="flex items-center gap-1.5">
                              <input
                                value={subtask}
                                maxLength={WORKLOG_RULES.subtaskTitleMaxLength}
                                onChange={(event) => updateNewTaskSubtask(index, event.target.value)}
                                placeholder={`Subtask ${index + 1}`}
                                aria-label={`Subtask ${index + 1} title`}
                                className={INPUT_CLASS}
                              />
                              <button
                                type="button"
                                onClick={() => removeNewTaskSubtask(index)}
                                aria-label={`Remove subtask ${index + 1}`}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F1F1F5] hover:text-[#B42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                              >
                                <X size={14} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="mt-2 text-[10px] text-[#9A97AD]">
                        Subtasks can also be added later from My Tasks.
                      </p>
                    </section>
                  </div>
                )}
                <label className="mt-3 block border-t border-[#EEEAF2] pt-3 text-xs font-semibold text-[#53506B]">
                  Work description
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    maxLength={WORKLOG_RULES.descriptionMaxLength}
                    placeholder="What did you work on during this time?"
                    className={`${INPUT_CLASS} min-h-[76px] resize-y`}
                  />
                </label>
              </section>

              <div className="space-y-4">
                <section aria-labelledby="time-location-heading" className="rounded-xl border border-[#E7E6F0] bg-[#FCFBFF] p-4">
                  <h2 id="time-location-heading" className="text-[13px] font-semibold text-[#17172F] sm:text-[15px]">
                    Time &amp; Location
                  </h2>
                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[11px] font-semibold text-[#53506B]">Work time</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTimeAdjustment((value) => !value);
                          lockAutoSlot();
                        }}
                        aria-expanded={showTimeAdjustment}
                        className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-[#E7E6F0] bg-white px-2 text-[10px] font-semibold text-[#5A3ED0] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] sm:text-[11px]"
                      >
                        {showTimeAdjustment ? "Hide custom time" : "Set custom time"}
                      </button>
                    </div>
                    {slots.length ? (
                      <div className="mt-1.5 grid grid-cols-4 gap-2">
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
                              className={`relative flex min-h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:cursor-not-allowed disabled:opacity-55 ${
                                selected
                                  ? "border-[#6C45F5] bg-[#F5F1FF] text-[#4E35C6]"
                                  : isNext
                                    ? "border-[#B8A8F8] bg-[#F5F1FF] text-[#4E35C6]"
                                    : slot.available
                                      ? "border-[#E7E6F0] bg-white text-[#39364F] hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
                                      : "border-[#E7E6F0] bg-[#F1F1F5] text-[#8B8B9A]"
                              }`}
                            >
                              {selected ? <Check size={12} aria-hidden="true" className="mr-1 shrink-0" /> : null}
                              <span className="truncate">{slot.label}</span>
                              {slot.current && slot.available ? (
                                <span className="sr-only">Current hour</span>
                              ) : isNext ? (
                                <span className="sr-only">Next available</span>
                              ) : null}
                              {!slot.available ? <span className="ml-1 shrink-0 text-[9px] font-medium">Recorded</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1.5 rounded-lg bg-[#F7F7FC] px-2.5 py-2 text-xs text-[#777A91]">
                        No standard work slots today. Use the time adjustment to record weekend overtime.
                      </p>
                    )}
                    {showTimeAdjustment ? (
                      <div className="mt-2 grid gap-2 rounded-xl border border-[#EEEAF8] bg-white p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <label className="block text-[12px] font-semibold text-[#53506B] sm:text-[13px]">
                          Start time
                          <input
                            type="time"
                            value={startTime}
                            onChange={(event) => {
                              setStartTime(event.target.value);
                              setSelectedSlot("");
                              lockAutoSlot();
                            }}
                            className={INPUT_CLASS}
                          />
                        </label>
                        <label className="block text-xs font-semibold text-[#53506B]">
                          End time
                          <input
                            type="time"
                            value={endTime}
                            onChange={(event) => {
                              setEndTime(event.target.value);
                              setSelectedSlot("");
                              lockAutoSlot();
                            }}
                            className={INPUT_CLASS}
                          />
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
                  </div>
                  <fieldset className="mt-3 min-w-0 border-t border-[#EEEAF2] pt-3">
                    <legend className="text-[11px] font-semibold text-[#53506B] sm:text-xs">Where did you work?</legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {(["office", "home"] as const).map((item) => {
                        const Icon = LOCATION_ICONS[item];
                        const selected = location === item;
                        return (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setLocation(item)}
                            aria-label={WORK_LOCATION_LABELS[item]}
                            aria-pressed={selected}
                            className={`flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                              selected
                                ? "border-[#6C45F5] bg-[#F5F1FF] text-[#5A3ED0]"
                                : "border-[#E7E6F0] bg-white text-[#53506B] hover:bg-[#FCFBFF]"
                            }`}
                          >
                            <Icon size={15} aria-hidden="true" />
                            {WORK_LOCATION_LABELS[item]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                </section>

                <section aria-labelledby="additional-details-heading" className="rounded-xl border border-[#E7E6F0] bg-[#FCFBFF] p-4">
                  <h2 id="additional-details-heading" className="text-[13px] font-semibold text-[#17172F] sm:text-[15px]">
                    Additional Details
                  </h2>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setShowEvidenceLink((value) => !value)}
                      aria-expanded={showEvidenceLink}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-3 text-xs font-semibold text-[#5A3ED0] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                    >
                      <Paperclip size={13} aria-hidden="true" />
                      {showEvidenceLink ? "Hide evidence" : "Add evidence"}
                    </button>
                    {showEvidenceLink ? (
                      <label className="mt-2 block rounded-lg border border-[#EEEAF2] bg-white p-2.5 text-[11px] font-medium text-[#777A91]">
                        Evidence link
                        <input
                          value={evidenceLink}
                          onChange={(event) => setEvidenceLink(event.target.value)}
                          placeholder="https://"
                          className={`${INPUT_CLASS} mt-1`}
                        />
                      </label>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          )}

          {isHistoricalEdit ? (
            <p className={`rounded-xl bg-[#F7F7FC] px-3 py-2 text-xs text-[#777A91] ${activeBreak ? "hidden" : ""}`}>
              This edit changes only the selected historical entry. It will not change today’s logging date or the
              task’s current status.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl bg-[#FDEEEE] px-3 py-2.5 text-sm text-[#B43A3A]">
              {error}
            </p>
          ) : null}

          {activeBreak ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F6D99A] bg-[#FFF6E5] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#9A6200]">
                <Coffee size={17} aria-hidden="true" />
                On break since {formatTime(activeBreak.startAt)}
              </div>
              <button
                type="button"
                onClick={handleEndBreak}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F59E0B] px-4 text-sm font-semibold text-white transition hover:bg-[#DB8A08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-2"
              >
                <Square size={14} aria-hidden="true" /> End Break
              </button>
            </div>
          ) : null}

          {!activeBreak ? (
            <div className="grid grid-cols-2 gap-3 border-t border-[#EEEAF2] pt-3">
              <button
                type="button"
                onClick={handleStartBreak}
                disabled={Boolean(activeBreak) || Boolean(editingId)}
                className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-[#F3C56B] bg-[#FFF6E5] px-5 text-sm font-semibold text-[#9A6200] transition hover:bg-[#FFEFCE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Coffee size={16} aria-hidden="true" /> Take Break
              </button>
              <button
                type="button"
                onClick={submitEntry}
                disabled={Boolean(activeBreak) || submitting}
                className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-[#6C45F5] px-6 text-sm font-semibold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {editingId ? "Save Changes" : "Save Work Entry"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
