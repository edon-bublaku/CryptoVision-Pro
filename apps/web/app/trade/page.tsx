"use client";

import { ArrowRightLeft, LogIn, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { ConnectionCard, HistoryCard, OrdersCard, PositionsCard, SafetyCard, BalancesCard } from "@/components/trade/panels";
import { tradeError } from "@/components/trade/parts";
import { OrderTicket } from "@/components/trade/ticket";
import { Button, Card, Empty, PageHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/store/auth";
import { useExchangeKeys, useTradeAccount, useTradeHistory, useTradingSettings } from "@/lib/trade/hooks";

export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <TradeView />
    </Suspense>
  );
}

function TradeView() {
  const t = useT();
  const { user, ready, health } = useAuth();
  const [env, setEnv] = useState<"testnet" | "live">("testnet");
  const [market, setMarket] = useState<"spot" | "futures">("futures");
  const onMarket = useCallback((m: "spot" | "futures") => setMarket(m), []);
  const settings = useTradingSettings();
  const keys = useExchangeKeys();
  const hasKey = !!keys.data?.some((k) => k.env === env && k.market === market);
  const account = useTradeAccount(env, market, hasKey);
  const history = useTradeHistory();
  const mode = health?.trading ?? "on";

  const header = (
    <PageHeader
      icon={<ArrowRightLeft size={20} />}
      title={t("trade.title")}
      subtitle={t("trade.subtitle")}
      actions={
        user && health?.db ? (
          <Segmented
            value={env}
            onChange={setEnv}
            options={[
              { value: "testnet", label: "Testnet" },
              { value: "live", label: t("trade.envLiveShort") },
            ]}
          />
        ) : undefined
      }
    />
  );

  if (!ready) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
        {header}
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!health?.db || mode === "off" || !user) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
        {header}
        <Card>
          <Empty icon={<ShieldAlert size={28} />} title={!health?.db ? t("trade.needServer") : mode === "off" ? t("trade.disabledByOperator") : t("trade.needAccount")}>
            {health?.db && mode !== "off" && (
              <div className="mt-3 flex justify-center gap-2">
                <Link href="/login?next=/trade">
                  <Button variant="primary">
                    <LogIn size={14} /> {t("auth.login")}
                  </Button>
                </Link>
                <Link href="/register">
                  <Button>{t("auth.register")}</Button>
                </Link>
              </div>
            )}
          </Empty>
        </Card>
      </div>
    );
  }

  const s = settings.data;
  const disabled = !s
    ? t("common.loading")
    : s.killSwitch
      ? t("trade.err.kill_switch")
      : env === "live" && s.mode !== "on"
        ? t("trade.err.live_disabled_by_operator")
        : env === "live" && !s.liveEnabled
          ? t("trade.err.live_not_enabled")
          : !hasKey
            ? t("trade.connectFirst", { m: market === "spot" ? "Spot" : "Futures" })
            : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      {header}
      <p className={env === "live" ? "rounded-xl bg-bear-soft p-3 text-sm font-medium text-bear" : "rounded-xl bg-accent-soft p-3 text-sm text-fg"}>
        {env === "live" ? t("trade.bannerLive") : t("trade.bannerTestnet")}
      </p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <OrderTicket env={env} market={market} onMarket={onMarket} account={account.data} maxRiskPct={s?.maxRiskPct ?? 2} disabled={disabled} />
          {account.error && hasKey && <p className="rounded-xl bg-bear-soft p-3 text-sm text-bear">{tradeError(account.error, t)}</p>}
          {account.data && market === "futures" && <PositionsCard env={env} account={account.data} />}
          {account.data && <OrdersCard env={env} account={account.data} />}
          <HistoryCard intents={history.data ?? []} />
        </div>
        <div className="min-w-0 space-y-5">
          {hasKey && <BalancesCard account={account.data} loading={account.isLoading} />}
          <ConnectionCard env={env} keys={keys.data ?? []} />
          {s && <SafetyCard settings={s} />}
        </div>
      </div>
      <p className="text-xs text-faint">{t("trade.disclaimer")}</p>
    </div>
  );
}
