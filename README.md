# CryptoVision Pro

Platformë profesionale për analizë të kriptovalutave. Përfshin:

- **Rekomandime për sot:** portofol model sipas regjimit të tregut (sa të investosh, sa cash), coin-at më të mirë pa korrelim të tepërt, peshat, plani i secilit dhe backtest-i historik i rekomanduesit.
- **CV Rating 0–100 për çdo coin:** 8 shtylla dhe 25 metrika, secila me peshën e vet. Përfshin planin e investimit: kur të blesh, çfarë pozicioni, kur të shesësh. Validim historik i ndershëm.
- Sinjale me konfluencë shumë-faktoriale.
- Plane tregtie me menaxhim rreziku.
- Backtest bar-pas-bari.
- Grafik live me 31 mjete vizatimi.
- Llogari me 2FA, sinkronizim mes pajisjeve, worker në server dhe njoftime (push, Telegram, email).
- Inteligjencë tregu: grafik rotacioni (RRG), matricë korrelacioni, beta dhe volatilitet.
- Ditar tregtimi me analitikë (win rate, profit factor, pritshmëria në R, kurba e kapitalit, drawdown) dhe sezonalitet historik për çdo coin (muajt, ditët e javës, rëniet më të mëdha).
- Krahasim i 2–4 coin-ave krah për krah dhe kalkulatorë tregtari (madhësia e pozicionit, DCA, likuidimi, R:R, rritja e kapitalit).
- Dizajn responsiv: menu "Më shumë" në mobile dhe paleta e komandave (Ctrl/⌘ K) që gjen çdo faqe, veprim ose coin.
- Ndërtues strategjish pa kod, të testuara me të njëjtin motor backtest.
- Paper trading me urdhra LIMIT/STOP, SL/TP automatik dhe likuidim.
- Shpjegim me AI (Claude) i analizës.
- **Asnjë instalim shërbimesh:** `pnpm dev` nis gjithë platformën me PostgreSQL të integruar (PGlite).

> ⚠️ **Jo këshillë financiare.** Sinjalet janë probabilistike. Tregtimi i kriptovalutave mbart rrezik
> të lartë humbjeje. Lexoni [rezultatet reale të strategjive](docs/strategies/README.md) para se ta përdorni.

## Çfarë bën

