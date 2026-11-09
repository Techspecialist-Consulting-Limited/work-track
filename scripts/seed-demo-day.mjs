// Seeds the 2026-11-09 demo day for the staff employee (Abbas Taofeeq).
// Idempotent: skips records that already exist. Dev/demo use only.
// Usage: node --env-file=.env.local scripts/seed-demo-day.mjs [--apply]
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const DAY = "2026-11-09";
const TZ_OFFSET = "+01:00"; // Africa/Lagos, no DST
const at = (hhmm) => `${DAY}T${hhmm}:00${TZ_OFFSET}`;

const sql = postgres(process.env.DATABASE_URL, { max_pipeline: 1 });

const STAFF_MEMBERSHIP = "67d027ab-aaa3-4616-b9da-705c050edefc";
const EMPLOYEE_ID = "e6fefa21-1c6c-4999-8031-7327de16d156";

const TASKS = [
  {
    title: "WorkTrack Staff Interface Refinement",
    description: "Improve the staff work-logging experience, task creation process and progress management interface.",
    status: "ongoing",
    subtasks: [
      { title: "Desktop form layout redesign", status: "done" },
      { title: "Task and progress update workflow", status: "ongoing" },
    ],
    progress: "The desktop form has been reorganised. The task description and work description are now separated, while progress updates are being moved into individual task actions.",
  },
  {
    title: "ICE 2.0 Incident Management Portal",
    description: "Improve the incident reporting, management and resolution workflows within the ICE 2.0 platform.",
    status: "ongoing",
    subtasks: [
      { title: "Incident intake requirements", status: "done" },
      { title: "Incident workflow validation", status: "ongoing" },
    ],
    progress: "Incident intake requirements have been reviewed, and validation of the incident management workflow is ongoing.",
  },
  {
    title: "NEXUS Reporting System Enhancements",
    description: "Improve the reporting system's data processing, report generation and export functionality.",
    status: "done",
    subtasks: [
      { title: "Reporting API integration", status: "done" },
      { title: "Excel export validation", status: "done" },
    ],
    progress: "Reporting API integration and Excel export validation have been completed successfully.",
  },
  {
    title: "TechSpecialist Website Case Studies Update",
    description: "Refresh the website's case studies and improve how completed projects are presented.",
    status: "ongoing",
    subtasks: [{ title: "Case study content refresh", status: "ongoing" }],
    progress: "Case study content has been updated, and the final content review is ongoing.",
  },
];

const ENTRIES = [
  ["09:00", "10:00", 0, 0, "office", "Reorganised the staff input fields into a clearer layout."],
  ["10:00", "11:00", 0, 1, "office", "Worked on separating progress updates from hourly work entries."],
  ["11:00", "12:00", 1, 0, "office", "Reviewed the incident reporting requirements and fields."],
  ["13:00", "14:00", 1, 1, "office", "Tested the incident management workflow and identified improvements."],
  ["14:00", "15:00", 2, 0, "home", "Validated the reporting API and data retrieval functionality."],
  ["15:00", "16:00", 2, 1, "home", "Tested report exports and verified the generated records."],
  ["16:00", "17:00", 3, 0, "home", "Updated website case study content and reviewed its presentation."],
];

