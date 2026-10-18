# CLAUDE.md — CryptoVision Pro

> Platformë profesionale për analizë të kriptovalutave, gjenerim sinjalesh (BLEJ / SHIT / PRIT),
> menaxhim pozicionesh dhe charting interaktiv me mjete vizatimi.
>
> Ky dokument është **burimi i vetëm i së vërtetës** për çdo agjent (Claude Code) që punon në këtë repo.
> Lexoje të plotë para çdo detyre. Kur një vendim nuk mbulohet këtu, zgjidh opsionin më të sigurt,
> më të testueshëm dhe më të thjeshtë, dhe dokumentoje në `docs/decisions/` (ADR).

---

## 0. Misioni dhe parimet bazë

**Misioni:** T'i japë përdoruesit një pamje të qartë, të bazuar në të dhëna, se **cilin coin**,
**kur** dhe **me çfarë pozicioni** (entry, stop-loss, take-profit, madhësia) mund të tregtojë,
me shpjegim transparent *pse*, dhe me mjete profesionale charting për analizën e vet.

**Parimet që nuk negociohen:**

1. **Transparencë mbi magjinë.** Çdo sinjal duhet të ketë: skorin, faktorët që e prodhuan,
   peshat, kohën e gjenerimit, timeframe-in dhe nivelin e besueshmërisë. Asnjë "black box".
2. **Probabilitet, jo premtim.** UI nuk përdor kurrë fjalë si "garantuar", "fitim i sigurt", "100%".
   Sinjalet shprehen si probabilitet/konfluencë dhe çdo sinjal ka gjithmonë stop-loss.
3. **Menaxhimi i rrezikut është i detyrueshëm.** Asnjë rekomandim pozicioni pa stop-loss,
   pa raport Risk:Reward dhe pa madhësi pozicioni të llogaritur nga % e rrezikut të llogarisë.
4. **Çdo strategji është e backtestuar.** Asnjë strategji sinjalesh nuk shfaqet në prodhim pa
   rezultate backtest + walk-forward të ruajtura dhe të dukshme për përdoruesin.
5. **Saktësi numerike.** Çmimet dhe sasitë përdorin `decimal.js` / `Decimal` — kurrë `float`
   për llogaritje financiare që shfaqen ose ruhen.
6. **Real-time, por i qëndrueshëm.** WebSocket me reconnect, backoff, heartbeat dhe fallback REST.
7. **Disclaimer ligjor** i dukshëm: "Ky nuk është këshillë financiare. Tregtimi i kriptovalutave
   mbart rrezik të lartë humbjeje." — në footer, në faqen e sinjaleve dhe në onboarding.

---

## 1. Stack-u teknologjik

| Shtresa | Teknologjia | Arsyeja |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | Ndarje e pastër paketash, cache build |
| Frontend | **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)** | Routing, performancë, eksport statik |
| UI | **Tailwind CSS v4 + shadcn/ui + Radix + lucide-react** | Komponentë të aksesueshëm, dark-first |
| Charting | **TradingView Lightweight Charts v5** + shtresë custom vizatimi (Series Primitives) | Falas, i shpejtë, i zgjerueshëm |
| State (client) | **Zustand** (UI/chart state) + **TanStack Query v5** (server state) | Ndarje e qartë |
| Validim | **Zod** kudo (API input/output, env, WS payloads) | Type-safety në runtime |
| Backend API | **Next.js Route Handlers** + **tRPC** (ose Hono) për API të tipizuar | End-to-end types |
| Worker | **Node.js + BullMQ** (`apps/worker`) | Llogaritje sinjalesh, skanime, alerte |
| DB | **PGlite** (PostgreSQL në WASM, i integruar, default) ose **PostgreSQL 16 + TimescaleDB** ([ADR 0005](docs/decisions/0005-self-contained-platform.md)) | Zero instalim; e njëjta skemë në prodhim |
| ORM | **Drizzle ORM** + migrime SQL | Tipizim i fortë, SQL transparent |
| Cache / PubSub | Bus në memorie (default) ose **Redis** kur ka disa procese | Pub/sub për sinjale live, rate-limit |
| Auth | Auth e vetë-implementuar: email + fjalëkalim (scrypt), sesione në DB, 2FA TOTP ([ADR 0003](docs/decisions/0003-custom-auth.md)) | Siguri, sesione të revokueshme |
| Real-time te klienti | **Server-Sent Events** ose WS (`apps/realtime`) | Push sinjalesh/alertesh |
| Njoftime | Web Push, Email (Resend), Telegram Bot | Alerte |
| AI (opsionale) | Claude API, modeli nga `AI_MODEL` (default `claude-opus-5-5`), streaming | Shpjegim natyral i sinjaleve |
| Testim | **Vitest** (unit), **Playwright** (e2e), **fast-check** (property-based për indikatorët) | Besueshmëri |
| Observability | **Pino** logs, **OpenTelemetry**, Sentry | Debug në prodhim |
| Deploy | `pnpm build && pnpm start` në një server me disk. Me disa instanca: PostgreSQL + Redis + `WORKER=external` | |

---

## 2. Struktura e repo-s

