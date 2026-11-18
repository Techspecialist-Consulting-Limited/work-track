import "server-only";

import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  complaintMessageAttachments,
  complaintMessages,
  complaintStatusHistory,
  complaints,
  employees,
  organisations,
} from "@/lib/db/schema";
import type {
  ComplaintAttachment,
  ComplaintEmployee,
  ComplaintMessage,
  ComplaintRecord,
  ComplaintSenderType,
  ComplaintStatus,
  ComplaintStatusHistoryEntry,
} from "./types";

export type ComplaintActor = {
  membershipId: string;
  role: "staff" | "hr" | "chairman";
  isConfigAdmin: boolean;
  employeeId: string | null;
  name: string;
  roleLabel: string;
};

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function workArrangementLabel(value: string | null | undefined): ComplaintEmployee["workArrangement"] {
  if (value === "client_site") return "Client site";
  if (value === "hybrid") return "Hybrid";
  return "In-house";
}

async function nextReference(): Promise<string> {
  // Derive next WT-#### from existing references; simple and sufficient for this app.
  const rows = await db.select({ reference: complaints.reference }).from(complaints);
  let max = 0;
  for (const row of rows) {
    const m = /^WT-(\d+)$/.exec(row.reference.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `WT-${String(max + 1).padStart(4, "0")}`;
}

export async function canManageComplaintsMembership(m: {
  role: string;
  isConfigAdmin: boolean;
}) {
  // Complaints are admin-only: HR and chairman have no access.
  return m.isConfigAdmin;
}

export async function createComplaintRecord(input: {
  employeeId: string;
  subject: string;
  description: string;
  attachmentIds?: string[];
  actor: ComplaintActor;
}) {
  const subject = input.subject.trim();
  const description = input.description.trim();
  if (subject.length < 3) return { ok: false as const, message: "Enter a subject." };
  if (description.length < 10) return { ok: false as const, message: "Describe the issue in more detail." };

  const now = new Date();
  const reference = await nextReference();

  return db.transaction(async (tx) => {
    const [complaint] = await tx
      .insert(complaints)
      .values({
        reference,
        employeeId: input.employeeId,
        subject,
        description,
        status: "new",
        submittedAt: now,
        lastMessageAt: now,
        unreadByManagement: true,
        unreadByStaff: false,
      })
      .returning();

    const [message] = await tx
      .insert(complaintMessages)
      .values({
        complaintId: complaint.id,
        senderType: "staff",
        senderMembershipId: input.actor.membershipId,
        senderEmployeeId: input.employeeId,
        senderName: input.actor.name,
        senderRole: input.actor.roleLabel,
        body: description,
      })
      .returning();

    await tx.insert(complaintStatusHistory).values({
      complaintId: complaint.id,
      fromStatus: null,
      toStatus: "new",
      changedByMembershipId: null,
      changedByName: "System",
      changedByRole: "System",
      changedAt: now,
    });

    if (input.attachmentIds?.length) {
      await tx
        .update(complaintMessageAttachments)
        .set({ messageId: message.id, updatedAt: now })
        .where(
          and(
            eq(complaintMessageAttachments.complaintId, complaint.id),
            isNull(complaintMessageAttachments.messageId),
            inArray(complaintMessageAttachments.id, input.attachmentIds),
            eq(complaintMessageAttachments.uploadedByMembershipId, input.actor.membershipId)
          )
        );
    }

    return { ok: true as const, complaintId: complaint.id, messageId: message.id, reference };
  });
}

async function loadEmployeesMap(employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, ComplaintEmployee>();
  const rows = await db
    .select({
      id: employees.id,
      name: employees.fullName,
      employeeCode: employees.employeeCode,
      department: employees.department,
      workArrangement: employees.workArrangement,
      employerOrganisationName: organisations.name,
    })
    .from(employees)
    .leftJoin(organisations, eq(employees.employerOrganisationId, organisations.id))
    .where(inArray(employees.id, employeeIds));

  // client org lookup separately if needed
  const clientRows = await db
    .select({ id: employees.id, clientOrganisationName: organisations.name })
    .from(employees)
    .leftJoin(organisations, eq(employees.clientOrganisationId, organisations.id))
    .where(inArray(employees.id, employeeIds));
  const clientByEmp = new Map(clientRows.map((r) => [r.id, r.clientOrganisationName ?? null]));

  const map = new Map<string, ComplaintEmployee>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.name,
      employeeCode: r.employeeCode ?? r.id.slice(0, 8).toUpperCase(),
      team: r.department || "Unassigned",
      organisation: clientByEmp.get(r.id) || r.employerOrganisationName || "WorkTrack",
      workArrangement: workArrangementLabel(r.workArrangement),
    });
  }
  return map;
}

