"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Copy, MailPlus, RefreshCw, Send, Trash2 } from "lucide-react";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import {
  createEmployeeInvitation,
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getSessionUser,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import type { AdminInvitation } from "@/app/api/admin/invitations/route";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#FFF4E0] text-[#B45309]",
  accepted: "bg-[#EAF8F0] text-[#15803D]",
  expired: "bg-[#F1F0F6] text-[#6B6880]",
  revoked: "bg-[#FDECEC] text-[#B42318]",
};

function formatDay(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function InvitationsAdmin() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const sessionUser = getSessionUser();
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "hr">("staff");
  const [employerId, setEmployerId] = useState("");
  const [arrangement, setArrangement] = useState<"in_house" | "client_site">("in_house");
  const [clientId, setClientId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [saving, setSaving] = useState(false);

  const employers = useMemo(
    () => db.organisations.filter((org) => org.kind === "employer" && org.isActive),
    [db.organisations]
  );
  const clients = useMemo(
    () => db.organisations.filter((org) => org.kind === "client" && org.isActive),
    [db.organisations]
  );
  const teams = useMemo(() => db.teams.filter((team) => team.isActive), [db.teams]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invitations", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { invitations: AdminInvitation[] };
        setInvitations(data.invitations);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshAfter(promise: Promise<{ ok?: boolean; message?: string; inviteToken?: string } | null>, success: string) {
    setError(null);
    setNotice(null);
    try {
      const result = await promise;
      if (!result || result.ok === false) {
        setError(result?.message ?? "That change could not be saved.");
        return;
      }
      if (result.inviteToken) {
        const origin = window.location.origin;
        const link = `${origin}/invite/${result.inviteToken}`;
        try {
          await navigator.clipboard.writeText(link);
          setNotice(`${success} Invitation link copied to clipboard.`);
        } catch {
          setNotice(`${success} Copy the link before leaving — it is shown only once here.`);
          window.prompt("Invitation link", link);
        }
      } else {
        setNotice(success);
      }
      await load();
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  async function submit() {
    if (!email.trim() || !employerId || (arrangement === "client_site" && !clientId)) {
      setError("Complete the required fields — client-site staff need a client organisation.");
      return;
    }
    setSaving(true);
    try {
      await refreshAfter(
        createEmployeeInvitation({
          email: email.trim(),
          role,
          employerOrganisationId: employerId,
          workArrangement: arrangement,
          clientOrganisationId: arrangement === "client_site" ? clientId : null,
          teamId: teamId || null,
        }),
        "Invitation created."
      );
      setEmail("");
      setClientId("");
      setTeamId("");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(invite: AdminInvitation) {
    if (!invite.link) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("Invitation link", invite.link);
    }
  }

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-5 text-[#17172F] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
                <MailPlus size={20} className="text-[#6C45F5]" aria-hidden="true" />
                Employee invitations
              </h1>
              <p className="text-xs text-[#777A91]">
                Invite staff by work email — they sign in with Microsoft and land directly in their workspace.
              </p>
            </div>
          </div>
          <ProfileMenu
            name={db.employees.find((e) => e.id === getSessionEmployeeId())?.name ?? sessionUser?.name ?? "Account"}
            role={getSessionRole() === "chairman" ? "Chairman" : "Config admin"}
          />
        </header>

        {notice ? <p className="mb-3 rounded-xl bg-[#EAF8F0] px-4 py-2.5 text-sm font-semibold text-[#15803D]">{notice}</p> : null}
        {error ? <p className="mb-3 rounded-xl bg-[#FDECEC] px-4 py-2.5 text-sm font-semibold text-[#B42318]">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="h-fit rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold">New invitation</h2>
            <label className="mt-3 block text-[11px] font-semibold text-[#53506B]">
              Work email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className={INPUT_CLASS}
                autoComplete="off"
              />
            </label>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as "staff" | "hr")} className={INPUT_CLASS}>
                <option value="staff">Staff</option>
                <option value="hr">HR</option>
              </select>
            </label>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
              Employer organisation
              <select value={employerId} onChange={(e) => setEmployerId(e.target.value)} className={INPUT_CLASS}>
                <option value="">Select employer…</option>
                {employers.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
              Work arrangement
              <select
                value={arrangement}
                onChange={(e) => {
                  setArrangement(e.target.value as "in_house" | "client_site");
                  setClientId("");
                }}
                className={INPUT_CLASS}
              >
                <option value="in_house">In-house (Projects → Subtasks)</option>
                <option value="client_site">Client-site</option>
              </select>
            </label>
            {arrangement === "client_site" ? (
              <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
                Client organisation
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT_CLASS}>
                  <option value="">Select client…</option>
                  {clients.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
              Team (optional)
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={INPUT_CLASS}>
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
            >
              <Send size={15} aria-hidden="true" /> {saving ? "Creating…" : "Create invitation"}
            </button>
            <p className="mt-2 text-[11px] leading-4 text-[#8A8FA8]">
              No email provider is configured — copy the invitation link and share it with the employee directly.
            </p>
          </section>

          <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold">
              Invitations <span className="ml-1 rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">{invitations.length}</span>
            </h2>
            {loading ? (
              <p className="mt-4 text-sm text-[#777A91]">Loading invitations…</p>
            ) : invitations.length === 0 ? (
              <p className="mt-4 rounded-xl bg-[#F7F7FC] px-4 py-6 text-center text-sm text-[#777A91]">
                No invitations yet. Employee invitations you create will appear here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[#F0EFF6]">
                {invitations.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#17172F]">{invite.email}</p>
                      <p className="text-[11px] text-[#777A91]">
                        {invite.role === "hr" ? "HR" : "Staff"} · {invite.workArrangement === "client_site" ? "Client-site" : "In-house"}
                        {invite.employerName ? ` · ${invite.employerName}` : ""}
                        {invite.clientName ? ` → ${invite.clientName}` : ""}
                        {invite.teamName ? ` · ${invite.teamName}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[invite.status] ?? STATUS_STYLE.pending}`}>
                      {invite.status}
                    </span>
                    {invite.status === "pending" ? (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyLink(invite)}
                          disabled={!invite.link}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] transition hover:bg-[#F7F7FC] disabled:opacity-50"
                        >
                          <Copy size={12} aria-hidden="true" /> {copiedId === invite.id ? "Copied" : "Copy link"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshAfter(resendEmployeeInvitation(invite.id), "Invitation resent — new link copied.")}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] transition hover:bg-[#F7F7FC]"
                        >
                          <RefreshCw size={12} aria-hidden="true" /> Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshAfter(revokeEmployeeInvitation(invite.id), "Invitation revoked.")}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FDECEC] px-2.5 text-[11px] font-semibold text-[#B42318] transition hover:bg-[#FDECEC]"
                        >
                          <Trash2 size={12} aria-hidden="true" /> Revoke
                        </button>
                      </span>
                    ) : null}
                    <span className="text-[10px] text-[#8A8FA8]">
                      {invite.status === "pending" ? `expires ${formatDay(invite.expiresAt)}` : `created ${formatDay(invite.createdAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