```
cryptovision/
├── CLAUDE.md
├── apps/
│   ├── web/                    # Next.js app (UI + API routes)
│   │   ├── app/
│   │   │   ├── (marketing)/    # landing, pricing, disclaimer
│   │   │   ├── (auth)/         # login, register, 2fa
│   │   │   ├── dashboard/      # përmbledhje tregu + top sinjale
│   │   │   ├── chart/[symbol]/ # chart i plotë + vizatime + indikatorë
│   │   │   ├── signals/        # lista e sinjaleve, filtra, historik
│   │   │   ├── screener/       # skaner coinash me kritere
│   │   │   ├── portfolio/      # pozicione, PnL, alokim
│   │   │   ├── backtest/       # laborator backtest-i
│   │   │   ├── alerts/         # menaxhim alertesh
│   │   │   └── settings/
│   │   ├── components/
│   │   ├── features/           # feature-sliced: chart, signals, portfolio...
│   │   └── lib/
│   ├── worker/                 # BullMQ jobs: ingest, compute, scan, alert
│   └── realtime/               # WS/SSE gateway (opsional, nëse ndahet)
├── packages/
│   ├── core/                   # tipe të përbashkëta, Decimal utils, konstante
│   ├── exchange/               # adaptorë: Binance, Bybit, OKX, Coinbase, CoinGecko
│   ├── indicators/             # indikatorë teknikë (pure functions, incremental)
│   ├── signals/                # motori i sinjaleve + strategjitë
│   ├── risk/                   # position sizing, SL/TP, R:R, Kelly, VaR
│   ├── backtest/               # motor backtest + walk-forward + metrika
│   ├── drawing/                # modeli i të dhënave + render i vizatimeve në chart
│   ├── db/                     # Drizzle schema + migrime + seed
│   ├── ui/                     # komponentë shadcn të përbashkët
│   └── config/                 # eslint, tsconfig, tailwind preset
├── docs/
│   ├── decisions/              # ADR-të
│   ├── strategies/             # dokumentim i çdo strategjie + rezultate backtest
│   └── api.md
└── .env.example
```

**Rregull varësie:** `apps/*` → `packages/*`. Paketat `indicators`, `risk`, `signals`, `backtest`
**nuk** importojnë asgjë nga `apps/`, DB apo rrjeti — janë **pure** dhe 100% të testueshme.

---

## 3. Burimet e të dhënave

### 3.1 Të dhëna tregu
- **Binance** (primar): REST `/api/v3/klines`, `/api/v3/ticker/24hr`, `/api/v3/depth`;
  WS `<symbol>@kline_<tf>`, `@aggTrade`, `@depth20@100ms`, `!miniTicker@arr`.
- **Bybit / OKX** (sekondarë + derivate): funding rate, open interest, long/short ratio.
- **CoinGecko**: market cap, kategori, rank, supply, ATH/ATL, metadata coinash.
- **alternative.me Fear & Greed Index**: sentimenti i përgjithshëm.
- (Opsionale) **CryptoPanic / RSS** për lajme; **Glassnode/CryptoQuant** për on-chain nëse ka API key.

### 3.2 Rregullat e ingest-it
- Çdo adaptor implementon interface-in `ExchangeAdapter` në `packages/exchange`:
  ```ts
  interface ExchangeAdapter {
    id: ExchangeId;
    getCandles(q: CandleQuery): Promise<Candle[]>;
    subscribeCandles(q: CandleSub, onCandle: (c: Candle, closed: boolean) => void): Unsubscribe;
    getTicker24h(symbols?: string[]): Promise<Ticker[]>;
    getOrderBook(symbol: string, depth: number): Promise<OrderBook>;
    getFunding?(symbol: string): Promise<FundingInfo>;
    getOpenInterest?(symbol: string): Promise<OpenInterest>;
  }
  ```
- **Rate limiting** me token bucket për çdo exchange (respekto header-at `X-MBX-USED-WEIGHT`).
- **Retry** me exponential backoff + jitter; circuit breaker pas 5 dështimesh radhazi.
- **WebSocket**: ping/pong, reconnect automatik (1s → 2s → 4s … max 30s), resubscribe,
  dhe **gap-fill** me REST për candle-t e humbura gjatë shkëputjes.
- Candle-t ruhen në hypertable `candles(exchange, symbol, timeframe, open_time, o,h,l,c,v, ...)`
  me `UNIQUE(exchange, symbol, timeframe, open_time)` dhe upsert idempotent.
- Timeframes të mbështetura: `1m, 5m, 15m, 1h, 4h, 1d, 1w`. Timeframes më të larta agregohen
  nga ato më të ulëta me continuous aggregates të Timescale.
- **Universi i coinave:** top 200 sipas volumit në USDT, me filtra: volum 24h > $5M,
  përjashto stablecoin-et, wrapped tokens dhe leveraged tokens (`UP/DOWN/BULL/BEAR`).

---

## 4. Motori i Analizës

### 4.1 Indikatorët (`packages/indicators`)
Të gjithë si **funksione pure** me dy API:
- `batch(candles, params) → series[]` (për historik / backtest)
- `incremental(state, candle) → { state, value }` (për live, O(1) për candle)

