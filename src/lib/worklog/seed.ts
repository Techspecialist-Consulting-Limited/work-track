import { splitIntervalMinutes } from "./time";
import type {
  BreakEntry,
  Employee,
  EmployeeTeam,
  ProgressUpdate,
  StatusHistoryEvent,
  Subtask,
  Task,
  TaskCategory,
  TaskStatus,
  Team,
  TeamProject,
  WorkEntry,
  WorkLocation,
  WorkLogDatabase,
} from "./types";
import { getZonedDateParts, zonedDateTimeToDate } from "@/lib/worktrack/schedule-config";

export const SIGNED_IN_EMPLOYEE_ID = "alex";

export const SEED_EMPLOYEES: Employee[] = [
  { id: "alex", name: "Alex Johnson", role: "Software Developer", department: "Engineering", workArrangement: "in_house" },
  { id: "sarah", name: "Sarah Adams", role: "Business Analyst", department: "Product", workArrangement: "in_house" },
  { id: "david", name: "David James", role: "DevOps Engineer", department: "Engineering", workArrangement: "in_house" },
  { id: "esther", name: "Esther Michael", role: "Product Designer", department: "Design", workArrangement: "in_house" },
  { id: "ibrahim", name: "Ibrahim Musa", role: "Customer Support Lead", department: "Support", workArrangement: "in_house" },
];

/** Default categories. Tasks may be uncategorised; the field is optional. */
export const SEED_CATEGORIES: TaskCategory[] = [
  { id: "development", name: "Development" },
  { id: "design", name: "Design" },
  { id: "analysis", name: "Analysis" },
  { id: "operations", name: "Operations" },
  { id: "support", name: "Support" },
  { id: "administration", name: "Administration" },
];

const SEED_TIMESTAMP = "2026-10-26T08:00:00.000Z";

