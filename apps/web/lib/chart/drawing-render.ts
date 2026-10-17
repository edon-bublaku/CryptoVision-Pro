import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { formatPrice } from "@cv/core";
import type { CoordMapper } from "./coords";
import type { Drawing, DrawingPoint } from "./drawing-types";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Ctx = CanvasRenderingContext2D;
interface P {
  x: number;
  y: number;
}

export type HitResult = { kind: "handle"; index: number } | { kind: "body" };

const HANDLE_R = 5;
const HIT_TOL = 6;

/** Position tools store [entry, stop, target]; the target is derived on creation. */
export function positionPoints(d: Drawing): DrawingPoint[] {
  if (d.points.length >= 3) return d.points;
  const [e, s] = d.points;
  if (!e || !s) return d.points;
  return [e, s, { time: s.time, price: e.price + 2 * (e.price - s.price) }];
}

function setDash(ctx: Ctx, dash: Drawing["style"]["dash"], width: number) {
  ctx.setLineDash(dash === "dashed" ? [6 * Math.max(1, width / 2), 4] : dash === "dotted" ? [1.5, 3] : []);
}

function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Extends segment a→b to the pane borders in the requested directions. */
function extend(a: P, b: P, w: number, h: number, left: boolean, right: boolean): [P, P] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [a, b];
  const big = (w + h) * 4;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const start = left ? { x: a.x - ux * big, y: a.y - uy * big } : a;
  const end = right ? { x: b.x + ux * big, y: b.y + uy * big } : b;
  return [start, end];
}

function line(ctx: Ctx, a: P, b: P) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function label(ctx: Ctx, text: string, x: number, y: number, color: string, opts: { align?: CanvasTextAlign; bg?: string; fg?: string; font?: number } = {}) {
  const font = opts.font ?? 11;
  ctx.font = `500 ${font}px var(--font-mono), ui-monospace, monospace`;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  const pad = 4;
  const bx = opts.align === "right" ? x - w - pad : opts.align === "center" ? x - w / 2 - pad : x - pad;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.roundRect(bx, y - font / 2 - 3, w + pad * 2, font + 6, 3);
    ctx.fill();
  }
  ctx.fillStyle = opts.fg ?? color;
  ctx.fillText(text, x, y);
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface RenderEnv {
  mapper: CoordMapper;
  width: number;
  height: number;
  /** Closes in the chart (for the regression channel). */
  candles?: () => readonly { time: number; close: number }[];
}

/** Least-squares line over closes between two times, with ±2σ of residuals. */
export function regressionOf(candles: readonly { time: number; close: number }[], t0: number, t1: number): { a: DrawingPoint; b: DrawingPoint; sigma: number } | null {
  const from = Math.min(t0, t1);
  const to = Math.max(t0, t1);
  const pts = candles.filter((c) => c.time >= from && c.time <= to);
  if (pts.length < 3) return null;
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  pts.forEach((c, i) => {
    sx += i;
    sy += c.close;
    sxx += i * i;
    sxy += i * c.close;
  });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const icpt = (sy - slope * sx) / n;
  let ss = 0;
  pts.forEach((c, i) => (ss += (c.close - (icpt + slope * i)) ** 2));
  return { a: { time: pts[0]!.time, price: icpt }, b: { time: pts[n - 1]!.time, price: icpt + slope * (n - 1) }, sigma: Math.sqrt(ss / n) };
}

const FIB_TIME = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const GANN = [
  [1, 8],
  [1, 4],
  [1, 3],
  [1, 2],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [8, 1],
] as const;
const WAVE_LABELS: Record<string, string[]> = {
  xabcd: ["X", "A", "B", "C", "D"],
  elliott: ["0", "1", "2", "3", "4", "5"],
  abc: ["0", "A", "B", "C"],
  headshoulders: ["", "LS", "", "H", "", "RS", ""],
};

