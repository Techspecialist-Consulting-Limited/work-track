/**
 * Shared catalogue rules for client-site category/subcategory management.
 * The database enforces the same normalisation via expression unique indexes
 * (migration 0008); these helpers keep server validation and duplicate
 * messages consistent with it.
 */

export const CATALOGUE_NAME_MIN = 2;
export const CATALOGUE_NAME_MAX = 80;

/** Trim, lowercase and collapse every whitespace run — mirrors the SQL index expression. */
export function normalizeCatalogueKey(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function validateCatalogueName(name: string): { ok: true; name: string } | { ok: false; message: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < CATALOGUE_NAME_MIN || trimmed.length > CATALOGUE_NAME_MAX) {
    return { ok: false, message: `Enter a name between ${CATALOGUE_NAME_MIN} and ${CATALOGUE_NAME_MAX} characters.` };
  }
  return { ok: true, name: trimmed };
}

export interface CatalogueNameRow {
  id: string;
  name: string;
  /** Drizzle text columns surface as string; the DB check constrains the values. */
  approvalStatus: string;
}

/**
 * Duplicate detection matching the partial unique indexes: rejected rows are
 * excluded so a rejected name can be suggested again, and the comparison is
 * case/whitespace-insensitive.
 */
export function findCatalogueDuplicate<T extends CatalogueNameRow>(
  rows: T[],
  name: string,
  ignoreId?: string
): T | undefined {
  const key = normalizeCatalogueKey(name);
  return rows.find(
    (row) => row.id !== ignoreId && row.approvalStatus !== "rejected" && normalizeCatalogueKey(row.name) === key
  );
}

/** Staff may not approve or reject their own suggestions. */
export function canReviewSuggestion(
  createdByEmployeeId: string | null | undefined,
  reviewerEmployeeId: string | null | undefined
): boolean {
  return !(createdByEmployeeId && reviewerEmployeeId && createdByEmployeeId === reviewerEmployeeId);
}

export interface SelectableCatalogueRow {
  approvalStatus: string;
  isActive: boolean;
  createdByEmployeeId?: string | null;
}

/**
 * Rows a client-site employee may attach to a NEW work entry: approved and
 * active catalogue items, plus the employee's own pending suggestions (they
 * can report work without waiting for review). Other employees' pending and
 * all rejected rows are never selectable — historical references still
 * resolve through the read model, they just can't be picked again.
 */
export function isSelectableForEntry(
  row: SelectableCatalogueRow,
  employeeId: string
): boolean {
  if (!row.isActive) return false;
  if (row.approvalStatus === "approved") return true;
  return row.approvalStatus === "pending" && row.createdByEmployeeId === employeeId;
}

/** True when the row is the employee's own pending suggestion (shows the New badge). */
export function isOwnPendingSuggestion(
  row: SelectableCatalogueRow,
  employeeId: string
): boolean {
  return row.approvalStatus === "pending" && row.createdByEmployeeId === employeeId;
}

/**
 * The reporting mode an entry belongs to. Editing follows the entry's own
 * type — never the employee's current work arrangement — so historical
 * in-house and client-site entries always reopen in their original form.
 */
export function entryReportKind(entry: {
  taskId?: string;
  clientCategoryId?: string;
  clientSubcategoryId?: string;
}): "in_house" | "client_site" {
  return entry.clientCategoryId || entry.clientSubcategoryId ? "client_site" : "in_house";
}
