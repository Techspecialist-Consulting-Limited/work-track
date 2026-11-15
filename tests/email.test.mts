import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { emailConfig, emailConfigProblem, resolveRecipient } from "../src/lib/email/config";
import { buildInvitationEmail, invitationEmailSubject } from "../src/lib/email/invitation-email";

const baseEnv = { ...process.env };
function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in baseEnv)) delete process.env[k];
  Object.assign(process.env, baseEnv);
});

test("disabled mode reports off and skips delivery", () => {
  setEnv({ WORKTRACK_EMAIL_ENABLED: "false", WORKTRACK_EMAIL_MODE: "live" });
  const cfg = emailConfig();
  assert.equal(cfg.mode, "off");
  assert.ok(emailConfigProblem(cfg));
});

test("enabled without credentials reports a config problem", () => {
  setEnv({
    WORKTRACK_EMAIL_ENABLED: "true",
    WORKTRACK_EMAIL_MODE: "live",
    GRAPH_TENANT_ID: undefined,
    GRAPH_CLIENT_ID: undefined,
    GRAPH_CLIENT_SECRET: undefined,
    GRAPH_SENDER_MAILBOX: undefined,
    WORKTRACK_APP_URL: undefined,
  });
  const cfg = emailConfig();
  assert.equal(cfg.mode, "live");
  assert.ok(emailConfigProblem(cfg));
});

test("test mode redirects recipient to the test mailbox", () => {
  setEnv({
    WORKTRACK_EMAIL_ENABLED: "true",
    WORKTRACK_EMAIL_MODE: "test",
    GRAPH_TENANT_ID: "t",
    GRAPH_CLIENT_ID: "c",
    GRAPH_CLIENT_SECRET: "s",
    GRAPH_SENDER_MAILBOX: "worktrack@x.com",
    WORKTRACK_APP_URL: "https://wt.example.com",
    WORKTRACK_EMAIL_TEST_RECIPIENT: "qa@x.com",
  });
  const cfg = emailConfig();
  assert.equal(emailConfigProblem(cfg), null);
  assert.equal(resolveRecipient(cfg, "employee@x.com"), "qa@x.com");
});

test("live mode keeps the intended recipient", () => {
  setEnv({ WORKTRACK_EMAIL_ENABLED: "true", WORKTRACK_EMAIL_MODE: "live" });
  const cfg = emailConfig();
  assert.equal(resolveRecipient(cfg, "employee@x.com"), "employee@x.com");
});

test("email contains invite URL in both bodies and no raw token elsewhere", () => {
  const { html, text } = buildInvitationEmail({
    recipientEmail: "emp@x.com",
    recipientName: "Sam",
    roleLabel: "Staff",
    workArrangementLabel: "Client-site",
    employerName: "TechSpecialist",
    clientName: "BPP",
    teamName: null,
    inviteUrl: "https://wt.example.com/invite/SECRET-TOKEN",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  assert.ok(html.includes("SECRET-TOKEN"));
  assert.ok(text.includes("SECRET-TOKEN"));
  assert.ok(html.includes("Client-site"));
  assert.ok(html.includes("BPP"));
  assert.ok(!html.includes("undefined"));
  assert.equal(invitationEmailSubject(), "You're invited to WorkTrack");
});
