"use client";

import { CheckCircle2, CircleAlert, CircleX, HelpCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge, Button, Modal } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { errorMessage } from "@/lib/store/auth";
import type { PlanIssue, StepResult } from "@/lib/trade/schema";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useT>;

/** Binance's own message and code when the exchange refused; our translation otherwise. */
export function tradeError(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (e.code === "binance_error" || e.code === "binance_auth") return `${t(`trade.err.${e.code}` as TKey)}: ${String(e.data.binanceMsg ?? "")} (${String(e.data.binanceCode ?? "")})`;
    const key = `trade.err.${e.code}` as TKey;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return errorMessage(e, t as (k: string) => string);
}

export function issueText(i: PlanIssue, t: T): string {
  const ref = i.ref ? ` (${t(`trade.ref.${i.ref}` as TKey)})` : "";
  if (i.code.startsWith("filter:")) return `${t(`trade.filter.${i.code.slice(7)}` as TKey)}${ref}`;
  return `${t(`trade.issue.${i.code}` as TKey)}${ref}`;
}

const TONE: Record<string, "bull" | "bear" | "warn" | "neutral" | "accent"> = {
  placed: "bull",
  partial: "warn",
  failed: "bear",
  rejected: "bear",
  reverted: "warn",
  unknown: "bear",
  pending: "accent",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={TONE[status] ?? "neutral"}>{t(`trade.status.${status}` as TKey)}</Badge>;
}

/** Every request that was sent, with Binance's answer: nothing about an order is hidden. */
export function StepsList({ steps }: { steps: StepResult[] }) {
  const t = useT();
  if (!steps.length) return null;
  return (
    <ol className="space-y-1.5 text-xs">
      {steps.map((s, k) => (
        <li key={k} className="flex items-start gap-2">
          {s.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-bull" aria-hidden /> : s.error?.unknown ? <HelpCircle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden /> : <CircleX size={14} className="mt-0.5 shrink-0 text-bear" aria-hidden />}
          <span className="min-w-0">
            <span className="font-medium text-fg">{t(`trade.role.${s.role}` as TKey)}</span>
            {s.params.type && <span className="text-muted"> · {s.params.type}</span>}
            {(s.params.triggerPrice ?? s.params.stopPrice ?? s.params.price) && <span className="num text-muted"> @ {s.params.triggerPrice ?? s.params.stopPrice ?? s.params.price}</span>}
            {s.params.quantity && <span className="num text-muted"> × {s.params.quantity}</span>}
            {s.error && (
              <span className="block break-words text-bear">
                {s.error.msg} ({s.error.code})
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function IssueList({ items, tone }: { items: PlanIssue[]; tone: "bear" | "warn" }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <ul className={cn("space-y-1 rounded-xl p-3 text-xs", tone === "bear" ? "bg-bear-soft text-bear" : "bg-warn-soft text-warn")}>
      {items.map((i, k) => (
        <li key={k} className="flex items-start gap-1.5">
          <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden /> {issueText(i, t)}
        </li>
      ))}
    </ul>
  );
}

/** Small confirmation dialog for cancels, closes and the emergency stop. */
export function ConfirmAction({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => Promise<void>;
  danger?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <div className="space-y-4 text-sm">
        {children}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Row({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "bull" | "bear" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn("num text-right font-medium", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</span>
    </div>
  );
}
