import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/lib/auth/auth";
import { identityAccessState } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organisations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { OnboardingForm } from "./OnboardingForm";

async function OnboardingContent() {
  await connection();
  const session = await auth();
  const user = session?.user;
  const oid = (user as { oid?: string } | undefined)?.oid;
  const tid = (user as { tid?: string } | undefined)?.tid;
  if (!oid || !tid) redirect("/login");

  const access = await identityAccessState({ oid, tid });
  if (access === "active") redirect("/");
  if (access === "deactivated") {
    return <BlockedMessage />;
  }

  const [clients, employers] = await Promise.all([
    db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(and(eq(organisations.kind, "client"), eq(organisations.isActive, true)))
      .orderBy(organisations.name),
    db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(and(eq(organisations.kind, "employer"), eq(organisations.isActive, true)))
      .orderBy(organisations.name),
  ]);

  return (
    <OnboardingForm
      initialName={user?.name ?? ""}
      clients={clients}
      employers={employers}
    />
  );
}

function BlockedMessage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5">
      <div className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-[#17172B]">Account deactivated</h1>
        <p className="mt-2 text-sm leading-5 text-[#666783]">
          Your WorkTrack account was deactivated. Ask an administrator to reactivate it before signing in again.
        </p>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] text-[12px] text-[#737A96]">
          Loading…
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
