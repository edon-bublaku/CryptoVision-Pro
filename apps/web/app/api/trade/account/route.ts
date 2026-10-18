import { futuresBalance, futuresDualSide, futuresOpenAlgoOrders, futuresOpenOrders, futuresPositions, spotAccountInfo, spotOpenOrders, dec } from "@cv/exchange/trade";
import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { binanceHttpError, clientFor } from "@/lib/server/trading";
import { type AccountResponse, tradeEnv, tradeMarket } from "@/lib/trade/schema";

/** Read-only view of the Binance account: balances, open positions and open orders. */
export const GET = route({ auth: true, rate: 30 }, async ({ req, db, user }) => {
  const q = z.object({ env: tradeEnv, market: tradeMarket }).parse(Object.fromEntries(req.nextUrl.searchParams));
  const c = await clientFor(db, user!, q.env, q.market);
  try {
    if (q.market === "spot") {
      const [acct, orders] = await Promise.all([spotAccountInfo(c), spotOpenOrders(c)]);
      const res: AccountResponse = {
        env: q.env,
        market: "spot",
        balances: acct.balances
          .map((b) => ({ asset: b.asset, free: b.free, locked: b.locked, total: dec(b.free).plus(b.locked).toFixed() }))
          .filter((b) => dec(b.total).gt(0))
          .sort((a, b) => a.asset.localeCompare(b.asset)),
        positions: [],
        orders: orders.map((o) => ({
          kind: "order",
          symbol: o.symbol,
          id: o.orderId,
          listId: o.orderListId,
          clientId: o.clientOrderId,
          side: o.side,
          type: o.type,
          price: o.price,
          triggerPrice: o.stopPrice && dec(o.stopPrice).gt(0) ? o.stopPrice : undefined,
          quantity: o.origQty,
          filled: o.executedQty,
          status: o.status,
          time: o.time,
        })),
        usedWeight: c.usedWeight,
      };
      return json(res);
    }
    const [balances, positions, orders, algo, dualSide] = await Promise.all([futuresBalance(c), futuresPositions(c), futuresOpenOrders(c), futuresOpenAlgoOrders(c), futuresDualSide(c)]);
    const res: AccountResponse = {
      env: q.env,
      market: "futures",
      balances: balances
        .filter((b) => !dec(b.balance).isZero() || !dec(b.availableBalance).isZero())
        .map((b) => ({ asset: b.asset, free: b.availableBalance, locked: dec(b.balance).minus(b.availableBalance).toFixed(), total: b.balance })),
      positions: positions.map((p) => {
        const amt = dec(p.positionAmt);
        return {
          symbol: p.symbol,
          side: amt.gt(0) ? "LONG" : "SHORT",
          positionSide: p.positionSide ?? "BOTH",
          quantity: amt.abs().toFixed(),
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          pnl: p.unRealizedProfit,
          liquidationPrice: p.liquidationPrice,
          leverage: p.leverage,
          marginType: p.marginType,
          breakEvenPrice: p.breakEvenPrice,
        };
      }),
      orders: [
        ...orders.map((o) => ({
          kind: "order" as const,
          symbol: o.symbol,
          id: o.orderId,
          clientId: o.clientOrderId,
          side: o.side,
          type: o.type,
          price: o.price,
          triggerPrice: o.stopPrice && dec(o.stopPrice).gt(0) ? o.stopPrice : undefined,
          quantity: o.origQty,
          filled: o.executedQty,
          status: o.status,
          reduceOnly: o.reduceOnly,
          closePosition: o.closePosition,
          time: o.time ?? o.updateTime,
        })),
        ...algo.map((o) => ({
          kind: "algo" as const,
          symbol: o.symbol,
          id: o.algoId,
          clientId: o.clientAlgoId,
          side: o.side,
          type: o.orderType,
          price: o.price ?? "0",
          triggerPrice: o.triggerPrice,
          quantity: o.quantity ?? "0",
          filled: "0",
          status: o.algoStatus ?? "NEW",
          reduceOnly: o.reduceOnly,
          closePosition: o.closePosition,
          time: o.createTime,
        })),
      ],
      dualSide,
      usedWeight: c.usedWeight,
    };
    return json(res);
  } catch (e) {
    binanceHttpError(e);
  }
});