function mapAttachment(row: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): ComplaintAttachment {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: isImageMime(row.mimeType) ? "image" : "document",
  };
}

function mapMessage(
  row: {
    id: string;
    complaintId: string;
    senderType: string;
    senderName: string;
    senderRole: string | null;
    body: string;
    createdAt: Date;
    meta: unknown;
  },
  attachments: ComplaintAttachment[]
): ComplaintMessage {
  const senderType = (row.senderType as ComplaintSenderType) ?? "system";
  const meta = (row.meta ?? undefined) as ComplaintMessage["meta"];
  return {
    id: row.id,
    complaintId: row.complaintId,
    senderType,
    senderName: row.senderName,
    senderRole: row.senderRole ?? undefined,
    body: row.body,
    createdAt: toIso(row.createdAt),
    attachments,
    meta,
  };
}

function mapHistory(row: {
  id: string;
  complaintId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
  changedByName: string;
  changedByRole: string;
  note: string | null;
}): ComplaintStatusHistoryEntry {
  return {
    id: row.id,
    complaintId: row.complaintId,
    fromStatus: (row.fromStatus as ComplaintStatus | null) ?? null,
    toStatus: row.toStatus as ComplaintStatus,
    changedAt: toIso(row.changedAt),
    changedByName: row.changedByName,
    changedByRole: row.changedByRole,
    note: row.note ?? undefined,
  };
}

export async function getComplaintRecords(scope: { type: "management" } | { type: "staff"; employeeId: string }): Promise<ComplaintRecord[]> {
  const rows = await db
    .select()
    .from(complaints)
    .where(
      scope.type === "staff"
        ? and(eq(complaints.employeeId, scope.employeeId), isNull(complaints.withdrawnAt))
        : isNull(complaints.withdrawnAt)
    )
    .orderBy(desc(complaints.lastMessageAt));

  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const empMap = await loadEmployeesMap([...new Set(rows.map((r) => r.employeeId))]);

  const msgRows = await db
    .select()
    .from(complaintMessages)
    .where(inArray(complaintMessages.complaintId, ids))
    .orderBy(asc(complaintMessages.createdAt));
  const histRows = await db
    .select()
    .from(complaintStatusHistory)
    .where(inArray(complaintStatusHistory.complaintId, ids))
    .orderBy(asc(complaintStatusHistory.changedAt));
  const attRows = await db
    .select()
    .from(complaintMessageAttachments)
    .where(inArray(complaintMessageAttachments.complaintId, ids));

  const attsByMessage = new Map<string, ComplaintAttachment[]>();
  for (const a of attRows) {
    if (!a.messageId) continue;
    const list = attsByMessage.get(a.messageId) ?? [];
    list.push(mapAttachment(a));
    attsByMessage.set(a.messageId, list);
  }
  const msgsByComplaint = new Map<string, ComplaintMessage[]>();
  for (const m of msgRows) {
    const list = msgsByComplaint.get(m.complaintId) ?? [];
    list.push(mapMessage(m, attsByMessage.get(m.id) ?? []));
    msgsByComplaint.set(m.complaintId, list);
  }
  const histByComplaint = new Map<string, ComplaintStatusHistoryEntry[]>();
  for (const h of histRows) {
    const list = histByComplaint.get(h.complaintId) ?? [];
    list.push(mapHistory(h));
    histByComplaint.set(h.complaintId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    employee: empMap.get(r.employeeId) ?? {
      id: r.employeeId,
      name: "Employee",
      employeeCode: r.employeeId.slice(0, 8).toUpperCase(),
      team: "—",
      organisation: "—",
      workArrangement: "In-house",
    },
    subject: r.subject,
    description: r.description,
    submittedAt: toIso(r.submittedAt),
    lastMessageAt: toIso(r.lastMessageAt),
    status: r.status as ComplaintStatus,
    unreadByManagement: r.unreadByManagement,
    unreadByStaff: r.unreadByStaff,
    assignedTo: r.assignedToLabel ?? undefined,
    messages: msgsByComplaint.get(r.id) ?? [],
    statusHistory: histByComplaint.get(r.id) ?? [],
  }));
}

