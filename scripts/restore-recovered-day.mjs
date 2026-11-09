// Idempotent restore of the recoverable 2026-11-06 activity for Abbas Taofeeq
// and Rebecca Peter Edim, rebuilt from audit_events (recovered-data.txt).
//
// Usage:
//   node --env-file=.env.local scripts/restore-recovered-day.mjs            # dry run (rolls back)
//   node --env-file=.env.local scripts/restore-recovered-day.mjs --apply    # commit
//
// The whole import runs in one transaction and is validated before commit.
// Re-running is a no-op: recovery_imports.import_key makes it idempotent and
// recovery_import_records preserves every original source id.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const SOURCE_FILE =
  process.env.RECOVERY_SOURCE ?? "C:\\Users\\Tofee\\Downloads\\recovered-data.txt";
const DAY = "2026-11-06";
const TIMEZONE = "Africa/Lagos";

const ABBAS = {
  employeeId: "e6fefa21-1c6c-4999-8031-7327de16d156",
  fullName: "Abbas Taofeeq",
  membershipId: "7923d29e-62f9-482b-a630-c171ac94b6fd",
};
const REBECCA = {
  employeeId: "a39d1178-23a7-4a20-a7fe-4cade4b5ee89",
  fullName: "Rebecca Peter Edim",
  membershipId: "cbaeb64d-d515-4e87-9a4b-365b410462c6",
};
const PEOPLE = [ABBAS, REBECCA];
const MEMBERS = new Map(PEOPLE.map((p) => [p.employeeId, p]));

// Decision: Abbas' two identically titled tasks are one canonical task.
const CANONICAL_TASK = "df84dded-64e8-4295-a10d-55ef8d565d53";
const ALIAS_TASK = "3c4d84e2-9303-4d6e-b01d-d4b96cc3a663";
const REBECCA_PARENT_TASK = "de80ec20-a769-46a3-b62b-d5870762171a";
const ABBAS_LAYOUT_TASK = "cc879973-9352-4fa9-a5e8-81b4295393c8";
const REBECCA_OPERATIONS = [
  "c80a5569-9a55-4da6-ba42-f0f0a0842af5",
  "b6473593-120b-47da-988b-8a1ed598cfb8",
];
const BREAK_ID = "77c7830c-42ad-4202-8196-7dd5876b494c";

// Authorised provisional placeholders: the parent title has three clauses and
// no subtask record survived. No descriptions, statuses or entry mappings.
const PROVISIONAL_SUBTASKS = [
  "HR & Administrative Operations",
  "Asset Management",
  "Operational Coordination",
];

const EXPECTED_TASK_IDS = new Set([
  ...REBECCA_OPERATIONS,
  CANONICAL_TASK,
  ALIAS_TASK,
  ABBAS_LAYOUT_TASK,
  REBECCA_PARENT_TASK,
]);
const EXPECTED_ENTRY_IDS = new Set([
  "a18f7081-3840-46eb-b859-014ef5af6121",
  "b63abc6b-bfd1-4b69-9550-5d519d900564",
  "219ec453-bb27-4570-96d3-5f27430e8fda",
  "ba41fa3b-a2d1-432e-8594-5eb1659d4fad",
  "0ad97453-e95c-4731-b76f-a27bec276d22",
  "ffe91002-982d-4d47-83f9-a93a0dd8c18c",
  "94183d1d-53de-414f-a489-38ef1a6af676",
  "bfb4a6c0-95d7-443a-86b2-3a878ab71e30",
]);
const EXPECTED_VOIDED_IDS = new Set([
  "e3e804fc-3659-4a58-871f-ccee4aefc9e2",
  "a127e4f2-733a-4999-aaab-42cf3ede884a",
  "1a8f774e-1b7d-44f8-8fb8-8b6f3c9578ab",
  "bb6cf16f-41a6-432a-ab73-4ab40a822979",
  "e991dfde-265b-49d4-b381-65d0cb082813",
  "a7706a0b-9cb9-4c6b-b78b-66403eda134f",
]);

const apply = process.argv.includes("--apply");

function fail(message) {
  throw new Error(`VALIDATION FAILED: ${message}`);
}

