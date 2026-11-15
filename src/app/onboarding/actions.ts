"use server";

import { auth } from "@/lib/auth/auth";
import { completeStaffOnboarding } from "@/lib/db/worklog-actions";

/** Server action for the self-service staff onboarding form. */
export async function completeStaffOnboardingAction(input: {
  workArrangement: string;
  clientOrganisationId?: string | null;
  jobTitle?: string;
  department?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await auth();
  const user = session?.user;
  return completeStaffOnboarding(
    {
      oid: (user as { oid?: string } | undefined)?.oid,
      tid: (user as { tid?: string } | undefined)?.tid,
      name: user?.name ?? null,
    },
    input
  );
}
