"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Home, Loader2 } from "lucide-react";
import { completeStaffOnboardingAction } from "./actions";

type Step = "arrangement" | "client" | "profile";

export function OnboardingForm({
  initialName,
  clients,
  employers,
}: {
  initialName: string;
  clients: { id: string; name: string }[];
  employers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("arrangement");
  const [arrangement, setArrangement] = useState<"in_house" | "client_site" | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const employerName = employers.length === 1 ? employers[0].name : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await completeStaffOnboardingAction({
        workArrangement: arrangement!,
        clientOrganisationId: arrangement === "client_site" ? clientId : null,
        jobTitle,
        department,
      });
      if (result.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#EAE8F2] bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#6C45F5] text-white">
            <Home size={20} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-[#17172B]">Set up your account</h1>
          <p className="mt-1 text-sm text-[#666783]">
            {step === "arrangement" && "Where do you work?"}
            {step === "client" && "Which client do you work for?"}
            {step === "profile" && "Almost done — confirm your details."}
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]" role="alert">
            {error}
          </p>
        ) : null}

        {step === "arrangement" ? (
          <div className="space-y-2.5" role="radiogroup" aria-label="Where do you work?">
            <OptionCard
              icon={<Home size={18} />}
              title="In-house"
              description="Work on internal projects and tasks."
              selected={arrangement === "in_house"}
              onClick={() => setArrangement("in_house")}
            />
            <OptionCard
              icon={<Building2 size={18} />}
              title="Client-site"
              description="Report work against a client's category catalogue."
              selected={arrangement === "client_site"}
              onClick={() => setArrangement("client_site")}
            />
            <button
              type="button"
              disabled={!arrangement || pending}
              onClick={() => setStep(arrangement === "client_site" ? "client" : "profile")}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[#6040E8] text-sm font-bold text-white transition hover:bg-[#4F31D0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === "client" ? (
          <div className="space-y-2.5">
            {clients.length === 0 ? (
              <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#B45309]">
                No active client organisations are available. Contact your administrator.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto" role="radiogroup" aria-label="Select client">
                {clients.map((c) => (
                  <OptionCard
                    key={c.id}
                    icon={<Building2 size={18} />}
                    title={c.name}
                    selected={clientId === c.id}
                    onClick={() => setClientId(c.id)}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("arrangement")}
                className="min-h-[48px] flex-1 rounded-2xl border border-[#EAE8F2] bg-white text-sm font-semibold text-[#666783]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!clientId || pending}
                onClick={() => setStep("profile")}
                className="min-h-[48px] flex-1 rounded-2xl bg-[#6040E8] text-sm font-bold text-white transition hover:bg-[#4F31D0] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === "profile" ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#666783]">Full name</span>
              <input
                value={initialName}
                readOnly
                className="w-full rounded-xl border border-[#EAE8F2] bg-[#F7F6FC] px-3.5 py-2.5 text-sm text-[#17172B]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#666783]">Job title (optional)</span>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={80}
                placeholder="e.g. Support Engineer"
                className="w-full rounded-xl border border-[#EAE8F2] bg-white px-3.5 py-2.5 text-sm text-[#17172B] outline-none focus:border-[#6040E8]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#666783]">Department (optional)</span>
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={80}
                placeholder="e.g. IT Support"
                className="w-full rounded-xl border border-[#EAE8F2] bg-white px-3.5 py-2.5 text-sm text-[#17172B] outline-none focus:border-[#6040E8]"
              />
            </label>
            {employerName ? (
              <p className="rounded-xl bg-[#F7F6FC] px-3.5 py-2.5 text-xs text-[#666783]">
                Employer: <span className="font-semibold text-[#17172B]">{employerName}</span>
              </p>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(arrangement === "client_site" ? "client" : "arrangement")}
                className="min-h-[48px] flex-1 rounded-2xl border border-[#EAE8F2] bg-white text-sm font-semibold text-[#666783]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={pending}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#6040E8] text-sm font-bold text-white transition hover:bg-[#4F31D0] disabled:opacity-60"
              >
                {pending ? <Loader2 size={16} className="animate-spin" /> : null}
                Complete setup
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  );
}

function OptionCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 rounded-2xl border bg-white px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
        selected ? "border-[#6040E8] ring-1 ring-[#6040E8]" : "border-[#EAE8F2] hover:border-[#D8D4F0]"
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          selected ? "bg-[#6040E8] text-white" : "bg-[#F1EFFA] text-[#6040E8]"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[#17172B]">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-4 text-[#666783]">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
