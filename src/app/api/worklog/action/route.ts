import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, getMembership } from "@/lib/auth/authorize";
import {
  addWorkEntryAction,
  createTaskAction,
  editWorkEntryAction,
  endBreakAction,
  inviteChairmanAction,
  setManagementReviewAction,
  snapshotFor,
  startBreakAction,
  updateProfileAction,
  updateTaskStatusAction,
  type ActionResult,
} from "@/lib/db/worklog-actions";


type Body = { action?: string; payload?: Record<string, unknown>; scope?: string };

export async function POST(request: Request) {
  await connection();
  try {
    const membership = await getMembership();
    if (!membership) throw new AuthzError(401, "Authentication required.");

    const body = (await request.json()) as Body;
    const p = body.payload ?? {};
    let result: ActionResult;

    switch (body.action) {
      case "addEntry":
        result = await addWorkEntryAction(membership, p as never);
        break;
      case "editEntry":
        result = await editWorkEntryAction(membership, String(p.entryId), p.input as never);
        break;
      case "createTask":
        result = await createTaskAction(membership, p as never);
        break;
      case "updateTaskStatus":
        result = await updateTaskStatusAction(
          membership,
          String(p.taskId),
          p.status as never,
          p.reason as string | undefined
        );
        break;
      case "setReview":
        result = await setManagementReviewAction(
          membership,
          String(p.taskId),
          p.status as "accepted" | "needs_changes",
          p.note as string | undefined
        );
        break;
      case "startBreak":
        result = await startBreakAction(membership, p as never);
        break;
      case "updateProfile":
        result = await updateProfileAction(membership, p as never);
        break;
      case "endBreak":
        result = await endBreakAction(membership, String(p.breakId));
        break;
      case "inviteChairman":
        result = await inviteChairmanAction(membership, p as never);
        break;
      default:
        return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
    }

    const db = await snapshotFor(membership, body.scope);
    return NextResponse.json({ ...result, db });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    }
    if (e instanceof Error && e.message === "FORBIDDEN") {
      return NextResponse.json({ ok: false, message: "You do not have access to this action." }, { status: 403 });
    }
    console.error("[worklog/action]", e);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
