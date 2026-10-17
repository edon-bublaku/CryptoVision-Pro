import webpush from "web-push";
import { env } from "./env";
import { log } from "./log";

export async function sendTelegram(chatId: string, text: string, token = env().TELEGRAM_BOT_TOKEN): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) log.warn({ status: res.status }, "telegram send failed");
    return res.ok;
  } catch (e) {
    log.warn({ err: String(e) }, "telegram send error");
    return false;
  }
}

/** Email via Resend's HTTP API (no SDK needed). */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = env().RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env().EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) log.warn({ status: res.status }, "email send failed");
    return res.ok;
  } catch (e) {
    log.warn({ err: String(e) }, "email send error");
    return false;
  }
}

let vapidReady: boolean | null = null;

export function pushEnabled(): boolean {
  if (vapidReady !== null) return vapidReady;
  const e = env();
  vapidReady = !!(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
  if (vapidReady) webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
  return vapidReady;
}

/** Returns "gone" when the subscription expired so the caller can delete it. */
export async function sendPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: { title: string; body: string; url?: string; tag?: string }): Promise<"ok" | "gone" | "error"> {
  if (!pushEnabled()) return "error";
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return code === 404 || code === 410 ? "gone" : "error";
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
