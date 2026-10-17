import { getDb } from "@cv/db";
import { channels, newRedis } from "@cv/server";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: alert triggers for this user and "new scan" notices, relayed from Redis
 * pub/sub (published by apps/worker). Heartbeat every 25 s keeps proxies from closing it.
 */
export async function GET(req: Request) {
  const db = getDb();
  const sess = db ? await currentSession(db) : null;
  const sub = newRedis();
  if (!sub) return new Response("Realtime not configured", { status: 503 });
  const enc = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
      const chans = [channels.signals, ...(sess ? [channels.user(sess.user.id)] : [])];
      sub.on("message", (channel, message) => send(channel === channels.signals ? "scan" : "alert", message));
      await sub.subscribe(...chans);
      send("ready", JSON.stringify({ user: !!sess }));
      heartbeat = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        sub.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      sub.disconnect();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
