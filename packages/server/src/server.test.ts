import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, decrypt, encrypt, generateRecoveryCodes, hashPassword, hotp, rateLimit, totp, verifyPassword, verifyTotp } from "./index";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("a")).not.toBe(await hashPassword("a"));
  });
});

describe("TOTP (RFC 4226 / 6238 test vectors)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("HOTP vectors", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });
  it("TOTP vectors (8 digits, SHA1)", () => {
    expect(totp(secret, 59_000, 8)).toBe("94287082");
    expect(totp(secret, 1111111109_000, 8)).toBe("07081804");
    expect(totp(secret, 20000000000_000, 8)).toBe("65353130");
  });
  it("accepts ±1 step and rejects older codes", () => {
    const b32 = base32Encode(secret);
    const t = 1_700_000_000_000;
    expect(verifyTotp(b32, totp(secret, t), t)).toBe(true);
    expect(verifyTotp(b32, totp(secret, t - 30_000), t)).toBe(true);
    expect(verifyTotp(b32, totp(secret, t - 90_000), t)).toBe(false);
    expect(verifyTotp(b32, "abc123", t)).toBe(false);
  });
  it("base32 round trip", () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  it("recovery codes are unique and formatted", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const c = encrypt("JBSWY3DPEHPK3PXP");
    expect(decrypt(c)).toBe("JBSWY3DPEHPK3PXP");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("rate limiting (in-memory fallback)", () => {
  it("allows `limit` hits per window", async () => {
    const key = `t:${Math.random()}`;
    const res = [];
    for (let i = 0; i < 4; i++) res.push(await rateLimit(key, 3, 60));
    expect(res.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(res[3]!.retryAfterSec).toBeGreaterThan(0);
  });
});
