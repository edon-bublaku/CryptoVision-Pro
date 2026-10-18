import { activeDbMode, getDb, pingDb } from "@cv/db";
import { busKind, env, getRedis, hasFlag, pushEnabled } from "@cv/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Feature discovery for the client: which server capabilities are available right now. */
export async function GET() {
  const e = env();
  const db = await getDb().catch(() => null);
  const dbOk = db ? await pingDb(db) : false;
  const redis = getRedis();
  let redisOk = false;
  if (redis) redisOk = await redis.ping().then((r) => r === "PONG", () => false);
  // Without Redis the realtime bus is in-process and always available.
  const realtime = busKind() === "memory" || redisOk;
  return NextResponse.json(
    {
      ok: true,
      db: dbOk,
      dbMode: activeDbMode(),
      redis: redisOk,
      realtime,
      worker: realtime && (await hasFlag("cv:worker:heartbeat")),
      ai: !!e.ANTHROPIC_API_KEY,
      telegram: !!e.TELEGRAM_BOT_TOKEN,
      email: !!e.RESEND_API_KEY,
      push: pushEnabled() ? e.VAPID_PUBLIC_KEY : null,
      trading: dbOk ? e.TRADING : "off",
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
