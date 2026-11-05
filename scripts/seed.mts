// Seeds the dev dataset: 5 employees, tasks, work entries and breaks for the
// exercise window. Idempotent — wipes and reseeds worklog tables.
// Memberships are NOT seeded (they require real Microsoft identities — use
// scripts/provision-member.mjs after a first sign-in).
// Usage: node --env-file=.env.local --import tsx scripts/seed.mts
import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildSeedDatabase, SEED_EMPLOYEES } from "../src/lib/worklog/seed";
import { splitIntervalMinutes } from "../src/lib/worklog/time";
import * as schema from "../src/lib/db/schema";

const client = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const db = drizzle(client, { schema });

// Deterministic UUIDs so reseeding is stable and demo data is reproducible.
function uuid(seed: string): string {
  const h = createHash("sha256").update(`worktrack-seed:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const data = buildSeedDatabase();
const empUuid = new Map(SEED_EMPLOYEES.map((e) => [e.id, uuid(`emp:${e.id}`)]));
const taskUuid = new Map(data.tasks.map((t) => [t.id, uuid(`task:${t.id}`)]));

async function main() {
  console.log(`Seeding ${data.entries.length} entries, ${data.breaks.length} breaks, ${data.tasks.length} tasks…`);

  // Wipe worklog data (memberships/settings untouched).
  await db.delete(schema.timeEntries);
  await db.delete(schema.taskStatusHistory);
  await db.delete(schema.tasks);
  await db.delete(schema.employees);

  await db.insert(schema.employees).values(
    SEED_EMPLOYEES.map((e) => ({
      id: empUuid.get(e.id)!,
      employeeCode: e.id,
      fullName: e.name,
      jobTitle: e.role,
      department: e.department,
    }))
  );

  await db.insert(schema.tasks).values(
    data.tasks.map((t) => ({
      id: taskUuid.get(t.id)!,
      employeeId: empUuid.get(t.employeeId)!,
      title: t.title,
      currentStatus: t.currentStatus,
      blockerReason: t.blockerReason ?? null,
      completedAt: t.completedAt ? new Date(t.completedAt) : null,
      managementReview: t.managementReview ?? null,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.createdAt),
    }))
  );

  const entryRows = data.entries.map((e) => {
    const split = splitIntervalMinutes(e.startAt, e.endAt);
    const duration = Math.round((new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 60000);
    return {
      id: uuid(`entry:${e.id}`),
      employeeId: empUuid.get(e.employeeId)!,
      entryType: "work" as const,
      taskId: taskUuid.get(e.taskId)!,
      description: e.description,
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      durationMinutes: duration,
      normalMinutes: split.normalMinutes,
      overtimeMinutes: split.overtimeMinutes,
      workLocation: e.workLocation === "other" ? null : e.workLocation,
      workType: (split.overtimeMinutes >= duration ? "overtime" : "normal") as "overtime" | "normal",
      taskStatusSnapshot: e.statusAtEntry,
      isReportedOvertime: e.isReportedOvertime,
      evidenceLink: e.evidenceLink ?? null,
      revisionCount: e.revisions.length,
      createdAt: new Date(e.createdAt),
    };
  });

  for (let i = 0; i < entryRows.length; i += 200) {
    await db.insert(schema.timeEntries).values(entryRows.slice(i, i + 200));
  }

  const breakRows = data.breaks.map((b) => ({
    id: uuid(`break:${b.id}`),
    employeeId: empUuid.get(b.employeeId)!,
    entryType: "break" as const,
    startAt: new Date(b.startAt),
    endAt: b.endAt ? new Date(b.endAt) : null,
    durationMinutes: b.endAt
      ? Math.round((new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000)
      : null,
    createdAt: new Date(b.createdAt),
  }));
  for (let i = 0; i < breakRows.length; i += 200) {
    await db.insert(schema.timeEntries).values(breakRows.slice(i, i + 200));
  }

  console.log("Seed complete:", {
    employees: SEED_EMPLOYEES.length,
    tasks: data.tasks.length,
    workEntries: data.entries.length,
    breaks: data.breaks.length,
  });
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
