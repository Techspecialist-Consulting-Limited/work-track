import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";

/**
 * Microsoft Entra access-token verification for the WorkTrack API.
 *
 * Mobile clients obtain a delegated access token for the WorkTrack API
 * (custom scope, e.g. `api://<app-id>/WorkTrack.Access`) from Microsoft
 * Entra via MSAL. This module verifies:
 *   - RS256 signature against the tenant's published JWKS
 *   - issuer (single-tenant v2 endpoint)
 *   - audience (the WorkTrack API identifier — Graph/other-audience tokens rejected)
 *   - expiry / not-before (enforced by jwtVerify)
 *   - `tid` claim matches the configured tenant
 *   - `scp`/`roles` contains the required delegated scope
 *   - `azp` (authorized party) is the configured mobile client, when set
 *   - `oid` claim present (the stable user identity)
 *
 * ID tokens are rejected because they carry the client/app audience, not
 * the WorkTrack API audience, and are not valid access tokens.
 */

export interface EntraIdentity {
  oid: string;
  tid: string;
  /** Display name claim, when present. */
  name: string | null;
  /** email or preferred_username claim, when present. May be absent — see redeem route. */
  email: string | null;
}

export interface TokenVerifierOptions {
  /** JWKS resolver — injectable for tests. */
  jwks: JWTVerifyGetKey;
  issuer: string;
  /** Accepted `aud` values. Entra emits the bare appId GUID for scopes a
   *  client requests on its own registration, and the `api://` URI form
   *  otherwise — both denote the same app, so both are accepted. */
  audience: string | string[];
  tenantId: string;
  /** When set, the token's `azp`/`appid` must match one of these client ids. */
  allowedClientIds?: string[];
  /** Required delegated scope (checked against `scp` and `roles` claims). */
  requiredScope: string;
}

export type BearerFailureCategory =
  | "malformed"
  | "signature"
  | "issuer"
  | "audience"
  | "expiry"
  | "tenant"
  | "scope"
  | "client_id"
  | "claims";

export class EntraTokenError extends Error {
  constructor(
    message: string,
    public category: BearerFailureCategory = "malformed"
  ) {
    super(message);
    this.name = "EntraTokenError";
  }
}

/** Dev-safe structured log for bearer-token failures — never logs token material. */
function logBearerFailure(category: BearerFailureCategory, detail: string) {
  console.warn(`[auth:bearer] ${category}: ${detail}`);
}

/** Maps a jose JWT verification failure to a diagnostic category. */
function categorizeJwtError(e: unknown): { category: BearerFailureCategory; detail: string } {
  const code = (e as { code?: string })?.code;
  const claim = (e as { claim?: string })?.claim;
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return { category: "expiry", detail: `token expired${claim ? ` (claim ${claim})` : ""}` };
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (claim === "aud") return { category: "audience", detail: "audience mismatch" };
      if (claim === "iss") return { category: "issuer", detail: "issuer mismatch" };
      if (claim === "iat" || claim === "nbf") return { category: "expiry", detail: `time claim invalid (${claim})` };
      return { category: "claims", detail: `claim validation failed (${claim ?? "unknown"})` };
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return { category: "signature", detail: "signature verification failed" };
    case "ERR_JWS_INVALID":
      return { category: "malformed", detail: "malformed JWS" };
    case "ERR_JWT_INVALID":
      return { category: "malformed", detail: "invalid JWT structure" };
    default:
      return { category: "signature", detail: message.slice(0, 160) };
  }
}

