
/**
 * WorkTrack invitation email configuration. All values come from env —
 * secrets stay server-only. Sending is OFF unless explicitly enabled.
 */

export type EmailMode = "off" | "test" | "live";

export interface EmailConfig {
  enabled: boolean;
  mode: EmailMode;
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  senderMailbox: string | null;
  appUrl: string | null;
  testRecipient: string | null;
}

export function emailConfig(): EmailConfig {
  const rawMode = (process.env.WORKTRACK_EMAIL_MODE ?? "").trim().toLowerCase();
  const enabled = process.env.WORKTRACK_EMAIL_ENABLED === "true";
  const mode: EmailMode = !enabled ? "off" : rawMode === "test" ? "test" : "live";
  return {
    enabled,
    mode,
    tenantId: process.env.GRAPH_TENANT_ID?.trim() || null,
    clientId: process.env.GRAPH_CLIENT_ID?.trim() || null,
    clientSecret: process.env.GRAPH_CLIENT_SECRET || null,
    senderMailbox: process.env.GRAPH_SENDER_MAILBOX?.trim() || null,
    appUrl: process.env.WORKTRACK_APP_URL?.trim().replace(/\/+$/, "") || null,
    testRecipient: process.env.WORKTRACK_EMAIL_TEST_RECIPIENT?.trim() || null,
  };
}

/** Why sending cannot proceed, or null when the config is usable. */
export function emailConfigProblem(cfg: EmailConfig): string | null {
  if (cfg.mode === "off") return "Email delivery is disabled.";
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    return "Microsoft Graph credentials are not configured.";
  }
  if (!cfg.senderMailbox) return "GRAPH_SENDER_MAILBOX is not configured.";
  if (!cfg.appUrl) return "WORKTRACK_APP_URL is not configured.";
  if (cfg.mode === "test" && !cfg.testRecipient) {
    return "WORKTRACK_EMAIL_TEST_RECIPIENT is required in test mode.";
  }
  return null;
}

/** Resolves the actual recipient — test mode always redirects to the test mailbox. */
export function resolveRecipient(cfg: EmailConfig, intendedEmail: string): string {
  return cfg.mode === "test" ? (cfg.testRecipient as string) : intendedEmail;
}
