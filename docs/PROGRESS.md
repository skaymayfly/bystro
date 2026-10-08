# Bystro — deník vývoje

Nejnovější záznam nahoře. Claude Code přidá záznam po každém dokončeném kroku z `docs/PLAN.md`.

## Šablona záznamu

```
## YYYY-MM-DD — krok X.Y Název
- Hotovo: …
- Rozhodnutí: … (odkaz na ADR, pokud vzniklo)
- Otevřené body: …
- Další krok: X.Z
```

---

## Otevřené body

- **Rozpor zadání × CLAUDE.md (tech stack):** kapitola 22 zadání uvádí backend NestJS/Fastify, pgvector, S3 storage, OpenTelemetry a Secret Manager/KMS. CLAUDE.md určuje Next.js route handlers, Drizzle, pino + Sentry a `ENCRYPTION_KEY` v proměnných prostředí. Platí CLAUDE.md; případná změna jen přes ADR.
- **TypeScript připnutý na 6.0.x:** `typescript-eslint` 8.71 podporuje jen `<6.1.0`. Na TypeScript 7 přejít, až ho podpoří.
- **ESLint pro Next.js:** `eslint-config-next` táhne pluginy bez podpory ESLint 10, proto je použit přímo `@next/eslint-plugin-next` + `eslint-plugin-react-hooks`. Pravidla pro přístupnost (jsx-a11y) zatím chybí; doplnit, až budou kompatibilní.
- **Fáze 0:** chybí GitHub remote (potřeba nejpozději v kroku 1.7 kvůli CI) a účty Fakturoid, Fio, Sentry, Resend, Anthropic, hosting.
- **Klíče pro ostrý provoz:** vývojové klíče Resend a Google byly sdílené v chatu; před nasazením vygenerovat nové. Pro ostrý provoz také ověřit vlastní doménu v Resendu (teď se posílá ze zkušební adresy jen na e-mail majitele účtu) a v Googlu přepnout aplikaci z režimu Testing a doplnit produkční redirect URI.
- **Ověření e-mailu při registraci je vypnuté** (plán ho nepožaduje): dá se registrovat na cizí adresu a registrace prozradí, že účet s e-mailem už existuje. Rozhodnout před betou (fáze 7).
- **Omezení počtu pokusů o přihlášení:** Better Auth ho má zapnuté jen v produkci a drží ho v paměti procesu; při více instancích nestačí. Vyřešit v kroku 7.3.
- **Přepínání mezi organizacemi:** aktivní je první organizace, ve které je uživatel členem. Až bude potřeba víc firem na účet, doplnit výběr.
- **Kontrola členství u nových API:** `getRequestContext()` vrací jen organizaci, ve které je uživatel členem. Každý nový route handler ji musí použít; automatické testy izolace endpointů jsou až v kroku 7.3.
- **Stahování Chromia pro Playwright** na vývojovém počítači vyprší (CDN je dostupná, stahovač Playwrightu ne). Lokálně se používá nainstalovaný Chrome přes `E2E_BROWSER_CHANNEL=chrome`; v CI (krok 1.7) ověřit běžnou instalaci.
- **Agentní soubory generované nástroji:** `next dev` vytváří a obnovuje `apps/web/AGENTS.md` a `apps/web/CLAUDE.md` (jsou v repozitáři od kroku 1.4). Závazné instrukce jsou jen v kořenovém `CLAUDE.md`.
- **Rámec pro integrace zatím nemá žádné HTTP cesty ani obrazovku:** zahájení OAuth, návrat od poskytovatele a obrazovka Propojení vzniknou v krocích 2.4 a 2.6. Návratová cesta musí ověřit přihlášeného uživatele a organizaci, najít požadavek přes `findOAuthRequest`, zavolat `verifyCallback`, pak `consumeOAuthRequest` a teprve potom vyměnit kód.
- **Úklid tabulky `oauth_requests`:** vypršelé a použité požadavky se nemažou. Přidat plánovanou úlohu v kroku 2.2 (má na to index podle `expires_at`).
- **Jedno připojení na poskytovatele a organizaci** (unikátní klíč). Dva účty u téhož poskytovatele v jedné firmě zatím nejdou.
- **`last_error_code`** je krátký strojový kód, který volí náš kód (např. `http_401`, `rate_limited`); texty chyb od poskytovatele se neukládají. Seznam kódů sjednotit s prvním adaptérem v kroku 2.4.
- **Rotace `ENCRYPTION_KEY`** stále nemá postup; od tohoto kroku se jím skutečně šifrují tokeny a PKCE ověřovače.
- **Worker bude od kroku 2.2 potřebovat** `DATABASE_URL`, `REDIS_URL` a `ENCRYPTION_KEY` (na Railway i lokálně) a v `apps/worker/package.json` závislosti `pg` a `drizzle-orm`.
- **Bezpečnostní hlavičky chybí** (vynucení HTTPS, zákaz vkládání do rámce, CSP) a odpověď obsahuje `x-powered-by: Next.js`. Zjištěno při kontrole nasazené adresy; řešit v kroku 7.3.
- **Testovací prostředí běží s klíči Resend a Google, které byly sdílené v chatu.** Před betou (fáze 7) vyměnit a zadat přímo do Railway.
- **Návod pro Railway** je ověřený jedním skutečným nasazením; názvy položek v administraci zůstávají orientační a cestu ke konfiguračnímu souboru služby (`railway.json`) jsme nezkoušeli.
- **Závislosti workeru:** do obrazu jdou jen závislosti z `apps/worker/package.json`. Knihovnu, kterou používá přibalený balíček `@bystro/*` (např. `pino`, později `pg`, `drizzle-orm`, `bullmq`), je potřeba uvést i tam; chybějící závislost odhalí úloha `images` v CI, protože worker nenastartuje.
- **Zdrojové mapy pro Sentry** se nahrají jen při sestavení se `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` a `SENTRY_PROJECT`; neověřeno se skutečným tokenem.
- **Návrat k předchozí verzi nevrací migrace.** Pravidlo pro migrace: zpětně kompatibilní změny schématu, mazání sloupců až v následující verzi.
- **Velikost obrazů:** web 407 MB, worker 465 MB (většinu workeru tvoří `@sentry/node`). Zatím neřešeno.
- **Sentry je ověřené jen z workeru:** testovací chyba z workeru do Sentry dorazila. Z webu (server i prohlížeč) zatím žádná skutečná chyba odeslaná nebyla; ověřit po nasazení.
- **Chyby požadavků vypisuje Next.js sám** na standardní chybový výstup mimo náš logger, tedy bez redakce. Chybové zprávy proto nesmí obsahovat citlivé hodnoty (naše chybové třídy to dodržují); při nasazení zvážit, kam tento výstup teče.
- **Redakce podle obsahu textu je záchranná síť:** chytá e-maily, IBANy, česká čísla účtů, bearer tokeny a částky s měnou. Částku bez měny nebo neobvyklý formát nepozná.
- **Audit přihlášení a registrace** zůstává otevřený: logy je teď zachytí (bez e-mailu), do `audit_logs` se nezapisují.
- **Limity ARES nejsou ověřené:** stránka ARES pro vývojáře se načítá skriptem a nešla přečíst; OpenAPI specifikace limity neuvádí. Posíláme jeden dotaz na jedno kliknutí přihlášeného uživatele, bez opakování, s limitem 5 s. Před betou ověřit podmínky použití a případně přidat omezení počtu dotazů na uživatele (krok 7.3).
- **Jedna firma na účet:** `createFirstOrganization` druhou firmu odmítne (`409`). Víc firem na účet a přepínání mezi nimi v plánu není.
- **Úprava údajů firmy po založení** zatím nejde (Nastavení je neaktivní); adresa zůstává nepovinná.
- **Zaniklé firmy:** ARES vrací i subjekty s datem zániku; onboarding na to neupozorňuje.
- **Kroky 2 a 3 onboardingu** jen zobrazují obsah z prototypu jako „Připravujeme“. Krok 2 ožije v krocích 2.6 a 3.3, krok 3 v kroku 6.6 a celý onboarding v kroku 7.2. Hláška „Hotovo. První ranní přehled dorazí zítra v 7:00.“ z prototypu se nezobrazuje, protože přehled ještě neexistuje.
- **Ochrana proti CSRF** je zatím jen kontrola hlavičky `Origin` u `POST /api/organizations` (`isSameOrigin`); každý další měnící endpoint ji musí použít taky. Plné řešení je krok 7.3.
- **Rozpor prototyp × plán — „Nahrát PDF faktury“:** prototyp má v prázdném stavu Faktur tlačítko pro nahrání PDF, žádný krok plánu ho neobsahuje. V aplikaci není; rozhodnout, jestli funkci doplnit do plánu.
- **Rozpor prototyp × plán — e-mail, kalendář a CRM:** prototyp je ukazuje na Přehledu a v Nastavení, podle plánu přijdou až ve fázi 8 a po spuštění. Zobrazují se neaktivní se štítkem „Připravujeme“.
- **Prvky „Připravujeme“:** tlačítka pro připojení, pole asistenta, přepínače období a volby v Nastavení jsou vypnuté. Zprovoznit je v krocích 2.6 (fakturace), 3.3 (banka), 4.5–4.6 (Hlídač peněz), 6.4 (asistent) a 6.6 (ranní přehled).
- **Úvodní věta Přehledu** je zatím pevný text pro stav bez propojení a bez oslovení jménem (prototyp oslovuje 5. pádem, který z jména spolehlivě neodvodíme). Skutečný ranní přehled je krok 6.6.
- **Mobilní zobrazení** není v prototypu; navržené je v ADR 0001 (horní lišta + spodní navigace). Ověřit s uživateli v betě.
- **Detail faktury** z prototypu zatím neexistuje (nemá prázdný stav); vznikne v kroku 2.7.
- **Izolace tenantů je na úrovni kódu, ne databáze:** firemní tabulky nejsou exportované z `@bystro/db` a aplikace mají ESLintem zakázaný `drizzle-orm`, `pg`, `.execute()` a `$client`. Lint jde vědomě obejít (`eslint-disable`), proto v kroku 7.3 zvážit Row Level Security jako druhou vrstvu.
- **Pozvánky dalších členů do organizace** nejsou v plánu rozepsané; role `admin` a `member` zatím nemá jak vzniknout přes UI.
- **Mazání uživatele a organizace:** cizí klíče z `memberships` a `audit_logs` nemažou kaskádově, takže smazání uživatele s členstvím selže. Vyřešit v kroku 7.4 (GDPR).
- **Rotace `ENCRYPTION_KEY`:** formát šifry má prefix verze (`v1`), ale postup rotace klíče zatím neexistuje. Vyřešit před ostrým provozem (nejpozději fáze 7).
- **Soubory `.DS_Store`** v kořeni a v `docs/` zůstávají na disku, jen jsou v `.gitignore`.

