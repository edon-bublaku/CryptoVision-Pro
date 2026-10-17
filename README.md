# CryptoVision Pro

Platformë profesionale për analizë të kriptovalutave. Përfshin:

- Sinjale me konfluencë shumë-faktoriale.
- Plane tregtie me menaxhim rreziku.
- Backtest bar-pas-bari.
- Grafik live me 31 mjete vizatimi.
- Llogari me 2FA, sinkronizim mes pajisjeve, worker në server dhe njoftime (push, Telegram, email).
- Shpjegim me AI (Claude) i analizës.

> ⚠️ **Jo këshillë financiare.** Sinjalet janë probabilistike. Tregtimi i kriptovalutave mbart rrezik
> të lartë humbjeje. Lexoni [rezultatet reale të strategjive](docs/strategies/README.md) para se ta përdorni.

## Çfarë bën

| Faqja | Funksionet |
|---|---|
| **Paneli** | BTC/ETH live, kapitalizimi total, dominanca, Fear & Greed, gjerësia e tregut, sinjalet kryesore, fituesit/humbësit, heatmap, sektorët, lista ime |
| **Grafiku** | Lightweight Charts v5 me të dhëna live (WebSocket). Lloje: candles / Heikin-Ashi / bars / line / area. Shkallë log. Layout 1/2/4 grafikë. Replay bar-pas-bari. Screenshot. Historiku ngarkohet automatikisht kur lëviz majtas |
| ↳ Indikatorë (25) | EMA 20/50/200, SMA, Hull, VWAP ±σ, Bollinger, Keltner, Donchian, SuperTrend, PSAR, Ichimoku, Volume, RSI, MACD, Stoch RSI, ADX/DMI, ATR, OBV, CVD, CMF, MFI, CCI, Williams %R, TSI |
| ↳ Analizë automatike | S/R e grupuar nga pivot-et, BOS/CHoCH, Order Blocks + FVG, divergjenca RSI, modele qirinjsh, Volume Profile (POC/VA), Fibonacci automatik, pivot points, kutia e planit (entry/SL/TP1-3) |
| ↳ Vizatime (31 mjete) | Trend line, ray, extended, horizontal, horizontal ray, vertical, kanal paralel, kanal regresioni, pitchfork, Gann fan, Fib retracement/extension/fan/time zones, drejtkëndësh, elipsë, trekëndësh, path, furçë, shigjetë, tekst, callout, etiketë çmimi, pozicion Long/Short me R:R, matës çmim/kohë/datë, XABCD, Elliott impulse + ABC, Head & Shoulders |
| ↳ Mjetet e vizatimit | Magnet OHLC, Shift për vijë horizontale, undo/redo, kopjim (Ctrl+D), bllokim, fshehje, stil (ngjyrë, trashësi, vijë, mbushje, zgjatje), menu me klik të djathtë, **alert kur çmimi kalon vizatimin**. Ruhen për çdo simbol dhe mbeten kur ndërron timeframe |
| ↳ Raporti | Verdikti 0–100, plani i tregtisë me madhësinë e pozicionit (sipas % rrezikut), shpjegim në gjuhë natyrore, skenarët bull/bear, backtest i strategjisë në atë coin, matrica MTF (15m→1w), faktorët, nivelet, struktura, order book live, tregtimet live |
| **Sinjalet** | Skanim i top 20–100 coin-ave në Web Worker. Filtra: drejtimi, skori, R:R, strategjia. Karta sinjalesh me plan dhe backtest. Track record automatik (TP/SL) |
| **Skaneri** | Ndërtues kriteresh (RSI, ADX, %B, kompresim BB, RVOL, distanca nga EMA-të / max 20-bar …), preset-e, skanime të ruajtura |
| **Backtest** | Motori i njëjtë me sinjalet live. Tarifa, slippage, filtër HTF, kurba e kapitalit kundrejt blej-e-mbaj, drawdown, walk-forward, Monte Carlo (1000 simulime), tregtimet në grafik |
| **Portofoli** | Pozicione me PnL live, madhësi automatike sipas rrezikut, rreziku i hapur, alokimi, ekspozimi sipas sektorit, paralajmërime korrelacioni (ρ > 0.8), ditar me eksport CSV |
| **Alertet** | Çmim mbi/nën, ndryshim 24h, RSI mbi/nën, sinjal i ri aktiv, kalim i vizatimit. Njoftime në aplikacion, browser, Web Push, Telegram dhe email. Me llogari, alertet vlerësohen nga worker-i edhe kur browser-i është i mbyllur |
| **Llogaria** | Profili, 2FA (TOTP + kode rezervë), sesionet aktive, ndryshimi i fjalëkalimit, kanalet e njoftimeve, fshirja e llogarisë |
| **Cilësimet** | Shqip/English, temë e errët/e çelët, paletë për daltonizëm, profili i rrezikut, kapitali, leverage, tarifa, Telegram, backup/import JSON |

