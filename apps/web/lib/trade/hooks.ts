"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../store/auth";
import type { AccountResponse, IntentInfo, KeyInfo, TradingSettings } from "./schema";

/** Server state of the trading page. Everything requires an account and a database. */
export function useTradingEnabled() {
  const { user, health } = useAuth();
  return !!user && !!health?.db && (health.trading ?? "on") !== "off";
}

export function useTradingSettings() {
  const on = useTradingEnabled();
  return useQuery({ queryKey: ["trade", "settings"], queryFn: () => api<TradingSettings>("/api/trade/settings"), enabled: on });
}

export function useExchangeKeys() {
  const on = useTradingEnabled();
  return useQuery({ queryKey: ["trade", "keys"], queryFn: async () => (await api<{ keys: KeyInfo[] }>("/api/trade/keys")).keys, enabled: on });
}

/** Balances, positions and open orders; refreshed every 10 s while the page is open. */
export function useTradeAccount(env: "testnet" | "live", market: "spot" | "futures", enabled: boolean) {
  const on = useTradingEnabled();
  return useQuery({
    queryKey: ["trade", "account", env, market],
    queryFn: () => api<AccountResponse>(`/api/trade/account?env=${env}&market=${market}`),
    enabled: on && enabled,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useTradeHistory() {
  const on = useTradingEnabled();
  return useQuery({ queryKey: ["trade", "history"], queryFn: async () => (await api<{ intents: IntentInfo[] }>("/api/trade/history")).intents, enabled: on });
}

/** Refresh everything after an action. */
export function useTradeRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["trade"] });
}