**Lista minimale:**
- **Trend:** SMA, EMA, WMA, HMA, VWMA, VWAP (session + anchored), Ichimoku, SuperTrend,
  Parabolic SAR, ADX/DMI, Aroon.
- **Momentum:** RSI, Stochastic, StochRSI, MACD, CCI, Williams %R, ROC, MFI, TSI.
- **Volatilitet:** ATR, Bollinger Bands (+ %B, Bandwidth), Keltner Channels, Donchian, Historical Volatility.
- **Volum:** OBV, CMF, A/D Line, Volume Profile (VPVR, POC, VAH/VAL), CVD (nga aggTrades).
- **Strukturë:** Pivot Points (Classic/Fibonacci/Camarilla), swing highs/lows (fractals),
  Support/Resistance automatike (clustering i pivot-eve me DBSCAN/KDE), trendlines automatike,
  Fibonacci retracement/extension automatike, Market Structure (HH/HL/LH/LL, BOS, CHoCH),
  Order Blocks dhe Fair Value Gaps (SMC).
- **Divergjenca:** RSI/MACD/OBV divergjenca të rregullta dhe të fshehura.
- **Patterns:** candlestick (engulfing, hammer, doji, morning/evening star, …) dhe chart patterns
  (double top/bottom, H&S, triangles, flags, wedges) me score besueshmërie.

**Kërkesë testimi:** çdo indikator krahasohet me vlera referencë (TA-Lib / TradingView) me
tolerancë `1e-8`, + teste property-based (p.sh. RSI ∈ [0,100], BB upper ≥ middle ≥ lower).

### 4.2 Regjimi i tregut
Para çdo sinjali, klasifiko regjimin për çdo coin/timeframe:
`TRENDING_UP | TRENDING_DOWN | RANGING | HIGH_VOLATILITY | LOW_LIQUIDITY`
(bazuar në ADX, pjerrësinë e EMA200, ATR% percentile, Bollinger Bandwidth dhe volumin).
Strategjitë deklarojnë në cilat regjime janë të vlefshme; jashtë tyre sinjali shtypet.

### 4.3 Motori i Sinjaleve (`packages/signals`)

**Arkitektura: Multi-Factor Confluence Scoring**

```ts
interface Factor {
  id: string;                     // p.sh. "rsi_oversold_bounce"
  category: 'trend' | 'momentum' | 'volatility' | 'volume' | 'structure' | 'sentiment' | 'derivatives';
  evaluate(ctx: AnalysisContext): FactorResult; // { score: -1..+1, weight, explanation, evidence }
}

interface Strategy {
  id: string;
  name: string;
  timeframes: Timeframe[];
  regimes: MarketRegime[];
  factors: Factor[];
  entryRule(ctx, score): EntryDecision | null;
  exitRule(ctx, position): ExitDecision | null;
  risk: RiskTemplate;             // si llogariten SL/TP
}
```

**Llogaritja e skorit:**
1. Çdo faktor jep `score ∈ [-1, +1]` dhe `weight`.
2. Skori total: `S = Σ(score·weight) / Σ(weight)` → shkallëzohet në `0..100`
   (50 = neutral; ≥60 = BLEJ, ≥75 = BLEJ FORT; ≤40 = SHIT, ≤25 = SHIT FORT — `SCORE_THRESHOLDS`).
3. **Multi-Timeframe Confirmation:** sinjali në TF-në e ekzekutimit (p.sh. 1h) kërkon
   që TF-ja më e lartë (4h/1d) të mos jetë kundër. Konflikt → besueshmëria ulet ose sinjali bllokohet.
4. **Confidence** = f(numri i faktorëve në pajtim, forca e regjimit, win-rate historik i
   strategjisë në këtë coin/regjim nga backtest-i).
5. Sinjali gjenerohet **vetëm në mbylljen e candle-s** (asnjë repaint). Live preview i shënuar qartë si "në formim".

**Llojet e sinjaleve në output:**
`STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL` + `EXIT_LONG | EXIT_SHORT | TAKE_PARTIAL`

**Objekti i sinjalit (kontrata e UI):**
```ts
interface Signal {
  id: string;
  symbol: string; exchange: ExchangeId; timeframe: Timeframe;
  side: 'LONG' | 'SHORT';
  action: SignalAction;
  score: number;            // 0..100
  confidence: number;       // 0..1
  regime: MarketRegime;
  entry: { type: 'MARKET' | 'LIMIT' | 'STOP'; price: Decimal; zone?: [Decimal, Decimal] };
  stopLoss: Decimal;
  takeProfits: { price: Decimal; sizePct: number; rr: number }[]; // TP1/TP2/TP3
  riskReward: number;
  invalidation: string;     // "Mbyllje 4h nën 61,200 e zhvlerëson setup-in"
  factors: FactorResult[];  // shpjegimi i plotë
  strategyId: string;
  backtestStats: { winRate: number; profitFactor: number; trades: number; maxDD: number };
  createdAt: Date; expiresAt: Date;
  status: 'ACTIVE' | 'TRIGGERED' | 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED';
}
```

