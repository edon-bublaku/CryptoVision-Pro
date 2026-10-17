import { json, route } from "@/lib/server/http";
import { endSession } from "@/lib/server/session";

export const POST = route({}, async ({ db, sessionId }) => {
  await endSession(db, sessionId);
  return json({ ok: true });
});
