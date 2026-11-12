import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminConfigTabs } from "@/components/admin/AdminConfigTabs";
import { requireConfigAdminPage } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Admin",
  description: "Configure teams, staff assignments, project libraries and client-site reporting.",
};

async function AdminContent() {
  await connection();
  await requireConfigAdminPage();
  return <AdminConfigTabs />;
}

export default function AdminPage() {
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
