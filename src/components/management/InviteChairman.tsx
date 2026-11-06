"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UserPlus, X } from "lucide-react";
import { inviteChairman } from "@/lib/worklog/repository";

/** HR/Chairman only: invite the chairman by email. They activate on first Entra sign-in. */
export function InviteChairman({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await inviteChairman(email);
    setBusy(false);
    if (result?.ok) {
      setMessage({
        ok: true,
        text: `Invitation sent to ${email.trim()}. They'll get chairman access when they sign in with that Microsoft account.`,
      });
      setEmail("");
    } else {
      setMessage({ ok: false, text: result?.message ?? "Could not send the invitation. Try again." });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage(null);
        }}
        aria-haspopup="dialog"
        className={
          compact
            ? "rounded-lg border border-[#EAE8F2] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#5A3ED0] transition hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            : "inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
        }
      >
        <UserPlus size={compact ? 13 : 15} aria-hidden="true" />
        Invite Chairman
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-[#17172B]/40 p-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Invite chairman"
                className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:p-6"
              >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#17172B]">Invite Chairman</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#666783]">
                  Enter their Microsoft work email. Once they sign in with that account, they&apos;ll get chairman access automatically.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#777A91] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <label htmlFor="chairman-email" className="mb-1.5 block text-xs font-semibold text-[#4A4665]">
              Microsoft email
            </label>
            <input
              id="chairman-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="name@company.com"
              className="h-11 w-full rounded-xl border border-[#E2E2EE] bg-white px-3 text-[16px] text-[#17172B] outline-none transition placeholder:text-[#A9A9BC] focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/20 sm:text-sm"
            />

            {message ? (
              <p
                role="status"
                className={`mt-3 rounded-xl px-3 py-2.5 text-[13px] font-medium leading-5 ${
                  message.ok ? "bg-[#E8F7EE] text-[#177A3D]" : "bg-[#FDECEC] text-[#B42318]"
                }`}
              >
                {message.text}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-11 flex-1 rounded-xl border border-[#E7E6F0] text-sm font-semibold text-[#4A4665] transition hover:bg-[#F7F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !email.trim()}
                className="h-11 flex-1 rounded-xl bg-[#6C45F5] text-sm font-bold text-white transition hover:bg-[#5935DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
