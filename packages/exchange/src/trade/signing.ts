import { createHmac } from "node:crypto";

export type Params = Record<string, string | number | boolean | undefined>;

/**
 * Binance signs the exact query string that is sent, so the same function builds both. Keys keep
 * insertion order and values are percent-encoded (Binance requires non-ASCII to be encoded before
 * signing); undefined values are dropped.
 */
export function toQuery(params: Params): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** HMAC-SHA256 of the payload with the API secret, hex encoded (Binance "HMAC" key type). */
export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Client order ids allowed by both spot and futures: `^[a-zA-Z0-9_-]{1,36}$`. */
export function clientId(prefix: string, suffix: string): string {
  const id = `${prefix}${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "");
  if (id.length < 1 || id.length > 36) throw new Error(`client order id out of range: ${id}`);
  return id;
}
