import { connection } from "next/server";
import { NextResponse } from "next/server";
import {
  bearerTokenFrom,
  EntraTokenError,
  fetchVerifiedGraphEmail,
  verifyWorkTrackBearerToken,
} from "@/lib/auth/entra-token";
import { getMembershipForIdentity } from "@/lib/auth/authorize";
import { acceptEmployeeInvitation, snapshotFor } from "@/lib/db/worklog-actions";

/**
 * Mobile invitation redemption.
 *
 * POST /api/mobile/invitations/redeem
 *   Authorization: Bearer <WorkTrack API access token>
 *   { "token": "<invitation token>", "graphAccessToken": "<optional Graph token>" }
 *
 * The bearer token proves the Microsoft identity (tid/oid). The invited
 * email must match a trustworthy email: the token's email/preferred_username
 * claim, or — when absent — the verified `/me` email fetched with a Graph
 * access token (User.Read). All invitation assignments come from the stored
 * invitation record; nothing is client-supplied except the token itself.
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

    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      graphAccessToken?: string;
    };
    if (!body.token || typeof body.token !== "string") {
      return NextResponse.json({ ok: false, message: "Invitation token is required." }, { status: 400 });
    }

    // WorkTrack API access tokens do not always carry an email claim. Fall
    // back to a verified Microsoft Graph identity when the app provides one.
    let email = identity.email;
    if (!email && typeof body.graphAccessToken === "string" && body.graphAccessToken) {
      email = await fetchVerifiedGraphEmail(body.graphAccessToken);
    }
    if (!email) {
      return NextResponse.json(
        { ok: false, message: "Your Microsoft account email could not be verified. Sign in with the email scope and retry." },
        { status: 400 }
      );
    }

    const accepted = await acceptEmployeeInvitation(
      { oid: identity.oid, tid: identity.tid, email, name: identity.name },
      body.token
    );
    if (!accepted.ok) {
      return NextResponse.json({ ok: false, message: accepted.message }, { status: 400 });
    }

    const membership = await getMembershipForIdentity({
      tid: identity.tid,
      oid: identity.oid,
      role: accepted.role,
      name: identity.name,
      email,
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
    console.error("[mobile/invitations/redeem]", e);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
