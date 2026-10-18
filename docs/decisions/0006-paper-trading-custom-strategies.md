# ADR 0006 — Paper trading dhe strategji të përcaktuara nga përdoruesi

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

Përdoruesit duan të provojnë idetë pa para reale dhe të testojnë rregullat e tyre, jo vetëm gjashtë
strategjitë e integruara. Të dyja prekin kontratat (`Position`, `StrategyId`, skema e DB-së).

## Vendimi

### Paper trading

- Logjika është pure në `@cv/risk` (`paper.ts`): `orderTriggered`, `orderFillPrice`, `orderProblem`,
  `exitHit`, `liquidationPrice`, `closeResult`. PnL dhe R llogariten me `decimal.js`.
- Modeli i ekzekutimit është konservativ. LIMIT mbushet te çmimi i vet ose më mirë kur çmimi kërcen.
  STOP mbushet me çmimin e vëzhguar. SL dhe likuidimi dalin me çmimin e vëzhguar, TP te niveli i vet.
  Kur SL është përtej çmimit të likuidimit, likuidimi ndodh i pari.
- `PaperEngine` në browser i zbaton këto mbi çmimet live (`!miniTicker@arr`, 1 Hz). Pozicioni i krijuar
  nga një urdhër merr `id`-në e urdhrit, ndaj dy pajisje të hapura konvergjojnë në një pozicion pas
  sinkronizimit.
- Kontratat:
  - `Position.paper?: boolean`
  - `ClosedTrade.exitReason?: "MANUAL" | "SL" | "TP" | "LIQ"`
  - migrimi `0002_paper_trading` (`positions.paper`, `positions.exit_reason`)
  - urdhrat në pritje si dokument gjendjeje `orders`

### Strategji custom

- `@cv/signals/custom.ts`: përkufizim JSON i validuar me Zod (`customStrategySchema`): kushte LONG/SHORT
  mbi 30 seri të kontekstit, me `>`, `<`, `crossAbove`, `crossBelow`; stop me ATR ose swing;
  konfluencë opsionale.
- `buildCustomStrategy()` kthen një `Strategy` të zakonshme me `id: "custom"`. `StrategyId` tani është
  `BuiltInStrategyId | "custom"`; `STRATEGY_IDS` mbetet vetëm për të integruarat.
- `EvaluateOptions.custom` / `BacktestConfig.custom` i shtojnë motorit. Me `strategies: []` testohet
  vetëm strategjia custom. Seritë janë kauzale dhe `high20/low20` përjashtojnë qiririn aktual.
  Një test verifikon që nuk ka look-ahead.
- Strategjitë e ruajtura sinkronizohen si dokument gjendjeje `strategies`.

## Pasojat

- Sjellja e strategjive të integruara nuk ndryshon (`ignoreConfluence` është `undefined` për to),
  prandaj numrat OOS te `docs/strategies/README.md` mbeten të vlefshëm.
- Paper trading ekzekutohet vetëm kur aplikacioni është i hapur në të paktën një pajisje. Çmimet
  kontrollohen një herë në sekondë, ndaj lëvizjet brenda sekondës nuk shihen. Ekzekutimi në server
  (worker) është hapi i ardhshëm i mundshëm.
- Rezultatet e strategjive custom shfaqen me të njëjtin paralajmërim ndershmërie si backtest-et e tjera.
