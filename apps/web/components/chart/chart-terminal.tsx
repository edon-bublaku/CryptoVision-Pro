"use client";

import type { Candle, Timeframe } from "@cv/core";
import { TIMEFRAMES } from "@cv/core";
import { Camera, ChevronDown, Columns2, Grid2x2, Layers, PanelRight, Pause, Play, Redo2, Rewind, SkipBack, SkipForward, Square, Star, Undo2, Wand2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FullAnalysis } from "@cv/engine";
import { INDICATORS, OVERLAYS } from "@/lib/chart/indicators";
import { useT } from "@/lib/i18n";
import { useChartUi } from "@/lib/store/chart-ui";
import { useDrawings } from "@/lib/store/drawings";
import { useSettings, type ChartType } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { Button, Segmented } from "../ui/primitives";
import { CoinIcon } from "../ui/viz";
import { ChartPanel, type ChartPanelHandle } from "./chart-panel";
import { DrawingContextMenu, DrawingStyleBar, DrawingToolbar } from "./chart-tools";
import { CoinReport } from "./coin-report";

const TYPES: { value: ChartType; label: string }[] = [
  { value: "candles", label: "Candles" },
  { value: "heikin", label: "Heikin-Ashi" },
  { value: "bars", label: "Bars" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
];

export function ChartTerminal() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const ui = useChartUi();
  const chart = useSettings((s) => s.chart);
  const setChart = useSettings((s) => s.setChart);
  const watchlist = useSettings((s) => s.watchlist);
  const toggleWatch = useSettings((s) => s.toggleWatch);
  const undo = useDrawings((s) => s.undo);
  const redo = useDrawings((s) => s.redo);
  const [menu, setMenu] = useState<"ind" | "ov" | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showReport, setShowReport] = useState(true);
  const [mobileReport, setMobileReport] = useState(false);
  const [report, setReport] = useState<{ analysis: FullAnalysis | null; candles: Candle[] }>({ analysis: null, candles: [] });
  const handles = useRef<(ChartPanelHandle | null)[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const layout = chart.layout;
  const active = Math.min(ui.activePanel, layout - 1);
  const panel = ui.panels[active]!;

  // Deep link: /chart?symbol=ETHUSDT&tf=1h sets the active panel.
  useEffect(() => {
    const sym = params.get("symbol")?.toUpperCase();
    const tf = params.get("tf") as Timeframe | null;
    if (sym || (tf && TIMEFRAMES.includes(tf))) ui.setPanel(active, { ...(sym ? { symbol: sym } : {}), ...(tf && TIMEFRAMES.includes(tf) ? { timeframe: tf } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  // Replay playback
  useEffect(() => {
    if (!ui.replay.active || !ui.replay.playing) return;
    const id = setInterval(() => ui.setReplay({ index: useChartUi.getState().replay.index + 1 }), 600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.replay.active, ui.replay.playing]);

  const setTf = (tf: Timeframe) => {
    ui.setPanel(active, { timeframe: tf });
    router.replace(`/chart?symbol=${panel.symbol}&tf=${tf}`);
  };

  const toggleIndicator = (id: string) => setChart({ indicators: chart.indicators.includes(id) ? chart.indicators.filter((x) => x !== id) : [...chart.indicators, id] });
  const toggleOverlay = (id: string) => setChart({ overlays: chart.overlays.includes(id) ? chart.overlays.filter((x) => x !== id) : [...chart.overlays, id] });
  const watched = watchlist.includes(panel.symbol);

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <div ref={menuRef} className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-2 py-1.5">
        <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-panel-2" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}>
          <CoinIcon symbol={panel.symbol} size={22} />
          <span className="text-sm font-bold">{panel.symbol.replace("USDT", "")}</span>
          <span className="text-xs text-faint">/USDT</span>
          <ChevronDown size={14} className="text-muted" />
        </button>
        <button className={cn("rounded-md p-1.5 hover:bg-panel-2", watched ? "text-warn" : "text-muted")} onClick={() => toggleWatch(panel.symbol)} title={t("chart.watch")}>
          <Star size={16} fill={watched ? "currentColor" : "none"} />
        </button>
        <div className="mx-1 h-5 w-px bg-line" />
        <Segmented value={panel.timeframe} onChange={setTf} options={TIMEFRAMES.map((x) => ({ value: x, label: x }))} />
        <div className="mx-1 h-5 w-px bg-line" />
        <select className="h-8 rounded-md border border-line bg-panel-2 px-2 text-xs" value={chart.type} onChange={(e) => setChart({ type: e.target.value as ChartType })} aria-label={t("chart.type")}>
          {TYPES.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <Button size="sm" variant="secondary" active={menu === "ind"} onClick={() => setMenu(menu === "ind" ? null : "ind")}>
            <Layers size={14} /> {t("chart.indicators")} <span className="rounded bg-panel px-1 text-[10px]">{chart.indicators.length}</span>
          </Button>
          {menu === "ind" && (
            <div className="fixed z-40 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-2xl">
              {(["trend", "momentum", "volatility", "volume"] as const).map((g) => (
                <div key={g}>
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{g}</div>
                  {INDICATORS.filter((i) => i.group === g).map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-panel-2">
                      <input type="checkbox" checked={chart.indicators.includes(i.id)} onChange={() => toggleIndicator(i.id)} className="accent-[var(--accent)]" />
                      <span className="flex-1">{i.label}</span>
                      <span className="text-[10px] text-faint">{i.placement === "pane" ? "pane" : ""}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <Button size="sm" variant="secondary" active={menu === "ov"} onClick={() => setMenu(menu === "ov" ? null : "ov")}>
            <Wand2 size={14} /> {t("chart.overlays")}
          </Button>
          {menu === "ov" && (
            <div className="fixed z-40 mt-1 w-72 rounded-lg border border-line bg-panel p-1 shadow-2xl">
              {OVERLAYS.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-panel-2">
                  <input type="checkbox" checked={chart.overlays.includes(o.id)} onChange={() => toggleOverlay(o.id)} className="accent-[var(--accent)]" />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <Button size="sm" variant="secondary" active={chart.log} onClick={() => setChart({ log: !chart.log })}>
          {t("chart.log")}
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={() => undo(panel.symbol)} title={`${t("chart.undo")} (Ctrl+Z)`}>
          <Undo2 size={15} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => redo(panel.symbol)} title={`${t("chart.redo")} (Ctrl+Y)`}>
          <Redo2 size={15} />
        </Button>
        <Segmented
          value={layout}
          onChange={(v) => setChart({ layout: v })}
          options={[
            { value: 1, label: <Square size={13} />, title: "1" },
            { value: 2, label: <Columns2 size={13} />, title: "2" },
            { value: 4, label: <Grid2x2 size={13} />, title: "4" },
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => handles.current[active]?.screenshot()} title={t("chart.screenshot")}>
          <Camera size={15} />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          active={ui.replay.active}
          onClick={() => ui.setReplay(ui.replay.active ? { active: false, playing: false } : { active: true, playing: false, index: Math.max(220, report.candles.length - 150) })}
          title={t("chart.replay")}
        >
          <Rewind size={14} /> <span className="hidden md:inline">{t("chart.replay")}</span>
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setMobileReport(true)}>
            <PanelRight size={16} />
          </Button>
          <Button size="sm" variant="ghost" className="hidden xl:inline-flex" active={showReport} onClick={() => setShowReport(!showReport)} title={t("chart.report")}>
            <PanelRight size={16} />
          </Button>
        </div>
      </div>

      {ui.replay.active && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-warn-soft px-3 py-1.5 text-xs text-warn">
          <span className="font-semibold">REPLAY</span>
          <Button size="xs" variant="ghost" onClick={() => ui.setReplay({ index: Math.max(220, ui.replay.index - 1) })}>
            <SkipBack size={13} />
          </Button>
          <Button size="xs" variant="secondary" onClick={() => ui.setReplay({ playing: !ui.replay.playing })}>
            {ui.replay.playing ? <Pause size={13} /> : <Play size={13} />} {ui.replay.playing ? t("chart.pause") : t("chart.play")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => ui.setReplay({ index: ui.replay.index + 1 })}>
            <SkipForward size={13} /> {t("chart.step")}
          </Button>
          <span className="num text-muted">
            {report.candles.length ? new Date(report.candles[report.candles.length - 1]!.time * 1000).toLocaleString() : ""}
          </span>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => ui.setReplay({ active: false, playing: false })}>
            <X size={13} /> {t("chart.exitReplay")}
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <DrawingToolbar symbol={panel.symbol} />
        <div className={cn("relative grid min-h-0 min-w-0 flex-1 gap-px bg-line", layout === 2 && "grid-cols-1 md:grid-cols-2", layout === 4 && "grid-cols-1 grid-rows-4 md:grid-cols-2 md:grid-rows-2")}>
          {Array.from({ length: layout }, (_, i) => {
            const p = ui.panels[i]!;
            return (
              <div key={i} className={cn("relative min-h-0 bg-panel", layout > 1 && i === active && "ring-1 ring-accent ring-inset")}>
                <ChartPanel
                  symbol={p.symbol}
                  timeframe={p.timeframe}
                  active={i === active}
                  onActivate={() => i !== active && ui.setActivePanel(i)}
                  onAnalysis={(analysis, candles) => setReport({ analysis, candles })}
                  onContextMenu={(id, x, y) => setCtxMenu({ id, x, y })}
                  onEditText={(id) => {
                    const st = useDrawings.getState();
                    const list = st.bySymbol[p.symbol] ?? [];
                    const d = list.find((x) => x.id === id);
                    const v = window.prompt(t("tool.textPrompt"), d?.style.text ?? "");
                    if (v !== null && d) st.commit(p.symbol, list.map((x) => (x.id === id ? { ...x, style: { ...x.style, text: v } } : x)));
                  }}
                  registerHandle={(h) => (handles.current[i] = h)}
                />
                {i === active && <DrawingStyleBar symbol={p.symbol} timeframe={p.timeframe} />}
              </div>
            );
          })}
        </div>
        {showReport && (
          <aside className="hidden w-[340px] shrink-0 border-l border-line bg-panel xl:block">
            <CoinReport symbol={panel.symbol} timeframe={panel.timeframe} data={report} />
          </aside>
        )}
      </div>

      {mobileReport && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 xl:hidden" onClick={() => setMobileReport(false)}>
          <div className="h-full w-[min(380px,100vw)] bg-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-semibold">{t("chart.report")}</span>
              <button onClick={() => setMobileReport(false)} className="p-1 text-muted">
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-41px)]">
              <CoinReport symbol={panel.symbol} timeframe={panel.timeframe} data={report} />
            </div>
          </div>
        </div>
      )}
      <DrawingContextMenu symbol={panel.symbol} timeframe={panel.timeframe} menu={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );
}
