"use client";

import { TIMEFRAMES, type Timeframe } from "@cv/core";
import type { RiskProfile } from "@cv/risk";
import { Download, Send, Settings, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { sendTelegram } from "@/components/layout/alert-engine";
import { Button, Card, CardHeader, Field, Input, Segmented, Select, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { download } from "@/lib/utils";

const STORE_KEYS = ["cv.settings", "cv.drawings", "cv.portfolio", "cv.alerts", "cv.scan", "cv.chart-ui", "cv.screens"];

export default function SettingsPage() {
  const t = useT();
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <Settings size={20} className="text-accent" /> {t("settings.title")}
      </h1>

      <Card>
        <CardHeader title={`${t("settings.language")} · ${t("settings.theme")}`} />
        <div className="flex flex-wrap items-end gap-4 p-4">
          <Field label={t("settings.language")}>
            <Segmented value={s.lang} onChange={(v) => s.set({ lang: v })} options={[{ value: "sq", label: "Shqip" }, { value: "en", label: "English" }]} />
          </Field>
          <Field label={t("settings.theme")}>
            <Segmented value={s.theme} onChange={(v) => s.set({ theme: v })} options={[{ value: "dark", label: t("settings.theme.dark") }, { value: "light", label: t("settings.theme.light") }]} />
          </Field>
          <Switch checked={s.colorblind} onChange={(v) => s.set({ colorblind: v })} label={t("settings.colorblind")} />
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.riskProfile")} subtitle={t("plan.afterTp1")} />
        <div className="space-y-4 p-4">
          <Segmented
            value={s.riskProfile}
            onChange={(v: RiskProfile) => s.applyProfile(v)}
            options={(["conservative", "moderate", "aggressive"] as RiskProfile[]).map((p) => ({ value: p, label: t(`settings.risk.${p}`) }))}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t("settings.equity")}>
              <Input type="number" min="0" value={s.equity} onChange={(e) => s.set({ equity: Math.max(0, +e.target.value) })} />
            </Field>
            <Field label={t("settings.riskPct")} hint="0.25 – 2%">
              <Input type="number" step="0.25" min="0.1" max="5" value={s.riskPct} onChange={(e) => s.set({ riskPct: Math.min(5, Math.max(0.1, +e.target.value)) })} />
            </Field>
            <Field label={t("settings.maxLeverage")}>
              <Input type="number" min="1" max="20" value={s.maxLeverage} onChange={(e) => s.set({ maxLeverage: Math.min(20, Math.max(1, +e.target.value)) })} />
            </Field>
            <Field label={t("settings.maxPositions")}>
              <Input type="number" min="1" max="30" value={s.maxPositions} onChange={(e) => s.set({ maxPositions: Math.max(1, +e.target.value) })} />
            </Field>
            <Field label={t("settings.fee")}>
              <Input type="number" step="0.01" min="0" value={s.feePct} onChange={(e) => s.set({ feePct: Math.max(0, +e.target.value) })} />
            </Field>
            <Field label={t("settings.defaultTf")}>
              <Select value={s.defaultTf} onChange={(e) => s.set({ defaultTf: e.target.value as Timeframe })}>
                {TIMEFRAMES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.scanSize")}>
              <Select value={s.scanSize} onChange={(e) => s.set({ scanSize: +e.target.value })}>
                {[20, 40, 60, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.telegram")} subtitle={t("settings.telegramHelp")} />
        <div className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t("settings.telegramToken")}>
            <Input type="password" autoComplete="off" value={s.telegram.token} onChange={(e) => s.set({ telegram: { ...s.telegram, token: e.target.value.trim() } })} />
          </Field>
          <Field label={t("settings.telegramChat")}>
            <Input value={s.telegram.chatId} onChange={(e) => s.set({ telegram: { ...s.telegram, chatId: e.target.value.trim() } })} />
          </Field>
          <Button
            disabled={!s.telegram.token || !s.telegram.chatId}
            onClick={async () => {
              const ok = await sendTelegram(s.telegram.token, s.telegram.chatId, "✅ CryptoVision Pro: test");
              toast({ title: ok ? "Telegram ✓" : "Telegram ✗", tone: ok ? "success" : "warn" });
            }}
          >
            <Send size={14} /> {t("settings.telegramTest")}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.data")} subtitle={t("settings.dataHelp")} />
        <div className="flex flex-wrap gap-2 p-4">
          <Button
            onClick={() => {
              const dump: Record<string, unknown> = {};
              for (const k of STORE_KEYS) {
                const v = localStorage.getItem(k);
                if (v) dump[k] = JSON.parse(v);
              }
              // Never export the Telegram token.
              const st = dump["cv.settings"] as { state?: { telegram?: unknown } } | undefined;
              if (st?.state) st.state.telegram = { token: "", chatId: "" };
              download(`cryptovision-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: dump }, null, 2));
            }}
          >
            <Download size={14} /> {t("common.export")}
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {t("common.import")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const j = JSON.parse(await f.text()) as { data?: Record<string, unknown> };
                if (!j.data || typeof j.data !== "object") throw new Error("Invalid backup");
                for (const [k, v] of Object.entries(j.data)) if (STORE_KEYS.includes(k)) localStorage.setItem(k, JSON.stringify(v));
                window.location.reload();
              } catch (err) {
                toast({ title: t("common.error"), body: err instanceof Error ? err.message : String(err), tone: "warn" });
              }
            }}
          />
          <Button
            variant="danger"
            onClick={() => {
              if (!window.confirm(t("settings.resetConfirm"))) return;
              for (const k of STORE_KEYS) localStorage.removeItem(k);
              window.location.reload();
            }}
          >
            <Trash2 size={14} /> {t("settings.reset")}
          </Button>
        </div>
      </Card>
      <p className="text-center text-[11px] text-faint">{t("disclaimer.long")}</p>
    </div>
  );
}
