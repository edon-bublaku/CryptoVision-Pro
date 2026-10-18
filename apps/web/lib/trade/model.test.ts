import { describe, expect, it } from "vitest";
import { decStr, newIntentId, riskQuantity, type Ticket, ticketFromQuery, ticketProblems, toRequest, tradeLink } from "./model";
import { bracketRequest, orderRequest } from "./schema";

const ticket = (o: Partial<Ticket> = {}): Ticket => ({
  env: "testnet",
  market: "futures",
  symbol: "btcusdt",
  side: "LONG",
  entryType: "LIMIT",
  price: "79800",
  quantity: "0.1137",
  stopLoss: "79000",
  targets: [
    { price: "81500", sizePct: "40" },
    { price: "", sizePct: "40" },
    { price: "85000", sizePct: "20" },
  ],
  leverage: "5",
  marginType: "ISOLATED",
  ...o,
});

describe("trade ticket model", () => {
  it("sizes from risk with entry and exit fees, flooring", () => {
    // 1% of 10 000 / (800 + (79 800 + 79 000) × 0.0005) = 100 / 879.4.
    expect(riskQuantity({ entry: 79800, stop: 79000, equity: 10000, riskPct: 1, feeRate: 0.0005 })).toBe("0.11371389");
    expect(riskQuantity({ entry: 100, stop: 100, equity: 1000, riskPct: 1, feeRate: 0 })).toBe("");
    expect(riskQuantity({ entry: 100, stop: 90, equity: 0, riskPct: 1, feeRate: 0 })).toBe("");
  });

  it("builds a valid request: drops empty targets, one 100% target on spot, no leverage on spot", () => {
    const r = toRequest(ticket());
    expect(r).toMatchObject({ symbol: "BTCUSDT", price: "79800", leverage: 5, marginType: "ISOLATED" });
    expect(r.takeProfits).toEqual([
      { price: "81500", sizePct: 40 },
      { price: "85000", sizePct: 20 },
    ]);
    expect(bracketRequest.parse(r)).toBeTruthy();
    const s = toRequest(ticket({ market: "spot" }));
    expect(s.takeProfits).toEqual([{ price: "81500", sizePct: 100 }]);
    expect(s.leverage).toBeUndefined();
    expect(toRequest(ticket({ entryType: "MARKET" })).price).toBeUndefined();
  });

  it("lists what blocks a preview", () => {
    expect(ticketProblems(ticket())).toEqual([]);
    expect(ticketProblems(ticket({ stopLoss: "", quantity: "0" }))).toEqual(["quantity", "stopLoss"]);
    expect(ticketProblems(ticket({ market: "spot", side: "SHORT" }))).toContain("spotShort");
    expect(ticketProblems(ticket({ market: "spot", targets: [{ price: "", sizePct: "100" }] }))).toContain("target");
  });

  it("round-trips a deep link from a plan", () => {
    const url = tradeLink({ market: "futures", symbol: "ETHUSDT", side: "SHORT", entryType: "LIMIT", entry: 2400.123456789, stopLoss: 2500, targets: [{ price: 2300, sizePct: 40 }, { price: 2200, sizePct: 60 }], leverage: 3.7 });
    const q = ticketFromQuery(new URL(url, "http://x").searchParams);
    expect(q).toMatchObject({ market: "futures", symbol: "ETHUSDT", side: "SHORT", entryType: "LIMIT", price: "2400.12345679", stopLoss: "2500", leverage: "3" });
    expect(q.targets).toEqual([
      { price: "2300", sizePct: "40" },
      { price: "2200", sizePct: "60" },
    ]);
    // A short without an explicit market goes to futures; garbage is ignored.
    expect(ticketFromQuery(new URLSearchParams("side=SHORT&symbol=x;drop&sl=-5&lev=900"))).toEqual({ side: "SHORT", market: "futures" });
  });

  it("formats numbers without exponents and makes valid intent ids", () => {
    expect(decStr(1e-7)).toBe("0.0000001");
    expect(decStr(0)).toBe("");
    const id = newIntentId();
    expect(id).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(orderRequest.shape.intentId.safeParse(id).success).toBe(true);
    expect(newIntentId()).not.toBe(id);
  });
});
