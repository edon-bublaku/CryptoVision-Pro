import type { Candle } from "@cv/core";
import type { IChartApi } from "lightweight-charts";
import type { CoordMapper } from "./coords";
import { DrawingsPrimitive, hitTest, positionPoints, type HitResult } from "./drawing-render";
import { defaultStyle, DRAWING_SCHEMA_VERSION, POINTS_REQUIRED, TEXT_TOOLS, type Drawing, type DrawingPoint, type Tool } from "./drawing-types";

export interface ControllerCallbacks {
  /** commit=true records an undo step; false is a live preview update. */
  onChange(drawings: Drawing[], commit: boolean): void;
  onCheckpoint(): void;
  onSelect(id: string | null): void;
  onToolDone(): void;
  onContextMenu(id: string, clientX: number, clientY: number): void;
  onEditText(id: string): void;
}

type DragState =
  | { mode: "handle"; id: string; index: number; startPoints: DrawingPoint[] }
  | { mode: "body"; id: string; startTime: number; startPrice: number; startPoints: DrawingPoint[] };

/**
 * Pointer/keyboard interaction for drawing tools. Listens in the capture phase on the chart
 * container so it can claim events (and stop the chart from panning) only when it needs them.
 */
export class DrawingController {
  private drawings: Drawing[] = [];
  private tool: Tool = "cursor";
  private magnet = true;
  private selectedId: string | null = null;
  private draft: Drawing | null = null;
  private drag: DragState | null = null;
  private brushing = false;
  private shift = false;
  private disposed = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly el: HTMLElement,
    private readonly chart: IChartApi,
    private readonly mapper: CoordMapper,
    private readonly layer: DrawingsPrimitive,
    private readonly candles: () => readonly Candle[],
    private readonly cb: ControllerCallbacks,
  ) {
    const opts = { capture: true, signal: this.abort.signal };
    el.addEventListener("pointerdown", this.onDown, opts);
    el.addEventListener("pointermove", this.onMove, opts);
    window.addEventListener("pointerup", this.onUp, { signal: this.abort.signal });
    el.addEventListener("dblclick", this.onDblClick, opts);
    el.addEventListener("contextmenu", this.onContext, opts);
    el.addEventListener("pointerleave", () => this.layer.update({ hoverId: null }), { signal: this.abort.signal });
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
  }

  setDrawings(d: Drawing[]) {
    this.drawings = d;
    if (this.selectedId && !d.some((x) => x.id === this.selectedId)) this.selectedId = null;
    this.layer.update({ drawings: d, selectedId: this.selectedId });
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    this.layer.update({ selectedId: id });
  }

  setTool(t: Tool) {
    this.tool = t;
    this.draft = null;
    this.layer.update({ preview: null });
    this.updateChartInteraction();
    this.el.style.cursor = t === "cursor" ? "" : "crosshair";
  }

  setMagnet(m: boolean) {
    this.magnet = m;
  }

  setShift(s: boolean) {
    this.shift = s;
  }

  /** Cancels an in-progress drawing; returns true if there was one. */
  cancelDraft(): boolean {
    if (!this.draft) return false;
    if (this.draft.type === "path" && this.draft.points.length > 2) {
      this.finishDraft(this.draft.points.slice(0, -1));
      return true;
    }
    this.draft = null;
    this.layer.update({ preview: null });
    return true;
  }

  private isDrawingTool() {
    return this.tool !== "cursor" && this.tool !== "crosshair";
  }

  private updateChartInteraction() {
    const lock = this.isDrawingTool() || this.drag !== null;
    this.chart.applyOptions({ handleScroll: !lock, handleScale: !lock });
  }

  private local(e: PointerEvent | MouseEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Converts pixels to a point, snapping to the nearest OHLC value when the magnet is on. */
  private toPoint(x: number, y: number, anchor?: DrawingPoint): DrawingPoint | null {
    const logical = this.mapper.xToLogical(x);
    let price = this.mapper.yToPrice(y);
    if (logical === null || price === null) return null;
    let time = this.mapper.logicalToTime(logical);
    if (this.magnet) {
      const cs = this.candles();
      const idx = Math.round(logical);
      const c = cs[idx];
      if (c) {
        let best: { p: number; d: number } | null = null;
        for (const p of [c.open, c.high, c.low, c.close]) {
          const py = this.mapper.priceToY(p);
          if (py === null) continue;
          const d = Math.abs(py - y);
          if (!best || d < best.d) best = { p, d };
        }
        if (best && best.d < 16) {
          price = best.p;
          time = c.time;
        }
      }
    }
    if (this.shift && anchor) price = anchor.price;
    return { time, price };
  }

  private hit(x: number, y: number): { d: Drawing; h: HitResult } | null {
    const env = this.layer.env();
    // Topmost first, and the selected drawing gets priority so its handles stay grabbable.
    const ordered = [...this.drawings].reverse().sort((a, b) => (a.id === this.selectedId ? -1 : b.id === this.selectedId ? 1 : 0));
    for (const d of ordered) {
      const h = hitTest(d, x, y, env, d.id === this.selectedId);
      if (h) return { d, h };
    }
    return null;
  }

  private newDrawing(type: Drawing["type"], points: DrawingPoint[]): Drawing {
    const now = Date.now();
    return { id: crypto.randomUUID(), type, points, style: defaultStyle(type), locked: false, visible: true, schemaVersion: DRAWING_SCHEMA_VERSION, createdAt: now, updatedAt: now };
  }

  private finishDraft(points: DrawingPoint[]) {
    if (!this.draft) return;
    let pts = points;
    if (this.draft.type === "long" || this.draft.type === "short") pts = positionPoints({ ...this.draft, points: pts.slice(0, 2) });
    const done: Drawing = { ...this.draft, points: pts };
    this.draft = null;
    this.layer.update({ preview: null });
    this.cb.onChange([...this.drawings, done], true);
    this.selectedId = done.id;
    this.cb.onSelect(done.id);
    this.cb.onToolDone();
    if (TEXT_TOOLS.includes(done.type)) this.cb.onEditText(done.id);
  }

  private onDown = (e: PointerEvent) => {
    if (this.disposed || e.button !== 0) return;
    const { x, y } = this.local(e);
    // Clicks on the price/time axes belong to the chart.
    const paneW = this.layer.env().width;
    if (paneW && x > paneW) return;

    if (this.isDrawingTool()) {
      e.stopPropagation();
      e.preventDefault();
      const type = this.tool as Drawing["type"];
      const anchor = this.draft?.points[this.draft.points.length - 2];
      const pt = this.toPoint(x, y, anchor);
      if (!pt) return;
      if (type === "brush") {
        this.brushing = true;
        this.draft = this.newDrawing("brush", [pt]);
        this.layer.update({ preview: this.draft });
        return;
      }
      const need = POINTS_REQUIRED[type];
      if (!this.draft) {
        this.draft = this.newDrawing(type, need === 1 ? [pt] : [pt, pt]);
        if (need === 1) this.finishDraft([pt]);
        else this.layer.update({ preview: this.draft });
        return;
      }
      // Fix the moving point and add a new floating one.
      const fixed = [...this.draft.points.slice(0, -1), pt];
      if (need > 0 && fixed.length >= need) this.finishDraft(fixed);
      else {
        this.draft = { ...this.draft, points: [...fixed, pt] };
        this.layer.update({ preview: this.draft });
      }
      return;
    }

    if (this.tool === "cursor" || this.tool === "crosshair") {
      const hit = this.hit(x, y);
      if (!hit) {
        if (this.selectedId) {
          this.selectedId = null;
          this.layer.update({ selectedId: null });
          this.cb.onSelect(null);
        }
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      this.selectedId = hit.d.id;
      this.layer.update({ selectedId: hit.d.id });
      this.cb.onSelect(hit.d.id);
      if (hit.d.locked) return;
      const p = this.toPoint(x, y);
      if (!p) return;
      this.cb.onCheckpoint();
      const startPoints = hit.d.type === "long" || hit.d.type === "short" ? positionPoints(hit.d) : hit.d.points;
      this.drag =
        hit.h.kind === "handle"
          ? { mode: "handle", id: hit.d.id, index: hit.h.index, startPoints }
          : { mode: "body", id: hit.d.id, startTime: this.mapper.xToLogical(x) ?? 0, startPrice: this.mapper.yToPrice(y) ?? p.price, startPoints };
      this.updateChartInteraction();
      this.el.setPointerCapture?.(e.pointerId);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.disposed) return;
    const { x, y } = this.local(e);
    if (this.draft) {
      const anchor = this.draft.points[this.draft.points.length - 2];
      const pt = this.toPoint(x, y, anchor);
      if (!pt) return;
      if (this.brushing) this.draft = { ...this.draft, points: [...this.draft.points, pt] };
      else this.draft = { ...this.draft, points: [...this.draft.points.slice(0, -1), pt] };
      this.layer.update({ preview: this.draft });
      return;
    }
    if (this.drag) {
      e.stopPropagation();
      const d = this.drawings.find((x) => x.id === this.drag!.id);
      if (!d) return;
      let points: DrawingPoint[];
      const drag = this.drag;
      if (drag.mode === "handle") {
        const pt = this.toPoint(x, y);
        if (!pt) return;
        points = drag.startPoints.map((p, i) => (i === drag.index ? pt : p));
        // Moving the entry of a position keeps stop/target in place; moving horizontally only for hline.
        if (d.type === "long" || d.type === "short") {
          if (drag.index === 1) points[1] = { time: pt.time, price: pt.price };
          if (drag.index === 2) points[2] = { time: drag.startPoints[2]!.time, price: pt.price };
        }
      } else {
        const l = this.mapper.xToLogical(x);
        const pr = this.mapper.yToPrice(y);
        if (l === null || pr === null) return;
        const dl = l - drag.startTime;
        const dp = pr - drag.startPrice;
        points = drag.startPoints.map((p) => ({ time: this.mapper.logicalToTime(this.mapper.timeToLogical(p.time) + dl), price: p.price + dp }));
      }
      const next = this.drawings.map((x) => (x.id === d.id ? { ...x, points, updatedAt: Date.now() } : x));
      this.drawings = next;
      this.layer.update({ drawings: next });
      this.cb.onChange(next, false);
      return;
    }
    if (this.tool === "cursor" || this.tool === "crosshair") {
      const hit = this.hit(x, y);
      const id = hit?.d.id ?? null;
      if (id !== this.layer.state.hoverId) this.layer.update({ hoverId: id });
      this.el.style.cursor = hit ? (hit.d.locked ? "not-allowed" : hit.h.kind === "handle" ? "grab" : "move") : "";
    }
  };

  private onUp = () => {
    if (this.brushing && this.draft) {
      this.brushing = false;
      const pts = this.draft.points.filter((_, i, arr) => i % 2 === 0 || i === arr.length - 1);
      if (pts.length > 1) this.finishDraft(pts);
      else {
        this.draft = null;
        this.layer.update({ preview: null });
      }
      return;
    }
    if (this.drag) {
      this.drag = null;
      this.updateChartInteraction();
      this.cb.onChange(this.drawings, false);
    }
  };

  private onDblClick = (e: MouseEvent) => {
    if (this.draft?.type === "path") {
      e.stopPropagation();
      const pts = this.draft.points.slice(0, -1);
      // The two clicks of the double-click each added a point; drop the duplicate.
      const dedup = pts.filter((p, i) => i === 0 || p.time !== pts[i - 1]!.time || p.price !== pts[i - 1]!.price);
      if (dedup.length >= 2) this.finishDraft(dedup);
      return;
    }
    const { x, y } = this.local(e);
    const hit = this.hit(x, y);
    if (hit && TEXT_TOOLS.includes(hit.d.type)) {
      e.stopPropagation();
      this.cb.onEditText(hit.d.id);
    }
  };

  private onContext = (e: MouseEvent) => {
    const { x, y } = this.local(e);
    if (this.draft) {
      e.preventDefault();
      e.stopPropagation();
      this.cancelDraft();
      return;
    }
    const hit = this.hit(x, y);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    this.selectedId = hit.d.id;
    this.layer.update({ selectedId: hit.d.id });
    this.cb.onSelect(hit.d.id);
    this.cb.onContextMenu(hit.d.id, e.clientX, e.clientY);
  };
}
