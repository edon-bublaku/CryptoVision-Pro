# Kontributi

Faleminderit që dëshiron të kontribuosh. Rregullat e plota të projektit janë te [`CLAUDE.md`](CLAUDE.md)
(vlejnë njëlloj për njerëzit dhe për agjentët). Shkurt:

1. `pnpm install && pnpm dev`: platforma nis pa shërbime të jashtme.
2. Para një PR-je duhet të kalojnë: `pnpm typecheck`, `pnpm lint`, `pnpm test` dhe `pnpm test:e2e`.
3. Logjika financiare shkon te paketat e pastra (`packages/*`), me teste dhe me `decimal.js`.
4. Asnjë tekst i UI pa i18n (shqip + anglisht te `apps/web/lib/i18n.ts`).
5. Faqet e reja shtohen te `apps/web/components/layout/nav.ts` dhe te `PAGES` në `e2e/quality.spec.ts`.
6. Ndryshimet në strategji/faktorë kërkojnë `pnpm validate:oos`; ndryshimet në CV Rating ose rekomandues
   kërkojnë `pnpm validate:rating`. Numrat përditësohen në dokumentim edhe kur përkeqësohen.
7. Ndryshimet e kontratave (skema e DB-së, `Signal`, `Drawing`, `Rating` …) kërkojnë ADR te `docs/decisions/`.
8. Mesazhet e commit-eve në anglisht, në formatin [Conventional Commits](https://www.conventionalcommits.org).

Mos shto të dhëna të rreme (çmime, win-rate, statistika) në UI dhe mos përdor gjuhë si "fitim i garantuar".
