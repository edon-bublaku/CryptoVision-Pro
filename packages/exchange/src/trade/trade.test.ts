import { beforeEach, describe, expect, it } from "vitest";
import futuresInfo from "./__fixtures__/futures-exchange-info.json";
import { createMockBinance, type MockOptions } from "./__fixtures__/mock-binance";
import spotInfo from "./__fixtures__/spot-exchange-info.json";
import {
  BinanceClient,
  type BracketInput,
  cancelAllOrders,
  checkOrder,
  closeFuturesPosition,
  dec,
  executePlan,
  futuresBrackets,
  liquidationPrice,
  type MarketContext,
  parseSymbolRules,
  planBracket,
  resetClockOffsets,
  resetRulesCache,
  roundPrice,
  roundQty,
  sign,
  splitQuantity,
  symbolRules,
  toQuery,
} from "./index";

const KEY = "testkey";
const SECRET = "testsecret";
const futRules = parseSymbolRules("futures", futuresInfo.symbols.find((s) => s.symbol === "BTCUSDT"));
const spotRules = parseSymbolRules("spot", spotInfo.symbols[0]);

beforeEach(() => {
  resetClockOffsets();
  resetRulesCache();
});

describe("signing", () => {
  it("matches both HMAC examples from the Binance API documentation", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const ascii = toQuery({ symbol: "LTCBTC", side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: 1, price: 0.1, recvWindow: 5000, timestamp: 1499827319559 });
    expect(ascii).toBe("symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559");
    expect(sign(ascii, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
    const unicode = toQuery({ symbol: "１２３４５６", side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: 1, price: 0.1, recvWindow: 5000, timestamp: 1499827319559 });
    expect(unicode.startsWith("symbol=%EF%BC%91%EF%BC%92%EF%BC%93%EF%BC%94%EF%BC%95%EF%BC%96&")).toBe(true);
    expect(sign(unicode, secret)).toBe("e1353ec6b14d888f1164ae9af8228a3dbd508bc82eb867db8ab6046442f33ef3");
  });
});

describe("symbol rules", () => {
  it("parses futures and spot filters", () => {
    expect(futRules).toMatchObject({ tickSize: "0.10", stepSize: "0.0001", minQty: "0.0001", minNotional: "50", marketStepSize: "0.0001", percentPrice: { up: "1.0500", down: "0.9500" } });
    // MARKET_LOT_SIZE with step 0 falls back to LOT_SIZE.
    expect(spotRules).toMatchObject({ tickSize: "0.01000000", stepSize: "0.00001000", marketStepSize: "0.00001000", minNotional: "5.00000000", applyMinToMarket: true, opoAllowed: true });
  });

  it("rounds on the grid in Decimal, never up for quantities", () => {
    expect(roundPrice(futRules, "80000.06")).toBe("80000.1");
    expect(roundPrice(futRules, "80000.06", "down")).toBe("80000.0");
    expect(roundPrice(futRules, "0.30000000000000004")).toBe("0.3");
    expect(roundQty(futRules, "0.00019")).toBe("0.0001");
    expect(roundQty(spotRules, "0.123456789")).toBe("0.12345");
    expect(roundQty(futRules, "-1")).toBe("0.0000");
  });

  it("applies every filter the exchange would", () => {
    const base = { side: "BUY" as const, refPrice: "80000" };
    expect(checkOrder(futRules, { ...base, price: "80000.0", quantity: "0.0010" })).toEqual([]);
    expect(checkOrder(futRules, { ...base, price: "80000.05", quantity: "0.00015" })).toEqual(expect.arrayContaining(["price_tick", "qty_step"]));
    expect(checkOrder(futRules, { ...base, price: "80000", quantity: "0.0005" })).toContain("notional_below_min");
    // Reduce-only futures orders are exempt from the minimum notional.
    expect(checkOrder(futRules, { ...base, stopPrice: "79000", quantity: "0.0005", market: true, reduceOnly: true })).toEqual([]);
    expect(checkOrder(futRules, { ...base, price: "90000", quantity: "0.001", band: true })).toContain("price_out_of_band");
    expect(checkOrder(spotRules, { ...base, price: "500000", quantity: "0.001", band: true })).toContain("price_out_of_band");
  });

  it("splits a position across targets exactly, merging tranches below the minimum", () => {
    expect(splitQuantity(futRules, "0.0123", [40, 40, 20])).toEqual(["0.0049", "0.0049", "0.0025"]);
    expect(splitQuantity(futRules, "0.0002", [40, 40, 20])).toEqual(["0.0000", "0.0000", "0.0002"]);
    expect(splitQuantity(futRules, "1", [33, 33, 34]).reduce((a, q) => a.plus(q), dec(0)).toFixed()).toBe("1");
  });

  it("liquidation follows Binance's single-position formula", () => {
    const lp = liquidationPrice("LONG", dec(80000), dec(1), dec(16000), 0.004, 0)!;
    // E(1 − 1/L)/(1 − mmr) with L = 5.
    expect(lp.toNumber()).toBeCloseTo((80000 * 0.8) / 0.996, 6);
    const sp = liquidationPrice("SHORT", dec(80000), dec(1), dec(16000), 0.004, 0)!;
    expect(sp.toNumber()).toBeCloseTo((80000 * 1.2) / 1.004, 6);
    expect(liquidationPrice("LONG", dec(80000), dec(1), dec(100000), 0.004, 0)).toBeNull();
  });
});

const futCtx = (o: Partial<MarketContext> = {}): MarketContext => ({
  rules: futRules,
  refPrice: "80000",
  bid: "79999.9",
  ask: "80000.1",
  makerFee: "0.0002",
  takerFee: "0.0005",
  equity: "10000",
  available: "10000",
  maxRiskPct: 2,
  brackets: [
    { initialLeverage: 125, notionalCap: 50000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
    { initialLeverage: 100, notionalCap: 600000, notionalFloor: 50000, maintMarginRatio: 0.005, cum: 50 },
  ],
  dualSide: false,
  positionAmt: "0",
  ...o,
});

const longInput = (o: Partial<BracketInput> = {}): BracketInput => ({
  market: "futures",
  symbol: "BTCUSDT",
  side: "LONG",
  entryType: "MARKET",
  quantity: "0.01234",
  stopLoss: "79000.04",
  takeProfits: [
    { price: "81500", sizePct: 40 },
    { price: "83000", sizePct: 40 },
    { price: "85000", sizePct: 20 },
  ],
  leverage: 5,
  marginType: "ISOLATED",
  ...o,
});

describe("futures plan", () => {
  it("rounds, sizes the exits and prices risk with fees", () => {
    const p = planBracket(longInput(), futCtx(), "cvT");
    expect(p.errors).toEqual([]);
    expect(p).toMatchObject({ quantity: "0.0123", stopLoss: "79000", entryPrice: "80000.1", leverage: 5 });
    expect(p.targets.map((t) => t.quantity)).toEqual(["0.0049", "0.0049", "0.0025"]);
    // 0.0123 × 1000.1 + entry fee 0.0123 × 80000.1 × 0.0005 + stop fee 0.0123 × 79000 × 0.0005.
    expect(p.riskAmount).toBe("13.2791");
    expect(p.margin).toBe("196.8002");
    expect(Number(p.liquidation)).toBeCloseTo((80000.1 * 0.8) / 0.996, 0);
    expect(p.orders.map((o) => o.role)).toEqual(["margin_type", "leverage", "entry", "stop", "take_profit", "take_profit", "take_profit"]);
    expect(p.orders[3]!.params).toMatchObject({ type: "STOP_MARKET", side: "SELL", triggerPrice: "79000", closePosition: "true", workingType: "MARK_PRICE", clientAlgoId: "cvTs" });
    expect(p.orders[4]!.params).toMatchObject({ type: "TAKE_PROFIT_MARKET", reduceOnly: "true", quantity: "0.0049", triggerPrice: "81500" });
    expect(p.orders[3]!.params.quantity).toBeUndefined();
  });

  it("refuses stops on the wrong side, oversize risk, leverage beyond the bracket and liquidation before the stop", () => {
    const codes = (i: Partial<BracketInput>, c: Partial<MarketContext> = {}) => planBracket(longInput(i), futCtx(c), "cv").errors.map((e) => e.code);
    expect(codes({ stopLoss: "80500" })).toEqual(expect.arrayContaining(["stop_wrong_side", "stop_would_trigger"]));
    expect(codes({ takeProfits: [{ price: "79500", sizePct: 100 }] })).toContain("target_wrong_side");
    expect(codes({}, { equity: "100" })).toContain("risk_above_cap");
    expect(codes({ quantity: "0.8", leverage: 120 }, { equity: "1000000", available: "1000000" })).toContain("leverage_above_bracket");
    expect(codes({ leverage: 50, stopLoss: "78000" })).toContain("liquidation_before_stop");
    expect(codes({}, { positionAmt: "0.5" })).toContain("position_exists");
    expect(codes({ quantity: "0.0005" })).toContain("filter:notional_below_min");
    expect(codes({ leverage: 0 })).toContain("leverage_required");
  });

  it("uses positionSide and no reduceOnly in hedge mode", () => {
    const p = planBracket(longInput(), futCtx({ dualSide: true }), "cv");
    for (const o of p.orders.filter((x) => ["entry", "stop", "take_profit"].includes(x.role))) {
      expect(o.params.positionSide).toBe("LONG");
      expect(o.params.reduceOnly).toBeUndefined();
    }
  });

  it("rounds a LIMIT entry so it never pays more than asked", () => {
    const p = planBracket(longInput({ entryType: "LIMIT", price: "79800.07" }), futCtx(), "cv");
    expect(p.entryPrice).toBe("79800");
    expect(p.orders[2]!.params).toMatchObject({ type: "LIMIT", price: "79800", timeInForce: "GTC" });
  });
});

describe("spot plan", () => {
  const spotCtx = (o: Partial<MarketContext> = {}): MarketContext => ({ ...futCtx(), rules: spotRules, makerFee: "0.001", takerFee: "0.001", brackets: undefined, ...o });
  const spotIn = (o: Partial<BracketInput> = {}): BracketInput => ({ ...longInput({ market: "spot", quantity: "0.012345", takeProfits: [{ price: "84000", sizePct: 100 }], leverage: undefined }), ...o });

  it("caps a market entry at ask + slippage and protects it with an OPOCO", () => {
    const p = planBracket(spotIn(), spotCtx(), "cvS");
    expect(p.errors).toEqual([]);
    expect(p.workingPrice).toBe("80400.10");
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0]!.path).toBe("/api/v3/orderList/opoco");
    expect(p.orders[0]!.params).toMatchObject({
      workingType: "LIMIT",
      workingSide: "BUY",
      workingQuantity: "0.01234",
      workingPrice: "80400.10",
      pendingSide: "SELL",
      pendingAboveType: "LIMIT_MAKER",
      pendingAbovePrice: "84000",
      pendingBelowType: "STOP_LOSS",
      pendingBelowStopPrice: "79000.04",
    });
    expect(p.orders[0]!.params.pendingQuantity).toBeUndefined();
    // Risk from the worst accepted fill (80400.10), not the quote: 0.01234 × 1400.06 + fees at 0.1%.
    expect(Number(p.riskAmount)).toBeCloseTo(0.01234 * (80400.1 - 79000.04) + 0.01234 * 80400.1 * 0.001 + 0.01234 * 79000.04 * 0.001, 4);
  });

  it("falls back to OTOCO with the commission deducted when OPO isn't available", () => {
    const p = planBracket(spotIn(), spotCtx({ rules: { ...spotRules, opoAllowed: false } }), "cv");
    expect(p.orders[0]!.path).toBe("/api/v3/orderList/otoco");
    // floor(0.01234 × (1 − 0.001)) on a 0.00001 step.
    expect(p.orders[0]!.params.pendingQuantity).toBe("0.01232");
    expect(p.warnings.map((w) => w.code)).toContain("fee_dust");
  });

  it("is long-only, needs a target and checks the quote balance", () => {
    const codes = (i: Partial<BracketInput>, c: Partial<MarketContext> = {}) => planBracket(spotIn(i), spotCtx(c), "cv").errors.map((e) => e.code);
    expect(codes({ side: "SHORT", stopLoss: "81000", takeProfits: [{ price: "76000", sizePct: 100 }] })).toContain("spot_long_only");
    expect(codes({ takeProfits: [] })).toContain("target_required");
    expect(codes({}, { available: "500" })).toContain("insufficient_balance");
  });
});

