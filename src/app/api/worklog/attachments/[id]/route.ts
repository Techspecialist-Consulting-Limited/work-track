import { connection } from "next/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { timeEntryAttachments } from "@/lib/db/schema";
import { createSignedUrl, deleteAttachmentObject, getStorageConfig } from "@/lib/worklog/attachments";


type Params = { params: Promise<{ id: string }> };

async function loadAttachment(id: string) {
  const [row] = await db.select().from(timeEntryAttachments).where(eq(timeEntryAttachments.id, id)).limit(1);
  return row ?? null;
}

function canAccess(membership: { role: string; employeeId: string | null }, row: { employeeId: string }) {
  if (membership.role === "hr" || membership.role === "chairman") return true;
  return membership.role === "staff" && membership.employeeId === row.employeeId;
}

/**
 * Authorised, time-limited download. Responds with a redirect to a
 * 2-minute signed URL — the private bucket never exposes public links.
 */
export async function GET(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) throw new AuthzError(401, "Authentication required.");
    const { id } = await params;
    const row = await loadAttachment(id);
    if (!row || !canAccess(membership, row)) {
      return NextResponse.json({ ok: false, message: "Attachment not found." }, { status: 404 });
    }
    const config = getStorageConfig();
    if (!config) {
      return NextResponse.json({ ok: false, message: "Evidence storage is not configured." }, { status: 503 });
    }
    const signed = await createSignedUrl(config, row.storagePath, 120);
    if (!signed) {
      return NextResponse.json({ ok: false, message: "Could not create a download link." }, { status: 502 });
    }
    return NextResponse.redirect(signed, 302);
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Download failed." }, { status: 500 });
  }
}

/** Remove a pending (not-yet-linked) upload. Linked attachments are immutable. */
export async function DELETE(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) throw new AuthzError(401, "Authentication required.");
    if (membership.role !== "staff" || !membership.employeeId) {
      throw new AuthzError(403, "Only the uploader can remove a pending attachment.");
    }
    const { id } = await params;
    const row = await loadAttachment(id);
    if (!row || row.employeeId !== membership.employeeId) {
      return NextResponse.json({ ok: false, message: "Attachment not found." }, { status: 404 });
    }
    if (row.entryId) {
      return NextResponse.json({ ok: false, message: "Saved attachments cannot be removed here." }, { status: 409 });
    }
    await db.delete(timeEntryAttachments).where(eq(timeEntryAttachments.id, id));
    const config = getStorageConfig();
    if (config) await deleteAttachmentObject(config, row.storagePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Delete failed." }, { status: 500 });
  }
}
