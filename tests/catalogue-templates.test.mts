import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planTemplateApplication,
  validateTemplateTree,
  type TemplateCategoryNode,
} from "../src/lib/worklog/catalogue-templates";

const tpl = (cats: { id: string; name: string; subs?: string[] }[]): TemplateCategoryNode[] =>
  cats.map((cat, i) => ({
    id: cat.id,
    name: cat.name,
    sortOrder: i,
    subcategories: (cat.subs ?? []).map((name, j) => ({ id: `${cat.id}-s${j}`, name, sortOrder: j })),
  }));

test("apply plan creates all categories and subcategories for an empty client", () => {
  const plan = planTemplateApplication(
    tpl([
      { id: "c1", name: "Software", subs: ["OS", "Apps"] },
      { id: "c2", name: "Hardware", subs: ["Laptops"] },
    ]),
    [],
    []
  );
  assert.equal(plan.newCategories.length, 2);
  assert.equal(plan.newCategories[0].subcategories.length, 2);
  assert.equal(plan.additionsToExisting.length, 0);
  assert.equal(plan.skippedSubcategoryCount, 0);
});

test("duplicate categories are skipped and missing subcategories still added", () => {
  const plan = planTemplateApplication(
    tpl([{ id: "c1", name: "Software", subs: ["OS", "Apps", "Security"] }]),
    [{ id: "dest-c1", name: "  software " }],
    [
      { id: "d1", categoryId: "dest-c1", name: "os" },
      { id: "d2", categoryId: "dest-c1", name: "Apps" },
    ]
  );
  assert.equal(plan.newCategories.length, 0);
  assert.equal(plan.additionsToExisting.length, 1);
  assert.equal(plan.additionsToExisting[0].categoryId, "dest-c1");
  assert.deepEqual(
    plan.additionsToExisting[0].subcategories.map((s) => s.name),
    ["Security"]
  );
  assert.equal(plan.skippedSubcategoryCount, 2);
});

test("fully existing category contributes nothing", () => {
  const plan = planTemplateApplication(
    tpl([{ id: "c1", name: "Software", subs: ["OS"] }]),
    [{ id: "dest-c1", name: "SOFTWARE" }],
    [{ id: "d1", categoryId: "dest-c1", name: "  Os " }]
  );
  assert.equal(plan.newCategories.length, 0);
  assert.equal(plan.additionsToExisting.length, 0);
  assert.deepEqual(plan.existingCategoryNames, ["Software"]);
  assert.equal(plan.skippedSubcategoryCount, 1);
});

test("selected category ids limit the plan", () => {
  const plan = planTemplateApplication(
    tpl([
      { id: "c1", name: "Software" },
      { id: "c2", name: "Hardware" },
    ]),
    [],
    [],
    new Set(["c2"])
  );
  assert.equal(plan.newCategories.length, 1);
  assert.equal(plan.newCategories[0].templateCategoryId, "c2");
});

test("template tree validation enforces names and duplicates", () => {
  assert.equal(validateTemplateTree([]).ok, false);
  assert.equal(
    validateTemplateTree([{ key: "a", name: "Software", subcategories: [{ name: "OS" }] }]).ok,
    true
  );
  assert.equal(
    validateTemplateTree([
      { key: "a", name: "Software", subcategories: [] },
      { key: "b", name: " software ", subcategories: [] },
    ]).ok,
    false
  );
  assert.equal(
    validateTemplateTree([
      {
        key: "a",
        name: "Software",
        subcategories: [{ name: "OS" }, { name: " os " }],
      },
    ]).ok,
    false
  );
  assert.equal(
    validateTemplateTree([{ key: "a", name: "x", subcategories: [{ name: "ab" }] }]).ok,
    false
  );
});
