import { getRedis } from "./redis";

const memory = new Map<string, number[]>();

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Sliding-window limiter: at most `limit` hits per `windowSec` for `key`.
 * Uses a Redis sorted set (shared across instances) or an in-process map as fallback.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const now = Date.now();
  const from = now - windowSec * 1000;
  const r = getRedis();
  if (r && r.status === "ready") {
    const k = `cv:rl:${key}`;
    const res = await r
      .multi()
      .zremrangebyscore(k, 0, from)
      .zadd(k, now, `${now}:${Math.random()}`)
      .zcard(k)
      .zrange(k, 0, 0, "WITHSCORES")
      .expire(k, windowSec)
      .exec();
    const count = Number(res?.[2]?.[1] ?? 0);
    const oldest = Number((res?.[3]?.[1] as string[] | undefined)?.[1] ?? now);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: count <= limit ? 0 : Math.ceil((oldest + windowSec * 1000 - now) / 1000) };
  }
  const hits = (memory.get(key) ?? []).filter((t) => t > from);
  hits.push(now);
  memory.set(key, hits);
  if (memory.size > 10_000) for (const [k, v] of memory) if (!v.some((t) => t > from)) memory.delete(k);
  return { ok: hits.length <= limit, remaining: Math.max(0, limit - hits.length), retryAfterSec: hits.length <= limit ? 0 : Math.ceil((hits[0]! + windowSec * 1000 - now) / 1000) };
}
