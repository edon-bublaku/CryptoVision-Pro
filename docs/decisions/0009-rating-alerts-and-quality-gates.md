# ADR 0009 — Alertet e CV Rating dhe portat e cilësisë (ESLint, axe, responsive)

- **Statusi:** Pranuar
- **Data:** 2026-10-18

## Konteksti

1. Përdoruesit e CV Rating duan të dinë kur një coin kalon në "Akumulo" ose bie nën "Mbaj", pa e
   hapur faqen çdo ditë. Alertet ekzistuese mbulonin vetëm çmimin, RSI-në, sinjalet dhe vizatimet.
2. Platforma u rrit me faqe të reja (`/compare`, `/tools`) dhe me navigim të ri për mobile. Para kësaj
   nuk kishte ESLint, as kontroll automatik aksesueshmërie apo madhësish ekrani.

## Vendimi

### Alertet e vlerësimit

- **Dy lloje të reja:** `rating_above` dhe `rating_below`, me prag 0–100. Kolona `alerts.type` është
  `text` dhe enum-i ekziston vetëm në TypeScript, prandaj nuk duhet migrim SQL. `pnpm db:generate`
  e konfirmon: "No schema changes".
- **Shkaktohen nga kalimi i pragut, jo nga gjendja.** Alerti njofton kur skori hyn në zonë dhe
  riaktivizohet vetëm pasi del prej saj (`lastSide`). Vlerësimi ditor ndryshon ngadalë, ndaj një
  alert sipas gjendjes do të përsëritej në çdo kontroll. Një alert i krijuar kur coin-i është
  tashmë në zonë njofton menjëherë një herë.
- **Të njëjtat pesha si në UI.** Browser-i përdor peshat aktive të përdoruesit. Worker-i i lexon
  nga dokumenti `settings` i sinkronizuar (`ratingPreset` / `ratingWeights`) përmes `resolveWeights()`.
  Një dokument i dëmtuar kalon te peshat e balancuara dhe nuk e çaktivizon alertin.
- Logjika është e pastër te `@cv/rating` (`checkRatingAlert`, `resolveWeights`) dhe ka teste.
  Browser-i kontrollon çdo 15 minuta, po ashtu edhe worker-i (job-i `rating`).

### Portat e cilësisë

- **`pnpm lint`:** ESLint 10 flat config për gjithë monorepo-n. Përfshin rregullat e hooks, Next.js,
  ndalimin e `any`, ndalimin e `console` jashtë CLI/testeve dhe importet e tipeve. Ekzekutohet në CI.
- **`e2e/quality.spec.ts`:** 17 faqet kryesore kontrollohen për:
  - mungesë tejkalimi horizontal dhe gabimesh të pakapura, në 375, 768 dhe 1440 px;
  - shkelje *serious*/*critical* të WCAG 2.1 AA me axe-core, në temën e errët dhe të çelët.
- Ngjyrat e tekstit mbi sfondet e plota bull/bear janë tokena (`--on-bull`, `--on-bear`) për çdo
  paletë, me kontrast ≥ 4.5:1.

## Pasojat

- Pragjet e vlerësimit, peshat dhe kurbat mbeten të pandryshuara, ndaj `pnpm validate:rating` nuk
  ndryshon rezultatet.
- Një shkelje e re aksesueshmërie ose një faqe që del jashtë ekranit në mobile e ndal CI-në.
