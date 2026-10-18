/**
 * Local Binance simulator for end-to-end tests and demos (no real exchange, no real money).
 * Run the web app with BINANCE_TESTNET_SPOT_URL / BINANCE_TESTNET_FUTURES_URL pointing here and
 * save the testnet key below in /trade.
 *
 *   pnpm tsx scripts/mock-binance.ts            # http://127.0.0.1:9911
 */
import { createMockBinance } from "../packages/exchange/src/trade/__fixtures__/mock-binance";

export const MOCK_KEY = process.env.MOCK_BINANCE_KEY ?? "e2eMockApiKey0000000000000000001";
export const MOCK_SECRET = process.env.MOCK_BINANCE_SECRET ?? "e2eMockSecret000000000000000000001";
const port = Number(process.env.MOCK_BINANCE_PORT ?? 9911);

const mock = createMockBinance({ apiKey: MOCK_KEY, secret: MOCK_SECRET, balance: "10000" });
const { url } = await mock.listen(port);
console.info(`mock Binance on ${url} (key ${MOCK_KEY})`);
