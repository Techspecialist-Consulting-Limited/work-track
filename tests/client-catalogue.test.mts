import assert from "node:assert/strict";
import test from "node:test";
import {
  canReviewSuggestion,
  entryReportKind,
  findCatalogueDuplicate,
  isOwnPendingSuggestion,
  isSelectableForEntry,
  normalizeCatalogueKey,
  validateCatalogueName,
} from "../src/lib/worklog/client-catalogue";

test("catalogue names normalise case and all whitespace runs", () => {
  assert.equal(normalizeCatalogueKey("  Software   Development "), "software development");
  assert.equal(normalizeCatalogueKey("HARDWARE"), "hardware");
  assert.equal(normalizeCatalogueKey("Network\tConnectivity"), "network connectivity");
});

test("catalogue name validation trims and enforces length", () => {
  const ok = validateCatalogueName("  Network   Ops  ");
  assert.deepEqual(ok, { ok: true, name: "Network Ops" });
  assert.equal(validateCatalogueName(" ").ok, false);
  assert.equal(validateCatalogueName("x".repeat(81)).ok, false);
  assert.equal(validateCatalogueName("ab").ok, true);
});

test("duplicate detection ignores case and whitespace but not different names", () => {
  const rows = [
    { id: "1", name: "Software", approvalStatus: "approved" as const },
    { id: "2", name: "Hardware Support", approvalStatus: "pending" as const },
    { id: "3", name: "Networking", approvalStatus: "rejected" as const },
  ];
  assert.equal(findCatalogueDuplicate(rows, "  software ")?.id, "1");
  assert.equal(findCatalogueDuplicate(rows, "hardware   support")?.id, "2");
  assert.equal(findCatalogueDuplicate(rows, "networking"), undefined, "rejected rows do not block reuse");
  assert.equal(findCatalogueDuplicate(rows, "Software", "1"), undefined, "self is ignored on rename");
  assert.equal(findCatalogueDuplicate(rows, "Printer Support"), undefined);
});

test("staff cannot review their own suggestions", () => {
  assert.equal(canReviewSuggestion("emp-1", "emp-1"), false);
  assert.equal(canReviewSuggestion("emp-1", "emp-2"), true);
  assert.equal(canReviewSuggestion(null, "emp-1"), true, "admin-created rows have no staff creator");
  assert.equal(canReviewSuggestion("emp-1", null), true, "chairman memberships have no employee id");
});

test("entry selection allows approved+active and own pending only", () => {
  const base = { isActive: true };
  assert.equal(isSelectableForEntry({ ...base, approvalStatus: "approved", createdByEmployeeId: "emp-2" }, "emp-1"), true);
  assert.equal(isSelectableForEntry({ ...base, approvalStatus: "pending", createdByEmployeeId: "emp-1" }, "emp-1"), true, "own pending suggestion usable immediately");
  assert.equal(isSelectableForEntry({ ...base, approvalStatus: "pending", createdByEmployeeId: "emp-2" }, "emp-1"), false, "other employees' pending hidden");
  assert.equal(isSelectableForEntry({ ...base, approvalStatus: "rejected", createdByEmployeeId: "emp-1" }, "emp-1"), false);
  assert.equal(isSelectableForEntry({ isActive: false, approvalStatus: "approved", createdByEmployeeId: null }, "emp-1"), false, "inactive never selectable");
});

test("own pending badge only marks the employee's own pending rows", () => {
  assert.equal(isOwnPendingSuggestion({ approvalStatus: "pending", isActive: true, createdByEmployeeId: "emp-1" }, "emp-1"), true);
  assert.equal(isOwnPendingSuggestion({ approvalStatus: "pending", isActive: true, createdByEmployeeId: "emp-2" }, "emp-1"), false);
  assert.equal(isOwnPendingSuggestion({ approvalStatus: "approved", isActive: true, createdByEmployeeId: "emp-1" }, "emp-1"), false);
});

test("entry report kind follows the entry, not the employee arrangement", () => {
  assert.equal(entryReportKind({ taskId: "t1" }), "in_house");
  assert.equal(entryReportKind({ clientCategoryId: "c1", clientSubcategoryId: "s1" }), "client_site");
  assert.equal(entryReportKind({}), "in_house", "break-style rows without links are not client-site");
  assert.equal(
    entryReportKind({ clientSubcategoryId: "s1" }),
    "client_site",
    "a subcategory reference alone still marks a client-site entry"
  );
});