/** Pixel points of a drawing, or null if any point can't be mapped (e.g. series not ready). */
export function toPixels(d: Drawing, env: RenderEnv): P[] | null {
  const pts = d.type === "long" || d.type === "short" ? positionPoints(d) : d.points;
  const out: P[] = [];
  for (const p of pts) {
    const x = env.mapper.timeToX(p.time);
    const y = env.mapper.priceToY(p.price);
    if (x === null || y === null) return null;
    out.push({ x, y });
  }
  return out;
}

/** Price along the line through two points at a given time (for channels / alerts). */
export function priceOnLine(a: DrawingPoint, b: DrawingPoint, t: number): number {
  if (b.time === a.time) return b.price;
  return a.price + ((b.price - a.price) * (t - a.time)) / (b.time - a.time);
}

/** Geometry used both to draw and to hit-test, so they never disagree. */
function segments(d: Drawing, px: P[], env: RenderEnv): [P, P][] {
  const { width: w, height: h } = env;
  const [a, b, c] = px;
  switch (d.type) {
    case "trendline":
    case "arrow":
      return a && b ? [extend(a, b, w, h, !!d.style.extendLeft, !!d.style.extendRight)] : [];
    case "ray":
      return a && b ? [extend(a, b, w, h, false, true)] : [];
    case "extended":
      return a && b ? [extend(a, b, w, h, true, true)] : [];
    case "hline":
      return a ? [[{ x: 0, y: a.y }, { x: w, y: a.y }]] : [];
    case "hray":
      return a ? [[a, { x: w, y: a.y }]] : [];
    case "vline":
      return a ? [[{ x: a.x, y: 0 }, { x: a.x, y: h }]] : [];
    case "channel": {
      if (!a || !b) return [];
      if (!c) return [[a, b]];
      const off = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      const a2 = { x: a.x, y: a.y + off };
      const b2 = { x: b.x, y: b.y + off };
      return [extend(a, b, w, h, !!d.style.extendLeft, !!d.style.extendRight), extend(a2, b2, w, h, !!d.style.extendLeft, !!d.style.extendRight)];
    }
    case "xabcd":
    case "elliott":
    case "abc":
    case "headshoulders":
    case "triangle":
    case "path":
    case "brush": {
      const segs: [P, P][] = [];
      for (let i = 1; i < px.length; i++) segs.push([px[i - 1]!, px[i]!]);
      if (d.type === "triangle" && px.length === 3) segs.push([px[2]!, px[0]!]);
      return segs;
    }
    case "callout":
      return a && b ? [[a, b]] : [];
    case "gannfan": {
      if (!a || !b) return [];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return GANN.map(([px, py]) => extend(a, { x: a.x + dx * px, y: a.y + dy * py }, w, h, false, true));
    }
    case "fibfan": {
      if (!a || !b) return [];
      const levels = d.style.fibLevels ?? [0.382, 0.5, 0.618];
      return [extend(a, b, w, h, false, true), ...levels.map((r) => extend(a, { x: b.x, y: b.y + (a.y - b.y) * r }, w, h, false, true))];
    }
    case "fibtime": {
      if (!a || !b || d.points.length < 2) return [];
      const [p0, p1] = d.points as [DrawingPoint, DrawingPoint];
      const step = p1.time - p0.time;
      const out: [P, P][] = [];
      for (const k of FIB_TIME) {
        const x = env.mapper.timeToX(p0.time + step * k);
        if (x !== null && x >= 0 && x <= w) out.push([{ x, y: 0 }, { x, y: h }]);
      }
      return out;
    }
    case "regression": {
      const reg = d.points.length >= 2 && env.candles ? regressionOf(env.candles(), d.points[0]!.time, d.points[1]!.time) : null;
      if (!reg) return a && b ? [[a, b]] : [];
      const line = (off: number): [P, P] | null => {
        const x1 = env.mapper.timeToX(reg.a.time);
        const x2 = env.mapper.timeToX(reg.b.time);
        const y1 = env.mapper.priceToY(reg.a.price + off);
        const y2 = env.mapper.priceToY(reg.b.price + off);
        return x1 === null || x2 === null || y1 === null || y2 === null ? null : extend({ x: x1, y: y1 }, { x: x2, y: y2 }, w, h, false, !!d.style.extendRight);
      };
      return [line(0), line(2 * reg.sigma), line(-2 * reg.sigma)].filter((x): x is [P, P] => !!x);
    }
    case "pitchfork": {
      if (!a || !b) return [];
      if (!c) return [[a, b]];
      const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
      const dx = m.x - a.x;
      const dy = m.y - a.y;
      return [extend(a, m, w, h, false, true), extend(b, { x: b.x + dx, y: b.y + dy }, w, h, false, true), extend(c, { x: c.x + dx, y: c.y + dy }, w, h, false, true), [b, c]];
    }
    default:
      return [];
  }
}

