/**
 * Pure identity helpers shared by cookie-session and bearer-token auth.
 * Kept free of server-only imports so unit tests can exercise them.
 */

export type WorkTrackRole = "staff" | "hr" | "chairman";

export const WORKTRACK_ROLES: readonly WorkTrackRole[] = ["staff", "hr", "chairman"];

export function isWorkTrackRole(value: string | undefined | null): value is WorkTrackRole {
  return value === "staff" || value === "hr" || value === "chairman";
}

export interface MembershipCandidate {
  role: WorkTrackRole;
}

export type RoleSelection =
  | { ok: true; role: WorkTrackRole }
  | { ok: false; reason: "invalid_role" | "role_required" | "role_not_granted" };

/**
 * Picks the membership role for an authenticated identity.
 *
 * - An explicit requested role must be one of the identity's active
 *   memberships — the client can never select a role it was not granted.
 * - Without a requested role, a single-membership identity resolves
 *   directly; multi-membership identities must specify the role.
 */
export function selectMembershipRole(
  candidates: MembershipCandidate[],
  requestedRole?: string | null
): RoleSelection {
  if (candidates.length === 0) return { ok: false, reason: "role_not_granted" };

  if (requestedRole != null && requestedRole !== "") {
    if (!isWorkTrackRole(requestedRole)) return { ok: false, reason: "invalid_role" };
    if (!candidates.some((c) => c.role === requestedRole)) {
      return { ok: false, reason: "role_not_granted" };
    }
    return { ok: true, role: requestedRole };
  }

  if (candidates.length === 1) return { ok: true, role: candidates[0].role };
  return { ok: false, reason: "role_required" };
}
