import { connection } from "next/server";
import { NextResponse } from "next/server";
import { AuthzError, requireConfigAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  catalogueTemplateCategories,
  catalogueTemplateSubcategories,
  catalogueTemplates,
  employees,
  memberships,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

export type AdminCatalogueTemplate = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  categories: {
    id: string;
    name: string;
    sortOrder: number;
    subcategories: { id: string; name: string; sortOrder: number }[];
  }[];
};

export async function GET() {
  await connection();
  try {
    await requireConfigAdmin();
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const templates = await db
    .select()
    .from(catalogueTemplates)
    .orderBy(asc(catalogueTemplates.name));
  const creatorIds = [...new Set(templates.map((t) => t.createdByMembershipId).filter(Boolean))] as string[];
  const creators = creatorIds.length
    ? await db
        .select({ id: memberships.id, name: employees.fullName })
        .from(memberships)
        .leftJoin(employees, eq(memberships.employeeId, employees.id))
        .where(inArray(memberships.id, creatorIds))
    : [];
  const creatorName = new Map(creators.map((m) => [m.id, m.name ?? null]));

  const cats = templates.length
    ? await db
        .select()
        .from(catalogueTemplateCategories)
        .where(inArray(catalogueTemplateCategories.templateId, templates.map((t) => t.id)))
        .orderBy(asc(catalogueTemplateCategories.sortOrder), asc(catalogueTemplateCategories.name))
    : [];
  const subs = cats.length
    ? await db
        .select()
        .from(catalogueTemplateSubcategories)
        .where(inArray(catalogueTemplateSubcategories.templateCategoryId, cats.map((c) => c.id)))
        .orderBy(asc(catalogueTemplateSubcategories.sortOrder), asc(catalogueTemplateSubcategories.name))
    : [];

  const subsByCat = new Map<string, typeof subs>();
  for (const sub of subs) {
    const list = subsByCat.get(sub.templateCategoryId) ?? [];
    list.push(sub);
    subsByCat.set(sub.templateCategoryId, list);
  }
  const catsByTemplate = new Map<string, typeof cats>();
  for (const cat of cats) {
    const list = catsByTemplate.get(cat.templateId) ?? [];
    list.push(cat);
    catsByTemplate.set(cat.templateId, list);
  }

  const list: AdminCatalogueTemplate[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    createdByName: t.createdByMembershipId ? creatorName.get(t.createdByMembershipId) ?? null : null,
    categories: (catsByTemplate.get(t.id) ?? []).map((cat) => ({
      id: cat.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
      subcategories: (subsByCat.get(cat.id) ?? []).map((sub) => ({
        id: sub.id,
        name: sub.name,
        sortOrder: sub.sortOrder,
      })),
    })),
  }));
  return NextResponse.json({ templates: list });
}
