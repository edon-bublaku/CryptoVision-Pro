import "server-only";
import { getDb, type Db, type User } from "@cv/db";
import { log, rateLimit } from "@cv/server";
import { NextResponse, type NextRequest } from "next/server";
import { type z, ZodError } from "zod";
import { currentSession } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => NextResponse.json(data, { status, headers });

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new HttpError(403, "bad_origin");
}

export interface Ctx {
  req: NextRequest;
  db: Db;
  ip: string;
  user: User | null;
  sessionId: string | null;
}

interface Opts {
  auth?: boolean;
  /** Requests per minute per IP (and per user when signed in). */
  rate?: number;
  /** Route works without a database (e.g. derivatives proxy). */
  noDb?: boolean;
}

type Handler<P> = (ctx: Ctx & { params: P }) => Promise<Response>;

/** Wraps a route handler with DB availability, origin check, rate limiting, auth and error mapping. */
export function route<P = Record<string, string>>(opts: Opts, handler: Handler<P>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      checkOrigin(req);
      const ip = clientIp(req);
      const db = await getDb().catch((e: unknown) => {
        log.error({ err: String(e) }, "database unavailable");
        return null;
      });
      if (!db && !opts.noDb) throw new HttpError(503, "no_database", "Server storage is not configured");
      const rl = await rateLimit(`${req.nextUrl.pathname}:${ip}`, opts.rate ?? 120, 60);
      if (!rl.ok) throw new HttpError(429, "rate_limited", "Too many requests", { retryAfter: rl.retryAfterSec });
      const sess = db ? await currentSession(db) : null;
      if (opts.auth && !sess) throw new HttpError(401, "unauthenticated");
      return await handler({ req, db: db as Db, ip, user: sess?.user ?? null, sessionId: sess?.sessionId ?? null, params: await context.params });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message, ...e.extra }, e.status, e.status === 429 ? { "Retry-After": String(e.extra?.retryAfter ?? 60) } : undefined);
      if (e instanceof ZodError) return json({ error: "invalid_input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
      log.error({ err: e instanceof Error ? e.stack : String(e), path: req.nextUrl.pathname }, "route error");
      return json({ error: "internal" }, 500);
    }
  };
}

export async function body<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  return schema.parse(raw);
}
