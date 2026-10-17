# ADR 0003 — Auth e vetë-implementuar në vend të Auth.js

- **Statusi:** Pranuar
- **Data:** 2026-10-17

## Konteksti

CLAUDE.md §1 propozonte Auth.js (NextAuth v5) me magic link, Google dhe 2FA. Në këtë fazë na duhen:
email + fjalëkalim, 2FA TOTP me kode rezervë, menaxhim sesionesh (shiko/revoko pajisjet), bllokim pas
tentativave të dështuara dhe audit log. Auth.js nuk ofron 2FA dhe as listë sesionesh të revokueshme
pa shtresë shtesë, ndërsa provider-at OAuth kërkojnë konfigurim të jashtëm që nuk e kemi.

## Vendimi

- Fjalëkalimet: `scrypt` (N=2^15) me salt 16 bajt, krahasim `timingSafeEqual` (`packages/server/src/crypto.ts`).
- Sesionet: token opak 32 bajt në cookie httpOnly `cv_session` (`__Host-cv_session` në prodhim, `Secure`,
  `SameSite=Lax`). Në DB ruhet vetëm SHA-256 i token-it, ndaj një dump i DB-së nuk jep sesione të vlefshme.
- 2FA: TOTP sipas RFC 6238 (testuar me vektorët e RFC-së), sekreti i enkriptuar me AES-256-GCM
  (`ENCRYPTION_KEY`), 10 kode rezervë të hash-uara dhe njëpërdorimshe.
- Bllokim 15 min pas 5 dështimesh; rate limit me Redis (sliding window) për IP në regjistrim/hyrje.
- Kontroll `Origin` për çdo kërkesë që ndryshon gjendje (CSRF), validim Zod për çdo body.
- Audit log për hyrje, 2FA, ndryshim fjalëkalimi, revokim sesionesh dhe fshirje llogarie.

## Pasojat

- Kodi i auth-it është i yni për t'u mirëmbajtur; është i vogël (~400 rreshta) dhe i mbuluar nga teste
  njësie (TOTP, kriptim) dhe Playwright (regjistrim → 2FA → hyrje → revokim).
- Magic link / OAuth mund të shtohen më vonë mbi të njëjtën tabelë `sessions` pa ndryshuar kontratat.
