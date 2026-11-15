
/** WorkTrack invitation email — HTML + plain-text pair. */

export interface InvitationEmailData {
  recipientEmail: string;
  recipientName: string | null;
  roleLabel: string;
  workArrangementLabel: string;
  employerName: string | null;
  clientName: string | null;
  teamName: string | null;
  inviteUrl: string;
  expiresAt: Date;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function invitationEmailSubject(): string {
  return "You're invited to WorkTrack";
}

export function buildInvitationEmail(d: InvitationEmailData): { html: string; text: string } {
  const greeting = d.recipientName ? `Hi ${esc(d.recipientName)},` : "Hello,";
  const details: [string, string][] = [
    ["Role", d.roleLabel],
    ["Work arrangement", d.workArrangementLabel],
  ];
  if (d.employerName) details.push(["Employer", d.employerName]);
  if (d.clientName) details.push(["Client", d.clientName]);
  if (d.teamName) details.push(["Team", d.teamName]);

  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#666783;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#17172B">${esc(v)}</td></tr>`
    )
    .join("");

  const expiry = d.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F7F6FC;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="background:#ffffff;border:1px solid #EAE8F2;border-radius:20px;padding:32px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
        <span style="display:inline-block;width:34px;height:34px;border-radius:10px;background:#6C45F5;color:#fff;font-size:18px;font-weight:800;line-height:34px;text-align:center">W</span>
        <span style="font-size:18px;font-weight:800;color:#17172B;letter-spacing:-0.3px">WorkTrack</span>
      </div>
      <h1 style="margin:0 0 12px;font-size:20px;color:#17172B">You're invited to WorkTrack</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#4A4E66">${greeting}<br><br>
        You've been invited to join WorkTrack, the team work-recording platform used by your organisation.
        Accept the invitation below to set up your account.</p>
      <table style="border-collapse:collapse;margin:0 0 24px">${rows}</table>
      <a href="${esc(d.inviteUrl)}" style="display:inline-block;background:#6040E8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:12px">Accept invitation</a>
      <p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#8B8B9A">This invitation expires on <strong>${expiry}</strong> and can only be used once.
        Sign in with your invited Microsoft company account — the invitation is tied to <strong>${esc(d.recipientEmail)}</strong>.</p>
      <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#8B8B9A">If the button doesn't work, paste this link into your browser:<br>
        <a href="${esc(d.inviteUrl)}" style="color:#6040E8;word-break:break-all">${esc(d.inviteUrl)}</a></p>
      <p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#8B8B9A">If you weren't expecting this invitation, you can ignore this email or contact your administrator.</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#A6A8BC;margin-top:16px">WorkTrack · Time tracking &amp; team reporting</p>
  </div>
</body></html>`;

  const text = [
    greeting,
    "",
    "You've been invited to join WorkTrack, the team work-recording platform used by your organisation.",
    "Accept the invitation below to set up your account.",
    "",
    ...details.map(([k, v]) => `${k}: ${v}`),
    "",
    `Accept invitation: ${d.inviteUrl}`,
    "",
    `This invitation expires on ${expiry} and can only be used once.`,
    `Sign in with your invited Microsoft company account — the invitation is tied to ${d.recipientEmail}.`,
    "",
    "If you weren't expecting this invitation, you can ignore this email or contact your administrator.",
    "",
    "WorkTrack · Time tracking & team reporting",
  ].join("\n");

  return { html, text };
}
