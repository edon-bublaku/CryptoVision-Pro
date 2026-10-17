import { listAlertEvents, markEventsRead } from "@cv/db";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route({ auth: true }, async ({ db, user }) => json({ events: await listAlertEvents(db, user!.id) }));

export const POST = route({ auth: true }, async ({ db, user }) => {
  await markEventsRead(db, user!.id);
  return json({ ok: true });
});
