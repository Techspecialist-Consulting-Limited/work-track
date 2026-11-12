import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const INVITATION_TTL_DAYS = 14;
export const INVITATION_ROLES = ["staff", "hr"] as const;
export type InvitableRole = (typeof INVITATION_ROLES)[number];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Raw single-use token (32 random bytes, base64url). Returned once at creation. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cipherKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  return createHash("sha256").update(`worktrack-invite:${secret}`).digest();
}

/** Encrypts the raw token so admins can re-copy the invite link later. */
export function encryptInvitationToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptInvitationToken(cipherText: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = cipherText.split(".");
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export function invitationStatus(
  invite: { acceptedAt?: Date | string | null; revokedAt?: Date | string | null; expiresAt?: Date | string | null },
  now: Date = new Date()
): InvitationStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

export function invitationExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface InvitationAssignmentInput {
  email: string;
  role: string;
  employerOrganisationId: string;
  workArrangement: string;
  clientOrganisationId?: string | null;
  teamId?: string | null;
}

/**
 * Validates the admin-submitted invitation shape. Organisation existence,
 * kind and active-state checks happen in the server action against the DB.
 */
export function validateInvitationAssignment(
  input: InvitationAssignmentInput
): { ok: true } | { ok: false; message: string } {
  if (!isValidEmail(normalizeEmail(input.email))) {
    return { ok: false, message: "Enter a valid work email address." };
  }
  if (!(INVITATION_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, message: "Invitations can only assign the Staff or HR role." };
  }
  if (!input.employerOrganisationId) {
    return { ok: false, message: "Select the employer organisation." };
  }
  if (input.workArrangement !== "in_house" && input.workArrangement !== "client_site") {
    return { ok: false, message: "Select a work arrangement." };
  }
  if (input.workArrangement === "client_site" && !input.clientOrganisationId) {
    return { ok: false, message: "Client-site staff require an assigned client organisation." };
  }
  if (input.workArrangement === "in_house" && input.clientOrganisationId) {
    return { ok: false, message: "In-house staff cannot have a client organisation." };
  }
  return { ok: true };
}