async function main() {
  const employee = await sql`select id, full_name from employees where id = ${EMPLOYEE_ID}`;
  if (employee.length !== 1) throw new Error("Staff employee not found");
  console.log(`Employee: ${employee[0].full_name} (${EMPLOYEE_ID})`);

  const existingTasks = await sql`
    select id, title from tasks where employee_id = ${EMPLOYEE_ID} and title = any(${TASKS.map((t) => t.title)})`;
  const existingEntries = await sql`
    select id from time_entries
    where employee_id = ${EMPLOYEE_ID} and entry_type = 'work' and voided_at is null
      and start_at >= ${`${DAY}T00:00:00${TZ_OFFSET}`} and start_at < ${`2026-11-10T00:00:00${TZ_OFFSET}`}`;
  const existingBreaks = await sql`
    select id from time_entries
    where employee_id = ${EMPLOYEE_ID} and entry_type = 'break' and voided_at is null
      and start_at >= ${`${DAY}T00:00:00${TZ_OFFSET}`} and start_at < ${`2026-11-10T00:00:00${TZ_OFFSET}`}`;

  console.log(`Existing: ${existingTasks.length} matching tasks, ${existingEntries.length} work entries, ${existingBreaks.length} breaks on ${DAY}`);
  if (!APPLY) {
    console.log("Dry run — pass --apply to insert.");
    await sql.end();
    return;
  }
  if (existingEntries.length > 0 || existingBreaks.length > 0) {
    console.log("Records for this day already exist — nothing to do.");
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    const taskIds = [];
    const subtaskIdsByTask = [];
    for (const def of TASKS) {
      const [task] = await tx`
        insert into tasks (employee_id, title, description, current_status, completed_at, status_updated_at, created_by_membership_id, created_at, updated_at)
        values (${EMPLOYEE_ID}, ${def.title}, ${def.description}, ${def.status},
                ${def.status === "done" ? at("17:00") : null}, ${at("09:00")}, ${STAFF_MEMBERSHIP}, ${at("08:30")}, ${at("17:00")})
        returning id`;
      taskIds.push(task.id);
      const subIds = [];
      for (let i = 0; i < def.subtasks.length; i += 1) {
        const sub = def.subtasks[i];
        const [row] = await tx`
          insert into task_subtasks (task_id, title, status, display_order, status_updated_at, completed_at, created_by_membership_id, created_at, updated_at)
          values (${task.id}, ${sub.title}, ${sub.status}, ${i}, ${at("09:00")},
                  ${sub.status === "done" ? at("12:00") : null}, ${STAFF_MEMBERSHIP}, ${at("08:30")}, ${at("17:00")})
          returning id`;
        subIds.push(row.id);
        if (sub.status !== "ongoing") {
          await tx`
            insert into subtask_status_history (subtask_id, previous_status, new_status, changed_by_membership_id, changed_at)
            values (${row.id}, 'ongoing', ${sub.status}, ${STAFF_MEMBERSHIP}, ${at("12:00")})`;
        }
      }
      subtaskIdsByTask.push(subIds);
      if (def.status !== "ongoing") {
        await tx`
          insert into task_status_history (task_id, previous_status, new_status, changed_by_membership_id, changed_at)
          values (${task.id}, 'ongoing', ${def.status}, ${STAFF_MEMBERSHIP}, ${at("16:00")})`;
      }
      await tx`
        insert into task_progress_updates (task_id, subtask_id, author_employee_id, body, created_at, updated_at)
        values (${task.id}, null, ${EMPLOYEE_ID}, ${def.progress}, ${at("16:30")}, ${at("16:30")})`;
    }

    for (const [start, end, taskIdx, subIdx, location, description] of ENTRIES) {
      const subtaskId = subtaskIdsByTask[taskIdx][subIdx];
      await tx`
        insert into time_entries (employee_id, entry_type, task_id, subtask_id, description, start_at, end_at,
          duration_minutes, normal_minutes, overtime_minutes, work_location, work_type, is_reported_overtime,
          created_by_membership_id, created_at, updated_at)
        values (${EMPLOYEE_ID}, 'work', ${taskIds[taskIdx]}, ${subtaskId}, ${description},
          ${at(start)}, ${at(end)}, 60, 60, 0, ${location}, 'normal', false, ${STAFF_MEMBERSHIP}, ${at(start)}, ${at(end)})`;
    }

    await tx`
      insert into time_entries (employee_id, entry_type, description, start_at, end_at, duration_minutes,
        created_by_membership_id, created_at, updated_at)
      values (${EMPLOYEE_ID}, 'break', 'Lunch break', ${at("12:00")}, ${at("13:00")}, 60,
        ${STAFF_MEMBERSHIP}, ${at("12:00")}, ${at("13:00")})`;
  });

  console.log("Inserted: 4 tasks, 7 subtasks, 4 progress updates, 7 work entries, 1 break.");
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
