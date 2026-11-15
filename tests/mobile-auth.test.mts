import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type CryptoKey } from "jose";
import {
  bearerTokenFrom,
  EntraTokenError,
  verifyEntraAccessToken,
  type TokenVerifierOptions,
} from "../src/lib/auth/entra-token";
import { selectMembershipRole } from "../src/lib/auth/identity";

const TENANT = "11111111-2222-3333-4444-555555555555";
const AUDIENCE = "api://worktrack-api";
const SCOPE = "WorkTrack.Access";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const CLIENT_ID = "mobile-app-client-id";

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kid = "test-key-1";
jwk.alg = "RS256";
const jwks = createLocalJWKSet({ keys: [jwk] });

const other = await generateKeyPair("RS256", { extractable: true });

const opts: TokenVerifierOptions = {
  jwks,
  issuer: ISSUER,
  audience: AUDIENCE,
  tenantId: TENANT,
  allowedClientIds: [CLIENT_ID],
  requiredScope: SCOPE,
};

function baseClaims() {
  return {
    tid: TENANT,
    oid: "user-oid-123",
    scp: SCOPE,
    azp: CLIENT_ID,
    name: "Test User",
    email: "test@company.com",
  };
}

async function sign(claims: Record<string, unknown>, key: CryptoKey = privateKey, exp?: number) {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE);
  if (exp !== undefined) jwt = jwt.setExpirationTime(exp);
  else jwt = jwt.setExpirationTime("1h");
  return jwt.setIssuedAt().sign(key);
}

test("valid WorkTrack API access token resolves identity", async () => {
  const token = await sign(baseClaims());
  const identity = await verifyEntraAccessToken(token, opts);
  assert.equal(identity.oid, "user-oid-123");
  assert.equal(identity.tid, TENANT);
  assert.equal(identity.email, "test@company.com");
  assert.equal(identity.name, "Test User");
});

test("rejects token signed by a different key", async () => {
  const token = await sign(baseClaims(), other.privateKey);
  await assert.rejects(() => verifyEntraAccessToken(token, opts), EntraTokenError);
});

test("rejects wrong audience (e.g. Graph or ID-token audience)", async () => {
  const token = await sign(baseClaims());
  await assert.rejects(() => verifyEntraAccessToken(token, { ...opts, audience: "api://other-api" }), EntraTokenError);
});

test("rejects wrong tenant in tid claim", async () => {
  const token = await sign({ ...baseClaims(), tid: "99999999-9999-9999-9999-999999999999" });
  await assert.rejects(() => verifyEntraAccessToken(token, opts), /different tenant/);
});

test("rejects wrong issuer", async () => {
  const token = await sign(baseClaims());
  await assert.rejects(
    () => verifyEntraAccessToken(token, { ...opts, issuer: "https://login.microsoftonline.com/other/v2.0" }),
    EntraTokenError
  );
});

test("rejects expired token", async () => {
  const token = await sign(baseClaims(), privateKey, Math.floor(Date.now() / 1000) - 120);
  await assert.rejects(() => verifyEntraAccessToken(token, opts), EntraTokenError);
});

test("rejects token missing required scope", async () => {
  const token = await sign({ ...baseClaims(), scp: "User.Read" });
  await assert.rejects(() => verifyEntraAccessToken(token, opts), /scope/);
});

test("accepts scope via roles claim", async () => {
  const claims = { ...baseClaims(), roles: [SCOPE] } as Record<string, unknown>;
  delete claims.scp;
  const token = await sign(claims);
  const identity = await verifyEntraAccessToken(token, opts);
  assert.equal(identity.oid, "user-oid-123");
});

test("rejects token from unexpected client (azp)", async () => {
  const token = await sign({ ...baseClaims(), azp: "some-other-app" });
  await assert.rejects(() => verifyEntraAccessToken(token, opts), /client application/);
});

test("accepts token without azp check when no client ids configured", async () => {
  const token = await sign({ ...baseClaims(), azp: "any-app" });
  const identity = await verifyEntraAccessToken(token, { ...opts, allowedClientIds: undefined });
  assert.equal(identity.oid, "user-oid-123");
});

test("rejects token missing oid or tid", async () => {
  const noOidClaims = { ...baseClaims() } as Record<string, unknown>;
  delete noOidClaims.oid;
  const tokenNoOid = await sign(noOidClaims);
  await assert.rejects(() => verifyEntraAccessToken(tokenNoOid, opts));
  const noTidClaims = { ...baseClaims() } as Record<string, unknown>;
  delete noTidClaims.tid;
  const tokenNoTid = await sign(noTidClaims);
  await assert.rejects(() => verifyEntraAccessToken(tokenNoTid, opts));
});

test("extracts email from preferred_username when email absent", async () => {
  const claims = { ...baseClaims(), preferred_username: "upn@company.com" } as Record<string, unknown>;
  delete claims.email;
  const token = await sign(claims);
  const identity = await verifyEntraAccessToken(token, opts);
  assert.equal(identity.email, "upn@company.com");
});

test("bearerTokenFrom parses Authorization header", () => {
  const req = new Request("https://x.test/api", { headers: { authorization: "Bearer abc.def.ghi" } });
  assert.equal(bearerTokenFrom(req), "abc.def.ghi");
  assert.equal(bearerTokenFrom(new Request("https://x.test/api")), null);
  assert.equal(
    bearerTokenFrom(new Request("https://x.test/api", { headers: { authorization: "Basic xyz" } })),
    null
  );
});

/* ---------------- role selection ---------------- */

const staff = { role: "staff" as const };
const hr = { role: "hr" as const };

test("single membership resolves without explicit role", () => {
  assert.deepEqual(selectMembershipRole([staff]), { ok: true, role: "staff" });
});

test("multiple memberships require explicit role", () => {
  const result = selectMembershipRole([staff, hr]);
  assert.deepEqual(result, { ok: false, reason: "role_required" });
});

test("explicit role must be an actual membership", () => {
  assert.deepEqual(selectMembershipRole([staff, hr], "hr"), { ok: true, role: "hr" });
  assert.deepEqual(selectMembershipRole([staff], "hr"), { ok: false, reason: "role_not_granted" });
  assert.deepEqual(selectMembershipRole([staff], "chairman"), { ok: false, reason: "role_not_granted" });
  assert.deepEqual(selectMembershipRole([staff], "superadmin"), { ok: false, reason: "invalid_role" });
});

test("no memberships yields role_not_granted", () => {
  assert.deepEqual(selectMembershipRole([], "staff"), { ok: false, reason: "role_not_granted" });
});
