# Siguria

## Raportimi i një dobësie

Mos hap issue publik për dobësi sigurie. Përdor **Security → Report a vulnerability** te ky repo
(GitHub Private Vulnerability Reporting). Përfshi:

- përshkrimin dhe ndikimin e mundshëm;
- hapat për ta riprodhuar;
- versionin ose commit-in.

## Çfarë mbron aplikacioni

- Fjalëkalime me scrypt, sesione të revokueshme në DB, 2FA TOTP me kode rezervë ([ADR 0003](docs/decisions/0003-custom-auth.md)).
- Cookie `httpOnly`, `sameSite=lax`, `secure` në prodhim; kontroll i origjinës për çdo shkrim.
- Validim me Zod në çdo hyrje API, CSP dhe header-a sigurie, rate limit për login/regjistrim dhe API.
- Sekretet TOTP të 2FA-së kriptohen me AES-256-GCM; çelësi gjenerohet në `$CV_HOME/secret.key` ose merret nga `ENCRYPTION_KEY`.
- Audit log për veprimet e ndjeshme (2FA, fjalëkalim, fshirje llogarie).
- Aplikacioni **nuk ekzekuton urdhra tregtimi** dhe nuk kërkon API keys me leje trade/withdraw.
