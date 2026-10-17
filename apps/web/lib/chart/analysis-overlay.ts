import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { formatPrice, type TradePlan } from "@cv/core";
import type { VolumeProfile } from "@cv/indicators";
import type { CoordMapper } from "./coords";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface OverlayZone {
  from: number;
  /** null = extends to the right edge */
  to: number | null;
  top: number;
  bottom: number;
  bullish: boolean;
  label: string;
}

export interface OverlayState {
  zones: OverlayZone[];
  plan: { plan: TradePlan; from: number; to: number } | null;
  profile: VolumeProfile | null;
  divergences: { from: { time: number; price: number }; to: { time: number; price: number }; bullish: boolean }[];
  colors: { bull: string; bear: string; muted: string };
}

function rgba(hex: string, a: number) {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Renders auto-analysis that price lines and markers can't express: zones, plan box, volume profile. */
export class AnalysisOverlay implements ISeriesPrimitive<Time> {
  state: OverlayState = { zones: [], plan: null, profile: null, divergences: [], colors: { bull: "#16c784", bear: "#f0475a", muted: "#8b95a8" } };
  private requestUpdate: (() => void) | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor(private readonly mapper: CoordMapper) {
    const bg: IPrimitivePaneRenderer = { draw: () => {}, drawBackground: (t: Target) => this.drawBackground(t) };
    const fg: IPrimitivePaneRenderer = { draw: (t: Target) => this.drawForeground(t) };
    this.views = [
      { renderer: () => bg, zOrder: () => "bottom" },
      { renderer: () => fg, zOrder: () => "normal" },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.requestUpdate = null;
  }
  paneViews() {
    return this.views;
  }
  update(patch: Partial<OverlayState>) {
    this.state = { ...this.state, ...patch };
    this.requestUpdate?.();
  }

  private drawBackground(target: Target) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { bull, bear, muted } = this.state.colors;
      for (const z of this.state.zones) {
        const x1 = this.mapper.timeToX(z.from);
        const x2 = z.to === null ? mediaSize.width : this.mapper.timeToX(z.to);
        const y1 = this.mapper.priceToY(z.top);
        const y2 = this.mapper.priceToY(z.bottom);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        const col = z.bullish ? bull : bear;
        ctx.fillStyle = rgba(col, z.to === null ? 0.13 : 0.06);
        ctx.fillRect(x1, y1, Math.max(1, x2 - x1), y2 - y1);
        ctx.strokeStyle = rgba(col, 0.35);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x1, y1, Math.max(1, x2 - x1), y2 - y1);
        ctx.setLineDash([]);
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.fillStyle = rgba(col, 0.85);
        ctx.textBaseline = "top";
        ctx.fillText(z.label, x1 + 3, Math.min(y1, y2) + 2);
      }

      const vp = this.state.profile;
      if (vp) {
        const maxV = Math.max(...vp.bins.map((b) => b.volume));
        const maxW = mediaSize.width * 0.18;
        for (const b of vp.bins) {
          const y1 = this.mapper.priceToY(b.priceHigh);
          const y2 = this.mapper.priceToY(b.priceLow);
          if (y1 === null || y2 === null) continue;
          const w = (b.volume / maxV) * maxW;
          const wb = (b.buyVolume / maxV) * maxW;
          const inVa = b.priceLow >= vp.val - 1e-12 && b.priceHigh <= vp.vah + 1e-12;
          const h = Math.max(1, y2 - y1 - 1);
          ctx.fillStyle = rgba(bull, inVa ? 0.28 : 0.12);
          ctx.fillRect(mediaSize.width - wb, y1, wb, h);
          ctx.fillStyle = rgba(bear, inVa ? 0.28 : 0.12);
          ctx.fillRect(mediaSize.width - w, y1, w - wb, h);
        }
        const py = this.mapper.priceToY(vp.poc);
        if (py !== null) {
          ctx.strokeStyle = rgba(muted, 0.9);
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(mediaSize.width - maxW - 10, py);
          ctx.lineTo(mediaSize.width, py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "600 9px ui-monospace, monospace";
          ctx.fillStyle = muted;
          ctx.textAlign = "right";
          ctx.fillText(`POC ${formatPrice(vp.poc)}`, mediaSize.width - maxW - 12, py - 6);
          ctx.textAlign = "left";
        }
      }
    });
  }

  private drawForeground(target: Target) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const { bull, bear } = this.state.colors;
      for (const d of this.state.divergences) {
        const x1 = this.mapper.timeToX(d.from.time);
        const x2 = this.mapper.timeToX(d.to.time);
        const y1 = this.mapper.priceToY(d.from.price);
        const y2 = this.mapper.priceToY(d.to.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        ctx.strokeStyle = d.bullish ? bull : bear;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const p = this.state.plan;
      if (!p) return;
      const x1 = this.mapper.timeToX(p.from);
      const x2 = this.mapper.timeToX(p.to);
      const ye = this.mapper.priceToY(p.plan.entry);
      const ys = this.mapper.priceToY(p.plan.stopLoss);
      if (x1 === null || x2 === null || ye === null || ys === null) return;
      const w = Math.max(30, x2 - x1);
      ctx.fillStyle = rgba(bear, 0.16);
      ctx.fillRect(x1, Math.min(ye, ys), w, Math.abs(ys - ye));
      let prevY = ye;
      p.plan.takeProfits.forEach((tp, i) => {
        const y = this.mapper.priceToY(tp.price);
        if (y === null) return;
        ctx.fillStyle = rgba(bull, 0.1 + 0.05 * (2 - i));
        ctx.fillRect(x1, Math.min(prevY, y), w, Math.abs(y - prevY));
        ctx.strokeStyle = rgba(bull, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x1 + w, y);
        ctx.stroke();
        ctx.font = "600 10px ui-monospace, monospace";
        ctx.fillStyle = bull;
        ctx.textBaseline = "middle";
        ctx.fillText(`TP${i + 1} ${formatPrice(tp.price)} · ${tp.rr}R`, x1 + w + 4, y);
        prevY = y;
      });
      ctx.strokeStyle = rgba(bear, 0.9);
      ctx.beginPath();
      ctx.moveTo(x1, ys);
      ctx.lineTo(x1 + w, ys);
      ctx.stroke();
      ctx.fillStyle = bear;
      ctx.fillText(`SL ${formatPrice(p.plan.stopLoss)} (−${p.plan.stopPct}%)`, x1 + w + 4, ys);
      ctx.strokeStyle = "rgba(231,235,243,0.8)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, ye);
      ctx.lineTo(x1 + w, ye);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(231,235,243,0.95)";
      ctx.fillText(`${p.plan.side} ${formatPrice(p.plan.entry)}`, x1 + w + 4, ye);
    });
  }
}