| Faqja | Funksionet |
|---|---|
| **Rekomandimet** | Regjimi i tregut (risk-on / neutral / risk-off) nga BTC ndaj EMA200 dhe gjerësia e tregut → % për t'u investuar. Portofol model deri në 10 coin: vlerësim ≥ 58, volatilitet ≤ 200%, korrelacion ≤ 0.85, pesha sipas volatilitetit të anasjelltë × vlerësimit. Çdo coin ka planin e vet. Shfaq arsyet pse coin-at e tjerë mbetën jashtë, kurbën historike kundrejt BTC dhe altcoin-ave, dhe e kthen gjithë portofolin në urdhra paper me një klik |
| **Vlerësimi (CV Rating)** | Renditja e top 20–50 coin-ave me skor 0–100, notë A+…F dhe vendim (Akumulim i fortë → Shmang). Shfaq 8 shtyllat me ngjyra: trend, momentum, forca ndaj BTC, volum, rrezik, strukturë, likuiditet, sentiment. Peshat: të balancuara, të kalibruara (walk-forward), trend, momentum, konservative ose të personalizuara me rrëshqitës ([metodologjia dhe rezultatet](docs/strategies/rating.md)) |
| ↳ Plani i investimit | Për çdo coin te raporti: qëndrimi, pozicioni (spot/futures, leverage, sasia nga % e rrezikut), shkallë me 3 hyrje me arsyen e çdo niveli, breakout alternativ, stop-loss, TP1–3 me R:R, rregullat e shitjes (trailing, breakeven, rënia e vlerësimit, EMA50, time stop). Kthehet në urdhra paper ose alerte me një klik, me statistikat historike të vendimit |
| **Paneli** | BTC/ETH live, kapitalizimi total, dominanca, Fear & Greed, gjerësia e tregut, sinjalet kryesore, fituesit/humbësit, heatmap, sektorët, lista ime |
| **Grafiku** | Lightweight Charts v5 me të dhëna live (WebSocket). Lloje: candles / Heikin-Ashi / bars / line / area. Shkallë log. Layout 1/2/4 grafikë. Replay bar-pas-bari. Screenshot. Historiku ngarkohet automatikisht kur lëviz majtas |
| ↳ Indikatorë (25) | EMA 20/50/200, SMA, Hull, VWAP ±σ, Bollinger, Keltner, Donchian, SuperTrend, PSAR, Ichimoku, Volume, RSI, MACD, Stoch RSI, ADX/DMI, ATR, OBV, CVD, CMF, MFI, CCI, Williams %R, TSI |
| ↳ Analizë automatike | S/R e grupuar nga pivot-et, BOS/CHoCH, Order Blocks + FVG, divergjenca RSI, modele qirinjsh, Volume Profile (POC/VA), Fibonacci automatik, pivot points, kutia e planit (entry/SL/TP1-3) |
| ↳ Vizatime (31 mjete) | Trend line, ray, extended, horizontal, horizontal ray, vertical, kanal paralel, kanal regresioni, pitchfork, Gann fan, Fib retracement/extension/fan/time zones, drejtkëndësh, elipsë, trekëndësh, path, furçë, shigjetë, tekst, callout, etiketë çmimi, pozicion Long/Short me R:R, matës çmim/kohë/datë, XABCD, Elliott impulse + ABC, Head & Shoulders |
| ↳ Mjetet e vizatimit | Magnet OHLC, Shift për vijë horizontale, undo/redo, kopjim (Ctrl+D), bllokim, fshehje, stil (ngjyrë, trashësi, vijë, mbushje, zgjatje), menu me klik të djathtë, **alert kur çmimi kalon vizatimin**. Ruhen për çdo simbol dhe mbeten kur ndërron timeframe |
| ↳ Raporti | Verdikti 0–100, plani i tregtisë me madhësinë e pozicionit (sipas % rrezikut), shpjegim në gjuhë natyrore, skenarët bull/bear, backtest i strategjisë në atë coin, matrica MTF (15m→1w), faktorët, nivelet, struktura, order book live, tregtimet live |
| **Sinjalet** | Skanim i top 20–100 coin-ave në Web Worker. Filtra: drejtimi, skori, R:R, strategjia. Karta sinjalesh me plan dhe backtest. Track record automatik (TP/SL) |
| **Krahaso** | 2–4 coin krah për krah (lidhja ruan zgjedhjen, `?s=BTCUSDT,ETHUSDT`): CV Rating dhe vendimi, grafik radar i 8 shtyllave, performanca e rindexuar (30D–1Y) me lexim nën kursor, tabela e metrikave me vlerën më të mirë të theksuar (vlerësimi, kthimet, kthim/volatilitet, volatiliteti, drawdown, beta, korrelacioni), matrica e korrelacionit dhe përmbledhje faktike |
| **Ditari** | Statistikat e trade-ve të mbyllura (paper, manuale ose të gjitha; 30D/90D/gjithçka): win rate, profit factor, PnL neto, pritshmëria në $ dhe R, fitimi/humbja mesatare, drawdown maks., seritë, kurba e kapitalit, PnL mujor, trade-i më i mirë/keq dhe ndarja sipas coin-it, ditës, arsyes së daljes, drejtimit dhe strategjisë. Llogaritje me `decimal.js` |
| **Sezonaliteti** | Për çdo coin, nga deri 3000 ditë histori: kthimet mujore sipas viteve (heatmap me mesatare, mediane dhe % pozitive), ditët e javës, shpërndarja e kthimeve ditore, volatiliteti vjetor, dita më e mirë/keqe, seritë dhe 5 rëniet më të mëdha me kohën e rikuperimit |
| **Kalkulatorët** | **DCA në histori:** blerje periodike (ditore, javore, 2-javore, mujore) për 1–5 vjet kundrejt blerjes së gjithë shumës në fillim, me koston mesatare dhe pikën më të keqe. Madhësia e pozicionit sipas % rrezikut; DCA me shumë blerje, mesatarja, breakeven me tarifa dhe sa duhet blerë për një mesatare të synuar; leverage me çmim likuidimi (marzh i izoluar), PnL dhe ROE; objektivat 1R–5R me win-rate-in e nevojshëm për breakeven; rritja me interes të përbërë, kthimi i nevojshëm për një objektiv dhe rikuperimi pas humbjes. Gjithçka me `decimal.js` |
| **Tregu** | Grafiku i rotacionit relativ (RRG) ndaj BTC me bishtat e 8 ditëve, matrica e korrelacionit e grupuar sipas ngjashmërisë, beta dhe korrelacioni me BTC, volatiliteti 30d, max drawdown 90d, kthimi për njësi volatiliteti, shpërndarja e tregut |
| **Skaneri** | Ndërtues kriteresh (RSI, ADX, %B, kompresim BB, RVOL, distanca nga EMA-të / max 20-bar …), preset-e, skanime të ruajtura |
| **Backtest** | Motori i njëjtë me sinjalet live. Tarifa, slippage, filtër HTF, kurba e kapitalit kundrejt blej-e-mbaj, drawdown, walk-forward, Monte Carlo (1000 simulime), tregtimet në grafik |
| ↳ Ndërtuesi i strategjive | Rregulla LONG/SHORT pa kod mbi 30 seri (çmimi, EMA, RSI, MACD, Bollinger, ADX/DI, Stoch RSI, SuperTrend, Donchian, volumi relativ, CMF, MFI, OBV…) me operatorët `>`, `<`, kryqëzim lart/poshtë. Stop me ATR ose swing, konfluencë opsionale. Shembuj të gatshëm. Ruhen dhe sinkronizohen me llogarinë ([ADR 0006](docs/decisions/0006-paper-trading-custom-strategies.md)) |
| **Portofoli** | Pozicione me PnL live, madhësi automatike sipas rrezikut, rreziku i hapur, alokimi, ekspozimi sipas sektorit, paralajmërime korrelacioni (ρ > 0.8), ditar me eksport CSV |
| ↳ Paper trading | Urdhra Market / LIMIT / STOP me SL, TP dhe skadim (GTC, 1h, 24h, 7d). Validim që urdhri të mos ekzekutohet gabimisht menjëherë. Ekzekutim automatik me çmimin live, mbyllje në SL/TP dhe likuidim i vlerësuar me leverage. Ditari shënon arsyen e daljes (SL/TP/LIQ) |
| **Alertet** | Çmim mbi/nën, ndryshim 24h, RSI mbi/nën, **CV Rating mbi/nën** (njofton kur skori hyn në zonë, me peshat e tua; krijohet me një klik nga raporti i coin-it), sinjal i ri aktiv, kalim i vizatimit. Njoftime në aplikacion, browser, Web Push, Telegram dhe email. Me llogari, alertet vlerësohen nga worker-i edhe kur browser-i është i mbyllur |
| **Llogaria** | Profili, 2FA (TOTP + kode rezervë), sesionet aktive, ndryshimi i fjalëkalimit, kanalet e njoftimeve, fshirja e llogarisë |
| **Cilësimet** | Shqip/English, temë e errët/e çelët, paletë për daltonizëm, pa animacione, pamje kompakte, peshat e CV Rating dhe planet SHORT, profili i rrezikut, kapitali, leverage, tarifa, Telegram, backup/import JSON |

