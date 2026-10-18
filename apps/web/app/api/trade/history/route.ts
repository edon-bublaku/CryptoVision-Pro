import { listIntents } from "@cv/db";
import { json, route } from "@/lib/server/http";
import type { IntentInfo } from "@/lib/trade/schema";

export const GET = route({ auth: true, rate: 60 }, async ({ db, user }) => {
  const rows = await listIntents(db, user!.id, 50);
  const intents: IntentInfo[] = rows.map((r) => ({
    id: r.id,
    env: r.env,
    market: r.market,
    symbol: r.symbol,
    action: r.action,
    status: r.status,
    request: r.request,
    steps: r.steps as IntentInfo["steps"],
    createdAt: r.createdAt.toISOString(),
  }));
  return json({ intents });
});
