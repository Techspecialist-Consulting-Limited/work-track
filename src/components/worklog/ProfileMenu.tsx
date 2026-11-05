"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Camera, LogOut, UserRound, X } from "lucide-react";
import { saveProfile } from "@/lib/worklog/repository";

interface ProfileMenuProps {
  name: string;
  role: string;
  avatarUrl?: string;
  /** Staff can edit name + photo. Management accounts have no employee record. */
  editable?: boolean;
  /** When true the dialog cannot be dismissed until a photo is saved. */
  required?: boolean;
}

function initialsOf(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "WT";
}

/** Loads a File into an HTMLImageElement (works everywhere createImageBitmap doesn't). */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a readable image."));
    };
    img.src = url;
  });
}

/**
 * Downscales an image file to a compact data URL for avatarUrl storage.
 * Steps quality/dimensions down until it fits the server's ~300KB limit.
 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Image is too large (max 10MB).");

  const img = await loadImage(file);
  const MAX_DIM = 512;
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  for (const quality of [0.85, 0.7, 0.55]) {
    for (const type of ["image/webp", "image/jpeg"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not process the image.");
      ctx.drawImage(img, 0, 0, w, h);
      const url = canvas.toDataURL(type, quality);
      // Unsupported types return a PNG data URL — skip those.
      if (!url.startsWith(`data:${type}`)) continue;
      if (url.length <= 380_000) return url;
    }
  }
  throw new Error("Could not compress the image enough. Try a smaller photo.");
}

export function ProfileMenu({ name, role, avatarUrl, editable = false, required = false }: ProfileMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(name);
  const [photo, setPhoto] = useState<string | null>(avatarUrl ?? null);
  const [photoMode, setPhotoMode] = useState<"upload" | "link">("upload");
  const [photoLink, setPhotoLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isRequired = required && !photo;
  const showDialog = open || isRequired;

  useEffect(() => {
    if (!showDialog || isRequired) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDialog, isRequired]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setPhoto(await fileToAvatarDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveProfile({
      ...(editable ? { fullName: fullName.trim() } : {}),
      avatarUrl: photo,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Profile — ${name}`}
        className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#F0EDFF] text-[11px] font-bold text-[#5A3ED0] transition hover:ring-2 hover:ring-[#6C45F5]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initialsOf(name)
        )}
      </button>

      {showDialog ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-[#17172B]/45 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isRequired) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Profile"
            className="w-full max-w-sm rounded-3xl border border-[#EAE8F2] bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#17172B]">{isRequired ? "Complete your profile" : "Profile"}</h2>
              {!isRequired ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close profile"
                  className="grid h-8 w-8 place-items-center rounded-lg text-[#777A91] transition hover:bg-[#F4F3FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {isRequired ? (
              <p className="mb-4 rounded-xl bg-[#F5F1FF] px-3 py-2.5 text-xs leading-4 text-[#4A3FB0]">
                Add your name and a photo to start logging work.
              </p>
            ) : null}

            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#F0EDFF] text-sm font-bold text-[#5A3ED0]">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  initialsOf(fullName || name)
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#17172B]">{name}</p>
                <p className="text-xs text-[#777A91]">{role}</p>
              </div>
            </div>

            {editable ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-[#4A4665]">Full name</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={120}
                    className="min-h-11 w-full rounded-xl border border-[#E2E0EE] bg-white px-3 text-base text-[#17172B] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/25"
                  />
                </label>

                <div>
                  <span className="mb-1 block text-xs font-semibold text-[#4A4665]">Photo</span>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPhotoMode("upload")}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${photoMode === "upload" ? "bg-[#F0EDFF] text-[#5A3ED0]" : "bg-[#F4F3FA] text-[#666783]"}`}
                    >
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhotoMode("link")}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${photoMode === "link" ? "bg-[#F0EDFF] text-[#5A3ED0]" : "bg-[#F4F3FA] text-[#666783]"}`}
                    >
                      Image link
                    </button>
                  </div>
                  {photoMode === "upload" ? (
                    <>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#CFC8F3] bg-[#FAF9FF] px-3 text-sm font-semibold text-[#5A3ED0] transition hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                      >
                        <Camera size={16} aria-hidden="true" />
                        {photo ? "Change photo" : "Choose a photo"}
                      </button>
                    </>
                  ) : (
                    <input
                      type="url"
                      value={photoLink}
                      onChange={(e) => setPhotoLink(e.target.value)}
                      placeholder="https://… image link"
                      className="min-h-11 w-full rounded-xl border border-[#E2E0EE] bg-white px-3 text-base text-[#17172B] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/25"
                    />
                  )}
                  {photoMode === "link" && photoLink ? (
                    <button
                      type="button"
                      onClick={() => setPhoto(photoLink.trim() || null)}
                      className="mt-2 text-xs font-semibold text-[#5A3ED0] underline-offset-2 hover:underline"
                    >
                      Use this link
                    </button>
                  ) : null}
                </div>
              </div>
            ) : photo ? null : (
              <p className="flex items-center gap-2 rounded-xl bg-[#F5F1FF] px-3 py-2.5 text-xs text-[#4A3FB0]">
                <UserRound size={14} aria-hidden="true" /> No photo set.
              </p>
            )}

            {error ? <p role="alert" className="mt-3 text-xs font-medium text-[#B43A3A]">{error}</p> : null}

            <div className="mt-5 space-y-2">
              {editable ? (
                <button
                  type="button"
                  disabled={saving || (editable && fullName.trim().length < 2) || (!photo && photoMode === "link" && !photoLink.trim() && !photo)}
                  onClick={handleSave}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#6C45F5] px-4 text-sm font-bold text-white transition hover:bg-[#5A36D6] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2"
                >
                  {saving ? "Saving…" : isRequired ? "Save & continue" : "Save"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => signOut({ redirectTo: "/login" })}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#E2E0EE] px-4 text-sm font-semibold text-[#4A4665] transition hover:bg-[#F4F3FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
