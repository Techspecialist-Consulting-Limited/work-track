import { connection } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { complaintMessageAttachments } from "@/lib/db/schema";
import {
  complaintStoragePath,
  getStorageConfig,
  sanitizeFileName,
  uploadAttachmentObject,
  validateAttachmentFile,
} from "@/lib/complaints/attachments";
import {
  canManageComplaintsMembership,
  createComplaintRecord,
  getComplaintRecords,
  type ComplaintActor,
} from "@/lib/complaints/server";

function actorFromMembership(m: NonNullable<Awaited<ReturnType<typeof getRequestMembership>>>): ComplaintActor {
  const name = m.employee?.fullName ?? m.user.name ?? (m.role === "chairman" ? "Chairman" : "User");
  const roleLabel =
    m.role === "chairman" ? "Chairman" : m.role === "hr" ? "HR" : m.isConfigAdmin ? "Config admin" : "Staff";
  return {
    membershipId: m.membershipId,
    role: m.role,
    isConfigAdmin: m.isConfigAdmin,
    employeeId: m.employeeId,
    name,
    roleLabel,
  };
}

export async function GET(request: Request) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });

    const summary = new URL(request.url).searchParams.get("summary") === "1";

    const canManage = await canManageComplaintsMembership(membership);
    if (canManage) {
      if (summary) {
        const complaints = await getComplaintRecords({ type: "management" });
        return NextResponse.json({
          ok: true,
          scope: "management",
          unread: complaints.filter((c) => c.unreadByManagement).length,
        });
      }
      const complaints = await getComplaintRecords({ type: "management" });
      return NextResponse.json({ ok: true, complaints, scope: "management" });
    }
    if (membership.role === "staff" && membership.employeeId) {
      if (summary) {
        const complaints = await getComplaintRecords({ type: "staff", employeeId: membership.employeeId });
        return NextResponse.json({
          ok: true,
          scope: "staff",
          unread: complaints.filter((c) => c.unreadByStaff).length,
        });
      }
      const complaints = await getComplaintRecords({ type: "staff", employeeId: membership.employeeId });
      return NextResponse.json({ ok: true, complaints, scope: "staff" });
    }
    return NextResponse.json({ ok: false, message: "You do not have access to complaints." }, { status: 403 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Could not load complaints." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    if (membership.role !== "staff" || !membership.employeeId) {
      return NextResponse.json({ ok: false, message: "Only staff can submit complaints." }, { status: 403 });
    }

    const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");

    let subject = "";
    let description = "";
    let files: File[] = [];
    let attachmentIds: string[] = [];

    if (isMultipart) {
      const form = await request.formData();
      subject = String(form.get("subject") ?? "");
      description = String(form.get("description") ?? "");
      files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        subject?: string;
        description?: string;
        attachmentIds?: string[];
      };
      subject = body.subject ?? "";
      description = body.description ?? "";
      attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
    }

    // Fail before creating anything if attachments were requested but storage
    // is unavailable — a complaint with silently missing evidence is worse
    // than a clear "try again" error.
    const config = files.length ? getStorageConfig() : null;
    if (files.length && !config) {
      return NextResponse.json(
        { ok: false, message: "Attachment storage is not configured. Remove the files or contact an administrator." },
        { status: 503 }
      );
    }

    // Validate every file up front so obviously invalid files never produce a
    // half-saved complaint either.
    const prepared: { bytes: ArrayBuffer; name: string; mimeType: string }[] = [];
    for (const file of files.slice(0, 10)) {
      const bytes = await file.arrayBuffer();
      const check = validateAttachmentFile(file.name, file.type, bytes.byteLength);
      if (check.ok && check.mimeType) {
        prepared.push({ bytes, name: file.name, mimeType: check.mimeType });
      }
    }

    const result = await createComplaintRecord({
      employeeId: membership.employeeId,
      subject,
      description,
      attachmentIds,
      actor: actorFromMembership(membership),
    });

    if (!result.ok) return NextResponse.json(result, { status: 400 });

    // Multipart submissions may carry files — store them against the opening
    // message so they appear with the complaint in the admin view.
    let uploadWarning: string | null = null;
    if (config) {
      let skipped = 0;
      for (const file of prepared) {
        const id = randomUUID();
        const storagePath = complaintStoragePath(result.complaintId, id, file.name);
        try {
          await uploadAttachmentObject(config, storagePath, file.bytes, file.mimeType);
        } catch {
          skipped += 1;
          continue;
        }
        await db.insert(complaintMessageAttachments).values({
          id,
          complaintId: result.complaintId,
          messageId: result.messageId,
          employeeId: membership.employeeId,
          fileName: sanitizeFileName(file.name),
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          storagePath,
          uploadedByMembershipId: membership.membershipId,
        });
      }
      if (skipped) uploadWarning = `${skipped} attachment${skipped === 1 ? "" : "s"} could not be uploaded.`;
    }

    return NextResponse.json({ ...result, ...(uploadWarning ? { warning: uploadWarning } : {}) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Could not submit complaint." }, { status: 500 });
  }
}
