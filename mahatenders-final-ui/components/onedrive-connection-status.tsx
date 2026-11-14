"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

type ConnectionState = "loading" | "setup_required" | "disconnected" | "connected" | "cache_setup_required" | "reconnect_required";

export function OneDriveConnectionStatus() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.oneDriveStatus,
    queryFn: async () => {
      const response = await fetch("/api/onedrive/status", { cache: "no-store" });
      const data = await response.json() as { status: ConnectionState };
      if (!response.ok && response.status !== 401) throw new Error("Could not check OneDrive connection.");
      return data.status;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const status = statusQuery.data ?? (statusQuery.error ? "reconnect_required" : "loading");
  const previousStatus = useRef<ConnectionState | undefined>(undefined);

  useEffect(() => {
    if (!statusQuery.data) return;
    const previous = previousStatus.current;
    if (previous && previous !== statusQuery.data) {
      void queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.oneDriveStatus[0] });
    }
    previousStatus.current = statusQuery.data;
  }, [queryClient, statusQuery.data]);

  function clearSessionQueries() {
    queryClient.clear();
  }

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
      {status === "disconnected" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start" onClick={clearSessionQueries}>Connect OneDrive</a>}
      {status === "reconnect_required" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start" onClick={clearSessionQueries}>Reconnect OneDrive</a>}
      {status === "connected" && <a className="mt-2 inline-block text-xs text-slate-400 underline underline-offset-4 hover:text-white" href="/api/onedrive/auth/start?switch_account=1" onClick={clearSessionQueries}>Switch Microsoft account</a>}
      {status === "setup_required" && <p className="mt-2 text-xs text-slate-400">Add Microsoft sign-in settings to the server environment.</p>}
      {status === "cache_setup_required" && <p className="mt-2 text-xs text-slate-400">Configure the approved encrypted persistent token cache.</p>}
    </div>
  );
}