**Strategjitë fillestare (secila e dokumentuar në `docs/strategies/`):**
1. **Trend Pullback** — EMA20/50/200 të renditura, pullback në EMA50 ose zonë demand, RSI 40–50 kthim lart, volum konfirmues.
2. **Breakout me Volum** — thyerje rezistence/range me volum > 2× mesatares 20, mbyllje mbi nivel, retest opsional.
3. **Mean Reversion** — vetëm në regjim RANGING: prekje e BB të poshtme + RSI < 30 + divergjencë bullish.
4. **Momentum MACD/ADX** — kryqëzim MACD me ADX > 25 dhe DI+ > DI−.
5. **SMC** — BOS/CHoCH + kthim në Order Block / FVG me konfluencë Fibonacci 0.618–0.786.
6. **Derivatives Sentiment** — funding ekstrem + OI në rritje + çmim kundër (short/long squeeze setup).

Sinjalet e ç'do strategjie bashkohen në **Signal Aggregator** që eliminon dublikatat dhe
konfliktet (një coin = një sinjal aktiv për drejtim/timeframe).

### 4.4 Rreziku dhe Pozicionet (`packages/risk`)
- **Stop-loss**: `max(strukturor, ATR-based)` — p.sh. nën swing low-in e fundit − 0.5×ATR(14);
  kurrë më afër se 1×ATR, kurrë më larg se `maxStopPct` (konfigurueshëm, default 8%).
- **Take-profit**: TP1 = 1.5R (mbyll 40%), TP2 = 3R (mbyll 40%), TP3 = trailing (20%) ose nivel rezistence.
  Pas TP1 → SL lëviz në breakeven.
- **Madhësia e pozicionit**: `size = (equity × riskPct) / |entry − stopLoss|`
  (default `riskPct = 1%`, maks 2%), me kufizim nga leverage maksimal i zgjedhur nga përdoruesi.
- Opsionale: **Fractional Kelly** (¼ Kelly) nga statistikat e backtest-it, i kufizuar nga riskPct.
- **Rregulla portofoli**: maks N pozicione të hapura, maks ekspozim për sektor (L1, DeFi, Meme, AI…),
  korrelacion > 0.8 me pozicion ekzistues → paralajmërim.
- Shfaq gjithmonë: R:R, rrezikun në $, rrezikun në % të llogarisë, çmimin e likuidimit (nëse ka leverage).
- R:R < 1.5 → sinjali nuk shfaqet si BLEJ/SHIT, vetëm si "Watchlist".

### 4.5 Backtesting (`packages/backtest`)
- Motor **event-driven** candle-pas-candle, i njëjti kod strategjie si në live (asnjë divergjencë).
- Modelon **fees** (maker/taker), **slippage** (bazuar në ATR/volum), **funding** për futures.
- Asnjë **look-ahead bias**: strategjia sheh vetëm candle-t e mbyllura deri në `t`.
- **Walk-forward optimization** (in-sample / out-of-sample) + **Monte Carlo** (shuffle i trade-ve) për intervale besueshmërie.
- Metrika: Total Return, CAGR, Win Rate, Profit Factor, Expectancy, Sharpe, Sortino, Calmar,
  Max Drawdown, Avg R, numri i trade-ve, exposure time, kurba e equity-t.
- Rezultatet ruhen në DB dhe ushqejnë `backtestStats` dhe `confidence` të sinjaleve.

### 4.6 Analiza e coinit — "Coin Report"
Për çdo coin gjenerohet raport me:
- Përmbledhje teknike (trend për 15m/1h/4h/1d/1w në një matricë me ngjyra).
- Nivelet kyçe (S/R, POC, Fib), regjimi, volatiliteti.
- Derivate: funding, OI, long/short ratio, likuidime.
- Sentiment: Fear & Greed, dominanca BTC, performanca relative ndaj BTC/ETH.
- Fundamental bazë: market cap, FDV, supply në qarkullim, unlock-e (nëse ka të dhëna).
- **Verdikti**: skori 0–100, veprimi i rekomanduar, plani i tregtisë (entry/SL/TP/size), skenari bullish & bearish.
- (Opsionale) **Shpjegim me AI**: Claude merr JSON-in e strukturuar të analizës dhe shkruan
  përmbledhje të qartë në gjuhën e përdoruesit. AI **nuk** gjeneron numra — vetëm shpjegon
  numrat e llogaritur nga motori deterministik.

---

## 5. Charting dhe Vizatimet (`packages/drawing` + `features/chart`)

### 5.1 Chart-i
- Lightweight Charts v5: candles, Heikin-Ashi, line, area, bars; volume histogram në pane të veçantë.
- **Multi-pane**: indikatorët oscillator (RSI, MACD, Stoch…) në pane-e të ndara, me resize.
- Timeframe switcher, symbol search (Cmd/Ctrl+K), krahasim simbolesh (overlay %).
- Crosshair i sinkronizuar mes pane-ve; legjendë OHLCV + vlerat e indikatorëve.
- Shkallë log/linear, auto-scale, "go to date", replay mode (bar-by-bar për praktikë).
- **Overlay i sinjaleve**: shigjeta BLEJ/SHIT në chart, kuti entry/SL/TP (si "Long/Short Position" tool),
  nivelet automatike S/R dhe zonat OB/FVG — secila me toggle.
