"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import { CatalogueTemplatesAdmin } from "./CatalogueTemplatesAdmin";
import {
  assignEmployeeClient,
  createClientCategory,
  createClientOrganisation,
  createEmployerOrganisation,
  createClientSubcategory,
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getSessionUser,
  reviewClientSuggestion,
  subscribeToDatabase,
  updateClientCategory,
  updateClientSubcategory,
  updateOrganisation,
} from "@/lib/worklog/repository";
import type {
  ClientCategory,
  ClientSubcategory,
  Employee,
  Organisation,
} from "@/lib/worklog/types";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";

function formatDay(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function ClientReportingAdmin() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [view, setView] = useState<"catalogue" | "templates">("catalogue");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meEmployee = db.employees.find((employee) => employee.id === getSessionEmployeeId());
  const role = getSessionRole();

  const organisations = useMemo(() => {
    const clients = db.organisations.filter((org) => org.kind === "client");
    const employers = db.organisations.filter((org) => org.kind === "employer");
    return [...clients, ...employers].sort((a, b) => a.name.localeCompare(b.name));
  }, [db.organisations]);
  const activeOrg = organisations.find((org) => org.id === selectedOrgId) ?? organisations[0] ?? null;

  const pendingCategories = useMemo(
    () => db.clientCategories.filter((row) => row.approvalStatus === "pending"),
    [db.clientCategories]
  );
  const pendingSubcategories = useMemo(
    () => db.clientSubcategories.filter((row) => row.approvalStatus === "pending"),
    [db.clientSubcategories]
  );
  const clientOrgs = useMemo(
    () => db.organisations.filter((org) => org.kind === "client" && org.isActive),
    [db.organisations]
  );

  async function run<T extends { ok?: boolean; message?: string } | null>(
    promise: Promise<T>,
    success: string
  ): Promise<boolean> {
    setError(null);
    try {
      const result = await promise;
      if (!result || result.ok === false) {
        setError(result?.message ?? "That change could not be saved.");
        return false;
      }
      setNotice(success);
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    }
  }

  if (!mounted) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-sm text-[#737A96]">
        Loading configuration…
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-5 text-[#17172F] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#6C45F5] text-white">
              <Building2 size={18} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Client-site Reporting</h1>
              <p className="text-xs text-[#777A91]">Organisations, catalogue and suggestion reviews — configuration only.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/executive"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] bg-white px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              Executive board
            </Link>
            <ProfileMenu
              name={meEmployee?.name ?? getSessionUser()?.name ?? "Account"}
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : role === "chairman" ? "Chairman" : "Config admin"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={Boolean(meEmployee) && role !== "chairman"}
            />
          </div>
        </header>

        {notice ? (
          <p role="status" className="mb-4 rounded-xl border border-[#C7EBD8] bg-[#ECFDF5] px-4 py-2.5 text-sm text-[#047857]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-[#F6C7C7] bg-[#FDEEEE] px-4 py-2.5 text-sm text-[#B43A3A]">
            {error}
          </p>
        ) : null}

        <div className="mb-4 inline-flex rounded-xl border border-[#E7E6F0] bg-white p-1" role="tablist" aria-label="Catalogue views">
          {(
            [
              ["catalogue", "Client catalogues"],
              ["templates", "Catalogue templates"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`min-h-9 rounded-lg px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                view === id ? "bg-[#F5F1FF] text-[#5A3ED0]" : "text-[#4A4665] hover:bg-[#F7F7FC]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "templates" ? (
          <CatalogueTemplatesAdmin />
        ) : (
          <>
        <PendingSuggestions
          categories={pendingCategories}
          subcategories={pendingSubcategories}
          onReview={async (input) => {
            const ok = await run(reviewClientSuggestion(input), input.decision === "approve" ? "Suggestion approved." : "Suggestion rejected.");
            return ok;
          }}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">Organisations</h2>
                <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">
                  {organisations.length}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {organisations.map((org) => {
                  const selected = activeOrg?.id === org.id;
                  return (
                    <li key={org.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedOrgId(org.id)}
                        aria-pressed={selected}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                          selected
                            ? "border-[#6C45F5] bg-[#F5F1FF]"
                            : "border-transparent hover:border-[#E7E6F0] hover:bg-[#FCFBFF]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#17172F]">
                            {org.name}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              org.kind === "client" ? "bg-[#EAF8F0] text-[#15803D]" : "bg-[#F1F0F6] text-[#6B6880]"
                            }`}
                          >
                            {org.kind === "client" ? "Client" : "Employer"}
                          </span>
                        </span>
                        {!org.isActive ? (
                          <span className="mt-0.5 block text-[11px] text-[#B45309]">Inactive</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
                {organisations.length === 0 ? (
                  <li className="rounded-xl bg-[#F7F7FC] px-3 py-4 text-center text-xs text-[#777A91]">
                    No organisations yet.
                  </li>
                ) : null}
              </ul>
            </section>

            <NewClientCard
              onCreated={async (orgId, message) => {
                setNotice(message);
                setSelectedOrgId(orgId);
              }}
              onError={setError}
            />
          </aside>

          <div className="min-w-0 space-y-4">
            {activeOrg ? (
              <>
                <OrganisationEditor
                  key={activeOrg.id}
                  org={activeOrg}
                  onSave={async (input) => {
                    const ok = await run(updateOrganisation({ organisationId: activeOrg.id, ...input }), "Organisation updated.");
                    return ok;
                  }}
                />
                {activeOrg.kind === "client" ? (
                  <CataloguePanel
                    clientOrg={activeOrg}
                    categories={db.clientCategories.filter((row) => row.clientOrganisationId === activeOrg.id)}
                    subcategories={db.clientSubcategories.filter((row) => row.clientOrganisationId === activeOrg.id)}
                    onCreateCategory={async (name) => {
                      const ok = await run(createClientCategory({ clientOrganisationId: activeOrg.id, name }), "Category created.");
                      return ok;
                    }}
                    onUpdateCategory={async (categoryId, input) => {
                      const ok = await run(updateClientCategory({ categoryId, ...input }), "Category updated.");
                      return ok;
                    }}
                    onCreateSubcategory={async (categoryId, name) => {
                      const ok = await run(createClientSubcategory({ categoryId, name }), "Subcategory created.");
                      return ok;
                    }}
                    onUpdateSubcategory={async (subcategoryId, input) => {
                      const ok = await run(updateClientSubcategory({ subcategoryId, ...input }), "Subcategory updated.");
                      return ok;
                    }}
                  />
                ) : null}
                <DeploymentsPanel
                  employees={db.employees}
                  clientOrgs={clientOrgs}
                  onAssign={async (input) => {
                    const ok = await run(assignEmployeeClient(input), "Assignment updated.");
                    return ok;
                  }}
                />
              </>
            ) : (
              <section className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-[#D8D3EC] bg-white p-8 text-center">
                <div>
                  <Building2 size={28} className="mx-auto text-[#B8A8F8]" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-[#39364F]">No organisation selected</p>
                  <p className="mt-1 text-xs text-[#777A91]">Create a client organisation to configure its reporting catalogue.</p>
                </div>
              </section>
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function NewClientCard({
  onCreated,
  onError,
}: {
  onCreated: (orgId: string, message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"client" | "employer">("client");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const kindLabel = kind === "client" ? "client" : "employer";

  async function submit() {
    if (name.trim().length < 2) {
      onError(`Enter a ${kindLabel} name of at least 2 characters.`);
      return;
    }
    setSaving(true);
    try {
      const input = { name: name.trim(), description: description.trim() || undefined };
      const result =
        kind === "client" ? await createClientOrganisation(input) : await createEmployerOrganisation(input);
      if (!result || result.ok === false) {
        onError(result?.message ?? `Could not create the ${kindLabel} organisation.`);
        return;
      }
      onCreated(result.organisationId ?? "", `${kind === "client" ? "Client" : "Employer"} organisation created.`);
      setName("");
      setDescription("");
      setOpen(false);
    } catch {
      onError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-sm">
      {open ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">New organisation</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cancel new organisation"
              className="grid h-7 w-7 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Organisation kind
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as "client" | "employer")}
              className={INPUT_CLASS}
            >
              <option value="client">Client</option>
              <option value="employer">Employer</option>
            </select>
          </label>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            {kind === "client" ? "Client" : "Employer"} organisation name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === "client" ? "e.g. Acme Corporation" : "e.g. TechSpecialist Consult Limited"}
              className={INPUT_CLASS}
              autoFocus
            />
          </label>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Description (optional)
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
          >
            <Plus size={15} aria-hidden="true" /> {saving ? "Creating…" : `Create ${kindLabel}`}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#CFC8F3] text-sm font-semibold text-[#5A3ED0] transition hover:bg-[#F5F1FF]"
        >
          <Plus size={15} aria-hidden="true" /> New organisation
        </button>
      )}
    </section>
  );
}

function OrganisationEditor({
  org,
  onSave,
}: {
  org: Organisation;
  onSave: (input: { name?: string; description?: string | null; isActive?: boolean }) => Promise<boolean>;
}) {
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [isActive, setIsActive] = useState(org.isActive);
  const [saving, setSaving] = useState(false);

  const dirty = name !== org.name || description !== (org.description ?? "") || isActive !== org.isActive;

  async function save() {
    setSaving(true);
    const ok = await onSave({ name: name.trim(), description: description.trim() || null, isActive });
    setSaving(false);
    if (!ok) return;
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-[#17172F]">
            {org.name}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                org.kind === "client" ? "bg-[#EAF8F0] text-[#15803D]" : "bg-[#F1F0F6] text-[#6B6880]"
              }`}
            >
              {org.kind === "client" ? "Client" : "Employer"}
            </span>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#8B8B9A]">
            <span>Created {formatDay(org.createdAt)}</span>
            <span>· kind cannot be changed</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#53506B]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 accent-[#6C45F5]"
          />
          Active
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[#53506B]">
          Organisation name
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-xs font-semibold text-[#53506B]">
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this organisation is"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save organisation"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StatusChip({ status, isActive }: { status: string; isActive: boolean }) {
  if (!isActive) {
    return <span className="rounded-full bg-[#F1F0F6] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#8B8B9A]">Inactive</span>;
  }
  if (status === "pending") {
    return <span className="rounded-full bg-[#FFF4E0] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#9A6200]">Pending</span>;
  }
  if (status === "rejected") {
    return <span className="rounded-full bg-[#FDEEEE] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#B43A3A]">Rejected</span>;
  }
  return <span className="rounded-full bg-[#EAF8F0] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#15803D]">Approved</span>;
}

function PendingSuggestions({
  categories,
  subcategories,
  onReview,
}: {
  categories: ClientCategory[];
  subcategories: ClientSubcategory[];
  onReview: (input: {
    itemKind: "category" | "subcategory";
    id: string;
    decision: "approve" | "reject";
    name?: string;
  }) => Promise<boolean>;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const total = categories.length + subcategories.length;

  if (total === 0) return null;

  async function review(itemKind: "category" | "subcategory", id: string, decision: "approve" | "reject") {
    setBusyId(id);
    const name = names[id]?.trim();
    await onReview({ itemKind, id, decision, name: name || undefined });
    setBusyId(null);
  }

  function row(
    key: string,
    itemKind: "category" | "subcategory",
    id: string,
    name: string,
    meta: string
  ) {
    return (
      <li key={key} className="rounded-xl border border-[#F0D9A8] bg-[#FFFDF5] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9A6200]">
            {itemKind === "category" ? "Category" : "Subcategory"}
          </span>
          <span className="rounded-full bg-[#6C45F5]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[#5A3ED0]">
            New
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#17172F]">{name}</span>
        </div>
        <p className="mt-1 text-[11px] text-[#8B8B9A]">{meta}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={names[id] ?? name}
            onChange={(event) => setNames((prev) => ({ ...prev, [id]: event.target.value }))}
            aria-label={`Name for ${itemKind} suggestion`}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-1.5 text-xs text-[#17172F] outline-none focus:border-[#6C45F5]"
          />
          <button
            type="button"
            disabled={busyId === id}
            onClick={() => review(itemKind, id, "approve")}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#15803D] px-3 text-xs font-semibold text-white transition hover:bg-[#12703A] disabled:opacity-50"
          >
            <Check size={13} aria-hidden="true" /> Approve
          </button>
          <button
            type="button"
            disabled={busyId === id}
            onClick={() => review(itemKind, id, "reject")}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#E7E6F0] bg-white px-3 text-xs font-semibold text-[#B43A3A] transition hover:bg-[#FDEEEE] disabled:opacity-50"
          >
            <X size={13} aria-hidden="true" /> Reject
          </button>
        </div>
      </li>
    );
  }

  return (
    <section className="rounded-2xl border border-[#F0D9A8] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-[#B45309]" aria-hidden="true" />
        <h2 className="text-sm font-bold text-[#17172F]">Pending suggestions</h2>
        <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 text-[10px] font-bold text-[#9A6200]">{total} new</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#777A91]">
        Staff-submitted categories and subcategories. Approving makes them available to everyone on that client; rejecting keeps history intact.
      </p>
      <ul className="mt-3 grid gap-2 lg:grid-cols-2">
        {categories.map((item) =>
          row(
            `cat-${item.id}`,
            "category",
            item.id,
            item.name,
            `${item.clientOrganisationName ?? "Client"} · suggested by ${item.createdByName ?? "staff"} · ${formatDay(item.createdAt)}`
          )
        )}
        {subcategories.map((item) =>
          row(
            `sub-${item.id}`,
            "subcategory",
            item.id,
            item.name,
            `${item.clientOrganisationName ?? "Client"} · under ${item.categoryName ?? "category"} · suggested by ${item.createdByName ?? "staff"} · ${formatDay(item.createdAt)}`
          )
        )}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CataloguePanel({
  clientOrg,
  categories,
  subcategories,
  onCreateCategory,
  onUpdateCategory,
  onCreateSubcategory,
  onUpdateSubcategory,
}: {
  clientOrg: Organisation;
  categories: ClientCategory[];
  subcategories: ClientSubcategory[];
  onCreateCategory: (name: string) => Promise<boolean>;
  onUpdateCategory: (categoryId: string, input: { name?: string; isActive?: boolean }) => Promise<boolean>;
  onCreateSubcategory: (categoryId: string, name: string) => Promise<boolean>;
  onUpdateSubcategory: (subcategoryId: string, input: { name?: string; isActive?: boolean }) => Promise<boolean>;
}) {
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const subsByCategory = useMemo(() => {
    const map = new Map<string, ClientSubcategory[]>();
    for (const sub of subcategories) {
      const list = map.get(sub.categoryId) ?? [];
      list.push(sub);
      map.set(sub.categoryId, list);
    }
    return map;
  }, [subcategories]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  async function createCategory() {
    if (newCategory.trim().length < 2) return;
    setCreating(true);
    const ok = await onCreateCategory(newCategory.trim());
    setCreating(false);
    if (ok) setNewCategory("");
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[#17172F]">Category catalogue</h2>
          <p className="mt-0.5 text-[11px] text-[#777A91]">
            Categories and subcategories for {clientOrg.name}. Scoped to this client only.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-[#8B8B9A]">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} · {subcategories.length} subcategories
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createCategory();
          }}
          placeholder="New category name"
          aria-label="New category name"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#E7E6F0] bg-white px-3 py-2 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15"
        />
        <button
          type="button"
          onClick={createCategory}
          disabled={creating || newCategory.trim().length < 2}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#6C45F5] px-3.5 text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
        >
          <Plus size={15} aria-hidden="true" /> {creating ? "Adding…" : "Add category"}
        </button>
      </div>

      {sortedCategories.length === 0 ? (
        <p className="mt-4 rounded-xl bg-[#F7F7FC] px-4 py-6 text-center text-xs text-[#777A91]">
          No categories yet. Add the first one above — staff will only see approved, active items.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sortedCategories.map((category) => {
            const subs = subsByCategory.get(category.id) ?? [];
            const isOpen = expanded.has(category.id);
            return (
              <li key={category.id} className="rounded-xl border border-[#E7E6F0]">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(category.id)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.name}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F5F1FF] hover:text-[#5A3ED0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                  >
                    {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#17172F]">{category.name}</span>
                  <StatusChip status={category.approvalStatus} isActive={category.isActive} />
                  <span className="text-[10px] text-[#8B8B9A]">{subs.length} sub{subs.length === 1 ? "" : "s"}</span>
                  <CatalogueItemActions
                    name={category.name}
                    isActive={category.isActive}
                    onSave={(input) => onUpdateCategory(category.id, input)}
                  />
                </div>
                <p className="px-3 pb-1 pl-12 text-[10px] text-[#8B8B9A]">
                  Added {formatDay(category.createdAt)}
                  {category.reviewedAt ? ` · reviewed ${formatDay(category.reviewedAt)}` : ""}
                  {category.createdByName ? ` · by ${category.createdByName}` : ""}
                </p>
                {isOpen ? (
                  <div className="border-t border-[#F0EEF6] px-3 py-2.5 pl-12">
                    <SubcategoryList
                      categoryId={category.id}
                      subcategories={subs}
                      onCreate={onCreateSubcategory}
                      onUpdate={onUpdateSubcategory}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SubcategoryList({
  categoryId,
  subcategories,
  onCreate,
  onUpdate,
}: {
  categoryId: string;
  subcategories: ClientSubcategory[];
  onCreate: (categoryId: string, name: string) => Promise<boolean>;
  onUpdate: (subcategoryId: string, input: { name?: string; isActive?: boolean }) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (newName.trim().length < 2) return;
    setCreating(true);
    const ok = await onCreate(categoryId, newName.trim());
    setCreating(false);
    if (ok) setNewName("");
  }

  return (
    <div>
      {subcategories.length ? (
        <ul className="space-y-1.5">
          {[...subcategories]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((sub) => (
              <li key={sub.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#FCFBFF] px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#39364F]">{sub.name}</span>
                <StatusChip status={sub.approvalStatus} isActive={sub.isActive} />
                <CatalogueItemActions name={sub.name} isActive={sub.isActive} onSave={(input) => onUpdate(sub.id, input)} compact />
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[#8B8B9A]">No subcategories yet.</p>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
          placeholder="New subcategory"
          aria-label="New subcategory name"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#E7E6F0] bg-white px-2.5 py-1.5 text-xs text-[#17172F] outline-none transition focus:border-[#6C45F5]"
        />
        <button
          type="button"
          onClick={create}
          disabled={creating || newName.trim().length < 2}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-dashed border-[#CFC8F3] px-2.5 text-xs font-semibold text-[#5A3ED0] transition hover:bg-[#F5F1FF] disabled:opacity-50"
        >
          <Plus size={12} aria-hidden="true" /> {creating ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}

/** Inline rename + activate/deactivate control shared by categories and subcategories. */
function CatalogueItemActions({
  name,
  isActive,
  onSave,
  compact = false,
}: {
  name: string;
  isActive: boolean;
  onSave: (input: { name?: string; isActive?: boolean }) => Promise<boolean>;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  async function save(patch?: { name?: string; isActive?: boolean }) {
    setSaving(true);
    const ok = await onSave(patch ?? { name: draft.trim() });
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Rename item"
          className="min-h-8 w-36 rounded-lg border border-[#E7E6F0] bg-white px-2 py-1 text-xs text-[#17172F] outline-none focus:border-[#6C45F5]"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
        />
        <button
          type="button"
          aria-label="Save name"
          disabled={saving || draft.trim().length < 2}
          onClick={() => save()}
          className="grid h-8 w-8 place-items-center rounded-lg bg-[#6C45F5] text-white transition hover:bg-[#5935DE] disabled:opacity-50"
        >
          <Check size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Cancel rename"
          onClick={() => {
            setDraft(name);
            setEditing(false);
          }}
          className="grid h-8 w-8 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F7F7FC]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <span className={`flex shrink-0 items-center gap-0.5 ${compact ? "" : ""}`}>
      <button
        type="button"
        aria-label={`Rename ${name}`}
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="grid h-8 w-8 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F5F1FF] hover:text-[#5A3ED0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
      >
        <Pencil size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={isActive ? `Deactivate ${name}` : `Activate ${name}`}
        disabled={saving}
        onClick={() => save({ isActive: !isActive })}
        className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase transition disabled:opacity-50 ${
          isActive
            ? "text-[#B45309] hover:bg-[#FFF4E0]"
            : "text-[#15803D] hover:bg-[#EAF8F0]"
        }`}
      >
        {isActive ? "Deactivate" : "Activate"}
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */

function DeploymentsPanel({
  employees,
  clientOrgs,
  onAssign,
}: {
  employees: Employee[];
  clientOrgs: Organisation[];
  onAssign: (input: {
    employeeId: string;
    workArrangement: "in_house" | "client_site";
    clientOrganisationId?: string | null;
  }) => Promise<boolean>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));

  async function revertToInHouse(employee: Employee) {
    setPendingId(employee.id);
    await onAssign({ employeeId: employee.id, workArrangement: "in_house" });
    setPendingId(null);
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-[#17172F]">
          <Users size={15} className="text-[#6C45F5]" aria-hidden="true" /> Staff deployments
        </h2>
        <span className="text-[11px] font-semibold text-[#8B8B9A]">{employees.length} employees</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#777A91]">
        In-house staff use Projects → Subtasks. Client-site staff report against their assigned client&apos;s category catalogue.
      </p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {sorted.map((employee) => {
          const isClientSite = employee.workArrangement === "client_site";
          return (
            <li
              key={employee.id}
              className="flex min-h-12 items-center gap-2.5 rounded-xl border border-[#E7E6F0] bg-white px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#17172F]">{employee.name}</span>
                <span className="block truncate text-[11px] text-[#8B8B9A]">
                  {employee.role}
                  {employee.employerOrganisationName ? ` · ${employee.employerOrganisationName}` : ""}
                </span>
              </span>
              {isClientSite ? (
                <>
                  <span className="rounded-full bg-[#EAF8F0] px-2 py-0.5 text-[10px] font-bold uppercase text-[#15803D]">
                    Client-site
                  </span>
                  <span className="max-w-[120px] truncate text-[11px] text-[#53506B]">
                    {employee.clientOrganisationName ?? "—"}
                  </span>
                  <button
                    type="button"
                    disabled={pendingId === employee.id}
                    onClick={() => revertToInHouse(employee)}
                    className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase text-[#B43A3A] transition hover:bg-[#FDEEEE] disabled:opacity-50"
                  >
                    Revert
                  </button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-bold uppercase text-[#6B6880]">
                    In-house
                  </span>
                  <select
                    aria-label={`Deploy ${employee.name} to a client`}
                    disabled={pendingId === employee.id || clientOrgs.length === 0}
                    title={
                      clientOrgs.length === 0
                        ? "Create a client organisation first."
                        : "Assign this employee to a client organisation"
                    }
                    className="min-h-8 max-w-[140px] rounded-lg border border-[#E7E6F0] bg-white px-2 text-[11px] text-[#39364F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:cursor-not-allowed disabled:opacity-60"
                    value=""
                    onChange={async (event) => {
                      const clientOrganisationId = event.target.value;
                      if (!clientOrganisationId) return;
                      setPendingId(employee.id);
                      await onAssign({
                        employeeId: employee.id,
                        workArrangement: "client_site",
                        clientOrganisationId,
                      });
                      setPendingId(null);
                    }}
                  >
                    <option value="" disabled>
                      {pendingId === employee.id ? "Assigning…" : "Deploy to client…"}
                    </option>
                    {clientOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {clientOrgs.length === 0 ? (
        <p className="mt-3 rounded-xl bg-[#F7F7FC] px-3 py-2.5 text-[11px] text-[#777A91]">
          No active client organisations yet — create one to prepare deployments.
        </p>
      ) : null}
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[#8B8B9A]">
        <ShieldCheck size={12} aria-hidden="true" /> All assignment changes are permission-checked and audit-logged server-side.
      </p>
    </section>
  );
}