/** One team per department, mirroring the migration's department backfill. */
export const SEED_TEAMS: Team[] = [
  {
    id: "team-engineering",
    name: "Engineering",
    description: "Product engineering, platform and delivery.",
    isActive: true,
    isDefault: false,
    origin: "admin",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "team-product",
    name: "Product",
    description: "Requirements, analysis and stakeholder work.",
    isActive: true,
    isDefault: false,
    origin: "admin",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "team-design",
    name: "Design",
    description: "Product design and design systems.",
    isActive: true,
    isDefault: false,
    origin: "admin",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "team-support",
    name: "Support",
    description: "Customer support and escalations.",
    isActive: true,
    isDefault: false,
    origin: "admin",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

const TEAM_ID_BY_DEPARTMENT = new Map(SEED_TEAMS.map((team) => [team.name, team.id]));

export const SEED_EMPLOYEE_TEAMS: EmployeeTeam[] = SEED_EMPLOYEES.flatMap((employee) => {
  const teamId = TEAM_ID_BY_DEPARTMENT.get(employee.department);
  return teamId
    ? [{ id: `et-${employee.id}-${teamId}`, employeeId: employee.id, teamId, createdAt: SEED_TIMESTAMP }]
    : [];
});

const TASK_TITLES: Record<string, string[]> = {
  alex: ["Login page fixes", "Sprint API integration", "Release checklist"],
  sarah: ["Requirements for billing", "Stakeholder interviews", "Process map review"],
  david: ["Pipeline hardening", "Staging environment", "Monitoring alerts"],
  esther: ["Onboarding flow redesign", "Design system tokens", "Usability notes"],
  ibrahim: ["Ticket backlog triage", "Customer escalation playbook", "Weekly support report"],
};

const TASK_CATEGORIES: Record<string, string[]> = {
  alex: ["development", "development", "operations"],
  sarah: ["analysis", "analysis", "administration"],
  david: ["operations", "operations", "development"],
  esther: ["design", "design", "analysis"],
  ibrahim: ["support", "support", "administration"],
};

const DESCRIPTIONS = [
  "Worked through the open items and updated the team.",
  "Reviewed feedback and made the agreed changes.",
  "Investigated the issue and documented the findings.",
  "Met with the team to agree the next steps.",
  "Built and tested the change locally.",
  "Prepared the update for the weekly review.",
];

const SUBTASK_TITLES = [
  ["Reproduce the reported issue", "Ship the fix and confirm"],
  ["Collect the required inputs", "Review with the owner"],
];

/** Exercise window: Mon 26 Oct 2026 to Fri 6 Nov 2026 (Lagos calendar days). */
const WINDOW_START = { year: 2026, month: 10, day: 26 };
const WINDOW_END = { year: 2026, month: 11, day: 6 };
/** Alex has no entries on this day, so the empty State A shows. */
const OPEN_DAY = { employeeId: SIGNED_IN_EMPLOYEE_ID, month: 11, day: 4 };

export const EXERCISE_START = WINDOW_START;
export const EXERCISE_END = WINDOW_END;

type CalendarDay = { year: number; month: number; day: number };

function calendarDays(): CalendarDay[] {
  const days: CalendarDay[] = [];
  let cursor = Date.UTC(WINDOW_START.year, WINDOW_START.month - 1, WINDOW_START.day);
  const end = Date.UTC(WINDOW_END.year, WINDOW_END.month - 1, WINDOW_END.day);
  while (cursor <= end) {
    const d = new Date(cursor);
    days.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    cursor += 86_400_000;
  }
  return days;
}

function lagosIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return zonedDateTimeToDate(year, month, day, hour, minute).toISOString();
}

interface EmployeeWork {
  tasks: Task[];
  subtasks: Subtask[];
  progressUpdates: ProgressUpdate[];
  statusHistory: StatusHistoryEvent[];
}

/**
 * Builds a realistic task graph: one ongoing task, one blocked task and one Done
 * task per employee, each with subtasks, a progress update and status history.
 */
function buildEmployeeWork(employee: Employee): EmployeeWork {
  const titles = TASK_TITLES[employee.id] ?? [];
  const categories = TASK_CATEGORIES[employee.id] ?? [];
  const createdAt = lagosIso(WINDOW_START.year, WINDOW_START.month, WINDOW_START.day, 9, 0);
  const progressAt = lagosIso(WINDOW_START.year, WINDOW_START.month, WINDOW_START.day, 16, 0);
  const finishedAt = lagosIso(2026, 10, 30, 17, 0);
  const blockedAt = lagosIso(2026, 10, 27, 14, 0);

  const tasks: Task[] = [];
  const subtasks: Subtask[] = [];
  const progressUpdates: ProgressUpdate[] = [];
  const statusHistory: StatusHistoryEvent[] = [];

  titles.forEach((title, index) => {
    const taskId = `${employee.id}-task-${index + 1}`;
    const status: TaskStatus = index === 0 ? "ongoing" : index === 1 ? "blocked" : "done";
    const categoryId = categories[index];
    const category = SEED_CATEGORIES.find((item) => item.id === categoryId);

    const terminalAt = status === "done" ? finishedAt : status === "blocked" ? blockedAt : createdAt;
    const task: Task = {
      id: taskId,
      employeeId: employee.id,
      title,
      description: DESCRIPTIONS[index % DESCRIPTIONS.length],
      categoryId: category?.id,
      categoryName: category?.name,
      currentStatus: status,
      createdAt,
      updatedAt: terminalAt,
      statusUpdatedAt: terminalAt,
    };
    if (status === "blocked") task.blockerReason = "Waiting for access to the staging server.";
    if (status === "done") {
      task.completedAt = finishedAt;
      if (index === 2 && employee.id !== SIGNED_IN_EMPLOYEE_ID) {
        task.managementReview = {
          status: "accepted",
          note: "Clear result. Thanks.",
          reviewedAt: lagosIso(2026, 10, 31, 10, 0),
        };
      }
    }
    tasks.push(task);

    statusHistory.push({
      id: `${taskId}-history-created`,
      taskId,
      previousStatus: null,
      newStatus: "ongoing",
      changedAt: createdAt,
    });
    if (status !== "ongoing") {
      statusHistory.push({
        id: `${taskId}-history-${status}`,
        taskId,
        previousStatus: "ongoing",
        newStatus: status,
        changeNote:
          status === "blocked"
            ? "Waiting for access to the staging server."
            : "All subtasks finished; task closed.",
        changedAt: terminalAt,
      });
    }

    // Subtasks are independent: a blocked parent can still have finished work.
    const subtaskStatuses: TaskStatus[] =
      status === "done" ? ["done", "done"] : status === "blocked" ? ["done", "blocked"] : ["done", "ongoing"];
    const subtaskTitles = SUBTASK_TITLES[index % SUBTASK_TITLES.length];
    subtaskStatuses.forEach((subtaskStatus, subtaskIndex) => {
      const subtaskId = `${taskId}-sub-${subtaskIndex + 1}`;
      const subtaskCreated = createdAt;
      const subtaskChanged =
        subtaskStatus === "ongoing"
          ? subtaskCreated
          : subtaskStatus === "blocked"
            ? blockedAt
            : lagosIso(2026, 10, 29, 15, 0);
      subtasks.push({
        id: subtaskId,
        taskId,
        title: subtaskTitles[subtaskIndex],
        description:
          subtaskIndex === 0 ? "First step of the deliverable." : "Finish and confirm the deliverable.",
        status: subtaskStatus,
        displayOrder: subtaskIndex,
        createdAt: subtaskCreated,
        updatedAt: subtaskChanged,
        statusUpdatedAt: subtaskChanged,
        completedAt: subtaskStatus === "done" ? subtaskChanged : undefined,
      });
      statusHistory.push({
        id: `${subtaskId}-history-created`,
        taskId,
        subtaskId,
        previousStatus: null,
        newStatus: "ongoing",
        changedAt: subtaskCreated,
      });
      if (subtaskStatus !== "ongoing") {
        statusHistory.push({
          id: `${subtaskId}-history-${subtaskStatus}`,
          taskId,
          subtaskId,
          previousStatus: "ongoing",
          newStatus: subtaskStatus,
          changeNote: subtaskStatus === "blocked" ? "Blocked on access." : "Completed and verified.",
          changedAt: subtaskChanged,
        });
      }
    });

    const progressId = `${taskId}-progress-1`;
    const progress: ProgressUpdate = {
      id: progressId,
      taskId,
      authorEmployeeId: employee.id,
      authorName: employee.name,
      body:
        status === "done"
          ? "All subtasks finished and the result was reviewed with the team."
          : status === "blocked"
            ? "First subtask is complete. The remaining work is waiting on staging access."
            : "Started on the first subtask and logged the findings for the team.",
      createdAt: progressAt,
      updatedAt: progressAt,
      revisions: [],
    };
    // Demonstrate append-only editing history without losing the earlier body.
    if (employee.id === SIGNED_IN_EMPLOYEE_ID && index === 0) {
      const editedAt = lagosIso(2026, 10, 28, 10, 0);
      progress.revisions.push({
        id: `${progressId}-rev-1`,
        progressUpdateId: progressId,
        previousBody: "Started looking into the reported issue.",
        revisedByName: employee.name,
        revisedAt: editedAt,
        revisionReason: "Added the outcome of the first review.",
      });
      progress.editedAt = editedAt;
      progress.editedByName = employee.name;
      progress.updatedAt = editedAt;
    }
    progressUpdates.push(progress);
  });

  return { tasks, subtasks, progressUpdates, statusHistory };
}

function buildEntry(
  employeeId: string,
  key: string,
  task: Task,
  startAt: string,
  endAt: string,
  workLocation: WorkLocation,
  descriptionIndex: number,
  subtaskId?: string
): WorkEntry {
  const split = splitIntervalMinutes(startAt, endAt);
  return {
    id: `${employeeId}-entry-${key}`,
    employeeId,
    taskId: task.id,
    subtaskId,
    description: DESCRIPTIONS[descriptionIndex % DESCRIPTIONS.length],
    startAt,
    endAt,
    workLocation,
    normalMinutes: split.normalMinutes,
    overtimeMinutes: split.overtimeMinutes,
    isReportedOvertime: false,
    createdAt: startAt,
    revisions: [],
  };
}

export function buildSeedDatabase(): WorkLogDatabase {
  const entries: WorkEntry[] = [];
  const breaks: BreakEntry[] = [];
  const tasks: Task[] = [];
  const subtasks: Subtask[] = [];
  const progressUpdates: ProgressUpdate[] = [];
  const statusHistory: StatusHistoryEvent[] = [];
  const projects: TeamProject[] = [];
  const days = calendarDays();
  const lastWorkingDay = days.filter((d) => isWorkingDay(d)).at(-1);

  for (const employee of SEED_EMPLOYEES) {
    const work = buildEmployeeWork(employee);
    tasks.push(...work.tasks);
    subtasks.push(...work.subtasks);
    progressUpdates.push(...work.progressUpdates);
    statusHistory.push(...work.statusHistory);
    const employeeTasks = work.tasks;
    const subtasksByTask = new Map<string, Subtask[]>();
    for (const subtask of work.subtasks) {
      const list = subtasksByTask.get(subtask.taskId) ?? [];
      list.push(subtask);
      subtasksByTask.set(subtask.taskId, list);
    }
    const offset = employee.id.length;

    for (const { year, month, day } of days) {
      if (!isWorkingDay({ year, month, day })) {
        if ((day + offset) % 3 === 0) {
          // Hourly entries, matching the staff logging grid.
          [[10, 11], [11, 12]].forEach(([sh, eh], i) => {
            entries.push(
              buildEntry(
                employee.id,
                `${month}-${day}-weekend-${i}`,
                employeeTasks[0],
                lagosIso(year, month, day, sh, 0),
                lagosIso(year, month, day, eh, 0),
                "home",
                day + i,
                subtasksByTask.get(employeeTasks[0].id)?.[0]?.id
              )
            );
          });
        }
        continue;
      }
      if (employee.id === OPEN_DAY.employeeId && month === OPEN_DAY.month && day === OPEN_DAY.day) continue;

      const isLastDay = lastWorkingDay !== undefined && lastWorkingDay.month === month && lastWorkingDay.day === day;
      // Hourly slots on the staff grid: 09–12 morning, 14–17 afternoon.
      // The last working day stops at lunch so the afternoon is still open.
      const usedSlots: Array<[number, number]> = isLastDay
        ? [[9, 10], [10, 11], [11, 12]]
        : [[9, 10], [10, 11], [11, 12], [14, 15], [15, 16], [16, 17]];

      breaks.push({
        id: `${employee.id}-break-${month}-${day}`,
        employeeId: employee.id,
        startAt: lagosIso(year, month, day, 13, 0),
        endAt: lagosIso(year, month, day, 14, 0),
        createdAt: lagosIso(year, month, day, 13, 0),
      });

      usedSlots.forEach(([sh, eh], slotIndex) => {
        // Morning stays on the primary task; afternoon rotates through the task list.
        const task =
          slotIndex < 3
            ? employeeTasks[0]
            : employeeTasks[(day + slotIndex + offset) % employeeTasks.length];
        const location: WorkLocation = (day + slotIndex + offset) % 3 === 0 ? "home" : "office";
        // Link some entries to a subtask so reports exercise the optional link.
        const subtask = slotIndex % 2 === 0 ? undefined : subtasksByTask.get(task.id)?.[0];
        entries.push(
          buildEntry(
            employee.id,
            `${month}-${day}-${slotIndex}`,
            task,
            lagosIso(year, month, day, sh, 0),
            lagosIso(year, month, day, eh, 0),
            location,
            day + slotIndex,
            subtask?.id
          )
        );
      });

      if ((day + offset) % 3 === 0 && !isLastDay) {
        entries.push(
          buildEntry(
            employee.id,
            `${month}-${day}-evening`,
            employeeTasks[1],
            lagosIso(year, month, day, 17, 0),
            lagosIso(year, month, day, 18, 0),
            "office",
            day
          )
        );
      }
    }
  }

  // Project library: one catalog project per distinct task title within a team.
  const departmentByEmployee = new Map(SEED_EMPLOYEES.map((employee) => [employee.id, employee.department]));
  for (const task of tasks) {
    const department = departmentByEmployee.get(task.employeeId) ?? "";
    const teamId = TEAM_ID_BY_DEPARTMENT.get(department);
    if (!teamId) continue;
    const name = task.title;
    let project = projects.find(
      (candidate) =>
        candidate.teamId === teamId && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (!project) {
      project = {
        id: `project-${teamId}-${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        teamId,
        name,
        description: task.description,
        isActive: true,
        origin: "admin",
        promotedAt: SEED_TIMESTAMP,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      };
      projects.push(project);
    }
    task.teamId = teamId;
    task.projectId = project.id;
  }

  return {
    version: 2,
    employees: SEED_EMPLOYEES,
    organisations: [],
    clientCategories: [],
    clientSubcategories: [],
    teams: SEED_TEAMS,
    employeeTeams: SEED_EMPLOYEE_TEAMS,
    projects,
    categories: SEED_CATEGORIES,
    tasks,
    subtasks,
    progressUpdates,
    entries,
    breaks,
    statusHistory,
  };
}

function isWorkingDay({ year, month, day }: CalendarDay): boolean {
  const weekday = getZonedDateParts(zonedDateTimeToDate(year, month, day, 12, 0)).weekday;
  return weekday >= 1 && weekday <= 5;
}
