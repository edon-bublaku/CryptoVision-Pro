"use client";

import type { Candle, Timeframe } from "@cv/core";
import { formatCompact, formatPrice, HIGHER_TIMEFRAME, priceDecimals, resample, TIMEFRAME_SECONDS } from "@cv/core";
import { autoFib, candlePatternsAt, heikinAshi, pivotPoints, volumeProfile } from "@cv/indicators";
import type { Trade } from "@cv/backtest";
import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fullAnalysis, type FullAnalysis } from "@/lib/analysis";
import { AnalysisOverlay, type OverlayZone } from "@/lib/chart/analysis-overlay";
import { CoordMapper } from "@/lib/chart/coords";
import { DrawingController } from "@/lib/chart/drawing-controller";
import { DrawingsPrimitive } from "@/lib/chart/drawing-render";
import type { Drawing } from "@/lib/chart/drawing-types";
import { futureTimes, INDICATORS } from "@/lib/chart/indicators";
import { useCandles } from "@/lib/chart/use-candles";
import { closedOnly, getKlines } from "@/lib/data/binance";
import { getFearGreed } from "@/lib/data/market";
import { useT } from "@/lib/i18n";
import { useChartUi } from "@/lib/store/chart-ui";
import { useDrawings } from "@/lib/store/drawings";
import { useSettings } from "@/lib/store/settings";
import { cn, cssVar } from "@/lib/utils";

export interface ChartPanelHandle {
  screenshot(): void;
}

interface Props {
  symbol: string;
  timeframe: Timeframe;
  active?: boolean;
  onActivate?: () => void;
  onAnalysis?: (a: FullAnalysis | null, candles: Candle[]) => void;
  onContextMenu?: (drawingId: string, x: number, y: number) => void;
  onEditText?: (drawingId: string) => void;
  /** Backtest trades to mark on the chart (Backtest Lab). */
  trades?: Trade[];
  /** Static candles instead of the live feed (Backtest Lab). */
  staticCandles?: Candle[];
  /** Hide drawing interaction entirely. */
  readOnly?: boolean;
  registerHandle?: (h: ChartPanelHandle | null) => void;
  className?: string;
}

const ts = (t: number) => t as UTCTimestamp;

function themeColors() {
  return {
    bg: cssVar("--panel", "#10141c"),
    fg: cssVar("--muted", "#8b95a8"),
    grid: cssVar("--line", "#1f2633"),
    border: cssVar("--line-strong", "#2b3445"),
    bull: cssVar("--bull", "#16c784"),
    bear: cssVar("--bear", "#f0475a"),
    accent: cssVar("--accent", "#4f8cff"),
    warn: cssVar("--warn", "#f5a524"),
    muted: cssVar("--muted", "#8b95a8"),
  };
}

