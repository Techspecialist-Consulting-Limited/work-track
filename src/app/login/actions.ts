"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth/auth";
import { LOGIN_ROLE_COOKIE, LOGIN_ROLE_MAX_AGE, type WorkTrackRole } from "@/lib/auth/authorize";

const VALID_ROLES: WorkTrackRole[] = ["staff", "hr", "chairman"];

/** Stores the requested role in a short-lived httpOnly cookie, then starts Microsoft sign-in. */
export async function chooseRole(role: WorkTrackRole) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error("Invalid role selection.");
  }
  const store = await cookies();
  store.set(LOGIN_ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGIN_ROLE_MAX_AGE,
  });
  await signIn("microsoft-entra-id", { redirectTo: "/auth/complete" });
  redirect("/login"); // unreachable — signIn throws a redirect
}