- Layout multi-chart: 1, 2, 4 chart-e njëkohësisht me sinkronizim simboli/crosshair opsional.

### 5.2 Mjetet e vizatimit
Implementuar si **Series Primitives** të Lightweight Charts, me koordinata në `(time, price)`
(jo pikselë) që të mbijetojnë zoom/scroll/ndryshim timeframe-i.

| Grupi | Mjetet |
|---|---|
| Linja | Trend Line, Ray, Extended Line, Horizontal Line, Horizontal Ray, Vertical Line, Parallel Channel, Regression Channel |
| Fibonacci | Retracement, Extension, Fib Channel, Time Zones, Fib Fan |
| Gann/Pitchfork | Andrew's Pitchfork, Gann Fan |
| Forma | Rectangle, Ellipse, Triangle, Path/Polyline, Brush (free-hand), Arrow |
| Tregtimi | Long Position, Short Position (me R:R live), Price Range, Date Range, Date & Price Range |
| Patterns | XABCD, Elliott Wave (impulse/corrective), Head & Shoulders |
| Tekst | Text, Callout, Note, Price Label, Emoji/Icon |

**Kërkesat e mjeteve:**
- Magnet mode (snap në OHLC), Shift për kënde 45°, multi-select, grupim, lock, hide, z-order.
- Panel stilesh: ngjyrë, trashësi, stil vije (solid/dashed/dotted), fill, opacity, tekst, nivelet Fib të editueshme.
- **Undo/Redo** (command pattern, Ctrl+Z / Ctrl+Shift+Z), copy/paste, delete, duplicate.
- Shortcuts tastiere për çdo mjet (p.sh. `Alt+T` trend line, `Alt+F` fib, `Alt+H` horizontal).
- **Persistencë**: vizatimet ruhen për `(userId, symbol)` në DB (JSON i validuar me Zod, me `schemaVersion`),
  sinkronizim me debounce 500ms + optimistic updates; offline cache në IndexedDB.
- **Alert nga vizatimi**: kliko djathtas mbi trend line / horizontal → "Krijo alert kur çmimi kalon".
- Templates: ruaj grupe indikatorësh + stile si "Layout"; eksport/import JSON; screenshot PNG i chart-it.
- Touch support (mobile): tap-tap për pika, pinch zoom, long-press për menu.

### 5.3 Modeli i të dhënave të vizatimit
```ts
interface Drawing {
  id: string;
  type: DrawingType;
  points: { time: UTCTimestamp; price: number }[];
  style: DrawingStyle;
  props?: Record<string, unknown>;   // p.sh. fibLevels, text
  locked: boolean; visible: boolean; zIndex: number;
  groupId?: string;
  schemaVersion: number;
  createdAt: string; updatedAt: string;
}
```

---

## 6. Faqet dhe UX

1. **Dashboard** — Market overview (BTC, ETH, dominanca, Fear & Greed, total mcap), heatmap sektorësh,
   **Top 10 sinjale aktive** sipas skorit×besueshmërisë, top gainers/losers, alertet e fundit.
2. **Signals** — tabelë me filtra (veprim, timeframe, strategji, skor min, R:R min, sektor),
   karta sinjali me plan tregtie + butonin "Hap në chart" + "Shto në portofol" + "Krijo alert".
   Tab "Historik" me performancën reale të sinjaleve të kaluara (track record i ndershëm, përfshirë humbjet).
3. **Chart/[symbol]** — chart i plotë + toolbar vizatimi majtas + panel djathtas (Coin Report, sinjale, order book, trades).
4. **Screener** — query builder (p.sh. `RSI(14,1h) < 30 AND close > EMA(200,4h) AND volume24h > 10M`),
   preset-e të gatshme, rezultate live, ruajtje e skanimeve.
5. **Portfolio** — pozicione manuale (ose read-only API key i exchange-it), PnL realizuar/parealizuar,
   alokim (pie), ekspozim sipas sektorit, rreziku total i hapur, journal tregtimi me shënime dhe screenshot.
6. **Backtest Lab** — zgjidh strategji/coin/periudhë/parametra → ekzekuto në worker → kurba equity,
   metrika, lista e trade-ve të shfaqura në chart.
7. **Alerts** — çmim, % ndryshim, kryqëzim indikatori, sinjal i ri, vizatim i kaluar;
   kanale: in-app, push, email, Telegram.
8. **Settings** — profili i rrezikut (konservativ / mesatar / agresiv → riskPct, maxLeverage, maxPositions),
   kapitali, exchange-i i preferuar, gjuha (sq / en), tema, 2FA, API keys.

**Dizajni:**
- Dark mode si default (stil terminali tregtimi), light mode opsional. Ngjyra semantike:
  jeshile = bullish, e kuqe = bearish, gri = neutral, me alternativë color-blind (blu/portokalli).
