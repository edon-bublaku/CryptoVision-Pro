import { putDrawings } from "@cv/db";
import { body, HttpError, json, route } from "@/lib/server/http";
import { drawingsInput } from "@/lib/server/schemas";

export const PUT = route<{ symbol: string }>({ auth: true, rate: 240 }, async ({ req, db, user, params }) => {
  if (!/^[A-Z0-9]{2,20}$/.test(params.symbol)) throw new HttpError(400, "bad_symbol");
  const { data } = await body(req, drawingsInput);
  await putDrawings(db, user!.id, params.symbol, data);
  return json({ ok: true });
});
