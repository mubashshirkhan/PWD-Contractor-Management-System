"use client";

import { useEffect, useState } from "react";

type ConnectionState = "loading" | "setup_required" | "disconnected" | "connected" | "cache_setup_required" | "reconnect_required";

export function OneDriveConnectionStatus() {
  const [status, setStatus] = useState<ConnectionState>("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/onedrive/status", { cache: "no-store" })
      .then(async (response) => response.json() as Promise<{ status: ConnectionState }>)
      .then((data) => { if (active) setStatus(data.status); })
      .catch(() => { if (active) setStatus("reconnect_required"); });
    return () => { active = false; };
  }, []);

  const labels: Record<ConnectionState, string> = {
    loading: "Checking OneDrive…",
    setup_required: "OneDrive setup required",
    disconnected: "OneDrive not connected",
    connected: "OneDrive connected",
    cache_setup_required: "OneDrive cache setup required",
    reconnect_required: "Reconnect OneDrive",
  };
  const connected = status === "connected";

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <p className="text-xs text-slate-300" aria-live="polite">
        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-amber-300"}`} />
        {labels[status]}
      </p>
      {status === "disconnected" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start">Connect OneDrive</a>}
      {status === "reconnect_required" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start">Reconnect OneDrive</a>}
      {status === "setup_required" && <p className="mt-2 text-xs text-slate-400">Add Microsoft sign-in settings to the server environment.</p>}
      {status === "cache_setup_required" && <p className="mt-2 text-xs text-slate-400">Configure the approved encrypted persistent token cache.</p>}
    </div>
  );
}
