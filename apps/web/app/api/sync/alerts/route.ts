import { replaceAlerts } from "@cv/db";
import { body, json, route } from "@/lib/server/http";
import { alertsInput } from "@/lib/server/schemas";

/** Server-side copy of the user's alerts: the worker evaluates them 24/7. */
export const PUT = route({ auth: true, rate: 60 }, async ({ req, db, user }) => {
  const { alerts } = await body(req, alertsInput);
  await replaceAlerts(
    db,
    user!.id,
    alerts.map((a) => ({
      id: a.id,
      symbol: a.symbol,
      type: a.type,
      value: String(a.value),
      timeframe: a.timeframe ?? null,
      drawing: a.drawing ?? null,
      once: a.once,
      active: a.active,
      note: a.note ?? null,
      createdAt: new Date(a.createdAt),
    })),
  );
  return json({ ok: true });
});
