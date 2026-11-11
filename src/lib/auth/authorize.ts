import "server-only";
import { redirect } from "next/navigation";
import { eq, and, or, isNull } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "@/lib/db";
import { employees, employeeTeams, invitations, memberships, teams } from "@/lib/db/schema";

export type WorkTrackRole = "staff" | "hr" | "chairman";
export type ManagementRole = "hr" | "chairman";

export interface WorkTrackMembership {
  membershipId: string;
  role: WorkTrackRole;
  employeeId: string | null;
  /** Configuration permission, separate from management reporting access. */
  isConfigAdmin: boolean;
  /** Last team selected by a staff member (validated against employee_teams). */
  activeTeamId: string | null;
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
      isConfigAdmin: memberships.isConfigAdmin,
      activeTeamId: memberships.activeTeamId,
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
    isConfigAdmin: row.isConfigAdmin,
    activeTeamId: row.activeTeamId,
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

/**
 * Configuration permission is granted per membership and is deliberately
 * separate from HR/chairman reporting access. Every config mutation re-checks
 * this server-side.
 */
export async function requireConfigAdmin(): Promise<WorkTrackMembership> {
  const membership = await requireMembership();
  if (!membership.isConfigAdmin) {
    throw new AuthzError(403, "Configuration admin access required.");
  }
  return membership;
}

/** Team ids the given employee is explicitly assigned to. */
export async function getAuthorizedTeamIds(employeeId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: employeeTeams.teamId })
    .from(employeeTeams)
    .where(eq(employeeTeams.employeeId, employeeId));
  return rows.map((row) => row.teamId);
}

/** True when the employee belongs to the team. */
export async function isEmployeeInTeam(employeeId: string, teamId: string): Promise<boolean> {
  const rows = await db
    .select({ id: employeeTeams.id })
    .from(employeeTeams)
    .where(and(eq(employeeTeams.employeeId, employeeId), eq(employeeTeams.teamId, teamId)))
    .limit(1);
  return rows.length > 0;
}

/** The default team, used for auto-provisioned staff who have no department. */
export async function getDefaultTeamId(): Promise<string | null> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), eq(teams.isActive, true)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Self-service provisioning: the Entra app registration is single-tenant, so a
 * successful Microsoft sign-in already means "company account". Staff and HR
 * memberships are created on first login (with an employee record, since HR
 * can also log tasks). Chairman stays manual-only via
 * scripts/provision-member.mjs.
 */
export async function autoProvisionMembership(
  user: { oid?: string; tid?: string; name?: string | null; email?: string | null },
  role: WorkTrackRole
): Promise<WorkTrackMembership | null> {
  if (role === "chairman" || !user.oid || !user.tid) return null;

  const employeeCode = `emp-${user.oid.slice(0, 8)}`;
  const fullName =
    user.name?.trim() ||
    user.email?.split("@")[0].replace(/[._-]+/g, " ") ||
    "Team Member";

  let employeeId =
    (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.employeeCode, employeeCode))
        .limit(1)
    )[0]?.id ?? null;

  if (!employeeId) {
    employeeId =
      (
        await db
          .insert(employees)
          .values({ employeeCode, fullName, jobTitle: "Team Member", department: "" })
          .returning({ id: employees.id })
      )[0]?.id ?? null;
  }
  if (!employeeId) return null;

  // Auto-provisioned staff land in the default team so they can log work
  // immediately; an admin reassigns them later.
  const defaultTeamId = await getDefaultTeamId();
  if (defaultTeamId) {
    await db
      .insert(employeeTeams)
      .values({ employeeId, teamId: defaultTeamId })
      .onConflictDoNothing();
  }

  await db
    .insert(memberships)
    .values({
      role,
      microsoftTenantId: user.tid,
      microsoftObjectId: user.oid,
      employeeId,
      isActive: true,
      activeTeamId: defaultTeamId,
    })
    .onConflictDoNothing();

  // Existing membership without an active team (e.g. re-login) gets the default.
  if (defaultTeamId) {
    await db
      .update(memberships)
      .set({ activeTeamId: defaultTeamId, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.microsoftTenantId, user.tid),
          eq(memberships.microsoftObjectId, user.oid),
          eq(memberships.role, role),
          isNull(memberships.activeTeamId)
        )
      );
  }

  return getMembership();
}

/** True if the user already holds ANY active membership (any role). */
export async function hasAnyMembership(user: {
  oid?: string;
  tid?: string;
}): Promise<boolean> {
  if (!user.oid || !user.tid) return false;
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.microsoftTenantId, user.tid),
        eq(memberships.microsoftObjectId, user.oid),
        eq(memberships.isActive, true)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Redeem a pending invitation: the invited email must match the signed-in
 * Entra account exactly (case-insensitive). Creates the membership and marks
 * the invitation accepted. Returns the resolved membership or null.
 */
export async function redeemInvitation(
  user: { oid?: string; tid?: string; email?: string | null },
  role: WorkTrackRole
): Promise<WorkTrackMembership | null> {
  if (!user.oid || !user.tid || !user.email) return null;
  const email = user.email.trim().toLowerCase();

  const invite = (
    await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          eq(invitations.role, role),
          isNull(invitations.acceptedAt)
        )
      )
      .limit(1)
  )[0];
  if (!invite) return null;

  await db
    .insert(memberships)
    .values({
      role,
      microsoftTenantId: user.tid,
      microsoftObjectId: user.oid,
      employeeId: null,
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .update(invitations)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitations.id, invite.id));

  return getMembership();
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

/** Page-level guard for configuration screens (separate from reporting roles). */
export async function requireConfigAdminPage(): Promise<WorkTrackMembership> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const membership = await getMembership();
  if (!membership) redirect("/auth/complete");
  if (!membership.isConfigAdmin) {
    redirect(membership.role === "staff" ? "/" : "/executive");
  }
  return membership;
}

/** The role the user selected at login — stored in a short-lived signed cookie. */
export const LOGIN_ROLE_COOKIE = "wt_login_role";
export const LOGIN_ROLE_MAX_AGE = 60 * 15; // 15 minutes
