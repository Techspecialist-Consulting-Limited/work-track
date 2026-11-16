import { connection } from "next/server";
import { NextResponse } from "next/server";
import { and, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { timeEntryAttachments } from "@/lib/db/schema";
import {
  deleteAttachmentObject,
  getStorageConfig,
  uploadAttachmentObject,
  validateAttachmentFile,
  sanitizeFileName,
} from "@/lib/worklog/attachments";


const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

async function requireUploader(request: Request) {
  const membership = await getRequestMembership(request);
  if (!membership) throw new AuthzError(401, "Authentication required.");
  if (membership.role !== "staff" || !membership.employeeId) {
    throw new AuthzError(403, "Only staff members can upload work evidence.");
  }
  return { ...membership, employeeId: membership.employeeId };
}

/** Reap abandoned pending uploads older than 24h (best effort). */
async function reapAbandonedUploads() {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  const stale = await db
    .select()
    .from(timeEntryAttachments)
    .where(and(isNull(timeEntryAttachments.entryId), lt(timeEntryAttachments.createdAt, cutoff)))
    .limit(50);
  if (!stale.length) return;
  const config = getStorageConfig();
  await db.delete(timeEntryAttachments).where(
    and(isNull(timeEntryAttachments.entryId), lt(timeEntryAttachments.createdAt, cutoff))
  );
  if (config) {
    await Promise.all(stale.map((row) => deleteAttachmentObject(config, row.storagePath)));
  }
}

export async function POST(request: Request) {
  await connection();
  try {
    const membership = await requireUploader(request);
    const config = getStorageConfig();
    if (!config) {
      return NextResponse.json(
        { ok: false, message: "Evidence storage is not configured on this environment." },
        { status: 503 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No file was provided." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const check = validateAttachmentFile(file.name, file.type, bytes.byteLength);
    if (!check.ok) {
      return NextResponse.json({ ok: false, message: check.message }, { status: 400 });
    }

    const id = randomUUID();
    const storagePath = `${membership.employeeId}/${id}-${sanitizeFileName(file.name)}`;

    try {
      await uploadAttachmentObject(config, storagePath, bytes, check.mimeType!);
    } catch {
      return NextResponse.json(
        { ok: false, message: "The file could not be uploaded. Check your connection and try again." },
        { status: 502 }
      );
    }

    const [row] = await db
      .insert(timeEntryAttachments)
      .values({
        id,
        employeeId: membership.employeeId,
        fileName: sanitizeFileName(file.name),
        mimeType: check.mimeType!,
        sizeBytes: bytes.byteLength,
        storagePath,
        uploadedByMembershipId: membership.membershipId,
      })
      .returning();

    void reapAbandonedUploads();

    return NextResponse.json({
      ok: true,
      attachment: {
        id: row.id,
        entryId: row.entryId,
        employeeId: row.employeeId,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Upload failed. Try again." }, { status: 500 });
  }
}
