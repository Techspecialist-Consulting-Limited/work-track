"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookTemplate, Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  applyCatalogueTemplate,
  deleteCatalogueTemplate,
  getDatabaseSnapshot,
  getServerSnapshot,
  saveCatalogueTemplate,
  saveClientCatalogueAsTemplate,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import { planTemplateApplication, validateTemplateTree } from "@/lib/worklog/catalogue-templates";
import type { AdminCatalogueTemplate } from "@/app/api/admin/catalogue-templates/route";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";

function formatDay(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

interface EditorCategory {
  key: string;
  name: string;
  subs: { key: string; name: string }[];
}

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

function TemplateEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: AdminCatalogueTemplate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cats, setCats] = useState<EditorCategory[]>(
    initial?.categories.map((cat) => ({
      key: nextKey(),
      name: cat.name,
      subs: cat.subcategories.map((sub) => ({ key: nextKey(), name: sub.name })),
    })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCat(key: string, patch: Partial<EditorCategory>) {
    setCats((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit() {
    const categories = cats
      .map((cat) => ({
        key: cat.key,
        name: cat.name,
        subcategories: cat.subs.filter((sub) => sub.name.trim().length > 0),
      }))
      .filter((cat) => cat.name.trim().length > 0);
    const checked = validateTemplateTree(categories);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveCatalogueTemplate({
        templateId: initial?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        categories,
      });
      if (!result || result.ok === false) {
        setError(result?.message ?? "Could not save the template.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#CFC8F3] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{initial ? "Edit template" : "New template"}</h3>
        <button type="button" onClick={onCancel} aria-label="Close editor" className="grid h-7 w-7 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC]">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <label className="mt-3 block text-[11px] font-semibold text-[#53506B]">
        Template name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General IT Support Catalogue" className={INPUT_CLASS} />
      </label>
      <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
      </label>

      <div className="mt-3 space-y-2">
        {cats.map((cat) => (
          <div key={cat.key} className="rounded-xl border border-[#EFEAF6] p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={cat.name}
                onChange={(e) => updateCat(cat.key, { name: e.target.value })}
                placeholder="Category name"
                className="min-h-9 flex-1 rounded-lg border border-[#E7E6F0] px-2.5 text-sm outline-none focus:border-[#6C45F5]"
              />
              <button
                type="button"
                onClick={() => setCats((rows) => rows.filter((row) => row.key !== cat.key))}
                aria-label={`Remove ${cat.name || "category"}`}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#B42318] hover:bg-[#FDECEC]"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-1.5 space-y-1 pl-3">
              {cat.subs.map((sub) => (
                <div key={sub.key} className="flex items-center gap-2">
                  <input
                    value={sub.name}
                    onChange={(e) =>
                      updateCat(cat.key, { subs: cat.subs.map((s) => (s.key === sub.key ? { ...s, name: e.target.value } : s)) })
                    }
                    placeholder="Subcategory name"
                    className="min-h-8 flex-1 rounded-lg border border-[#EFEAF6] bg-[#FBFAFE] px-2.5 text-xs outline-none focus:border-[#6C45F5]"
                  />
                  <button
                    type="button"
                    onClick={() => updateCat(cat.key, { subs: cat.subs.filter((s) => s.key !== sub.key) })}
                    aria-label={`Remove ${sub.name || "subcategory"}`}
                    className="grid h-7 w-7 place-items-center rounded-lg text-[#B42318] hover:bg-[#FDECEC]"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => updateCat(cat.key, { subs: [...cat.subs, { key: nextKey(), name: "" }] })}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6C45F5] hover:underline"
              >
                <Plus size={11} aria-hidden="true" /> Add subcategory
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setCats((rows) => [...rows, { key: nextKey(), name: "", subs: [] }])}
          className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#CFC8F3] text-xs font-semibold text-[#5A3ED0] hover:bg-[#F5F1FF]"
        >
          <Plus size={13} aria-hidden="true" /> Add category
        </button>
      </div>

      {error ? <p className="mt-3 rounded-xl bg-[#FDECEC] px-3 py-2 text-xs font-semibold text-[#B42318]">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"
      >
        <Check size={15} aria-hidden="true" /> {saving ? "Saving…" : initial ? "Save changes" : "Create template"}
      </button>
    </section>
  );
}

export function CatalogueTemplatesAdmin() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const [templates, setTemplates] = useState<AdminCatalogueTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<AdminCatalogueTemplate | "new" | null>(null);

  // Save-from-client state
  const [saveClientId, setSaveClientId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [savingFromClient, setSavingFromClient] = useState(false);

  // Apply state
  const [applyClientId, setApplyClientId] = useState("");
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const clients = useMemo(
    () => db.organisations.filter((org) => org.kind === "client" && org.isActive),
    [db.organisations]
  );
  const applyTemplate = templates.find((t) => t.id === applyTemplateId);

  const applyPlan = useMemo(() => {
    if (!applyTemplate || !applyClientId) return null;
    const cats = db.clientCategories.filter(
      (row) => row.clientOrganisationId === applyClientId && row.approvalStatus !== "rejected"
    );
    const catIds = cats.map((row) => row.id);
    const subs = db.clientSubcategories.filter(
      (row) => row.clientOrganisationId === applyClientId && catIds.includes(row.categoryId) && row.approvalStatus !== "rejected"
    );
    const nodes = applyTemplate.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
      subcategories: cat.subcategories.map((sub) => ({ id: sub.id, name: sub.name, sortOrder: sub.sortOrder })),
    }));
    return planTemplateApplication(nodes, cats, subs, selectedCatIds.size ? selectedCatIds : undefined);
  }, [applyTemplate, applyClientId, selectedCatIds, db.clientCategories, db.clientSubcategories]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/catalogue-templates", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { templates: AdminCatalogueTemplate[] };
        setTemplates(data.templates);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(promise: Promise<{ ok?: boolean; message?: string } | null>, success: string) {
    setError(null);
    setNotice(null);
    try {
      const result = await promise;
      if (!result || result.ok === false) {
        setError(result?.message ?? "That change could not be saved.");
        return false;
      }
      setNotice(success);
      await load();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    }
  }

  async function saveFromClient() {
    if (!saveClientId || saveName.trim().length < 2) {
      setError("Choose a client and enter a template name.");
      return;
    }
    setSavingFromClient(true);
    try {
      const ok = await run(
        saveClientCatalogueAsTemplate({ clientOrganisationId: saveClientId, name: saveName.trim(), description: saveDesc.trim() || undefined }),
        "Client catalogue saved as a template."
      );
      if (ok) {
        setSaveClientId("");
        setSaveName("");
        setSaveDesc("");
      }
    } finally {
      setSavingFromClient(false);
    }
  }

  async function apply() {
    if (!applyClientId || !applyTemplateId || selectedCatIds.size === 0) {
      setError("Choose a client, a template and at least one category.");
      return;
    }
    setApplying(true);
    try {
      await run(
        applyCatalogueTemplate({ clientOrganisationId: applyClientId, templateId: applyTemplateId, categoryIds: [...selectedCatIds] }),
        "Template applied to the client catalogue."
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? <p className="rounded-xl border border-[#C7EBD8] bg-[#ECFDF5] px-4 py-2.5 text-sm text-[#047857]">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-[#F6C7C7] bg-[#FDEEEE] px-4 py-2.5 text-sm text-[#B43A3A]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Save a client's catalogue as a template */}
        <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Copy size={15} className="text-[#6C45F5]" aria-hidden="true" /> Save client catalogue as template
          </h2>
          <p className="mt-1 text-[11px] text-[#777A91]">Copies approved and active categories only — pending or rejected suggestions are excluded.</p>
          <label className="mt-3 block text-[11px] font-semibold text-[#53506B]">
            Client organisation
            <select value={saveClientId} onChange={(e) => setSaveClientId(e.target.value)} className={INPUT_CLASS}>
              <option value="">Select client…</option>
              {clients.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Template name
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. General IT Support Catalogue" className={INPUT_CLASS} />
          </label>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Description (optional)
            <input value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} className={INPUT_CLASS} />
          </label>
          <button
            type="button"
            onClick={saveFromClient}
            disabled={savingFromClient}
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"
          >
            <BookTemplate size={15} aria-hidden="true" /> {savingFromClient ? "Saving…" : "Save as template"}
          </button>
        </section>

        {/* Apply a template to a client */}
        <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <BookTemplate size={15} className="text-[#6C45F5]" aria-hidden="true" /> Apply template to client
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[#53506B]">
              Client organisation
              <select value={applyClientId} onChange={(e) => { setApplyClientId(e.target.value); setSelectedCatIds(new Set()); }} className={INPUT_CLASS}>
                <option value="">Select client…</option>
                {clients.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[#53506B]">
              Template
              <select
                value={applyTemplateId}
                onChange={(e) => {
                  setApplyTemplateId(e.target.value);
                  const tpl = templates.find((t) => t.id === e.target.value);
                  setSelectedCatIds(new Set(tpl?.categories.map((c) => c.id) ?? []));
                }}
                className={INPUT_CLASS}
              >
                <option value="">Select template…</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
              </select>
            </label>
          </div>

          {applyTemplate && applyClientId ? (
            <div className="mt-3 rounded-xl border border-[#EFEAF6] p-3">
              <p className="text-[11px] font-semibold text-[#53506B]">Choose categories to apply</p>
              <ul className="mt-2 space-y-1">
                {applyTemplate.categories.map((cat) => {
                  const checked = selectedCatIds.has(cat.id);
                  const exists = applyPlan?.existingCategoryNames.includes(cat.name);
                  return (
                    <li key={cat.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[#F7F6FC]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedCatIds);
                            if (e.target.checked) next.add(cat.id);
                            else next.delete(cat.id);
                            setSelectedCatIds(next);
                          }}
                          className="h-4 w-4 accent-[#6C45F5]"
                        />
                        <span className="font-semibold text-[#17172F]">{cat.name}</span>
                        <span className="text-[10px] text-[#8A8FA8]">
                          {cat.subcategories.length} {cat.subcategories.length === 1 ? "subcategory" : "subcategories"}
                          {exists ? " · already exists" : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {applyPlan ? (
                <p className="mt-2 rounded-lg bg-[#F7F6FC] px-3 py-2 text-[11px] text-[#53506B]">
                  Will add <strong>{applyPlan.newCategories.length}</strong> {applyPlan.newCategories.length === 1 ? "category" : "categories"} and{" "}
                  <strong>
                    {applyPlan.newCategories.reduce((t, c) => t + c.subcategories.length, 0) +
                      applyPlan.additionsToExisting.reduce((t, c) => t + c.subcategories.length, 0)}
                  </strong>{" "}
                  subcategories. {applyPlan.existingCategoryNames.length + applyPlan.skippedSubcategoryCount > 0
                    ? `${applyPlan.existingCategoryNames.length + applyPlan.skippedSubcategoryCount} item(s) already exist and will be skipped.`
                    : "No duplicates."}
                </p>
              ) : null}
              <button
                type="button"
                onClick={apply}
                disabled={applying || !applyPlan || (applyPlan.newCategories.length === 0 && applyPlan.additionsToExisting.length === 0)}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"
              >
                <Check size={15} aria-hidden="true" /> {applying ? "Applying…" : "Apply selected categories"}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {/* Template library */}
      <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">
            Catalogue templates <span className="ml-1 rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">{templates.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setEditor(editor === "new" ? null : "new")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE]"
          >
            <Plus size={14} aria-hidden="true" /> New template
          </button>
        </div>

        {editor ? (
          <div className="mt-3">
            <TemplateEditor
              initial={editor === "new" ? undefined : editor}
              onCancel={() => setEditor(null)}
              onSaved={async () => {
                setEditor(null);
                setNotice(editor === "new" ? "Template created." : "Template updated.");
                await load();
              }}
            />
          </div>
        ) : null}

        {loading ? (
          <p className="mt-4 text-sm text-[#777A91]">Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="mt-4 rounded-xl bg-[#F7F7FC] px-4 py-6 text-center text-sm text-[#777A91]">
            No templates yet. Save a client&apos;s catalogue or build one manually.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[#F0EFF6]">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#17172F]">{tpl.name}</p>
                  <p className="text-[11px] text-[#777A91]">
                    {tpl.categories.length} {tpl.categories.length === 1 ? "category" : "categories"}
                    {tpl.description ? ` · ${tpl.description}` : ""}
                    {" · "}updated {formatDay(tpl.updatedAt)}
                    {tpl.createdByName ? ` · by ${tpl.createdByName}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditor(tpl)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] hover:bg-[#F7F7FC]"
                >
                  <Pencil size={12} aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete template "${tpl.name}"? Client catalogues already created from it are not affected.`)) {
                      void run(deleteCatalogueTemplate(tpl.id), "Template deleted.");
                    }
                  }}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FDECEC] px-2.5 text-[11px] font-semibold text-[#B42318] hover:bg-[#FDECEC]"
                >
                  <Trash2 size={12} aria-hidden="true" /> Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
