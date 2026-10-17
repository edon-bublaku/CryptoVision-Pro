# ADR 0002 — "Gate" i backtest-it për sinjalet aktive

- **Statusi:** Pranuar
- **Data:** 2026-10-17

## Konteksti

Parimi 4 i CLAUDE.md thotë: "Asnjë strategji sinjalesh nuk shfaqet pa rezultate backtest."
Matjet jashtë mostrës (`docs/strategies/README.md`) tregojnë se rregullat klasike TA nuk kanë avantazh të qëndrueshëm.

## Vendimi

1. Kur analizohet një coin (në grafik ose në skaner), motori bën backtest të të gjitha strategjive në
   të njëjtat ~1000 qirinj dhe në të njëjtin timeframe (`apps/web/lib/analysis.ts`, rreth 80 ms).
2. Një sinjal bëhet **ACTIVE** vetëm nëse plotëson të gjitha kushtet:
   - ka setup të konfirmuar nga një strategji;
   - R:R ≥ 1.5;
   - nuk shkon kundër trendit të timeframe-it më të lartë;
   - strategjia e vet ka **PF ≥ 1.2 dhe ≥ 6 trade** në atë coin.

   Përndryshe sinjali mbetet **WATCH** dhe UI e shpjegon pse.
3. Besueshmëria (`confidence`) përdor win rate-in e backtest-it kur ka ≥ 10 trade.
4. Çdo sinjal ACTIVE ruhet në "Track record" dhe ndiqet automatikisht deri në TP ose SL.

## Pasojat

- Shumë më pak sinjale aktive. Në kushtet e tetorit 2026, shpesh nuk ka asnjë. Kjo është e qëllimshme.
- Gate-i nuk krijon avantazh vetvetiu: në validimin OOS, PF u rrit vetëm nga 0.71 në 0.75.
  Gate-i është masë mbrojtëse dhe transparence, jo garanci fitimi.
- UI tregon gjithmonë statistikat dhe paralajmërimin "Rezultatet e kaluara nuk garantojnë të ardhmen".
