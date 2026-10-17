# CryptoVision Pro

Platformë profesionale për analizë të kriptovalutave. Përfshin:

- Sinjale me konfluencë shumë-faktoriale.
- Plane tregtie me menaxhim rreziku.
- Backtest bar-pas-bari.
- Grafik live me mjete vizatimi.

> ⚠️ **Jo këshillë financiare.** Sinjalet janë probabilistike. Tregtimi i kriptovalutave mbart rrezik
> të lartë humbjeje. Lexoni [rezultatet reale të strategjive](docs/strategies/README.md) para se ta përdorni.

## Çfarë bën

| Faqja | Funksionet |
|---|---|
| **Paneli** | BTC/ETH live, kapitalizimi total, dominanca, Fear & Greed, gjerësia e tregut, sinjalet kryesore, fituesit/humbësit, heatmap, sektorët, lista ime |
| **Grafiku** | Lightweight Charts v5 me të dhëna live (WebSocket). Lloje: candles / Heikin-Ashi / bars / line / area. Shkallë log. Layout 1/2/4 grafikë. Replay bar-pas-bari. Screenshot. Historiku ngarkohet automatikisht kur lëviz majtas |
| ↳ Indikatorë (25) | EMA 20/50/200, SMA, Hull, VWAP ±σ, Bollinger, Keltner, Donchian, SuperTrend, PSAR, Ichimoku, Volume, RSI, MACD, Stoch RSI, ADX/DMI, ATR, OBV, CVD, CMF, MFI, CCI, Williams %R, TSI |
| ↳ Analizë automatike | S/R e grupuar nga pivot-et, BOS/CHoCH, Order Blocks + FVG, divergjenca RSI, modele qirinjsh, Volume Profile (POC/VA), Fibonacci automatik, pivot points, kutia e planit (entry/SL/TP1-3) |
| ↳ Vizatime (20 mjete) | Trend line, ray, extended, horizontal, horizontal ray, vertical, kanal paralel, pitchfork, Fib retracement/extension, drejtkëndësh, elipsë, trekëndësh, path, furçë, shigjetë, tekst, pozicion Long/Short me R:R, matës çmim/kohë |
| ↳ Mjetet e vizatimit | Magnet OHLC, Shift për vijë horizontale, undo/redo, kopjim (Ctrl+D), bllokim, fshehje, stil (ngjyrë, trashësi, vijë, mbushje, zgjatje), menu me klik të djathtë, **alert kur çmimi kalon vizatimin**. Ruhen për çdo simbol dhe mbeten kur ndërron timeframe |
| ↳ Raporti | Verdikti 0–100, plani i tregtisë me madhësinë e pozicionit (sipas % rrezikut), shpjegim në gjuhë natyrore, skenarët bull/bear, backtest i strategjisë në atë coin, matrica MTF (15m→1w), faktorët, nivelet, struktura, order book live, tregtimet live |
| **Sinjalet** | Skanim i top 20–100 coin-ave në Web Worker. Filtra: drejtimi, skori, R:R, strategjia. Karta sinjalesh me plan dhe backtest. Track record automatik (TP/SL) |
| **Skaneri** | Ndërtues kriteresh (RSI, ADX, %B, kompresim BB, RVOL, distanca nga EMA-të / max 20-bar …), preset-e, skanime të ruajtura |
| **Backtest** | Motori i njëjtë me sinjalet live. Tarifa, slippage, filtër HTF, kurba e kapitalit kundrejt blej-e-mbaj, drawdown, walk-forward, Monte Carlo (1000 simulime), tregtimet në grafik |
| **Portofoli** | Pozicione me PnL live, madhësi automatike sipas rrezikut, rreziku i hapur, alokimi, ekspozimi sipas sektorit, paralajmërime korrelacioni (ρ > 0.8), ditar me eksport CSV |
| **Alertet** | Çmim mbi/nën, ndryshim 24h, RSI mbi/nën, sinjal i ri aktiv, kalim i vizatimit. Njoftime në aplikacion, në browser dhe në Telegram |
| **Cilësimet** | Shqip/English, temë e errët/e çelët, paletë për daltonizëm, profili i rrezikut, kapitali, leverage, tarifa, Telegram, backup/import JSON |

