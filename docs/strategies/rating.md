# CV Rating — metodologjia dhe rezultatet reale

CV Rating është një skor **0–100 për çdo coin**, i llogaritur mbi qirinj **ditorë të mbyllur**.
Kodi është te `packages/rating`: `rating.ts` për skorin dhe `plan.ts` për planin. Numrat më poshtë
gjenerohen nga `pnpm validate:rating` dhe ruhen te `packages/rating/src/calibration.json`.
Aplikacioni i shfaq drejtpërdrejt nga ai skedar.

> Ky nuk është parashikim i sigurt. Fuqia parashikuese është **e dobët**. Shihni rezultatet.

## 1. Si llogaritet

```
Rating = Σ (skori i shtyllës × pesha e shtyllës) / Σ peshat e shtyllave me të dhëna
Skori i shtyllës = Σ (skori i metrikës × pesha e metrikës) / Σ peshat e metrikave me të dhëna
Skori i metrikës = vlera bruto → 0..100 me kurbë të publikuar (lineare me nyje ose tanh)
```

| Shtylla | Pesha e balancuar | Metrikat (pesha brenda shtyllës) |
|---|---|---|
| Trendi | 22 | Renditja e EMA-ve 20/50/200 (3) · Pjerrësia e EMA200 në 20d (2) · EMA50 kundrejt EMA200 (1.5) · ADX × drejtimi DI (1.5) · SuperTrend 10,3 (1) |
| Momentumi | 15 | RSI 14 (2) · Kthimi 30d (2) · Kthimi 90d (1.5) · Histogrami MACD dhe drejtimi i tij (1.5) · Ditë në rritje nga 30 (1) |
| Forca ndaj BTC | 15 | Kthimi 30d minus BTC (2) · Kthimi 90d minus BTC (1.5) · Kuadranti RRG (1.5) |
| Volumi & rrjedha | 10 | Trendi i OBV (1.5) · CMF 20 (1.5) · Volumi i ditëve në rritje / në rënie 30d (1.5) · Pjesa e blerësve taker 14d (1) |
| Rreziku | 13 | Volatiliteti 30d i vjetorizuar (2) · Max drawdown 90d (1.5) · Kthimi / volatiliteti 90d (2) |
| Struktura | 13 | BOS/CHoCH ditor (2) · Distanca nga maksimumi 52-javor (1.5) · Hapësira rezistencë/mbështetje (1.5) |
| Likuiditeti | 6 | Volumi mesatar ditor në USDT 30d (1) |
| Sentimenti | 6 | Fear & Greed, kundërrrymë (1) |

- **Shtyllat pa të dhëna përjashtohen.** Pesha rinormalizohet, p.sh. BTC nuk ka "Forca ndaj BTC". UI tregon mbulimin.
- **Besueshmëria** është mesatarja e mbulimit me pajtimin mes shtyllave, ku pajtimi = 1 − devijimi standard / 30.
- **Vendimi:** ≥ 75 Akumulim i fortë · ≥ 60 Akumulo · ≥ 45 Mbaj/prit · ≥ 30 Redukto · < 30 Shmang.
- **Pa look-ahead.** Gjithçka është kauzale dhe një test verifikon që skori në ditën *i* nuk ndryshon kur shtohen ditë të mëvonshme.

## 2. Plani i investimit

| Vlerësimi | Qëndrimi | Hyrja |
|---|---|---|
| ≥ 70 | Blej tani dhe në tërheqje | 40% me çmimin aktual (20% nëse çmimi është i zgjatur), pjesa tjetër limit |
| 58–70 | Blej vetëm në tërheqje | 3 urdhra limit 40/35/25% |
| 45–58 | Prit | të njëjtat nivele, por vetëm si zona vëzhgimi + breakout |
| 30–45 | Redukto | për mbajtësit: shit 50%, stop i fortë, rihyrje mbi 58 |
| < 30 | Dil | për mbajtësit: dalje; short vetëm nëse e aktivizoni dhe trendi < 35 |

- **Nivelet e hyrjes:** mbështetjet nga pivot-et e 300 ditëve, EMA20/EMA50, swing low-i i fundit dhe minimumi 20-ditor. Duhet të jenë të paktën 0.5 ATR larg çmimit. Kur mungojnë, përdoret hapi 1.5 ATR.
- **Stop-loss:** 1 ATR përtej hyrjes më të thellë, ose pak përtej mbështetjes tjetër nëse ajo është brenda 1.5 ATR. Asnjëherë më larg se 3.5 ATR.
- **Madhësia:** `rreziku = kapitali × rrezik%`; `sasia = rreziku / (|hyrja mesatare − stop| + tarifat)`, me decimal.js.
  - Me shtyllën e rrezikut < 40: vetëm spot, pa leverage.
  - Përndryshe: leverage deri në maksimumin e cilësimeve.
  - Short: maksimumi 2×.
- **Daljet:**
  - TP1: rezistenca e parë ≥ 1R, ose 1.5R (40%).
  - TP2: rezistenca tjetër ≥ TP1 + 1R, ose 3R (30%).
  - TP3: 5R me trailing chandelier 3×ATR (30%).
  - Pas TP1: stop në breakeven.
- **Rregullat e shitjes:**
  - Mbyllje ditore përtej stop-it → dalje e plotë.
  - Rating < 45 → shit gjysmën.
  - Rating < 30 → dalje e plotë.
  - Mbyllje nën EMA50 → paralajmërim.
  - TP1 i paarritur brenda 45 ditëve → rivlerëso.

