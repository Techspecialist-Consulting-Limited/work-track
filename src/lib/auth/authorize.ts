import "server-only";
import { redirect } from "next/navigation";
import { eq, and, or, isNull } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "@/lib/db";
import { employees, memberships } from "@/lib/db/schema";

export type WorkTrackRole = "staff" | "hr" | "chairman";
export type ManagementRole = "hr" | "chairman";

export interface WorkTrackMembership {
  membershipId: string;
  role: WorkTrackRole;
  employeeId: string | null;
  employee: {
    id: string;
    fullName: string;
    jobTitle: string;
    department: string;
    avatarUrl: string | null;
  } | null;
  user: { id: string; name?: string | null; email?: string | null };
}

/** Resolve the signed-in identity to an active WorkTrack membership, or null. */
export async function getMembership(): Promise<WorkTrackMembership | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  const tid = (user as { tid?: string }).tid;
  const oid = (user as { oid?: string }).oid;
  const sessionRole = (user as { role?: string }).role as WorkTrackRole | undefined;
  if (!tid || !oid) return null;

  const rows = await db
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      employeeId: memberships.employeeId,
      employee: {
        id: employees.id,
        fullName: employees.fullName,
        jobTitle: employees.jobTitle,
        department: employees.department,
        avatarUrl: employees.avatarUrl,
      },
    })
    .from(memberships)
    .leftJoin(employees, eq(memberships.employeeId, employees.id))
    .where(
      and(
        eq(memberships.microsoftTenantId, tid),
        eq(memberships.microsoftObjectId, oid),
        sessionRole ? eq(memberships.role, sessionRole) : undefined,
        eq(memberships.isActive, true),
        or(isNull(employees.id), eq(employees.isActive, true))
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.employeeId && !row.employee) return null;

  return {
    membershipId: row.membershipId,
    role: row.role,
    employeeId: row.employeeId,
    employee: row.employeeId ? row.employee : null,
    user: { id: user.id ?? "", name: user.name, email: user.email },
  };
}

export class AuthzError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
  }
}

export async function requireMembership(): Promise<WorkTrackMembership> {
  const membership = await getMembership();
  if (!membership) throw new AuthzError(401, "Authentication required.");
  return membership;
}

export async function requireStaff(): Promise<WorkTrackMembership & { employeeId: string }> {
  const membership = await requireMembership();
  if (membership.role !== "staff" || !membership.employeeId) {
    throw new AuthzError(403, "Staff access requires a staff membership linked to an employee.");
  }
  return membership as WorkTrackMembership & { employeeId: string };
}

export async function requireManagement(): Promise<WorkTrackMembership> {
  const membership = await requireMembership();
  if (membership.role !== "hr" && membership.role !== "chairman") {
    throw new AuthzError(403, "Management access required.");
  }
  return membership;
}

/** Page-level guard: resolves membership and enforces the allowed roles. */
export async function requirePageAccess(
  allowed: WorkTrackRole[]
): Promise<WorkTrackMembership> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const membership = await getMembership();
  if (!membership) redirect("/auth/complete");
  if (!allowed.includes(membership.role)) {
    redirect(membership.role === "staff" ? "/" : "/executive");
  }
  return membership;
}

/** The role the user selected at login — stored in a short-lived signed cookie. */
export const LOGIN_ROLE_COOKIE = "wt_login_role";
export const LOGIN_ROLE_MAX_AGE = 60 * 15; // 15 minutes
