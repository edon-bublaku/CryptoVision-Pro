import { latestScan } from "@cv/db";
import { TIMEFRAMES } from "@cv/core";
import { HttpError, json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Latest server-side market scan for a timeframe (produced by apps/worker). */
export const GET = route({ rate: 240 }, async ({ req, db }) => {
  const tf = req.nextUrl.searchParams.get("tf") ?? "4h";
  if (!(TIMEFRAMES as string[]).includes(tf)) throw new HttpError(400, "bad_timeframe");
  const res = await latestScan(db, tf);
  if (!res) return json({ scan: null, rows: [] });
  return json(
    {
      scan: { id: res.scan.id, timeframe: res.scan.timeframe, finishedAt: res.scan.finishedAt, coins: res.scan.coins, active: res.scan.active },
      rows: res.rows.map((r) => ({ symbol: r.symbol, signal: r.signal, snapshot: r.snapshot, gate: r.gate })),
    },
    200,
    { "Cache-Control": "private, max-age=30" },
  );
});
