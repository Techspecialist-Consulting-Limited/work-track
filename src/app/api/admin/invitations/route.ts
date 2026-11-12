import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, requireConfigAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { invitations, organisations, teams } from "@/lib/db/schema";
import { asc, inArray } from "drizzle-orm";
import { decryptInvitationToken, invitationStatus } from "@/lib/worklog/invitations";

export type AdminInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  employerOrganisationId: string | null;
  clientOrganisationId: string | null;
  workArrangement: string | null;
  teamId: string | null;
  employerName: string | null;
  clientName: string | null;
  teamName: string | null;
  /** Present only for pending token invitations so admins can copy the link. */
  link: string | null;
};

export async function GET() {
  await connection();
  try {
    await requireConfigAdmin();
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const rows = await db.select().from(invitations).orderBy(asc(invitations.createdAt));
  const orgIds = [...new Set(rows.flatMap((r) => [r.employerOrganisationId, r.clientOrganisationId]).filter(Boolean))] as string[];
  const teamIds = [...new Set(rows.map((r) => r.teamId).filter(Boolean))] as string[];
  const orgRows = orgIds.length ? await db.select().from(organisations).where(inArray(organisations.id, orgIds)) : [];
  const teamRows = teamIds.length ? await db.select().from(teams).where(inArray(teams.id, teamIds)) : [];
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const list: AdminInvitation[] = rows.map((r) => {
    const status = invitationStatus(r);
    let link: string | null = null;
    if (status === "pending" && r.tokenCipher) {
      const token = decryptInvitationToken(r.tokenCipher);
      const origin = base ?? "";
      if (token && origin) link = `${origin.replace(/\/$/, "")}/invite/${token}`;
    }
    return {
      id: r.id,
      email: r.email,
      role: r.role,
      status,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      employerOrganisationId: r.employerOrganisationId,
      clientOrganisationId: r.clientOrganisationId,
      workArrangement: r.workArrangement,
      teamId: r.teamId,
      employerName: r.employerOrganisationId ? orgName.get(r.employerOrganisationId) ?? null : null,
      clientName: r.clientOrganisationId ? orgName.get(r.clientOrganisationId) ?? null : null,
      teamName: r.teamId ? teamName.get(r.teamId) ?? null : null,
      link,
    };
  });
  return NextResponse.json({ invitations: list });
}
