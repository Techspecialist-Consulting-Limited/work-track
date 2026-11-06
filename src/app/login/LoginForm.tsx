"use client";

import { useState, useTransition } from "react";
import { Briefcase, ChevronRight, Landmark, ShieldCheck, Users } from "lucide-react";
import { chooseRole } from "./actions";
import type { WorkTrackRole } from "@/lib/auth/authorize";

const ROLES: { id: WorkTrackRole; title: string; description: string; icon: typeof Users }[] = [
  {
    id: "staff",
    title: "Staff",
    description: "Log your tasks, work entries, breaks and overtime.",
    icon: Briefcase,
  },
  {
    id: "hr",
    title: "HR / Head of Operations",
    description: "View the team board, records, reports and exports.",
    icon: Users,
  },
  {
    id: "chairman",
    title: "Chairman",
    description: "Log in as the head of the organization.",
    icon: Landmark,
  },
];

export function LoginForm() {
  const [role, setRole] = useState<WorkTrackRole | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#159947] text-white">
          <ShieldCheck size={22} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-[#17172B]">Welcome to WorkTrack</h1>
        <p className="mt-1 text-sm text-[#666783]">Choose how you access WorkTrack.</p>
      </div>

      <div className="space-y-2.5" role="radiogroup" aria-label="Select your role">
        {ROLES.map((r) => {
          const Icon = r.icon;
          const selected = role === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setRole(r.id)}
              className={`flex w-full items-center gap-3.5 rounded-2xl border bg-white px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
                selected ? "border-[#6040E8] ring-1 ring-[#6040E8]" : "border-[#EAE8F2] hover:border-[#D8D4F0]"
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
                  selected ? "bg-[#6040E8] text-white" : "bg-[#F1F0F6] text-[#666783]"
                }`}
              >
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-[#17172B]">{r.title}</span>
                <span className="block text-[12px] leading-4 text-[#666783]">{r.description}</span>
              </span>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition ${
                  selected ? "border-[#6040E8] bg-[#6040E8]" : "border-[#D8D4F0]"
                }`}
                aria-hidden="true"
              >
                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {error ? <p role="alert" className="mt-3 text-center text-xs text-[#B43A3A]">{error}</p> : null}

      <button
        type="button"
        disabled={!role || pending}
        onClick={() => {
          if (!role) return;
          setError(null);
          startTransition(async () => {
            try {
              await chooseRole(role);
            } catch (e) {
              // NEXT_REDIRECT is Next.js navigation, not an error — let it through.
              const digest = (e as { digest?: string })?.digest;
              if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return;
              setError(e instanceof Error ? e.message : "Sign-in could not be started. Try again.");
            }
          });
        }}
        className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#6040E8] text-sm font-bold text-white shadow-sm transition hover:bg-[#4F31D0] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] focus-visible:ring-offset-2"
      >
        {pending ? "Redirecting…" : "Continue with Microsoft"}
        {!pending ? <ChevronRight size={16} aria-hidden="true" /> : null}
      </button>

      <p className="mt-4 text-center text-[11px] leading-4 text-[#9292A8]">
        Sign-in is handled by your organisation&apos;s Microsoft account. Access is granted only to
        pre-configured WorkTrack members.
      </p>
    </div>
  );
}
