import { audit, deleteSession, listSessions, revokeOtherSessions } from "@cv/db";
import { json, route } from "@/lib/server/http";

export const GET = route({ auth: true }, async ({ db, user, sessionId }) => {
  const rows = await listSessions(db, user!.id);
  return json({
    sessions: rows.map((s) => ({ id: s.id.slice(0, 12), current: s.id === sessionId, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
  });
});

/** ?id=<prefix> revokes one session; no id revokes every other session. */
export const DELETE = route({ auth: true }, async ({ req, db, user, sessionId, ip }) => {
  const prefix = req.nextUrl.searchParams.get("id");
  if (prefix) {
    const target = (await listSessions(db, user!.id)).find((s) => s.id.startsWith(prefix) && s.id !== sessionId);
    if (target) await deleteSession(db, target.id);
  } else await revokeOtherSessions(db, user!.id, sessionId ?? undefined);
  await audit(db, { userId: user!.id, action: "sessions_revoked", ip, meta: { prefix } });
  return json({ ok: true });
});
