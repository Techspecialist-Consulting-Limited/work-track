"use client";

import { useEffect, useState } from "react";

interface ViewportStats {
  innerWidth: number;
  clientWidth: number;
  scrollWidth: number;
  vvWidth: number;
  vvHeight: number;
  vvScale: number;
  active: string;
  fontSize: string;
}

/** Temporary diagnostic overlay, enabled with ?viewport-debug in the URL. */
export function ViewportDebug() {
  const [stats, setStats] = useState<ViewportStats | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("viewport-debug")) return;

    const update = () => {
      const vv = window.visualViewport;
      const active = document.activeElement;
      setStats({
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        vvWidth: vv?.width ?? 0,
        vvHeight: vv?.height ?? 0,
        vvScale: vv?.scale ?? 1,
        active:
          active instanceof HTMLElement
            ? `${active.tagName.toLowerCase()}#${active.id || (typeof active.className === "string" ? active.className.slice(0, 40) : "")}`
            : "none",
        fontSize: active instanceof HTMLElement ? getComputedStyle(active).fontSize : "-",
      });
    };

    const id = window.setTimeout(update, 0);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      window.clearTimeout(id);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
    };
  }, []);

  if (!stats) return null;

  return (
    <div className="fixed bottom-24 left-1 z-[100] max-w-[320px] rounded-lg bg-black/85 p-2 font-mono text-[10px] leading-4 text-lime-300">
      <div>iw={stats.innerWidth} cw={stats.clientWidth} sw={stats.scrollWidth}</div>
      <div>vv={stats.vvWidth}x{stats.vvHeight} scale={stats.vvScale}</div>
      <div>focus: {stats.active} · fs={stats.fontSize}</div>
    </div>
  );
}
