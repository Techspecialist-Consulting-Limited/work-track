import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { invitations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashInvitationToken, invitationStatus, INVITATION_ROLES } from "@/lib/worklog/invitations";
import { InviteSignIn } from "./InviteSignIn";

export const metadata = { title: "WorkTrack invitation" };

async function loadInvite(token: string) {
  const hash = hashInvitationToken(token);
  return (await db.select().from(invitations).where(eq(invitations.tokenHash, hash)).limit(1))[0];
}

async function InviteContent({ token }: { token: string }) {
  await connection();
  const invite = token ? await loadInvite(token) : undefined;
  const status = invite ? invitationStatus(invite) : "invalid";
  const roleOk = invite && (INVITATION_ROLES as readonly string[]).includes(invite.role);

  if (!invite || status !== "pending" || !roleOk) {
    const message =
      status === "accepted"
        ? "This invitation has already been used. Sign in with your usual role instead."
        : status === "revoked"
          ? "This invitation has been revoked. Ask your administrator for a new one."
          : status === "expired"
            ? "This invitation has expired. Ask your administrator for a new one."
            : "This invitation link is invalid.";
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5">
        <div className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-[#17172B]">Invitation unavailable</h1>
          <p className="mt-2 text-sm leading-5 text-[#666783]">{message}</p>
        </div>
      </main>
    );
  }

  return <InviteSignIn token={token} role={invite.role as "staff" | "hr"} email={invite.email} />;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] text-[12px] text-[#737A96]">
          Checking invitation…
        </main>
      }
    >
      <InviteParams params={params} />
    </Suspense>
  );
}

async function InviteParams({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteContent token={token} />;
}
