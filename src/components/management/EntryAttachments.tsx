"use client";

import { FileText } from "lucide-react";
import type { WorkEntryAttachment } from "@/lib/worklog/types";
import { formatFileSize, isEvidenceImage } from "@/components/worklog/EvidenceAttachments";

/**
 * Evidence attachments for one work entry in executive views. Links go
 * through the authorised endpoint which redirects to a short-lived signed
 * URL — no public storage links are ever rendered.
 */
export function EntryAttachments({ attachments }: { attachments: WorkEntryAttachment[] }) {
  if (!attachments.length) return null;
  const images = attachments.filter((row) => isEvidenceImage(row));
  const documents = attachments.filter((row) => !isEvidenceImage(row));

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      {images.slice(0, 3).map((row) => (
        <a
          key={row.id}
          href={`/api/worklog/attachments/${row.id}`}
          target="_blank"
          rel="noreferrer"
          title={`${row.fileName} — open preview`}
          className="block overflow-hidden rounded-md border border-[#E7E6F0] transition hover:border-[#B8A8F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/worklog/attachments/${row.id}`}
            alt={row.fileName}
            loading="lazy"
            className="h-10 w-10 object-cover"
          />
        </a>
      ))}
      {images.length > 3 ? (
        <a
          href={`/api/worklog/attachments/${images[3].id}`}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] font-semibold text-[#6C45F5] hover:underline"
        >
          +{images.length - 3} more
        </a>
      ) : null}
      {documents.map((row) => (
        <a
          key={row.id}
          href={`/api/worklog/attachments/${row.id}`}
          target="_blank"
          rel="noreferrer"
          title={`${row.fileName} (${row.mimeType}, ${formatFileSize(row.sizeBytes)}) — open`}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-[#E7E6F0] bg-[#FCFBFF] px-1.5 py-1 text-[10px] font-semibold text-[#5A3ED0] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
        >
          <FileText size={11} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{row.fileName}</span>
          <span className="shrink-0 text-[#9A97AD]">{formatFileSize(row.sizeBytes)}</span>
        </a>
      ))}
    </span>
  );
}
