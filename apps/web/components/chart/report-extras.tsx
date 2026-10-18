"use client";

import type { Signal, Timeframe } from "@cv/core";
import { formatCompact } from "@cv/core";
import type { Level } from "@cv/indicators";
import { Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useDerivatives } from "@/lib/data/derivatives";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/store/auth";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { Button, Skeleton } from "../ui/primitives";
import { Sparkline } from "../ui/viz";

/** Funding, open interest and crowd positioning from OKX perpetual swaps. */
export function DerivativesPanel({ symbol }: { symbol: string }) {
  const t = useT();
  const { data, isLoading } = useDerivatives(symbol);
  if (isLoading) return <Skeleton className="h-28" />;
  if (!data) return <p className="text-xs text-muted">{t("deriv.none")}</p>;
  const fr = data.fundingRate * 100;
  // Annualise by the instrument's own settlement interval (not every swap funds every 8h).
  const annual = fr * (24 / (data.fundingIntervalHours || 8)) * 365;
  const takerTotal = data.takerBuy24h + data.takerSell24h || 1;
  const buyShare = data.takerBuy24h / takerTotal;
  const row = "flex items-center justify-between py-1 text-xs";
  return (
    <div>
      <div className={row}>
        <span className="text-muted">{t("deriv.funding")}</span>
        <span className={cn("num font-semibold", fr > 0.03 ? "text-bear" : fr < 0 ? "text-bull" : "text-fg")}>
          {fr >= 0 ? "+" : ""}
          {fr.toFixed(4)}% <span className="text-faint">({annual >= 0 ? "+" : ""}{annual.toFixed(1)}%/vit)</span>
        </span>
      </div>
      <div className={row}>
        <span className="text-muted">{t("deriv.fundingAvg")}</span>
        <span className="num">{(data.fundingAvg30 * 100).toFixed(4)}%</span>
      </div>
      <div className={row}>
        <span className="text-muted">{t("deriv.oi")}</span>
        <span className="num">
          ${formatCompact(data.openInterestUsd)}{" "}
          {Number.isFinite(data.oiChange24hPct) && <span className={data.oiChange24hPct >= 0 ? "text-bull" : "text-bear"}>({data.oiChange24hPct >= 0 ? "+" : ""}{data.oiChange24hPct.toFixed(1)}%)</span>}
        </span>
      </div>
      <div className={row}>
        <span className="text-muted">{t("deriv.ls")}</span>
        <span className="flex items-center gap-2">
          <Sparkline values={data.longShortHistory.slice(-48).map((x) => x.ratio)} width={60} height={18} />
          <span className="num font-semibold">{data.longShortRatio.toFixed(2)}</span>
        </span>
      </div>
      <div className="py-1">
        <div className="mb-1 flex justify-between text-[11px] text-muted">
          <span>{t("deriv.taker")}</span>
          <span className="num">{(buyShare * 100).toFixed(0)}% / {((1 - buyShare) * 100).toFixed(0)}%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-bear">
          <div className="bg-bull" style={{ width: `${buyShare * 100}%` }} />
        </div>
      </div>
      <div className={cn("mt-2 rounded-lg px-2 py-1.5 text-[11px]", data.bias > 0.15 ? "bg-bull-soft text-bull" : data.bias < -0.15 ? "bg-bear-soft text-bear" : "bg-panel-2 text-muted")}>
        {t("deriv.bias")}: <b className="num">{data.bias >= 0 ? "+" : ""}{data.bias.toFixed(2)}</b>
      </div>
    </div>
  );
}

/** Minimal, safe Markdown → React (headings, bold, bullets, paragraphs). No HTML injection. */
function renderMarkdown(md: string) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : <span key={`${k}-${i}`}>{part.replace(/^_|_$/g, "")}</span>));
  const flush = (k: number) => {
    if (list.length) blocks.push(<ul key={`ul${k}`}>{list.map((li, i) => <li key={i}>{inline(li, `li${k}-${i}`)}</li>)}</ul>);
    list = [];
  };
  md.split("\n").forEach((line, i) => {
    const l = line.trim();
    if (/^[-*•] /.test(l)) return void list.push(l.slice(2));
    flush(i);
    if (!l) return;
    if (/^#{1,4} /.test(l)) blocks.push(<h3 key={i}>{l.replace(/^#+ /, "")}</h3>);
    else blocks.push(<p key={i}>{inline(l, `p${i}`)}</p>);
  });
  flush(-1);
  return blocks;
}

/** Streams a Claude explanation of the engine's numbers (server-side, needs ANTHROPIC_API_KEY). */
export function AiExplain({ symbol, timeframe, signal, levels, backtest }: { symbol: string; timeframe: Timeframe; signal: Signal; levels: Level[]; backtest: unknown }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const ai = useAuth((s) => s.health?.ai);
  const deriv = useDerivatives(symbol);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  if (!ai) return <p className="text-xs text-faint">{t("ai.off")}</p>;

  const run = async (depth: "quick" | "deep") => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setText("");
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          locale: lang,
          depth,
          symbol,
          timeframe,
          signal,
          levels: levels.slice(0, 8).map((l) => ({ price: l.price, kind: l.kind, touches: l.touches })),
          backtest: backtest ?? null,
          derivatives: deriv.data ? { fundingRate: deriv.data.fundingRate, openInterestUsd: deriv.data.openInterestUsd, oiChange24hPct: deriv.data.oiChange24hPct, longShortRatio: deriv.data.longShortRatio, bias: deriv.data.bias } : null,
        }),
      });
      if (!res.ok || !res.body) {
        setText(`[${res.status}]`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setText((s) => s + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!ac.signal.aborted) setText(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="xs" variant="primary" disabled={busy} onClick={() => void run("quick")}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("ai.explain")}
        </Button>
        <Button size="xs" disabled={busy} onClick={() => void run("deep")}>
          {t("ai.deep")}
        </Button>
      </div>
      {text && <div className="prose-ai rounded-xl border border-line bg-panel-2 p-3 text-[13px] leading-relaxed">{renderMarkdown(text)}</div>}
      <p className="text-[10.5px] text-faint">{t("ai.note")}</p>
    </div>
  );
}
