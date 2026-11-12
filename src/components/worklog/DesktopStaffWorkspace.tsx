"use client";

import {
  Building2,
  CalendarDays,
  Coffee,
  House,
  Info,
  ListChecks,
  Paperclip,
  Plus,
  Save,
  Square,
  Users,
  X,
  Zap,
} from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import { WORK_LOCATION_LABELS, WORKLOG_RULES } from "@/lib/worklog/config";
import { formatDateLabel, formatMinutes, formatTime } from "@/lib/worklog/time";
import type { WorkLocation } from "@/lib/worklog/types";
import { ProfileMenu } from "./ProfileMenu";
import { BASE_INPUT_CLASS, INPUT_CLASS, NEW_PROJECT_OPTION, SCHEDULED_MINUTES } from "./shared";
import type { WorkLogController } from "./useWorkLogController";

const LOCATION_ICONS = {
  office: Building2,
  home: House,
} satisfies Record<Exclude<WorkLocation, "other" | "unknown">, typeof Building2>;

const OVERTIME_SLOT = "__overtime";

export function DesktopStaffWorkspace({ c }: { c: WorkLogController }) {
  const {
    now,
    summary,
    slots,
    nextAvailableSlot,
    teams,
    activeTeamId,
    activeTeam,
    chooseTeam,
    filteredProjects,
    projectSearch,
    setProjectSearch,
    projectChoice,
    selectedProject,
    projectSubtasks,
    activityChoice,
    setActivityChoice,
    newSubtaskTitle,
    setNewSubtaskTitle,
    addProjectSubtask,
    handleProjectSelect,
    showProjectInfo,
    setShowProjectInfo,
    showAddProject,
    setShowAddProject,
    newProjectName,
    setNewProjectName,
    newProjectDescription,
    setNewProjectDescription,
    projectError,
    duplicateProject,
    addingProject,
    addProject,
    useExistingProject,
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
    resetForm,
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

  const timeOptions = [
    ...slots.map((slot) => ({
      value: slot.key,
      label: slot.label,
      description: !slot.available
        ? "Already recorded"
        : slot.current
          ? "Current hour"
          : nextAvailableSlot?.key === slot.key
            ? "Next available"
            : undefined,
      disabled: !slot.available || Boolean(activeBreak),
    })),
    { value: OVERTIME_SLOT, label: "Overtime", description: "Set start and end manually" },
  ];
  const timeValue = selectedSlot || (showTimeAdjustment ? OVERTIME_SLOT : "");
  const selectedSlotLabel = slots.find((slot) => slot.key === selectedSlot)?.label;

  const handleTimeChange = (value: string) => {
    if (value === OVERTIME_SLOT) {
      setSelectedSlot("");
      setShowTimeAdjustment(true);
      lockAutoSlot();
      return;
    }
    const slot = slots.find((candidate) => candidate.key === value);
    if (slot) selectSlot(slot);
  };

  const projectSearchTrimmed = projectSearch.trim();
  const projectSearchExact = filteredProjects.some(
    (project) => project.name.toLocaleLowerCase() === projectSearchTrimmed.toLocaleLowerCase()
  );
  const projectOptions = [
    { value: "", label: "Select a project", description: "Choose the project or main task" },
    ...filteredProjects.map((project) => ({
      value: project.id,
      label: project.name,
      description:
        project.origin === "staff"
          ? project.promotedAt
            ? "Staff-added · approved"
            : "Staff-added · pending review"
          : project.description,
    })),
    {
      value: NEW_PROJECT_OPTION,
      label:
        projectSearchTrimmed.length >= 2 && !projectSearchExact
          ? `Add “${projectSearchTrimmed}” as a project`
          : "Add a project / task…",
      description: "Not in the list — create it for your team",
    },
  ];

  const activityOptions = [
    { value: "", label: "No specific activity", description: "Log against the project" },
    ...projectSubtasks.map((subtask) => ({
      value: subtask.id,
      label: subtask.title,
      description:
        subtask.status === "done"
          ? "Done"
          : subtask.status === "dropped"
            ? "Dropped"
            : subtask.status === "blocked"
              ? "Blocked"
              : "Open",
    })),
  ];

  const descriptionCount = description.length;

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
                <div className="flex items-center justify-between gap-2">
                  <h2 id="task-heading" className="text-[13px] font-semibold text-[#17172F] sm:text-[15px]">
                    Task Details
                  </h2>
                  {teams.length > 1 ? (
                    <div className="w-[46%] max-w-[220px]">
                      <WorkTrackSelect
                        label="Team"
                        value={activeTeamId}
                        onChange={chooseTeam}
                        options={teams.map((team) => ({
                          value: team.id,
                          label: team.name,
                          description: team.isDefault ? "Default team" : undefined,
                        }))}
                        placeholder="Select a team"
                        leadingIcon={<Users size={14} className="text-[#8B7BE8]" />}
                      />
                    </div>
                  ) : activeTeam ? (
                    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-2.5 text-[11px] font-semibold text-[#53506B]">
                      <Users size={13} className="text-[#8B7BE8]" aria-hidden="true" />
                      {activeTeam.name}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <span className="text-xs font-semibold text-[#53506B]">Project / Main Task</span>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <input
                        value={projectSearch}
                        onChange={(event) => setProjectSearch(event.target.value)}
                        aria-label="Search projects for this team"
                        placeholder="Search projects…"
                        className={BASE_INPUT_CLASS}
                        disabled={Boolean(editingId)}
                      />
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <WorkTrackSelect
                            label="Choose a project"
                            value={projectChoice}
                            onChange={handleProjectSelect}
                            options={projectOptions}
                            placeholder="Select a project"
                            disabled={Boolean(editingId) || !activeTeamId}
                          />
                        </div>
                        {selectedProject?.description ? (
                          <button
                            type="button"
                            aria-label="Project description"
                            aria-expanded={showProjectInfo}
                            onClick={() => setShowProjectInfo((value) => !value)}
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#E7E6F0] bg-white text-[#6C45F5] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                          >
                            <Info size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {selectedProject?.description && showProjectInfo ? (
                      <div className="mt-2 rounded-lg border border-[#EEEAF8] bg-white p-2.5 text-xs leading-5 text-[#53506B]">
                        <p className="font-semibold text-[#39364F]">{selectedProject.name}</p>
                        <p className="mt-0.5 text-[#777A91]">{selectedProject.description}</p>
                        {selectedProject.origin === "staff" ? (
                          <p className="mt-1 text-[10px] font-medium text-[#8B7BE8]">
                            Added by {selectedProject.createdByName ?? "staff"}
                            {selectedProject.promotedAt ? " · approved by admin" : " · pending admin review"}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {showAddProject ? (
                      <div className="mt-2 rounded-lg border border-[#CFC8F3] bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-semibold text-[#39364F]">Add a project to {activeTeam?.name ?? "your team"}</h3>
                          <button
                            type="button"
                            onClick={() => setShowAddProject(false)}
                            aria-label="Close add project"
                            className="grid h-7 w-7 place-items-center rounded-md text-[#777A91] hover:bg-[#F7F7FC]"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                          Project name
                          <input
                            value={newProjectName}
                            maxLength={WORKLOG_RULES.taskTitleMaxLength}
                            onChange={(event) => setNewProjectName(event.target.value)}
                            placeholder="e.g. Q4 onboarding revamp"
                            className={INPUT_CLASS}
                          />
                        </label>
                        <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                          Description (optional)
                          <textarea
                            value={newProjectDescription}
                            maxLength={WORKLOG_RULES.descriptionMaxLength}
                            onChange={(event) => setNewProjectDescription(event.target.value)}
                            rows={2}
                            placeholder="What is this project about?"
                            className={`${INPUT_CLASS} resize-y`}
                          />
                        </label>
                        {projectError ? (
                          <p role="alert" className="mt-2 rounded-md bg-[#FDEEEE] px-2 py-1.5 text-[11px] text-[#B43A3A]">
                            {projectError}
                          </p>
                        ) : null}
                        {duplicateProject ? (
                          <div className="mt-2 rounded-md border border-[#F6D99A] bg-[#FFF6E5] p-2 text-[11px] text-[#9A6200]">
                            <p>
                              A project called “{duplicateProject.name}” already exists for this team.
                            </p>
                            <button
                              type="button"
                              onClick={useExistingProject}
                              className="mt-1 inline-flex min-h-7 items-center rounded-md bg-[#F59E0B] px-2 text-[11px] font-semibold text-white hover:bg-[#DB8A08]"
                            >
                              Use existing project
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowAddProject(false)}
                            className="inline-flex min-h-9 items-center rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B] hover:bg-[#F7F7FC]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={addProject}
                            disabled={addingProject}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
                          >
                            <Plus size={13} aria-hidden="true" />
                            {addingProject ? "Adding…" : "Add project"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-xs font-semibold text-[#53506B]">Activity / Subtask</span>
                    <div className="mt-1">
                      <WorkTrackSelect
                        label="Activity or subtask"
                        value={activityChoice}
                        onChange={setActivityChoice}
                        options={activityOptions}
                        placeholder={selectedProject ? "Select an activity" : "Choose a project first"}
                        disabled={!selectedProject}
                      />
                    </div>
                    {selectedProject ? (
                      <div className="mt-2 rounded-lg border border-[#EEEAF2] bg-white p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#53506B]">
                            Subtasks for this project
                          </span>
                          {projectSubtasks.length ? (
                            <span className="text-[10px] font-medium text-[#9A97AD]">
                              {projectSubtasks.length} {projectSubtasks.length === 1 ? "subtask" : "subtasks"}
                            </span>
                          ) : null}
                        </div>
                        {projectSubtasks.length ? (
                          <ul className="mt-1.5 space-y-1">
                            {projectSubtasks.map((subtask) => (
                              <li
                                key={subtask.id}
                                className="flex items-center justify-between gap-2 text-xs text-[#39364F]"
                              >
                                <span className="min-w-0 truncate">{subtask.title}</span>
                                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[#9A97AD]">
                                  {subtask.status}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-[11px] leading-4 text-[#9A97AD]">
                            No subtasks yet — add the pieces of work you will do under this project.
                          </p>
                        )}
                        <div className="mt-2 flex gap-1.5">
                          <input
                            value={newSubtaskTitle}
                            maxLength={WORKLOG_RULES.subtaskTitleMaxLength}
                            onChange={(event) => setNewSubtaskTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addProjectSubtask();
                              }
                            }}
                            placeholder="New subtask name"
                            aria-label="New subtask name"
                            className={`${BASE_INPUT_CLASS} min-h-9 flex-1 text-xs`}
                          />
                          <button
                            type="button"
                            onClick={addProjectSubtask}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-[#CFC8F3] bg-[#F5F1FF] px-2.5 text-[11px] font-semibold text-[#5A3ED0] transition hover:bg-[#EEE7FD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                          >
                            <Plus size={12} aria-hidden="true" />
                            Add
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <label className="block text-xs font-semibold text-[#53506B]">
                    What did you work on during this time?{" "}
                    <span className="font-normal text-[#9A97AD]">(optional)</span>
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      maxLength={WORKLOG_RULES.descriptionMaxLength}
                      placeholder="Describe the work you completed in this period…"
                      className={`${INPUT_CLASS} min-h-[84px] resize-y`}
                    />
                    <span className="mt-1 block text-right text-[10px] font-normal text-[#9A97AD]">
                      {descriptionCount}/{WORKLOG_RULES.descriptionMaxLength}
                    </span>
                  </label>
                </div>
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
                        {showTimeAdjustment ? "Hide overtime" : "Log overtime"}
                      </button>
                    </div>
                    <div className="mt-1.5">
                      <WorkTrackSelect
                        label="Work time"
                        value={timeValue}
                        onChange={handleTimeChange}
                        options={timeOptions}
                        placeholder="Select time"
                        disabled={Boolean(activeBreak)}
                      />
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-[#777A91]">
                      {showTimeAdjustment
                        ? "Overtime — set the start and end below."
                        : selectedSlotLabel
                          ? `Selected ${selectedSlotLabel}.`
                          : slots.length
                            ? "Choose a standard hour or log overtime."
                            : "No standard work slots today. Log overtime to record work."}
                    </p>
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
                      {showEvidenceLink ? "Hide evidence" : "Add evidence (optional)"}
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
