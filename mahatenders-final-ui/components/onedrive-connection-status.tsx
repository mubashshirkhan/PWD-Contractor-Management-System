"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

type ConnectionState = "loading" | "setup_required" | "disconnected" | "connected" | "cache_setup_required" | "cache_unavailable" | "cache_database_unavailable" | "cache_encryption_key_missing" | "cache_encryption_key_invalid_base64" | "cache_encryption_key_invalid_length" | "reconnect_required";

export function OneDriveConnectionStatus() {
  const queryClient = useQueryClient();
  const [previousCacheCleanupWarning, setPreviousCacheCleanupWarning] = useState(false);
  const statusQuery = useQuery({
    queryKey: queryKeys.oneDriveStatus,
    queryFn: async () => {
      const response = await fetch("/api/onedrive/status", { cache: "no-store" });
      const data = await response.json() as { status: ConnectionState };
      if (!response.ok && response.status !== 401 && response.status !== 503) throw new Error("Could not check OneDrive connection.");
      return data.status;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const status = statusQuery.data ?? (statusQuery.error ? "reconnect_required" : "loading");
  const previousStatus = useRef<ConnectionState | undefined>(undefined);

  useEffect(() => {
    setPreviousCacheCleanupWarning(new URLSearchParams(window.location.search).get("cache_cleanup") === "failed");
  }, []);

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
    cache_unavailable: "OneDrive cache unavailable",
    cache_database_unavailable: "OneDrive cache database unavailable",
    cache_encryption_key_missing: "OneDrive cache encryption key missing",
    cache_encryption_key_invalid_base64: "OneDrive cache encryption key is invalid",
    cache_encryption_key_invalid_length: "OneDrive cache encryption key has the wrong length",
    reconnect_required: "Reconnect OneDrive",
  };
  const connected = status === "connected";

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <p className="text-xs text-slate-300" aria-live="polite">
        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-amber-300"}`} />
        {labels[status]}
      </p>
      {previousCacheCleanupWarning && <p className="mt-2 text-xs text-amber-200" role="status">OneDrive connected, but the previous sign-in cache could not be cleared. Its encrypted entry may remain stored; retry account switching or contact support.</p>}
      {status === "disconnected" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start" onClick={clearSessionQueries}>Connect OneDrive</a>}
      {status === "reconnect_required" && <a className="mt-2 inline-block text-xs text-white underline underline-offset-4" href="/api/onedrive/auth/start" onClick={clearSessionQueries}>Reconnect OneDrive</a>}
      {status === "connected" && <a className="mt-2 inline-block text-xs text-slate-400 underline underline-offset-4 hover:text-white" href="/api/onedrive/auth/start?switch_account=1" onClick={clearSessionQueries}>Switch Microsoft account</a>}
      {status === "setup_required" && <p className="mt-2 text-xs text-slate-400">Add Microsoft sign-in settings to the server environment.</p>}
      {status === "cache_setup_required" && <p className="mt-2 text-xs text-slate-400">Configure the approved encrypted persistent token cache.</p>}
      {status === "cache_unavailable" && <p className="mt-2 text-xs text-slate-400">The saved sign-in could not be checked. Try again later; you do not need to sign in again yet.</p>}
      {status === "cache_database_unavailable" && <p className="mt-2 text-xs text-slate-400">The sign-in cache database could not be reached. Try again later; no sign-in is required yet.</p>}
      {status.startsWith("cache_encryption_key_") && <p className="mt-2 text-xs text-slate-400">Check the server-side ONEDRIVE_CACHE_ENCRYPTION_KEY configuration. Its value is never shown here.</p>}
    </div>
  );
}
