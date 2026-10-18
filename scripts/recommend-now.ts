/**
 * Today's model portfolio from live Binance data: market regime, picks with weights and entry/exit
 * plan, and why other coins were left out. Usage: pnpm recommend [--size 40] [--equity 10000]
 */
import { baseAsset, formatPrice } from "@cv/core";
import { closedOnly, getFearGreed, getKlines, getTickers24h, mapLimit, universe } from "@cv/exchange";
import { buildRatingContext, recommend } from "@cv/rating";

const arg = (name: string, d: number) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? Number(process.argv[k + 1]) : d;
};
const size = arg("size", 40);
const equity = arg("equity", 10_000);

const [tickers, fg] = await Promise.all([getTickers24h(), getFearGreed(420)]);
const symbols = [...new Set(["BTCUSDT", ...universe(tickers, size).map((t) => t.symbol)])];
const daily = await mapLimit(symbols, 4, async (s) => ({ symbol: s, candles: closedOnly(await getKlines(s, "1d", 420)) }));
const btc = daily.find((d) => !(d instanceof Error) && d.symbol === "BTCUSDT");
if (!btc || btc instanceof Error) throw new Error("BTC data unavailable");
const cands = daily
  .filter((d): d is Exclude<typeof d, Error> => !(d instanceof Error))
  .map((d) => ({ symbol: d.symbol, ctx: buildRatingContext({ candles: d.candles, bench: btc.candles, fearGreed: fg, isBench: d.symbol === "BTCUSDT" }) }));
const bench = cands.find((c) => c.symbol === "BTCUSDT")!;
const rec = recommend(cands, bench, { plan: { equity, riskPct: 1, maxLeverage: 1, feeRate: 0.001 } });

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const m = rec.market;
console.info(`\nRegime: ${m.regime} · invest ${pct(m.exposure)} · BTC vs EMA200 ${m.btcEma200Distance.toFixed(1)}% · breadth ${pct(m.breadth)} · avg rating ${m.avgScore.toFixed(1)} (${m.rated} coins)\n`);
for (const p of rec.picks) {
  const plan = p.plan!;
  console.info(
    `${baseAsset(p.symbol).padEnd(6)} rating ${p.rating.score.toFixed(0)} (${p.rating.grade}, ${p.rating.verdict}) · weight ${pct(p.weight)} = $${(p.weight * equity).toFixed(0)} · vol30 ${p.vol30.toFixed(0)}% · strengths ${p.strengths.join(", ")}${p.watch ? ` · watch ${p.watch}` : ""}`,
  );
  console.info(
    `       ${plan.stance} · entries ${plan.entries.map((e) => `${e.kind === "market" ? "now" : e.kind} ${formatPrice(e.price)} (${e.sizePct}%)`).join(", ")} · stop ${formatPrice(plan.stopLoss)} · TP ${plan.targets.map((t) => formatPrice(t.price)).join(" / ")}`,
  );
}
console.info(`\nCash: ${pct(rec.cash)}`);
console.info("Not chosen:", rec.excluded.filter((e) => e.reason !== "low_score").map((e) => `${baseAsset(e.symbol)} (${e.reason}${e.with ? ` ~${baseAsset(e.with)} ρ ${e.rho!.toFixed(2)}` : ""})`).join(", ") || "—");
