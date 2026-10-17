"use client";

import type { Timeframe } from "@cv/core";
import { TIMEFRAME_SECONDS } from "@cv/core";
import {
  ArrowUpRight,
  Bell,
  Brush,
  ChevronRight,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  GitFork,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  MoveDiagonal,
  MoveHorizontal,
  MoveVertical,
  Pencil,
  RectangleHorizontal,
  Ruler,
  Spline,
  Circle,
  Trash2,
  Triangle,
  TrendingDown,
  TrendingUp,
  Type,
  Unlock,
  Waypoints,
  Rows3,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { priceOnLine } from "@/lib/chart/drawing-render";
import { PALETTE, type Drawing, type Tool } from "@/lib/chart/drawing-types";
import { useT } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { useChartUi } from "@/lib/store/chart-ui";
import { useDrawings } from "@/lib/store/drawings";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { toast } from "../ui/toast";

interface ToolDef {
  id: Tool;
  icon: LucideIcon;
  hotkey?: string;
}

const EMPTY: Drawing[] = [];

const GROUPS: { id: string; tools: ToolDef[] }[] = [
  {
    id: "lines",
    tools: [
      { id: "trendline", icon: MoveDiagonal, hotkey: "Alt+T" },
      { id: "ray", icon: ArrowUpRight, hotkey: "Alt+E" },
      { id: "extended", icon: Spline },
      { id: "hline", icon: Minus, hotkey: "Alt+H" },
      { id: "hray", icon: MoveHorizontal },
      { id: "vline", icon: MoveVertical, hotkey: "Alt+V" },
      { id: "channel", icon: Rows3, hotkey: "Alt+C" },
      { id: "pitchfork", icon: GitFork },
    ],
  },
  {
    id: "fib",
    tools: [
      { id: "fib", icon: Waypoints, hotkey: "Alt+F" },
      { id: "fibext", icon: Waypoints },
    ],
  },
  {
    id: "shapes",
    tools: [
      { id: "rect", icon: RectangleHorizontal, hotkey: "Alt+R" },
      { id: "ellipse", icon: Circle },
      { id: "triangle", icon: Triangle },
      { id: "path", icon: Pencil, hotkey: "Alt+P" },
      { id: "brush", icon: Brush, hotkey: "Alt+B" },
      { id: "arrow", icon: ArrowUpRight, hotkey: "Alt+A" },
    ],
  },
  {
    id: "trading",
    tools: [
      { id: "long", icon: TrendingUp, hotkey: "Alt+L" },
      { id: "short", icon: TrendingDown, hotkey: "Alt+S" },
      { id: "measure", icon: Ruler, hotkey: "Alt+M" },
    ],
  },
  { id: "annot", tools: [{ id: "text", icon: Type, hotkey: "Alt+X" }] },
];

/** Vertical drawing toolbar with flyout groups (remembers the last tool used per group). */
export function DrawingToolbar({ symbol }: { symbol: string }) {
  const t = useT();
  const tool = useChartUi((s) => s.tool);
  const setTool = useChartUi((s) => s.setTool);
  const stay = useChartUi((s) => s.stayInTool);
  const setStay = useChartUi((s) => s.setStay);
  const hidden = useChartUi((s) => s.drawingsHidden);
  const setHidden = useChartUi((s) => s.setDrawingsHidden);
  const magnet = useSettings((s) => s.chart.magnet);
  const setChart = useSettings((s) => s.setChart);
  const drawings = useDrawings((s) => s.bySymbol[symbol] ?? EMPTY);
  const commit = useDrawings((s) => s.commit);
  const [open, setOpen] = useState<string | null>(null);
  const [lastInGroup, setLastInGroup] = useState<Record<string, Tool>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const btn = "relative flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg";

  return (
    <div ref={ref} className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-1.5" role="toolbar" aria-label={t("chart.drawings")}>
      <button className={cn(btn, tool === "cursor" && "bg-accent-soft text-accent")} title={t("tool.cursor")} onClick={() => setTool("cursor")}>
        <MousePointer2 size={17} />
      </button>
      <button className={cn(btn, tool === "crosshair" && "bg-accent-soft text-accent")} title={t("tool.crosshair")} onClick={() => setTool("crosshair")}>
        <Crosshair size={17} />
      </button>
      <div className="my-1 h-px w-6 bg-line" />
      {GROUPS.map((g) => {
        const current = g.tools.find((x) => x.id === (lastInGroup[g.id] ?? g.tools[0]!.id)) ?? g.tools[0]!;
        const activeInGroup = g.tools.some((x) => x.id === tool);
        const Icon = (g.tools.find((x) => x.id === tool) ?? current).icon;
        return (
          <div key={g.id} className="relative">
            <button
              className={cn(btn, activeInGroup && "bg-accent-soft text-accent")}
              title={`${t(`tool.${current.id}`)}${current.hotkey ? ` (${current.hotkey})` : ""}`}
              onClick={() => setTool(current.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpen(open === g.id ? null : g.id);
              }}
            >
              <Icon size={17} />
            </button>
            {g.tools.length > 1 && (
              <button className="absolute right-0 bottom-0 flex h-3.5 w-3 items-center justify-center text-faint hover:text-fg" onClick={() => setOpen(open === g.id ? null : g.id)} aria-label={t(`tool.group.${g.id}`)}>
                <ChevronRight size={9} />
              </button>
            )}
            {open === g.id && (
              <div className="absolute top-0 left-11 z-30 w-56 rounded-lg border border-line bg-panel p-1 shadow-2xl">
                <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{t(`tool.group.${g.id}`)}</div>
                {g.tools.map((x) => (
                  <button
                    key={x.id}
                    className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-panel-2", tool === x.id && "text-accent")}
                    onClick={() => {
                      setTool(x.id);
                      setLastInGroup((s) => ({ ...s, [g.id]: x.id }));
                      setOpen(null);
                    }}
                  >
                    <x.icon size={15} />
                    <span className="flex-1">{t(`tool.${x.id}`)}</span>
                    {x.hotkey && <span className="text-[10px] text-faint">{x.hotkey}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="my-1 h-px w-6 bg-line" />
      <button className={cn(btn, magnet && "text-accent")} title={t("chart.magnet")} onClick={() => setChart({ magnet: !magnet })}>
        <Magnet size={17} />
      </button>
      <button className={cn(btn, stay && "text-accent")} title={stay ? "Stay in drawing mode: on" : "Stay in drawing mode: off"} onClick={() => setStay(!stay)}>
        <Pencil size={15} />
      </button>
      <button className={cn(btn, hidden && "text-warn")} title={t("chart.hideAll")} onClick={() => setHidden(!hidden)}>
        {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
      <button
        className={cn(btn, "hover:text-bear")}
        title={t("chart.clearAll")}
        disabled={drawings.length === 0}
        onClick={() => {
          if (drawings.length && window.confirm(t("chart.clearConfirm"))) commit(symbol, []);
        }}
      >
        <Trash2 size={17} />
      </button>
    </div>
  );
}

function canAlert(d: Drawing) {
  return ["hline", "hray", "trendline", "ray", "extended"].includes(d.type);
}

/** Current price level of a line drawing, used for drawing alerts. */
export function drawingLevelAt(d: Drawing, time: number): number | null {
  const [a, b] = d.points;
  if (!a) return null;
  if (d.type === "hline" || d.type === "hray") return a.price;
  if (!b) return null;
  return priceOnLine(a, b, time);
}

/** Floating style editor for the selected drawing. */
export function DrawingStyleBar({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }) {
  const t = useT();
  const selectedId = useDrawings((s) => s.selectedId);
  const drawings = useDrawings((s) => s.bySymbol[symbol] ?? EMPTY);
  const commit = useDrawings((s) => s.commit);
  const select = useDrawings((s) => s.select);
  const addAlert = useAlerts((s) => s.add);
  const d = drawings.find((x) => x.id === selectedId);
  if (!d) return null;

  const patch = (p: Partial<Drawing> | { style: Partial<Drawing["style"]> }) =>
    commit(
      symbol,
      drawings.map((x) => (x.id === d.id ? { ...x, ...p, style: { ...x.style, ...("style" in p ? p.style : {}) }, updatedAt: Date.now() } : x)),
    );

  return (
    <div className="absolute top-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-xl backdrop-blur">
      <div className="flex items-center gap-0.5 px-1">
        {PALETTE.map((c) => (
          <button key={c} title={c} onClick={() => patch({ style: { color: c } })} className={cn("h-5 w-5 rounded-full border-2", d.style.color === c ? "border-fg" : "border-transparent")} style={{ background: c }} />
        ))}
      </div>
      <div className="h-5 w-px bg-line" />
      <select className="h-7 rounded bg-panel-2 px-1 text-xs" value={d.style.width} onChange={(e) => patch({ style: { width: +e.target.value } })} title={t("chart.width")}>
        {[1, 2, 3, 4].map((w) => (
          <option key={w} value={w}>
            {w}px
          </option>
        ))}
      </select>
      <select className="h-7 rounded bg-panel-2 px-1 text-xs" value={d.style.dash} onChange={(e) => patch({ style: { dash: e.target.value as Drawing["style"]["dash"] } })} title={t("chart.lineStyle")}>
        <option value="solid">───</option>
        <option value="dashed">- - -</option>
        <option value="dotted">·····</option>
      </select>
      {["rect", "ellipse", "triangle", "channel", "fib", "text"].includes(d.type) && (
        <button className={cn("h-7 rounded px-2 text-xs", d.style.fill ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2")} onClick={() => patch({ style: { fill: !d.style.fill } })}>
          {t("chart.fill")}
        </button>
      )}
      {["trendline", "channel", "fib", "fibext"].includes(d.type) && (
        <button className={cn("h-7 rounded px-2 text-xs", d.style.extendRight ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2")} onClick={() => patch({ style: { extendRight: !d.style.extendRight } })}>
          {t("chart.extend")} →
        </button>
      )}
      {d.type === "text" && (
        <button
          className="h-7 rounded px-2 text-xs text-muted hover:bg-panel-2"
          onClick={() => {
            const v = window.prompt(t("tool.textPrompt"), d.style.text ?? "");
            if (v !== null) patch({ style: { text: v } });
          }}
        >
          <Type size={14} />
        </button>
      )}
      <div className="h-5 w-px bg-line" />
      {canAlert(d) && (
        <button
          className="h-7 rounded px-2 text-muted hover:bg-panel-2 hover:text-warn"
          title={t("chart.alertOnCross")}
          onClick={() => {
            const level = drawingLevelAt(d, Date.now() / 1000);
            addAlert({ symbol, type: "drawing", value: level ?? 0, drawingId: d.id, once: true, timeframe, note: t(`tool.${d.type}`) });
            toast({ title: t("alerts.new"), body: `${symbol} · ${t(`tool.${d.type}`)}`, tone: "success" });
          }}
        >
          <Bell size={14} />
        </button>
      )}
      <button className="h-7 rounded px-2 text-muted hover:bg-panel-2" title={t("chart.duplicate")} onClick={() => {
        const copy = { ...d, id: crypto.randomUUID(), points: d.points.map((p) => ({ time: p.time + TIMEFRAME_SECONDS[timeframe] * 5, price: p.price })), createdAt: Date.now(), updatedAt: Date.now() };
        commit(symbol, [...drawings, copy]);
        select(copy.id);
      }}>
        <Copy size={14} />
      </button>
      <button className="h-7 rounded px-2 text-muted hover:bg-panel-2" title={d.locked ? t("chart.unlock") : t("chart.lock")} onClick={() => patch({ locked: !d.locked })}>
        {d.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      <button className="h-7 rounded px-2 text-muted hover:bg-bear-soft hover:text-bear" title={t("common.delete")} onClick={() => {
        commit(symbol, drawings.filter((x) => x.id !== d.id));
        select(null);
      }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function DrawingContextMenu({ symbol, timeframe, menu, onClose }: { symbol: string; timeframe: Timeframe; menu: { id: string; x: number; y: number } | null; onClose: () => void }) {
  const t = useT();
  const drawings = useDrawings((s) => s.bySymbol[symbol] ?? EMPTY);
  const commit = useDrawings((s) => s.commit);
  const addAlert = useAlerts((s) => s.add);
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu, onClose]);
  const d = drawings.find((x) => x.id === menu?.id);
  if (!menu || !d) return null;
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-panel-2";
  const update = (p: Partial<Drawing>) => commit(symbol, drawings.map((x) => (x.id === d.id ? { ...x, ...p } : x)));
  return (
    <div className="fixed z-50 w-52 rounded-lg border border-line bg-panel p-1 shadow-2xl" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{t(`tool.${d.type}`)}</div>
      {canAlert(d) && (
        <button className={item} onClick={() => {
          addAlert({ symbol, type: "drawing", value: drawingLevelAt(d, Date.now() / 1000) ?? 0, drawingId: d.id, once: true, timeframe, note: t(`tool.${d.type}`) });
          toast({ title: t("alerts.new"), body: `${symbol} · ${t(`tool.${d.type}`)}`, tone: "success" });
          onClose();
        }}>
          <Bell size={14} /> {t("chart.alertOnCross")}
        </button>
      )}
      <button className={item} onClick={() => { update({ locked: !d.locked }); onClose(); }}>
        {d.locked ? <Unlock size={14} /> : <Lock size={14} />} {d.locked ? t("chart.unlock") : t("chart.lock")}
      </button>
      <button className={item} onClick={() => { update({ visible: !d.visible }); onClose(); }}>
        {d.visible ? <EyeOff size={14} /> : <Eye size={14} />} {d.visible ? t("chart.hide") : t("chart.show")}
      </button>
      <button className={cn(item, "text-bear")} onClick={() => { commit(symbol, drawings.filter((x) => x.id !== d.id)); onClose(); }}>
        <Trash2 size={14} /> {t("common.delete")}
      </button>
    </div>
  );
}
