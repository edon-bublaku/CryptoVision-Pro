import { Redis } from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { __cvRedis?: Redis | null; __cvRedisSub?: Redis | null };

/** Shared Redis connection, or null when REDIS_URL is not configured (single-node mode). */
export function getRedis(): Redis | null {
  if (g.__cvRedis !== undefined) return g.__cvRedis;
  const url = env().REDIS_URL;
  g.__cvRedis = url ? new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 3000 }) : null;
  g.__cvRedis?.on("error", () => {
    /* surfaced by health checks; avoid crashing on transient errors */
  });
  return g.__cvRedis;
}

/** A dedicated connection per subscriber (ioredis connections in subscribe mode can't run commands). */
export function newRedis(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) return null;
  const r = new Redis(url, { maxRetriesPerRequest: null });
  r.on("error", () => {});
  return r;
}

export const channels = {
  user: (userId: string) => `cv:user:${userId}`,
  signals: "cv:signals",
};

/** Read-through cache with TTL; falls back to calling `fn` when Redis is unavailable. */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const r = getRedis();
  if (r) {
    try {
      const hit = await r.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      /* fall through */
    }
  }
  const value = await fn();
  if (r) r.set(key, JSON.stringify(value), "EX", ttlSec).catch(() => {});
  return value;
}
