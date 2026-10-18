# ADR 0001 — Arkitekturë "client-side first" për versionin e parë

- **Statusi:** Pranuar
- **Data:** 2026-10-17

## Konteksti

CLAUDE.md përshkruan stack-un e plotë të prodhimit: PostgreSQL/TimescaleDB, Redis, BullMQ, Auth.js dhe tRPC.
Për versionin e parë, të gjitha të dhënat që aplikacioni përdor janë publike:

- Binance REST dhe WebSocket (`data-api.binance.vision` / `data-stream.binance.vision`), të dyja me CORS.
- alternative.me (Fear & Greed).
- CoinGecko global.

Gjendja e përdoruesit (vizatime, portofol, alerte, cilësime) i përket një personi të vetëm.

## Vendimi

- Aplikacioni Next.js 16 punon tërësisht në browser. Llogaritjet e rënda (skanimi i tregut dhe
  backtest-i) bëhen në **Web Workers**, jo në një server me BullMQ.
- Persistenca bëhet me **Zustand + localStorage**, me `version` në çdo store për migrime. Eksport/import JSON bëhet nga Cilësimet.
- Paketat e analizës (`core`, `indicators`, `risk`, `signals`, `backtest`) janë **pure TypeScript**, pa I/O.
  Kështu mund të zhvendosen pa ndryshime në `apps/worker` kur të shtohet backend-i.
- Aplikacioni mund të eksportohet si faqe statike (`STATIC_EXPORT=1 pnpm build`) dhe të hostohet kudo. *(Nuk vlen më që nga [ADR 0004](0004-worker-hybrid-mode.md): aplikacioni ka route API dhe nis me `pnpm start`.)*

## Pasojat

**Fitime:**

- Pa infrastrukturë dhe pa kosto.
- Pa API keys.
- Privatësi: asgjë nuk largohet nga pajisja, përveç thirrjeve publike për të dhëna tregu dhe Telegram-it opsional.

**Kufizime:**

- Alertet funksionojnë vetëm kur aplikacioni është i hapur.
- Nuk ka sinkronizim mes pajisjeve.
- Nuk ka derivate (funding/OI), sepse endpoint-et e futures janë të bllokuara në disa rajone.

**Rruga e migrimit (F8+):**

1. `apps/worker` (BullMQ) thërret të njëjtat paketa.
2. Store-t lokale zëvendësohen me tRPC + Drizzle, me të njëjtat skema.
3. Auth.js shtohet për sinkronizimin mes pajisjeve.
4. Alertet kalojnë në server: Telegram, email dhe Web Push me service worker.
