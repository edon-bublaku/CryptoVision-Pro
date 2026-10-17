import type { Candle } from "@cv/core";
import { TIMEFRAME_SECONDS, type Timeframe } from "@cv/core";
import * as I from "@cv/indicators";

export interface IndicatorLine {
  key: string;
  color: string;
  values: number[];
  kind?: "line" | "histogram" | "dots";
  width?: number;
  /** Per-point colours (histogram bars, SuperTrend direction). */
  colors?: (string | undefined)[];
  /** Shift forward by N bars (Ichimoku spans). */
  shift?: number;
  dashed?: boolean;
}

export interface IndicatorOutput {
  lines: IndicatorLine[];
  /** Horizontal reference levels for oscillators. */
  levels?: number[];
  /** Fill between two line keys (bands / cloud). */
  fill?: { upper: string; lower: string; color: string };
}

export interface IndicatorDef {
  id: string;
  label: string;
  placement: "overlay" | "pane" | "volume";
  group: "trend" | "momentum" | "volatility" | "volume";
  compute(c: readonly Candle[], ctx: { bull: string; bear: string }): IndicatorOutput;
}

const C = { amber: "#f5a524", blue: "#4f8cff", violet: "#a78bfa", cyan: "#22d3ee", pink: "#f472b6", grey: "#8b95a8", white: "#e7ebf3", green: "#16c784", red: "#f0475a" };
const close = (c: readonly Candle[]) => c.map((x) => x.close);

