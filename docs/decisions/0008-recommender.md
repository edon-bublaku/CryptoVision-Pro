# ADR 0008 — Rekomanduesi: portofol model i bazuar te CV Rating dhe te regjimi i tregut

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

Përdoruesi kërkon rekomandime për coin-at që ia vlen të investohen, bazuar në gjendjen aktuale.
Vetë CV Rating nuk mjafton: në validim, blerja e 6 coin-ave me vlerësimin më të lartë (pa rregulla
të tjera) humbi 65% në 2022–2026.

## Vendimi

1. **Funksion pur `recommend()`** te `@cv/rating`. Bën katër hapa:
   - përcakton regjimin e tregut (BTC ndaj EMA200 dhe gjerësia e tregut), që vendos sa % investohet;
   - filtron coin-at sipas vlerësimit (≥ 58) dhe volatilitetit (≤ 200%/vit);
   - shmang coin-at me korrelacion 90d > 0.85 me një coin të zgjedhur;
   - jep pesha me volatilitet të anasjelltë × vlerësimin, me tavan 35%.

   Gjithçka është kauzale.
2. **Rekomanduesi riprodhohet në histori** brenda `pnpm validate:rating` dhe krahasohet me BTC,
   me peshat e barabarta dhe me "top 6 pa filtra". Rezultatet ruhen te `calibration.json` dhe shfaqen te faqja.
3. **Në UI:**
   - faqja `/recommendations`: regjimi, ndarja e kapitalit, kartat e coin-ave me planin, arsyet e përjashtimit, grafiku historik;
   - karta "Rekomandimet e sotme" te Paneli;
   - një klik për ta kthyer portofolin në urdhra paper.
4. **CLI:** `pnpm recommend` nxjerr portofolin e sotëm nga të dhënat live.
5. **Plani i investimit fiton kufij në përqindje:** hapi mes niveleve maks. 10%, hapi rezervë maks. 7%,
   stop-i maks. 15% nën hyrjen më të thellë. Arsyeja: për coin-at shumë të paqëndrueshëm, 3 ATR arrinin 30%.

## Pasojat

- **Rekomandimet tregojnë gjithmonë dy gjëra:** sa cash të mbahet, dhe historikun e ndershëm.
  Në periudhën e testuar, rekomanduesi fitoi më pak se BTC (+70% kundrejt +86%), por me rënie maksimale −42% kundrejt −65%.
- **Ndryshimi i rregullave** (pragjet, ekspozimi, korrelacioni, volatiliteti) kërkon ekzekutimin e validimit
  dhe përditësimin e `docs/strategies/rating.md`.
