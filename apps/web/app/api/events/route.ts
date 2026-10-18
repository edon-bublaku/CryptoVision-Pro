import { getDb } from "@cv/db";
import { channels, subscribe } from "@cv/server";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: alert triggers for this user and "new scan" notices, relayed from the bus
 * (Redis pub/sub, or in-process when the worker runs inside this server). Heartbeat every 25 s
 * keeps proxies from closing it.
 */
export async function GET(req: Request) {
  const db = await getDb().catch(() => null);
  const sess = db ? await currentSession(db) : null;
  const enc = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          unsubscribe(); // client went away; never let a dead stream break the publisher
        }
      };
      const chans = [channels.signals, ...(sess ? [channels.user(sess.user.id)] : [])];
      unsubscribe = await subscribe(chans, (channel, message) => send(channel === channels.signals ? "scan" : "alert", message));
      send("ready", JSON.stringify({ user: !!sess }));
      heartbeat = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