---

## Záznamy

## 2026-10-05 — krok 2.1 Rámec pro integrace

- Hotovo: migrace `0001_integration_framework` (tabulky `integration_connections`, `integration_credentials`, `sync_cursors`, `webhook_events`, `oauth_requests`); stavový automat integrace a třída `Secret` v `packages/core`; obecný OAuth postup v `packages/integrations/oauth` (`createAuthorizationRequest`, `verifyCallback`, `exchangeAuthorizationCode`, `refreshAccessToken`); datová vrstva v `packages/db/src/integrations.ts`.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Tabulka `oauth_requests` navíc proti plánu (schváleno uživatelem): rozdělané autorizace se drží na serveru, ukládá se jen SHA-256 otisk hodnoty `state` a zašifrovaný PKCE ověřovač; požadavek jde spotřebovat právě jednou (atomická aktualizace).
  - Tokeny a tajné hodnoty se v paměti předávají jen jako `Secret`: při převodu na JSON, do textu i při výpisu dávají `[redacted]`, hodnotu vrací jen výslovné `reveal()`.
  - Tokeny jsou v samostatné tabulce `integration_credentials`, šifrované AES-256-GCM (`crypto.ts` z kroku 1.2); při odpojení se mažou ve stejné transakci, ve které připojení přejde do `revoked`.
  - Stavový automat: `reauth_required` a `revoked` vrací zpět jen nová autorizace (`reconnected`); výsledek synchronizace se přijímá jen ve stavu `syncing`; souběžné události se řadí zámkem řádku, takže ze souběžných startů synchronizace projde jeden.
  - OAuth: návratová adresa se porovnává na přesnou shodu se seznamem; `state` se ověřuje dřív než chyba od poskytovatele; z chybové odpovědi poskytovatele se přebírá jen standardní kód `error`, nikdy popis.
  - Obnova tokenu rozlišuje „autorizace je pryč“ (`reauthorization_required`) od dočasné chyby (`token_exchange_failed`), aby výpadek poskytovatele nezahodil připojení.
  - Webhook události mají unikátní klíč `(organization_id, source, external_id)`; opakované doručení vrací `false`.
