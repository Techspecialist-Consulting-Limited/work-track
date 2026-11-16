"use client";

import { useEffect, useState } from "react";
import { Coffee, Square } from "lucide-react";
import { WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import { breakCountdown } from "@/lib/worklog/break-timer";

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Live break timer. Elapsed time is always derived from the persisted
 * break start timestamp, so refreshes, navigation, tab sleep and clock
 * changes cannot reset or corrupt it — the component just re-reads
 * `startAt` against the current time every second.
 */
export function BreakStatus({
  startAt,
  onEnd,
  compact = false,
}: {
  startAt: string;
  onEnd: () => void;
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const id = window.setInterval(update, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", update);
    };
  }, []);

  const countdown = breakCountdown(startAt, nowMs, WORKTRACK_SCHEDULE.breakAllowanceMinutes);
  const displaySeconds = countdown.exceeded ? countdown.overSeconds : countdown.remainingSeconds;

  return (
    <div
      role="status"
      aria-live="off"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F6D99A] bg-[#FFF6E5] ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#FDEBC8] text-[#B45309]">
          <Coffee size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#9A6200]">
            {countdown.exceeded ? "Break time exceeded" : "On break"}
          </p>
          <p className="text-xs font-medium text-[#8A5A00]">
            <span className="font-bold tabular-nums" aria-live="polite">
              {formatCountdown(displaySeconds)}
            </span>{" "}
            {countdown.exceeded ? "over allocated break time" : "remaining"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onEnd}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F59E0B] px-4 text-sm font-semibold text-white transition hover:bg-[#DB8A08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-2"
      >
        <Square size={14} aria-hidden="true" /> End Break
      </button>
    </div>
  );
}
