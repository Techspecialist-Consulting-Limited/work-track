import assert from "node:assert/strict";
import test from "node:test";
import { filterEntries, getDaySummary } from "../src/lib/worklog/selectors";
import { buildWorkLogWorkbook } from "../src/lib/worklog/export-xlsx";
import type {
  BreakEntry,
  ClientCategory,
  ClientSubcategory,
  Employee,
  Organisation,
  Task,
  WorkEntry,
  WorkLogDatabase,
} from "../src/lib/worklog/types";

const DAY = "2026-11-06";

function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    name: `Employee ${id}`,
    role: "Engineer",
    department: "Delivery",
    workArrangement: "in_house",
    ...overrides,
  };
}

function organisation(id: string, name: string, kind: Organisation["kind"]): Organisation {
  return {
    id,
    name,
    kind,
    isActive: true,
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:00:00.000Z",
  };
}

function category(id: string, orgId: string, name: string, approvalStatus: ClientCategory["approvalStatus"], isActive = true): ClientCategory {
  return {
    id,
    clientOrganisationId: orgId,
    name,
    approvalStatus,
    isActive,
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:00:00.000Z",
  };
}

function subcategory(
  id: string,
  orgId: string,
  categoryId: string,
  name: string,
  approvalStatus: ClientSubcategory["approvalStatus"],
  isActive = true
): ClientSubcategory {
  return {
    id,
    clientOrganisationId: orgId,
    categoryId,
    name,
    approvalStatus,
    isActive,
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:00:00.000Z",
  };
}

function task(id: string, employeeId: string, teamId: string): Task {
  return {
    id,
    employeeId,
    title: `Task ${id}`,
    teamId,
    currentStatus: "ongoing",
    createdAt: "2026-11-02T08:00:00.000Z",
    updatedAt: "2026-11-02T08:00:00.000Z",
    statusUpdatedAt: "2026-11-02T08:00:00.000Z",
  };
}

function entry(id: string, employeeId: string, startHour: number, endHour: number, overrides: Partial<WorkEntry> = {}): WorkEntry {
  const startAt = `${DAY}T${String(startHour).padStart(2, "0")}:00:00+01:00`;
  const endAt = `${DAY}T${String(endHour).padStart(2, "0")}:00:00+01:00`;
  return {
    id,
    employeeId,
    description: "Did the work",
    startAt,
    endAt,
    workLocation: "office",
    normalMinutes: (endHour - startHour) * 60,
    overtimeMinutes: 0,
    isReportedOvertime: false,
    createdAt: endAt,
    revisions: [],
    ...overrides,
  };
}

