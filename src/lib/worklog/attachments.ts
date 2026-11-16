import "server-only";

/**
 * Evidence attachment storage (server-only).
 *
 * Binaries live in a PRIVATE Supabase Storage bucket (`worktrack-evidence`);
 * Postgres only stores metadata in `time_entry_attachments`. All access is
 * server-side: uploads go through /api/worklog/attachments and downloads are
 * short-lived signed URLs minted by /api/worklog/attachments/[id].
 * File-type/size rules live in ./attachment-rules (isomorphic, unit-tested).
 *
 * Required environment:
 *   SUPABASE_URL                – e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   – service-role key (server-only, never NEXT_PUBLIC_*)
 * The bucket must exist and be private:
 *   supabase storage create worktrack-evidence --public=false   (or dashboard)
 */

import {
  isImageMime,
  sanitizeFileName,
  validateAttachmentFile,
  MAX_ATTACHMENT_BYTES,
  type AttachmentValidation,
} from "./attachment-rules";

export {
  isImageMime,
  sanitizeFileName,
  validateAttachmentFile,
  MAX_ATTACHMENT_BYTES,
  type AttachmentValidation,
};

export const ATTACHMENT_BUCKET = "worktrack-evidence";

export interface StorageConfig {
  url: string;
  serviceKey: string;
}

export function getStorageConfig(): StorageConfig | null {
  // Accept either https://<ref>.supabase.co or the REST URL …/rest/v1.
  const raw = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const url = raw || undefined;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

async function storageFetch(config: StorageConfig, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${config.url}/storage/v1${path}`, {
    ...init,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

/** Upload an object into the private bucket. Returns nothing on success. */
export async function uploadAttachmentObject(
  config: StorageConfig,
  storagePath: string,
  body: ArrayBuffer,
  mimeType: string
): Promise<void> {
  const res = await storageFetch(config, `/object/${ATTACHMENT_BUCKET}/${storagePath}`, {
    method: "POST",
    headers: { "Content-Type": mimeType, "x-upsert": "false" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Storage upload failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}

export async function deleteAttachmentObject(config: StorageConfig, storagePath: string): Promise<void> {
  await storageFetch(config, `/object/${ATTACHMENT_BUCKET}/${storagePath}`, { method: "DELETE" }).catch(() => {});
}

/** Mint a short-lived signed URL for an object in the private bucket. */
export async function createSignedUrl(
  config: StorageConfig,
  storagePath: string,
  expiresInSeconds = 120
): Promise<string | null> {
  const res = await storageFetch(config, `/object/sign/${ATTACHMENT_BUCKET}/${storagePath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) return null;
  return `${config.url}/storage/v1${data.signedURL}`;
}