export async function getComplaintById(id: string) {
  const [row] = await db
    .select()
    .from(complaints)
    .where(and(eq(complaints.id, id), isNull(complaints.withdrawnAt)))
    .limit(1);
  return row ?? null;
}

export async function markComplaintRead(id: string, by: "management" | "staff") {
  await db
    .update(complaints)
    .set(
      by === "management"
        ? { unreadByManagement: false, updatedAt: new Date() }
        : { unreadByStaff: false, updatedAt: new Date() }
    )
    .where(eq(complaints.id, id));
}

export async function addComplaintReply(input: {
  complaintId: string;
  actor: ComplaintActor;
  senderType: "management" | "staff";
  body: string;
  attachmentIds?: string[];
  requestInfo?: boolean;
}) {
  const body = input.body.trim();
  if (!body && !(input.attachmentIds?.length)) {
    return { ok: false as const, message: "Write a message or attach a file." };
  }
  const now = new Date();
  const messageBody = body || "Shared attachments.";

  return db.transaction(async (tx) => {
    const [complaint] = await tx.select().from(complaints).where(eq(complaints.id, input.complaintId)).limit(1);
    if (!complaint) return { ok: false as const, message: "Complaint not found." };

    const [insertedMessage] = await tx
      .insert(complaintMessages)
      .values({
        complaintId: complaint.id,
        senderType: input.senderType,
        senderMembershipId: input.actor.membershipId,
        senderEmployeeId: input.senderType === "staff" ? input.actor.employeeId : null,
        senderName: input.actor.name,
        senderRole: input.actor.roleLabel,
        body: messageBody,
      })
      .returning({ id: complaintMessages.id });

    if (input.attachmentIds?.length) {
      await tx
        .update(complaintMessageAttachments)
        .set({ messageId: insertedMessage.id, updatedAt: now })
        .where(
          and(
            eq(complaintMessageAttachments.complaintId, complaint.id),
            isNull(complaintMessageAttachments.messageId),
            inArray(complaintMessageAttachments.id, input.attachmentIds),
            eq(complaintMessageAttachments.uploadedByMembershipId, input.actor.membershipId)
          )
        );
    }

    let status = complaint.status as ComplaintStatus;
    if (input.senderType === "management" && input.requestInfo && status !== "resolved") {
      status = "awaiting_staff";
      await tx.insert(complaintStatusHistory).values({
        complaintId: complaint.id,
        fromStatus: complaint.status,
        toStatus: status,
        changedByMembershipId: input.actor.membershipId,
        changedByName: input.actor.name,
        changedByRole: input.actor.roleLabel,
        note: "Requested additional information from staff.",
        changedAt: now,
      });
      await tx.insert(complaintMessages).values({
        complaintId: complaint.id,
        senderType: "system",
        senderName: "WorkTrack",
        body: "Status changed to Awaiting Staff.",
        meta: { type: "status_change", fromStatus: complaint.status, toStatus: status },
      });
    } else if (input.senderType === "management" && status === "new") {
      status = "in_progress";
      await tx.insert(complaintStatusHistory).values({
        complaintId: complaint.id,
        fromStatus: complaint.status,
        toStatus: status,
        changedByMembershipId: input.actor.membershipId,
        changedByName: input.actor.name,
        changedByRole: input.actor.roleLabel,
        note: "Management replied.",
        changedAt: now,
      });
      await tx.insert(complaintMessages).values({
        complaintId: complaint.id,
        senderType: "system",
        senderName: "WorkTrack",
        body: "Status changed from New to In Progress.",
        meta: { type: "status_change", fromStatus: complaint.status, toStatus: status },
      });
    } else if (input.senderType === "staff" && status === "awaiting_staff") {
      status = "in_progress";
      await tx.insert(complaintStatusHistory).values({
        complaintId: complaint.id,
        fromStatus: complaint.status,
        toStatus: status,
        changedByMembershipId: input.actor.membershipId,
        changedByName: input.actor.name,
        changedByRole: input.actor.roleLabel,
        note: "Staff responded.",
        changedAt: now,
      });
      await tx.insert(complaintMessages).values({
        complaintId: complaint.id,
        senderType: "system",
        senderName: "WorkTrack",
        body: "Status changed from Awaiting Staff to In Progress.",
        meta: { type: "status_change", fromStatus: complaint.status, toStatus: status },
      });
    }

    await tx
      .update(complaints)
      .set({
        status,
        lastMessageAt: now,
        updatedAt: now,
        unreadByManagement: input.senderType === "staff",
        unreadByStaff: input.senderType === "management",
      })
      .where(eq(complaints.id, complaint.id));

    return { ok: true as const };
  });
}