- Otevřené body: HTTP cesty a obrazovka (2.4, 2.6), úklid `oauth_requests`, jedno připojení na poskytovatele, kódy chyb, rotace klíče, proměnné workeru (viz sekce výše).
- Další krok: 2.2 Worker a fronta úloh

## 2026-10-05 — změna plánu: iDoklad ve fázi 2

- Rozhodnutí uživatele: kromě Fakturoidu chce ve fázi 2 i iDoklad (původně v sekci „Po spuštění“).
- Do `PLAN.md` přidán krok 2.8 Adapter iDoklad, zařazený až za dokončený Fakturoid (kroky 2.4–2.7). Důvod pořadí: druhý adaptér se ladí na už hotové cestě od připojení po obrazovku Faktury a společné rozhraní `InvoiceProvider` se prověří dvěma různými systémy.
- Odhad fáze 2 prodloužen o týden (4–6). Další fáze se v přehledu neposouvaly; přepočítat při nejbližší revizi plánu.
- Zadání (kapitola 22) s iDokladem po Fakturoidu počítá, takže nejde o rozpor se zadáním.

## 2026-10-05 — krok 1.8 Nasazení na testovací prostředí

- Hotovo: `apps/web/Dockerfile` a `apps/worker/Dockerfile` (vícestupňové, běh pod uživatelem `node`); `GET /api/health` (databáze + Redis, veřejný, vrací jen stav); migrace spustitelné z obrazu (`node migrate.cjs`, jeden přibalený soubor + SQL soubory); `railway.json` pro obě služby; `docs/deploy.md`; úloha `images` v CI.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Hosting Railway (zvolil uživatel): web, worker, Postgres a Redis v jednom projektu. Vercel odpadl kvůli zákazu komerčního použití na plánu zdarma a chybějící podpoře trvale běžícího workeru.
  - Web běží jako samostatný server Next.js (`output: "standalone"`), zapnutý jen při sestavení obrazu (`NEXT_OUTPUT_STANDALONE=1`), protože `next start` v E2E s ním nefunguje.
  - Migrace běží jako příkaz před nasazením ze stejného obrazu jako web; skript je přibalený do jednoho souboru (`tsup`, CommonJS) a SQL soubory hledá přes `MIGRATIONS_DIR`.
  - Worker se do obrazu skládá přes `pnpm deploy --prod`.
  - Redis klient ve webu je `ioredis` (stejný, jaký používá BullMQ) s `family: 0` kvůli sítím jen s IPv6.
  - Worker se na SIGTERM ukončuje výslovně (`process.exit(0)`); bez toho ho platforma po čekací době zabíjela.
