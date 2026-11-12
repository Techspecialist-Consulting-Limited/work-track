"use client";

import { useState } from "react";
import { Building2, Users, Zap } from "lucide-react";
import { TeamsAdmin } from "./TeamsAdmin";
import { ClientReportingAdmin } from "./ClientReportingAdmin";

type AdminSection = "teams" | "client-reporting";

const SECTIONS: { id: AdminSection; label: string; icon: typeof Users }[] = [
  { id: "teams", label: "Teams & Projects", icon: Users },
  { id: "client-reporting", label: "Client-site Reporting", icon: Building2 },
];

/** Configuration home: teams/projects and client-site reporting in one place. */
export function AdminConfigTabs() {
  const [section, setSection] = useState<AdminSection>("teams");

  return (
    <div className="min-h-dvh bg-[#F7F7FC]">
      <div className="sticky top-0 z-40 border-b border-[#E7E6F0] bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          <span className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#6C45F5] text-white">
            <Zap size={14} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
          </span>
          <nav aria-label="Configuration sections" className="flex items-center gap-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const selected = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={selected ? "page" : undefined}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                    selected
                      ? "bg-[#F5F1FF] text-[#5A3ED0]"
                      : "text-[#4A4665] hover:bg-[#F7F7FC]"
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      {section === "teams" ? <TeamsAdmin /> : <ClientReportingAdmin />}
    </div>
  );
}
