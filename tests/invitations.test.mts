import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptInvitationToken,
  encryptInvitationToken,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  invitationStatus,
  isValidEmail,
  normalizeEmail,
  validateInvitationAssignment,
} from "../src/lib/worklog/invitations";

const base = {
  email: "Jane.Doe@Company.com",
  role: "staff",
  employerOrganisationId: "org-1",
  workArrangement: "in_house",
};

test("email normalisation and validation", () => {
  assert.equal(normalizeEmail("  Jane@X.com "), "jane@x.com");
  assert.ok(isValidEmail("a@b.co"));
  assert.ok(!isValidEmail("not-an-email"));
  assert.ok(!isValidEmail("a@b"));
  assert.ok(!isValidEmail(`${"x".repeat(250)}@b.co`));
});

test("invitation assignment validation", () => {
  assert.deepEqual(validateInvitationAssignment(base), { ok: true });
  assert.equal(validateInvitationAssignment({ ...base, email: "bad" }).ok, false);
  assert.equal(validateInvitationAssignment({ ...base, role: "chairman" }).ok, false);
  assert.equal(validateInvitationAssignment({ ...base, role: "admin" }).ok, false);
  assert.equal(validateInvitationAssignment({ ...base, employerOrganisationId: "" }).ok, false);
  assert.equal(validateInvitationAssignment({ ...base, workArrangement: "remote" }).ok, false);
  // client_site requires a client
  assert.equal(
    validateInvitationAssignment({ ...base, workArrangement: "client_site" }).ok,
    false
  );
  assert.deepEqual(
    validateInvitationAssignment({ ...base, workArrangement: "client_site", clientOrganisationId: "c1" }),
    { ok: true }
  );
  // in_house must not carry a client
  assert.equal(
    validateInvitationAssignment({ ...base, clientOrganisationId: "c1" }).ok,
    false
  );
});

test("token generation, hashing and round-trip encryption", () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-invitations";
  const token = generateInvitationToken();
  assert.ok(token.length >= 40);
  assert.notEqual(generateInvitationToken(), token);
  assert.equal(hashInvitationToken(token).length, 64);
  const cipher = encryptInvitationToken(token);
  assert.notEqual(cipher, token);
  assert.ok(!cipher.includes(token));
  assert.equal(decryptInvitationToken(cipher), token);
  assert.equal(decryptInvitationToken("garbage"), null);
});

test("invitation status derivation", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const future = "2026-11-20T00:00:00Z";
  const past = "2026-11-01T00:00:00Z";
  assert.equal(invitationStatus({ expiresAt: future }, now), "pending");
  assert.equal(invitationStatus({ acceptedAt: now.toISOString() }, now), "accepted");
  assert.equal(invitationStatus({ revokedAt: now.toISOString() }, now), "revoked");
  assert.equal(invitationStatus({ expiresAt: past }, now), "expired");
  assert.equal(invitationStatus({ expiresAt: past, acceptedAt: now.toISOString() }, now), "accepted");
  assert.equal(invitationStatus({ expiresAt: past, revokedAt: now.toISOString() }, now), "revoked");
  // accepted/revoked take precedence over expiry
  assert.equal(invitationStatus({}, now), "pending");
  assert.ok(invitationExpiry(now).getTime() > now.getTime());
});
