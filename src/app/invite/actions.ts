"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth/auth";
import {
  INVITE_TOKEN_COOKIE,
  INVITE_TOKEN_MAX_AGE,
  LOGIN_ROLE_COOKIE,
  LOGIN_ROLE_MAX_AGE,
} from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { invitations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashInvitationToken, invitationStatus } from "@/lib/worklog/invitations";

/**
 * Re-validates the token server-side, stores it plus the invited role in
 * short-lived httpOnly cookies, then starts Microsoft sign-in. The role cookie
 * makes the JWT carry the invited role so getMembership resolves correctly.
 */
export async function beginInvitationSignIn(token: string) {
  if (!token || token.length > 200) redirect("/login");
  const invite = (
    await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashInvitationToken(token)))
      .limit(1)
  )[0];
  if (!invite || invitationStatus(invite) !== "pending") redirect("/login");

  const store = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  store.set(LOGIN_ROLE_COOKIE, invite.role, { ...opts, maxAge: LOGIN_ROLE_MAX_AGE });
  store.set(INVITE_TOKEN_COOKIE, token, { ...opts, maxAge: INVITE_TOKEN_MAX_AGE });
  await signIn("microsoft-entra-id", { redirectTo: "/auth/complete" });
  redirect("/login");
}
