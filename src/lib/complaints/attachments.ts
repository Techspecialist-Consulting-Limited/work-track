import "server-only";

import {
  createSignedUrl,
  deleteAttachmentObject,
  getStorageConfig,
  sanitizeFileName,
  uploadAttachmentObject,
  validateAttachmentFile,
} from "@/lib/worklog/attachments";

export {
  createSignedUrl,
  deleteAttachmentObject,
  getStorageConfig,
  sanitizeFileName,
  uploadAttachmentObject,
  validateAttachmentFile,
};

/** Storage key for a complaint attachment. Keeps complaint files grouped and private. */
export function complaintStoragePath(
  complaintId: string,
  attachmentId: string,
  fileName: string
): string {
  return `complaints/${complaintId}/${attachmentId}-${sanitizeFileName(fileName)}`;
}
