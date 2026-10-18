# ADR 0011 — Planifikuesi i futures dhe ngjarjet e tregut

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

Përdoruesit duan të dinë si ta tregtojnë një sinjal në futures (perpetual swap):

- kur të hyjnë dhe në cilin drejtim;
- me sa leverage;
- me marzh isolated apo cross;
- kur të dalin;
- me të gjitha metrikat dhe ngjarjet e tregut para syve.

## Vendimi

1. **`futuresPlan` te `@cv/risk`**: funksion i pastër, me Decimal, mbi planin ekzistues të sinjalit.
   - **Madhësia** vjen nga rreziku:
     `sasia = kapitali × rrezik% / (|hyrja − stop| + tarifat taker hyrje/dalje + funding-u i pritur për mbajtjen)`.
     Leverage-i nuk e rrit rrezikun; ndryshon vetëm marzhin dhe likuidimin.
   - **Leverage-i maksimal i sigurt:** `floor(1 / (1.5 × distanca e stop-it + mmr))`. Kështu likuidimi
     (isolated) mbetet të paktën 1.5 herë distancën e stop-it larg hyrjes.
   - **Leverage-i i rekomanduar:** më i ulëti me të cilin marzhi zë ≤ 25% të kapitalit, por jo mbi
     maksimumin e sigurt ose kufirin e përdoruesit. Nëse as ky kufi s'mjafton, pozicioni zvogëlohet.
   - **Isolated kundrejt cross:** shfaqen të dyja, me çmimin e likuidimit dhe humbjen maksimale.
     - Isolated: `E × (1 ∓ 1/L ± mmr)`.
     - Cross: aty ku `balanca + PnL = mmr × nocionali`.
     - Rekomandohet **isolated**, sepse humbja kufizohet te marzhi i pozicionit; cross rrezikon gjithë balancën.
   - **Funding:** llogaritet sipas intervalit real të kontratës (OKX). Pozitiv do të thotë që long-ët paguajnë.
   - **Breakeven:** përfshin tarifat dhe funding-un.
   - **R:R neto:** si te plani, targetet llogariten vetëm deri te niveli i parë kundërshtues.
2. **`marketEvents` te `@cv/signals`**: ngjarje diskrete në qirinj të mbyllur, pa look-ahead (me test):
   - kryqëzimet EMA 20/50 dhe 50/200 (golden/death cross), çmimi ndaj EMA200, MACD;
   - RSI, SuperTrend, ADX, kompresimi dhe thyerja e Bollinger, breakout 20 qirinj, volumi;
   - BOS/CHoCH, divergjencat dhe modelet e qirinjve.

   `derivativeEvents` shënon funding-un ekstrem (normalizuar në 8 orë), lëvizjet e mëdha të OI-së,
   pozicionimin e mbingarkuar long/short dhe dominimin e blerësve ose shitësve taker.
3. **Faqja `/futures`** jep:
   - vendimin: hyr, prit ose mos hyr, me arsyet (setup, gate-i i backtest-it, R:R, timeframe-i më i
     lartë, derivatet kundër);
   - kur të hysh, me sa leverage dhe çfarë marzhi, kur të dalësh (TP-të, breakeven, CHoCH, funding,
     koha, likuidimi) dhe kostot;
   - të gjitha metrikat dhe ngjarjet;
   - paper trading dhe alertet.

   Aplikacioni **nuk ekzekuton urdhra reale**.

## Pasojat

- Sinjalet, strategjitë dhe faktorët nuk ndryshuan, ndaj `validate:oos` dhe `validate:rating` nuk preken.
- Pragjet e derivateve (0.05%/8h, OI ±10%, L/S ≥ 2.5 ose ≤ 0.6, taker ≥ 58% ose ≤ 42%) janë paralajmërime
  informative. Ato nuk ndikojnë në skor.