export async function setComplaintStatus(input: {
  complaintId: string;
  actor: ComplaintActor;
  toStatus: ComplaintStatus;
  note?: string;
  resolutionBody?: string;
  /** Who initiated the change — controls which side gets the unread badge. */
  actorSide?: "staff" | "management";
}) {
  const now = new Date();
  if (input.toStatus === "resolved" && !input.resolutionBody?.trim()) {
    return { ok: false as const, message: "A resolution response is required before closing a complaint." };
  }

  return db.transaction(async (tx) => {
    const [complaint] = await tx.select().from(complaints).where(eq(complaints.id, input.complaintId)).limit(1);
    if (!complaint) return { ok: false as const, message: "Complaint not found." };
    if (complaint.status === input.toStatus) return { ok: true as const };

    if (input.resolutionBody?.trim()) {
      await tx.insert(complaintMessages).values({
        complaintId: complaint.id,
        senderType: "management",
        senderMembershipId: input.actor.membershipId,
        senderName: input.actor.name,
        senderRole: input.actor.roleLabel,
        body: input.resolutionBody.trim(),
        meta: { type: "resolution" },
      });
    }

    await tx.insert(complaintStatusHistory).values({
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: input.toStatus,
      changedByMembershipId: input.actor.membershipId,
      changedByName: input.actor.name,
      changedByRole: input.actor.roleLabel,
      note: input.note?.trim() || null,
      changedAt: now,
    });

    await tx.insert(complaintMessages).values({
      complaintId: complaint.id,
      senderType: "system",
      senderName: "WorkTrack",
      body: `Status changed from ${labelFor(complaint.status as ComplaintStatus)} to ${labelFor(input.toStatus)}.`,
      meta: { type: "status_change", fromStatus: complaint.status, toStatus: input.toStatus },
    });

    await tx
      .update(complaints)
      .set({
        status: input.toStatus,
        lastMessageAt: now,
        updatedAt: now,
        resolvedAt: input.toStatus === "resolved" ? now : complaint.resolvedAt,
        reopenedAt: input.toStatus === "reopened" ? now : complaint.reopenedAt,
        unreadByManagement: input.actorSide === "staff",
        unreadByStaff: input.actorSide !== "staff",
      })
      .where(eq(complaints.id, complaint.id));

    return { ok: true as const };
  });
}

/**
 * Soft-delete a complaint at the employee's request. The record and its
 * conversation stay in Postgres for audit, but disappear from every inbox and
 * can no longer be opened or replied to.
 */
export async function withdrawComplaint(input: {
  complaintId: string;
  actor: ComplaintActor;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [complaint] = await tx
      .select()
      .from(complaints)
      .where(and(eq(complaints.id, input.complaintId), isNull(complaints.withdrawnAt)))
      .limit(1);
    if (!complaint) return { ok: false as const, message: "Complaint not found." };
    if (input.actor.role !== "staff" || complaint.employeeId !== input.actor.employeeId) {
      return { ok: false as const, message: "Only the employee who raised this complaint can withdraw it." };
    }

    await tx.insert(complaintMessages).values({
      complaintId: complaint.id,
      senderType: "system",
      senderName: "WorkTrack",
      body: `Complaint withdrawn by ${input.actor.name}.`,
    });
    await tx
      .update(complaints)
      .set({
        withdrawnAt: now,
        withdrawnByMembershipId: input.actor.membershipId,
        unreadByManagement: false,
        unreadByStaff: false,
        updatedAt: now,
      })
      .where(eq(complaints.id, complaint.id));
    return { ok: true as const };
  });
}

export async function reapPendingComplaintAttachments() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(complaintMessageAttachments)
    .where(and(isNull(complaintMessageAttachments.messageId), lt(complaintMessageAttachments.createdAt, cutoff)))
    .limit(50);
  if (!stale.length) return [] as string[];
  await db
    .delete(complaintMessageAttachments)
    .where(and(isNull(complaintMessageAttachments.messageId), lt(complaintMessageAttachments.createdAt, cutoff)));
  return stale.map((r) => r.storagePath);
}

function labelFor(status: ComplaintStatus): string {
  switch (status) {
    case "new": return "New";
    case "in_progress": return "In Progress";
    case "awaiting_staff": return "Awaiting Staff";
    case "resolved": return "Resolved";
    case "reopened": return "Reopened";
  }
}
