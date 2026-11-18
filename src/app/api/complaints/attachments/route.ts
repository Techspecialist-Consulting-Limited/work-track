import { connection } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { complaintMessageAttachments } from "@/lib/db/schema";
import {
  complaintStoragePath,
  deleteAttachmentObject,
  getStorageConfig,
  sanitizeFileName,
  uploadAttachmentObject,
  validateAttachmentFile,
} from "@/lib/complaints/attachments";
import { canManageComplaintsMembership, getComplaintById, reapPendingComplaintAttachments } from "@/lib/complaints/server";

export async function POST(request: Request) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });

    const form = await request.formData();
    const complaintId = String(form.get("complaintId") ?? "");
    const file = form.get("file");
    if (!complaintId) return NextResponse.json({ ok: false, message: "Missing complaintId." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ ok: false, message: "No file provided." }, { status: 400 });

    const complaint = await getComplaintById(complaintId);
    if (!complaint) return NextResponse.json({ ok: false, message: "Complaint not found." }, { status: 404 });

    const canManage = await canManageComplaintsMembership(membership);
    const isOwner = membership.role === "staff" && membership.employeeId === complaint.employeeId;
    if (!canManage && !isOwner) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const config = getStorageConfig();
    if (!config) {
      return NextResponse.json({ ok: false, message: "Attachment storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });
    }

    const bytes = await file.arrayBuffer();
    const check = validateAttachmentFile(file.name, file.type, bytes.byteLength);
    if (!check.ok) return NextResponse.json({ ok: false, message: check.message }, { status: 400 });

    const id = randomUUID();
    const storagePath = complaintStoragePath(complaintId, id, file.name);

    try {
      await uploadAttachmentObject(config, storagePath, bytes, check.mimeType!);
    } catch {
      return NextResponse.json({ ok: false, message: "Upload to storage failed." }, { status: 502 });
    }

    const [row] = await db
      .insert(complaintMessageAttachments)
      .values({
        id,
        complaintId,
        messageId: null,
        employeeId: isOwner ? membership.employeeId : null,
        fileName: sanitizeFileName(file.name),
        mimeType: check.mimeType!,
        sizeBytes: bytes.byteLength,
        storagePath,
        uploadedByMembershipId: membership.membershipId,
      })
      .returning();

    void (async () => {
      try {
        const paths = await reapPendingComplaintAttachments();
        if (paths.length) await Promise.all(paths.map((p) => deleteAttachmentObject(config, p)));
      } catch {}
    })();

    return NextResponse.json({
      ok: true,
      attachment: {
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        kind: row.mimeType.startsWith("image/") ? "image" : "document",
      },
    });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Upload failed." }, { status: 500 });
  }
}
