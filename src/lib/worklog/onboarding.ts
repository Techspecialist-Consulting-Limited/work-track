/**
 * Pure validation for self-service staff onboarding. The server action
 * re-validates organisation existence/kind/active-state against the DB;
 * this module covers shape + client-org membership rules so they are
 * unit-testable.
 */

export const ONBOARDING_ARRANGEMENTS = ["in_house", "client_site"] as const;
export type OnboardingArrangement = (typeof ONBOARDING_ARRANGEMENTS)[number];

export interface OnboardingClientOrg {
  id: string;
  name: string;
  kind: string;
  isActive: boolean;
}

export interface OnboardingInput {
  workArrangement?: string;
  clientOrganisationId?: string | null;
  jobTitle?: string;
  department?: string;
}

export type OnboardingValidation =
  | { ok: true; workArrangement: OnboardingArrangement; clientOrganisationId: string | null }
  | { ok: false; message: string };

export function validateOnboardingInput(
  input: OnboardingInput,
  clientOrganisations: OnboardingClientOrg[]
): OnboardingValidation {
  const arrangement = input.workArrangement;
  if (arrangement !== "in_house" && arrangement !== "client_site") {
    return { ok: false, message: "Choose where you work." };
  }

  if (arrangement === "in_house") {
    return { ok: true, workArrangement: "in_house", clientOrganisationId: null };
  }

  const clientId = input.clientOrganisationId?.trim();
  if (!clientId) {
    return { ok: false, message: "Select the client organisation you work for." };
  }
  const client = clientOrganisations.find((o) => o.id === clientId);
  if (!client || client.kind !== "client" || !client.isActive) {
    return { ok: false, message: "That client organisation is not available." };
  }
  return { ok: true, workArrangement: "client_site", clientOrganisationId: client.id };
}

export function validateProfileField(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}
