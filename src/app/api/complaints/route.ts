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
        category?: string;
        subject?: string;
        description?: string;
        attachmentIds?: string[];
      };
      subject = body.subject ?? "";
      description = body.description ?? "";
      attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
    }

    const category = "other";

    const result = await createComplaintRecord({
      employeeId: membership.employeeId,
      category: category as "payroll" | "workplace" | "scheduling" | "equipment" | "policy" | "other",
      subject,
      description,
      attachmentIds,
      actor: actorFromMembership(membership),
    });

    if (!result.ok) return NextResponse.json(result, { status: 400 });

    // Multipart submissions may carry files — store them against the opening
    // message so they appear with the complaint in the admin view.
    if (files.length) {
      const config = getStorageConfig();
      if (!config) {
        return NextResponse.json(
          { ok: false, message: "Complaint submitted, but attachment storage is not configured." },
          { status: 503 }
        );
      }
      for (const file of files.slice(0, 10)) {
        const bytes = await file.arrayBuffer();
        const check = validateAttachmentFile(file.name, file.type, bytes.byteLength);
        if (!check.ok) continue; // skip invalid files; complaint itself is saved
        const id = randomUUID();
        const storagePath = complaintStoragePath(result.complaintId, id, file.name);
        try {
          await uploadAttachmentObject(config, storagePath, bytes, check.mimeType!);
        } catch {
          continue;
        }
        await db.insert(complaintMessageAttachments).values({
          id,
          complaintId: result.complaintId,
          messageId: result.messageId,
          employeeId: membership.employeeId,
          fileName: sanitizeFileName(file.name),
          mimeType: check.mimeType!,
          sizeBytes: bytes.byteLength,
          storagePath,
          uploadedByMembershipId: membership.membershipId,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Could not submit complaint." }, { status: 500 });
  }
}
