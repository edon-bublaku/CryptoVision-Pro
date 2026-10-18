"use client";

import { create } from "zustand";
import { api, ApiError } from "../api";

export interface Health {
  ok: boolean;
  db: boolean;
  redis: boolean;
  realtime: boolean;
  dbMode?: "postgres" | "embedded" | "memory" | "off";
  worker: boolean;
  ai: boolean;
  telegram: boolean;
  email: boolean;
  push: string | null;
  /** Order execution on Binance: disabled without a database. */
  trading?: "on" | "testnet" | "off";
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  totpEnabled: boolean;
  telegramChatId: string | null;
  emailAlerts: boolean;
  locale: "sq" | "en";
  createdAt: string;
  recoveryCodesLeft: number;
}

interface AuthState {
  health: Health | null;
  user: PublicUser | null;
  ready: boolean;
  syncStatus: "off" | "syncing" | "synced" | "error";
  init: () => Promise<void>;
  login: (email: string, password: string, code?: string) => Promise<"ok" | "totp">;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: PublicUser | null) => void;
  setSync: (s: AuthState["syncStatus"]) => void;
}

const OFFLINE: Health = { ok: false, db: false, redis: false, realtime: false, worker: false, ai: false, telegram: false, email: false, push: null };

/** Server capabilities + session. Without a server DB the app stays in local-only mode. */
export const useAuth = create<AuthState>((set) => ({
  health: null,
  user: null,
  ready: false,
  syncStatus: "off",
  init: async () => {
    let health: Health;
    try {
      health = await api<Health>("/api/health");
    } catch {
      health = OFFLINE;
    }
    let user: PublicUser | null = null;
    if (health.db) {
      try {
        user = (await api<{ user: PublicUser | null }>("/api/auth/me")).user;
      } catch {
        user = null;
      }
    }
    set({ health, user, ready: true });
  },
  login: async (email, password, code) => {
    const res = await api<{ user?: PublicUser; needTotp?: boolean }>("/api/auth/login", { body: { email, password, code } });
    if (res.needTotp) return "totp";
    set({ user: res.user ?? null });
    return "ok";
  },
  register: async (email, password, name) => {
    const res = await api<{ user: PublicUser }>("/api/auth/register", { body: { email, password, name } });
    set({ user: res.user });
  },
  logout: async () => {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    set({ user: null, syncStatus: "off" });
  },
  setUser: (user) => set({ user }),
  setSync: (syncStatus) => set({ syncStatus }),
}));

export function errorMessage(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    const key = `err.${e.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
    const issues = e.data.issues as { path: string; message: string }[] | undefined;
    if (issues?.length) return issues.map((i) => `${i.path}: ${i.message}`).join(", ");
    return e.code;
  }
  return e instanceof Error ? e.message : String(e);
}
