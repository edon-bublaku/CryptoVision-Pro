import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /** 32-byte key (hex or base64) for AES-256-GCM encryption of secrets at rest (TOTP seeds). */
  ENCRYPTION_KEY: z.string().min(32).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("CryptoVision Pro <alerts@cryptovision.local>"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@cryptovision.local"),
  /** Where scans/alerts run: inside the web server (default), in `apps/worker` (needs PostgreSQL), or nowhere. */
  WORKER: z.enum(["inprocess", "external", "off"]).default("inprocess"),
  SCAN_TIMEFRAMES: z.string().default("1h,4h,1d"),
  SCAN_SIZE: z.coerce.number().int().min(5).max(200).default(60),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Throws on startup with a readable message if anything is malformed. */
export function env(): Env {
  if (cached) return cached;
  // `KEY=` in an env file means "unset", not an empty value that fails validation.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  const external = parsed.data.DATABASE_URL?.startsWith("postgres");
  if (external && !parsed.data.ENCRYPTION_KEY && parsed.data.NODE_ENV === "production")
    throw new Error("ENCRYPTION_KEY is required in production with an external PostgreSQL (the generated key file is per machine)");
  cached = parsed.data;
  return cached;
}

/** For tests. */
export function resetEnv() {
  cached = null;
}
