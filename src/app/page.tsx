import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { MyWorkLog } from "@/components/worklog/MyWorkLog";
import { requirePageAccess } from "@/lib/auth/authorize";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My Work Log",
  description: "Log your work, breaks, and work location for the day.",
};

async function HomeContent() {
  await connection();
  // Chairman has no staff workspace — task logging is staff + HR only.
  const membership = await requirePageAccess(["staff", "hr"]);
  if (!membership.employeeId) {
    // HR/Chairman without a linked employee record use the executive board.
    if (membership.role !== "staff") redirect("/executive");
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5">
        <div className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-[#17172B]">Account not set up</h1>
          <p className="mt-2 text-sm leading-5 text-[#666783]">
            Your staff account is not linked to an employee record yet. Ask an administrator to
            complete your setup.
          </p>
        </div>
      </main>
    );
  }
  return <MyWorkLog />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">Loading work log…</main>}>
      <HomeContent />
    </Suspense>
  );
}
