# Strategjitë — përshkrimi dhe rezultatet reale

Të gjitha strategjitë jetojnë në `packages/signals/src/strategies.ts` dhe përdorin të njëjtin kod
në sinjalet live dhe në backtest (`packages/backtest`). Sinjali llogaritet vetëm në mbylljen e
qiririt; hyrja në backtest bëhet në hapjen e qiririt pasardhës.

**Rregullat e përbashkëta të rrezikut** (`packages/risk`):

- Stop-i vendoset te niveli më i largët nga dy: niveli strukturor (swing / zonë) − 0.5×ATR, ose 1×ATR.
  Asnjëherë nuk shkon më larg se 8% nga hyrja.
- Objektivat: TP1 = 1.5R (mbyll 40%), TP2 = 3R (mbyll 40%), TP3 = 5R (20%). TP1 afrohet para rezistencës/mbështetjes së afërt.
- Pas TP1, stop-i shkon në breakeven. Pas TP2, stop-i shkon në TP1.
- Sinjalet me R:R < 1.5 nuk bëhen kurrë "Setup aktiv".
- Sinjalet kundër trendit të timeframe-it më të lartë nuk bëhen kurrë "Setup aktiv".

| ID | Emri | Regjimet | Logjika |
|---|---|---|---|
| `trend_pullback` | Trend Pullback | Trend rritës / rënës | EMA20 > EMA50 > EMA200 (ose e kundërta). Çmimi tërhiqet në zonën EMA20–EMA50 dhe mbyll në drejtim të trendit, me RSI 40–65 në rritje. |
| `breakout_volume` | Breakout me volum | Trend, Range | Mbyllje mbi/nën range-in 20-bar, me volum ≥ 1.8× mesatares dhe mbyllje në 30% ekstreme të qiririt. Kompresimi i Bollinger para thyerjes e forcon. |
| `mean_reversion` | Mean Reversion | Vetëm Range | Rikthim brenda Bollinger nga jashtë, me RSI < 35 (ose > 65 për short). Divergjenca e forcon. |
| `macd_adx_momentum` | Momentum MACD/ADX | Trend | Kryqëzim i histogramit MACD me ADX > 25, DI në të njëjtin drejtim dhe çmim në anën e duhur të EMA50. |
| `smc_zone_retest` | SMC: OB / FVG | Të gjitha përveç likuiditetit të ulët | Pas një BOS ose CHoCH, merret vetëm prekja e parë e një Order Block ose FVG të pambushur në drejtimin e ri. |
| `rsi_divergence` | Divergjencë RSI | Të gjitha | Divergjencë e rregullt RSI e konfirmuar ≤ 8 bar më parë, dhe mbyllje mbi/nën EMA20. |

## Rezultatet (Binance spot, 4h, 3000 bar ≈ qershor 2025 → tetor 2026)

Parametrat e testit:

- Rrezik 1% për trade, tarifë 0.1% për çdo ekzekutim, slippage 0.05×ATR.
- Filtri i timeframe-it më të lartë aktiv.
- Kur stop-i dhe target-i preken në të njëjtin bar, supozohet se u prek stop-i.

| Strategjia | BTC trade / win / PF | ETH trade / win / PF | SOL trade / win / PF |
|---|---|---|---|
| Trend Pullback | 16 / 44% / **1.14** | 13 / 38% / 0.53 | 20 / 20% / 0.33 |
| Breakout me volum | 17 / 35% / 0.83 | 21 / 52% / **1.36** | 13 / 54% / **1.63** |
| SMC OB/FVG | 5 / 40% / 0.29 | 4 / 25% / 0.12 | 4 / 25% / 0.15 |
| MACD/ADX | 2 / 50% / 2.34 | 0 / — | 3 / 0% / 0.00 |
| Divergjencë RSI | 0 / — | 0 / — | 0 / — |
| Mean Reversion | 0 / — | 1 / 0% / 0.00 | 0 / — |

Pas auditimit të llogaritjeve ([ADR 0010](../decisions/0010-calculation-audit.md)) rregulli "R:R < 1.5 →
vëzhgim" funksionon vërtet: R:R kufizohet nga niveli i parë kundërshtues. Prandaj ka rreth gjysmën e
trade-ve të mëparshme. Setup-et pa hapësirë deri te rezistenca/mbështetja nuk merren më. Numrat me pak
trade (p.sh. MACD/ADX 2 trade) nuk kanë vlerë statistikore.

### Validimi jashtë mostrës (`pnpm validate:oos`)

- **Të dhënat:** 12 coin-at më likuidë, në timeframe 1h, 4h dhe 1d.
- **Metoda:** strategjitë zgjidhen te 60% e parë e historikut (PF ≥ 1.2 dhe ≥ 6 trade). Pastaj maten vetëm te 40% e fundit, që nuk është parë gjatë zgjedhjes.

| Grupi | Trade | Win rate | Profit factor | Pritshmëria |
|---|---|---|---|---|
| Të gjitha strategjitë | 629 | 39.3% | 0.79 | −0.14R |
| Vetëm strategjitë që kaluan gate-in | 146 | 32.9% | 0.66 | −0.24R |

Para auditimit të llogaritjeve: 1178 trade / PF 0.71 dhe 358 trade / PF 0.75. Filtri i ri R:R e përmirëson
pak grupin e plotë. Grupi me gate përkeqësohet, sepse me më pak trade në 60% të parë ndryshon se cilat
strategji kalojnë gate-in. Asnjë nga të dyja nuk ka avantazh.

**Përfundimi i ndershëm:** asnjë nga këto rregulla klasike të analizës teknike nuk tregon avantazh
të qëndrueshëm jashtë mostrës në këtë periudhë. Kjo është arsyeja pse aplikacioni:

1. Tregon statistikat e backtest-it te çdo sinjal, në të njëjtin coin dhe timeframe.
2. E ul sinjalin në "Në vëzhgim" kur strategjia nuk ka qenë fitimprurëse në atë coin (gate: PF ≥ 1.2, ≥ 6 trade).
3. Ndjek automatikisht çdo sinjal aktiv deri në TP ose SL (track record), përfshirë humbjet.

Rezultatet ndryshojnë me çdo ekzekutim, sepse të dhënat janë live. Riprodhojini me:

```bash
pnpm backtest --symbol ETHUSDT --tf 4h --bars 3000
pnpm backtest --symbol BTCUSDT --tf 1h --strategy breakout_volume
pnpm validate:oos
```

Çdo strategji e re duhet të shtojë këtu rezultatet e veta, para se të shfaqet në UI.