function fibLevels(d: Drawing, px: P[], env: RenderEnv): { ratio: number; y: number; price: number; x1: number; x2: number }[] {
  const pts = d.points;
  const levels = d.style.fibLevels ?? [];
  const out: { ratio: number; y: number; price: number; x1: number; x2: number }[] = [];
  if (d.type === "fib" && pts.length >= 2 && px.length >= 2) {
    const [p0, p1] = pts as [DrawingPoint, DrawingPoint];
    const x1 = Math.min(px[0]!.x, px[1]!.x);
    const x2 = d.style.extendRight ? env.width : Math.max(px[0]!.x, px[1]!.x);
    for (const r of levels) {
      const price = p1.price + (p0.price - p1.price) * r;
      const y = env.mapper.priceToY(price);
      if (y !== null) out.push({ ratio: r, y, price, x1, x2 });
    }
  }
  if (d.type === "fibext" && pts.length >= 3 && px.length >= 3) {
    const [a, b, c] = pts as [DrawingPoint, DrawingPoint, DrawingPoint];
    const x1 = px[2]!.x;
    const x2 = d.style.extendRight ? env.width : px[2]!.x + Math.max(80, Math.abs(px[1]!.x - px[0]!.x));
    for (const r of levels) {
      const price = c.price + (b.price - a.price) * r;
      const y = env.mapper.priceToY(price);
      if (y !== null) out.push({ ratio: r, y, price, x1, x2 });
    }
  }
  return out;
}

const FIB_COLORS: Record<string, string> = { "0": "#8b95a8", "0.236": "#f0475a", "0.382": "#f5a524", "0.5": "#16c784", "0.618": "#22d3ee", "0.786": "#4f8cff", "1": "#8b95a8", "1.618": "#a78bfa", "2.618": "#f472b6" };