- Numrat me `font-variant-numeric: tabular-nums`; formatim çmimi sipas `tickSize` të simbolit.
- Responsive: desktop-first për chart-in, por plotësisht funksional në mobile (bottom nav).
- Skeleton loaders, optimistic UI, empty states të qarta, error boundaries për çdo widget.
- **i18n**: `next-intl`, gjuha default **shqip**, anglisht e dyta. Asnjë string hard-coded në komponentë.
- Aksesueshmëri WCAG 2.1 AA (kontrast, fokus, aria, navigim me tastierë).

---

## 7. Siguria

- API keys të exchange-ve: **vetëm read-only**, të enkriptuara me AES-256-GCM (key nga KMS/env),
  kurrë të loguara, kurrë të kthyera te klienti. Aplikacioni **nuk ekzekuton urdhra** në fazën 1.
- Auth.js me sesione të sigurta (httpOnly, sameSite=lax, secure), 2FA TOTP, rate limit në login.
- Zod validim në çdo hyrje; CSP strikte; headers sigurie (helmet-equivalent në middleware).
- Rate limiting për API (Redis sliding window) sipas user/IP.
- Sekretet vetëm në env; `.env.example` i përditësuar; `env.ts` me Zod që dështon në startup nëse mungon diçka.
- Audit log për veprime të ndjeshme (ndryshim API key, 2FA, fshirje llogarie).

---

## 8. Performanca

- Chart: render i 10.000+ candle-ve pa lag; lazy-load historik kur scroll majtas (pagination me `endTime`).
- Indikatorët live: llogaritje **incremental**, jo rillogaritje e gjithë serisë.
- Llogaritjet e rënda (skanim i 200 coinave × 5 TF) në worker, me rezultate në Redis; UI lexon nga cache.
- Web Workers në browser për indikatorë custom/screener lokal.
- Throttle i update-ve WS në UI (maks ~10 fps për ticker-at, chart në rAF).
- Bundle: dynamic import për chart-in dhe mjetet e vizatimit; Lighthouse ≥ 90 në faqet jo-chart.

---

## 9. Standardet e kodit

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. Ndalohet `any` (përdor `unknown` + Zod).
- ESLint + Prettier; import-et e renditura; asnjë `console.log` në commit (përdor logger-in).
- Emërtimi: komponentët `PascalCase`, hooks `useX`, files `kebab-case.ts`, konstante `SCREAMING_SNAKE`.
- Funksionet financiare: input/output `Decimal`, konvertim në `number` vetëm për render chart-i.
- Kohët: gjithmonë **UTC** në backend dhe DB (`timestamptz`); konvertim në zonën e përdoruesit vetëm në UI.
- Çdo modul publik ka JSDoc të shkurtër që shpjegon *pse*, jo *çfarë*.
- Error handling: `Result<T, E>` në paketat pure; exceptions vetëm në kufijtë e I/O.
- Asnjë logjikë biznesi në komponentët React — vendose në `features/*/model` ose në `packages/*`.

---

## 10. Testimi (Definition of Done)

Një detyrë konsiderohet **e kryer** vetëm kur:
- [ ] `pnpm typecheck` kalon pa gabime.
- [ ] `pnpm lint` kalon pa gabime.
- [ ] `pnpm test` kalon; coverage ≥ **90%** për `indicators`, `risk`, `signals`, `backtest`; ≥ 70% gjetkë.
- [ ] Indikatorët e rinj kanë teste krahasuese me vlera referencë.
- [ ] Strategjitë e reja kanë backtest të dokumentuar në `docs/strategies/<id>.md`.
- [ ] Flukset kryesore UI (login → dashboard → hap sinjal → chart → vizato → ruaj → rifresko → vizatimi ekziston) kanë test Playwright.
- [ ] Nuk ka regresion vizual në chart (Playwright screenshot për gjendjet kryesore).
- [ ] UI është kontrolluar në 375px, 768px dhe 1440px.

---

## 11. Komandat

```bash
pnpm install
pnpm dev                        # web + worker + DB i integruar (PGlite), migrimet aplikohen vetë
pnpm test                       # vitest në të gjitha paketat
pnpm test:e2e                   # playwright
pnpm typecheck && pnpm lint
pnpm backtest --strategy trend-pullback --symbol BTCUSDT --tf 4h --from 2022-01-01
```

---

## 12. Roadmap i implementimit (rendi i punës)

Puno **fazë pas faze**. Mos kalo në fazën tjetër pa plotësuar Definition of Done të fazës aktuale.

