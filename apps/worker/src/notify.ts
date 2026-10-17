import { deletePushSubscription, listPushSubscriptions, logAlertEvent, type Db } from "@cv/db";
import { channels, escapeHtml, getRedis, log, sendEmail, sendPush, sendTelegram } from "@cv/server";

export interface Recipient {
  userId: string;
  telegramChatId: string | null;
  emailAlerts: boolean;
  email: string;
}

/**
 * Fan-out of one alert event: stored in alert_events, pushed live over Redis (SSE),
 * and sent to every channel the user enabled. A failing channel never blocks the others.
 */
export async function deliver(db: Db, to: Recipient, ev: { alertId: string | null; symbol: string; title: string; message: string; url?: string }) {
  const sent: string[] = ["app"];
  const tasks: Promise<void>[] = [];
  if (to.telegramChatId)
    tasks.push(sendTelegram(to.telegramChatId, `🔔 <b>${escapeHtml(ev.title)}</b>\n${escapeHtml(ev.message)}`).then((ok) => void (ok && sent.push("telegram"))));
  if (to.emailAlerts)
    tasks.push(
      sendEmail(to.email, ev.title, `<h2 style="font-family:sans-serif">${escapeHtml(ev.title)}</h2><p style="font-family:sans-serif">${escapeHtml(ev.message)}</p><p style="font:12px sans-serif;color:#888">CryptoVision Pro — jo këshillë financiare.</p>`).then(
        (ok) => void (ok && sent.push("email")),
      ),
    );
  tasks.push(
    listPushSubscriptions(db, to.userId).then(async (subs) => {
      for (const s of subs) {
        const r = await sendPush(s, { title: ev.title, body: ev.message, url: ev.url ?? `/chart?symbol=${ev.symbol}`, tag: ev.alertId ?? undefined });
        if (r === "gone") await deletePushSubscription(db, s.endpoint);
        if (r === "ok" && !sent.includes("push")) sent.push("push");
      }
    }),
  );
  await Promise.allSettled(tasks);
  const row = await logAlertEvent(db, { userId: to.userId, alertId: ev.alertId, symbol: ev.symbol, message: `${ev.title}: ${ev.message}`, channels: sent });
  await getRedis()
    ?.publish(channels.user(to.userId), JSON.stringify({ id: row.id, alertId: ev.alertId, symbol: ev.symbol, title: ev.title, message: ev.message, time: row.createdAt }))
    .catch(() => {});
  log.info({ userId: to.userId, symbol: ev.symbol, channels: sent }, "alert delivered");
}
