import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOnboardingInput, validateProfileField } from "../src/lib/worklog/onboarding";

const clients = [
  { id: "c1", name: "BPP", kind: "client", isActive: true },
  { id: "c2", name: "Old Client", kind: "client", isActive: false },
  { id: "e1", name: "TechSpecialist", kind: "employer", isActive: true },
];

test("in-house requires no client and clears any supplied id", () => {
  const r = validateOnboardingInput({ workArrangement: "in_house", clientOrganisationId: "c1" }, clients);
  assert.deepEqual(r, { ok: true, workArrangement: "in_house", clientOrganisationId: null });
});

test("client-site requires a valid active client org", () => {
  assert.equal(validateOnboardingInput({ workArrangement: "client_site" }, clients).ok, false);
  const bad = validateOnboardingInput({ workArrangement: "client_site", clientOrganisationId: "nope" }, clients);
  assert.equal(bad.ok, false);
  const inactive = validateOnboardingInput({ workArrangement: "client_site", clientOrganisationId: "c2" }, clients);
  assert.equal(inactive.ok, false);
  const employer = validateOnboardingInput({ workArrangement: "client_site", clientOrganisationId: "e1" }, clients);
  assert.equal(employer.ok, false);
  const good = validateOnboardingInput({ workArrangement: "client_site", clientOrganisationId: "c1" }, clients);
  assert.deepEqual(good, { ok: true, workArrangement: "client_site", clientOrganisationId: "c1" });
});

test("invalid arrangement rejected", () => {
  assert.equal(validateOnboardingInput({ workArrangement: "hr" }, clients).ok, false);
  assert.equal(validateOnboardingInput({}, clients).ok, false);
});

test("profile fields are trimmed and length-capped", () => {
  assert.equal(validateProfileField("  Engineer  ", 80), "Engineer");
  assert.equal(validateProfileField("x".repeat(200), 80).length, 80);
  assert.equal(validateProfileField(undefined, 80), "");
});
