import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { TeamsAdmin } from "@/components/admin/TeamsAdmin";
import { requireConfigAdminPage } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Teams & Projects",
  description: "Configure teams, staff assignments, and each team's project library.",
};

async function AdminContent() {
  await connection();
  await requireConfigAdminPage();
  return <TeamsAdmin />;
}

export default function TeamsAdminPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">
          Loading configuration…
        </main>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
