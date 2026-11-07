// Seeds the dev dataset: 5 employees, categories, tasks, subtasks, progress
// updates, status history, work entries and breaks for the exercise window.
// Idempotent — wipes and reseeds worklog tables in a single transaction.
// Memberships are NOT seeded (they require real Microsoft identities — use
// scripts/provision-member.mjs after a first sign-in).
// Usage: node --env-file=.env.local --import tsx scripts/seed.mts
import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildSeedDatabase, SEED_EMPLOYEES } from "../src/lib/worklog/seed";
import { splitIntervalMinutes } from "../src/lib/worklog/time";
import * as schema from "../src/lib/db/schema";

const client = postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  max: 1,
  // The Supabase transaction pooler hangs on pipelined statements.
  max_pipeline: 1,
});
const db = drizzle(client, { schema });

// Deterministic UUIDs so reseeding is stable and demo data is reproducible.
function uuid(seed: string): string {
  const h = createHash("sha256").update(`worktrack-seed:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const data = buildSeedDatabase();
const empUuid = new Map(SEED_EMPLOYEES.map((e) => [e.id, uuid(`emp:${e.id}`)]));
const categoryUuid = new Map(data.categories.map((c) => [c.id, uuid(`category:${c.id}`)]));
const taskUuid = new Map(data.tasks.map((t) => [t.id, uuid(`task:${t.id}`)]));
const subtaskUuid = new Map(data.subtasks.map((s) => [s.id, uuid(`subtask:${s.id}`)]));
const progressUuid = new Map(data.progressUpdates.map((p) => [p.id, uuid(`progress:${p.id}`)]));

async function main() {
  console.log(
    `Seeding ${data.entries.length} entries, ${data.breaks.length} breaks, ${data.tasks.length} tasks, ${data.subtasks.length} subtasks…`
  );

  // One transaction: a failure must never leave a half-wiped database.
  await db.transaction(async (tx) => {
    // Wipe worklog data in dependency order (memberships/settings untouched).
    await tx.delete(schema.taskProgressUpdateRevisions);
    await tx.delete(schema.taskProgressUpdates);
    await tx.delete(schema.subtaskStatusHistory);
    await tx.delete(schema.taskStatusHistory);
    await tx.delete(schema.timeEntries);
    await tx.delete(schema.taskSubtasks);
    await tx.delete(schema.tasks);
    await tx.delete(schema.taskCategories);

    // Employees are upserted, not deleted: memberships reference them.
    for (const e of SEED_EMPLOYEES) {
      const id = empUuid.get(e.id)!;
      await tx
        .insert(schema.employees)
        .values({
          id,
          employeeCode: e.id,
          fullName: e.name,
          jobTitle: e.role,
          department: e.department,
        })
        .onConflictDoUpdate({
          target: schema.employees.id,
          set: {
            employeeCode: e.id,
            fullName: e.name,
            jobTitle: e.role,
            department: e.department,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }

    await tx.insert(schema.taskCategories).values(
      data.categories.map((c) => ({
        id: categoryUuid.get(c.id)!,
        name: c.name,
      }))
    );

    await tx.insert(schema.tasks).values(
      data.tasks.map((t) => ({
        id: taskUuid.get(t.id)!,
        employeeId: empUuid.get(t.employeeId)!,
        categoryId: t.categoryId ? categoryUuid.get(t.categoryId) ?? null : null,
        title: t.title,
        description: t.description ?? null,
        currentStatus: t.currentStatus,
        blockerReason: t.blockerReason ?? null,
        droppedReason: t.droppedReason ?? null,
        completedAt: t.completedAt ? new Date(t.completedAt) : null,
        statusUpdatedAt: new Date(t.statusUpdatedAt),
        managementReview: t.managementReview ?? null,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      }))
    );

    await tx.insert(schema.taskSubtasks).values(
      data.subtasks.map((s) => ({
        id: subtaskUuid.get(s.id)!,
        taskId: taskUuid.get(s.taskId)!,
        title: s.title,
        description: s.description ?? null,
        status: s.status,
        displayOrder: s.displayOrder,
        statusUpdatedAt: new Date(s.statusUpdatedAt),
        completedAt: s.completedAt ? new Date(s.completedAt) : null,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
      }))
    );

    if (data.progressUpdates.length > 0) {
      await tx.insert(schema.taskProgressUpdates).values(
        data.progressUpdates.map((p) => ({
          id: progressUuid.get(p.id)!,
          taskId: taskUuid.get(p.taskId)!,
          subtaskId: p.subtaskId ? subtaskUuid.get(p.subtaskId) ?? null : null,
          authorEmployeeId: empUuid.get(p.authorEmployeeId)!,
          body: p.body,
          editedAt: p.editedAt ? new Date(p.editedAt) : null,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }))
      );
    }

    const revisionRows = data.progressUpdates.flatMap((p) =>
      p.revisions.map((r) => ({
        id: uuid(`revision:${r.id}`),
        progressUpdateId: progressUuid.get(p.id)!,
        previousBody: r.previousBody,
        revisedAt: new Date(r.revisedAt),
        revisionReason: r.revisionReason ?? null,
      }))
    );
    if (revisionRows.length > 0) {
      await tx.insert(schema.taskProgressUpdateRevisions).values(revisionRows);
    }

    const taskHistoryRows = data.statusHistory
      .filter((event) => !event.subtaskId)
      .map((event) => ({
        id: uuid(`task-history:${event.id}`),
        taskId: taskUuid.get(event.taskId)!,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        changeNote: event.changeNote ?? null,
        changedAt: new Date(event.changedAt),
      }));
    if (taskHistoryRows.length > 0) {
      await tx.insert(schema.taskStatusHistory).values(taskHistoryRows);
    }

    const subtaskHistoryRows = data.statusHistory
      .filter((event) => event.subtaskId)
      .map((event) => ({
        id: uuid(`subtask-history:${event.id}`),
        subtaskId: subtaskUuid.get(event.subtaskId!)!,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        changeNote: event.changeNote ?? null,
        changedAt: new Date(event.changedAt),
      }));
    if (subtaskHistoryRows.length > 0) {
      await tx.insert(schema.subtaskStatusHistory).values(subtaskHistoryRows);
    }

    const entryRows = data.entries.map((e) => {
      const split = splitIntervalMinutes(e.startAt, e.endAt);
      const duration = Math.round((new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 60000);
      return {
        id: uuid(`entry:${e.id}`),
        employeeId: empUuid.get(e.employeeId)!,
        entryType: "work" as const,
        taskId: taskUuid.get(e.taskId)!,
        subtaskId: e.subtaskId ? subtaskUuid.get(e.subtaskId) ?? null : null,
        description: e.description,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        durationMinutes: duration,
        normalMinutes: split.normalMinutes,
        overtimeMinutes: split.overtimeMinutes,
        workLocation: e.workLocation === "other" ? null : e.workLocation,
        workType: (split.overtimeMinutes >= duration ? "overtime" : "normal") as "overtime" | "normal",
        isReportedOvertime: e.isReportedOvertime,
        evidenceLink: e.evidenceLink ?? null,
        revisionCount: e.revisions.length,
        createdAt: new Date(e.createdAt),
      };
    });

    for (let i = 0; i < entryRows.length; i += 200) {
      await tx.insert(schema.timeEntries).values(entryRows.slice(i, i + 200));
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
      await tx.insert(schema.timeEntries).values(breakRows.slice(i, i + 200));
    }
  });

  console.log("Seed complete:", {
    employees: SEED_EMPLOYEES.length,
    categories: data.categories.length,
    tasks: data.tasks.length,
    subtasks: data.subtasks.length,
    progressUpdates: data.progressUpdates.length,
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
