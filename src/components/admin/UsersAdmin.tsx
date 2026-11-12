"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck, Trash2, UserCheck, UserX, Users } from "lucide-react";
import {
  deleteEmployee,
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  setEmployeeActive,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import type { AdminUser } from "@/app/api/admin/users/route";

function roleBadges(user: AdminUser) {
  return user.memberships.length ? (
    <span className="flex flex-wrap gap-1">
      {user.memberships.map((m, i) => (
        <span
          key={i}
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
            m.isConfigAdmin ? "bg-[#F5F1FF] text-[#5A3ED0]" : "bg-[#F1F0F6] text-[#6B6880]"
          }`}
        >
          {m.role}
          {m.isConfigAdmin ? " · admin" : ""}
          {!m.isActive ? " · off" : ""}
        </span>
      ))}
    </span>
  ) : (
    <span className="text-[10px] text-[#B45309]">No sign-in access</span>
  );
}

export function UsersAdmin() {
  useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const meEmployeeId = getSessionEmployeeId();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [unlinked, setUnlinked] = useState<{ role: string; isActive: boolean; isConfigAdmin: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { users: AdminUser[]; unlinkedMembers: typeof unlinked };
        setUsers(data.users);
        setUnlinked(data.unlinkedMembers);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(promise: Promise<{ ok?: boolean; message?: string } | null>, success: string) {
    setError(null);
    setNotice(null);
    try {
      const result = await promise;
      if (!result || result.ok === false) {
        setError(result?.message ?? "That change could not be saved.");
        return;
      }
      setNotice(success);
      await load();
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      {notice ? <p className="rounded-xl border border-[#C7EBD8] bg-[#ECFDF5] px-4 py-2.5 text-sm text-[#047857]">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-[#F6C7C7] bg-[#FDEEEE] px-4 py-2.5 text-sm text-[#B43A3A]">{error}</p> : null}

      <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Users size={15} className="text-[#6C45F5]" aria-hidden="true" /> Users
          <span className="ml-1 rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">{users.length}</span>
        </h2>
        <p className="mt-1 text-[11px] text-[#777A91]">
          Deactivated users are hidden from the Executive dashboard and cannot sign in. Users with recorded work can only be deactivated — their history is preserved.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-[#777A91]">Loading users…</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#F0EFF6]">
            {users.map((user) => {
              const isSelf = user.employeeId === meEmployeeId;
              return (
                <li key={user.employeeId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[#17172F]">
                      <span className="truncate">{user.fullName}</span>
                      {!user.isActive ? (
                        <span className="rounded-full bg-[#F1F0F6] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#6B6880]">Inactive</span>
                      ) : null}
                      {isSelf ? (
                        <span className="rounded-full bg-[#F5F1FF] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5A3ED0]">You</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-[#777A91]">
                      {user.jobTitle}{user.department ? ` · ${user.department}` : ""}
                      {user.employeeCode ? ` · ${user.employeeCode}` : ""}
                      {user.employerName ? ` · ${user.employerName}` : ""}
                      {user.workArrangement === "client_site" && user.clientName ? ` → ${user.clientName}` : ""}
                    </p>
                    <div className="mt-1">{roleBadges(user)}</div>
                  </div>
                  <span className="flex items-center gap-1.5">
                    {user.isActive ? (
                      <button
                        type="button"
                        disabled={busyId === user.employeeId || isSelf}
                        onClick={() => {
                          setBusyId(user.employeeId);
                          void act(setEmployeeActive(user.employeeId, false), `${user.fullName} deactivated.`).finally(() => setBusyId(null));
                        }}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FDECEC] px-2.5 text-[11px] font-semibold text-[#B42318] hover:bg-[#FDECEC] disabled:opacity-50"
                      >
                        <UserX size={12} aria-hidden="true" /> Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === user.employeeId}
                        onClick={() => {
                          setBusyId(user.employeeId);
                          void act(setEmployeeActive(user.employeeId, true), `${user.fullName} reactivated.`).finally(() => setBusyId(null));
                        }}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] hover:bg-[#F7F7FC] disabled:opacity-50"
                      >
                        <UserCheck size={12} aria-hidden="true" /> Reactivate
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === user.employeeId || isSelf || user.hasWorkRecords}
                      title={user.hasWorkRecords ? "Has recorded work — deactivate instead" : "Permanently delete"}
                      onClick={() => {
                        if (window.confirm(`Permanently delete ${user.fullName}? This cannot be undone.`)) {
                          setBusyId(user.employeeId);
                          void act(deleteEmployee(user.employeeId), `${user.fullName} deleted.`).finally(() => setBusyId(null));
                        }
                      }}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FDECEC] px-2.5 text-[11px] font-semibold text-[#B42318] hover:bg-[#FDECEC] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={12} aria-hidden="true" /> Delete
                    </button>
                  </span>
                </li>
              );
            })}
            {unlinked.length > 0 ? (
              <li className="py-3 text-[11px] text-[#777A91]">
                Sign-in only (no employee record): {unlinked.map((m) => `${m.role}${m.isConfigAdmin ? " (config admin)" : ""}`).join(", ")}
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <p className="flex items-center gap-1.5 text-[11px] text-[#8A8FA8]">
        <ShieldCheck size={12} aria-hidden="true" /> Only configuration admins can manage users. Deactivation takes effect on the next page load.
      </p>
    </div>
  );
}