## Nisja

Kërkesat: Node ≥ 20 dhe pnpm ≥ 9.

```bash
pnpm install
pnpm dev                     # http://localhost:3000
```

Nuk ka nevojë për API keys apo databazë. Të dhënat vijnë nga endpoint-et publike të Binance, të cilat
funksionojnë edhe në rajonet ku `api.binance.com` është i bllokuar.

| Komanda | Çfarë bën |
|---|---|
| `pnpm test` | 62 teste njësie (indikatorët krahasohen me `technicalindicators`, motori, rreziku, backtest-i, track record) |
| `pnpm typecheck` | TypeScript strict në të gjitha paketat |
| `pnpm build` | Build prodhimi (Next.js 16) |
| `STATIC_EXPORT=1 pnpm build` | Faqe statike në `apps/web/out` (për hosting kudo) |
| `pnpm exec playwright test` | Teste end-to-end (disclaimer, paneli, vizatim → ruajtje → rifreskim, backtest, portofol) |
| `pnpm backtest --symbol ETHUSDT --tf 4h --bars 3000 [--strategy breakout_volume]` | Backtest nga terminali |
| `pnpm validate:oos` | Validim jashtë mostrës në 12 coin × 3 timeframe |

## Arkitektura

```
apps/web                  Next.js 16 · React 19 · Tailwind v4 · Zustand · TanStack Query
  ├─ app/*                faqet (/, /chart, /signals, /screener, /backtest, /portfolio, /alerts, /settings)
  ├─ components/chart     ChartPanel, toolbar, raporti, stilet e vizatimeve
  ├─ lib/chart            CoordMapper (koha↔logical↔piksel), DrawingController, renderer-at (series primitives)
  ├─ lib/data             Binance REST (fallback hostesh, backoff) + WebSocket i vetëm i multipleksuar (rilidhje, gap-fill)
  ├─ lib/store            store-t e ruajtura (settings, drawings + undo/redo, portfolio, alerts, scan)
  └─ workers              scan.worker (skaneri), backtest.worker
packages
  ├─ core                 tipet, timeframes, formatimi, matematika
  ├─ indicators           indikatorë pure + struktura (pivots, S/R, BOS/CHoCH, FVG, OB), divergjenca, modele
  ├─ risk                 planet SL/TP, madhësia e pozicionit (decimal.js), Kelly, likuidimi
  ├─ signals              konteksti, regjimi, 18 faktorë, 6 strategji, motori (pa look-ahead)
  └─ backtest             motor event-driven, metrika, walk-forward, Monte Carlo
```

Vendimet kryesore janë në [`docs/decisions`](docs/decisions). Rregullat për zhvillim (për njerëz dhe
për Claude Code) janë në [`CLAUDE.md`](CLAUDE.md).

## Ndershmëria e sinjaleve

- Sinjalet llogariten **vetëm mbi qirinj të mbyllur**, prandaj nuk ndryshojnë pasi shfaqen.
  Një test unit e verifikon që vlerësimi në barin *i* jep të njëjtin rezultat me historik të plotë ose të prerë te *i*.
- Një sinjal bëhet **"Setup aktiv"** vetëm kur plotëson të gjitha kushtet:
  - një strategji e ka konfirmuar setup-in;
  - R:R ≥ 1.5;
  - nuk shkon kundër trendit të timeframe-it më të lartë;
  - strategjia ka **PF ≥ 1.2 me ≥ 6 trade** në backtest-in e atij coin-i ([ADR 0002](docs/decisions/0002-backtest-gate.md)).
- Validimi jashtë mostrës tregon **profit factor 0.71–0.75**. Me fjalë të tjera, strategjitë klasike TA
  **nuk kanë dëshmuar avantazh** në këtë periudhë. Përdoreni aplikacionin për analizë, disiplinë rreziku dhe
  vendime të informuara, jo si makineri fitimi.
