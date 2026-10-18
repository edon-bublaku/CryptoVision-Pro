import type { Timeframe } from "@cv/core";
import { HIGHER_TIMEFRAME, TIMEFRAME_SECONDS } from "@cv/core";
import { finishScan, openTracked, startScan, updateTracked, upsertCandles, type Db, type SignalInput } from "@cv/db";
import { evaluateOutcome, fullAnalysis, snapshotOf, type TrackedSignal } from "@cv/engine";
import { closedOnly, derivativesBias, getDerivatives, getFearGreed, getKlines, getTickers24h, mapLimit, universe } from "@cv/exchange";
import { cached, channels, env, log, publish } from "@cv/server";
import type { Signal } from "@cv/core";
import { runSignalAlerts } from "./alerts";

/** Full market scan for one timeframe: the same engine as the browser, stored for every user. */
export async function scanJob(db: Db, timeframe: Timeframe) {
  const t0 = Date.now();
  const size = env().SCAN_SIZE;
  const scanId = await startScan(db, timeframe);
  const [tickers, fg] = await Promise.all([getTickers24h(), getFearGreed(1).catch(() => [])]);
  const coins = universe(tickers, size);
  const fearGreed = fg[fg.length - 1]?.value;
  const htf = HIGHER_TIMEFRAME[timeframe];
  const failed: string[] = [];
  const rows: SignalInput[] = [];

  await mapLimit(coins, 4, async (coin, idx) => {
    try {
      const [main, higher] = await Promise.all([getKlines(coin.symbol, timeframe, 1000), htf !== timeframe ? getKlines(coin.symbol, htf, 300) : Promise.resolve(null)]);
      const candles = closedOnly(main);
      // Derivatives only for the most liquid coins (they all have OKX swaps); cached 5 min.
      let bias: number | undefined;
      if (idx < 30) {
        try {
          const d = await cached(`cv:deriv:${coin.symbol}`, 300, () => getDerivatives(coin.symbol));
          bias = derivativesBias(d);
        } catch {
          bias = undefined;
        }
      }
      const fa = fullAnalysis({ symbol: coin.symbol, timeframe, candles, htfCandles: higher ? closedOnly(higher) : undefined, fearGreed, derivativesBias: bias });
      if (!fa) {
        failed.push(coin.symbol);
        return;
      }
      const s = fa.analysis.signal;
      rows.push({
        id: s.id,
        symbol: s.symbol,
        timeframe,
        action: s.action,
        status: s.status,
        score: s.score,
        confidence: s.confidence,
        strategyId: s.strategyId,
        candleTime: new Date(s.candleTime * 1000),
        signal: s,
        snapshot: snapshotOf(fa.analysis, coin.priceChangePercent, coin.quoteVolume),
        gate: fa.gate,
      });
      // Keep a growing OHLCV history for long backtests (idempotent upsert).
      await upsertCandles(db, coin.symbol, timeframe, candles.slice(-200));
    } catch (e) {
      failed.push(coin.symbol);
      log.warn({ symbol: coin.symbol, err: String(e) }, "scan coin failed");
    }
  });

  await finishScan(db, scanId, rows, failed);
  const active = rows.filter((r) => r.status === "ACTIVE");
  await publish(channels.signals, JSON.stringify({ timeframe, scanId, coins: rows.length, active: active.length }));
  await runSignalAlerts(db, active);
  log.info({ timeframe, coins: rows.length, active: active.length, failed: failed.length, ms: Date.now() - t0 }, "scan finished");
  return { scanId, coins: rows.length, active: active.length };
}

/** Follows open ACTIVE signals to TP/SL — the public track record. */
export async function trackJob(db: Db) {
  const open = await openTracked(db, 200);
  let updated = 0;
  for (const { t, s } of open) {
    const signal = s.signal as Signal;
    const tf = s.timeframe as Timeframe;
    try {
      const after = (await getKlines(s.symbol, tf, 500)).candles.filter((c) => c.time > signal.candleTime);
      const prev: TrackedSignal = { signal, outcome: t.outcome, bestR: t.bestR, updatedAt: t.updatedAt.getTime() };
      const next = evaluateOutcome(prev, after, TIMEFRAME_SECONDS[tf]);
      if (next.outcome !== t.outcome || Math.abs(next.bestR - t.bestR) > 1e-9) {
        await updateTracked(db, s.id, next.outcome, next.bestR);
        updated++;
      }
    } catch (e) {
      log.warn({ id: s.id, err: String(e) }, "track failed");
    }
  }
  log.info({ open: open.length, updated }, "track finished");
}
