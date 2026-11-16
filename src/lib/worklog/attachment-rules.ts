/**
 * Isomorphic attachment rules — safe to import from client and server.
 * The server re-validates everything; client checks are for instant feedback.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt",
  "jpg", "jpeg", "png", "webp",
]);

const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function isImageMime(mime: string): boolean {
  return IMAGE_TYPES.has(mime);
}

export interface AttachmentValidation {
  ok: boolean;
  message?: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Extension is authoritative; declared MIME is only a sanity cross-check. */
export function validateAttachmentFile(fileName: string, declaredMime: string, sizeBytes: number): AttachmentValidation {
  if (sizeBytes <= 0) return { ok: false, message: "The file is empty." };
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: `"${fileName}" is larger than the 10 MB limit.` };
  }
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const expectedMime = EXTENSION_MIME[ext];
  if (!expectedMime) {
    return { ok: false, message: `"${fileName}" has an unsupported file type. Upload PDF, Office documents, CSV, TXT, or JPG/PNG/WebP images.` };
  }
  const declared = declaredMime.trim().toLowerCase();
  const mimeMatches =
    declared === "" ||
    declared === "application/octet-stream" ||
    declared === expectedMime ||
    (expectedMime === "text/csv" && declared === "application/csv") ||
    // Browsers report inconsistent image subtypes — any image/* is fine for
    // an image extension since the extension already authorises the type.
    (IMAGE_TYPES.has(expectedMime) && declared.startsWith("image/"));
  if (!mimeMatches) {
    return { ok: false, message: `"${fileName}" does not look like a valid ${ext.toUpperCase()} file.` };
  }
  if (!DOCUMENT_TYPES.has(expectedMime) && !IMAGE_TYPES.has(expectedMime)) {
    return { ok: false, message: `"${fileName}" has an unsupported file type.` };
  }
  return { ok: true, mimeType: expectedMime, sizeBytes };
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  return cleaned || "file";
}
