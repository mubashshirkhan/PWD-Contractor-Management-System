"use client";

let activeCleanup: (() => void) | null = null;

export function printElement(elementId: string): void {
  if (!document.getElementById(elementId)) {
    throw new Error("The content selected for printing is unavailable.");
  }

  activeCleanup?.();
  const root = document.documentElement;
  const previousTarget = root.getAttribute("data-print-target");
  let fallbackTimer: number | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    if (previousTarget === null) root.removeAttribute("data-print-target");
    else root.setAttribute("data-print-target", previousTarget);
    window.removeEventListener("afterprint", cleanup);
    if (activeCleanup === cleanup) activeCleanup = null;
  };

  activeCleanup = cleanup;
  root.setAttribute("data-print-target", elementId);
  window.addEventListener("afterprint", cleanup, { once: true });
  fallbackTimer = window.setTimeout(cleanup, 60_000);

  window.requestAnimationFrame(() => window.print());
}