## 3. Validimi historik

**Metoda:**

- **Të dhënat:** 30 coin të mëdhenj, deri në 2000 ditë histori nga Binance.
- **Mostrat:** çdo 30 ditë, me data të përbashkëta për të gjithë coin-at dhe dritare jo të mbivendosura.
- **Pyetja:** çfarë bëri çmimi në 30 ditët pas vlerësimit, i cili përdor vetëm të dhënat deri në atë ditë.

Rezultati: 1740 vëzhgime, 2021-12-29 → 2026-09-04.

### Peshat e balancuara (zgjedhur paraprakisht, pa u përshtatur)

| Vendimi | n | Kthimi mesatar 30d | Mediana | Në rritje | Mundi BTC | Rënia maks. mesatare |
|---|---|---|---|---|---|---|
| Akumulim i fortë | 43 | −3.4% | −6.8% | 37% | 21% | −14.5% |
| Akumulo | 257 | **+5.2%** | +1.0% | 51% | 35% | −13.0% |
| Mbaj/prit | 524 | −0.4% | −4.2% | 43% | 34% | −15.3% |
| Redukto | 695 | −0.7% | −3.3% | 42% | 30% | −14.6% |
| Shmang | 221 | +3.6% | −0.3% | 49% | 48% | −14.9% |
| *Të gjitha* | 1740 | +0.7% | | 44% | | −14.6% |

- **Rank IC** (korrelacioni i renditjes mes skorit dhe kthimit 30d, mes coin-ave në të njëjtën datë): **0.075**.
  - t = 2.05, pozitiv në 64% të 58 datave.
  - Sipas gjysmave: 0.055 në gjysmën e parë, 0.096 në të dytën.
- **Kuintili më i mirë minus më i keqi:** +0.8% për 30 ditë, pozitiv në 60% të datave.
- **IC sipas shtyllave:** rreziku 0.14 · likuiditeti 0.14 · struktura 0.05 · trendi 0.05 · momentumi 0.03 · forca ndaj BTC 0.02 · volumi 0.01.
- **Sentimenti** është i njëjtë për të gjithë coin-at në një datë. Te BTC, IC-ja e tij si seri kohore është −0.08.

**Interpretimi i ndershëm:**

- Skori ka një lidhje pozitive, por **të dobët**, me kthimet e ardhshme.
- Kategoritë **nuk janë monotone**:
  - "Akumulim i fortë" (n = 43, i vogël) shpesh erdhi vonë, pas lëvizjeve të mëdha.
  - "Shmang" kishte rikthime të forta (mesatarja +3.6%, mediana −0.3%).
- Rënia maksimale gjatë 30 ditëve është rreth −13% deri −15% në çdo kategori. Stop-loss-i nuk është opsional.

### Peshat e kalibruara (walk-forward)

Peshat u nxorën **vetëm nga gjysma e parë** (2021-12 → 2024-05), proporcionalisht me IC-në pozitive të çdo shtylle. Rezultati:

- Trendi 0 · momentumi 13 · forca ndaj BTC 9 · volumi 9 · rreziku 35 · struktura 12 · likuiditeti 22 · sentimenti 0.

Pastaj u testuan në **gjysmën e dytë**, që nuk e kishin parë (2024-05 → 2026-09):

| | IC | Kuintili top − bottom |
|---|---|---|
| Të balancuara | 0.096 | +1.0% / 30d |
| **Të kalibruara** | **0.184** | **+3.0% / 30d** |

| Vendimi (të kalibruara, jashtë mostrës) | n | Mesatarja 30d | Mediana | Në rritje | Rënia maks. |
|---|---|---|---|---|---|
| Akumulim i fortë | 25 | +2.7% | +1.5% | 60% | −8.0% |
| Akumulo | 161 | +3.8% | −0.7% | 49% | −13.3% |
| Mbaj/prit | 346 | +3.0% | −2.4% | 47% | −16.1% |
| Redukto | 297 | −1.9% | −2.2% | 45% | −15.8% |
| Shmang | 41 | −1.9% | −5.6% | 32% | −15.5% |

Peshat e kalibruara **renditin më mirë coin-at mes tyre**: zgjedhin coin-a të mëdhenj, likuidë dhe me volatilitet të ulët. Por ato **nuk shohin drejtimin e tregut**, sepse trendi merr 0%. Prandaj nuk janë parazgjedhje për pyetjen "kur të investoj", por një opsion për "cilin coin".

### Kufizimet

- **Survivorship bias:** lista e 30 coin-ave është ajo e sotme. Coin-at që u rrëzuan nuk janë në mostër, ndaj rezultatet janë optimiste.
- **Kalibrimi** ka vetëm një ndarje kohore dhe 29 data jashtë mostrës. Periudha 2024–2026 u dominua nga BTC, gjë që favorizon likuiditetin.
- **Tarifat dhe slippage-i** nuk përfshihen. Kthimet janë kthime çmimi.
- **Derivatet** (funding, OI) nuk janë në skor, sepse nuk kanë histori të besueshme. Shfaqen veçmas te raporti.

## 4. Rregull për ndryshimet

Çdo ndryshim në metrika, kurba, pesha ose pragje kërkon tri hapa:

1. Ekzekutoni `pnpm validate:rating`.
2. Commit-oni `calibration.json` të ri.
3. Përditësoni këtë dokument, edhe kur numrat përkeqësohen.
