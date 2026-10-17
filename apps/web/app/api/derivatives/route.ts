import { derivativesBias, getDerivatives } from "@cv/exchange";
import { cached } from "@cv/server";
import { HttpError, json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** OKX perpetual-swap positioning, cached 60 s in Redis so many viewers cost one upstream call. */
export const GET = route({ noDb: true, rate: 120 }, async ({ req }) => {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) throw new HttpError(400, "bad_symbol");
  try {
    const data = await cached(`cv:deriv:${symbol}`, 60, () => getDerivatives(symbol));
    return json({ ...data, bias: derivativesBias(data) }, 200, { "Cache-Control": "public, max-age=30" });
  } catch (e) {
    throw new HttpError(404, "no_derivatives", e instanceof Error ? e.message : "unavailable");
  }
});
