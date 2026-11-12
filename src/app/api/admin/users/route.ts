import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, requireConfigAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  employees,
  memberships,
  organisations,
  timeEntries,
  tasks,
  taskProgressUpdates,
} from "@/lib/db/schema";
import { asc, sql } from "drizzle-orm";

export type AdminUser = {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  jobTitle: string;
  department: string;
  isActive: boolean;
  workArrangement: string;
  employerName: string | null;
  clientName: string | null;
  memberships: { role: string; isActive: boolean; isConfigAdmin: boolean }[];
  hasWorkRecords: boolean;
};

export async function GET() {
  await connection();
  try {
    await requireConfigAdmin();
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const [empRows, memberRows, orgRows] = await Promise.all([
    db.select().from(employees).orderBy(asc(employees.fullName)),
    db.select().from(memberships),
    db.select().from(organisations),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const membersByEmp = new Map<string, typeof memberRows>();
  for (const m of memberRows) {
    if (!m.employeeId) continue;
    const list = membersByEmp.get(m.employeeId) ?? [];
    list.push(m);
    membersByEmp.set(m.employeeId, list);
  }

  const empIds = empRows.map((e) => e.id);
  const [entryCounts, taskCounts, progressCounts] = empIds.length
    ? await Promise.all([
        db.select({ employeeId: timeEntries.employeeId, c: sql<number>`count(*)::int` }).from(timeEntries).groupBy(timeEntries.employeeId),
        db.select({ employeeId: tasks.employeeId, c: sql<number>`count(*)::int` }).from(tasks).groupBy(tasks.employeeId),
        db.select({ employeeId: taskProgressUpdates.authorEmployeeId, c: sql<number>`count(*)::int` }).from(taskProgressUpdates).groupBy(taskProgressUpdates.authorEmployeeId),
      ])
    : [[], [], []];
  const recordCount = new Map<string, number>();
  for (const rows of [entryCounts, taskCounts, progressCounts]) {
    for (const row of rows) {
      if (!row.employeeId) continue;
      recordCount.set(row.employeeId, (recordCount.get(row.employeeId) ?? 0) + row.c);
    }
  }

  const list: AdminUser[] = empRows.map((e) => ({
    employeeId: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    jobTitle: e.jobTitle,
    department: e.department,
    isActive: e.isActive,
    workArrangement: e.workArrangement,
    employerName: e.employerOrganisationId ? orgName.get(e.employerOrganisationId) ?? null : null,
    clientName: e.clientOrganisationId ? orgName.get(e.clientOrganisationId) ?? null : null,
    memberships: (membersByEmp.get(e.id) ?? []).map((m) => ({
      role: m.role,
      isActive: m.isActive,
      isConfigAdmin: m.isConfigAdmin,
    })),
    hasWorkRecords: (recordCount.get(e.id) ?? 0) > 0,
  }));
  // Members without an employee link (e.g. chairman) still need visibility.
  const orphanMembers = memberRows.filter((m) => !m.employeeId);
  return NextResponse.json({ users: list, unlinkedMembers: orphanMembers.map((m) => ({ role: m.role, isActive: m.isActive, isConfigAdmin: m.isConfigAdmin })) });
}
