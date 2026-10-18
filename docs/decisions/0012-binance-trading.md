# ADR 0012 — Tregtimi në Binance (Spot + Futures USDⓈ-M)

- **Statusi:** Pranuar
- **Data:** 2026-10-18
- **Ndryshon:** CLAUDE.md §7 ("Aplikacioni nuk ekzekuton urdhra në fazën 1") dhe §13.5 ("Asnjë
  ekzekutim urdhrash tregtimi").

## Konteksti

Pronari i projektit kërkoi që platforma të tregtojë drejtpërdrejt në Binance përmes API-së. Për
çdo pikë të ndjeshme zgjodhi opsionin më të sigurt:

| Pyetja | Zgjedhja |
|---|---|
| Tregjet | Spot + Futures USDⓈ-M |
| Mjedisi | Testnet si parazgjedhje; Live pas një ndërprerësi të qartë |
| Ekzekutimi | Vetëm manual, me konfirmim për çdo urdhër (asnjë auto-trading) |
| Çelësat | Në server, të enkriptuar; urdhrat nënshkruhen në server |

## Vendimi

### 1. Paketa `@cv/exchange/trade` (vetëm server)

- **Nënshkrimi:** HMAC-SHA256 mbi query string-un e saktë që dërgohet, me `recvWindow` 5000 ms.
  Testohet me të dy shembujt zyrtarë të Binance (ASCII dhe Unicode).
- **Ora:** diferenca me serverin e Binance matet dhe ruhet për 10 minuta. Pas `-1021` (timestamp jashtë
  dritares) ora rimatet dhe kërkesa provohet edhe një herë. Kjo është e sigurt, sepse Binance e refuzon
  kërkesën para se ta ekzekutojë.
- **Hostet:** live janë të fiksuar në kod (`api.binance.com`, `fapi.binance.com`). Vetëm testnet-i mund të
  ndryshohet nga `BINANCE_TESTNET_*_URL`. Kështu një variabël mjedisi i gabuar nuk mund t'i dërgojë urdhrat
  me para reale diku tjetër.
- **Filtrat e simbolit**, të gjitha me `decimal.js`:
  - `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`;
  - `MIN_NOTIONAL` dhe `NOTIONAL`;
  - `PERCENT_PRICE` dhe `PERCENT_PRICE_BY_SIDE`.

  Sasia rrumbullakohet gjithmonë poshtë, pra nuk del kurrë më e madhe se ajo që konfirmoi përdoruesi.
  Çmimi limit i blerjes rrumbullakohet poshtë dhe ai i shitjes lart. Urdhrat reduce-only të futures nuk
  i nënshtrohen minimumit të vlerës, njësoj si te Binance.

### 2. Çdo urdhër ka stop-loss (CLAUDE.md §0.3)

- **Spot:** dërgohet një listë e vetme urdhrash.
  - **OPOCO** (`/api/v3/orderList/opoco`): hyrje LIMIT + OCO shitjeje me `LIMIT_MAKER` (take-profit) dhe
    `STOP_LOSS` (stop market). Binance e vendos vetë OCO-në sapo hyrja mbushet plotësisht. Kështu nuk ka
    asnjë moment me pozicion pa stop.
  - Kur simboli nuk lejon OPO, përdoret **OTOCO**. Sasia e OCO-së është sasia e blerë minus komisionin;
    nëse tarifat paguhen me BNB, mbetet një sasi e vogël e pashitur.
  - "Market" në spot është një LIMIT i kufizuar te `ask × (1 + 0.5%)`. Rreziku llogaritet nga ky çmim më
    i keq.
  - Spot lejon vetëm LONG.
- **Futures:** hapat dërgohen me këtë radhë:
  1. lloji i marzhit (`-4046` "no need to change" konsiderohet sukses);
  2. leverage-i;
  3. hyrja (MARKET ose LIMIT);
  4. **stop-i**: `STOP_MARKET`, `closePosition=true`, `workingType=MARK_PRICE`, `priceProtect`;
  5. take-profit-et: `TAKE_PROFIT_MARKET` reduce-only, të ndarë në hapin e sasisë.

  Stop-i dhe take-profit-et dërgohen te Algo Service (`/fapi/v1/algoOrder`, i detyrueshëm nga Binance për
  urdhrat kushtëzues). Nëse endpoint-i mungon (404), përdoret `/fapi/v1/order`.
- **Nëse stop-i refuzohet:** hyrja market mbyllet menjëherë me MARKET reduce-only. Hyrja limit anulohet,
  dhe pjesa që është mbushur tashmë mbyllet. Statusi `reverted`. Nëse as kjo nuk ia del, statusi bëhet
  `unknown` dhe UI-ja i kërkon përdoruesit të kontrollojë Binance-in menjëherë.
- **Përgjigje e humbur** (timeout, 5xx): urdhri nuk ridërgohet kurrë verbërisht. Fillimisht kërkohet me
  `origClientOrderId`. Nëse ekziston, vazhdohet; nëse jo (`-2013`), asgjë nuk është hapur.
- **Mbushje e pjesshme e hyrjes market:** take-profit-et ndahen sipas sasisë që u mbush realisht.

### 3. Kontrollet para dërgimit

Plani (`planBracket`) kontrollon:

- stop-i dhe targetet në anën e duhur të hyrjes dhe të çmimit aktual, që të mos aktivizohen menjëherë;
- bilanci ose marzhi i disponueshëm;
- leverage-i brenda bracket-it të Binance për këtë vlerë pozicioni;
- **likuidimi para stop-it**, me formulën e Binance për një pozicion të vetëm:
  `(WB + cum − s·q·E) / (q·MMR − s·q)`;
- pozicion ekzistues në simbol, i cili refuzohet;
- **rreziku maksimal për urdhër**: humbja te stop-i, me tarifat, nuk e kalon kufirin e serverit
  (parazgjedhja 2%, nga 0.1% deri në 2%).

Serveri e rindërton planin nga e njëjta kërkesë kur dërgohet urdhri, ndaj kontrollet nuk varen nga
browser-i. Kufizimi: për hyrjet market, çmimi mund të ketë lëvizur mes parapamjes dhe dërgimit. Kontrollet
përsëriten mbi çmimin e ri, ndërsa rrumbullakimi i sasisë, stop-it dhe targeteve mbetet i njëjtë.

### 4. Çelësat dhe ndërprerësit

- Tabela `exchange_keys`:
  - një rresht për çdo (përdorues, mjedis, treg);
  - çelësi dhe sekreti ruhen me AES-256-GCM;
  - në browser kthehen vetëm katër karakteret e fundit.
- Çelësi verifikohet te Binance para se të ruhet. Për live:
  - kërkohet fjalëkalimi;
  - `/sapi/v1/account/apiRestrictions` duhet të tregojë **pa tërheqje dhe pa transferta të brendshme**,
    përndryshe çelësi refuzohet;
  - kufizimi i IP-së shfaqet si paralajmërim.
- Tabela `trading_settings`, e zbatuar në server:
  - **Live** është joaktiv derisa përdoruesi ta aktivizojë me fjalëkalim dhe kod 2FA (2FA është i
    detyrueshëm);
  - **kill switch** bllokon çdo urdhër të ri, ndërsa anulimi dhe mbyllja vazhdojnë të funksionojnë;
  - **rreziku maksimal për urdhër**.
- **Ndalimi emergjent** aktivizon kill switch-in dhe anulon të gjithë urdhrat e hapur në mjedis.
  Pozicionet nuk mbyllen automatikisht.
- Operatori i serverit ka `TRADING=on|testnet|off`.
- Tabela `trade_intents` ruan çdo konfirmim sipas `intentId` të klientit, me një indeks unik. Një dërgim
  i përsëritur kthen rezultatin e ruajtur dhe nuk dërgon asgjë. Ruhen të gjitha kërkesat dhe përgjigjet
  e Binance; sekreti dhe nënshkrimi nuk ruhen.
- Audit log: `exchange_key_saved`, `exchange_key_deleted`, `trading_settings_updated`, `order_submitted`,
  `order_cancelled`, `position_closed`, `trading_panic`.

### 5. UI (`/trade`)

- Ndërprerësi Testnet/Live, lidhja e çelësave, siguria, bilancet, pozicionet, urdhrat e hapur (përfshirë
  urdhrat algo) dhe historiku i veprimeve.
- Formulari i urdhrit:
  - madhësia llogaritet nga % e rrezikut mbi bilancin real;
  - mbushet paraprakisht nga `/futures` dhe nga kartat e sinjaleve ("Ekzekuto në Binance").
- **Konfirmimi tregon kërkesat e sakta** që do të dërgohen: sasinë e rrumbullakuar, stop-in, targetet,
  rrezikun me tarifat, likuidimin, gabimet dhe paralajmërimet. Në Live kërkohet edhe një checkbox shtesë.
- Anulimi i një stop-i paralajmëron që pozicioni mbetet pa mbrojtje.

## Testimi

- 31 teste unit për `@cv/exchange/trade`, kundër një Binance të simuluar që verifikon çelësin, nënshkrimin
  dhe dritaren e kohës:
  - nënshkrimi, filtrat dhe ndarja e sasisë;
  - likuidimi;
  - plani spot/futures;
  - rruga e suksesit;
  - `-4046` dhe `-1021`;
  - kthimi pas refuzimit të stop-it, për hyrje market dhe limit;
  - përgjigjet e humbura;
  - rikthimi te `/fapi/v1/order` kur mungon Algo Service;
  - mbushja e pjesshme dhe mbyllja e pozicionit.
- Teste të DB-së për çelësat, cilësimet dhe idempotencën.
- E2E me Playwright kundër simulatorit (`pnpm mock:binance`):
  - lidhja e çelësit, përfshirë sekretin e gabuar;
  - parapamja me numrat e saktë;
  - konfirmimi dhe historiku;
  - kill switch-i;
  - Live i bllokuar pa 2FA.

## Kufizime të njohura

- Nga mjedisi i zhvillimit, `api.binance.com`, `testnet.binance.vision` dhe `fapi.binance.com` kthejnë
  451 (kufizim gjeografik). Formati i kërkesave u verifikua kundër dokumentacionit zyrtar
  (`binance-spot-api-docs`, `binance-connector-js`) dhe një simulatori, jo kundër Binance-it real.
  Prandaj **testnet-i është i detyrueshëm si hap i parë**.
- Take-profit-et reduce-only për një hyrje limit futures që ende s'është mbushur mund të refuzohen nga
  Binance. Në atë rast statusi është `partial` dhe stop-i mbetet në vend.
- Lëvizja e stop-it në breakeven pas TP1 nuk automatizohet, sepse kërkon një proces që punon me çelësat
  në sfond.
- Stop-i `STOP_MARKET` mund të mbushet më keq se çmimi i tij në lëvizje të shpejta.
- Vetëm çelësa HMAC (jo Ed25519/RSA). Hedge mode mbështetet me `positionSide`.

## Pasojat

- CLAUDE.md §7 dhe §13.5 përditësohen: ekzekutimi i urdhrave lejohet vetëm sipas këtij ADR-je.
  Auto-trading dhe tërheqjet mbeten jashtë scope-it.
- `SECURITY.md` përshkruan çelësat e tregtimit dhe kontrollet përkatëse.