function uuidv5(name) {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const digest = createHash("sha1")
    .update(namespace)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function iso(value) {
  return new Date(value).toISOString();
}

function minutesBetween(startAt, endAt) {
  return Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
}

function taskTargetId(sourceId) {
  return sourceId === ALIAS_TASK ? CANONICAL_TASK : sourceId;
}

async function loadSource() {
  const raw = await readFile(SOURCE_FILE);
  const text = raw.toString("utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(text);
  return { data, sha256: createHash("sha256").update(raw).digest("hex") };
}

function validateSource(data) {
  if (data.exportedAt !== "2026-11-07T18:25:37.591Z") fail("unexpected export timestamp");

  const taskIds = new Set(data.tasks.map((t) => t.id));
  if (taskIds.size !== EXPECTED_TASK_IDS.size) fail("unexpected task count");
  for (const id of EXPECTED_TASK_IDS) {
    if (!taskIds.has(id)) fail(`missing source task ${id}`);
  }
  const entryIds = new Set(data.entries.map((e) => e.id));
  if (entryIds.size !== EXPECTED_ENTRY_IDS.size) fail("unexpected active entry count");
  for (const id of EXPECTED_ENTRY_IDS) {
    if (!entryIds.has(id)) fail(`missing active entry ${id}`);
  }
  const voidedIds = new Set(data.voidedEntries.map((e) => e.id));
  if (voidedIds.size !== EXPECTED_VOIDED_IDS.size) fail("unexpected voided entry count");
  for (const id of EXPECTED_VOIDED_IDS) {
    if (!voidedIds.has(id)) fail(`missing voided entry ${id}`);
  }
  if (data.breaks.length !== 1 || data.breaks[0].id !== BREAK_ID) {
    fail("unexpected break records");
  }

  for (const entry of [...data.entries, ...data.voidedEntries]) {
    const person = MEMBERS.get(entry.employeeId);
    if (!person) fail(`entry ${entry.id} has an unexpected employee`);
    if (!taskIds.has(entry.taskId)) fail(`entry ${entry.id} references an unknown task`);
    if (minutesBetween(entry.startAt, entry.endAt) !== 60) {
      fail(`entry ${entry.id} is not a one-hour block`);
    }
    if (entry.voided && !entry.voidedAt) fail(`voided entry ${entry.id} has no voidedAt`);
    if (!entry.voided && entry.voidedAt) fail(`active entry ${entry.id} carries voidedAt`);
  }

  const a = data.tasks.find((t) => t.id === CANONICAL_TASK);
  const b = data.tasks.find((t) => t.id === ALIAS_TASK);
  if (!a || !b || a.title !== b.title || a.employeeId !== b.employeeId) {
    fail("canonical task pair does not match");
  }
  if (a.employeeId !== ABBAS.employeeId) fail("canonical task belongs to the wrong employee");

  for (const id of REBECCA_OPERATIONS) {
    const task = data.tasks.find((t) => t.id === id);
    if (!task || task.employeeId !== REBECCA.employeeId) {
      fail(`Operations task ${id} does not match Rebecca`);
    }
  }
}

async function verifyIdentities(tx) {
  const employees = await tx`
    select id, full_name, is_active from employees
    where id in ${tx(PEOPLE.map((p) => p.employeeId))}`;
  for (const person of PEOPLE) {
    const row = employees.find((r) => r.id === person.employeeId);
    if (!row) fail(`employee ${person.employeeId} not found`);
    if (row.full_name !== person.fullName) fail(`employee ${person.employeeId} name mismatch`);
    if (!row.is_active) fail(`employee ${person.employeeId} is inactive`);
  }

  const memberships = await tx`
    select id, employee_id, role, is_active from worktrack_memberships
    where id in ${tx(PEOPLE.map((p) => p.membershipId))}`;
  for (const person of PEOPLE) {
    const row = memberships.find((r) => r.id === person.membershipId);
    if (!row) fail(`membership ${person.membershipId} not found`);
    if (row.employee_id !== person.employeeId) fail(`membership ${person.membershipId} mismatch`);
    if (!row.is_active) fail(`membership ${person.membershipId} is inactive`);
  }
}

async function countExisting(tx, taskIds, entryIds) {
  const [{ tasks }] = await tx`
    select count(*)::int as tasks from tasks where id in ${tx(taskIds)}`;
  const [{ entries }] = await tx`
    select count(*)::int as entries from time_entries where id in ${tx(entryIds)}`;
  return { tasks, entries };
}

function buildPlan(data, sourceSha256) {
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const importKey = `recovery-${DAY}-${sourceSha256.slice(0, 16)}`;

  const taskRows = [];
  for (const [sourceId, source] of tasksById) {
    // The alias task is not inserted; its source id is preserved in the mapping.
    if (sourceId === ALIAS_TASK) continue;
    taskRows.push({
      id: sourceId,
      employee_id: source.employeeId,
      category_id: null,
      title: source.title,
      description: null,
      current_status: "ongoing",
      blocker_reason: null,
      dropped_reason: null,
      completed_at: null,
      status_updated_at: iso(source.createdAt),
      management_review: null,
      archived_at: null,
      created_by_membership_id: source.membershipId,
      status_source: "recovery_default",
      details_source: "recovery_default",
      created_at: iso(source.createdAt),
      updated_at: iso(source.createdAt),
    });
  }

  const parent = tasksById.get(REBECCA_PARENT_TASK);
  const subtaskRows = PROVISIONAL_SUBTASKS.map((title, index) => ({
    id: uuidv5(`recovery:${DAY}:subtask:${title.toLowerCase()}`),
    task_id: REBECCA_PARENT_TASK,
    title,
    description: null,
    status: "ongoing",
    display_order: index,
    status_updated_at: iso(parent.createdAt),
    completed_at: null,
    archived_at: null,
    created_by_membership_id: REBECCA.membershipId,
    status_source: "recovery_default",
    details_source: "recovery_provisional",
    created_at: iso(parent.createdAt),
    updated_at: iso(parent.createdAt),
  }));

  const entryRows = [];
  for (const entry of data.entries) {
    entryRows.push({
      id: entry.id,
      employee_id: entry.employeeId,
      entry_type: "work",
      task_id: taskTargetId(entry.taskId),
      subtask_id: null,
      description: null,
      start_at: iso(entry.startAt),
      end_at: iso(entry.endAt),
      duration_minutes: 60,
      normal_minutes: 60,
      overtime_minutes: 0,
      // Location was never recorded. Work type is derived from the shift window.
      work_location: "unknown",
      work_type: "normal",
      evidence_link: null,
      is_reported_overtime: false,
      revision_count: entry.revisions ?? 0,
      created_by_membership_id: entry.membershipId,
      updated_by_membership_id: entry.membershipId,
      voided_at: null,
      void_reason: null,
      created_at: iso(entry.createdAt),
      updated_at: iso(entry.updatedAt),
    });
  }

  for (const entry of data.voidedEntries) {
    entryRows.push({
      id: entry.id,
      employee_id: entry.employeeId,
      entry_type: "work",
      task_id: taskTargetId(entry.taskId),
      subtask_id: null,
      description: null,
      start_at: iso(entry.startAt),
      end_at: iso(entry.endAt),
      duration_minutes: 60,
      normal_minutes: 60,
      overtime_minutes: 0,
      work_location: "unknown",
      work_type: "normal",
      evidence_link: null,
      is_reported_overtime: false,
      revision_count: entry.revisions ?? 0,
      created_by_membership_id: entry.membershipId,
      updated_by_membership_id: entry.membershipId,
      voided_at: iso(entry.voidedAt),
      void_reason: null,
      created_at: iso(entry.createdAt),
      updated_at: iso(entry.updatedAt),
    });
  }

  const dataBreak = data.breaks[0];
  entryRows.push({
    id: dataBreak.id,
    employee_id: dataBreak.employeeId,
    entry_type: "break",
    task_id: null,
    subtask_id: null,
    description: null,
    start_at: iso(dataBreak.startAt),
    end_at: iso(dataBreak.endAt),
    duration_minutes: minutesBetween(dataBreak.startAt, dataBreak.endAt),
    normal_minutes: null,
    overtime_minutes: null,
    work_location: null,
    work_type: null,
    evidence_link: null,
    is_reported_overtime: false,
    revision_count: 0,
    created_by_membership_id: dataBreak.membershipId,
    updated_by_membership_id: dataBreak.membershipId,
    voided_at: null,
    void_reason: null,
    created_at: iso(dataBreak.startAt),
    updated_at: iso(dataBreak.endAt),
  });

  const mappingRows = [];
  for (const source of data.tasks) {
    mappingRows.push({
      entity_type: "task",
      source_id: source.id,
      target_id: taskTargetId(source.id),
      canonical_source_id: taskTargetId(source.id),
      payload: JSON.stringify({
        title: source.title,
        employeeId: source.employeeId,
        createdAt: source.createdAt,
        aliasOf: source.id === ALIAS_TASK ? CANONICAL_TASK : null,
      }),
    });
  }
  for (const row of subtaskRows) {
    mappingRows.push({
      entity_type: "subtask",
      source_id: row.id,
      target_id: row.id,
      canonical_source_id: null,
      payload: JSON.stringify({
        provisional: true,
        derivedFrom: "task title",
        taskId: REBECCA_PARENT_TASK,
        title: row.title,
      }),
    });
  }
  for (const source of [...data.entries, ...data.voidedEntries]) {
    mappingRows.push({
      entity_type: "time_entry",
      source_id: source.id,
      target_id: source.id,
      canonical_source_id: null,
      payload: JSON.stringify({
        originalTaskId: source.taskId,
        mappedTaskId: taskTargetId(source.taskId),
        voided: Boolean(source.voided),
        voidedAt: source.voidedAt ?? null,
      }),
    });
  }
  mappingRows.push({
    entity_type: "time_entry",
    source_id: dataBreak.id,
    target_id: dataBreak.id,
    canonical_source_id: null,
    payload: JSON.stringify({ entryType: "break", employeeId: dataBreak.employeeId }),
  });

  return { importKey, taskRows, subtaskRows, entryRows, mappingRows };
}

async function validateDatabase(tx, plan) {
  const { taskRows, subtaskRows } = plan;

  const active = await tx`
    select employee_id, count(*)::int as entries,
           coalesce(sum(duration_minutes), 0)::int as minutes
    from time_entries
    where entry_type = 'work' and voided_at is null
      and recovery_import_id is not null
    group by employee_id`;
  const byEmployee = new Map(active.map((r) => [r.employee_id, r]));
  const abbas = byEmployee.get(ABBAS.employeeId);
  const rebecca = byEmployee.get(REBECCA.employeeId);
  if (abbas?.entries !== 3 || abbas.minutes !== 180) fail("Abbas active total is not 3 entries / 180 minutes");
  if (rebecca?.entries !== 5 || rebecca.minutes !== 300) fail("Rebecca active total is not 5 entries / 300 minutes");
  if (active.length !== 2) fail("recovery import has entries for unexpected employees");

  const [{ voided }] = await tx`
    select count(*)::int as voided from time_entries
    where recovery_import_id is not null and voided_at is not null`;
  if (voided !== 6) fail(`expected 6 voided entries, found ${voided}`);

  const [{ activeCount }] = await tx`
    select count(*)::int as "activeCount" from time_entries
    where recovery_import_id is not null and voided_at is null and entry_type = 'work'`;
  if (activeCount !== 8) fail(`expected 8 active entries, found ${activeCount}`);

  const [{ breaks }] = await tx`
    select count(*)::int as breaks from time_entries
    where recovery_import_id is not null and entry_type = 'break'`;
  if (breaks !== 1) fail(`expected 1 break, found ${breaks}`);

  const taskEntries = await tx`
    select task_id, count(*)::int as entries from time_entries
    where recovery_import_id is not null and entry_type = 'work' and voided_at is null
    group by task_id`;
  const perTask = new Map(taskEntries.map((r) => [r.task_id, r.entries]));
  if (perTask.get(CANONICAL_TASK) !== 2) fail("canonical Abbas task does not have 2 entries");
  if (perTask.get(REBECCA_PARENT_TASK) !== 5) fail("Rebecca parent task does not have 5 entries");
  if (perTask.get(ABBAS_LAYOUT_TASK) !== 1) fail("Layout task does not have 1 entry");
  for (const id of REBECCA_OPERATIONS) {
    if (perTask.has(id)) fail(`Operations task ${id} unexpectedly has entries`);
  }
  if (perTask.has(ALIAS_TASK)) fail("alias task was inserted as a real task");

  const [{ aliases }] = await tx`
    select count(*)::int as aliases from tasks where id = ${ALIAS_TASK}`;
  if (aliases !== 0) fail("alias task exists as a separate task row");

  const [{ tasks }] = await tx`
    select count(*)::int as tasks from tasks where recovery_import_id is not null`;
  if (tasks !== taskRows.length) fail("task insert count mismatch");

  const [{ subtasks }] = await tx`
    select count(*)::int as subtasks from task_subtasks
    where recovery_import_id is not null and task_id = ${REBECCA_PARENT_TASK}`;
  if (subtasks !== subtaskRows.length) fail("subtask insert count mismatch");

  const [{ mappedEntries }] = await tx`
    select count(*)::int as "mappedEntries" from time_entries
    where recovery_import_id is not null and subtask_id is not null`;
  if (mappedEntries !== 0) fail("a recovered entry was attached to a provisional subtask");

  const [{ unknown }] = await tx`
    select count(*)::int as unknown from time_entries
    where recovery_import_id is not null and entry_type = 'work' and work_location = 'unknown'`;
  if (unknown !== 14) fail(`expected 14 unknown-location work entries, found ${unknown}`);

  const [{ records }] = await tx`
    select count(*)::int as records from recovery_import_records where import_id = ${plan.importId}`;
  if (records !== plan.mappingRows.length) fail("mapping record count mismatch");

  const [{ breakSeconds }] = await tx`
    select extract(epoch from (end_at - start_at))::float8 as "breakSeconds"
    from time_entries where id = ${BREAK_ID}`;
  if (Math.abs(breakSeconds - 58.586) > 0.01) fail(`break duration is ${breakSeconds}s`);

  return {
    staff: 2,
    activeEntries: 8,
    productiveMinutes: 480,
    voidedEntries: 6,
    breakSeconds: Number(breakSeconds.toFixed(3)),
    tasks: taskRows.length,
    subtasks: subtaskRows.length,
    unknownLocationEntries: unknown,
  };
}

async function run(tx, plan, data, sha256) {
  const existing = await tx`
    select id, applied_at from recovery_imports where import_key = ${plan.importKey}`;

  if (existing.length > 0) {
    const importId = existing[0].id;
    const [{ tasks }] = await tx`
      select count(*)::int as tasks from tasks where recovery_import_id = ${importId}`;
    const [{ entries }] = await tx`
      select count(*)::int as entries from time_entries where recovery_import_id = ${importId}`;
    const [{ records }] = await tx`
      select count(*)::int as records from recovery_import_records where import_id = ${importId}`;
    return {
      mode: apply ? "apply" : "dry-run",
      status: "already-applied",
      importId,
      inserted: 0,
      skipped: tasks + entries + records,
      existing: { tasks, entries, records },
    };
  }

  await verifyIdentities(tx);

  const sourceTaskIds = [...EXPECTED_TASK_IDS];
  const sourceEntryIds = [...EXPECTED_ENTRY_IDS, ...EXPECTED_VOIDED_IDS, BREAK_ID];
  const clash = await countExisting(tx, sourceTaskIds, sourceEntryIds);
  if (clash.tasks !== 0 || clash.entries !== 0) {
    fail(`source ids already exist outside this import (tasks=${clash.tasks}, entries=${clash.entries})`);
  }

  const [{ dayEntries }] = await tx`
    select count(*)::int as "dayEntries" from time_entries
    where employee_id in ${tx(PEOPLE.map((p) => p.employeeId))}
      and start_at >= ${`${DAY}T00:00:00+01:00`}
      and start_at < ${`2026-11-07T00:00:00+01:00`}`;
  if (dayEntries !== 0) fail(`target day already has ${dayEntries} entries; refusing to merge`);

  const [importRow] = await tx`
    insert into recovery_imports
      (import_key, source_file, source_sha256, source_exported_at, timezone, summary)
    values (
      ${plan.importKey},
      ${SOURCE_FILE},
      ${sha256},
      ${data.exportedAt},
      ${TIMEZONE},
      ${JSON.stringify({
        day: DAY,
        employees: PEOPLE.map((p) => ({ employeeId: p.employeeId, name: p.fullName })),
        canonicalTask: { id: CANONICAL_TASK, alias: ALIAS_TASK },
        provisionalSubtasks: PROVISIONAL_SUBTASKS,
      })}
    )
    returning id, applied_at`;
  const importId = importRow.id;
  plan.importId = importId;

  await tx`
    insert into tasks ${tx(
      plan.taskRows.map((row) => ({ ...row, recovery_import_id: importId })),
      "id",
      "employee_id",
      "category_id",
      "title",
      "description",
      "current_status",
      "blocker_reason",
      "dropped_reason",
      "completed_at",
      "status_updated_at",
      "management_review",
      "archived_at",
      "created_by_membership_id",
      "status_source",
      "details_source",
      "recovery_import_id",
      "created_at",
      "updated_at"
    )}`;

  await tx`
    insert into task_subtasks ${tx(
      plan.subtaskRows.map((row) => ({ ...row, recovery_import_id: importId })),
      "id",
      "task_id",
      "title",
      "description",
      "status",
      "display_order",
      "status_updated_at",
      "completed_at",
      "archived_at",
      "created_by_membership_id",
      "status_source",
      "details_source",
      "recovery_import_id",
      "created_at",
      "updated_at"
    )}`;

  await tx`
    insert into time_entries ${tx(
      plan.entryRows.map((row) => ({ ...row, recovery_import_id: importId })),
      "id",
      "employee_id",
      "entry_type",
      "task_id",
      "subtask_id",
      "description",
      "start_at",
      "end_at",
      "duration_minutes",
      "normal_minutes",
      "overtime_minutes",
      "work_location",
      "work_type",
      "evidence_link",
      "is_reported_overtime",
      "revision_count",
      "created_by_membership_id",
      "updated_by_membership_id",
      "voided_at",
      "void_reason",
      "recovery_import_id",
      "created_at",
      "updated_at"
    )}`;

  await tx`
    insert into recovery_import_records ${tx(
      plan.mappingRows.map((row) => ({ ...row, import_id: importId })),
      "import_id",
      "entity_type",
      "source_id",
      "target_id",
      "canonical_source_id",
      "payload"
    )}`;

  const totals = await validateDatabase(tx, plan);

  await tx`
    insert into audit_events
      (actor_membership_id, action, entity_type, entity_id, old_values, new_values, request_id)
    values (
      null,
      'recovery.import',
      'recovery_import',
      ${importId},
      null,
      ${JSON.stringify({ day: DAY, sourceSha256: sha256, totals })},
      ${plan.importKey}
    )`;

  return {
    mode: apply ? "apply" : "dry-run",
    status: apply ? "applied" : "validated-rolled-back",
    importId,
    inserted: {
      imports: 1,
      mappingRecords: plan.mappingRows.length,
      tasks: plan.taskRows.length,
      subtasks: plan.subtaskRows.length,
      timeEntries: plan.entryRows.length,
      auditEvents: 1,
    },
    skipped: 0,
    totals,
  };
}

const { data, sha256 } = await loadSource();
validateSource(data);
const plan = buildPlan(data, sha256);

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  max_pipeline: 1,
});

const DRY_RUN = Symbol("dry-run-rollback");

try {
  let report;
  if (apply) {
    report = await sql.begin((tx) => run(tx, plan, data, sha256));
  } else {
    try {
      await sql.begin(async (tx) => {
        report = await run(tx, plan, data, sha256);
        throw DRY_RUN;
      });
    } catch (error) {
      if (error !== DRY_RUN) throw error;
    }
  }
  console.log(JSON.stringify({ source: SOURCE_FILE, sha256, ...report }, null, 2));
  if (!apply) console.log("\nDry run rolled back. Re-run with --apply to commit.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
