import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { WorkLogReports } from "@/components/management/WorkLogReports";

export const metadata: Metadata = {
  title: "Reports",
  description: "Filter team work log entries and export them to Excel.",
};

async function ReportsContent() {
  await connection();
  return <WorkLogReports />;
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">Loading reports…</main>}>
      <ReportsContent />
    </Suspense>
  );
}