export function hitTest(d: Drawing, x: number, y: number, env: RenderEnv, selected: boolean): HitResult | null {
  if (!d.visible) return null;
  const px = toPixels(d, env);
  if (!px) return null;
  const p = { x, y };
  if (selected || d.type === "long" || d.type === "short")
    for (let i = 0; i < px.length; i++) if (Math.hypot(px[i]!.x - x, px[i]!.y - y) <= HANDLE_R + 3) return { kind: "handle", index: i };
  for (const [a, b] of segments(d, px, env)) if (distToSegment(p, a, b) <= HIT_TOL) return { kind: "body" };
  const [a, b] = px;
  switch (d.type) {
    case "rect":
    case "measure": {
      if (!a || !b) return null;
      const inX = x >= Math.min(a.x, b.x) - HIT_TOL && x <= Math.max(a.x, b.x) + HIT_TOL;
      const inY = y >= Math.min(a.y, b.y) - HIT_TOL && y <= Math.max(a.y, b.y) + HIT_TOL;
      return inX && inY ? { kind: "body" } : null;
    }
    case "ellipse": {
      if (!a || !b) return null;
      const rx = Math.abs(b.x - a.x) / 2 || 1;
      const ry = Math.abs(b.y - a.y) / 2 || 1;
      const v = ((x - (a.x + b.x) / 2) / rx) ** 2 + ((y - (a.y + b.y) / 2) / ry) ** 2;
      return v <= 1.15 ? { kind: "body" } : null;
    }
    case "triangle":
      return px.length === 3 && pointInPolygon(p, px) ? { kind: "body" } : null;
    case "channel": {
      const segs = segments(d, px, env);
      if (segs.length === 2) {
        const [s1, s2] = segs as [[P, P], [P, P]];
        if (pointInPolygon(p, [s1[0], s1[1], s2[1], s2[0]])) return { kind: "body" };
      }
      return null;
    }
    case "fib":
    case "fibext":
      for (const l of fibLevels(d, px, env)) if (Math.abs(l.y - y) <= HIT_TOL && x >= l.x1 - HIT_TOL && x <= l.x2 + HIT_TOL) return { kind: "body" };
      return null;
    case "long":
    case "short": {
      const [e, s, t] = px;
      if (!e || !s || !t) return null;
      const x1 = e.x;
      const x2 = Math.max(s.x, e.x + 40);
      const top = Math.min(s.y, t.y);
      const bot = Math.max(s.y, t.y);
      return x >= x1 && x <= x2 && y >= top && y <= bot ? { kind: "body" } : null;
    }
    case "text": {
      if (!a) return null;
      const fs = d.style.fontSize ?? 14;
      const w = (d.style.text ?? "").length * fs * 0.6 + 12;
      return x >= a.x - 6 && x <= a.x + w && y >= a.y - fs && y <= a.y + fs ? { kind: "body" } : null;
    }
    case "callout": {
      if (!b) return null;
      const fs = d.style.fontSize ?? 13;
      const w = (d.style.text ?? "").length * fs * 0.6 + 20;
      return x >= b.x - 4 && x <= b.x + w && y >= b.y - fs - 6 && y <= b.y + 8 ? { kind: "body" } : null;
    }
    case "pricelabel":
      return a && x >= a.x && x <= a.x + 90 && y >= a.y - 22 && y <= a.y ? { kind: "body" } : null;
    case "daterange": {
      if (!a || !b) return null;
      const inX = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x);
      return inX && y >= Math.min(a.y, b.y) - HIT_TOL && y <= Math.max(a.y, b.y) + HIT_TOL ? { kind: "body" } : null;
    }
    default:
      return null;
  }
}