function client(market: "spot" | "futures", mock: ReturnType<typeof createMockBinance>) {
  return new BinanceClient({ market, env: "testnet", apiKey: KEY, secret: SECRET, baseUrl: "http://mock", fetch: mock.fetch });
}

function mockOf(o: Partial<MockOptions> = {}) {
  return createMockBinance({ apiKey: KEY, secret: SECRET, ...o });
}

const signedPaths = (m: ReturnType<typeof createMockBinance>) => m.signedCalls().map((c) => `${c.method} ${c.path}`);

describe("client", () => {
  it("signs requests the mock verifies, and compensates clock skew", async () => {
    const m = mockOf({ skewMs: 30_000 });
    const c = client("futures", m);
    await expect(futuresBrackets(c, "BTCUSDT")).resolves.toHaveLength(3);
    expect(signedPaths(m)).toEqual(["GET /fapi/v1/leverageBracket"]);
  });

  it("resyncs the clock once after -1021 and retries", async () => {
    let n = 0;
    const m = mockOf({ handlers: { "POST /fapi/v1/leverage": (p) => (n++ === 0 ? { status: 400, body: { code: -1021, msg: "Timestamp for this request is outside of the recvWindow." } } : { status: 200, body: { leverage: Number(p.leverage), symbol: p.symbol } }) } });
    const c = client("futures", m);
    await expect(c.signed("POST", "/fapi/v1/leverage", { symbol: "BTCUSDT", leverage: 5 })).resolves.toMatchObject({ leverage: 5 });
    expect(m.calls.filter((x) => x.path === "/fapi/v1/time")).toHaveLength(2);
  });

  it("rejects a wrong secret with Binance's error code", async () => {
    const m = mockOf();
    const c = new BinanceClient({ market: "futures", env: "testnet", apiKey: KEY, secret: "wrong", baseUrl: "http://mock", fetch: m.fetch });
    await expect(c.signed("GET", "/fapi/v2/balance")).rejects.toMatchObject({ code: -1022, status: 400 });
  });

  it("never lets a base URL override reach live", () => {
    const c = new BinanceClient({ market: "futures", env: "live", apiKey: KEY, secret: SECRET, baseUrl: "http://evil" });
    expect(c.baseUrl).toBe("https://fapi.binance.com");
  });

  it("loads symbol rules from exchangeInfo and caches them", async () => {
    const m = mockOf();
    const c = client("futures", m);
    await symbolRules(c, "BTCUSDT");
    await symbolRules(c, "ETHUSDT");
    expect(m.calls.filter((x) => x.path.endsWith("exchangeInfo"))).toHaveLength(1);
    await expect(symbolRules(c, "NOPEUSDT")).rejects.toMatchObject({ code: -1121 });
  });
});

