import { deletePushSubscription, savePushSubscription } from "@cv/db";
import { pushEnabled } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";

const sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export const POST = route({ auth: true, rate: 20 }, async ({ req, db, user }) => {
  if (!pushEnabled()) throw new HttpError(503, "push_disabled");
  await savePushSubscription(db, user!.id, await body(req, sub));
  return json({ ok: true });
});

export const DELETE = route({ auth: true, rate: 20 }, async ({ req, db }) => {
  const { endpoint } = await body(req, z.object({ endpoint: z.string().url() }));
  await deletePushSubscription(db, endpoint);
  return json({ ok: true });
});
