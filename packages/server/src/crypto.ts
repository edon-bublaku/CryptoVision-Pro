import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { secretKeyPath } from "./paths";
import { env } from "./env";

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

// N=2^15, r=8, p=1 ≈ 32 MiB / ~50 ms: OWASP-recommended scrypt parameters.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Format: scrypt$N$r$p$saltB64$hashB64 — parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

let fileKey: string | undefined;

/**
 * Without ENCRYPTION_KEY, a random key is created once and kept next to the embedded database
 * (mode 0600), so a fresh install is secure without configuration. External PostgreSQL in
 * production must set ENCRYPTION_KEY explicitly (env() enforces it).
 */
function generatedKey(): string {
  if (fileKey) return fileKey;
  const path = secretKeyPath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    } catch {
      /* another process created it first */
    }
  }
  fileKey = readFileSync(path, "utf8").trim();
  return fileKey;
}

function key(): Buffer {
  const raw = env().ENCRYPTION_KEY ?? generatedKey();
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

/** AES-256-GCM: v1.iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
