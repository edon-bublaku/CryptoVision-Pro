import { createServer, type Server } from "node:http";
import { sign } from "../signing";
import futuresInfo from "./futures-exchange-info.json";
import spotInfo from "./spot-exchange-info.json";

/**
 * In-memory Binance for tests (FIXTURE, not market data). It verifies the API key, the HMAC
 * signature and the timestamp window exactly like Binance, records every request and answers with
 * realistic shapes. Individual endpoints can be overridden to simulate rejections and lost responses.
 */

export interface MockCall {
  method: string;
  path: string;
  params: Record<string, string>;
}

export interface MockReply {
  status: number;
  body: unknown;
}

export type MockHandler = (params: Record<string, string>, calls: MockCall[]) => MockReply | "network_error";

export interface MockOptions {
  apiKey: string;
  secret: string;
  /** Server clock minus client clock, ms. */
  skewMs?: number;
  mark?: string;
  bid?: string;
  ask?: string;
  balance?: string;
  positions?: { symbol: string; positionAmt: string; positionSide?: string; entryPrice?: string }[];
  dualSide?: boolean;
  /** Override by "METHOD /path". */
  handlers?: Record<string, MockHandler>;
}

const ok = (body: unknown): MockReply => ({ status: 200, body });
const fail = (status: number, code: number, msg: string): MockReply => ({ status, body: { code, msg } });

