"use client";

import { useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import type { Drawing } from "@/lib/chart/drawing-types";
import { translate } from "@/lib/i18n";
import { useAlerts, type Alert } from "@/lib/store/alerts";
import { useAuth } from "@/lib/store/auth";
import { useDrawings } from "@/lib/store/drawings";
import { usePortfolio, type ClosedTrade, type PaperOrder, type Position } from "@/lib/store/portfolio";
import { useSavedScans } from "@/lib/store/screens";
import { useStrategies } from "@/lib/store/strategies";
import { useSettings, type SettingsState } from "@/lib/store/settings";
import { toast } from "../ui/toast";

/** Settings that follow the user across devices (never secrets such as the personal bot token). */
const SYNCED_SETTINGS = ["lang", "theme", "colorblind", "riskProfile", "equity", "riskPct", "maxLeverage", "maxPositions", "feePct", "defaultTf", "scanSize", "watchlist", "chart"] as const;

type StateDoc = { value: unknown; version: number };
interface SyncSnapshot {
  state: Record<string, StateDoc>;
  drawings: Record<string, { data: Drawing[]; updatedAt: string }>;
  portfolio: { positions: Position[]; closed: ClosedTrade[] };
  alerts: (Alert & { drawing?: { id: string; type: string; points: { time: number; price: number }[] } })[];
}

const newest = (list: Drawing[]) => list.reduce((m, d) => Math.max(m, d.updatedAt ?? 0), 0);

function pickSettings(s: SettingsState) {
  return Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]]));
}

function unionById<T extends { id: string }>(local: T[], server: T[]): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const s of server) map.set(s.id, s);
  return [...map.values()];
}

/**
 * Chart layout (panels) stays per device on purpose: syncing it would fight deep links.
 *
 * Mirrors local stores to the server while signed in. On login the server snapshot is merged
 * with local data (newest drawing set per symbol, union of positions/alerts, server settings win),
 * then every change is pushed with a short debounce. Local-only mode keeps working untouched.
 */
