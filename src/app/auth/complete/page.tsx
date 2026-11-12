import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/lib/auth/auth";
import {
  autoProvisionMembership,
  getMembership,
  hasAnyMembership,
  INVITE_TOKEN_COOKIE,
  LOGIN_ROLE_COOKIE,
  redeemInvitation,
  type WorkTrackRole,
} from "@/lib/auth/authorize";
import { acceptEmployeeInvitation } from "@/lib/db/worklog-actions";

const ROLE_HOME: Record<WorkTrackRole, string> = {
  staff: "/",
  hr: "/executive",
  chairman: "/executive",
};

async function CompleteContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { error } = await searchParams;

  if (error) {
    return <AuthMessage title="Sign-in failed" body="Microsoft did not complete the sign-in. Please try again." />;
  }

  const session = await auth();
  if (!session?.user) redirect("/login");

  const store = await cookies();
  const requested = store.get(LOGIN_ROLE_COOKIE)?.value as WorkTrackRole | undefined;

  // Token invitation redemption takes precedence over the role-selection flow.
  const inviteToken = store.get(INVITE_TOKEN_COOKIE)?.value;
  if (inviteToken) {
    const accepted = await acceptEmployeeInvitation(
      {
        oid: (session.user as { oid?: string }).oid,
        tid: (session.user as { tid?: string }).tid,
        email: session.user.email,
        name: session.user.name,
      },
      inviteToken
    );
    if (accepted.ok) redirect(ROLE_HOME[accepted.role]);
    return (
      <AuthMessage
        title="Invitation could not be accepted"
        body={accepted.message}
        showRetry
      />
    );
  }

  // First login only: staff/HR self-provision (Entra sign-in = company
  // account). Existing members never gain extra roles this way, and
  // chairman remains manual-only.
  let membership = await getMembership();
  if (!membership && requested && requested !== "chairman") {
    const identity = {
      oid: (session.user as { oid?: string }).oid,
      tid: (session.user as { tid?: string }).tid,
    };
    if (!(await hasAnyMembership(identity))) {
      membership = await autoProvisionMembership(
        { ...identity, name: session.user.name, email: session.user.email },
        requested
      );
    }
  } else if (!membership && requested === "chairman") {
    // Chairman access is by invitation only — the invited Entra email must match.
    membership = await redeemInvitation(
      {
        oid: (session.user as { oid?: string }).oid,
        tid: (session.user as { tid?: string }).tid,
        email: session.user.email,
      },
      "chairman"
    );
  }
  if (!membership) {
    const oid = (session.user as { oid?: string }).oid;
    const tid = (session.user as { tid?: string }).tid;
    const existing = await hasAnyMembership({ oid, tid });
    if (existing) {
      return (
        <AuthMessage
          title="Role mismatch"
          body={`Your account already has a WorkTrack role. Sign in again and select the role you were provisioned with.`}
          showRetry
        />
      );
    }
    return (
      <AuthMessage
        title="No WorkTrack access"
        body={
          oid && tid
            ? `Your Microsoft account is not linked to a WorkTrack membership. Share these identifiers with your administrator to provision access — object ID: ${oid}, tenant ID: ${tid}`
            : "Your Microsoft account is not linked to a WorkTrack membership. Ask an administrator to provision your account."
        }
      />
    );
  }

  // Cookie is left to expire (15 min) — it is overwritten on every sign-in.

  if (!requested || requested !== membership.role) {
    return (
      <AuthMessage
        title="Role mismatch"
        body={`You selected “${requested ?? "no role"}” but your account is configured as “${membership.role}”. Sign in again and choose the matching role.`}
        showRetry
      />
    );
  }

  redirect(ROLE_HOME[membership.role]);
}

export default function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] text-[12px] text-[#737A96]">
          Finishing sign-in…
        </main>
      }
    >
      <CompleteContent searchParams={searchParams} />
    </Suspense>
  );
}

function AuthMessage({
  title,
  body,
  showRetry,
}: {
  title: string;
  body: string;
  showRetry?: boolean;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5">
      <div className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-[#17172B]">{title}</h1>
        <p className="mt-2 text-sm leading-5 text-[#666783]">{body}</p>
        {showRetry ? (
          <Link
            href="/login"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#6040E8] px-5 text-sm font-bold text-white"
          >
            Back to sign in
          </Link>
        ) : null}
      </div>
    </main>
  );
}
