import type { EmailConfig } from "./config";

/**
 * Minimal Microsoft Graph client-credentials mail sender.
 * Uses the dedicated invitation-sender app registration — never the mobile
 * public client and never Auth.js credentials.
 */

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const SEND_TIMEOUT_MS = 15_000;

export class GraphMailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
  }
}

async function graphAccessToken(cfg: EmailConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId!,
    client_secret: cfg.clientSecret!,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    throw new GraphMailError(`Token request failed (${res.status}).`, res.status, res.status >= 500);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new GraphMailError("Token response had no access_token.");
  return json.access_token;
}

/**
 * Sends an email via /users/{sender}/sendMail. A 202 means Graph ACCEPTED
 * the message — delivery to the recipient mailbox is not guaranteed.
 */
export async function sendMail(
  cfg: EmailConfig,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const token = await graphAccessToken(cfg);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.senderMailbox!)}/sendMail`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );
  if (res.status === 202 || res.ok) return;
  const retryable = res.status === 429 || res.status >= 500;
  let detail = "";
  try {
    const err = (await res.json()) as { error?: { code?: string; message?: string } };
    detail = err.error?.code ? ` ${err.error.code}` : "";
  } catch {
    /* ignore */
  }
  throw new GraphMailError(`Graph sendMail failed (${res.status}${detail}).`, res.status, retryable);
}
