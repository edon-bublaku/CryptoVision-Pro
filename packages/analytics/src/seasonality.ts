import type { Candle } from "@cv/core";
import { mean, median } from "@cv/core";

/**
 * Calendar statistics over daily candles: monthly returns by year, weekday behaviour, the
 * distribution of daily moves and the worst historical drawdowns. Everything is UTC, the
 * exchange's own day boundary, so the numbers match what the chart shows.
 */

export interface MonthCell {
  year: number;
  /** 0 = January. */
  month: number;
  /** Close-to-close return of the calendar month, in %. Partial months are flagged. */
  ret: number;
  partial: boolean;
}

export interface BucketStats {
  /** Mean return, in %. */
  mean: number;
  median: number;
  /** Share of positive periods, 0..1. */
  positive: number;
  count: number;
}

export interface Drawdown {
  peakTime: number;
  troughTime: number;
  /** Time the previous peak was regained; null while still under water. */
  recoveryTime: number | null;
  /** Peak-to-trough fall, in % (negative). */
  depth: number;
  /** Days from peak to trough. */
  fallDays: number;
  /** Days from trough back to the peak, or so far. */
  recoveryDays: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface Seasonality {
  months: MonthCell[];
  years: number[];
  /** Per calendar month (index 0 = January), over complete months only. */
  byMonth: BucketStats[];
  /** Per weekday (index 0 = Monday), over daily returns. */
  byWeekday: BucketStats[];
  /** Calendar-year returns in %. */
  byYear: { year: number; ret: number; partial: boolean }[];
  histogram: HistogramBin[];
  daily: { mean: number; stdev: number; best: { time: number; ret: number } | null; worst: { time: number; ret: number } | null; upDays: number };
  /** Longest runs of consecutive up / down days. */
  streaks: { up: number; down: number };
  drawdowns: Drawdown[];
  first: number;
  last: number;
}

const DAY = 86_400;

function stats(xs: number[]): BucketStats {
  return { mean: xs.length ? mean(xs) : NaN, median: xs.length ? median(xs) : NaN, positive: xs.length ? xs.filter((x) => x > 0).length / xs.length : NaN, count: xs.length };
}

/** Month cells keyed by the close of the last candle of each month vs the previous month's last close. */
function monthCells(candles: readonly Candle[]): MonthCell[] {
  const out: MonthCell[] = [];
  let prevClose: number | null = null;
  let firstOpen: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const d = new Date(c.time * 1000);
    if (firstOpen === null) firstOpen = c.open;
    const next = candles[i + 1];
    const monthEnds = !next || new Date(next.time * 1000).getUTCMonth() !== d.getUTCMonth();
    if (!monthEnds) continue;
    const base = prevClose ?? firstOpen;
    // A month is partial when history starts after its first day or ends before its last.
    const startsLate = prevClose === null && new Date(candles[0]!.time * 1000).getUTCDate() !== 1;
    const endsEarly = !next && new Date((c.time + DAY) * 1000).getUTCMonth() === d.getUTCMonth();
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), ret: (c.close / base - 1) * 100, partial: startsLate || endsEarly });
    prevClose = c.close;
  }
  return out;
}

/** The `limit` deepest peak-to-trough declines that don't overlap, deepest first. */
export function topDrawdowns(candles: readonly Candle[], limit = 5): Drawdown[] {
  const episodes: Drawdown[] = [];
  let peak = candles[0];
  let trough = candles[0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    if (!peak || !trough) break;
    if (c.close >= peak.close) {
      if (trough.close < peak.close) episodes.push(episode(peak, trough, c.time));
      peak = c;
      trough = c;
    } else if (c.close < trough.close) {
      trough = c;
    }
  }
  if (peak && trough && trough.close < peak.close) episodes.push(episode(peak, trough, null, candles[candles.length - 1]!.time));
  return episodes.sort((a, b) => a.depth - b.depth).slice(0, limit);
}

function episode(peak: Candle, trough: Candle, recovery: number | null, now = recovery ?? trough.time): Drawdown {
  return {
    peakTime: peak.time,
    troughTime: trough.time,
    recoveryTime: recovery,
    depth: (trough.close / peak.close - 1) * 100,
    fallDays: Math.round((trough.time - peak.time) / DAY),
    recoveryDays: Math.round(((recovery ?? now) - trough.time) / DAY),
  };
}

/** Equal-width histogram of daily returns, clipped to ±`clip`% so outliers land in the edge bins. */
export function histogram(values: readonly number[], bins = 24, clip = 12): HistogramBin[] {
  const width = (2 * clip) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, k) => ({ from: -clip + k * width, to: -clip + (k + 1) * width, count: 0 }));
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const k = Math.min(bins - 1, Math.max(0, Math.floor((v + clip) / width)));
    out[k]!.count++;
  }
  return out;
}

export function seasonality(candles: readonly Candle[]): Seasonality | null {
  if (candles.length < 30) return null;
  const months = monthCells(candles);
  const daily: { time: number; ret: number }[] = [];
  for (let i = 1; i < candles.length; i++) daily.push({ time: candles[i]!.time, ret: (candles[i]!.close / candles[i - 1]!.close - 1) * 100 });
  const rets = daily.map((d) => d.ret);

  const byMonth = Array.from({ length: 12 }, (_, m) => stats(months.filter((c) => c.month === m && !c.partial).map((c) => c.ret)));
  // getUTCDay: 0 = Sunday → shift so 0 = Monday.
  const byWeekday = Array.from({ length: 7 }, (_, w) => stats(daily.filter((d) => (new Date(d.time * 1000).getUTCDay() + 6) % 7 === w).map((d) => d.ret)));

  const years = [...new Set(months.map((m) => m.year))];
  const byYear = years.map((year) => {
    const ms = months.filter((m) => m.year === year);
    const ret = (ms.reduce((acc, m) => acc * (1 + m.ret / 100), 1) - 1) * 100;
    return { year, ret, partial: ms.length < 12 || ms.some((m) => m.partial) };
  });

  let up = 0;
  let down = 0;
  let maxUp = 0;
  let maxDown = 0;
  for (const r of rets) {
    up = r > 0 ? up + 1 : 0;
    down = r < 0 ? down + 1 : 0;
    maxUp = Math.max(maxUp, up);
    maxDown = Math.max(maxDown, down);
  }
  const best = daily.reduce<{ time: number; ret: number } | null>((b, d) => (!b || d.ret > b.ret ? d : b), null);
  const worst = daily.reduce<{ time: number; ret: number } | null>((b, d) => (!b || d.ret < b.ret ? d : b), null);
  const m = mean(rets);

  return {
    months,
    years,
    byMonth,
    byWeekday,
    byYear,
    histogram: histogram(rets),
    daily: { mean: m, stdev: Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / Math.max(1, rets.length - 1)), best, worst, upDays: rets.filter((r) => r > 0).length / rets.length },
    streaks: { up: maxUp, down: maxDown },
    drawdowns: topDrawdowns(candles),
    first: candles[0]!.time,
    last: candles[candles.length - 1]!.time,
  };
}
