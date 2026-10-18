"use client";

import { CONDITION_OPS, CUSTOM_PRESETS, SERIES_IDS, type Condition, type CustomStrategyDef, type Operand, type SeriesId } from "@cv/signals";
import { Plus, Save, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select, Switch } from "@/components/ui/primitives";
import { useT, type TKey } from "@/lib/i18n";
import { useStrategies } from "@/lib/store/strategies";
import { cn } from "@/lib/utils";

const OP_LABEL: Record<Condition["op"], string> = { ">": ">", "<": "<", crossAbove: "↗ cross", crossBelow: "↘ cross" };

export function newStrategy(): CustomStrategyDef {
  const p = CUSTOM_PRESETS[0]!;
  return { ...structuredClone(p), id: crypto.randomUUID(), name: p.name };
}

function OperandInput({ value, onChange, allowValue = true, className }: { value: Operand; onChange: (o: Operand) => void; allowValue?: boolean; className?: string }) {
  const t = useT();
  const isValue = "value" in value;
  return (
    <div className={cn("flex min-w-0 flex-1 gap-1", className)}>
      <Select
        aria-label={t("builder.operand")}
        className="min-w-0 flex-1"
        value={isValue ? "__value" : value.series}
        onChange={(e) => onChange(e.target.value === "__value" ? { value: 50 } : { series: e.target.value as SeriesId })}
      >
        {SERIES_IDS.map((id) => (
          <option key={id} value={id}>
            {t(`series.${id}` as TKey)}
          </option>
        ))}
        {allowValue && <option value="__value">{t("builder.number")}</option>}
      </Select>
      {isValue && <Input type="number" step="any" className="w-20" value={value.value} onChange={(e) => onChange({ value: Number.isFinite(+e.target.value) ? +e.target.value : 0 })} />}
    </div>
  );
}

function ConditionList({ side, conds, onChange }: { side: "long" | "short"; conds: Condition[]; onChange: (c: Condition[]) => void }) {
  const t = useT();
  const set = (i: number, patch: Partial<Condition>) => onChange(conds.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className={cn("rounded-xl border p-3", side === "long" ? "border-bull/30 bg-bull-soft/40" : "border-bear/30 bg-bear-soft/40")}>
      <div className="mb-2 flex items-center justify-between">
        <span className={cn("text-xs font-semibold tracking-wide uppercase", side === "long" ? "text-bull" : "text-bear")}>{t(side === "long" ? "builder.long" : "builder.short")}</span>
        <span className="text-[11px] text-faint">{conds.length ? t("builder.allMustHold") : t("builder.disabled")}</span>
      </div>
      <div className="space-y-2">
        {conds.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <OperandInput value={c.left} onChange={(left) => set(i, { left })} allowValue={false} className="basis-full sm:basis-0" />
            <Select aria-label={t("builder.operator")} className="w-24 shrink-0" value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })}>
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </Select>
            <OperandInput value={c.right} onChange={(right) => set(i, { right })} />
            <button aria-label={t("common.delete")} className="shrink-0 rounded-md p-1.5 text-faint hover:bg-panel-2 hover:text-bear" onClick={() => onChange(conds.filter((_, k) => k !== i))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <Button size="xs" variant="ghost" className="mt-2" disabled={conds.length >= 12} onClick={() => onChange([...conds, { left: { series: "rsi" }, op: "<", right: { value: 30 } }])}>
        <Plus size={12} /> {t("builder.addCondition")}
      </Button>
    </div>
  );
}

/** Visual editor for a user-defined strategy; the definition is plain JSON (see @cv/signals custom.ts). */
export function StrategyBuilder({ value, onChange }: { value: CustomStrategyDef; onChange: (d: CustomStrategyDef) => void }) {
  const t = useT();
  const { saved, save, remove } = useStrategies();
  const isSaved = saved.some((s) => s.id === value.id);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("builder.name")} className="min-w-[200px] flex-1">
          <Input value={value.name} maxLength={60} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </Field>
        <Field label={t("builder.load")} className="min-w-[200px] flex-1">
          <Select
            value=""
            onChange={(e) => {
              const src = [...saved, ...CUSTOM_PRESETS].find((s) => s.id === e.target.value);
              if (!src) return;
              // Presets are copied so editing never overwrites them; saved strategies keep their id.
              onChange(CUSTOM_PRESETS.includes(src) ? { ...structuredClone(src), id: crypto.randomUUID() } : structuredClone(src));
            }}
          >
            <option value="">—</option>
            {saved.length > 0 && (
              <optgroup label={t("builder.saved")}>
                {saved.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t("builder.presets")}>
              {CUSTOM_PRESETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Button size="md" onClick={() => save({ ...value, name: value.name.trim() || "Strategy" })}>
          <Save size={14} /> {t("common.save")}
        </Button>
        {isSaved && (
          <Button size="md" variant="ghost" onClick={() => remove(value.id)} aria-label={t("common.delete")}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ConditionList side="long" conds={value.long} onChange={(long) => onChange({ ...value, long })} />
        <ConditionList side="short" conds={value.short} onChange={(short) => onChange({ ...value, short })} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("builder.stop")}>
          <Select
            value={value.stop.type}
            onChange={(e) => onChange({ ...value, stop: e.target.value === "atr" ? { type: "atr", mult: 2 } : { type: "swing", lookback: 20 } })}
          >
            <option value="atr">{t("builder.stopAtr")}</option>
            <option value="swing">{t("builder.stopSwing")}</option>
          </Select>
        </Field>
        {value.stop.type === "atr" ? (
          <Field label={t("builder.atrMult")}>
            <Input type="number" step="0.25" min="0.3" max="10" className="w-24" value={value.stop.mult} onChange={(e) => onChange({ ...value, stop: { type: "atr", mult: Math.min(10, Math.max(0.3, +e.target.value || 2)) } })} />
          </Field>
        ) : (
          <Field label={t("builder.swingBars")}>
            <Input type="number" step="1" min="3" max="100" className="w-24" value={value.stop.lookback} onChange={(e) => onChange({ ...value, stop: { type: "swing", lookback: Math.min(100, Math.max(3, Math.round(+e.target.value) || 20)) } })} />
          </Field>
        )}
        <div className="pb-1.5">
          <Switch checked={value.confluence} onChange={(confluence) => onChange({ ...value, confluence })} label={t("builder.confluence")} />
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">{t("builder.help")}</p>
    </div>
  );
}