export const INDICATORS: IndicatorDef[] = [
  { id: "ema20", label: "EMA 20", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "ema20", color: C.amber, values: I.ema(close(c), 20), width: 1 }] }) },
  { id: "ema50", label: "EMA 50", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "ema50", color: C.blue, values: I.ema(close(c), 50), width: 1 }] }) },
  { id: "ema200", label: "EMA 200", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "ema200", color: C.violet, values: I.ema(close(c), 200), width: 2 }] }) },
  { id: "sma50", label: "SMA 50", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "sma50", color: C.cyan, values: I.sma(close(c), 50), width: 1 }] }) },
  { id: "hma55", label: "Hull MA 55", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "hma", color: C.pink, values: I.hma(close(c), 55), width: 2 }] }) },
  {
    id: "vwap",
    label: "VWAP (session)",
    placement: "overlay",
    group: "volume",
    compute: (c) => {
      const v = I.vwap(c);
      return { lines: [{ key: "vwap", color: C.cyan, values: v.vwap, width: 2 }, { key: "vwapU", color: C.cyan, values: v.upper, width: 1, dashed: true }, { key: "vwapL", color: C.cyan, values: v.lower, width: 1, dashed: true }] };
    },
  },
  {
    id: "bb",
    label: "Bollinger Bands (20, 2)",
    placement: "overlay",
    group: "volatility",
    compute: (c) => {
      const b = I.bollinger(close(c), 20, 2);
      return { lines: [{ key: "bbU", color: C.blue, values: b.upper, width: 1 }, { key: "bbM", color: C.grey, values: b.middle, width: 1, dashed: true }, { key: "bbL", color: C.blue, values: b.lower, width: 1 }] };
    },
  },
  {
    id: "keltner",
    label: "Keltner Channels",
    placement: "overlay",
    group: "volatility",
    compute: (c) => {
      const k = I.keltner(c);
      return { lines: [{ key: "kcU", color: C.pink, values: k.upper, width: 1 }, { key: "kcM", color: C.grey, values: k.middle, width: 1, dashed: true }, { key: "kcL", color: C.pink, values: k.lower, width: 1 }] };
    },
  },
  {
    id: "donchian",
    label: "Donchian (20)",
    placement: "overlay",
    group: "volatility",
    compute: (c) => {
      const d = I.donchian(c, 20);
      return { lines: [{ key: "dcU", color: C.green, values: d.upper, width: 1 }, { key: "dcL", color: C.red, values: d.lower, width: 1 }] };
    },
  },
  {
    id: "supertrend",
    label: "SuperTrend (10, 3)",
    placement: "overlay",
    group: "trend",
    compute: (c, k) => {
      const s = I.supertrend(c, 10, 3);
      return { lines: [{ key: "st", color: k.bull, values: s.line, width: 2, colors: s.direction.map((d) => (d > 0 ? k.bull : d < 0 ? k.bear : undefined)) }] };
    },
  },
  { id: "psar", label: "Parabolic SAR", placement: "overlay", group: "trend", compute: (c) => ({ lines: [{ key: "psar", color: C.white, values: I.psar(c), kind: "dots" }] }) },
  {
    id: "ichimoku",
    label: "Ichimoku Cloud",
    placement: "overlay",
    group: "trend",
    compute: (c, k) => {
      const ich = I.ichimoku(c);
      return {
        lines: [
          { key: "tenkan", color: C.blue, values: ich.tenkan, width: 1 },
          { key: "kijun", color: C.red, values: ich.kijun, width: 1 },
          { key: "spanA", color: k.bull, values: ich.spanA, width: 1, shift: ich.displacement },
          { key: "spanB", color: k.bear, values: ich.spanB, width: 1, shift: ich.displacement },
        ],
      };
    },
  },
  { id: "volume", label: "Volume", placement: "volume", group: "volume", compute: () => ({ lines: [] }) },
  { id: "rsi", label: "RSI (14)", placement: "pane", group: "momentum", compute: (c) => ({ lines: [{ key: "rsi", color: C.violet, values: I.rsi(close(c), 14), width: 2 }], levels: [70, 50, 30] }) },
  {
    id: "macd",
    label: "MACD (12, 26, 9)",
    placement: "pane",
    group: "momentum",
    compute: (c, k) => {
      const m = I.macd(close(c));
      return {
        lines: [
          { key: "hist", color: C.grey, values: m.histogram, kind: "histogram", colors: m.histogram.map((v, i) => (v >= 0 ? (v >= (m.histogram[i - 1] ?? 0) ? k.bull : `${k.bull}88`) : v <= (m.histogram[i - 1] ?? 0) ? k.bear : `${k.bear}88`)) },
          { key: "macd", color: C.blue, values: m.macd, width: 2 },
          { key: "signal", color: C.amber, values: m.signal, width: 1 },
        ],
        levels: [0],
      };
    },
  },
  {
    id: "stochrsi",
    label: "Stoch RSI",
    placement: "pane",
    group: "momentum",
    compute: (c) => {
      const s = I.stochRsi(close(c));
      return { lines: [{ key: "k", color: C.blue, values: s.k, width: 2 }, { key: "d", color: C.amber, values: s.d, width: 1 }], levels: [80, 20] };
    },
  },
  {
    id: "adx",
    label: "ADX / DMI",
    placement: "pane",
    group: "trend",
    compute: (c, k) => {
      const a = I.adx(c);
      return { lines: [{ key: "adx", color: C.white, values: a.adx, width: 2 }, { key: "pdi", color: k.bull, values: a.plusDI, width: 1 }, { key: "mdi", color: k.bear, values: a.minusDI, width: 1 }], levels: [25] };
    },
  },
  { id: "atr", label: "ATR (14)", placement: "pane", group: "volatility", compute: (c) => ({ lines: [{ key: "atr", color: C.pink, values: I.atr(c, 14), width: 2 }] }) },
  { id: "obv", label: "OBV", placement: "pane", group: "volume", compute: (c) => ({ lines: [{ key: "obv", color: C.cyan, values: I.obv(c), width: 2 }, { key: "obvE", color: C.amber, values: I.ema(I.obv(c), 20), width: 1 }] }) },
  { id: "cvd", label: "CVD (Δ volum)", placement: "pane", group: "volume", compute: (c) => ({ lines: [{ key: "cvd", color: C.green, values: I.cvd(c), width: 2 }] }) },
  {
    id: "cmf",
    label: "Chaikin Money Flow",
    placement: "pane",
    group: "volume",
    compute: (c, k) => {
      const v = I.cmf(c);
      return { lines: [{ key: "cmf", color: C.grey, values: v, kind: "histogram", colors: v.map((x) => (x >= 0 ? k.bull : k.bear)) }], levels: [0] };
    },
  },
  { id: "mfi", label: "MFI (14)", placement: "pane", group: "volume", compute: (c) => ({ lines: [{ key: "mfi", color: C.amber, values: I.mfi(c), width: 2 }], levels: [80, 20] }) },
  { id: "cci", label: "CCI (20)", placement: "pane", group: "momentum", compute: (c) => ({ lines: [{ key: "cci", color: C.cyan, values: I.cci(c), width: 2 }], levels: [100, 0, -100] }) },
  { id: "willr", label: "Williams %R", placement: "pane", group: "momentum", compute: (c) => ({ lines: [{ key: "wr", color: C.pink, values: I.williamsR(c), width: 2 }], levels: [-20, -80] }) },
  {
    id: "tsi",
    label: "TSI",
    placement: "pane",
    group: "momentum",
    compute: (c) => {
      const t = I.tsi(close(c));
      return { lines: [{ key: "tsi", color: C.blue, values: t.tsi, width: 2 }, { key: "tsiS", color: C.amber, values: t.signal, width: 1 }], levels: [0] };
    },
  },
];

export const OVERLAYS = [
  { id: "signal", label: "Sinjali + plani (entry/SL/TP)" },
  { id: "levels", label: "Support / Resistance automatike" },
  { id: "structure", label: "Struktura: BOS / CHoCH" },
  { id: "zones", label: "Order Blocks + FVG" },
  { id: "divergence", label: "Divergjencat RSI" },
  { id: "patterns", label: "Modelet e qirinjve" },
  { id: "profile", label: "Volume Profile (VPVR)" },
  { id: "fib", label: "Fibonacci automatik" },
  { id: "pivots", label: "Pivot Points (ditore)" },
] as const;

export function futureTimes(last: number, tf: Timeframe, n: number): number[] {
  const s = TIMEFRAME_SECONDS[tf];
  return Array.from({ length: n }, (_, i) => last + (i + 1) * s);
}