export function SyncManager() {
  const user = useAuth((s) => s.user);
  const health = useAuth((s) => s.health);
  const setSync = useAuth((s) => s.setSync);
  const versions = useRef<Record<string, number | null>>({});
  const applying = useRef(false);

  useEffect(() => {
    if (!user || !health?.db) return;
    let cancelled = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const dirtySymbols = new Set<string>();
    let inflight = 0;

    const track = async (fn: () => Promise<unknown>) => {
      inflight++;
      setSync("syncing");
      try {
        await fn();
        if (--inflight === 0) setSync("synced");
      } catch (e) {
        inflight--;
        setSync("error");
        if (e instanceof ApiError && e.status === 401) useAuth.getState().setUser(null);
      }
    };

    const putState = (key: string, value: unknown) =>
      track(async () => {
        try {
          const r = await api<{ version: number }>(`/api/sync/state/${key}`, { method: "PUT", body: { value, baseVersion: versions.current[key] ?? null } });
          versions.current[key] = r.version;
        } catch (e) {
          // Another device wrote first: adopt the server copy (last writer wins per document).
          if (e instanceof ApiError && e.status === 409) {
            const cur = e.data.current as StateDoc;
            versions.current[key] = cur.version;
            apply(() => applyState(key, cur.value));
          } else throw e;
        }
      });

    const pushDrawings = () =>
      track(async () => {
        const syms = [...dirtySymbols];
        dirtySymbols.clear();
        const all = useDrawings.getState().bySymbol;
        for (const sym of syms) await api(`/api/sync/drawings/${sym}`, { method: "PUT", body: { data: all[sym] ?? [] } });
      });

    const pushPortfolio = () =>
      track(() => {
        const p = usePortfolio.getState();
        return api("/api/sync/portfolio", { method: "PUT", body: { positions: p.positions, closed: p.closed } });
      });

    const pushAlerts = () =>
      track(() => {
        const drawings = useDrawings.getState().bySymbol;
        const alerts = useAlerts.getState().alerts.map((a) => {
          const d = a.drawingId ? drawings[a.symbol]?.find((x) => x.id === a.drawingId) : undefined;
          return {
            id: a.id,
            symbol: a.symbol,
            type: a.type,
            value: a.value,
            timeframe: a.timeframe,
            drawingId: a.drawingId,
            drawing: d ? { id: d.id, type: d.type, points: d.points.slice(0, 3) } : undefined,
            once: a.once,
            active: a.active,
            createdAt: a.createdAt,
            note: a.note,
          };
        });
        return api("/api/sync/alerts", { method: "PUT", body: { alerts } });
      });

    const debounce = (key: string, fn: () => void, ms = 800) => {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(fn, ms));
    };

    function apply(fn: () => void) {
      applying.current = true;
      try {
        fn();
      } finally {
        applying.current = false;
      }
    }

    function applyState(key: string, value: unknown) {
      if (!value || typeof value !== "object") return;
      if (key === "settings") useSettings.setState(value as Partial<SettingsState>);
      if (key === "screens") useSavedScans.setState({ saved: (value as { saved: [] }).saved ?? [] });
      if (key === "strategies") useStrategies.setState({ saved: (value as { saved: [] }).saved ?? [] });
      if (key === "orders") usePortfolio.setState({ orders: (value as { orders: PaperOrder[] }).orders ?? [] });
    }

    (async () => {
      setSync("syncing");
      try {
        const snap = await api<SyncSnapshot>("/api/sync");
        if (cancelled) return;
        apply(() => {
          for (const [k, doc] of Object.entries(snap.state)) {
            versions.current[k] = doc.version;
            // Pending orders placed offline on this device are kept alongside the server's.
            if (k === "orders") usePortfolio.setState({ orders: unionById(usePortfolio.getState().orders, (doc.value as { orders?: PaperOrder[] } | null)?.orders ?? []) });
            else applyState(k, doc.value);
          }
          const local = useDrawings.getState().bySymbol;
          const merged: Record<string, Drawing[]> = { ...local };
          for (const [sym, d] of Object.entries(snap.drawings)) {
            const loc = local[sym];
            if (!loc?.length || newest(d.data) >= newest(loc)) merged[sym] = d.data;
            else dirtySymbols.add(sym);
          }
          for (const sym of Object.keys(local)) if (!snap.drawings[sym] && local[sym]?.length) dirtySymbols.add(sym);
          useDrawings.setState({ bySymbol: merged });
          const p = usePortfolio.getState();
          usePortfolio.setState({ positions: unionById(p.positions, snap.portfolio.positions), closed: unionById(p.closed, snap.portfolio.closed) });
          useAlerts.setState({ alerts: unionById(useAlerts.getState().alerts, snap.alerts.map(({ drawing: _d, ...a }) => a)) });
        });
        // Push the merged result so both sides converge.
        const s = useSettings.getState();
        await Promise.all([
          snap.state.settings ? Promise.resolve() : putState("settings", pickSettings(s)),
          snap.state.screens ? Promise.resolve() : putState("screens", { saved: useSavedScans.getState().saved }),
          snap.state.strategies ? Promise.resolve() : putState("strategies", { saved: useStrategies.getState().saved }),
          putState("orders", { orders: usePortfolio.getState().orders }),
          dirtySymbols.size ? pushDrawings() : Promise.resolve(),
          pushPortfolio(),
          pushAlerts(),
        ]);
        if (cancelled) return;
        setSync("synced");
        toast({ title: translate(useSettings.getState().lang, "sync.done"), tone: "success" });
      } catch {
        setSync("error");
      }
    })();

    const unsubs = [
      useSettings.subscribe((s, prev) => {
        if (applying.current) return;
        if (SYNCED_SETTINGS.some((k) => s[k] !== prev[k])) debounce("settings", () => void putState("settings", pickSettings(useSettings.getState())));
      }),
      useSavedScans.subscribe((s, prev) => {
        if (!applying.current && s.saved !== prev.saved) debounce("screens", () => void putState("screens", { saved: useSavedScans.getState().saved }));
      }),
      useStrategies.subscribe((s, prev) => {
        if (!applying.current && s.saved !== prev.saved) debounce("strategies", () => void putState("strategies", { saved: useStrategies.getState().saved }));
      }),
      useDrawings.subscribe((s, prev) => {
        if (applying.current || s.bySymbol === prev.bySymbol) return;
        for (const sym of new Set([...Object.keys(s.bySymbol), ...Object.keys(prev.bySymbol)])) if (s.bySymbol[sym] !== prev.bySymbol[sym]) dirtySymbols.add(sym);
        debounce("drawings", () => void pushDrawings(), 600);
      }),
      usePortfolio.subscribe((s, prev) => {
        if (applying.current) return;
        if (s.positions !== prev.positions || s.closed !== prev.closed) debounce("portfolio", () => void pushPortfolio());
        if (s.orders !== prev.orders) debounce("orders", () => void putState("orders", { orders: usePortfolio.getState().orders }));
      }),
      useAlerts.subscribe((s, prev) => {
        if (!applying.current && s.alerts !== prev.alerts) debounce("alerts", () => void pushAlerts());
      }),
    ];

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      for (const t of timers.values()) clearTimeout(t);
      setSync("off");
    };
  }, [user, health?.db, setSync]);

  return null;
}

/**
 * Live server events over SSE: alert deliveries and "new scan" notices. When the worker is
 * running, it is the single source of alert notifications for signed-in users.
 */
export function EventsBridge({ onScan }: { onScan: (tf: string) => void }) {
  const user = useAuth((s) => s.user);
  const health = useAuth((s) => s.health);
  useEffect(() => {
    if (!health?.realtime) return;
    const es = new EventSource("/api/events");
    es.addEventListener("alert", (ev) => {
      const e = JSON.parse((ev as MessageEvent<string>).data) as { alertId: string | null; symbol: string; title: string; message: string };
      toast({ title: e.title, body: e.message, tone: "warn" });
      useAlerts.getState().log({ alertId: e.alertId ?? "", symbol: e.symbol, message: `${e.title}: ${e.message}` });
      const local = useAlerts.getState().alerts.find((a) => a.id === e.alertId);
      if (local?.once) useAlerts.setState({ alerts: useAlerts.getState().alerts.map((a) => (a.id === e.alertId ? { ...a, active: false } : a)) });
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        try {
          new Notification(e.title, { body: e.message, icon: "/icon.svg", tag: e.alertId ?? undefined });
        } catch {
          /* service-worker-only platforms */
        }
      }
    });
    es.addEventListener("scan", (ev) => onScan((JSON.parse((ev as MessageEvent<string>).data) as { timeframe: string }).timeframe));
    return () => es.close();
  }, [health?.realtime, user, onScan]);
  return null;
}
