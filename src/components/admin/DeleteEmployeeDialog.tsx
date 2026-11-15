"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { AdminUser } from "@/app/api/admin/users/route";

/**
 * Permanent-deletion confirmation card. Replaces window.confirm() — shows the
 * exact employee record and consequences that match what deleteEmployeeAction
 * actually does (anonymise+preserve when work history exists, full removal
 * otherwise).
 */
export function DeleteEmployeeDialog({
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus the card on open; Escape closes (unless a delete is in flight).
  useEffect(() => {
    cardRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const roles = user.memberships.map((m) => m.role).join(", ") || "none";
  const arrangement =
    user.workArrangement === "client_site"
      ? `Client-site${user.clientName ? ` → ${user.clientName}` : ""}`
      : "In-house";
  const org = user.employerName ?? user.clientName ?? "—";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#17172F]/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-employee-title"
        aria-describedby="delete-employee-desc"
        tabIndex={-1}
        className="w-full max-w-md rounded-3xl border border-[#EAE8F2] bg-white p-6 shadow-[0_24px_60px_-12px_rgba(23,23,47,0.35)] outline-none"
      >
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FEF3F2] text-[#B42318]">
            <Trash2 size={19} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="delete-employee-title" className="text-lg font-bold tracking-tight text-[#17172B]">
              Delete employee?
            </h2>
            <p id="delete-employee-desc" className="mt-1 text-sm leading-5 text-[#666783]">
              This permanently removes {user.fullName.split(" ")[0]}&rsquo;s WorkTrack account. This cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8B8B9A] transition hover:bg-[#F7F6FC] hover:text-[#17172B] disabled:opacity-40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Employee identity card */}
        <dl className="mt-5 space-y-2.5 rounded-2xl border border-[#F0EFF6] bg-[#F7F6FC] px-4 py-3.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B9A]">Name</dt>
            <dd className="text-right font-semibold text-[#17172B]">{user.fullName}</dd>
          </div>
          {user.employeeCode ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#8B8B9A]">Employee code</dt>
              <dd className="font-mono text-[12px] text-[#17172B]">{user.employeeCode}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B9A]">Role</dt>
            <dd className="text-right font-semibold capitalize text-[#17172B]">{roles}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B9A]">Arrangement</dt>
            <dd className="text-right font-semibold text-[#17172B]">{arrangement}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B9A]">Organisation</dt>
            <dd className="text-right font-semibold text-[#17172B]">{org}</dd>
          </div>
        </dl>

        {/* Consequences — matches actual backend behaviour */}
        <div
          className={`mt-4 flex gap-3 rounded-2xl border px-4 py-3 ${
            user.hasWorkRecords
              ? "border-[#FDE68A] bg-[#FFFBEB]"
              : "border-[#FECACA] bg-[#FEF2F2]"
          }`}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#B45309]" aria-hidden="true" />
          <div className="text-[12px] leading-5 text-[#57534E]">
            {user.hasWorkRecords ? (
              <>
                <p className="font-semibold text-[#92400E]">This employee has recorded work.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Their account and Microsoft sign-in identity will be removed.</li>
                  <li>Their profile will be anonymised as “Deleted employee”.</li>
                  <li>Recorded work history is retained for company reporting.</li>
                  <li>If they return, they must complete fresh onboarding.</li>
                </ul>
              </>
            ) : (
              <>
                <p className="font-semibold text-[#B91C1C]">This cannot be undone.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Their active WorkTrack account will be removed.</li>
                  <li>Their Microsoft identity association will be removed.</li>
                  <li>Their employee profile will be fully removed.</li>
                  <li>They can register again as a new employee if they return.</li>
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl border border-[#E7E6F0] bg-white text-sm font-semibold text-[#53506B] transition hover:bg-[#F7F7FC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#B42318] text-sm font-bold text-white transition hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
            {busy ? "Deleting…" : "Delete employee"}
          </button>
        </div>
      </div>
    </div>
  );
}