- Oprava z kroku 1.7: Sentry posílal řádky zdrojového kódu kolem místa chyby bez redakce. `scrubSentryEvent` teď čistí i zdrojové řádky a lokální proměnné rámců.
- Ověřeno lokálně: oba obrazy sestaveny; web z obrazu zmigroval prázdnou databázi, odpověděl na `/api/health` 200, při nedostupné databázi a Redisu 503 bez úniku údajů; worker nastartoval a na SIGTERM skončil s kódem 0.
- Nasazeno uživatelem na Railway: https://bystro-production.up.railway.app. Zvenku ověřeno: `/api/health` vrací 200 (databáze i Redis `ok`), `/app` a `/onboarding` bez přihlášení přesměrují, API bez přihlášení vrací 401. Uživatel ručně prošel přihlášení přes Google a onboarding se založením firmy až na Přehled.
- Zjištěno při nasazení a opraveno v `docs/deploy.md`:
  - Railway přidělí aplikaci vlastní port, pokud není nastavená proměnná `PORT`; doména mířící na 3000 pak vrací 502, přestože health check prochází. Návod teď vyžaduje `PORT=3000`.
  - Nový OAuth klient v Googlu potřebuje návratovou adresu nové domény přesně v poli Authorized redirect URIs (`redirect_uri_mismatch`).