## Nisja

Kërkesat: **Node ≥ 20** dhe **pnpm ≥ 10**. Asgjë tjetër.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Kaq. Kjo komandë nis gjithë platformën: llogari me 2FA, sinkronizim, worker-in 24/7 (skanime, alerte,
track record, paper trading) dhe njoftimet në kohë reale. Databaza është PostgreSQL i vërtetë i kompiluar
në WebAssembly ([PGlite](https://pglite.dev)) dhe ruhet në `~/.cryptovision/db`. Migrimet aplikohen
vetë në nisje ([ADR 0005](docs/decisions/0005-self-contained-platform.md)).

Për prodhim:

```bash
pnpm build && pnpm start
```

### Konfigurimi (opsional)

Kopjoni `.env.example` në `apps/web/.env.local` vetëm nëse ju duhet diçka nga kjo tabelë:

| Variabla | Për çfarë |
|---|---|
| `CV_HOME` | Dosja e të dhënave (default `~/.cryptovision`): databaza e integruar dhe çelësi i kriptimit |
| `DATABASE_URL` | `postgres://…` për PostgreSQL të jashtëm (TimescaleDB opsionale), ose `off` për mënyrën vetëm-lokal (gjithçka në browser) |
| `REDIS_URL` | Vetëm për disa instanca serveri ose për worker në proces të veçantë (BullMQ) |
| `WORKER` | `inprocess` (default), `external` (`pnpm worker`, kërkon PostgreSQL) ose `off` |
| `ENCRYPTION_KEY` | Çelësi AES-256-GCM për sekretet e 2FA. Kur mungon, gjenerohet një herë në `$CV_HOME/secret.key` (leje 0600). I detyrueshëm vetëm me PostgreSQL të jashtëm në prodhim |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Shpjegimi me AI në raportin e coinit (default `claude-opus-5-5`) |
| `TELEGRAM_BOT_TOKEN` | Bot-i i platformës për alertet në Telegram |
| `RESEND_API_KEY`, `EMAIL_FROM` | Alerte me email |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push (`pnpm --filter @cv/worker vapid` krijon çiftin) |
| `SCAN_TIMEFRAMES`, `SCAN_SIZE` | Çfarë skanon worker-i (default `1h,4h,1d`, 60 coin) |

Databaza e integruar punon nga një proces i vetëm. Për disa instanca të serverit pas një load balancer,
përdorni `DATABASE_URL` me PostgreSQL dhe `REDIS_URL`.

### Komandat

| Komanda | Çfarë bën |
|---|---|
| `pnpm test` | 158 teste: rekomanduesi (regjimi, korrelacioni, pesha, kauzaliteti), indikatorët kundrejt `technicalindicators`, motori, CV Rating dhe plani (pa look-ahead), rreziku, paper trading, analitika (korrelacion, beta, RRG), strategjitë custom, backtest-i, TOTP sipas RFC 6238, kriptimi, alertet e worker-it dhe të vlerësimit, kalkulatorët, DCA historik, ditari, sezonaliteti dhe repo-t e DB-së mbi PGlite |
| `pnpm test:integration` | Të njëjtat teste, me repo-t e DB-së kundër PostgreSQL (`TEST_DATABASE_URL`) |
| `pnpm typecheck` | TypeScript strict në të gjitha paketat |
| `pnpm lint` / `pnpm lint:fix` | ESLint (hooks, Next.js, pa `any`, pa `console`) në gjithë monorepo-n |
| `pnpm build` / `pnpm start` | Build dhe server prodhimi (Next.js 16) |
| `pnpm test:e2e` | 31 teste Playwright: UI, rekomandimet, CV Rating + plani, ndërtuesi i strategjive, tregu, paper trading, krahasimi, kalkulatorët dhe DCA historik, ditari, sezonaliteti, paleta e komandave, menuja mobile, alertet e vlerësimit, API (regjistrim → 2FA → sesione → sinkronizim), sinkronizim vizatimesh mes dy pajisjeve. Plus portat e cilësisë: 19 faqe pa tejkalim në 375/768/1440 px dhe pa shkelje serioze WCAG 2.1 AA (axe) në të dy temat |
| `pnpm db:migrate` / `pnpm db:generate` | Zbato / gjenero migrimet |
| `pnpm worker` | Worker në proces të veçantë (vetëm me `WORKER=external` dhe PostgreSQL) |
| `pnpm backtest --symbol ETHUSDT --tf 4h --bars 3000 [--strategy breakout_volume]` | Backtest nga terminali |
| `pnpm validate:oos` | Validim jashtë mostrës në 12 coin × 3 timeframe |
| `pnpm validate:rating` | Validim historik i CV Rating (30 coin, 2021→sot), kalibrim walk-forward dhe riprodhim mujor i rekomanduesit → `calibration.json` |
| `pnpm recommend [--size 40] [--equity 10000]` | Portofoli model i sotëm nga të dhënat live, në terminal |
| `pnpm dev:clean` | Pastron cache-in e Turbopack dhe nis `pnpm dev` (nëse faqja rifreskohet pa pushim pas një ndërprerjeje) |

CI (`.github/workflows/ci.yml`) ekzekuton typecheck, lint, testet me PostgreSQL dhe me PGlite, migrimet,
build-in dhe Playwright kundër serverit të prodhimit.

## Backend

| Pjesa | Detajet |
|---|---|
| **Llogaritë** | Regjistrim/hyrje me fjalëkalim (scrypt), sesione në DB (ruhet vetëm SHA-256 i token-it, cookie `__Host-` httpOnly), bllokim pas 5 tentativave, 2FA TOTP me kode rezervë, menaxhim sesionesh, ndryshim fjalëkalimi, fshirje llogarie, audit log ([ADR 0003](docs/decisions/0003-custom-auth.md)) |
| **Databaza** | PGlite i integruar (default) ose PostgreSQL/TimescaleDB, me të njëjtën skemë Drizzle. Migrimet janë pjesë e kodit dhe aplikohen automatikisht ([ADR 0005](docs/decisions/0005-self-contained-platform.md)) |
| **Sinkronizimi** | Vizatimet, portofoli, urdhrat paper, alertet, cilësimet, skanimet dhe strategjitë e ruajtura ndjekin përdoruesin në çdo pajisje. Bashkim i zgjuar në hyrje, versione optimiste për dokumentet (409 → merret kopja e serverit) |
| **Worker** | Brenda serverit web (default) ose si proces më vete me BullMQ: skanim i universit për çdo timeframe, ndjekje TP/SL e sinjaleve, alerte çmimi live (WebSocket), RSI dhe "sinjal i ri" ([ADR 0004](docs/decisions/0004-worker-hybrid-mode.md)) |
| **Real-time** | `/api/events` (SSE) përcjell alertet dhe skanimet e reja. Bus në memorie kur worker-i është në të njëjtin proces, Redis pub/sub kur është i ndarë |
| **Njoftime** | Në aplikacion, browser, Web Push, Telegram, email |
| **Derivate** | Funding, open interest dhe long/short ratio nga OKX, si faktor në motorin e sinjaleve |
| **AI** | `/api/ai/explain` transmeton shpjegimin nga Claude. AI vetëm shpjegon numrat e motorit, nuk i shpik |
| **Siguria** | CSP dhe headers sigurie, kontroll origin për kërkesat që ndryshojnë gjendje, rate limit (Redis ose në memorie), validim Zod kudo, çelës kriptimi i gjeneruar automatikisht |

## Arkitektura

```
apps/web                  Next.js 16 · React 19 · Tailwind v4 · Zustand · TanStack Query
  ├─ app/*                faqet (/, /welcome, /chart, /signals, /screener, /markets, /backtest, /portfolio, /alerts, /settings, /account, /login)
  ├─ app/api/*            23 route handlers (auth, sync, signals, alerts, derivatives, ai, push, events)
  ├─ components/chart     ChartPanel, toolbar, raporti, stilet e vizatimeve
  ├─ lib/chart            CoordMapper, DrawingController, 31 renderer-a vizatimesh (series primitives)
  ├─ lib/data             Binance REST + WebSocket i multipleksuar (rilidhje, gap-fill)
  ├─ lib/store            store-t (settings, drawings + undo/redo, portfolio + urdhrat paper, strategies, alerts, auth)
  ├─ components/layout    AlertEngine, PaperEngine (ekzekutimi i urdhrave), SyncManager
  ├─ instrumentation.ts   hap databazën dhe nis worker-in brenda serverit
  └─ workers              scan.worker, backtest.worker
apps/worker               skanime, track record, alerte, njoftime (në proces ose BullMQ)
packages
  ├─ core                 tipet, timeframes, formatimi, matematika
  ├─ indicators           indikatorë pure + struktura (pivots, S/R, BOS/CHoCH, FVG, OB), divergjenca, modele
  ├─ risk                 planet SL/TP, madhësia e pozicionit (decimal.js), Kelly, likuidimi, paper trading
  ├─ signals              konteksti, regjimi, 19 faktorë (përfshirë derivatet), 6 strategji + strategji custom
  ├─ analytics            korrelacion, beta, volatilitet, drawdown, rotacion relativ (RRG)
  ├─ rating               CV Rating (8 shtylla, 25 metrika), plani i investimit, rekomanduesi, kalibrimi
  ├─ backtest             motor event-driven, metrika, walk-forward, Monte Carlo
  ├─ exchange             Binance REST/WS, CoinGecko, Fear & Greed, OKX derivate (browser + Node)
  ├─ engine               analiza e plotë + gate-i i backtest-it, i përbashkët për web dhe worker
  ├─ db                   Drizzle schema, migrime të integruara, PGlite / PostgreSQL, repo-t
  └─ server               env (Zod), kriptim, TOTP, bus (memorie/Redis), rate limit, njoftime, logger
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
