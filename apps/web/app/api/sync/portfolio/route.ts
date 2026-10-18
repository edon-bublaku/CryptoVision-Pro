import { replacePortfolio } from "@cv/db";
import { body, json, route } from "@/lib/server/http";
import { portfolioInput } from "@/lib/server/schemas";

const s = (n: number | undefined) => (n === undefined ? null : String(n));

export const PUT = route({ auth: true, rate: 60 }, async ({ req, db, user }) => {
  const { positions, closed } = await body(req, portfolioInput);
  const base = (p: (typeof positions)[number]) => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entry: String(p.entry),
    quantity: String(p.quantity),
    stopLoss: s(p.stopLoss),
    takeProfit: s(p.takeProfit),
    leverage: String(p.leverage),
    strategyId: p.strategyId ?? null,
    notes: p.notes ?? null,
    openedAt: new Date(p.openedAt),
    paper: p.paper ?? false,
  });
  await replacePortfolio(db, user!.id, [
    ...positions.map(base),
    ...closed.map((c) => ({ ...base(c), exit: String(c.exit), closedAt: new Date(c.closedAt), pnl: String(c.pnl), r: c.r ?? null, exitReason: c.exitReason ?? null })),
  ]);
  return json({ ok: true });
});