export function ChartPanel(props: Props) {
  const { symbol, timeframe: tf, active = true, staticCandles } = props;
  const t = useT();
  const prefs = useSettings((s) => s.chart);
  const theme = useSettings((s) => s.theme);
  const colorblind = useSettings((s) => s.colorblind);
  const tool = useChartUi((s) => s.tool);
  const setTool = useChartUi((s) => s.setTool);
  const stayInTool = useChartUi((s) => s.stayInTool);
  const drawingsHidden = useChartUi((s) => s.drawingsHidden);
  const replay = useChartUi((s) => s.replay);
  const drawings = useDrawings((s) => s.bySymbol[symbol]);
  const selectedId = useDrawings((s) => s.selectedId);

  const live = useCandles(symbol, tf, staticCandles ? 0 : 1000);
  const feed = staticCandles ? { ...live, candles: staticCandles, lastIsOpen: false, status: "ready" as const, closedVersion: staticCandles.length, tickVersion: 0 } : live;

  const htf = HIGHER_TIMEFRAME[tf];
  const htfQuery = useQuery({
    queryKey: ["klines", symbol, htf, 300],
    queryFn: async ({ signal }) => closedOnly(await getKlines(symbol, htf, 300, undefined, signal)),
    enabled: !staticCandles && htf !== tf,
    staleTime: 5 * 60_000,
  });
  const fg = useQuery({ queryKey: ["fng"], queryFn: ({ signal }) => getFearGreed(30, signal), staleTime: 30 * 60_000, retry: 1 });

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const layerRef = useRef<DrawingsPrimitive | null>(null);
  const overlayRef = useRef<AnalysisOverlay | null>(null);
  const controllerRef = useRef<DrawingController | null>(null);
  const indSeries = useRef(new Map<string, { series: ISeriesApi<SeriesType>[]; lines: IPriceLine[] }>());
  const priceLines = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [chartKey, setChartKey] = useState(0);
  const [analysisState, setAnalysisState] = useState<FullAnalysis | null>(null);
  const lastIndRefresh = useRef(0);

  // Candles shown: replay slices history; Heikin-Ashi transforms it.
  const viewCandles = useMemo(() => {
    const base = replay.active && active && !staticCandles ? feed.candles.slice(0, Math.max(60, replay.index + 1)) : feed.candles;
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.candles, feed.closedVersion, feed.tickVersion, replay.active, replay.index, active, staticCandles]);

  // ---------- chart lifecycle ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const c = themeColors();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.fg,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: c.grid, separatorHoverColor: c.border, enableResize: true },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.grid, scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7 },
      // Explicit locale: some environments report tags (e.g. "en-US@posix") that Intl rejects,
      // and en-GB gives compact "16 Oct 14:00" axis labels.
      localization: { priceFormatter: (p: number) => formatPrice(p), locale: "en-GB" },
    });
    chartRef.current = chart;

    const common = { priceLineVisible: true, lastValueVisible: true };
    let main: ISeriesApi<SeriesType>;
    if (prefs.type === "line") main = chart.addSeries(LineSeries, { ...common, color: c.accent, lineWidth: 2 });
    else if (prefs.type === "area") main = chart.addSeries(AreaSeries, { ...common, lineColor: c.accent, topColor: `${c.accent}55`, bottomColor: `${c.accent}05`, lineWidth: 2 });
    else if (prefs.type === "bars") main = chart.addSeries(BarSeries, { ...common, upColor: c.bull, downColor: c.bear });
    else main = chart.addSeries(CandlestickSeries, { ...common, upColor: c.bull, downColor: c.bear, borderUpColor: c.bull, borderDownColor: c.bear, wickUpColor: c.bull, wickDownColor: c.bear });
    mainRef.current = main;

    const mapper = new CoordMapper(chart, main, () => candlesRef.current.map((x) => x.time), () => TIMEFRAME_SECONDS[tf]);
    const overlay = new AnalysisOverlay(mapper);
    overlay.update({ colors: { bull: c.bull, bear: c.bear, muted: c.muted } });
    main.attachPrimitive(overlay);
    overlayRef.current = overlay;
    const layer = new DrawingsPrimitive(mapper);
    main.attachPrimitive(layer);
    layerRef.current = layer;
    markersRef.current = createSeriesMarkers(main, []);

    if (!props.readOnly) {
      controllerRef.current = new DrawingController(el, chart, mapper, layer, () => candlesRef.current, {
        onChange: (next, commit) => {
          const st = useDrawings.getState();
          if (commit) st.commit(symbol, next);
          else st.replace(symbol, next);
        },
        onCheckpoint: () => useDrawings.getState().checkpoint(symbol),
        onSelect: (id) => useDrawings.getState().select(id),
        onToolDone: () => {
          if (!useChartUi.getState().stayInTool) setTool("cursor");
        },
        onContextMenu: (id, x, y) => props.onContextMenu?.(id, x, y),
        onEditText: (id) => props.onEditText?.(id),
      });
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(null);
        return;
      }
      const tm = param.time as number;
      const cs = candlesRef.current;
      let lo = 0;
      let hi = cs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cs[mid]!.time === tm) {
          setLegend(cs[mid]!);
          return;
        }
        if (cs[mid]!.time < tm) lo = mid + 1;
        else hi = mid - 1;
      }
    });

    props.registerHandle?.({
      screenshot: () => {
        const canvas = chart.takeScreenshot();
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${symbol}-${tf}-${new Date().toISOString().slice(0, 16)}.png`;
          a.click();
        });
      },
    });

    setChartKey((k) => k + 1);
    return () => {
      props.registerHandle?.(null);
      controllerRef.current?.dispose();
      controllerRef.current = null;
      indSeries.current.clear();
      priceLines.current = [];
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.type, symbol, tf, theme, colorblind]);

  // Log scale
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({ mode: prefs.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [prefs.log, chartKey]);

  // Price precision
  useEffect(() => {
    const last = viewCandles[viewCandles.length - 1];
    if (!last || !mainRef.current) return;
    const d = priceDecimals(last.close);
    mainRef.current.applyOptions({ priceFormat: { type: "price", precision: d, minMove: 1 / 10 ** d } });
  }, [chartKey, symbol, viewCandles.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- indicator series structure ----------
  const enabledIndicators = prefs.indicators.join(",");
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const { series } of indSeries.current.values()) for (const s of series) chart.removeSeries(s);
    indSeries.current.clear();
    if (volRef.current) {
      chart.removeSeries(volRef.current);
      volRef.current = null;
    }
    const c = themeColors();
    let pane = 1;
    for (const def of INDICATORS) {
      if (!prefs.indicators.includes(def.id)) continue;
      if (def.placement === "volume") {
        const v = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
        v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volRef.current = v;
        continue;
      }
      const paneIndex = def.placement === "pane" ? pane++ : 0;
      // Line count, kinds and levels don't depend on data, so an empty dry run gives the shape.
      const shape = def.compute([], { bull: c.bull, bear: c.bear });
      const series: ISeriesApi<SeriesType>[] = [];
      const lines: IPriceLine[] = [];
      for (const ln of shape.lines) {
        const opts = { color: ln.color, lineWidth: (ln.width ?? 1) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: def.placement === "pane", crosshairMarkerVisible: false, lineStyle: ln.dashed ? LineStyle.Dashed : LineStyle.Solid, title: "" };
        const s =
          ln.kind === "histogram"
            ? chart.addSeries(HistogramSeries, { color: ln.color, priceLineVisible: false, lastValueVisible: false }, paneIndex)
            : ln.kind === "dots"
              ? chart.addSeries(LineSeries, { ...opts, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 }, paneIndex)
              : chart.addSeries(LineSeries, opts, paneIndex);
        series.push(s);
      }
      if (shape.levels && series[0]) for (const lv of shape.levels) lines.push(series[0].createPriceLine({ price: lv, color: c.border, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false }));
      indSeries.current.set(def.id, { series, lines });
    }
    // Drop panes that no longer hold series and size the oscillator panes.
    const panes = chart.panes();
    for (let i = panes.length - 1; i > 0; i--) if (panes[i]!.getSeries().length === 0) chart.removePane(i);
    chart.panes().forEach((p, i) => i > 0 && p.setHeight(110));
    refreshIndicators(viewCandles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledIndicators, chartKey]);

  function refreshIndicators(cs: Candle[]) {
    const c = themeColors();
    lastIndRefresh.current = Date.now();
    if (volRef.current) volRef.current.setData(cs.map((x) => ({ time: ts(x.time), value: x.volume, color: x.close >= x.open ? `${c.bull}55` : `${c.bear}55` })));
    for (const def of INDICATORS) {
      const entry = indSeries.current.get(def.id);
      if (!entry) continue;
      const out = def.compute(cs, { bull: c.bull, bear: c.bear });
      out.lines.forEach((ln, k) => {
        const s = entry.series[k];
        if (!s) return;
        const shift = ln.shift ?? 0;
        const fut = shift && cs.length ? futureTimes(cs[cs.length - 1]!.time, tf, shift) : [];
        const data: { time: UTCTimestamp; value: number; color?: string }[] = [];
        for (let i = 0; i < ln.values.length; i++) {
          const v = ln.values[i]!;
          if (!Number.isFinite(v)) continue;
          const j = i + shift;
          const time = j < cs.length ? cs[j]!.time : fut[j - cs.length];
          if (time === undefined) continue;
          const col = ln.colors?.[i];
          data.push(col ? { time: ts(time), value: v, color: col } : { time: ts(time), value: v });
        }
        s.setData(data);
      });
    }
  }

  // ---------- data: full refresh on closed candles / replay / indicator change ----------
  useEffect(() => {
    const main = mainRef.current;
    if (!main || viewCandles.length === 0) return;
    candlesRef.current = viewCandles;
    const display = prefs.type === "heikin" ? heikinAshi(viewCandles) : viewCandles;
    if (prefs.type === "line" || prefs.type === "area") main.setData(display.map((x) => ({ time: ts(x.time), value: x.close })));
    else main.setData(display.map((x) => ({ time: ts(x.time), open: x.open, high: x.high, low: x.low, close: x.close })));
    refreshIndicators(viewCandles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.closedVersion, chartKey, replay.active, replay.index, prefs.type, symbol, staticCandles]);

  // ---------- live ticks ----------
  useEffect(() => {
    const main = mainRef.current;
    if (!main || replay.active || staticCandles) return;
    const cs = feed.candles;
    const last = cs[cs.length - 1];
    if (!last) return;
    candlesRef.current = cs;
    if (prefs.type === "line" || prefs.type === "area") main.update({ time: ts(last.time), value: last.close });
    else if (prefs.type === "heikin") {
      const ha = heikinAshi(cs.slice(-50));
      const h = ha[ha.length - 1]!;
      main.update({ time: ts(h.time), open: h.open, high: h.high, low: h.low, close: h.close });
    } else main.update({ time: ts(last.time), open: last.open, high: last.high, low: last.low, close: last.close });
    if (volRef.current) {
      const c = themeColors();
      volRef.current.update({ time: ts(last.time), value: last.volume, color: last.close >= last.open ? `${c.bull}55` : `${c.bear}55` });
    }
    if (Date.now() - lastIndRefresh.current > 1500) refreshIndicators(cs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.tickVersion]);

  // ---------- lazy history ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || staticCandles) return;
    const handler = (range: { from: number; to: number } | null) => {
      if (range && range.from < 15 && !replay.active) void feed.loadMore();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [chartKey, feed.loadMore, replay.active, staticCandles]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- analysis (closed candles only) ----------
  const closed = useMemo(() => {
    if (replay.active && active && !staticCandles) return viewCandles;
    return feed.candles.slice(0, feed.lastIsOpen ? -1 : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.closedVersion, replay.active, replay.index, active, staticCandles]);

  useEffect(() => {
    if (closed.length < 220) {
      setAnalysisState(null);
      return;
    }
    const id = setTimeout(() => {
      const slice = closed.slice(-1000);
      const res = fullAnalysis({ symbol, timeframe: tf, candles: slice, htfCandles: replay.active ? undefined : htfQuery.data, fearGreed: fg.data?.[fg.data.length - 1]?.value });
      setAnalysisState(res);
    }, 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed, htfQuery.data, fg.data, symbol, tf]);

  useEffect(() => {
    if (active) props.onAnalysis?.(analysisState, closed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisState, active]);

  // ---------- auto-analysis overlays ----------
  useEffect(() => {
    const main = mainRef.current;
    const overlay = overlayRef.current;
    if (!main || !overlay) return;
    for (const pl of priceLines.current) main.removePriceLine(pl);
    priceLines.current = [];
    const c = themeColors();
    const ov = new Set(prefs.overlays);
    const markers: SeriesMarker<Time>[] = [];
    const a = analysisState?.analysis;
    const cs = closed;
    const lastT = cs[cs.length - 1]?.time;

    if (a && ov.has("levels"))
      for (const l of a.levels.slice(0, 8))
        priceLines.current.push(
          main.createPriceLine({ price: l.price, color: l.kind === "support" ? c.bull : c.bear, lineWidth: l.strength > 0.6 ? 2 : 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `${l.kind === "support" ? "S" : "R"}×${l.touches}` }),
        );

    if (a && ov.has("structure"))
      for (const ev of a.context.structure.events.slice(-12))
        markers.push({ time: ts(cs[ev.index]!.time), position: ev.direction === "bullish" ? "belowBar" : "aboveBar", color: ev.direction === "bullish" ? c.bull : c.bear, shape: "circle", size: 0.5, text: ev.type === "CHOCH" ? "CHoCH" : "BOS" });

    if (a && ov.has("patterns"))
      for (let i = Math.max(2, cs.length - 60); i < cs.length; i++)
        for (const p of candlePatternsAt(cs, i, a.context.atr[i]))
          if (p.direction !== "neutral" && p.reliability >= 0.6)
            markers.push({ time: ts(cs[i]!.time), position: p.direction === "bullish" ? "belowBar" : "aboveBar", color: p.direction === "bullish" ? c.bull : c.bear, shape: "square", size: 0.4, text: t(`pattern.${p.id}`) });

    if (a && ov.has("signal") && a.signal.action !== "HOLD" && lastT !== undefined) {
      const bull = a.signal.action.includes("BUY");
      markers.push({ time: ts(lastT), position: bull ? "belowBar" : "aboveBar", color: bull ? c.bull : c.bear, shape: bull ? "arrowUp" : "arrowDown", size: 1.6, text: `${t(`action.${a.signal.action}`)} ${a.signal.score}` });
    }

    if (props.trades)
      for (const tr of props.trades) {
        const long = tr.side === "LONG";
        markers.push({ time: ts(tr.entryTime), position: long ? "belowBar" : "aboveBar", color: long ? c.bull : c.bear, shape: long ? "arrowUp" : "arrowDown", size: 1, text: long ? "L" : "S" });
        markers.push({ time: ts(tr.exitTime), position: long ? "aboveBar" : "belowBar", color: tr.pnl >= 0 ? c.bull : c.bear, shape: "circle", size: 0.6, text: `${tr.rMultiple >= 0 ? "+" : ""}${tr.rMultiple.toFixed(1)}R` });
      }

    markers.sort((x, y) => (x.time as number) - (y.time as number));
    markersRef.current?.setMarkers(markers);

    const zones: OverlayZone[] = [];
    if (a && ov.has("zones")) {
      const all = [...a.context.orderBlocks.map((z) => ({ ...z, kind: "OB" })), ...a.context.fvgs.map((z) => ({ ...z, kind: "FVG" }))].filter((z) => cs.length - z.createdIndex < 200);
      const fresh = all.filter((z) => !z.mitigated).slice(-10);
      const recentMitigated = all.filter((z) => z.mitigated && cs.length - (z.mitigatedIndex ?? 0) < 40).slice(-4);
      for (const z of [...recentMitigated, ...fresh])
        zones.push({ from: z.startTime, to: z.mitigated && z.mitigatedIndex !== undefined ? cs[z.mitigatedIndex]!.time : null, top: z.top, bottom: z.bottom, bullish: z.direction === "bullish", label: `${z.kind} ${z.direction === "bullish" ? "▲" : "▼"}` });
    }

    if (ov.has("fib") && cs.length > 50) {
      const f = autoFib(cs, 150);
      if (f)
        for (const l of f.levels.filter((x) => x.ratio <= 1))
          priceLines.current.push(main.createPriceLine({ price: l.price, color: c.warn, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false, title: `Fib ${l.ratio}` }));
    }

    if (ov.has("pivots") && cs.length > 10) {
      const bucket = TIMEFRAME_SECONDS[tf] >= 86400 ? 604800 : 86400;
      const days = resample(cs, bucket);
      const prev = days[days.length - 2];
      if (prev) {
        const pp = pivotPoints(prev);
        for (const [k, v] of Object.entries(pp))
          priceLines.current.push(main.createPriceLine({ price: v, color: k === "pp" ? c.accent : k.startsWith("r") ? c.bear : c.bull, lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: false, title: k.toUpperCase() }));
      }
    }

    overlay.update({
      colors: { bull: c.bull, bear: c.bear, muted: c.muted },
      zones,
      plan: a && ov.has("signal") && a.signal.plan && lastT !== undefined ? { plan: a.signal.plan, from: lastT, to: lastT + TIMEFRAME_SECONDS[tf] * 20 } : null,
      profile: ov.has("profile") ? volumeProfile(cs.slice(-300), 48) : null,
      divergences:
        a && ov.has("divergence")
          ? a.context.rsiDivergences.slice(-6).map((d) => ({ from: { time: d.from.time, price: d.from.price }, to: { time: d.to.time, price: d.to.price }, bullish: d.direction === "bullish" }))
          : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisState, prefs.overlays.join(","), chartKey, props.trades]);

  // ---------- drawings ----------
  useEffect(() => {
    const list = drawingsHidden ? [] : (drawings ?? []);
    if (controllerRef.current) controllerRef.current.setDrawings(list as Drawing[]);
    else layerRef.current?.update({ drawings: list as Drawing[] });
  }, [drawings, drawingsHidden, chartKey]);
  useEffect(() => controllerRef.current?.setSelected(selectedId), [selectedId, chartKey]);
  useEffect(() => controllerRef.current?.setTool(active ? tool : "cursor"), [tool, active, chartKey]);
  useEffect(() => controllerRef.current?.setMagnet(prefs.magnet), [prefs.magnet, chartKey]);

  // Keyboard: Delete / Esc / Ctrl+Z / Ctrl+Y / Ctrl+D / Shift-constrain
  useEffect(() => {
    if (!active || props.readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      controllerRef.current?.setShift(e.shiftKey);
      const st = useDrawings.getState();
      const list = st.bySymbol[symbol] ?? [];
      const mod = e.ctrlKey || e.metaKey;
      if (e.type !== "keydown") return;
      if (e.key === "Escape") {
        if (!controllerRef.current?.cancelDraft()) setTool("cursor");
        st.select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
        e.preventDefault();
        st.commit(symbol, list.filter((d) => d.id !== st.selectedId));
        st.select(null);
      } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        st.undo(symbol);
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        st.redo(symbol);
      } else if (mod && e.key.toLowerCase() === "d" && st.selectedId) {
        e.preventDefault();
        const d = list.find((x) => x.id === st.selectedId);
        if (d) {
          const copy = { ...d, id: crypto.randomUUID(), points: d.points.map((p) => ({ time: p.time + TIMEFRAME_SECONDS[tf] * 5, price: p.price })), createdAt: Date.now(), updatedAt: Date.now() };
          st.commit(symbol, [...list, copy]);
          st.select(copy.id);
        }
      } else if (e.altKey && !mod) {
        const map: Record<string, Parameters<typeof setTool>[0]> = { t: "trendline", h: "hline", v: "vline", f: "fib", r: "rect", c: "channel", l: "long", s: "short", m: "measure", p: "path", b: "brush", x: "text", a: "arrow", e: "ray" };
        const next = map[e.key.toLowerCase()] ?? map[e.code.replace("Key", "").toLowerCase()];
        if (next) {
          e.preventDefault();
          setTool(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [active, symbol, tf, setTool, props.readOnly]);

  const last = viewCandles[viewCandles.length - 1];
  const shown = legend ?? last;
  const prev = shown ? viewCandles[viewCandles.findIndex((x) => x.time === shown.time) - 1] : undefined;
  const chg = shown && prev ? ((shown.close - prev.close) / prev.close) * 100 : 0;

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", props.className)} onMouseDown={props.onActivate}>
      <div className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <span className="font-semibold text-fg">
          {symbol} · {tf}
        </span>
        {shown && (
          <span className="num flex gap-2 text-muted">
            <span>
              O <b className="font-medium text-fg">{formatPrice(shown.open)}</b>
            </span>
            <span>
              H <b className="font-medium text-fg">{formatPrice(shown.high)}</b>
            </span>
            <span>
              L <b className="font-medium text-fg">{formatPrice(shown.low)}</b>
            </span>
            <span>
              C <b className="font-medium text-fg">{formatPrice(shown.close)}</b>
            </span>
            <span className={chg >= 0 ? "text-bull" : "text-bear"}>
              {chg >= 0 ? "+" : ""}
              {chg.toFixed(2)}%
            </span>
            <span>V {formatCompact(shown.volume)}</span>
          </span>
        )}
        {feed.lastIsOpen && !replay.active && !staticCandles && <span className="hidden text-faint xl:inline">· {t("chart.forming")}</span>}
        {replay.active && active && <span className="rounded bg-warn-soft px-1.5 font-semibold text-warn">REPLAY</span>}
      </div>
      {feed.loadingMore && (
        <div className="absolute top-8 left-2 z-10 flex items-center gap-1 text-[11px] text-muted">
          <Loader2 size={12} className="animate-spin" /> {t("chart.loadingMore")}
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1" />
      {feed.status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel/60">
          <Loader2 className="animate-spin text-accent" />
        </div>
      )}
      {feed.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/80 text-sm">
          <p className="text-bear">{t("common.error")}</p>
          <p className="max-w-xs text-center text-xs text-muted">{feed.error}</p>
          <button className="rounded border border-line px-3 py-1 text-xs hover:bg-panel-2" onClick={feed.reload}>
            {t("common.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
