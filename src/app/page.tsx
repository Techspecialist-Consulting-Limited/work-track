import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { MyWorkLog } from "@/components/worklog/MyWorkLog";

export const metadata: Metadata = {
  title: "My Work Log",
  description: "Log your work, breaks, and work location for the day.",
};

async function HomeContent() {
  await connection();
  return <MyWorkLog />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">Loading work log…</main>}>
      <HomeContent />
    </Suspense>
  );
}
