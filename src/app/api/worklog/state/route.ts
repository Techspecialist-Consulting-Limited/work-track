import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, getMembership } from "@/lib/auth/authorize";
import { loadWorkLogDb } from "@/lib/db/worklog-data";

export async function GET(request: Request) {
  await connection();
  try {
    const membership = await getMembership();
    if (!membership) throw new AuthzError(401, "Authentication required.");

    const scope = new URL(request.url).searchParams.get("scope");
    const isManagement = membership.role === "hr" || membership.role === "chairman";

    let db;
    if (scope === "team") {
      if (!isManagement) throw new AuthzError(403, "Management access required.");
      db = await loadWorkLogDb();
    } else {
      // "me" scope (default): the signed-in member's own employee records.
      // Task logging is staff + HR only — Chairman never gets this scope.
      if (membership.role === "chairman" || !membership.employeeId) {
        throw new AuthzError(403, "No employee record linked.");
      }
      db = await loadWorkLogDb({ employeeId: membership.employeeId });
    }

    return NextResponse.json({
      db,
      employeeId: membership.employeeId,
      role: membership.role,
      user: { name: membership.user.name ?? null, email: membership.user.email ?? null },
    });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[worklog/state]", e);
    return NextResponse.json({ error: "Failed to load work log." }, { status: 500 });
  }
}