- Otevřené body: bezpečnostní hlavičky, klíče sdílené v chatu, závislosti workeru, zdrojové mapy, migrace při návratu verze (viz sekce výše).
- Další krok: 2.1 Rámec pro integrace (fáze 2 — Faktury z Fakturoidu)

## 2026-10-05 — krok 1.7 Logování, Sentry a CI

- Hotovo: nový balíček `packages/observability` (`createLogger` nad pino 10 s redakcí, `scrubSentryEvent`); sdílená redakce v `packages/core` (`redactDeep`, `redactText`), kterou používá i audit; logger ve webu a workeru, logy Better Auth vedené přes něj; Sentry ve webu (`@sentry/nextjs` 11: server, prohlížeč, `global-error`) a ve workeru (`@sentry/node` 11), zapne se jen s DSN; lint zakazuje `console` mimo skripty; GitHub Actions `.github/workflows/ci.yml`.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Nový balíček `observability` (schváleno uživatelem); `core` zůstává bez I/O a drží jen čistou logiku redakce.
  - Redakce ve dvou vrstvách: podle názvu pole v libovolné hloubce (tokeny, hesla, cookies, e-maily, IBAN, čísla účtů, v logách navíc částky) a podle obsahu každého textu.
  - Redakce běží v pino hooku před serializací; vazby potomků loggeru (`child`) se redigují při vytvoření, protože je pino jinak zapíše beze změny.
  - Sentry: jen chyby (žádný tracing ani záznam relací), `sendDefaultPii: false`, z požadavku zůstává metoda a cesta bez query stringu, z uživatele jen ID.
  - CI používá jednorázové hodnoty pro testovací databázi; žádné skutečné tajné hodnoty nepotřebuje.
  - Worker ve vývoji čte kořenový `.env` přes `--env-file-if-exists`.
- První běh CI na GitHubu selhal; chyby jsem dohledal spuštěním stejných kroků v čistém linuxovém kontejneru a opravil:
  - Souběžné migrace: testy `db` a `web` migrovaly prázdnou testovací databázi zároveň. `runMigrations` teď drží databázový advisory lock a založení testovací databáze snese souběh.
  - `next build` vyžadoval `DATABASE_URL`: kontext požadavku sahal na databázi dřív, než přečetl hlavičky. Teď čte hlavičky první, takže build tajné hodnoty nepotřebuje.
  - E2E narážely na omezení počtu registrací: testovací uživatelé se teď zakládají přímo na serveru (`createSignedInUser`), přes formulář jde jen test registrace a přihlášení.
  - Přidán `.gitattributes` (konce řádků LF na všech platformách).
- Průvodce Sentry (`@sentry/wizard`) spuštěný uživatelem v kořeni repozitáře vytvořil druhou, nevyhovující konfiguraci (100% tracing, sběr uživatelských dat). Soubory jsou přesunuté do zálohy mimo repozitář, DSN je převzaté do `.env`.
- Otevřené body: ověření Sentry se skutečným účtem, zdrojové mapy, výstup chyb Next.js, meze redakce textu, balení workeru, audit přihlášení (viz sekce výše).
- Další krok: 1.8 Nasazení na testovací prostředí

## 2026-10-05 — krok 1.6 Onboarding krok 1: firma podle IČO