| Faza | Përmbajtja | Rezultati i verifikueshëm |
|---|---|---|
| **F0** | Monorepo, config, DB schema, env, CI | `pnpm dev` ngrihet; CI e gjelbër |
| **F1** | `packages/exchange` (Binance REST+WS), ingest candles, coin universe | Candle live për BTCUSDT në DB dhe në terminal |
| **F2** | Chart bazë: candles, volume, timeframe switch, symbol search, live update, lazy history | Chart funksional në `/chart/BTCUSDT` |
| **F3** | `packages/indicators` + overlay/pane indikatorësh në chart | 15+ indikatorë me teste referencë |
| **F4** | Mjetet e vizatimit (faza a: linja, horizontal, fib, rectangle, text, long/short) + undo/redo + persistencë | Vizatimet mbijetojnë refresh |
| **F5** | Regjimi + motori i sinjaleve + 3 strategjitë e para + `packages/risk` | Sinjale me plan të plotë tregtie |
| **F6** | Backtest engine + walk-forward + Backtest Lab UI | Statistika reale në çdo sinjal |
| **F7** | Dashboard, Signals page, Coin Report, Screener | Flukset kryesore të përdoruesit |
| **F8** | Auth, Portfolio, Alerts (in-app, push, email, Telegram) | Përdorues real me alerte |
| **F9** | Mjetet e avancuara të vizatimit, derivate, SMC, patterns, AI explanation | Paritet "pro" |
| **F10** | Hardening: siguri, performancë, observability, i18n i plotë, a11y, deploy | Gati për prodhim |

---

## 12b. Gjendja aktuale e implementimit (2026-10-18)

`pnpm dev` nis platformën e plotë pa asnjë shërbim të jashtëm ([ADR 0005](docs/decisions/0005-self-contained-platform.md)):

- **Databaza:** PGlite i integruar në `$CV_HOME/db`.
- **Worker:** nis brenda serverit nga `instrumentation.ts`.
- **Real-time:** bus në memorie.

PostgreSQL dhe Redis mbeten opsionalë, për shkallëzim. `DATABASE_URL=off` jep mënyrën vetëm-lokal
([ADR 0001](docs/decisions/0001-client-side-first.md), [ADR 0004](docs/decisions/0004-worker-hybrid-mode.md)).

| Faza | Statusi | Shënime |
|---|---|---|
| F0 | ✅ | Monorepo pnpm, TS strict, Vitest, Playwright, Drizzle mbi PGlite/PostgreSQL me migrime të integruara, GitHub Actions CI (PostgreSQL + PGlite) |
| F1 | ✅ | `packages/exchange`: Binance REST/WS (browser + Node), CoinGecko, Fear & Greed, OKX derivate. Rilidhje dhe gap-fill. Bybit mungon |
| F2 | ✅ | Grafik live, lazy history, kërkim simboli (Ctrl+K), layout 1/2/4, replay, screenshot |
| F3 | ✅ | 25 indikatorë në grafik. Testet krahasojnë me `technicalindicators` |
| F4 | ✅ | Undo/redo, magnet, stile, alert nga vizatimi. Persistencë lokale + sinkronizim në DB për përdoruesit me llogari |
| F5 | ✅ | Regjimi, 19 faktorë (përfshirë derivatet), 6 strategji, CV Rating 0–100 (8 shtylla, 25 metrika me pesha) + plani i investimit ([ADR 0007](docs/decisions/0007-cv-rating.md)), strategji custom pa kod ([ADR 0006](docs/decisions/0006-paper-trading-custom-strategies.md)), plane rreziku me decimal.js |
| F6 | ✅ | Backtest event-driven (edhe për strategjitë custom), walk-forward, Monte Carlo, Backtest Lab, gate për coin ([ADR 0002](docs/decisions/0002-backtest-gate.md)) |
| F7 | ✅ | Paneli (me rekomandimet e sotme), Rekomandimet (`/recommendations`, [ADR 0008](docs/decisions/0008-recommender.md)), Vlerësimi (`/rating`), Sinjalet + track record, Raporti i coinit (CV Rating + plani + sinjali i hyrjes), Skaneri, Tregu (RRG, korrelacion, beta, volatilitet), Krahaso (`/compare`, 2–4 coin), Kalkulatorët (`/tools`, `@cv/risk` calculators + `dcaBacktest`), Ditari (`/journal`, `journalStats` te `@cv/risk`), Sezonaliteti (`/seasonality`, `seasonality` te `@cv/analytics`), Futures (`/futures`: `futuresPlan` te `@cv/risk`, `marketEvents`/`derivativeEvents` te `@cv/signals`, [ADR 0011](docs/decisions/0011-futures-planner.md)), `/welcome`. Navigim i grupuar (`components/layout/nav.ts`), paleta e komandave (Ctrl/⌘ K), menuja "Më shumë" në mobile |
| F8 | ✅ | Auth me 2FA ([ADR 0003](docs/decisions/0003-custom-auth.md)), portofoli + paper trading (LIMIT/STOP, SL/TP, likuidim), alertet (përfshirë CV Rating mbi/nën, [ADR 0009](docs/decisions/0009-rating-alerts-and-quality-gates.md)), worker, njoftime: aplikacion, browser, Web Push, Telegram, email, SSE |
| F9 | ✅ | 31 mjete vizatimi, derivate OKX, SMC, modele, shpjegim AI me Claude |
| F10 | ◐ | i18n sq/en, temë e çelët, daltonizëm, pa animacione, pamje kompakte, PWA, CSP + headers, rate limit, audit log, pino, çelës kriptimi i gjeneruar, ESLint, axe (WCAG 2.1 AA) dhe teste responsive 375/768/1440 në CI. **Mungon:** OpenTelemetry/Sentry |

**Kontratat aktuale** (ndryshohen vetëm me ADR):

