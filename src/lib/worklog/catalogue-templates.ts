import { normalizeCatalogueKey, validateCatalogueName } from "./client-catalogue";

export interface TemplateCategoryNode {
  id: string;
  name: string;
  sortOrder: number;
  subcategories: { id: string; name: string; sortOrder: number }[];
}

export interface TemplateCategoryInput {
  /** Client-generated key used to match nested subcategories on save. */
  key?: string;
  name: string;
  subcategories: { key?: string; name: string }[];
}

export interface PlannedSubcategory {
  templateSubcategoryId: string;
  name: string;
}

export interface PlannedNewCategory {
  templateCategoryId: string;
  name: string;
  subcategories: PlannedSubcategory[];
}

export interface PlannedExistingCategory {
  categoryId: string;
  categoryName: string;
  subcategories: PlannedSubcategory[];
}

export interface TemplateApplicationPlan {
  /** Categories that don't exist yet — created with all missing subcategories. */
  newCategories: PlannedNewCategory[];
  /** Existing categories receiving only their missing subcategories. */
  additionsToExisting: PlannedExistingCategory[];
  /** Template categories skipped because the name already exists (with no missing subs). */
  existingCategoryNames: string[];
  /** Total subcategory names skipped because they already exist. */
  skippedSubcategoryCount: number;
}

interface NamedRow {
  id: string;
  name: string;
}

/**
 * Compares a template's categories/subcategories against a destination client's
 * catalogue using the same normalized-name rules as the DB unique indexes.
 * Never plans overwrites — only additions.
 */
export function planTemplateApplication(
  templateCategories: TemplateCategoryNode[],
  existingCategories: NamedRow[],
  existingSubcategories: (NamedRow & { categoryId: string })[],
  selectedCategoryIds?: ReadonlySet<string>
): TemplateApplicationPlan {
  const plan: TemplateApplicationPlan = {
    newCategories: [],
    additionsToExisting: [],
    existingCategoryNames: [],
    skippedSubcategoryCount: 0,
  };
  const categoryKey = (name: string) => normalizeCatalogueKey(name);
  const existingByKey = new Map(existingCategories.map((row) => [categoryKey(row.name), row]));
  const subsByCategory = new Map<string, Set<string>>();
  for (const sub of existingSubcategories) {
    const set = subsByCategory.get(sub.categoryId) ?? new Set<string>();
    set.add(categoryKey(sub.name));
    subsByCategory.set(sub.categoryId, set);
  }

  for (const cat of [...templateCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    if (selectedCategoryIds && !selectedCategoryIds.has(cat.id)) continue;
    const subs = [...cat.subcategories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const existing = existingByKey.get(categoryKey(cat.name));
    if (existing) {
      const have = subsByCategory.get(existing.id) ?? new Set<string>();
      const missing = subs.filter((sub) => !have.has(categoryKey(sub.name)));
      plan.skippedSubcategoryCount += subs.length - missing.length;
      if (missing.length) {
        plan.additionsToExisting.push({
          categoryId: existing.id,
          categoryName: existing.name,
          subcategories: missing.map((sub) => ({ templateSubcategoryId: sub.id, name: sub.name })),
        });
      } else {
        plan.existingCategoryNames.push(cat.name);
      }
      continue;
    }
    // New category: template sub names are unique per template, but guard anyway.
    const seen = new Set<string>();
    const subcategories = subs
      .filter((sub) => {
        const key = categoryKey(sub.name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((sub) => ({ templateSubcategoryId: sub.id, name: sub.name }));
    plan.newCategories.push({ templateCategoryId: cat.id, name: cat.name, subcategories });
  }
  return plan;
}

/** Validates a whole template tree submitted by the admin editor. */
export function validateTemplateTree(
  categories: TemplateCategoryInput[]
): { ok: true } | { ok: false; message: string } {
  if (categories.length === 0) {
    return { ok: false, message: "A template needs at least one category." };
  }
  const seenCats = new Set<string>();
  for (const cat of categories) {
    const checked = validateCatalogueName(cat.name);
    if (!checked.ok) return { ok: false, message: `Category: ${checked.message}` };
    const catKey = normalizeCatalogueKey(checked.name);
    if (seenCats.has(catKey)) {
      return { ok: false, message: `Duplicate category "${checked.name}" in template.` };
    }
    seenCats.add(catKey);
    const seenSubs = new Set<string>();
    for (const sub of cat.subcategories) {
      const subChecked = validateCatalogueName(sub.name);
      if (!subChecked.ok) return { ok: false, message: `${checked.name}: ${subChecked.message}` };
      const subKey = normalizeCatalogueKey(subChecked.name);
      if (seenSubs.has(subKey)) {
        return { ok: false, message: `Duplicate subcategory "${subChecked.name}" under ${checked.name}.` };
      }
      seenSubs.add(subKey);
    }
  }
  return { ok: true };
}