- Hotovo: validace IČO kontrolním součtem a schéma vstupu firmy v `packages/core`; adaptér ARES v `packages/integrations/ares` (`lookupCompanyInAres`); `createFirstOrganization` v `packages/db`; stránka `/onboarding` (krok 1 funkční, kroky 2 a 3 „Teď přeskočit“); `GET /api/companies/lookup` a `POST /api/organizations`; uživatel bez firmy je z `/app` přesměrován na onboarding.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - ARES: veřejné REST API verze 1.4, operace `GET /ekonomicke-subjekty/{ico}`, ověřeno podle OpenAPI specifikace a jedním živým dotazem. Adaptér nikdy nevyhazuje chybu kvůli ARES: vrací `found` / `not_found` / `unavailable` a UI nabídne ruční vyplnění.
  - Plátcovství DPH se předvyplňuje podle `seznamRegistraci.stavZdrojeDph === "AKTIVNI"`; uživatel ho může změnit.
  - Odpověď ARES se bere jako nedůvěryhodný text; odpověď s jiným IČO, než bylo dotázáno, se zahodí.
  - Fixtures jsou nahrané skutečné odpovědi ARES (jen právnické osoby, žádné fyzické osoby).
  - Založení firmy je idempotentní: transakční zámek na uživatele (`pg_advisory_xact_lock`) + kontrola existujícího členství.
  - E2E běží proti místnímu serveru s nahranými odpověďmi (`apps/web/e2e/ares-stub.mjs`), na který testovací web míří přes `ARES_BASE_URL`. V běžící aplikaci žádný mock není.
  - Tlačítko „Zpět“ v kroku 1 je nahrazené odhlášením.
- Otevřené body: limity ARES, jedna firma na účet, úprava údajů firmy, zaniklé firmy, kroky 2 a 3, CSRF (viz sekce výše).
- Další krok: 1.7 Logování, Sentry a CI

## 2026-10-05 — krok 1.5 Vzhled a navigace podle prototypu

- Hotovo: design tokeny v `apps/web/src/app/globals.css` a písmo Onest; shadcn/ui (styl `base-nova`) s tlačítkem, polem a popiskem upravenými na tokeny; layout aplikace s postranním menu (Přehled, Asistent, Hlídač peněz, Faktury, Nastavení) a mobilní navigací; obrazovky `/app`, `/app/asistent`, `/app/hlidac-penez`, `/app/faktury`, `/app/nastaveni` jako prázdné stavy s texty z prototypu; přihlašovací stránky převedené na tokeny; `formatCzk`, `formatDate`, `formatWeekday` v `packages/core`.
- Rozhodnutí: [ADR 0001 — Design tokeny z prototypu](decisions/0001-design-tokens.md). Dále:
  - Prvky z pozdějších fází jsou zobrazené jako v prototypu, ale neaktivní a se štítkem „Připravujeme“ (schváleno uživatelem).
  - Mobil: horní lišta a spodní navigace s pěti položkami, postranní menu od 768 px (schváleno uživatelem).
  - `formatCzk` bere haléře (`bigint` nebo celé `number`), celé koruny vypisuje bez desetinných míst, záporné částky s typografickým minusem. `formatDate` nikdy neposouvá datum bez času a okamžiky převádí do Europe/Prague.
  - Formátovací funkce jsou v `core`, aby je mohl použít i worker a e-maily.
  - E2E testy sdílejí jeden účet na soubor, protože registrace a přihlášení jsou v produkčním režimu omezené počtem pokusů.
- Vizuální kontrola: snímky všech pěti obrazovek na šířce 1440 px a 390 px porovnané s prototypem; nic nepřetéká do stran.
- Otevřené body: rozpory prototyp × plán (PDF faktury, e-mail/kalendář/CRM), prvky „Připravujeme“, úvodní věta Přehledu, mobilní návrh, detail faktury (viz sekce výše).
- Další krok: 1.6 Onboarding krok 1: firma podle IČO

## 2026-10-05 — krok 1.4 Přihlášení a registrace

