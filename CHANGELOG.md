# Changelog

Formati ndjek [Keep a Changelog](https://keepachangelog.com/) dhe versionet ndjekin [SemVer](https://semver.org/).

## [1.1.0] — 2026-10-18

### Shtuar
- **Futures (`/futures`)** ([ADR 0011](docs/decisions/0011-futures-planner.md)):
  - vendimi hyr / prit / mos hyr, me arsyet;
  - zona e hyrjes, stop-i dhe sasia sipas rrezikut;
  - leverage-i i rekomanduar dhe maksimumi i sigurt;
  - isolated kundrejt cross, me likuidimin dhe humbjen maksimale;
  - TP-të me PnL/ROE neto, breakeven me tarifat dhe funding-un, rregullat e daljes;
  - të dhënat e derivateve nga OKX;
  - paper trade me leverage dhe alerte.
- **Ngjarjet e tregut:** golden/death cross, kryqëzimet EMA dhe MACD, RSI, SuperTrend, ADX, Bollinger,
  breakout, volum, BOS/CHoCH, divergjenca dhe modele, në qirinj të mbyllur pa look-ahead. Shtohen edhe
  ngjarjet e derivateve (funding ekstrem, OI, pozicionim i mbingarkuar, taker).
- Intervali i funding-ut nga OKX përdoret kudo, edhe në llogaritjen vjetore.

## [1.0.1] — 2026-10-18

Auditim i detajuar i të gjitha llogaritjeve dhe korrigjimet përkatëse ([ADR 0010](docs/decisions/0010-calculation-audit.md)).
Formulat kryesore ishin të sakta. Gabimet ishin në rregulla dhe raste kufitare.

### Korrigjuar
- **R:R i planit të tregtisë:** targetet përtej nivelit kundërshtues numërohen vetëm deri te niveli, ndaj
  rregulli "R:R < 1.5 → vëzhgim" funksionon (më parë minimumi ishte 2.2). TP1 nuk del më në anën e humbjes.
- **Leverage:**
  - një stop që kalon likuidimin humb më së shumti marzhin;
  - rreziku i hapur kufizohet nga marzhi;
  - ROE llogaritet para rrumbullakimit;
  - leverage-i maksimal është 125×.
- **Backtest-i:**
  - slippage-i pa look-ahead;
  - slippage edhe në daljet TIME/END;
  - kohëzgjatja maksimale numërohet saktë;
  - javët nisin të hënën, si te Binance;
  - dalja pas TP2 ka emrin e vet ("TRAIL").
- **Track record:** targetet në barin e hyrjes nuk numërohen nëse mund të kenë ndodhur para hyrjes.
- **Indikatorët:**
  - Volume Profile nuk humb volum;
  - PSAR në barin e kthesës;
  - MFI pa lëvizje = 50;
  - HMA me floor(√n);
  - fillimi i SuperTrend si te TradingView;
  - EMA me boshllëqe;
  - `lastFinite`;
  - harami dhe morning/evening star.
- **Rekomanduesi:**
  - tavani 35% shpërndahet plotësisht, ndaj portofoli nuk mbetet nën-investuar;
  - korrelacioni llogaritet sipas datës.
- **Planet SHORT:** targetet mbeten mbi zero dhe rregullat e daljes kanë drejtimin e duhur.
- **UI:**
  - R:R i mjetit Long/Short me drejtim;
  - alerti i zonës së hyrjes nuk shkrep menjëherë;
  - alertet e vizatimit ndjekin shkallën log;
  - pivot-et javore;
  - shenja e stop-it për SHORT;
  - rreziku real;
  - funding-u vjetor sipas intervalit;
  - gjerësia e tregut;
  - formatimi i numrave shumë të vegjël dhe i njësive (1.00M, jo 1000.00K).
- **Teste:** 36 teste të reja regresioni (gjithsej 194).

### Rezultatet pas korrigjimeve
- Validimi jashtë mostrës: 629 trade, PF 0.79 (të gjitha) dhe 146 trade, PF 0.66 (me gate). Ende pa avantazh.
- Rekomanduesi historik: +70.0% (më parë +69.7%), rënia maksimale −41.8%.

## [1.0.0] — 2026-10-18

Publikimi i parë i plotë. `pnpm install && pnpm dev` nis gjithë platformën pa asnjë shërbim të jashtëm.

### Investimi
- **CV Rating 0–100** për çdo coin: 8 shtylla, 25 metrika me pesha, notë A+…F, vendim, besueshmëri dhe
  preset-e peshash (të balancuara, të kalibruara, trend, momentum, konservative, të personalizuara).
  Validim historik mbi 30 coin që nga 2021 ([ADR 0007](docs/decisions/0007-cv-rating.md)).
- **Plani i investimit** për çdo coin: hyrje në shkallë, stop-loss, TP1–3 me R:R, madhësia e pozicionit sipas
  % të rrezikut dhe rregullat e daljes.
- **Rekomandimet:** portofol model sipas regjimit të tregut, me kufij korrelacioni dhe volatiliteti dhe
  riprodhim historik ([ADR 0008](docs/decisions/0008-recommender.md)).
- **Portofoli dhe paper trading:** urdhra LIMIT/STOP, SL/TP automatik, likuidim, ekspozim sipas sektorit,
  paralajmërime korrelacioni.
- **Ditari i tregtimit:** win rate, profit factor, pritshmëria në R, kurba e kapitalit, drawdown, seritë dhe ndarjet.

### Analiza
- **Grafik live** (Lightweight Charts v5): 25 indikatorë, 31 mjete vizatimi, undo/redo, magnet, layout 1/2/4,
  replay, analizë automatike (S/R, BOS/CHoCH, Order Blocks, FVG, Volume Profile, Fibonacci).
- **Sinjale** me konfluencë nga 19 faktorë dhe 6 strategji, filtër i timeframe-it më të lartë, gate backtest-i
  për coin ([ADR 0002](docs/decisions/0002-backtest-gate.md)) dhe track record automatik.
- **Skaneri**, **Tregu** (RRG, korrelacion, beta, volatilitet), **Krahaso** (2–4 coin) dhe **Sezonaliteti**
  (kthimet mujore sipas viteve, ditët e javës, rëniet historike).
- **Derivate OKX** (funding, open interest, long/short) dhe **shpjegim me AI** (Claude) i analizës.

### Mjetet
- **Backtest Lab** event-driven me tarifa, slippage, walk-forward dhe Monte Carlo; ndërtues strategjish pa kod
  ([ADR 0006](docs/decisions/0006-paper-trading-custom-strategies.md)).
- **Kalkulatorët:** madhësia e pozicionit, DCA dhe mesatarja, leverage/likuidimi, objektivat R:R, rritja e
  kapitalit dhe DCA në histori kundrejt blerjes së menjëhershme.
- **Alertet:** çmim, ndryshim 24h, RSI, CV Rating, sinjal i ri, kalim i vizatimit; njoftime në aplikacion,
  browser, Web Push, Telegram dhe email; vlerësim 24/7 nga worker-i ([ADR 0009](docs/decisions/0009-rating-alerts-and-quality-gates.md)).

### Platforma
- Llogari me 2FA TOTP, sesione të revokueshme dhe sinkronizim mes pajisjeve ([ADR 0003](docs/decisions/0003-custom-auth.md)).
- PostgreSQL i integruar (PGlite), worker brenda procesit dhe bus në memorie; PostgreSQL + Redis opsionalë
  për shkallëzim ([ADR 0005](docs/decisions/0005-self-contained-platform.md)).
- Shqip/English, temë e errët/e çelët, paletë për daltonizëm, pa animacione, pamje kompakte, PWA, navigim i
  grupuar, paleta e komandave (Ctrl/⌘ K) dhe menu "Më shumë" në mobile.
- Cilësia: TypeScript strict, ESLint, 158 teste unit, 31 teste e2e, kontrolle WCAG 2.1 AA (axe) dhe responsive
  (375/768/1440 px) në CI.

### Rezultatet e ndershme
- Validimi jashtë mostrës i strategjive klasike jep profit factor 0.71–0.75: **nuk kanë dëshmuar avantazh**.
  Detajet: [`docs/strategies/README.md`](docs/strategies/README.md) dhe [`docs/strategies/rating.md`](docs/strategies/rating.md).

[1.1.0]: https://github.com/edon-bublaku/CryptoVision-Pro/releases/tag/v1.1.0
[1.0.1]: https://github.com/edon-bublaku/CryptoVision-Pro/releases/tag/v1.0.1
[1.0.0]: https://github.com/edon-bublaku/CryptoVision-Pro/releases/tag/v1.0.0
