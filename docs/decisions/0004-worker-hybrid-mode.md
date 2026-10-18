# ADR 0004 — Worker në server dhe mënyra hibride lokal/server

- **Statusi:** Pranuar
- **Data:** 2026-10-17
- **Zëvendëson pjesërisht:** [ADR 0001](0001-client-side-first.md)
- **Përditësuar nga:** [ADR 0005](0005-self-contained-platform.md) (worker-i nis brenda serverit dhe Redis është opsional)

## Konteksti

Versioni i parë punonte tërësisht në browser. Kjo mjafton për analizë, por alertet humbasin kur skeda
mbyllet dhe të dhënat nuk ndjekin përdoruesin në pajisje të tjera. Nuk duam që aplikacioni të varet nga
serveri: shumë përdorues duan ta hapin pa llogari.

## Vendimi

1. **Motori është i përbashkët.** `packages/engine` (analiza + gate-i i ADR 0002) dhe `packages/exchange`
   punojnë njësoj në browser dhe në Node. Worker-i nuk ka logjikë të vetën sinjalesh.
2. **Worker-i** (`apps/worker`, BullMQ mbi Redis) ekzekuton job-e të përsëritura: skanim për çdo timeframe,
   ndjekje TP/SL e sinjaleve aktive, alerte RSI dhe "sinjal i ri". Alertet e çmimit dhe të vizatimeve
   vlerësohen live nga një WebSocket i vetëm. Pa Redis, job-et ekzekutohen në proces me `setInterval`.
3. **Mënyra hibride:**
   - Pa `DATABASE_URL` → vetëm lokal, si më parë.
   - Me llogari → `SyncManager` pasqyron store-t lokale në server. Vizatimet: fiton bashkësia më e re
     për simbol. Pozicionet dhe alertet: bashkim sipas `id`. Cilësimet: fiton serveri. Dokumentet e
     gjendjes kanë version optimist (409 → merret kopja e serverit).
   - Kur worker-i është gjallë (heartbeat në Redis), browser-i ndalon vlerësimin lokal të alerteve që të
     mos ketë njoftime të dyfishta; njoftimet vijnë me SSE (`/api/events`).
4. **Nuk sinkronizohet** layout-i i grafikut (`chartUi`): është specifik për pajisjen dhe do të mbishkruante
   deep link-et (`/chart?symbol=…`).
5. Skanimi i serverit preferohet në faqen e sinjaleve vetëm kur është më i ri se skanimi lokal.

## Pasojat

- Aplikacioni mbetet plotësisht funksional pa server; serveri shton vetëm vazhdimësi dhe njoftime.
- Konflikt i mundshëm: dy pajisje që ndryshojnë njëkohësisht vizatimet e të njëjtit simbol → fiton
  bashkësia me `updatedAt` më të ri (pa bashkim për vizatim të veçantë). E pranueshme për tani.
- Worker-i dhe web-i ndajnë skemën e DB-së; migrimet i zbaton worker-i në nisje dhe `pnpm db:migrate`.
