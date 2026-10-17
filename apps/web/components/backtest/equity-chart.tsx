"use client";

import type { Candle } from "@cv/core";
import { AreaSeries, ColorType, createChart, HistogramSeries, LineSeries, LineStyle, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useSettings } from "@/lib/store/settings";
import { cssVar } from "@/lib/utils";

/** Strategy equity vs buy & hold, with drawdown in a lower pane. */
export function EquityChart({ equity, candles, initial }: { equity: { time: number; equity: number; drawdownPct: number }[]; candles: Candle[]; initial: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const el = ref.current;
    if (!el || equity.length === 0) return;
    const c = { bg: cssVar("--panel", "#10141c"), fg: cssVar("--muted", "#8b95a8"), grid: cssVar("--line", "#1f2633"), accent: cssVar("--accent", "#4f8cff"), bear: cssVar("--bear", "#f0475a"), muted: cssVar("--faint", "#5d6678") };
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.fg, fontSize: 11, attributionLogo: false, panes: { separatorColor: c.grid } },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid, timeVisible: true },
      localization: { locale: "en-US" },
    });
    const eq = chart.addSeries(AreaSeries, { lineColor: c.accent, topColor: `${c.accent}44`, bottomColor: `${c.accent}05`, lineWidth: 2, priceLineVisible: false, title: "Strategy" });
    eq.setData(equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })));
    eq.createPriceLine({ price: initial, color: c.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    const first = candles.find((x) => x.time === equity[0]!.time) ?? candles[0];
    if (first) {
      const bh = chart.addSeries(LineSeries, { color: c.muted, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: true, title: "Buy & hold" });
      const set = new Set(equity.map((p) => p.time));
      bh.setData(candles.filter((x) => set.has(x.time)).map((x) => ({ time: x.time as UTCTimestamp, value: (initial * x.close) / first.close })));
    }
    const dd = chart.addSeries(HistogramSeries, { color: `${c.bear}aa`, priceLineVisible: false, priceFormat: { type: "percent" } }, 1);
    dd.setData(equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.drawdownPct })));
    chart.panes()[1]?.setHeight(90);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [equity, candles, initial, theme]);
  return <div ref={ref} className="h-[360px] w-full" />;
}
