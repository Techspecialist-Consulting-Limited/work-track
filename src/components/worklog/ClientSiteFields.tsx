"use client";

import { Building2, Plus, X } from "lucide-react";
import { WorkTrackSelect } from "@/components/WorkTrackSelect";
import { isOwnPendingSuggestion } from "@/lib/worklog/client-catalogue";
import { getSessionEmployeeId } from "@/lib/worklog/repository";
import type { WorkLogController } from "./useWorkLogController";

const NEW_BADGE = "Pending review · New";

/**
 * Client → Category → Subcategory pickers for client-site staff. The client
 * is read-only (it comes from the employee's assignment, never the browser);
 * categories/subcategories come from the employee's own client catalogue with
 * the employee's pending suggestions marked New.
 */
export function ClientSiteFields({ c, inputClass }: { c: WorkLogController; inputClass: string }) {
  const meId = getSessionEmployeeId() ?? "";
  const categoryOptions = [
    { value: "", label: "Select a category", description: "Choose what kind of client work this was" },
    ...c.clientCategoryOptions.map((row) => ({
      value: row.id,
      label: row.name,
      description: isOwnPendingSuggestion(row, meId) ? NEW_BADGE : undefined,
    })),
  ];
  const subcategoryOptions = [
    {
      value: "",
      label: "Select a subcategory",
      description: c.clientCategoryId ? "Choose the specific work" : "Choose a category first",
    },
    ...c.clientSubcategoryOptions.map((row) => ({
      value: row.id,
      label: row.name,
      description: isOwnPendingSuggestion(row, meId) ? NEW_BADGE : undefined,
    })),
  ];

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-[#53506B]">Client</span>
        <div className="mt-1 flex min-h-10 items-center gap-2 rounded-lg border border-[#E7E6F0] bg-[#F7F7FC] px-2.5 py-2 text-[13px] text-[#39364F] sm:text-sm">
          <Building2 size={14} className="shrink-0 text-[#8B7BE8]" aria-hidden="true" />
          <span className="truncate font-medium">{c.formClientOrgName ?? "Assigned client"}</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#53506B]">Category</span>
          <button
            type="button"
            onClick={() => c.openSuggestion("category")}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold text-[#6C45F5] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          >
            <Plus size={12} aria-hidden="true" /> Suggest new
          </button>
        </div>
        <div className="mt-1">
          <WorkTrackSelect
            label="Client category"
            value={c.clientCategoryId}
            onChange={c.chooseClientCategory}
            options={categoryOptions}
            placeholder="Select a category"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#53506B]">Subcategory</span>
          <button
            type="button"
            onClick={() => c.openSuggestion("subcategory")}
            disabled={!c.clientCategoryId}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold text-[#6C45F5] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:opacity-40"
          >
            <Plus size={12} aria-hidden="true" /> Suggest new
          </button>
        </div>
        <div className="mt-1">
          <WorkTrackSelect
            label="Client subcategory"
            value={c.clientSubcategoryId}
            onChange={c.setClientSubcategoryId}
            options={subcategoryOptions}
            placeholder={c.clientCategoryId ? "Select a subcategory" : "Choose a category first"}
            disabled={!c.clientCategoryId}
          />
        </div>
      </div>

      {c.suggestKind ? (
        <div className="rounded-lg border border-[#CFC8F3] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#39364F]">
              Suggest a {c.suggestKind === "category" ? "category" : "subcategory"}
              {c.suggestKind === "subcategory" && c.clientCategoryId
                ? ` under ${c.clientCategoryOptions.find((row) => row.id === c.clientCategoryId)?.name ?? "the selected category"}`
                : ""}
            </h3>
            <button
              type="button"
              onClick={() => c.setSuggestKind(null)}
              aria-label="Close suggestion"
              className="grid h-7 w-7 place-items-center rounded-md text-[#777A91] hover:bg-[#F7F7FC]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            {c.suggestKind === "category" ? "Category name" : "Subcategory name"}
            <input
              value={c.suggestName}
              maxLength={80}
              onChange={(event) => c.setSuggestName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void c.submitSuggestion();
                }
              }}
              placeholder={c.suggestKind === "category" ? "e.g. Deployment support" : "e.g. Server migration"}
              className={inputClass}
            />
          </label>
          {c.suggestError ? (
            <p role="alert" className="mt-2 rounded-md bg-[#FDEEEE] px-2 py-1.5 text-[11px] text-[#B43A3A]">
              {c.suggestError}
            </p>
          ) : null}
          <p className="mt-1.5 text-[10px] leading-4 text-[#9A97AD]">
            Sent for admin review — you can use it on your entries right away.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => c.setSuggestKind(null)}
              className="inline-flex min-h-9 items-center rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B] hover:bg-[#F7F7FC]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void c.submitSuggestion()}
              disabled={c.suggesting || c.suggestName.trim().length < 2}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
            >
              <Plus size={13} aria-hidden="true" />
              {c.suggesting ? "Sending…" : "Suggest"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