export function createMockBinance(o: MockOptions) {
  const calls: MockCall[] = [];
  let ids = 1000;
  const now = () => Date.now() + (o.skewMs ?? 0);
  const mark = o.mark ?? "80000";
  const bid = o.bid ?? "79999.9";
  const ask = o.ask ?? "80000.1";

  const defaults: Record<string, MockHandler> = {
    "GET /api/v3/time": () => ok({ serverTime: now() }),
    "GET /fapi/v1/time": () => ok({ serverTime: now() }),
    "GET /api/v3/exchangeInfo": () => ok(spotInfo),
    "GET /fapi/v1/exchangeInfo": () => ok(futuresInfo),
    "GET /api/v3/ticker/bookTicker": (p) => ok({ symbol: p.symbol, bidPrice: bid, askPrice: ask }),
    "GET /fapi/v1/ticker/bookTicker": (p) => ok({ symbol: p.symbol, bidPrice: bid, askPrice: ask }),
    "GET /api/v3/avgPrice": () => ok({ mins: 5, price: mark }),
    "GET /fapi/v1/premiumIndex": (p) => ok({ symbol: p.symbol, markPrice: mark, lastFundingRate: "0.0001" }),
    "GET /api/v3/account": () =>
      ok({ canTrade: true, commissionRates: { maker: "0.001", taker: "0.001", buyer: "0", seller: "0" }, balances: [{ asset: "USDT", free: o.balance ?? "10000", locked: "0" }] }),
    "GET /fapi/v2/balance": () => ok([{ asset: "USDT", balance: o.balance ?? "10000", crossUnPnl: "0", availableBalance: o.balance ?? "10000" }]),
    "GET /fapi/v2/positionRisk": () =>
      ok(
        (o.positions ?? []).map((p) => ({
          symbol: p.symbol,
          positionAmt: p.positionAmt,
          entryPrice: p.entryPrice ?? mark,
          markPrice: mark,
          unRealizedProfit: "0",
          liquidationPrice: "0",
          leverage: "5",
          marginType: "isolated",
          isolatedMargin: "100",
          positionSide: p.positionSide ?? "BOTH",
          notional: "0",
        })),
      ),
    "GET /fapi/v1/positionSide/dual": () => ok({ dualSidePosition: o.dualSide ?? false }),
    "GET /fapi/v1/leverageBracket": (p) =>
      ok([
        {
          symbol: p.symbol,
          brackets: [
            { bracket: 1, initialLeverage: 125, notionalCap: 50000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
            { bracket: 2, initialLeverage: 100, notionalCap: 600000, notionalFloor: 50000, maintMarginRatio: 0.005, cum: 50 },
            { bracket: 3, initialLeverage: 50, notionalCap: 3000000, notionalFloor: 600000, maintMarginRatio: 0.01, cum: 3050 },
          ],
        },
      ]),
    "GET /fapi/v1/commissionRate": (p) => ok({ symbol: p.symbol, makerCommissionRate: "0.0002", takerCommissionRate: "0.0005" }),
    "GET /fapi/v1/openOrders": () => ok([]),
    "GET /fapi/v1/openAlgoOrders": () => ok([]),
    "GET /api/v3/openOrders": () => ok([]),
    "POST /fapi/v1/marginType": () => ok({ code: 200, msg: "success" }),
    "POST /fapi/v1/leverage": (p) => ok({ leverage: Number(p.leverage), maxNotionalValue: "50000", symbol: p.symbol }),
    "POST /fapi/v1/order": (p) => {
      const market = p.type === "MARKET";
      return ok({
        orderId: ++ids,
        symbol: p.symbol,
        clientOrderId: p.newClientOrderId ?? `auto${ids}`,
        price: p.price ?? "0",
        avgPrice: market ? (p.side === "BUY" ? ask : bid) : "0",
        origQty: p.quantity ?? "0",
        executedQty: market ? (p.quantity ?? "0") : "0",
        status: market ? "FILLED" : "NEW",
        type: p.type,
        side: p.side,
        positionSide: p.positionSide ?? "BOTH",
        reduceOnly: p.reduceOnly === "true",
        stopPrice: p.stopPrice ?? "0",
      });
    },
    "DELETE /fapi/v1/order": (p) =>
      ok({ orderId: Number(p.orderId ?? ++ids), symbol: p.symbol, clientOrderId: p.origClientOrderId ?? "x", price: "0", origQty: "0", executedQty: "0", status: "CANCELED", type: "LIMIT", side: "BUY" }),
    "POST /fapi/v1/algoOrder": (p) =>
      ok({ algoId: ++ids, clientAlgoId: p.clientAlgoId, algoType: "CONDITIONAL", orderType: p.type, symbol: p.symbol, side: p.side, triggerPrice: p.triggerPrice, quantity: p.quantity ?? "0", algoStatus: "NEW" }),
    "DELETE /fapi/v1/allOpenOrders": () => ok({ code: 200, msg: "The operation of cancel all open order is done." }),
    "DELETE /fapi/v1/algoOpenOrders": () => ok({ code: 200, msg: "success" }),
    "POST /api/v3/orderList/opoco": (p) => ok(orderList(p)),
    "POST /api/v3/orderList/otoco": (p) => ok(orderList(p)),
  };

  function orderList(p: Record<string, string>) {
    const list = ++ids;
    return {
      orderListId: list,
      contingencyType: "OTO",
      listStatusType: "EXEC_STARTED",
      listOrderStatus: "EXECUTING",
      listClientOrderId: p.listClientOrderId,
      symbol: p.symbol,
      orderReports: [
        { symbol: p.symbol, orderId: ++ids, orderListId: list, clientOrderId: p.workingClientOrderId, price: p.workingPrice, origQty: p.workingQuantity, executedQty: "0", cummulativeQuoteQty: "0", status: "NEW", type: "LIMIT", side: "BUY" },
        { symbol: p.symbol, orderId: ++ids, orderListId: list, clientOrderId: p.pendingAboveClientOrderId, price: p.pendingAbovePrice, origQty: p.pendingQuantity ?? "0", executedQty: "0", status: "PENDING_NEW", type: "LIMIT_MAKER", side: "SELL" },
        { symbol: p.symbol, orderId: ++ids, orderListId: list, clientOrderId: p.pendingBelowClientOrderId, stopPrice: p.pendingBelowStopPrice, origQty: p.pendingQuantity ?? "0", executedQty: "0", status: "PENDING_NEW", type: "STOP_LOSS", side: "SELL" },
      ],
    };
  }

  const PUBLIC = /\/(time|exchangeInfo|bookTicker|avgPrice|premiumIndex)$/;

  function handle(method: string, url: string, headers: Record<string, string>): MockReply | "network_error" {
    const u = new URL(url);
    const raw = u.search.slice(1);
    const params = Object.fromEntries(u.searchParams.entries());
    calls.push({ method, path: u.pathname, params });
    if (!PUBLIC.test(u.pathname)) {
      if (headers["x-mbx-apikey"] !== o.apiKey) return fail(401, -2015, "Invalid API-key, IP, or permissions for action.");
      const idx = raw.lastIndexOf("&signature=");
      if (idx < 0) return fail(400, -1102, "Mandatory parameter 'signature' was not sent, was empty/null, or malformed.");
      if (sign(raw.slice(0, idx), o.secret) !== raw.slice(idx + 11)) return fail(400, -1022, "Signature for this request is not valid.");
      const ts = Number(params.timestamp);
      const win = Number(params.recvWindow ?? 5000);
      if (!(ts < now() + 1000 && now() - ts <= win)) return fail(400, -1021, "Timestamp for this request is outside of the recvWindow.");
    }
    const h = o.handlers?.[`${method} ${u.pathname}`] ?? defaults[`${method} ${u.pathname}`];
    if (!h) return fail(404, -5000, `Path ${u.pathname}, Method ${method} is invalid`);
    return h(params, calls);
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hdrs: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (hdrs[k] = v));
    const r = handle(init?.method ?? "GET", url, hdrs);
    if (r === "network_error") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", "x-mbx-used-weight-1m": "7" } });
  };

  /** Serves the same mock over HTTP (for running the web app against it). */
  function listen(port = 0): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") hdrs[k] = v;
      // HEAD is answered like GET without a body (readiness probes such as wait-on use HEAD).
      const head = req.method === "HEAD";
      const r = handle(head ? "GET" : (req.method ?? "GET"), `http://localhost${req.url}`, hdrs);
      if (r === "network_error") return void req.socket.destroy();
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(head ? undefined : JSON.stringify(r.body));
    });
    return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
  }

  return { fetch: fetchImpl, calls, listen, signedCalls: () => calls.filter((c) => c.params.signature) };
}
