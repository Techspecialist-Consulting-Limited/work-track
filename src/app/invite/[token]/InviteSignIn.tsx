"use client";

import { useTransition } from "react";
import { Zap } from "lucide-react";
import { beginInvitationSignIn } from "../actions";

export function InviteSignIn({
  token,
  role,
  email,
}: {
  token: string;
  role: "staff" | "hr";
  email: string;
}) {
  const [pending, startTransition] = useTransition();
  const roleLabel = role === "hr" ? "HR / management" : "staff";

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5">
      <div className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#6C45F5] text-white">
          <Zap size={16} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-lg font-bold text-[#17172B]">You&apos;re invited to WorkTrack</h1>
        <p className="mt-2 text-sm leading-5 text-[#666783]">
          This invitation is for <strong className="text-[#17172B]">{email}</strong> with{" "}
          <strong className="text-[#17172B]">{roleLabel}</strong> access. Continue with your
          company Microsoft account — you&apos;ll be signed in directly to your workspace.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => beginInvitationSignIn(token))}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6040E8] px-5 text-sm font-bold text-white transition hover:bg-[#5133D1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? "Redirecting to Microsoft…" : "Continue with Microsoft"}
        </button>
        <p className="mt-3 text-xs text-[#8A8FA8]">
          The invitation is single-use and expires 14 days after it was created.
        </p>
      </div>
    </main>
  );
}
