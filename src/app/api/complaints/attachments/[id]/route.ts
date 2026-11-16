import { connection } from "next/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { complaintMessageAttachments, complaints } from "@/lib/db/schema";
import {
  createSignedUrl,
  deleteAttachmentObject,
  getStorageConfig,
} from "@/lib/complaints/attachments";
import { canManageComplaintsMembership } from "@/lib/complaints/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const { id } = await params;

    const [row] = await db
      .select({
        att: complaintMessageAttachments,
        employeeId: complaints.employeeId,
      })
      .from(complaintMessageAttachments)
      .innerJoin(complaints, eq(complaintMessageAttachments.complaintId, complaints.id))
      .where(eq(complaintMessageAttachments.id, id))
      .limit(1);

    if (!row) return NextResponse.json({ ok: false, message: "Attachment not found." }, { status: 404 });
    const canManage = await canManageComplaintsMembership(membership);
    const isOwner = membership.role === "staff" && membership.employeeId === row.employeeId;
    if (!canManage && !isOwner) {
      return NextResponse.json({ ok: false, message: "Attachment not found." }, { status: 404 });
    }

    const config = getStorageConfig();
    if (!config) return NextResponse.json({ ok: false, message: "Storage not configured." }, { status: 503 });
    const signed = await createSignedUrl(config, row.att.storagePath, 120);
    if (!signed) return NextResponse.json({ ok: false, message: "Could not create download link." }, { status: 502 });
    return NextResponse.redirect(signed, 302);
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Download failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const { id } = await params;

    const [row] = await db
      .select({ att: complaintMessageAttachments })
      .from(complaintMessageAttachments)
      .where(eq(complaintMessageAttachments.id, id))
      .limit(1);

    if (!row) return NextResponse.json({ ok: false, message: "Attachment not found." }, { status: 404 });
    const att = row.att;
    if (att.messageId) return NextResponse.json({ ok: false, message: "Linked attachments cannot be removed." }, { status: 409 });
    if (att.uploadedByMembershipId !== membership.membershipId) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    await db.delete(complaintMessageAttachments).where(eq(complaintMessageAttachments.id, id));
    const config = getStorageConfig();
    if (config) await deleteAttachmentObject(config, att.storagePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Delete failed." }, { status: 500 });
  }
}
