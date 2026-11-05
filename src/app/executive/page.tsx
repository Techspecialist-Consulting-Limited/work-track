import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ExecutiveBoard } from "@/components/management/ExecutiveBoard";

export const metadata: Metadata = {
  title: "Executive Board",
  description: "Team work log, work location, and task reviews for a selected day.",
};

async function ExecutiveContent() {
  await connection();
  return <ExecutiveBoard />;
}

export default function ExecutivePage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">Loading board…</main>}>
      <ExecutiveContent />
    </Suspense>
  );
}