function database(): WorkLogDatabase {
  return {
    version: 2,
    employees: [
      employee("emp-1", { name: "In-house Alex", employerOrganisationId: "org-emp", employerOrganisationName: "TechSpecialist Consult Limited" }),
      employee("emp-2", {
        name: "Deployed Sam",
        workArrangement: "client_site",
        employerOrganisationId: "org-emp",
        employerOrganisationName: "TechSpecialist Consult Limited",
        clientOrganisationId: "org-client-a",
        clientOrganisationName: "Client A",
      }),
      employee("emp-3", {
        name: "Other Org Fay",
        workArrangement: "client_site",
        employerOrganisationId: "org-emp-2",
        employerOrganisationName: "Other Employer Ltd",
        clientOrganisationId: "org-client-b",
        clientOrganisationName: "Client B",
      }),
    ],
    organisations: [
      organisation("org-emp", "TechSpecialist Consult Limited", "employer"),
      organisation("org-emp-2", "Other Employer Ltd", "employer"),
      organisation("org-client-a", "Client A", "client"),
      organisation("org-client-b", "Client B", "client"),
    ],
    clientCategories: [
      category("cat-a1", "org-client-a", "Software", "approved"),
      category("cat-a2", "org-client-a", "Hardware", "rejected", false),
      category("cat-b1", "org-client-b", "Software", "approved"),
    ],
    clientSubcategories: [
      subcategory("sub-a1", "org-client-a", "cat-a1", "Microsoft 365 Apps", "approved"),
      subcategory("sub-a2", "org-client-a", "cat-a1", "Legacy Tool", "rejected", false),
      subcategory("sub-b1", "org-client-b", "cat-b1", "Microsoft 365 Apps", "approved"),
    ],
    teams: [
      {
        id: "team-eng",
        name: "Engineering",
        isActive: true,
        isDefault: true,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
      {
        id: "team-ops",
        name: "Operations",
        isActive: true,
        isDefault: false,
        origin: "admin",
        createdAt: "2026-11-01T08:00:00.000Z",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
    ],
    employeeTeams: [
      { id: "et-1", employeeId: "emp-1", teamId: "team-eng", createdAt: "2026-11-01T08:00:00.000Z" },
      { id: "et-2", employeeId: "emp-2", teamId: "team-eng", createdAt: "2026-11-01T08:00:00.000Z" },
      { id: "et-3", employeeId: "emp-3", teamId: "team-ops", createdAt: "2026-11-01T08:00:00.000Z" },
    ],
    projects: [],
    categories: [],
    tasks: [task("task-1", "emp-1", "team-eng")],
    subtasks: [],
    progressUpdates: [
      {
        id: "prog-1",
        taskId: "task-1",
        authorEmployeeId: "emp-1",
        body: "Progress note — not work time",
        createdAt: `${DAY}T11:00:00+01:00`,
        updatedAt: `${DAY}T11:00:00+01:00`,
        revisions: [],
      },
    ],
    entries: [
      entry("e-task", "emp-1", 9, 10, { taskId: "task-1" }),
      entry("e-client", "emp-2", 10, 12, { clientCategoryId: "cat-a1", clientSubcategoryId: "sub-a1", overtimeMinutes: 30, isReportedOvertime: true }),
      entry("e-client-hist", "emp-2", 13, 14, { clientCategoryId: "cat-a2", clientSubcategoryId: "sub-a2" }),
      entry("e-client-b", "emp-3", 9, 11, { clientCategoryId: "cat-b1", clientSubcategoryId: "sub-b1" }),
    ],
    breaks: [
      {
        id: "brk-1",
        employeeId: "emp-2",
        startAt: `${DAY}T12:00:00+01:00`,
        endAt: `${DAY}T13:00:00+01:00`,
        createdAt: `${DAY}T12:00:00+01:00`,
      } satisfies BreakEntry,
    ],
    statusHistory: [],
  };
}

const range = { fromKey: DAY, toKey: DAY };
const ids = (rows: WorkEntry[]) => rows.map((e) => e.id).sort();

test("all organisations is the default and returns every entry", () => {
  const db = database();
  assert.deepEqual(ids(filterEntries(db, { ...range, organisationId: "all" })), ["e-client", "e-client-b", "e-client-hist", "e-task"]);
  assert.deepEqual(ids(filterEntries(db, range)), ["e-client", "e-client-b", "e-client-hist", "e-task"]);
});

test("employer organisation matches in-house and client-site employees alike", () => {
  const db = database();
  assert.deepEqual(
    ids(filterEntries(db, { ...range, organisationId: "org-emp" })),
    ["e-client", "e-client-hist", "e-task"]
  );
  assert.deepEqual(
    ids(filterEntries(db, { ...range, organisationId: "org-emp-2" })),
    ["e-client-b"]
  );
});

test("client organisation matches the assigned client, not the employer", () => {
  const db = database();
  // Deployed Sam appears under both TechSpecialist (employer) and Client A (client).
  assert.deepEqual(
    ids(filterEntries(db, { ...range, organisationId: "org-client-a" })),
    ["e-client", "e-client-hist"]
  );
  assert.deepEqual(
    ids(filterEntries(db, { ...range, organisationId: "org-client-b" })),
    ["e-client-b"]
  );
});

test("category and subcategory filters narrow client-site entries only", () => {
  const db = database();
  assert.deepEqual(ids(filterEntries(db, { ...range, clientCategoryId: "cat-a1" })), ["e-client"]);
  assert.deepEqual(ids(filterEntries(db, { ...range, clientSubcategoryId: "sub-a1" })), ["e-client"]);
  assert.deepEqual(ids(filterEntries(db, { ...range, clientSubcategoryId: "sub-b1" })), ["e-client-b"]);
});

test("rejected and inactive catalogue references remain filterable for history", () => {
  const db = database();
  assert.deepEqual(ids(filterEntries(db, { ...range, clientCategoryId: "cat-a2" })), ["e-client-hist"]);
  assert.deepEqual(ids(filterEntries(db, { ...range, clientSubcategoryId: "sub-a2" })), ["e-client-hist"]);
});

test("combined organisation, category, subcategory and date filters", () => {
  const db = database();
  assert.deepEqual(
    ids(
      filterEntries(db, {
        fromKey: DAY,
        toKey: DAY,
        organisationId: "org-client-a",
        clientCategoryId: "cat-a1",
        clientSubcategoryId: "sub-a1",
      })
    ),
    ["e-client"]
  );
  // Wrong date range excludes everything.
  assert.equal(
    filterEntries(db, {
      fromKey: "2026-11-07",
      toKey: "2026-11-07",
      organisationId: "org-client-a",
      clientCategoryId: "cat-a1",
      clientSubcategoryId: "sub-a1",
    }).length,
    0
  );
  // Category from another client cannot match under Client A.
  assert.equal(
    filterEntries(db, { ...range, organisationId: "org-client-a", clientCategoryId: "cat-b1" }).length,
    0
  );
});

test("task-status filter narrows task entries without dropping client-site entries", () => {
  const db = database();
  // Only task-1 is ongoing; there are no done tasks, so e-task drops out while
  // client entries (which carry no task status) remain.
  assert.deepEqual(
    ids(filterEntries(db, { ...range, taskStatus: "done" })),
    ["e-client", "e-client-b", "e-client-hist"]
  );
  assert.deepEqual(
    ids(filterEntries(db, { ...range, taskStatus: "ongoing" })),
    ["e-client", "e-client-b", "e-client-hist", "e-task"]
  );
});

test("team filter matches client entries through employee team membership", () => {
  const db = database();
  assert.deepEqual(
    ids(filterEntries(db, { ...range, teamId: "team-eng" })),
    ["e-client", "e-client-hist", "e-task"]
  );
  assert.deepEqual(ids(filterEntries(db, { ...range, teamId: "team-ops" })), ["e-client-b"]);
});

test("breaks stay out of work totals and overtime is not double counted", () => {
  const db = database();
  const summary = getDaySummary(db, "emp-2", DAY, new Date("2026-11-06T18:00:00+01:00"));
  // e-client (120) + e-client-hist (60); the 30 OT minutes are inside the 120.
  assert.equal(summary.workMinutes, 180);
  assert.equal(summary.overtimeMinutes, 30);
  assert.equal(summary.reportedOvertimeMinutes, 30);
  assert.equal(summary.breakMinutes, 60);
  assert.equal(summary.entries.length, 2);
  // Progress updates are not entries and contribute nothing.
  assert.equal(summary.entries.some((e) => e.id === "prog-1"), false);
});

test("filtered export reflects organisation and catalogue filters", async () => {
  const db = database();
  const workbook = await buildWorkLogWorkbook(db, {
    ...range,
    organisationId: "org-client-a",
    clientCategoryId: "cat-a1",
    clientSubcategoryId: "sub-a1",
  });
  const log = workbook.getWorksheet("Work Log");
  assert.ok(log);
  // Header + exactly one matching entry.
  assert.equal(log.rowCount, 2);
  const cells = log.getRow(2).values as unknown[];
  assert.equal(cells[2], "Deployed Sam");
  assert.equal(cells[4], "Client A");
  assert.equal(cells[5], "Software");
  assert.equal(cells[6], "Microsoft 365 Apps");

  const overtime = workbook.getWorksheet("Overtime");
  assert.ok(overtime);
  const overtimeHeader = (overtime.getRow(1).values as unknown[]).map(String);
  assert.ok(overtimeHeader.includes("Client"));
  assert.ok(overtimeHeader.includes("Category"));
  assert.ok(overtimeHeader.includes("Subcategory"));
});

test("export without filters keeps in-house project fields populated", async () => {
  const db = database();
  const workbook = await buildWorkLogWorkbook(db, range);
  const log = workbook.getWorksheet("Work Log");
  assert.ok(log);
  assert.equal(log.rowCount, 5);
  const inHouseRow = log.getRow(2).values as unknown[];
  // Task title appears under the Project column for task-linked entries.
  assert.equal(inHouseRow[8], "Task task-1");
});
