import type { Side } from "@cv/core";
import Decimal from "decimal.js";

/**
 * Trading-journal analytics over closed trades. The point is an honest mirror: the same
 * win rate, profit factor and expectancy the backtests report, measured on the user's own
 * trades, so the two can be compared. Money sums use Decimal; ratios are plain numbers.
 */

export interface JournalTrade {
  id: string;
  symbol: string;
  side: Side;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  /** PnL in multiples of the initial risk, when a stop was set. */
  r?: number;
  openedAt: number;
  closedAt: number;
  exitReason?: string;
  strategyId?: string | null;
  paper?: boolean;
}

export interface GroupStats {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
  /** Mean R over trades that have one; NaN when none do. */
  avgR: number;
}

export interface JournalStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  /** Gross profit / gross loss; Infinity with no losing trade. */
  profitFactor: number;
  /** Average PnL per trade. */
  expectancy: number;
  /** Average R per trade, over trades with a stop. */
  expectancyR: number;
  rTrades: number;
  avgWin: number;
  avgLoss: number;
  /** Average win / average loss (absolute). */
  payoff: number;
  best: JournalTrade | null;
  worst: JournalTrade | null;
  maxWinStreak: number;
  maxLossStreak: number;
  /** Current streak: positive = wins in a row, negative = losses. */
  currentStreak: number;
  /** Largest fall of the cumulative PnL from its running peak, in quote currency (≤ 0). */
  maxDrawdown: number;
  /** Same, as % of the peak equity (start equity + cumulative PnL); NaN without a positive start equity. */
  maxDrawdownPct: number;
  /** Average holding time in hours. */
  avgHoldHours: number;
  /** Equity after each trade, oldest first; the first point is the start equity. */
  equity: { time: number; value: number }[];
  bySymbol: GroupStats[];
  bySide: GroupStats[];
  byExit: GroupStats[];
  byStrategy: GroupStats[];
  /** Index 0 = Monday, by close day (UTC). */
  byWeekday: GroupStats[];
  /** "YYYY-MM" → net PnL, oldest first. */
  byMonth: { month: string; pnl: number; trades: number }[];
}

const D = (v: number) => new Decimal(Number.isFinite(v) ? v : 0);
const num = (d: Decimal, dp = 8) => d.toDecimalPlaces(dp).toNumber();

function group(trades: readonly JournalTrade[], keyOf: (t: JournalTrade) => string): GroupStats[] {
  const map = new Map<string, JournalTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  return [...map.entries()]
    .map(([key, ts]) => {
      const wins = ts.filter((t) => t.pnl > 0).length;
      const rs = ts.map((t) => t.r).filter((r): r is number => r !== undefined && Number.isFinite(r));
      return {
        key,
        trades: ts.length,
        wins,
        winRate: wins / ts.length,
        pnl: num(ts.reduce((s, t) => s.plus(D(t.pnl)), new Decimal(0)), 8),
        avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : NaN,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

export function journalStats(input: readonly JournalTrade[], startEquity = 0): JournalStats | null {
  const trades = [...input].filter((t) => Number.isFinite(t.pnl)).sort((a, b) => a.closedAt - b.closedAt);
  if (!trades.length) return null;
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl < 0);
  const sum = (ts: JournalTrade[]) => ts.reduce((s, t) => s.plus(D(t.pnl)), new Decimal(0));
  const gp = sum(winners);
  const gl = sum(losers).abs();
  const net = sum(trades);

  let winStreak = 0;
  let lossStreak = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let eq = D(startEquity);
  let peak = eq;
  let maxDd = new Decimal(0);
  let maxDdPct = 0;
  const equity = [{ time: trades[0]!.openedAt, value: num(eq, 2) }];
  for (const t of trades) {
    winStreak = t.pnl > 0 ? winStreak + 1 : 0;
    lossStreak = t.pnl < 0 ? lossStreak + 1 : 0;
    maxWin = Math.max(maxWin, winStreak);
    maxLoss = Math.max(maxLoss, lossStreak);
    eq = eq.plus(D(t.pnl));
    if (eq.gt(peak)) peak = eq;
    const dd = eq.minus(peak);
    if (dd.lt(maxDd)) maxDd = dd;
    if (startEquity > 0 && peak.gt(0)) maxDdPct = Math.min(maxDdPct, num(dd.div(peak).times(100), 4));
    equity.push({ time: t.closedAt, value: num(eq, 2) });
  }
  const last = trades[trades.length - 1]!;
  const currentStreak = last.pnl > 0 ? winStreak : last.pnl < 0 ? -lossStreak : 0;
  const rs = trades.map((t) => t.r).filter((r): r is number => r !== undefined && Number.isFinite(r));
  const avgWin = winners.length ? num(gp.div(winners.length)) : 0;
  const avgLoss = losers.length ? num(gl.div(losers.length)) : 0;
  const weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const byWeekdayRaw = group(trades, (t) => weekday[(new Date(t.closedAt).getUTCDay() + 6) % 7]!);
  const months = new Map<string, { pnl: Decimal; trades: number }>();
  for (const t of trades) {
    const k = new Date(t.closedAt).toISOString().slice(0, 7);
    const m = months.get(k) ?? { pnl: new Decimal(0), trades: 0 };
    months.set(k, { pnl: m.pnl.plus(D(t.pnl)), trades: m.trades + 1 });
  }

  return {
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: winners.length / trades.length,
    netPnl: num(net),
    grossProfit: num(gp),
    grossLoss: num(gl),
    profitFactor: gl.isZero() ? (gp.gt(0) ? Infinity : NaN) : num(gp.div(gl), 4),
    expectancy: num(net.div(trades.length)),
    expectancyR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : NaN,
    rTrades: rs.length,
    avgWin,
    avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : NaN,
    best: trades.reduce((b, t) => (t.pnl > b.pnl ? t : b)),
    worst: trades.reduce((b, t) => (t.pnl < b.pnl ? t : b)),
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    currentStreak,
    maxDrawdown: num(maxDd, 2),
    maxDrawdownPct: startEquity > 0 ? maxDdPct : NaN,
    avgHoldHours: trades.reduce((s, t) => s + Math.max(0, t.closedAt - t.openedAt), 0) / trades.length / 3_600_000,
    equity,
    bySymbol: group(trades, (t) => t.symbol),
    bySide: group(trades, (t) => t.side),
    byExit: group(trades, (t) => t.exitReason ?? "MANUAL"),
    byStrategy: group(trades, (t) => t.strategyId ?? "manual"),
    byWeekday: weekday.map((k) => byWeekdayRaw.find((g) => g.key === k) ?? { key: k, trades: 0, wins: 0, winRate: NaN, pnl: 0, avgR: NaN }),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({ month, pnl: num(m.pnl), trades: m.trades })),
  };
}