## Nisja

Kërkesat: Node ≥ 20 dhe pnpm ≥ 10. Aplikacioni ka dy mënyra pune.

### 1. Vetëm lokal (pa server)

```bash
pnpm install
pnpm dev                     # http://localhost:3000
```

Nuk ka nevojë për API keys apo databazë. Të dhënat vijnë nga endpoint-et publike të Binance
(`data-api.binance.vision`), që funksionojnë edhe ku `api.binance.com` është i bllokuar.
Vizatimet, portofoli dhe alertet ruhen në browser.

### 2. Full stack (llogari, sinkronizim, worker, njoftime)

Me Docker:

```bash
cp .env.example .env         # vendos ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up -d --build # TimescaleDB + Redis + worker + web → http://localhost:3000
```

Pa Docker (Postgres 16 dhe Redis të instaluar lokalisht):

```bash
pnpm services                # nis Postgres + Redis (scripts/dev-services.sh)
pnpm db:migrate              # migrimet Drizzle (+ hypertable TimescaleDB nëse ekziston)
pnpm dev:worker              # skanime, track record, alerte në server
pnpm dev                     # web
```

Kur `DATABASE_URL` mungon, aplikacioni kthehet automatikisht në mënyrën lokale.

| Variabla | E detyrueshme | Për çfarë |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | për full stack | llogari, sinkronizim, rate limit, SSE |
| `ENCRYPTION_KEY` | në prodhim | AES-256-GCM për sekretet e 2FA (`openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | jo | shpjegimi me AI në raportin e coinit (default `claude-opus-5-5`) |
| `TELEGRAM_BOT_TOKEN` | jo | bot-i i platformës për alertet në Telegram |
| `RESEND_API_KEY`, `EMAIL_FROM` | jo | alerte me email |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | jo | Web Push (`pnpm --filter @cv/worker vapid` krijon çiftin) |
| `SCAN_TIMEFRAMES`, `SCAN_SIZE` | jo | çfarë skanon worker-i (default `1h,4h,1d`, 60 coin) |

### Komandat

| Komanda | Çfarë bën |
|---|---|
| `pnpm test` | 74 teste njësie (indikatorët kundrejt `technicalindicators`, motori, rreziku, backtest-i, track record, TOTP sipas RFC 6238, kriptimi, alertet e worker-it) |
| `pnpm test:integration` | + 9 teste kundër Postgres të vërtetë (repo-t e DB) |
| `pnpm typecheck` | TypeScript strict në të gjitha paketat |
| `pnpm build` | Build prodhimi (Next.js 16, `output: standalone`) |
| `pnpm test:e2e` | 13 teste Playwright: UI, API (regjistrim → 2FA → sesione), sinkronizim vizatimesh mes dy pajisjeve |
| `pnpm db:migrate` / `pnpm db:generate` | Zbato / gjenero migrimet |
| `pnpm --filter @cv/worker once` | Një xhiro e vetme e skanimit + track record |
| `pnpm backtest --symbol ETHUSDT --tf 4h --bars 3000 [--strategy breakout_volume]` | Backtest nga terminali |
| `pnpm validate:oos` | Validim jashtë mostrës në 12 coin × 3 timeframe |

CI (`.github/workflows/ci.yml`) ekzekuton typecheck, testet njësie + integrimi me Postgres/Redis,
migrimet, build-in dhe Playwright kundër build-it standalone.

## Backend

| Pjesa | Detajet |
|---|---|
| **Llogaritë** | Regjistrim/hyrje me fjalëkalim (scrypt), sesione në DB (ruhet vetëm SHA-256 i token-it, cookie `__Host-` httpOnly), bllokim pas 5 tentativave, 2FA TOTP me kode rezervë, menaxhim sesionesh, ndryshim fjalëkalimi, fshirje llogarie, audit log ([ADR 0003](docs/decisions/0003-custom-auth.md)) |
| **Sinkronizimi** | Vizatimet, portofoli, alertet, cilësimet dhe skanimet e ruajtura ndjekin përdoruesin në çdo pajisje. Bashkim i zgjuar në hyrje, versione optimiste për dokumentet (409 → merret kopja e serverit) |
| **Worker** | BullMQ: skanim i universit për çdo timeframe, ndjekje TP/SL e sinjaleve, alerte çmimi live (WebSocket), RSI dhe "sinjal i ri" ([ADR 0004](docs/decisions/0004-worker-hybrid-mode.md)) |
| **Real-time** | `/api/events` (SSE) përcjell alertet dhe skanimet e reja nga Redis pub/sub |
| **Njoftime** | Në aplikacion, browser, Web Push, Telegram, email |
| **Derivate** | Funding, open interest dhe long/short ratio nga OKX, si faktor në motorin e sinjaleve |
| **AI** | `/api/ai/explain` transmeton shpjegimin nga Claude. AI vetëm shpjegon numrat e motorit, nuk i shpik |
| **Siguria** | CSP dhe headers sigurie, kontroll origin për kërkesat që ndryshojnë gjendje, rate limit me Redis, validim Zod kudo |

## Arkitektura

```
apps/web                  Next.js 16 · React 19 · Tailwind v4 · Zustand · TanStack Query
  ├─ app/*                faqet (/, /welcome, /chart, /signals, /screener, /backtest, /portfolio, /alerts, /settings, /account, /login)
  ├─ app/api/*            23 route handlers (auth, sync, signals, alerts, derivatives, ai, push, events)
  ├─ components/chart     ChartPanel, toolbar, raporti, stilet e vizatimeve
  ├─ lib/chart            CoordMapper, DrawingController, 31 renderer-a vizatimesh (series primitives)
  ├─ lib/data             Binance REST + WebSocket i multipleksuar (rilidhje, gap-fill)
  ├─ lib/store            store-t (settings, drawings + undo/redo, portfolio, alerts, auth)
  └─ workers              scan.worker, backtest.worker
apps/worker               BullMQ: skanime, track record, alerte, njoftime
packages
  ├─ core                 tipet, timeframes, formatimi, matematika
  ├─ indicators           indikatorë pure + struktura (pivots, S/R, BOS/CHoCH, FVG, OB), divergjenca, modele
  ├─ risk                 planet SL/TP, madhësia e pozicionit (decimal.js), Kelly, likuidimi
  ├─ signals              konteksti, regjimi, 19 faktorë (përfshirë derivatet), 6 strategji
  ├─ backtest             motor event-driven, metrika, walk-forward, Monte Carlo
  ├─ exchange             Binance REST/WS, CoinGecko, Fear & Greed, OKX derivate (browser + Node)
  ├─ engine               analiza e plotë + gate-i i backtest-it, i përbashkët për web dhe worker
  ├─ db                   Drizzle schema, migrime, repo-t
  └─ server               env (Zod), kriptim, TOTP, Redis, rate limit, njoftime, logger
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
