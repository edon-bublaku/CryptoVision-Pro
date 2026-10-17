import { audit, updateUser } from "@cv/db";
import { encrypt, generateTotpSecret, otpauthUrl } from "@cv/server";
import QRCode from "qrcode";
import { HttpError, json, route } from "@/lib/server/http";

/** Creates a new (not yet enabled) TOTP secret and returns the provisioning QR code. */
export const POST = route({ auth: true, rate: 10 }, async ({ db, user, ip }) => {
  if (user!.totpEnabled) throw new HttpError(409, "already_enabled");
  const secret = generateTotpSecret();
  await updateUser(db, user!.id, { totpSecret: encrypt(secret) });
  const url = otpauthUrl(secret, user!.email);
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0a0d13", light: "#ffffff" } });
  await audit(db, { userId: user!.id, action: "2fa_setup", ip });
  return json({ secret, url, qr });
});