- Hotovo: Better Auth 1.7 (e-mail + heslo min. 8 znaků, Google připravený); stránky `/registrace`, `/prihlaseni`, `/zapomenute-heslo`, `/obnova-hesla` a holá `/app`; `proxy.ts` (nepřihlášený na `/app` → přesměrování, API mimo `/api/auth` → 401) a ověření session na serveru v layoutu `/app`; `getRequestContext()` (uživatel + aktivní organizace + role); rozhraní `EmailSender` v `core`, `ResendEmailSender` v `integrations`, `FakeEmailSender` jen pro testy; E2E v Playwrightu (`pnpm test:e2e`).
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Tokeny z Google se neukládají vůbec: databázové hooky je při každém zápisu účtu vymažou, `encryptOAuthTokens` je zapnuté jako pojistka. Výchozí scopes Better Auth jsou přesně `openid email profile` (ověřeno ve zdrojovém kódu 1.7.7).
  - Konfigurace sedí se schématem z kroku 1.3 (`usePlural`, UUID); integrační testy registrace a přihlášení běží proti migrované databázi.
  - `ResendEmailSender` volá HTTP API přímo přes `fetch`, bez SDK. Bez klíče se použije odesílač, který selže s chybou; žádný mock v běžící aplikaci.
  - Odkaz pro reset hesla se nikdy neloguje; odeslání se nečeká, aby doba odpovědi neprozradila existenci účtu.
  - Po resetu hesla se zruší všechny session uživatele.
  - Instance Better Auth vzniká až při prvním požadavku, takže `next build` nepotřebuje tajné hodnoty.
  - E2E běží nad produkčním buildem na portu 3100 proti testovací databázi, s vypnutým Googlem a Resendem.
  - `NODE_ENV` odstraněno z `.env.example`: hodnota `development` z `.env` rozbila `next build` spuštěný z Playwrightu.
  - České adresy stránek (`/registrace`, `/prihlaseni`, …).
- Ručně ověřeno uživatelem s reálnými klíči: přihlášení přes Google a doručení e-mailu pro reset hesla přes Resend. V databázi po přihlášení přes Google nezůstal žádný token (`access_token`, `refresh_token`, `id_token` jsou prázdné).
- Otevřené body: klíče pro ostrý provoz, ověření e-mailu při registraci, rate limiting, audit přihlášení, stahování Chromia (viz sekce výše).
- Další krok: 1.5 Vzhled a navigace podle prototypu

## 2026-10-05 — krok 1.3 Organizace, uživatelé, role, audit

- Hotovo: migrace `0000_organizations_users_audit` (tabulky `users`, `sessions`, `accounts`, `verifications`, `organizations`, `memberships`, `audit_logs`); `packages/core`: typ `Role`, typy auditu a `sanitizeAuditMetadata`; `packages/db`: `forOrganization(db, organizationId)`, `writeAudit`, `createOrganization` (organizace + členství vlastníka + audit v jedné transakci), `listOrganizationsForUser`; ESLint pravidla proti přímému přístupu k databázi z aplikací. Testy izolace jsou zelené.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Tabulky pro Better Auth jsou vygenerované oficiálním CLI (better-auth 1.7.7), názvy v množném čísle a snake_case; jediná ruční úprava je `timestamptz`.
  - Všechna ID jsou UUID generovaná databází.
  - IČO není unikátní (vlastnictví IČO neověřujeme, unikátnost by umožnila zabrat cizí firmu); databáze hlídá jen formát 8 číslic.
  - Cizí klíče z firemních tabulek nemažou kaskádově.
  - Audit je jen pro zápis: datová vrstva nabízí vložení a čtení. Metadata procházejí `sanitizeAuditMetadata` (citlivé klíče → `[redacted]`), aktér typu `user` musí mít ID uživatele.
  - `createDb` nepřipojuje schéma k Drizzle instanci, aby `db.query.<tabulka>` nešlo použít k obejití `forOrganization`.
  - Integrační testy nic nemažou: každý test si vytváří vlastní uživatele a organizace.
- Otevřené body: tokeny v `accounts`, shoda konfigurace Better Auth se schématem, RLS, kontrola členství v kontextu požadavku, pozvánky, mazání, povinnost adresy (viz sekce výše).
- Další krok: 1.4 Přihlášení a registrace

## 2026-10-05 — krok 1.2 Lokální databáze a Redis