function drawOne(ctx: Ctx, d: Drawing, env: RenderEnv, selected: boolean, hovered: boolean) {
  if (!d.visible) return;
  const px = toPixels(d, env);
  if (!px || px.length === 0) return;
  const st = d.style;
  ctx.save();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = hovered || selected ? st.width + 0.75 : st.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  setDash(ctx, st.dash, st.width);
  const fill = withAlpha(st.color, st.fillOpacity);
  const [a, b, c] = px;

  switch (d.type) {
    case "trendline":
    case "ray":
    case "extended":
    case "hray":
    case "vline":
    case "path":
    case "brush":
    case "pitchfork":
      for (const [p1, p2] of segments(d, px, env)) line(ctx, p1, p2);
      break;
    case "hline":
      for (const [p1, p2] of segments(d, px, env)) line(ctx, p1, p2);
      label(ctx, formatPrice(d.points[0]!.price), env.width - 4, a!.y - 9, st.color, { align: "right" });
      break;
    case "arrow": {
      const segs = segments(d, px, env);
      for (const [p1, p2] of segs) line(ctx, p1, p2);
      if (a && b) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const L = 10 + st.width * 2;
        ctx.setLineDash([]);
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45));
        ctx.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "channel": {
      const segs = segments(d, px, env);
      if (segs.length === 2) {
        const [s1, s2] = segs as [[P, P], [P, P]];
        if (st.fill) {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(s1[0].x, s1[0].y);
          ctx.lineTo(s1[1].x, s1[1].y);
          ctx.lineTo(s2[1].x, s2[1].y);
          ctx.lineTo(s2[0].x, s2[0].y);
          ctx.closePath();
          ctx.fill();
        }
        line(ctx, s1[0], s1[1]);
        line(ctx, s2[0], s2[1]);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.6;
        line(ctx, { x: (s1[0].x + s2[0].x) / 2, y: (s1[0].y + s2[0].y) / 2 }, { x: (s1[1].x + s2[1].x) / 2, y: (s1[1].y + s2[1].y) / 2 });
        ctx.restore();
      } else for (const [p1, p2] of segs) line(ctx, p1, p2);
      break;
    }
    case "rect":
      if (a && b) {
        if (st.fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        }
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      break;
    case "ellipse":
      if (a && b) {
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        if (st.fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        ctx.stroke();
      }
      break;
    case "triangle":
      if (px.length === 3 && st.fill) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(a!.x, a!.y);
        ctx.lineTo(b!.x, b!.y);
        ctx.lineTo(c!.x, c!.y);
        ctx.closePath();
        ctx.fill();
      }
      for (const [p1, p2] of segments(d, px, env)) line(ctx, p1, p2);
      break;
    case "fib":
    case "fibext": {
      const levels = fibLevels(d, px, env);
      ctx.setLineDash([]);
      for (let i = 0; i < levels.length; i++) {
        const l = levels[i]!;
        const col = FIB_COLORS[String(l.ratio)] ?? st.color;
        if (st.fill && i > 0) {
          const prev = levels[i - 1]!;
          ctx.fillStyle = withAlpha(col, st.fillOpacity);
          ctx.fillRect(l.x1, Math.min(prev.y, l.y), l.x2 - l.x1, Math.abs(l.y - prev.y));
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = st.width;
        line(ctx, { x: l.x1, y: l.y }, { x: l.x2, y: l.y });
        label(ctx, `${l.ratio} (${formatPrice(l.price)})`, l.x1 + 4, l.y - 8, col, { font: 10 });
      }
      ctx.strokeStyle = withAlpha(st.color, 0.5);
      ctx.setLineDash([3, 3]);
      if (d.type === "fib" && a && b) line(ctx, a, b);
      if (d.type === "fibext" && a && b && c) {
        line(ctx, a, b);
        line(ctx, b, c);
      }
      if (d.type === "fibext" && px.length === 2 && a && b) line(ctx, a, b);
      break;
    }
    case "long":
    case "short": {
      const [e, s, t] = px;
      const pts = positionPoints(d);
      if (!e || !s || !t || pts.length < 3) break;
      const x1 = e.x;
      const x2 = Math.max(s.x, e.x + 40);
      const bull = getComputedStyle(document.documentElement).getPropertyValue("--bull").trim() || "#16c784";
      const bear = getComputedStyle(document.documentElement).getPropertyValue("--bear").trim() || "#f0475a";
      ctx.setLineDash([]);
      ctx.fillStyle = withAlpha(bull, 0.18);
      ctx.fillRect(x1, Math.min(e.y, t.y), x2 - x1, Math.abs(t.y - e.y));
      ctx.fillStyle = withAlpha(bear, 0.18);
      ctx.fillRect(x1, Math.min(e.y, s.y), x2 - x1, Math.abs(s.y - e.y));
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#8b95a8";
      line(ctx, { x: x1, y: e.y }, { x: x2, y: e.y });
      const [pe, ps, pt] = pts as [DrawingPoint, DrawingPoint, DrawingPoint];
      const risk = Math.abs(pe.price - ps.price);
      const rr = risk === 0 ? 0 : Math.abs(pt.price - pe.price) / risk;
      const tgtPct = ((pt.price - pe.price) / pe.price) * 100;
      const stopPct = ((ps.price - pe.price) / pe.price) * 100;
      const mid = (x1 + x2) / 2;
      label(ctx, `TP ${formatPrice(pt.price)} (${tgtPct >= 0 ? "+" : ""}${tgtPct.toFixed(2)}%)`, mid, t.y + (t.y < e.y ? -10 : 10), bull, { align: "center", bg: bull, fg: "#fff", font: 10 });
      label(ctx, `SL ${formatPrice(ps.price)} (${stopPct >= 0 ? "+" : ""}${stopPct.toFixed(2)}%)`, mid, s.y + (s.y > e.y ? 10 : -10), bear, { align: "center", bg: bear, fg: "#fff", font: 10 });
      label(ctx, `${pe.price > ps.price ? "LONG" : "SHORT"} · R:R ${rr.toFixed(2)}`, mid, e.y, "#e7ebf3", { align: "center", bg: "rgba(16,20,28,0.85)", font: 10 });
      break;
    }
    case "measure":
      if (a && b && d.points.length >= 2) {
        const [p0, p1] = d.points as [DrawingPoint, DrawingPoint];
        const up = p1.price >= p0.price;
        const col = up ? getComputedStyle(document.documentElement).getPropertyValue("--bull").trim() || "#16c784" : getComputedStyle(document.documentElement).getPropertyValue("--bear").trim() || "#f0475a";
        ctx.fillStyle = withAlpha(col, 0.15);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        line(ctx, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
        line(ctx, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
        const dp = p1.price - p0.price;
        const pct = (dp / p0.price) * 100;
        const bars = Math.round(env.mapper.timeToLogical(p1.time) - env.mapper.timeToLogical(p0.time));
        const secs = Math.abs(p1.time - p0.time);
        const dur = secs >= 86400 ? `${(secs / 86400).toFixed(1)}d` : `${(secs / 3600).toFixed(1)}h`;
        label(ctx, `${dp >= 0 ? "+" : ""}${formatPrice(dp)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · ${bars} bars · ${dur}`, (a.x + b.x) / 2, Math.max(a.y, b.y) + 14, col, { align: "center", bg: col, fg: "#fff", font: 10 });
      }
      break;
    case "xabcd":
    case "elliott":
    case "abc":
    case "headshoulders": {
      if (st.fill && d.type === "xabcd" && px.length >= 3) {
        ctx.fillStyle = fill;
        for (const tri of [px.slice(0, 3), px.slice(2, 5)]) {
          if (tri.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(tri[0]!.x, tri[0]!.y);
          ctx.lineTo(tri[1]!.x, tri[1]!.y);
          ctx.lineTo(tri[2]!.x, tri[2]!.y);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (d.type === "headshoulders" && px.length >= 5) {
        // Neckline through the two troughs, extended.
        const [, , t1, , t2] = px;
        ctx.save();
        ctx.setLineDash([5, 4]);
        const [n1, n2] = extend(t1!, t2!, env.width, env.height, true, true);
        line(ctx, n1, n2);
        ctx.restore();
      }
      for (const [p1, p2] of segments(d, px, env)) line(ctx, p1, p2);
      const labels = WAVE_LABELS[d.type] ?? [];
      px.forEach((p, i) => {
        const lbl = labels[i];
        if (!lbl) return;
        const prev = px[i - 1];
        const next = px[i + 1];
        const isHigh = (prev ? p.y <= prev.y : true) && (next ? p.y <= next.y : true);
        label(ctx, d.type === "elliott" || d.type === "abc" ? `(${lbl})` : lbl, p.x, p.y + (isHigh ? -14 : 14), st.color, { align: "center", font: 11 });
      });
      if (d.type === "xabcd" && d.points.length >= 5) {
        const [X, A, B, C, D] = d.points as DrawingPoint[];
        const r = (num: number, den: number) => (den === 0 ? "—" : Math.abs(num / den).toFixed(3));
        const tags: [P, P, string][] = [
          [px[0]!, px[2]!, r(B!.price - A!.price, A!.price - X!.price)],
          [px[1]!, px[3]!, r(C!.price - B!.price, B!.price - A!.price)],
          [px[2]!, px[4]!, r(D!.price - C!.price, C!.price - B!.price)],
          [px[0]!, px[4]!, r(D!.price - A!.price, A!.price - X!.price)],
        ];
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.globalAlpha = 0.6;
        for (const [p1, p2, txt] of tags) {
          line(ctx, p1, p2);
          label(ctx, txt, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, st.color, { align: "center", bg: "rgba(10,14,24,0.85)", font: 10 });
        }
        ctx.restore();
      }
      if (d.type === "elliott" && px.length < 6 && px.length > 1) {
        /* in-progress preview: lines only */
      }
      break;
    }
    case "gannfan":
    case "fibfan": {
      const segs = segments(d, px, env);
      segs.forEach(([p1, p2], i) => {
        ctx.globalAlpha = d.type === "gannfan" && i === 4 ? 1 : 0.75;
        line(ctx, p1, p2);
      });
      ctx.globalAlpha = 1;
      if (d.type === "gannfan") GANN.forEach(([gx, gy], i) => segs[i] && label(ctx, `${gx}×${gy}`, segs[i]![0].x + (segs[i]![1].x - segs[i]![0].x) * 0.08, segs[i]![0].y + (segs[i]![1].y - segs[i]![0].y) * 0.08, st.color, { font: 9 }));
      if (d.type === "fibfan") (st.fibLevels ?? []).forEach((r, i) => segs[i + 1] && label(ctx, String(r), segs[i + 1]![0].x + (segs[i + 1]![1].x - segs[i + 1]![0].x) * 0.1, segs[i + 1]![0].y + (segs[i + 1]![1].y - segs[i + 1]![0].y) * 0.1, st.color, { font: 9 }));
      break;
    }
    case "fibtime": {
      const segs = segments(d, px, env);
      segs.forEach(([p1, p2], i) => {
        line(ctx, p1, p2);
        label(ctx, String(FIB_TIME[i] ?? ""), p1.x + 3, 12, st.color, { font: 10 });
      });
      break;
    }
    case "regression": {
      const segs = segments(d, px, env);
      if (segs.length === 3 && st.fill) {
        const [, up, dn] = segs as [[P, P], [P, P], [P, P]];
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(up[0].x, up[0].y);
        ctx.lineTo(up[1].x, up[1].y);
        ctx.lineTo(dn[1].x, dn[1].y);
        ctx.lineTo(dn[0].x, dn[0].y);
        ctx.closePath();
        ctx.fill();
      }
      segs.forEach(([p1, p2], i) => {
        ctx.save();
        if (i > 0) ctx.setLineDash([5, 4]);
        line(ctx, p1, p2);
        ctx.restore();
      });
      if (segs.length === 3) label(ctx, "±2σ", segs[1]![1].x - 4, segs[1]![1].y - 10, st.color, { align: "right", font: 10 });
      break;
    }
    case "callout":
      if (a && b) {
        const fs = st.fontSize ?? 13;
        ctx.setLineDash([]);
        line(ctx, a, b);
        ctx.beginPath();
        ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.font = `600 ${fs}px var(--font-inter), system-ui, sans-serif`;
        const tw = ctx.measureText(st.text ?? "").width;
        ctx.fillStyle = withAlpha(st.color, st.fillOpacity);
        ctx.beginPath();
        ctx.roundRect(b.x - 4, b.y - fs - 6, tw + 20, fs + 14, 8);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(st.text ?? "", b.x + 6, b.y - fs / 2 + 1);
      }
      break;
    case "pricelabel":
      if (a) {
        const txt = formatPrice(d.points[0]!.price);
        ctx.font = "600 11px var(--font-mono), ui-monospace, monospace";
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + 8, a.y - 8);
        ctx.lineTo(a.x + 8, a.y - 20);
        ctx.lineTo(a.x + tw + 20, a.y - 20);
        ctx.lineTo(a.x + tw + 20, a.y + 0);
        ctx.lineTo(a.x + 8, a.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#060911";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(txt, a.x + 13, a.y - 10);
      }
      break;
    case "daterange":
      if (a && b && d.points.length >= 2) {
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        ctx.fillStyle = fill;
        ctx.fillRect(x1, 0, x2 - x1, env.height);
        ctx.setLineDash([]);
        line(ctx, { x: x1, y: 0 }, { x: x1, y: env.height });
        line(ctx, { x: x2, y: 0 }, { x: x2, y: env.height });
        const [p0, p1] = d.points as [DrawingPoint, DrawingPoint];
        const bars = Math.round(Math.abs(env.mapper.timeToLogical(p1.time) - env.mapper.timeToLogical(p0.time)));
        const secs = Math.abs(p1.time - p0.time);
        const dur = secs >= 86400 ? `${(secs / 86400).toFixed(1)}d` : `${(secs / 3600).toFixed(1)}h`;
        label(ctx, `${bars} bars · ${dur}`, (x1 + x2) / 2, Math.min(a.y, b.y) - 12, st.color, { align: "center", bg: st.color, fg: "#fff", font: 10 });
      }
      break;
    case "text":
      if (a) {
        const fs = st.fontSize ?? 14;
        ctx.font = `600 ${fs}px var(--font-inter), system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        if (st.fill) {
          const w = ctx.measureText(st.text ?? "").width;
          ctx.fillStyle = withAlpha(st.color, 0.15);
          ctx.fillRect(a.x - 6, a.y - fs / 2 - 5, w + 12, fs + 10);
        }
        ctx.fillStyle = st.color;
        ctx.fillText(st.text ?? "", a.x, a.y);
      }
      break;
  }

  if (selected || hovered) {
    ctx.setLineDash([]);
    for (const p of px) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#ffffff" : withAlpha("#ffffff", 0.7);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = st.color;
      ctx.stroke();
    }
  }
  if (d.locked && selected && a) label(ctx, "🔒", a.x + 8, a.y - 12, st.color, { font: 10 });
  ctx.restore();
}

export interface DrawingLayerState {
  drawings: Drawing[];
  preview: Drawing | null;
  selectedId: string | null;
  hoverId: string | null;
}

/** Lightweight Charts series primitive that renders every drawing for the active symbol. */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  state: DrawingLayerState = { drawings: [], preview: null, selectedId: null, hoverId: null };
  private requestUpdate: (() => void) | null = null;
  private size = { width: 0, height: 0 };
  private readonly views: IPrimitivePaneView[];

  constructor(
    private readonly mapper: CoordMapper,
    private readonly candles?: () => readonly { time: number; close: number }[],
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: Target) => {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          this.size = { width: mediaSize.width, height: mediaSize.height };
          const env: RenderEnv = { mapper: this.mapper, width: mediaSize.width, height: mediaSize.height, candles: this.candles };
          for (const d of this.state.drawings) drawOne(context, d, env, d.id === this.state.selectedId, d.id === this.state.hoverId);
          if (this.state.preview) drawOne(context, this.state.preview, env, false, true);
        });
      },
    };
    this.views = [{ renderer: () => renderer, zOrder: () => "top" }];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  update(patch: Partial<DrawingLayerState>) {
    this.state = { ...this.state, ...patch };
    this.requestUpdate?.();
  }

  env(): RenderEnv {
    return { mapper: this.mapper, width: this.size.width, height: this.size.height, candles: this.candles };
  }
}
