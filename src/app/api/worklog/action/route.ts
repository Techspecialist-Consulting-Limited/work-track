import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, getMembership } from "@/lib/auth/authorize";
import {
  addProgressUpdateAction,
  addWorkEntryAction,
  createSubtaskAction,
  createTaskAction,
  editProgressUpdateAction,
  editWorkEntryAction,
  endBreakAction,
  inviteChairmanAction,
  setManagementReviewAction,
  snapshotFor,
  startBreakAction,
  updateBreakAction,
  updateProfileAction,
  updateSubtaskAction,
  updateSubtaskStatusAction,
  updateTaskAction,
  updateTaskStatusAction,
  voidWorkEntryAction,
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
        result = await addWorkEntryAction(membership, {
          id: String(p.id),
          ...(p.input as Record<string, unknown>),
        } as never);
        break;
      case "editEntry":
        result = await editWorkEntryAction(membership, String(p.entryId), p.input as never);
        break;
      case "createTask":
        result = await createTaskAction(membership, p as never);
        break;
      case "updateTask":
        result = await updateTaskAction(membership, p as never);
        break;
      case "updateTaskStatus":
        result = await updateTaskStatusAction(
          membership,
          String(p.taskId),
          p.status as never,
          p.reason as string | undefined,
          p.note as string | undefined
        );
        break;
      case "createSubtask":
        result = await createSubtaskAction(membership, p as never);
        break;
      case "updateSubtask":
        result = await updateSubtaskAction(membership, p as never);
        break;
      case "updateSubtaskStatus":
        result = await updateSubtaskStatusAction(
          membership,
          String(p.subtaskId),
          p.status as never,
          p.reason as string | undefined
        );
        break;
      case "addProgressUpdate":
        result = await addProgressUpdateAction(membership, p as never);
        break;
      case "editProgressUpdate":
        result = await editProgressUpdateAction(membership, p as never);
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
      case "updateBreak":
        result = await updateBreakAction(membership, p as never);
        break;
      case "inviteChairman":
        result = await inviteChairmanAction(membership, p as never);
        break;
      case "voidEntry":
        result = await voidWorkEntryAction(membership, String(p.entryId));
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
