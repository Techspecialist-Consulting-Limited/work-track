import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, getRequestMembership } from "@/lib/auth/authorize";
import {
  addComplaintReply,
  canManageComplaintsMembership,
  getComplaintById,
  getComplaintRecords,
  markComplaintRead,
  setComplaintStatus,
  type ComplaintActor,
} from "@/lib/complaints/server";
import type { ComplaintStatus } from "@/lib/complaints/types";

type Params = { params: Promise<{ id: string }> };

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

async function ensureAccess(membership: NonNullable<Awaited<ReturnType<typeof getRequestMembership>>>, complaintId: string) {
  const row = await getComplaintById(complaintId);
  if (!row) return { ok: false as const, status: 404, message: "Complaint not found." };
  const canManage = await canManageComplaintsMembership(membership);
  if (canManage) return { ok: true as const, row, mode: "management" as const };
  if (membership.role === "staff" && membership.employeeId && row.employeeId === membership.employeeId) {
    return { ok: true as const, row, mode: "staff" as const };
  }
  return { ok: false as const, status: 404, message: "Complaint not found." };
}

export async function GET(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const { id } = await params;
    const access = await ensureAccess(membership, id);
    if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });

    await markComplaintRead(id, access.mode);

    const records = access.mode === "management"
      ? await getComplaintRecords({ type: "management" })
      : await getComplaintRecords({ type: "staff", employeeId: membership.employeeId! });
    const complaint = records.find((c) => c.id === id) ?? null;
    if (!complaint) return NextResponse.json({ ok: false, message: "Complaint not found." }, { status: 404 });
    return NextResponse.json({ ok: true, complaint });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Could not load complaint." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  await connection();
  try {
    const membership = await getRequestMembership(request);
    if (!membership) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const { id } = await params;
    const access = await ensureAccess(membership, id);
    if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });

    const body = (await request.json().catch(() => ({}))) as {
      type?: "reply" | "setStatus" | "markRead";
      body?: string;
      attachmentIds?: string[];
      requestInfo?: boolean;
      toStatus?: ComplaintStatus;
      note?: string;
      resolutionBody?: string;
    };

    if (body.type === "markRead") {
      await markComplaintRead(id, access.mode);
      return NextResponse.json({ ok: true });
    }

    if (body.type === "reply") {
      const result = await addComplaintReply({
        complaintId: id,
        actor: actorFromMembership(membership),
        senderType: access.mode,
        body: body.body ?? "",
        attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds : [],
        requestInfo: access.mode === "management" ? Boolean(body.requestInfo) : false,
      });
      if (!result.ok) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }

    if (body.type === "setStatus") {
      if (access.mode !== "management") {
        return NextResponse.json({ ok: false, message: "Only admins can change complaint status." }, { status: 403 });
      }
      const result = await setComplaintStatus({
        complaintId: id,
        actor: actorFromMembership(membership),
        toStatus: body.toStatus as ComplaintStatus,
        note: body.note,
        resolutionBody: body.resolutionBody,
      });
      if (!result.ok) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, message: "Action failed." }, { status: 500 });
  }
}
