/**
 * Historical validation of the CV Rating on real Binance daily data.
 *
 * For every coin and every 30th day (non-overlapping 30-day windows), the rating is computed with
 * data up to that day only, then compared with what the price actually did over the next 30 days.
 * Writes packages/rating/src/calibration.json (shown in the app) and prints a summary.
 *
 * Usage: pnpm validate:rating
 */
import { writeFileSync } from "node:fs";
import type { Candle } from "@cv/core";
import { mean } from "@cv/core";
import { getFearGreed } from "@cv/exchange";
import { buildRatingContext, MIN_BARS, WEIGHT_PRESETS, PILLAR_IDS, rateAt, verdictOf, type PillarId, type PillarWeights, type Verdict } from "@cv/rating";

const COINS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "LINKUSDT", "AVAXUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT", "ATOMUSDT", "ETCUSDT", "XLMUSDT", "NEARUSDT", "FILUSDT", "UNIUSDT", "AAVEUSDT", "ALGOUSDT", "VETUSDT", "HBARUSDT", "ICPUSDT", "SANDUSDT", "MANAUSDT", "AXSUSDT", "EGLDUSDT", "THETAUSDT", "XTZUSDT"];
const BARS = 2000;
const HORIZON = 30;
const STEP = 30;

async function fetchDaily(symbol: string, bars: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let end: number | undefined;
  while (out.length < bars) {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=1000${end ? `&endTime=${end}` : ""}`);
    const rows = (await res.json()) as [number, string, string, string, string, string, number, string, number, string][];
    if (!rows.length) break;
    out.unshift(...rows.map((r) => ({ time: r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], quoteVolume: +r[7], takerBuyVolume: +r[9] })));
    end = rows[0]![0] - 1;
    if (rows.length < 1000) break;
  }
  // Drop today's forming candle.
  return out.slice(-bars - 1, -1);
}

/** Ranks with ties sharing their average rank (otherwise equal values get arbitrary order). */
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[k]![0]) j++;
    for (let m = k; m <= j; m++) r[idx[m]![1]] = (k + j) / 2;
    k = j + 1;
  }
  return r;
}

function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[v.length >> 1]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : NaN;
};

interface Obs {
  symbol: string;
  time: number;
  score: number;
  verdict: Verdict;
  pillars: Partial<Record<string, number>>;
  fwd: number;
  excess: number;
  /** Worst close over the next HORIZON days relative to the rating day (≤ 0). */
  maxDd: number;
}

const fg = await getFearGreed(0);
const btc = await fetchDaily("BTCUSDT", BARS);
const btcByTime = new Map(btc.map((c, i) => [c.time, i]));
const obs: Obs[] = [];

for (const symbol of COINS) {
  const candles = symbol === "BTCUSDT" ? btc : await fetchDaily(symbol, BARS);
  if (candles.length < MIN_BARS + HORIZON + 10) {
    console.warn(`skip ${symbol}: ${candles.length} bars`);
    continue;
  }
  const ctx = buildRatingContext({ candles, bench: btc, fearGreed: fg, isBench: symbol === "BTCUSDT" });
  // Align sampling days across coins so the cross-section compares the same dates.
  for (let i = MIN_BARS; i + HORIZON < candles.length; i++) {
    const t = candles[i]!.time;
    if (Math.floor(t / 86_400) % STEP !== 0) continue;
    // Always the a priori weights: the stored pillar scores let us re-weight afterwards.
    const r = rateAt(ctx, i, WEIGHT_PRESETS.balanced);
    const bi = btcByTime.get(t);
    if (!r || bi === undefined || !btc[bi + HORIZON]) continue;
    const fwd = candles[i + HORIZON]!.close / candles[i]!.close - 1;
    const bfwd = btc[bi + HORIZON]!.close / btc[bi]!.close - 1;
    let low = Infinity;
    for (let k = i + 1; k <= i + HORIZON; k++) low = Math.min(low, candles[k]!.close);
    const maxDd = Math.min(0, low / candles[i]!.close - 1);
    obs.push({ symbol, time: t, score: r.score, verdict: r.verdict, pillars: Object.fromEntries(r.pillars.map((p) => [p.id, p.score])), fwd, excess: fwd - bfwd, maxDd });
  }
  console.info(`${symbol}: ${candles.length} days`);
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const VERDICTS: Verdict[] = ["STRONG_ACCUMULATE", "ACCUMULATE", "HOLD", "REDUCE", "AVOID"];

/** Rating under other pillar weights, renormalised over the pillars that had data (as rateAt does). */
function scoreWith(o: Obs, w: PillarWeights): number {
  let num = 0;
  let den = 0;
  for (const p of PILLAR_IDS) {
    const v = o.pillars[p];
    if (v === undefined || !w[p]) continue;
    num += v * w[p];
    den += w[p];
  }
  return den ? num / den : NaN;
}

function bucketStats(list: Obs[]) {
  return {
    n: list.length,
    meanFwd: +mean(list.map((x) => x.fwd)).toFixed(4),
    medianFwd: +median(list.map((x) => x.fwd)).toFixed(4),
    positive: +(list.length ? list.filter((x) => x.fwd > 0).length / list.length : NaN).toFixed(3),
    meanExcess: +mean(list.map((x) => x.excess)).toFixed(4),
    beatBtc: +(list.length ? list.filter((x) => x.excess > 0).length / list.length : NaN).toFixed(3),
    meanMaxDd: +mean(list.map((x) => x.maxDd)).toFixed(4),
  };
}

/** Cross-sectional rank correlation per date (dates with ≥ 8 coins), for a score function. */
function icOf(list: Obs[], get: (o: Obs) => number | undefined) {
  const dates = [...new Set(list.map((o) => o.time))].sort((a, b) => a - b);
  const ics: { time: number; ic: number }[] = [];
  for (const d of dates) {
    const o = list.filter((x) => x.time === d && get(x) !== undefined && Number.isFinite(get(x)!));
    if (o.length < 8) continue;
    ics.push({ time: d, ic: spearman(o.map((x) => get(x)!), o.map((x) => x.fwd)) });
  }
  const v = ics.map((x) => x.ic);
  const m = mean(v);
  const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
  return { dates: v.length, mean: m, tStat: sd ? (m / sd) * Math.sqrt(v.length) : 0, positiveShare: v.filter((x) => x > 0).length / Math.max(1, v.length) };
}

function quintileSpread(list: Obs[], get: (o: Obs) => number) {
  const spreads: number[] = [];
  for (const d of new Set(list.map((o) => o.time))) {
    const o = list.filter((x) => x.time === d).sort((a, b) => get(b) - get(a));
    if (o.length < 10) continue;
    const q = Math.max(1, Math.floor(o.length / 5));
    spreads.push(mean(o.slice(0, q).map((x) => x.fwd)) - mean(o.slice(-q).map((x) => x.fwd)));
  }
  return { mean: +mean(spreads).toFixed(4), positiveShare: +(spreads.filter((x) => x > 0).length / Math.max(1, spreads.length)).toFixed(3), dates: spreads.length };
}

const dates = [...new Set(obs.map((o) => o.time))].sort((a, b) => a - b);
const splitAt = dates[Math.floor(dates.length / 2)]!;
const first = obs.filter((o) => o.time < splitAt);
const second = obs.filter((o) => o.time >= splitAt);

// Market-wide pillar: the same value for every coin on a date, so only a time-series test makes sense.
const MARKET_WIDE: PillarId[] = ["sentiment"];
const CROSS: PillarId[] = PILLAR_IDS.filter((p) => !MARKET_WIDE.includes(p));
const btcObs = obs.filter((o) => o.symbol === "BTCUSDT" && o.pillars.sentiment !== undefined);
const sentimentTs = btcObs.length > 10 ? spearman(btcObs.map((o) => o.pillars.sentiment!), btcObs.map((o) => o.fwd)) : NaN;

// Walk-forward calibration: weights proportional to each pillar's positive IC in the FIRST half only,
// then judged on the second half, which they never saw.
const firstIc = Object.fromEntries(CROSS.map((p) => [p, icOf(first, (o) => o.pillars[p]).mean])) as Record<PillarId, number>;
const raw = CROSS.map((p) => Math.max(0, firstIc[p]));
const sumRaw = raw.reduce((x, y) => x + y, 0) || 1;
const calibratedWeights = Object.fromEntries(PILLAR_IDS.map((p) => [p, 0])) as PillarWeights;
CROSS.forEach((p, k) => (calibratedWeights[p] = Math.round((raw[k]! / sumRaw) * 100)));
const drift = 100 - Object.values(calibratedWeights).reduce((x, y) => x + y, 0);
const top = CROSS.reduce((m, p) => (calibratedWeights[p] > calibratedWeights[m] ? p : m), CROSS[0]!);
calibratedWeights[top] += drift;

const def = (o: Obs) => o.score;
const cal = (o: Obs) => scoreWith(o, calibratedWeights);
const total = icOf(obs, def);

const deciles = Array.from({ length: 10 }, (_, d) => {
  const sorted = [...obs].sort((a, b) => a.score - b.score);
  const from = Math.floor((d / 10) * sorted.length);
  const to = Math.floor(((d + 1) / 10) * sorted.length);
  const slice = sorted.slice(from, to);
  return { decile: d + 1, minScore: +slice[0]!.score.toFixed(1), maxScore: +slice[slice.length - 1]!.score.toFixed(1), ...bucketStats(slice) };
});

const times = obs.map((o) => o.time);
const calibration = {
  generatedAt: new Date().toISOString().slice(0, 10),
  from: new Date(Math.min(...times) * 1000).toISOString().slice(0, 10),
  to: new Date(Math.max(...times) * 1000).toISOString().slice(0, 10),
  splitAt: new Date(splitAt * 1000).toISOString().slice(0, 10),
  coins: new Set(obs.map((o) => o.symbol)).size,
  observations: obs.length,
  horizonDays: HORIZON,
  baseline: { meanFwd: +mean(obs.map((o) => o.fwd)).toFixed(4), positive: +(obs.filter((o) => o.fwd > 0).length / obs.length).toFixed(3), meanMaxDd: +mean(obs.map((o) => o.maxDd)).toFixed(4) },
  byVerdict: VERDICTS.map((v) => ({ verdict: v, ...bucketStats(obs.filter((x) => x.verdict === v)) })),
  deciles,
  ic: { mean: +total.mean.toFixed(4), tStat: +total.tStat.toFixed(2), dates: total.dates, positiveShare: +total.positiveShare.toFixed(3), firstHalf: +icOf(first, def).mean.toFixed(4), secondHalf: +icOf(second, def).mean.toFixed(4) },
  quintileSpread: quintileSpread(obs, def),
  pillarIc: Object.fromEntries(CROSS.map((p) => [p, +icOf(obs, (o) => o.pillars[p]).mean.toFixed(4)])),
  sentimentTimeSeriesIc: +sentimentTs.toFixed(4),
  calibrated: {
    weights: calibratedWeights,
    fittedOn: `${new Date(Math.min(...times) * 1000).toISOString().slice(0, 10)} → ${new Date(splitAt * 1000).toISOString().slice(0, 10)}`,
    outOfSample: {
      defaultIc: +icOf(second, def).mean.toFixed(4),
      calibratedIc: +icOf(second, cal).mean.toFixed(4),
      defaultSpread: quintileSpread(second, def).mean,
      calibratedSpread: quintileSpread(second, cal).mean,
      byVerdict: VERDICTS.map((v) => ({ verdict: v, ...bucketStats(second.filter((x) => verdictOf(cal(x)) === v)) })),
    },
  },
};
writeFileSync(new URL("../packages/rating/src/calibration.json", import.meta.url), JSON.stringify(calibration, null, 2) + "\n");

console.info(`\n${calibration.coins} coins · ${obs.length} observations · ${calibration.from} → ${calibration.to} · forward ${HORIZON} days`);
console.info(`Baseline: mean ${pct(calibration.baseline.meanFwd)}, positive ${(calibration.baseline.positive * 100).toFixed(1)}%\n`);
for (const b of calibration.byVerdict) console.info(`${b.verdict.padEnd(18)} n=${String(b.n).padStart(4)}  mean ${pct(b.meanFwd).padStart(8)}  median ${pct(b.medianFwd).padStart(8)}  up ${(b.positive * 100).toFixed(1)}%  vs BTC ${pct(b.meanExcess)}  beat BTC ${(b.beatBtc * 100).toFixed(1)}%  max DD ${pct(b.meanMaxDd)}`);
console.info("\nDeciles (score → next 30d):");
for (const d of deciles) console.info(`  D${String(d.decile).padStart(2)} [${d.minScore}–${d.maxScore}] mean ${pct(d.meanFwd).padStart(8)} median ${pct(d.medianFwd).padStart(8)} up ${(d.positive * 100).toFixed(0)}% beat BTC ${(d.beatBtc * 100).toFixed(0)}%`);
console.info(`\nRank IC: mean ${total.mean.toFixed(3)}, t ${total.tStat.toFixed(2)}, positive ${(total.positiveShare * 100).toFixed(0)}% of ${total.dates} dates; halves ${calibration.ic.firstHalf} / ${calibration.ic.secondHalf}`);
console.info(`Top − bottom quintile: ${pct(calibration.quintileSpread.mean)} per ${HORIZON}d, positive on ${(calibration.quintileSpread.positiveShare * 100).toFixed(0)}% of dates`);
console.info("Pillar IC (cross-section):", calibration.pillarIc, "· sentiment time-series IC (BTC):", calibration.sentimentTimeSeriesIc);
console.info("Calibrated weights (fit on 1st half):", calibratedWeights);
console.info("Out-of-sample 2nd half — IC default", calibration.calibrated.outOfSample.defaultIc, "calibrated", calibration.calibrated.outOfSample.calibratedIc, "· spread default", pct(calibration.calibrated.outOfSample.defaultSpread), "calibrated", pct(calibration.calibrated.outOfSample.calibratedSpread));
