import { connection } from "next/server";
import { NextResponse } from "next/server";
import {
  bearerTokenFrom,
  EntraTokenError,
  verifyWorkTrackBearerToken,
} from "@/lib/auth/entra-token";
import { identityAccessState, listMembershipsForIdentity } from "@/lib/auth/authorize";

/**
 * GET /api/mobile/session
 *
 * Mobile session discovery. Validates the WorkTrack API bearer token and
 * returns the authenticated identity plus every active WorkTrack membership
 * it holds, so the client can offer role selection. Bearer-only — cookie
 * sessions use the web flow.
 */
export async function GET(request: Request) {
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

    const memberships = await listMembershipsForIdentity({ tid: identity.tid, oid: identity.oid });
    // "none" → client should offer self-service onboarding; "deactivated" →
    // blocked until an admin reactivates; "active" → normal sign-in.
    const accessState = await identityAccessState({ oid: identity.oid, tid: identity.tid });
    return NextResponse.json({
      ok: true,
      identity: { name: identity.name, email: identity.email },
      memberships,
      accessState,
    });
  } catch (e) {
    console.error("[mobile/session]", e);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
