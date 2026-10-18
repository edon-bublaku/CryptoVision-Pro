# ADR 0010 — Auditimi i llogaritjeve dhe korrigjimet

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

U bë një auditim i detajuar i çdo llogaritjeje në platformë. Pesë fusha u kontrolluan me llogaritje të
pavarura mbi të dhëna konkrete, edhe për SHORT, leverage dhe raste kufitare:

- rreziku dhe portofoli;
- indikatorët (krahasuar me `technicalindicators`, TA-Lib dhe TradingView);
- backtest-i dhe sinjalet;
- CV Rating, rekomanduesi dhe analitika;
- UI dhe formatimi.

Formulat kryesore rezultuan të sakta. Gabimet u gjetën në rregulla dhe raste kufitare. Çdo korrigjim ka
test regresioni (`regressions.test.ts` në paketat përkatëse).

## Vendimet që prekin kontratat

1. **`TradePlan.riskReward`** mbetet R:R i ponderuar sipas madhësisë së TP-ve. Por çdo target përtej
   nivelit të parë kundërshtues (rezistenca për LONG, mbështetja për SHORT) llogaritet vetëm deri te
   ai nivel.
   - Më parë vlera minimale ishte 2.2 me konfigurimin standard (TP2 = 3R, TP3 = 5R), ndaj rregulli
     "R:R < 1.5 → vetëm në vëzhgim" nuk aktivizohej kurrë.
   - TP1 nuk vendoset më në anën e humbjes kur niveli është shumë afër hyrjes. `rr` ka shenjë.
   - Planet me target ≤ 0 (SHORT me stop shumë të gjerë) refuzohen.
2. **`ExitRule.id`** fiton `rating_exit_above` dhe `ema50_close_above` për planet SHORT. Më parë një
   short merrte rregullin "dil nëse vlerësimi bie nën 55", që ishte i vërtetë që në krijim.
   TP3 i një short-i nuk shkon më nën gjysmën e TP2 (më parë mund të ishte negativ).
3. **`Backtest ExitReason`** fiton `TRAIL`: stop-i i goditur pasi TP2 e ka lëvizur te TP1.
4. **Alertet e vizatimit** ruajnë `drawing.log` (JSON, pa migrim SQL). Në shkallë logaritmike linja
   interpolohet gjeometrikisht, si në ekran.
5. **`unrealizedPnl`** kthen edhe `roe` (lëvizja × leverage, para rrumbullakimit). Shtohet `maxLoss`:
   humbja te stop-i, e kufizuar nga marzhi i izoluar.
6. **Javët (1w)** nisin të hënën 00:00 UTC (`bucketStart`), si qirinjtë javorë të Binance.
   Më parë nisnin të enjten (epoka Unix). Kjo prek pivot-et javore dhe filtrin HTF në backtest.

## Korrigjime të tjera (pa ndryshim kontrate)

- **Rreziku:**
  - një stop që kalon likuidimin humb më së shumti marzhin;
  - leverage-i kufizohet në 125×;
  - `positionSize` dhe `leverageCalc` refuzojnë hyrje të pavlefshme në vend që të kthejnë NaN;
  - targetet SHORT ≤ 0 hiqen te kalkulatori R:R;
  - drawdown % i ditarit është NaN pa kapital fillestar.
- **Backtest-i:**
  - slippage-i në hapje përdor ATR-në e barit të mëparshëm (pa look-ahead);
  - daljet TIME/END kanë slippage;
  - `maxBarsInTrade` numëron saktë.
- **Gjurmimi i sinjaleve:** targetet në barin e hyrjes numërohen vetëm nëse bari hapi brenda zonës.
- **Indikatorët:**
  - Volume Profile nuk humb më volum;
  - PSAR kufizohet në barin e kthesës;
  - MFI = 50 pa lëvizje;
  - HMA me floor(√n);
  - SuperTrend nis si TradingView;
  - EMA dhe `EmaState` i kapërcejnë boshllëqet;
  - `lastFinite` kthen vlerën e fundit të fundme;
  - harami dhe morning/evening star ndjekin përkufizimet standarde.
- **Rekomanduesi:**
  - peshat me tavan 35% shpërndahen deri në fund (water-filling), ndaj portofoli nuk mbetet nën-investuar;
  - korrelacioni llogaritet sipas datës;
  - `resolveWeights` pranon vetëm çelësat e vet.
- **Analitika:** `ret90d` është NaN pa 90 ditë histori.
- **UI:**
  - R:R i mjetit Long/Short ka drejtim;
  - alerti i zonës së hyrjes nuk shkrep menjëherë;
  - shenja e stop-it për SHORT;
  - rreziku real kur leverage-i e kufizon pozicionin;
  - koha e track record-it llogaritet nga mbyllja e barit;
  - leverage-i i planit nuk rrumbullakohet;
  - funding-u vjetor sipas intervalit real;
  - gjerësia e tregut nuk i numëron coin-at e pandryshuar si në rënie;
  - formatimi (1.00M në vend të 1000.00K, pa "-0.00%", çmime dhe sasi shumë të vogla).

## Pasojat

`pnpm validate:oos` dhe `pnpm validate:rating` u ekzekutuan pas ndryshimeve. Numrat e rinj janë te
`docs/strategies/README.md`, `docs/strategies/rating.md` dhe `calibration.json`, edhe aty ku përkeqësohen.
