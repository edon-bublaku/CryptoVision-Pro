"use client";

import type { Timeframe } from "@cv/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./store/auth";
import { useScan, type ScanRow } from "./store/scan";

interface ServerScan {
  scan: { id: number; timeframe: Timeframe; finishedAt: string; coins: number; active: number } | null;
  rows: ScanRow[];
}

/**
 * Signal rows for the UI: the server's scheduled scan when the backend has one for this
 * timeframe and it is newer than the local browser scan, otherwise the local scan.
 */
export function useSignalRows(timeframe?: Timeframe) {
  const local = useScan();
  const tf = timeframe ?? local.timeframe;
  const hasDb = useAuth((s) => !!s.health?.db);
  const server = useQuery({
    queryKey: ["server-signals", tf],
    queryFn: ({ signal }) => api<ServerScan>(`/api/signals?tf=${tf}`, { signal }),
    enabled: hasDb,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const serverAt = server.data?.scan ? new Date(server.data.scan.finishedAt).getTime() : 0;
  const localAt = local.timeframe === tf ? (local.scannedAt ?? 0) : 0;
  if (serverAt > localAt && server.data?.rows.length)
    return { rows: server.data.rows, scannedAt: serverAt, timeframe: tf, source: "server" as const };
  return { rows: local.timeframe === tf ? local.rows : [], scannedAt: localAt || null, timeframe: tf, source: "local" as const };
}
