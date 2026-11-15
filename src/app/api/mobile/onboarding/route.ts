import { connection } from "next/server";
import { NextResponse } from "next/server";
import {
  bearerTokenFrom,
  EntraTokenError,
  verifyWorkTrackBearerToken,
} from "@/lib/auth/entra-token";
import { getMembershipForIdentity } from "@/lib/auth/authorize";
import { completeStaffOnboarding, snapshotFor } from "@/lib/db/worklog-actions";

/**
 * POST /api/mobile/onboarding
 *
 * Mobile self-service staff registration — the same business logic as the
 * web /onboarding flow. Bearer token proves the Entra identity; the client
 * supplies only arrangement/client/profile fields. Employee, membership,
 * team and org assignment are all created server-side in one transaction.
 *
 * Body: { workArrangement, clientOrganisationId?, jobTitle?, department? }
 */
export async function POST(request: Request) {
  await connection();
  try {
    const bearer = bearerTokenFrom(request);
    if (!bearer) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }

    let identity;
    try {
      identity = await verifyWorkTrackBearerToken(bearer);
    } catch (e) {
      if (e instanceof EntraTokenError) {
        return NextResponse.json({ ok: false, message: "Invalid or expired access token." }, { status: 401 });
      }
      throw e;
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await completeStaffOnboarding(
      { oid: identity.oid, tid: identity.tid, name: identity.name },
      {
        workArrangement: body.workArrangement as string | undefined,
        clientOrganisationId: body.clientOrganisationId as string | null | undefined,
        jobTitle: body.jobTitle as string | undefined,
        department: body.department as string | undefined,
      }
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }

    const membership = await getMembershipForIdentity({
      tid: identity.tid,
      oid: identity.oid,
      role: "staff",
      name: identity.name,
      email: identity.email,
    });
    if (!membership) {
      return NextResponse.json(
        { ok: false, message: "Your WorkTrack membership could not be resolved." },
        { status: 500 }
      );
    }
    const db = await snapshotFor(membership, "me");
    return NextResponse.json({
      ok: true,
      role: membership.role,
      db,
      employeeId: membership.employeeId,
      isConfigAdmin: membership.isConfigAdmin,
      activeTeamId: membership.activeTeamId,
      user: { name: membership.user.name ?? null, email: membership.user.email ?? null },
    });
  } catch (e) {
    console.error("[mobile/onboarding]", e);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
