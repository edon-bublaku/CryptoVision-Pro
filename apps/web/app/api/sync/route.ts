import { getAllState, listAlerts, listDrawings, listPositions } from "@cv/db";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Full snapshot of the signed-in user's data, used to hydrate the client after login. */
export const GET = route({ auth: true }, async ({ db, user }) => {
  const [state, drawings, portfolio, alerts] = await Promise.all([getAllState(db, user!.id), listDrawings(db, user!.id), listPositions(db, user!.id), listAlerts(db, user!.id)]);
  const pos = (p: (typeof portfolio.open)[number]) => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entry: +p.entry,
    quantity: +p.quantity,
    stopLoss: p.stopLoss !== null ? +p.stopLoss : undefined,
    takeProfit: p.takeProfit !== null ? +p.takeProfit : undefined,
    leverage: +p.leverage,
    openedAt: p.openedAt.getTime(),
    notes: p.notes ?? undefined,
    strategyId: p.strategyId,
    paper: p.paper || undefined,
  });
  return json({
    state,
    drawings,
    portfolio: {
      positions: portfolio.open.map(pos),
      closed: portfolio.closed.map((p) => ({ ...pos(p), exit: +(p.exit ?? 0), closedAt: p.closedAt!.getTime(), pnl: +(p.pnl ?? 0), r: p.r ?? undefined, exitReason: p.exitReason ?? undefined })),
    },
    alerts: alerts.map((a) => ({
      id: a.id,
      symbol: a.symbol,
      type: a.type,
      value: +a.value,
      timeframe: a.timeframe ?? undefined,
      drawingId: a.drawing?.id,
      drawing: a.drawing ?? undefined,
      once: a.once,
      active: a.active,
      createdAt: a.createdAt.getTime(),
      note: a.note ?? undefined,
    })),
  });
});
