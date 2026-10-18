import { EventEmitter } from "node:events";
import { getRedis, newRedis } from "./redis";

/**
 * Pub/sub and short-lived flags. Redis when REDIS_URL is set (web and worker in separate
 * processes or replicas); otherwise an in-process emitter, which is enough when the worker runs
 * inside the web server (the default, single-process setup).
 */
const g = globalThis as unknown as { __cvBus?: EventEmitter; __cvFlags?: Map<string, number> };
const memory = () => (g.__cvBus ??= new EventEmitter().setMaxListeners(0));
const flags = () => (g.__cvFlags ??= new Map());

export type BusKind = "redis" | "memory";

export function busKind(): BusKind {
  return getRedis() ? "redis" : "memory";
}

export async function publish(channel: string, message: string): Promise<void> {
  const r = getRedis();
  if (r) await r.publish(channel, message).catch(() => {});
  else memory().emit(channel, message);
}

/** Returns an unsubscribe function. */
export async function subscribe(chans: string[], onMessage: (channel: string, message: string) => void): Promise<() => void> {
  const sub = newRedis();
  if (sub) {
    sub.on("message", onMessage);
    await sub.subscribe(...chans);
    return () => sub.disconnect();
  }
  const handlers = chans.map((c) => [c, (m: string) => onMessage(c, m)] as const);
  for (const [c, h] of handlers) memory().on(c, h);
  return () => {
    for (const [c, h] of handlers) memory().off(c, h);
  };
}

/** Sets a flag that expires after `ttlSec` (e.g. the worker heartbeat). */
export async function setFlag(key: string, ttlSec: number): Promise<void> {
  const r = getRedis();
  if (r) await r.set(key, String(Date.now()), "EX", ttlSec).catch(() => {});
  else flags().set(key, Date.now() + ttlSec * 1000);
}

export async function hasFlag(key: string): Promise<boolean> {
  const r = getRedis();
  if (r) return !!(await r.get(key).catch(() => null));
  return (flags().get(key) ?? 0) > Date.now();
}
