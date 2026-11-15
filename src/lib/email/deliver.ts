import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invitations, organisations, teams } from "@/lib/db/schema";
import { decryptInvitationToken } from "@/lib/worklog/invitations";
import { emailConfig, emailConfigProblem, resolveRecipient, type EmailConfig } from "./config";
import { sendMail, GraphMailError } from "./graph";
import { buildInvitationEmail, invitationEmailSubject } from "./invitation-email";

export type EmailDeliveryStatus = "sent" | "failed" | "skipped";

export interface DeliveryResult {
  status: EmailDeliveryStatus;
  /** Safe-to-show reason; never contains tokens or URLs. */
  detail?: string;
}

const ROLE_LABELS: Record<string, string> = {
  staff: "Staff",
  hr: "HR / Head of Operations",
  chairman: "Chairman",
};

/**
 * Delivers (or attempts) the invitation email for an existing invitation
 * row. Never creates invitations and never regenerates tokens — call after
 * create/resend commits, or for an explicit retry.
 */
export async function deliverInvitationEmail(
  invitationId: string,
  cfg: EmailConfig = emailConfig()
): Promise<DeliveryResult> {
  const record = async (status: EmailDeliveryStatus, detail?: string) => {
    await db
      .update(invitations)
      .set({
        emailStatus: status,
        emailAttemptedAt: new Date(),
        emailLastError: status === "failed" ? (detail ?? "send failed").slice(0, 300) : null,
        updatedAt: new Date(),
      })
      .where(eq(invitations.id, invitationId));
    return { status, detail };
  };

  const invite = (
    await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1)
  )[0];
  if (!invite) return { status: "failed", detail: "Invitation not found." };

  const problem = emailConfigProblem(cfg);
  if (problem) return record("skipped", problem);

  // Only pending invitations with a recoverable token may be emailed.
  if (invite.acceptedAt || invite.revokedAt || !invite.expiresAt || invite.expiresAt < new Date()) {
    return record("skipped", "Invitation is no longer pending.");
  }
  const token = invite.tokenCipher ? decryptInvitationToken(invite.tokenCipher) : null;
  if (!token || !invite.tokenHash) {
    return record("skipped", "Invitation link is unavailable.");
  }

  const [employer, client, team] = await Promise.all([
    invite.employerOrganisationId
      ? db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, invite.employerOrganisationId)).limit(1)
      : Promise.resolve([]),
    invite.clientOrganisationId
      ? db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, invite.clientOrganisationId)).limit(1)
      : Promise.resolve([]),
    invite.teamId
      ? db.select({ name: teams.name }).from(teams).where(eq(teams.id, invite.teamId)).limit(1)
      : Promise.resolve([]),
  ]);

  const inviteUrl = `${cfg.appUrl}/invite/${token}`;
  const { html } = buildInvitationEmail({
    recipientEmail: invite.email,
    recipientName: null,
    roleLabel: ROLE_LABELS[invite.role] ?? invite.role,
    workArrangementLabel: invite.workArrangement === "client_site" ? "Client-site" : "In-house",
    employerName: employer[0]?.name ?? null,
    clientName: client[0]?.name ?? null,
    teamName: team[0]?.name ?? null,
    inviteUrl,
    expiresAt: invite.expiresAt,
  });

  const to = resolveRecipient(cfg, invite.email);
  try {
    await sendMail(cfg, to, invitationEmailSubject(), html);
    // Graph accepted the message — not a delivery guarantee.
    return record("sent", cfg.mode === "test" ? `Test mode → ${to}` : undefined);
  } catch (e) {
    const msg = e instanceof GraphMailError ? e.message : "Email send failed.";
    console.error(`[email] invitation ${invitationId} delivery failed:`, msg);
    return record("failed", msg);
  }
}
