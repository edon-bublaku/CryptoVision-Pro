import { describe, expect, it } from "vitest";
import { journalStats, type JournalTrade } from "./journal";

const H = 3_600_000;
const MON = Date.UTC(2026, 0, 5); // Monday

let n = 0;
function trade(pnl: number, closedAt: number, extra: Partial<JournalTrade> = {}): JournalTrade {
  return { id: String(n++), symbol: "BTCUSDT", side: "LONG", entry: 100, exit: 100, quantity: 1, pnl, openedAt: closedAt - 2 * H, closedAt, ...extra };
}

describe("journalStats", () => {
  it("returns null without trades", () => {
    expect(journalStats([])).toBeNull();
  });

  it("computes win rate, profit factor, expectancy and payoff exactly", () => {
    const s = journalStats([trade(0.1, MON, { r: 1 }), trade(0.2, MON + H, { r: 2 }), trade(-0.1, MON + 2 * H, { r: -1 })], 1000)!;
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3, 12);
    expect(s.grossProfit).toBe(0.3); // Decimal: no 0.30000000000000004
    expect(s.netPnl).toBe(0.2);
    expect(s.profitFactor).toBe(3);
    expect(s.expectancyR).toBeCloseTo(2 / 3, 12);
    expect(s.payoff).toBeCloseTo(1.5, 12);
    expect(s.avgHoldHours).toBe(2);
  });

  it("tracks streaks, drawdown and the equity curve in close order", () => {
    const s = journalStats([trade(-50, MON + 3 * H), trade(100, MON), trade(-30, MON + 2 * H), trade(20, MON + 4 * H), trade(20, MON + 5 * H)], 1000)!;
    expect(s.equity.map((p) => p.value)).toEqual([1000, 1100, 1070, 1020, 1040, 1060]);
    expect(s.maxDrawdown).toBe(-80);
    expect(s.maxDrawdownPct).toBeCloseTo((-80 / 1100) * 100, 3);
    expect(s.maxLossStreak).toBe(2);
    expect(s.maxWinStreak).toBe(2);
    expect(s.currentStreak).toBe(2);
    expect(s.best!.pnl).toBe(100);
    expect(s.worst!.pnl).toBe(-50);
  });

  it("profit factor is Infinity without losers", () => {
    expect(journalStats([trade(5, MON)])!.profitFactor).toBe(Infinity);
  });

  it("groups by symbol, side, exit reason, weekday and month", () => {
    const s = journalStats([
      trade(10, MON, { symbol: "ETHUSDT", exitReason: "TP" }),
      trade(-5, MON + 24 * H, { side: "SHORT", exitReason: "SL" }),
      trade(7, Date.UTC(2026, 1, 3), { exitReason: "TP" }),
    ])!;
    expect(s.bySymbol.map((g) => g.key)).toEqual(["ETHUSDT", "BTCUSDT"]);
    expect(s.bySide.find((g) => g.key === "SHORT")).toMatchObject({ trades: 1, pnl: -5 });
    expect(s.byExit.find((g) => g.key === "TP")).toMatchObject({ trades: 2, wins: 2, winRate: 1 });
    expect(s.byWeekday[0]).toMatchObject({ key: "mon", trades: 1 });
    expect(s.byWeekday[1]).toMatchObject({ key: "tue", trades: 2 });
    expect(s.byMonth).toEqual([
      { month: "2026-01", pnl: 5, trades: 2 },
      { month: "2026-02", pnl: 7, trades: 1 },
    ]);
  });
});