function claimString(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasScope(payload: JWTPayload, scope: string): boolean {
  const scp = claimString(payload, "scp");
  if (scp && scp.split(" ").includes(scope)) return true;
  const roles = payload["roles"];
  if (Array.isArray(roles) && roles.includes(scope)) return true;
  return false;
}

/**
 * Verifies a WorkTrack API access token and returns the Entra identity.
 * Throws EntraTokenError on any validation failure.
 */
export async function verifyEntraAccessToken(
  token: string,
  options: TokenVerifierOptions
): Promise<EntraIdentity> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "tid", "oid"],
    });
    payload = result.payload;
  } catch (e) {
    if (e instanceof EntraTokenError) throw e;
    const { category, detail } = categorizeJwtError(e);
    logBearerFailure(category, detail);
    throw new EntraTokenError(
      e instanceof Error ? `Invalid token: ${e.message}` : "Invalid token.",
      category
    );
  }

  const tid = claimString(payload, "tid");
  const oid = claimString(payload, "oid");
  if (!tid || !oid) {
    logBearerFailure("claims", "missing tid or oid claim");
    throw new EntraTokenError("Token is missing tenant or object id claims.", "claims");
  }
  if (tid !== options.tenantId) {
    logBearerFailure("tenant", `tid ${tid} != configured tenant`);
    throw new EntraTokenError("Token was issued for a different tenant.", "tenant");
  }

  if (!hasScope(payload, options.requiredScope)) {
    logBearerFailure("scope", `scp=${claimString(payload, "scp") ?? "none"} roles=${JSON.stringify(payload["roles"] ?? null)} missing ${options.requiredScope}`);
    throw new EntraTokenError("Token is missing the required WorkTrack API scope.", "scope");
  }

  if (options.allowedClientIds && options.allowedClientIds.length > 0) {
    const azp = claimString(payload, "azp") ?? claimString(payload, "appid");
    if (!azp || !options.allowedClientIds.includes(azp)) {
      logBearerFailure("client_id", `azp=${azp ?? "none"} not in allowed clients`);
      throw new EntraTokenError("Token was issued to an unexpected client application.", "client_id");
    }
  }

  return {
    oid,
    tid,
    name: claimString(payload, "name"),
    email: claimString(payload, "email") ?? claimString(payload, "preferred_username"),
  };
}

const remoteJwksCache = new Map<string, JWTVerifyGetKey>();

function verifierOptionsFromEnv(): TokenVerifierOptions {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const audience = process.env.ENTRA_API_AUDIENCE;
  const requiredScope = process.env.ENTRA_API_SCOPE ?? "WorkTrack.Access";
  if (!tenantId || !audience) {
    throw new EntraTokenError(
      "Mobile API auth is not configured (ENTRA_TENANT_ID / ENTRA_API_AUDIENCE missing)."
    );
  }
  let jwks = remoteJwksCache.get(tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
    remoteJwksCache.set(tenantId, jwks);
  }
  const clientId = process.env.ENTRA_MOBILE_CLIENT_ID;
  // Accept both `api://<app-id>` and bare `<app-id>` audience forms — Entra
  // issues the GUID form when a client requests a scope on its own app
  // registration (the mobile app shares the web registration).
  const audiences = audience.startsWith("api://")
    ? [audience, audience.slice("api://".length)]
    : [audience];
  return {
    jwks,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: audiences,
    tenantId,
    allowedClientIds: clientId ? [clientId] : undefined,
    requiredScope,
  };
}

/** Verifies a bearer token using environment configuration. */
export async function verifyWorkTrackBearerToken(token: string): Promise<EntraIdentity> {
  return verifyEntraAccessToken(token, verifierOptionsFromEnv());
}

const GRAPH_AUDIENCES = ["https://graph.microsoft.com", "00000003-0000-0000-c000-000000000000"];

/**
 * Verifies a Microsoft Graph access token (delegated, User.Read) and returns
 * the user's verified email from Graph `/me`. Used when a WorkTrack API
 * access token lacks an email claim — e.g. invitation redemption, where the
 * invited email must match a trustworthy identity.
 * Returns null when the token is invalid or Graph reports no email.
 */
export async function fetchVerifiedGraphEmail(graphToken: string): Promise<string | null> {
  const tenantId = process.env.ENTRA_TENANT_ID;
  if (!tenantId) return null;
  const jwks = remoteJwksCache.get(tenantId) ??
    createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  remoteJwksCache.set(tenantId, jwks);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(graphToken, jwks, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: GRAPH_AUDIENCES,
      algorithms: ["RS256"],
    }));
  } catch {
    return null;
  }
  if (!hasScope(payload, "User.Read")) return null;

  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${graphToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { mail?: string | null; userPrincipalName?: string | null };
    return me.mail ?? me.userPrincipalName ?? null;
  } catch {
    return null;
  }
}

/** Extracts the bearer token from an Authorization header, or null. */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