- `Signal`, `TradePlan` dhe `FactorResult` te `packages/core/src/types.ts`.
- `Drawing` te `apps/web/lib/chart/drawing-types.ts` (`schemaVersion`).
- `Snapshot`, `ScanRow`, `TrackedSignal` te `packages/engine/src/types.ts`.
- `CustomStrategyDef` (Zod) te `packages/signals/src/custom.ts`; `PaperOrder` te `packages/risk/src/paper.ts`.
- `Rating`, `PillarWeights`, `InvestmentPlan`, `Recommendation` te `packages/rating/src`; metrikat, kurbat dhe pragjet janë pjesë e kontratës.
- Skema e DB-së te `packages/db/src/schema.ts`. Çdo ndryshim kërkon `pnpm db:generate`, i cili gjeneron SQL-në
  dhe e përfshin te `migrations.gen.ts`. Skedari i gjeneruar commit-ohet bashkë me SQL-në.
- Store-t e ruajtura `cv.*`, të versionuara. `chartUi` nuk sinkronizohet (specifik për pajisjen).
- Dokumentet e gjendjes që sinkronizohen: `settings`, `screens`, `strategies`, `orders`, `tracked` (`stateKeys`).

**Komandat reale:**

- `pnpm dev` (platforma e plotë), `pnpm build && pnpm start`
- `pnpm test` (205 teste, përfshirë DB-në mbi PGlite dhe testet e regresionit të auditimit, [ADR 0010](docs/decisions/0010-calculation-audit.md)), `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e` (32 teste, përfshirë `e2e/quality.spec.ts`)
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm test:integration` (kundër PostgreSQL)
- `pnpm worker` (vetëm me `WORKER=external` dhe PostgreSQL)
- `pnpm backtest …`, `pnpm validate:oos`, `pnpm validate:rating`, `pnpm recommend`
- `pnpm dev:clean` (pastron cache-in e Turbopack kur faqja rifreskohet pa pushim)

`pnpm db:seed` nga §11 nuk ekziston ende.

**Rregulla të shtuara:**

- Çdo ndryshim në strategji ose faktorë duhet të ekzekutojë `pnpm validate:oos` dhe të përditësojë numrat te
  `docs/strategies/README.md`.
- Çdo ndryshim në metrikat, kurbat, peshat ose pragjet e CV Rating, ose në rregullat e rekomanduesit, kërkon `pnpm validate:rating`,
  `calibration.json` të ri dhe përditësimin e `docs/strategies/rating.md`.
- Të dyja rregullat vlejnë edhe kur numrat përkeqësohen.
- Çdo faqe e re shtohet te `components/layout/nav.ts` (sidebar, menuja mobile dhe paleta e komandave e lexojnë që andej)
  dhe te `PAGES` në `e2e/quality.spec.ts`, që të kontrollohet për tejkalim në mobile dhe për aksesueshmëri.
- Tekst mbi sfonde të plota bull/bear përdor `text-(--on-bull)` / `text-(--on-bear)`, kurrë `text-white`.

---

## 13. Udhëzime për agjentin (Claude Code)

1. **Para se të shkruash kod:** lexo seksionet përkatëse këtu, kontrollo kodin ekzistues dhe ndiq
   pattern-et e tij. Për punë > 1 orë, shkruaj fillimisht planin e shkurtër.
2. **Hapa të vegjël, të verifikueshëm.** Pas çdo ndryshimi ekzekuto typecheck + testet përkatëse.
3. **Mos shpik të dhëna.** Asnjë çmim, statistikë backtest apo win-rate i hard-coded / i rremë në UI.
   Për zhvillim përdor fixtures të shënuara qartë (`__fixtures__/`) dhe të dhëna reale nga API.
4. **Mos ndrysho kontratat** (`Signal`, `Drawing`, `ExchangeAdapter`, skema DB) pa ADR dhe migrim.
5. **Asnjë ekzekutim urdhrash tregtimi** apo përdorim i API keys me leje trade/withdraw — jashtë scope-it.
6. Kur shton strategji/indikator: kod + teste + dokumentim + backtest — të katërt në të njëjtin ndryshim.
7. Tekstet e UI në shqip përmes i18n; mesazhet e commit-eve në anglisht, në formatin Conventional Commits.
8. Kur diçka është e paqartë ose ka trade-off të rëndësishëm, ndalo dhe pyet në vend që të supozosh.
9. Mbaj këtë `CLAUDE.md` të përditësuar kur ndryshon arkitektura, komandat ose konventat.

---

## 14. Disclaimer (duhet të shfaqet në aplikacion)

> **CryptoVision Pro** është mjet analitik dhe edukativ. Sinjalet, skorët dhe planet e tregtimit
> gjenerohen automatikisht nga modele statistikore dhe teknike dhe **nuk përbëjnë këshillë financiare,
> investuese apo tregtare**. Performanca e kaluar nuk garanton rezultate të ardhshme. Tregtimi i
> kriptovalutave, veçanërisht me leverage, mbart rrezik të lartë humbjeje të pjesshme ose të plotë të kapitalit.
> Investoni vetëm atë që jeni të gatshëm të humbni dhe konsultohuni me një këshilltar të licencuar.
