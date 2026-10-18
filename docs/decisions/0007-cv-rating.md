# ADR 0007 — CV Rating: skor investimi shumë-shtyllësh me plan dhe validim

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

Përdoruesi kërkon për çdo coin tre gjëra:

- kur të investojë, në çfarë pozicioni dhe kur të shesë;
- shumë metrika;
- një skor 0–100 nga shumë parametra, secili me peshën e vet.

Motori i sinjaleve (19 faktorë) mat **kohën e hyrjes** në një timeframe. Kjo kërkesë ka nevojë për një
**vlerësim investimi** në horizont ditësh/javësh, të ndarë nga timing-u.

## Vendimi

1. **Paketë e re pure `@cv/rating`:**
   - 8 shtylla dhe 25 metrika mbi qirinj ditorë;
   - kurba të publikuara 0..100 dhe pesha për çdo metrikë dhe shtyllë;
   - rinormalizim kur mungojnë të dhënat;
   - e gjitha kauzale.
2. **`investmentPlan()`** jep qëndrimin, pozicionin (spot/futures, leverage, sasi nga % e rrezikut me decimal.js),
   shkallën me 3 hyrje, breakout-in, stop-in, TP1–3 dhe rregullat e shitjes.
   UI e kthen planin në urdhra paper ose alerte me një klik.
3. **Validimi është pjesë e produktit.** `pnpm validate:rating` shkruan `calibration.json`, dhe UI tregon për
   vendimin aktual çfarë ndodhi historikisht.
4. **Peshat:**
   - **Parazgjedhja:** të balancuarat, të zgjedhura paraprakisht.
   - **Të kalibruarat:** walk-forward, më të mira jashtë mostrës për renditjen mes coin-ave, por pa trend. Ofrohen si opsion.
   - **Presetet** "trend", "momentum" dhe "konservativ", si edhe peshat e personalizuara, janë të shënuara si të pavaliduara.
5. **Kontrata të reja:**
   - `Rating`, `PillarWeights` dhe `InvestmentPlan` te `@cv/rating`.
   - Cilësimet `ratingPreset`, `ratingWeights` dhe `allowShortPlans` (të sinkronizuara).
6. **Ndarja nga motori i sinjaleve:**
   - Raporti i coinit tregon të dyja: "CV Rating" (1D, investim) dhe "Sinjali i hyrjes" (TF aktual, timing).
   - Ato mund të ndryshojnë dhe UI i emërton qartë.

## Pasojat

- **Rezultatet janë të dobëta dhe raportohen ashtu siç janë:** IC 0.075, kategori jo monotone.
  UI dhe dokumenti nuk përdorin kurrë "e sigurt" apo "garantuar".
- **Kostoja e faqes `/rating`:** shkarkon 420 ditë për çdo coin (30–50 kërkesa, të ruajtura 15 min në cache).
  Llogaritja bëhet në browser dhe ndryshimi i peshave rillogarit vetëm skorin.
