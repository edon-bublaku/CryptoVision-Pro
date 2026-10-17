import { getDb, pingDb } from "@cv/db";
import { env, getRedis, pushEnabled } from "@cv/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Feature discovery for the client: which server capabilities are available right now. */
export async function GET() {
  const e = env();
  const db = getDb();
  const dbOk = db ? await pingDb(db) : false;
  const redis = getRedis();
  let redisOk = false;
  let worker = false;
  if (redis) {
    try {
      redisOk = (await redis.ping()) === "PONG";
      worker = !!(await redis.get("cv:worker:heartbeat"));
    } catch {
      redisOk = false;
    }
  }
  return NextResponse.json(
    {
      ok: true,
      db: dbOk,
      redis: redisOk,
      worker,
      ai: !!e.ANTHROPIC_API_KEY,
      telegram: !!e.TELEGRAM_BOT_TOKEN,
      email: !!e.RESEND_API_KEY,
      push: pushEnabled() ? e.VAPID_PUBLIC_KEY : null,
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
