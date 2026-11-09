"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { DaySummary } from "@/lib/worklog/selectors";

export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dateKeyParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export type PrimaryLocation = "office" | "home" | "mixed" | "other" | "unknown" | "none";

/** Primary recorded location for a day, derived from recorded minutes only. */
export function primaryLocation(day: DaySummary): PrimaryLocation {
  if (day.entries.length === 0) return "none";
  const { officeMinutes, homeMinutes, otherMinutes, unknownMinutes } = day;
  if (officeMinutes === 0 && homeMinutes === 0) {
    if (otherMinutes > 0) return "other";
    if (unknownMinutes > 0) return "unknown";
    return "none";
  }
  if (officeMinutes === homeMinutes) return "mixed";
  return officeMinutes > homeMinutes ? "office" : "home";
}

export const LOCATION_LABELS: Record<PrimaryLocation, string> = {
  office: "In Office",
  home: "From Home",
  mixed: "Mixed",
  other: "Other",
  unknown: "Location unknown",
  none: "—",
};

export function Avatar({
  name,
  avatarUrl,
  size = 48,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[#EFEAFF] font-bold text-[#5A3ED0]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

export function MetricCard({
  icon,
  iconClass,
  value,
  label,
}: {
  icon: ReactNode;
  iconClass: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#EAE8F2] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(23,23,43,0.04)]">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconClass}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-6 tracking-tight text-[#17172B]">{value}</span>
        <span className="block truncate text-[11px] font-medium text-[#666783]">{label}</span>
      </span>
    </div>
  );
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[#17172B]/40 lg:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#EAE8F2]" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#17172B]">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SheetOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3.5 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
        selected ? "bg-[#EFEAFF] text-[#4F31D0]" : "text-[#17172B] hover:bg-[#F7F6FC]"
      }`}
    >
      {label}
      {selected ? <span className="h-2 w-2 rounded-full bg-[#6040E8]" aria-hidden="true" /> : null}
    </button>
  );
}