describe("futures execution", () => {
  const plan = (i: Partial<BracketInput> = {}, c: Partial<MarketContext> = {}) => planBracket(longInput(i), futCtx(c), "cvX");

  it("sends margin type, leverage, entry, stop, then take-profits", async () => {
    const m = mockOf();
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("placed");
    expect(signedPaths(m)).toEqual([
      "POST /fapi/v1/marginType",
      "POST /fapi/v1/leverage",
      "POST /fapi/v1/order",
      "POST /fapi/v1/algoOrder",
      "POST /fapi/v1/algoOrder",
      "POST /fapi/v1/algoOrder",
      "POST /fapi/v1/algoOrder",
    ]);
    expect(r.entry).toMatchObject({ status: "FILLED", executedQty: "0.0123" });
  });

  it("treats 'no need to change margin type' as success", async () => {
    const m = mockOf({ handlers: { "POST /fapi/v1/marginType": () => ({ status: 400, body: { code: -4046, msg: "No need to change margin type." } }) } });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("placed");
    expect(r.steps[0]!.ok).toBe(true);
  });

  it("closes a market entry at once when the stop is rejected", async () => {
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/algoOrder": (p) => (p.type === "STOP_MARKET" ? { status: 400, body: { code: -2021, msg: "Order would immediately trigger." } } : { status: 200, body: {} }),
      },
    });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("reverted");
    const orders = m.signedCalls().filter((c) => c.path === "/fapi/v1/order");
    expect(orders).toHaveLength(2);
    expect(orders[1]!.params).toMatchObject({ side: "SELL", type: "MARKET", reduceOnly: "true", quantity: "0.0123", newClientOrderId: "cvXx" });
    // No take-profit is placed for a position that no longer exists.
    expect(m.signedCalls().filter((c) => c.params.type === "TAKE_PROFIT_MARKET")).toHaveLength(0);
  });

  it("cancels a limit entry when the stop is rejected, and closes what already filled", async () => {
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/algoOrder": () => ({ status: 400, body: { code: -2021, msg: "Order would immediately trigger." } }),
        "DELETE /fapi/v1/order": (p) => ({ status: 200, body: { orderId: 1, symbol: p.symbol, clientOrderId: p.origClientOrderId, price: "79800", origQty: "0.0123", executedQty: "0.0040", status: "CANCELED", type: "LIMIT", side: "BUY" } }),
      },
    });
    const r = await executePlan(client("futures", m), plan({ entryType: "LIMIT", price: "79800" }), futRules);
    expect(r.status).toBe("reverted");
    expect(signedPaths(m).slice(-2)).toEqual(["DELETE /fapi/v1/order", "POST /fapi/v1/order"]);
    expect(m.signedCalls().at(-1)!.params).toMatchObject({ type: "MARKET", quantity: "0.0040", reduceOnly: "true" });
  });

  it("reports 'unknown' when neither the stop nor the revert goes through", async () => {
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/algoOrder": () => ({ status: 400, body: { code: -2021, msg: "Order would immediately trigger." } }),
        "POST /fapi/v1/order": (p) =>
          p.reduceOnly
            ? { status: 400, body: { code: -2022, msg: "ReduceOnly Order is rejected." } }
            : { status: 200, body: { orderId: 7, symbol: p.symbol, clientOrderId: p.newClientOrderId, price: "0", origQty: p.quantity, executedQty: p.quantity, status: "FILLED", type: "MARKET", side: p.side } },
      },
    });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("unknown");
  });

  it("looks the entry up by client id when the response is lost, instead of sending it twice", async () => {
    let sent = 0;
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/order": () => {
          sent++;
          return "network_error";
        },
        "GET /fapi/v1/order": (p) => ({ status: 200, body: { orderId: 9, symbol: p.symbol, clientOrderId: p.origClientOrderId, price: "0", origQty: "0.0123", executedQty: "0.0123", avgPrice: "80000.1", status: "FILLED", type: "MARKET", side: "BUY" } }),
      },
    });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(sent).toBe(1);
    expect(r.status).toBe("placed");
    expect(m.signedCalls().find((c) => c.method === "GET" && c.path === "/fapi/v1/order")!.params.origClientOrderId).toBe("cvXe");
  });

  it("stops when a lost entry turns out not to exist", async () => {
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/order": () => ({ status: 503, body: { code: -1007, msg: "Timeout waiting for response from backend server. Send status unknown; execution status unknown." } }),
        "GET /fapi/v1/order": () => ({ status: 400, body: { code: -2013, msg: "Order does not exist." } }),
      },
    });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("failed");
    expect(m.signedCalls().filter((c) => c.path === "/fapi/v1/algoOrder")).toHaveLength(0);
  });

  it("falls back to the classic order endpoint where the algo service is missing", async () => {
    const m = mockOf({ handlers: { "POST /fapi/v1/algoOrder": () => ({ status: 404, body: { code: -5000, msg: "Path /fapi/v1/algoOrder, Method POST is invalid" } }) } });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("placed");
    const stop = m.signedCalls().find((c) => c.path === "/fapi/v1/order" && c.params.type === "STOP_MARKET")!;
    expect(stop.params).toMatchObject({ stopPrice: "79000", closePosition: "true", newClientOrderId: "cvXs" });
    expect(stop.params.algoType).toBeUndefined();
  });

  it("sizes take-profits to a partial market fill", async () => {
    const m = mockOf({
      handlers: {
        "POST /fapi/v1/order": (p) => ({ status: 200, body: { orderId: 5, symbol: p.symbol, clientOrderId: p.newClientOrderId, price: "0", origQty: p.quantity, executedQty: "0.0100", status: "EXPIRED", type: "MARKET", side: p.side } }),
      },
    });
    const r = await executePlan(client("futures", m), plan(), futRules);
    expect(r.status).toBe("placed");
    const q = m.signedCalls().filter((c) => c.params.type === "TAKE_PROFIT_MARKET").map((c) => c.params.quantity);
    expect(q).toEqual(["0.0040", "0.0040", "0.0020"]);
  });

  it("refuses to execute a plan with errors", async () => {
    const m = mockOf();
    await expect(executePlan(client("futures", m), plan({ stopLoss: "81000" }), futRules)).rejects.toThrow();
    expect(m.signedCalls()).toHaveLength(0);
  });

  it("closes a position and then clears the symbol's orders", async () => {
    const m = mockOf();
    const steps = await closeFuturesPosition(client("futures", m), futRules, { symbol: "BTCUSDT", positionAmt: "-0.0123" }, "cvC");
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(signedPaths(m)).toEqual(["POST /fapi/v1/order", "DELETE /fapi/v1/allOpenOrders", "DELETE /fapi/v1/algoOpenOrders"]);
    expect(m.signedCalls()[0]!.params).toMatchObject({ side: "BUY", reduceOnly: "true", quantity: "0.0123", type: "MARKET" });
  });
});

describe("spot execution", () => {
  it("places the whole bracket in one order list", async () => {
    const m = mockOf();
    const p = planBracket(
      { ...longInput({ market: "spot", quantity: "0.01", takeProfits: [{ price: "84000", sizePct: 100 }] }), leverage: undefined },
      { ...futCtx(), rules: spotRules, makerFee: "0.001", takerFee: "0.001", brackets: undefined },
      "cvP",
    );
    const r = await executePlan(client("spot", m), p, spotRules);
    expect(r.status).toBe("placed");
    expect(signedPaths(m)).toEqual(["POST /api/v3/orderList/opoco"]);
    expect(r.entry?.status).toBe("NEW");
  });

  it("cancels all open orders on a symbol", async () => {
    const m = mockOf({ handlers: { "DELETE /api/v3/openOrders": () => ({ status: 200, body: [] }) } });
    const steps = await cancelAllOrders(client("spot", m), "BTCUSDT");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.ok).toBe(true);
  });
});
