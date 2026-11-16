import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ComplaintsAdmin } from "@/components/admin/ComplaintsAdmin";
import { getMembership } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Complaints",
  description: "Review and respond to employee complaints.",
};

async function ComplaintsContent() {
  await connection();
  const membership = await getMembership();
  if (!membership) redirect("/auth/complete");
  const canManageComplaints = membership.isConfigAdmin;
  if (!canManageComplaints) {
    redirect(membership.role === "staff" ? "/" : "/executive");
  }

  const actorName =
    membership.employee?.fullName ??
    membership.user.name ??
    (membership.role === "chairman" ? "Chairman" : "Management");
  const actorRole =
    membership.role === "chairman"
      ? "Chairman"
      : membership.role === "hr"
        ? "HR"
        : membership.isConfigAdmin
          ? "Config admin"
          : "Management";

  return <ComplaintsAdmin actorName={actorName} actorRole={actorRole} />;
}

export default function AdminComplaintsPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-[12px] text-[#737A96]">
          Loading complaints…
        </main>
      }
    >
      <ComplaintsContent />
    </Suspense>
  );
}
