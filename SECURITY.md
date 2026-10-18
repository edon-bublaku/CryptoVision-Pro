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
- Sekretet TOTP të 2FA-së dhe çelësat API të Binance kriptohen me AES-256-GCM; çelësi gjenerohet në `$CV_HOME/secret.key` ose merret nga `ENCRYPTION_KEY`.
- Audit log për veprimet e ndjeshme (2FA, fjalëkalim, fshirje llogarie, çelësa exchange, urdhra, kill switch).

## Tregtimi në Binance ([ADR 0012](docs/decisions/0012-binance-trading.md))

- Çelësat API verifikohen te Binance, ruhen të enkriptuar dhe nuk kthehen kurrë në browser. Urdhrat nënshkruhen vetëm në server.
- Çelësat live refuzohen nëse lejojnë tërheqje ose transferta të brendshme; kërkohet fjalëkalimi për t'i ruajtur. Rekomandohet kufizimi i IP-së te Binance.
- Live është joaktiv derisa përdoruesi ta aktivizojë me fjalëkalim dhe kod 2FA. Operatori mund ta çaktivizojë me `TRADING=testnet|off`.
- Hostet live janë të fiksuar në kod; vetëm testnet-i mund të drejtohet diku tjetër.
- Çdo urdhër ka stop-loss, konfirmim manual, kufi rreziku në server dhe kill switch. Një konfirmim i përsëritur nuk dërgon urdhra dy herë.
