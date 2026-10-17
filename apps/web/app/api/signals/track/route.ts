import { trackRecord } from "@cv/db";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public, honest track record of every ACTIVE signal the server has ever produced. */
export const GET = route({ rate: 120 }, async ({ db }) => {
  const rec = await trackRecord(db, 300);
  return json({
    stats: rec.stats,
    rows: rec.rows.map((r) => ({ signal: r.s.signal, outcome: r.t.outcome, bestR: r.t.bestR, updatedAt: r.t.updatedAt.getTime() })),
  });
});