- Hotovo: `docker-compose.yml` (PostgreSQL 16, Redis 7, persistentní volumes, healthchecky, porty jen na 127.0.0.1); `packages/db`: Drizzle klient (`createDb`), validace prostředí (`readDatabaseUrl`, `readEncryptionKey`), `runMigrations`, skripty `db:generate` a `db:migrate`, šifrování AES-256-GCM (`src/crypto.ts`); testovací databáze `bystro_test`; `.env.example` doplněn o `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL`, `ENCRYPTION_KEY`. Ověřeno na čisté instalaci: `docker compose down -v && docker compose up -d && pnpm db:migrate`.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - `drizzle-orm` 0.45 + `drizzle-kit` 0.31 (stabilní řada; 1.0 je zatím RC), driver `pg`.
  - Schéma je zatím prázdné (tabulky až v kroku 1.3). Složka `migrations` obsahuje jen ručně založený prázdný `meta/_journal.json`, aby `db:migrate` fungovalo; první `db:generate` ho doplní.
  - `db:migrate` běží přes vlastní skript nad `drizzle-orm` migrátorem (stejný kód používají testy), ne přes `drizzle-kit migrate`.
  - Integrační testy jsou součást `pnpm test` a vyžadují běžící Postgres. Běží proti samostatné databázi `bystro_test`, kterou si založí a zmigrují; odmítnou databázi, jejíž název nekončí na `_test`.
  - Formát šifry: `v1.<iv>.<authTag>.<ciphertext>` (base64url), IV 12 náhodných bajtů na každé šifrování, klíč 32 bajtů v base64.
  - `crypto.ts` je v `packages/db/src/` (plán uvádí `packages/db/crypto.ts`) kvůli jednotné struktuře balíčků.
  - `.env` se načítá vestavěným `process.loadEnvFile`, bez knihovny `dotenv`; proměnné už nastavené v prostředí mají přednost.
  - Vývojové heslo k lokální databázi je v `docker-compose.yml` a `.env.example`; platí jen pro lokální kontejner na localhostu.
- Otevřené body: migrace při nasazení, načítání `.env` v aplikacích, rotace šifrovacího klíče (viz sekce výše).
- Další krok: 1.3 Organizace, uživatelé, role, audit

## 2026-10-05 — krok 1.1 Monorepo a nástroje

- Hotovo: git repozitář (větev `main`); pnpm workspaces + Turborepo; `packages/config` (tsconfig strict, ESLint flat config, Prettier); balíčky `core`, `db`, `integrations`, `ai` s `index.ts` a ukázkovým testem; `apps/web` (Next.js 16, App Router, holý Tailwind 4); `apps/worker` („hello“ proces); kořenové skripty `dev`, `lint`, `typecheck`, `test`, `build`, `format`; `.gitignore`, `.env.example`, `README.md`. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` prochází.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Interní balíčky exportují zdrojový TypeScript (`exports` → `src/index.ts`), bez vlastního buildu. Web je překládá přes `transpilePackages`, worker je balí přes `tsup`, ve vývoji běží přes `tsx watch`.
  - Pravidla závislostí hlídá ESLint (`no-restricted-imports`): `core` nesmí importovat žádný jiný balíček, `db` jen `core`.
  - Verze: Node 24, pnpm 12, TypeScript 6.0, Next 16, React 19, ESLint 10, Vitest 5, Turborepo 2.
  - Tailwind nainstalován už teď v holé podobě; tokeny a shadcn/ui zůstávají na krok 1.5.
  - Turborepo `agentGuidance` vypnuto (jinak generuje `AGENTS.md`); instrukce pro agenta jsou jen v `CLAUDE.md`.
  - pnpm: povolen instalační skript jen pro `esbuild` (`allowBuilds` v `pnpm-workspace.yaml`).
  - Prettier formátuje i Markdown, takže zarovnal tabulky v `CLAUDE.md` a `docs/PLAN.md` (jen mezery, obsah beze změny).
- Otevřené body: viz sekce výše (rozpor ve stacku, TypeScript 6.0, ESLint pro Next.js, fáze 0).
- Další krok: 1.2 Lokální databáze a Redis
