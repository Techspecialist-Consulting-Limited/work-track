"use client";

import { useRef, useState } from "react";
import { FileText, Link2, Loader2, Paperclip, Trash2, X } from "lucide-react";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  validateAttachmentFile,
} from "@/lib/worklog/attachment-rules";

export { MAX_ATTACHMENT_BYTES };

export interface EvidenceItem {
  /** Local key for list rendering. */
  key: string;
  /** Server attachment id once uploaded (null while uploading/failed). */
  id: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Object URL for image thumbnails (local preview). */
  previewUrl?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  /** True for attachments already saved on the entry being edited. */
  linked?: boolean;
}

export function isEvidenceImage(item: Pick<EvidenceItem, "fileName" | "mimeType">): boolean {
  return item.mimeType.startsWith("image/") || item.fileName.toLowerCase().match(/\.(jpe?g|png|webp)$/) != null;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Immediate client-side feedback; the server re-validates everything. */
export function validateEvidenceFile(file: File): string | null {
  const problem = validateAttachmentFile(file.name, file.type, file.size);
  if (!problem.ok) return problem.message ?? "This file cannot be attached.";
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "")) {
    return `"${file.name}" has an unsupported file type.`;
  }
  return null;
}

interface EvidenceAttachmentsProps {
  items: EvidenceItem[];
  onFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  onInvalid?: (message: string) => void;
  disabled?: boolean;
  /** When provided, renders a compact "Add link" button next to the file button. */
  onAddLink?: () => void;
  linkActive?: boolean;
}

const ACTION_BUTTON =
  "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] disabled:opacity-50";

export function EvidenceAttachments({ items, onFiles, onRemove, onInvalid, disabled, onAddLink, linkActive }: EvidenceAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function acceptFiles(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const files = Array.from(list);
    const valid: File[] = [];
    for (const file of files) {
      const problem = validateEvidenceFile(file);
      if (problem) onInvalid?.(problem);
      else valid.push(file);
    }
    if (valid.length) onFiles(valid);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        acceptFiles(event.dataTransfer.files);
      }}
      className={`rounded-xl px-2 py-1.5 transition ${dragOver ? "bg-[#F5F1FF] ring-2 ring-[#6C45F5]/40" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
        onChange={(event) => acceptFiles(event.target.files)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={`${ACTION_BUTTON} border-[#D9D4EC] bg-white text-[#5A3ED0] hover:border-[#B8A8F8] hover:bg-[#FBFAFF]`}
        >
          <Paperclip size={14} aria-hidden="true" />
          Documents / Images
        </button>
        {onAddLink ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onAddLink}
            aria-expanded={linkActive}
            className={`${ACTION_BUTTON} ${
              linkActive
                ? "border-[#6C45F5] bg-[#F5F1FF] text-[#5A3ED0]"
                : "border-[#D9D4EC] bg-white text-[#53506B] hover:border-[#B8A8F8] hover:bg-[#FBFAFF]"
            }`}
          >
            <Link2 size={14} aria-hidden="true" />
            {linkActive ? "Hide link" : "Add link"}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-[#9A97AD]">
        Documents or images up to 10 MB each — or drag and drop files here.
      </p>

      {items.length ? (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2.5 rounded-lg border border-[#EEEAF2] bg-white px-2.5 py-2"
            >
              {isEvidenceImage(item) && item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md border border-[#E7E6F0] object-cover"
                />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#F1F0F6] text-[#6B6880]">
                  <FileText size={16} aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#39364F]">{item.fileName}</span>
                <span className="block text-[10px] text-[#9A97AD]">
                  {formatFileSize(item.sizeBytes)}
                  {item.status === "uploading" ? " · uploading…" : ""}
                  {item.status === "error" ? ` · ${item.error ?? "upload failed"}` : ""}
                  {item.linked ? " · saved" : ""}
                </span>
              </span>
              {item.status === "uploading" ? (
                <Loader2 size={15} className="shrink-0 animate-spin text-[#8B7BE8]" aria-label="Uploading" />
              ) : null}
              {item.status !== "uploading" ? (
                <button
                  type="button"
                  aria-label={`${item.linked ? "Remove saved attachment" : "Remove"} ${item.fileName}`}
                  title={item.linked ? "Remove this attachment from the saved entry" : undefined}
                  onClick={() => onRemove(item.key)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#9A97AD] hover:bg-[#FDEEEE] hover:text-[#B43A3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                >
                  {item.status === "error" ? <X size={15} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
