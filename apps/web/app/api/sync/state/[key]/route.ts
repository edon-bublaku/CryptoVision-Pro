import { putState } from "@cv/db";
import { body, HttpError, json, route } from "@/lib/server/http";
import { stateInput, stateKeys } from "@/lib/server/schemas";

export const PUT = route<{ key: string }>({ auth: true, rate: 120 }, async ({ req, db, user, params }) => {
  if (!(stateKeys as readonly string[]).includes(params.key)) throw new HttpError(404, "unknown_key");
  const input = await body(req, stateInput);
  if (JSON.stringify(input.value ?? null).length > 256_000) throw new HttpError(413, "too_large");
  const res = await putState(db, user!.id, params.key, input.value ?? null, input.baseVersion);
  if (!res.ok) return json({ error: "conflict", current: res.current }, 409);
  return json({ version: res.version });
});
