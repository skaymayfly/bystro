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

- **Vývoj na Intel Macu bez Dockeru (2026-10-23):** Homebrew už Intel nepodporuje; Node 24 je nainstalovaný z oficiálního balíčku a pnpm se spouští přes `npx -y pnpm@12.9.1`. Docker Desktop zatím chybí, proto integrační testy a E2E na tomhle počítači neběží. Pro prohlížení obrazovek běžel Postgres dočasně jako PGlite (`@electric-sql/pglite-socket`, port 5433) mimo repozitář; Redis chybí úplně. Do repozitáře se z toho nic nedostalo. Integrační testy a E2E se zatím ověřují jen v CI; pro lokální běh nainstalovat Docker Desktop pro Intel.
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
- **Limity poskytovatelů nejsou nikde nastavené:** omezovač bere limit jako parametr. Konkrétní čísla doplní adaptéry podle dokumentace poskytovatele (Fakturoid v kroku 2.4, Fio v kroku 3.2).
- **Dead-letter fronta se jen plní:** nikdo ji nečte a nic z ní neubývá. Záznam jde zároveň do logu a do Sentry; upozornění a postup, jak úlohu pustit znovu, patří do kroku 9.4.
- **Idempotence přes `jobId` platí jen po dobu, co fronta úlohu drží** (dokončené 24 hodin nebo posledních 1000, neúspěšné 7 dní). Proto musí být idempotentní i samotné handlery (upsert); `jobId` má obsahovat časové okno.
- **Více instancí workeru** je možné (plánovač i omezovač jsou sdílené přes Redis), ale nevyzkoušené; na Railway běží jedna.
- **Redis na Railway** by měl mít zapnuté ukládání na disk a `maxmemory-policy noeviction`, jinak může při nedostatku paměti zahodit úlohy. Ověřit v nastavení služby před betou.
- **Faktury v cizí měně** se ukládají i zobrazují v původní měně. Do korunových součtů (dlaždice na Fakturách, karta Po splatnosti) se nepočítají a obrazovka to pod seznamem říká. Přepočet kurzem (např. ČNB) není v plánu; vrátit se k němu s Hlídačem peněz (fáze 4).
- **Přijaté faktury:** model a tabulky umí směr `received`, ale synchronizace v kroku 2.5 bude načítat jen vydané. Přijaté (výdaje) přidat, až je bude potřebovat Hlídač peněz (fáze 4).
- **Nahrané odpovědi Fakturoidu pokrývají jen dvě otevřené faktury** (`src/fakturoid/fixtures/recorded/`, nahráno 2026-10-11 z účtu uživatele, anonymizováno). Ostatní případy (zaplacená, částečně zaplacená, zálohová, opravná, stornovaná, cizí měna) stojí na příkladech z dokumentace; až je uživatel v účtu vytvoří, nahrát znovu skriptem `record:fakturoid`.
- **Fakturoid a hlavička Basic:** dokumentace píše o URL-safe Base64, OAuth helper kóduje běžným Base64. S údaji uživatele vydal Fakturoid token při obou kódováních (2026-10-11); u hodnot ze samých šestnáctkových znaků se obě kódování liší jen výjimečně. Znovu ověřit při prvním připojení přes OAuth v kroku 2.6.
- **Platby z Fakturoidu se načítají přes faktury** (samostatný seznam plateb API nemá). Předpokládáme, že přidání platby změní `updated_at` faktury, takže ji přírůstkový sync (`updated_since`) zachytí. Ověřit na testovacím účtu v kroku 2.5.
- **Přijaté faktury z Fakturoidu** (náklady, endpoint expenses) adaptér nenačítá; přidat s fází 4.
- **Měsíční limit požadavků Fakturoidu:** účet uživatele má 1 500 API požadavků za měsíc (vidět v Nastavení → Napojení na jiné aplikace; dokumentace API ho neuvádí a jinde může být jiný). Synchronizace je proto hodinová jen přes den (zhruba 450 požadavků měsíčně, když se nic nemění) a úplné porovnání týdenní. Nevíme, jak API odpoví po vyčerpání limitu, ani jak zbývající počet zjistit; sledovat při prvním provozu a případně počítat požadavky u nás.
- **Smazaná faktura se v Bystru projeví až při týdenním úplném porovnání** (neděle 2:30), změny a platby do hodiny. Rychlejší by byly webhooky; ty Fakturoid nabízí jen na placených tarifech a pro OAuth aplikace až po domluvě s podporou (jinak 403).
- **Skutečné připojení Fakturoidu od začátku do konce** (přihlášení u Fakturoidu → návrat → worker → faktury v databázi) jde vyzkoušet jen na nasazené adrese a zatím neproběhlo. Udělat hned po nasazení kroku 2.6: na Railway doplnit proměnné Fakturoidu do webu i workeru a v Nastavení → Propojení kliknout na „Propojit“. Při tom ověřit i kódování hlavičky Basic a to, že nová platba změní `updated_at` faktury.
- **👤 Ověření Gmailu u Googlu před betou** (krok 8.3): `gmail.modify` je restricted scope, veřejný provoz potřebuje ověření aplikace a bezpečnostní posouzení. Do té doby Gmail jen pro testovací uživatele a s přístupem na 7 dní.
- **Upomínky pro firmy bez Gmailu:** Outlook přijde ve fázi 8; Seznam.cz nemá OAuth API pro poštu (jen SMTP/IMAP s heslem, hesla neukládáme). Rozhodnout, co nabídnout firmám na Seznamu.
- **Vypršelé akce se zatím neoznačují samy.** Akce po platnosti se označí `expired` až ve chvíli, kdy ji někdo zkusí schválit nebo spustit. Pravidelnou úlohu, která je označí, přidat v kroku 5.2 nebo 5.4, až budou akce vznikat.
- **Akce, kterou worker začal provádět a pak spadl** (nasazení, pád), zůstane ve stavu `executing`. Úloha se neopakuje, aby se nic neodeslalo dvakrát. Až budou akce něco odesílat (5.3/5.4), vyřešit: po čase ji označit `failed` s kódem `interrupted`, nebo ověřit u poskytovatele, jestli zpráva odešla.
- **Schválená akce, kterou se nepodařilo zařadit do fronty** (Redis nedostupný), čeká, dokud uživatel schválení nezopakuje. Pravidelnou úlohu, která schválené a nezahájené akce zařadí znovu, přidat spolu s označováním vypršelých akcí v kroku 5.4.
- **Client secret iDokladu prošel chatem** (2026-10-11, na snímku obrazovky z Developer portálu). Je v lokálním `.env` a v Railway; před betou v portálu vytvořit nový (Detail aplikace → Client secret → Nový client secret), starý smazat a nový zadat přímo do Railway (web i worker).
- **iDoklad není ověřený proti skutečnému účtu s daty.** Stav k 2026-10-11: přihlášení a vydání tokenu proti skutečnému iDokladu funguje; dál se nedošlo, protože účet uživatele je na tarifu Základní a iDoklad dává API až od tarifu Oblíbený (ceník <https://www.idoklad.cz/cenik>: Zdarma a Základní 0 požadavků, Oblíbený 7 500, Prémiový 75 000 měsíčně). Uživatel to vyzkouší s někým, kdo tarif s API platí. Při tom ověřit: že faktury a součty na obrazovce Faktury sedí s iDokladem (podmínka kroku 2.8); v jakém tvaru chodí data (`2026-09-30`, nebo s časem); jestli jsou částky dobropisů záporné; že smazaný doklad vrací 404; že `Reports/…/Pdf` vrací PDF v Base64. Potom nahrát skutečné odpovědi do `packages/integrations/src/idoklad/fixtures/recorded/` (skript jako u Fakturoidu zatím není). Když propojení selže, řádek `Integration connection failed` v logu služby web říká krok a kód (`detail`).
- **Stejná faktura ve Fakturoidu i v iDokladu se započítá dvakrát.** Na přání uživatele jde připojit oba systémy najednou; aplikace na to při připojování druhého upozorní, ale duplicity nehledá. Kdyby to vadilo, řešit pravidlem (např. stejné číslo dokladu a IČO odběratele) jako samostatný krok.
- **Webhooky iDokladu** (`/Webhooks`, podpis HMAC v `X-idoklad-signature`) nejsou zapojené; změny se zjišťují dotazováním podle rozvrhu jako u Fakturoidu. Zrychlily by změny a smazání na okamžité.
- **Měsíční limit iDokladu** (7 500 požadavků u tarifu Oblíbený) nikde nepočítáme. Hodinová aktualizace stojí 3 požadavky (tři seznamy dokladů), tedy asi 1 350 měsíčně, plus úhrady změněných dokladů. Po vyčerpání limitu se zachová jako jiné odmítnutí API.
- **Dlaždice iDokladu používá písmennou značku z prototypu**, ne logo: pravidla pro použití loga iDokladu nemáme. Když je uživatel dodá, vyměnit jako u Fakturoidu.
- **Země kontaktů z iDokladu** se převádí z kódu alpha-3 na alpha-2 jen pro země EU a několik dalších (tabulka v adaptéru); ostatní se uloží jako neznámé.
- **Údaje Fakturoidu prošly chatem** (2026-10-11): Client Credentials uživatelského účtu i Client ID a Secret OAuth integrace. Jsou jen v lokálním `.env`; před betou je ve Fakturoidu vygenerovat znovu a zadat přímo do Railway.
- **Proměnné na Railway pro Fakturoid:** `FAKTUROID_CLIENT_ID`, `FAKTUROID_CLIENT_SECRET` a `INTEGRATIONS_CONTACT_EMAIL` musí být na službě web i worker (stejné hodnoty), `ENCRYPTION_KEY` na obou stejný. Postup je v `docs/deploy.md`.
- **Lokální vývoj a Fakturoid:** Fakturoid nedovolí `localhost` jako návratovou adresu, takže skutečné připojení jde jen na nasazené adrese; lokálně a v E2E běží proti napodobenému serveru (`apps/web/e2e/fakturoid-stub.mjs`, přes `FAKTUROID_BASE_URL`). Kdyby bylo potřeba ladit skutečné připojení lokálně, založit druhou integraci s doménou namapovanou v souboru hosts.
- **Výběr účtu Fakturoidu** (uživatel s více účty, žádný se neshoduje podle IČO) je pokrytý integračními testy, ne E2E; ve skutečném provozu ho vyzkoušet s účtem účetní, až bude příležitost.
- **Stav připojení se v prohlížeči obnovuje dotazováním** (každé 4 s, nejdéle 3 minuty, jen když se čeká na synchronizaci). Stačí to; server-sent events zvážit, až bude stavů víc.
- **Odpojení při výpadku Fakturoidu:** tokeny se u nás smažou vždy, ale odvolání přístupu u Fakturoidu se nemusí povést (zkouší se jednou). Uživatel si může přístup zrušit i přímo ve Fakturoidu; opakované odvolání na pozadí zatím neděláme.
- **`QUEUE_PREFIX`** existuje jen kvůli E2E (aby jejich úlohy nezpracoval lokálně běžící worker). Worker předponu nečte; kdyby se měla měnit i v provozu, musí ji začít číst oba.
- **👤 Podmínka kroku 2.7 se skutečným Fakturoidem** („součty sedí s Fakturoidem“) čeká na ověření uživatelem po nasazení: v účtu jsou dvě otevřené faktury (1 000 Kč a 2 000 Kč, splatné 25. 10. 2026), na Fakturách má být „2 faktury · 3 000 Kč čeká na zaplacení“. Do té doby je krok ověřený jen na testovacích datech.
- **Stažení PDF faktury** z detailu chybí (prototyp ho má). Adaptér to umí (`getDocument`), ale každé stažení stojí požadavek z měsíčního limitu Fakturoidu; přidat s fází 5, kde se PDF přikládá k upomínce.
- **Detail faktury je bez akcí:** „Poslat připomínku“ přijde ve fázi 5; „Označit jako zaplacené“ z prototypu do Bystra nepatří (zapisovalo by do Fakturoidu, Bystro jen čte).
- **Seznam faktur se nestránkuje** a filtruje se na serveru nad všemi fakturami firmy za poslední rok. Pro stovky faktur stačí; u tisíců doplnit stránkování a filtrování v databázi.
- **Iniciály v seznamu faktur** se berou z názvu klienta (první a poslední slovo), takže „Zelený dům a.s.“ dá „ZA“. Prototyp používá iniciály kontaktní osoby; tu u faktur zatím nemáme.
- **Jedno připojení na poskytovatele a organizaci** (unikátní klíč). Dva účty u téhož poskytovatele v jedné firmě zatím nejdou.
- **`last_error_code`** je krátký strojový kód, který volí náš kód; texty chyb od poskytovatele se neukládají. Od kroku 2.4 platí společné kódy `ProviderError` z `packages/core` (`reauth_required`, `forbidden`, `account_blocked`, `rate_limited`, `provider_unavailable`, `invalid_response`).
- **Rotace `ENCRYPTION_KEY`** stále nemá postup; od tohoto kroku se jím skutečně šifrují tokeny a PKCE ověřovače.
- **Bezpečnostní hlavičky chybí** (vynucení HTTPS, zákaz vkládání do rámce, CSP) a odpověď obsahuje `x-powered-by: Next.js`. Zjištěno při kontrole nasazené adresy; řešit v kroku 7.3.
- **Testovací prostředí běží s klíči Resend a Google, které byly sdílené v chatu.** Před betou (fáze 7) vyměnit a zadat přímo do Railway.
- **Návod pro Railway** je ověřený jedním skutečným nasazením; názvy položek v administraci zůstávají orientační a cestu ke konfiguračnímu souboru služby (`railway.json`) jsme nezkoušeli.
- **Závislosti workeru:** do obrazu jdou jen závislosti z `apps/worker/package.json`. Knihovnu, kterou používá přibalený balíček `@bystro/*` (např. `pino`, `pg`, `drizzle-orm`, `zod`), je potřeba uvést i tam; chybějící závislost odhalí úloha `images` v CI, protože worker nenastartuje.
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
- **Rozpory prototyp v4 × plán a hotová aplikace** jsou sepsané v ADR 0002 (přihlášení kódem, onboarding, Přehled s úkoly, položky menu, ⌘K, „Vystavit fakturu“, Předplatné). Platí aplikace a plán; vrátit se k nim při revizi plánu.
- **Úkoly na Přehledu:** prototyp v4 staví Přehled na tabulce úkolů s prioritou, termínem a kategorií. Plán úkoly nezná (nejblíž jsou akce ve fázi 5). Rozhodnout, jestli je do plánu doplnit; do té doby má Přehled panely Hlídač peněz, Dnešní schůzky, Po splatnosti a Odpovědět.
- **Prvky „Připravujeme“:** tlačítka pro připojení, dlaždice poskytovatelů, otázky a pole asistenta a volby v Nastavení jsou vypnuté. Zprovoznit je v krocích 2.6 (fakturace), 3.3 (banka), 4.5–4.6 (Hlídač peněz), 6.4 (asistent) a 6.6 (ranní přehled).
- **Úvodní věta Přehledu** je zatím pevný text pro stav bez propojení. Skutečný ranní přehled je krok 6.6.
- **Mobilní zobrazení** není ani v prototypu v4; navržené je v ADR 0002 (horní lišta + spodní navigace pod 768 px). Ověřit s uživateli v betě.
- **Rychlé akce ⌘K** (vyhledávací paleta z v4) nejsou postavené ani v plánu. Rozhodnout, kam je zařadit.
- **Profil v Nastavení je jen ke čtení** a volba „Jak spolu mluvíme“ (tykání, vykání, stručně) se neukládá; tón zatím nikde v plánu není.
- **Karta Předplatné v Nastavení** z v4 chybí; vznikne v kroku 9.1, až budou potvrzené ceny.
- **Jméno při registraci** se zadává jako dvě pole (Jméno, Příjmení) a ukládá spojené do jednoho; přihlášení přes Google dává jméno vcelku.
- **Šablona e-mailu pro reset hesla** je prostý text bez loga; do nového vzhledu ji převést spolu s dalšími e-maily (krok 5.3 nebo 6.6).
- **Složka `Webapp design project kickoff`** (starší verze prototypu a podklady) zůstává na disku mimo repozitář (`.gitignore`); závazný je jen obsah `docs/prototyp/`.
- **Izolace tenantů je na úrovni kódu, ne databáze:** firemní tabulky nejsou exportované z `@bystro/db` a aplikace mají ESLintem zakázaný `drizzle-orm`, `pg`, `.execute()` a `$client`. Lint jde vědomě obejít (`eslint-disable`), proto v kroku 7.3 zvážit Row Level Security jako druhou vrstvu.
- **Pozvánky dalších členů do organizace** nejsou v plánu rozepsané; role `admin` a `member` zatím nemá jak vzniknout přes UI.
- **Mazání uživatele a organizace:** cizí klíče z `memberships` a `audit_logs` nemažou kaskádově, takže smazání uživatele s členstvím selže. Vyřešit v kroku 7.4 (GDPR).
- **Rotace `ENCRYPTION_KEY`:** formát šifry má prefix verze (`v1`), ale postup rotace klíče zatím neexistuje. Vyřešit před ostrým provozem (nejpozději fáze 7).
- **Soubory `.DS_Store`** v kořeni a v `docs/` zůstávají na disku, jen jsou v `.gitignore`.

---

## Záznamy

## 2026-10-24 — krok 5.4 Synchronizace pošty

- Dokumentace (2026-10-24): návod k synchronizaci, `messages.list`, `messages.get` a formáty, zdroj Message a MessagePartBody, `history.list`, dávkové požadavky, chyby a kvóty Gmail API.
- Hotovo: doménová logika pošty v `packages/core/src/mail.ts` (text z MIME podle znakové sady, převod HTML na text, hlavičky a adresy včetně RFC 2047, okno 30 dní, zpracování historie); tabulky `mail_messages` a `mail_threads` (migrace `0005_mail`) a funkce v `packages/db/src/mail.ts`; čtení schránky v `packages/integrations/src/gmail/mailbox.ts`; synchronizace `packages/integrations/src/sync/mail-sync.ts`; úlohy `sync.mail` a `sync.dispatch-mail` s plánem ve workeru; omezovač počítá váhu volání a umí počkat; obnova tokenu sdílená se synchronizací faktur; web po připojení Gmailu zařadí první načtení; odpojení smaže poštu.
- Rozhodnutí: [ADR 0006](decisions/0006-synchronizace-posty.md).
- Databáze: migrace `0005_mail` (dvě nové tabulky, žádná změna stávajících).
- Testy: unit (`core`: MIME, znakové sady, HTML, adresy, historie, úlohy a plán); adaptér proti odpovědím podle dokumentace; integrační (`db`: dvojí uložení, šifrování, vlákna, okno, odpojení, izolace organizací; synchronizace: první úplná, opakování bez duplicit a bez stahování, nová zpráva, přečtení a archivace jinde, koš, smazání, prošlá historie, okno, přerušený běh; worker: obnova tokenu, odmítnutý refresh token, čekání na kvótu, výpadek, nenastavený Gmail, plánovač; web: první načtení po připojení); omezovač s váhou proti Redisu.
- Ověřeno lokálně: lint, typecheck, formát; testy `core`, `integrations`, `db` a úloh workeru proti PGlite. Testy workeru s Redisem a E2E ověří CI.
- 👤 Zbývá: nastavit Gmail v Google Cloud Console (z kroku 5.3) a zadat `GMAIL_CLIENT_ID` a `GMAIL_CLIENT_SECRET` i do služby worker na Railway. Pak nahrát skutečné odpovědi Gmailu místo odpovědí podle dokumentace.
- Další krok: 5.5 Obrazovka Pošta.

## 2026-10-23 — krok 2.11 Rozložení podle Revolut Business a Stripe

- Hotovo: nový shell (užší menu na šedé ploše, Nastavení dole, pod ním profil se šedým kolečkem s iniciálami, jménem, rolí s firmou a e-mailem; horní lišta jen s datem), Přehled ve dvou sloupcích (karta Po splatnosti s velkým číslem a tabulkou, karta zůstatku, widgety Dokonči nastavení / Odpovědět / Dnešní schůzky), menší nadpisy stránek, karty s rádiusem 16 px a stínem, stavové štítky jako ve Stripe, úpravy seznamu faktur, Nastavení a Propojení, logo Googlu na tlačítku přihlášení přes Google. Podklad z Mobbinu v `docs/design/ui-reference.md`.
- Rozhodnutí: [ADR 0005](decisions/0005-rozlozeni-revolut-stripe.md). Pilulka s firmou vpravo nahoře byla na přání uživatele odebraná, protože opakovala profil vlevo dole.
- Ověřeno: lint, typecheck, unit, integrační testy, E2E a sestavení obrazů v CI (PR #26). Obrazovky prošlé v prohlížeči na počítači i mobilu, ve světlém i tmavém režimu, s prázdnými stavy i s ukázkovými fakturami.
- Poučení: PR #25 byl mergnutý dřív, než doběhlo CI, a `main` měl do mergnutí PR #26 jeden padající E2E test (firma v postranním menu). Mergovat až po zeleném CI.
- Otevřené body: boční panel detailu faktury, rychlé vytvoření „+“, hledání v liště a seskupené seznamy v Nastavení (ADR 0005, „Co z podkladu zatím není“).
- Další krok: 5.4 Synchronizace pošty.

## 2026-10-23 — krok 5.3 Propojení Gmailu a sekce Pošta

- Rozhodnutí uživatele: upomínky z vlastní schránky, ne přes Fakturoid ani iDoklad ani z domény Bystra; a rovnou celá sekce Pošta (i čtení). Pravidlo v `CLAUDE.md` změněné: Gmail je před betou. Plán fáze 5 přepsaný: 5.3 propojení a Pošta, 5.4 synchronizace pošty, 5.5 obrazovka Pošta, 5.6 odpověď a nový e-mail, pak původní upomínka (nově 5.7), obrazovka Akce (5.8) a hlídání výsledku (5.9). Asistent nad poštou je nový krok 6.6b; fáze 8 má místo Gmailu jeho ověření u Googlu (8.3). ADR 0004.
- Dokumentace (2026-10-23): Google OAuth pro webové aplikace a jeho OpenID konfigurace (endpointy, PKCE S256, `access_type=offline`, `prompt=consent`, odvolání), Gmail scopes (`gmail.modify` restricted, `gmail.send` sensitive), `users.getProfile`, `messages.modify` (scopes), návod k synchronizaci a limity (6 000 jednotek/min na uživatele), vypršení refresh tokenu v testovacím režimu (7 dní) a limit 100 refresh tokenů na účet a klienta.
- Hotovo: adaptér `packages/integrations/src/gmail` (OAuth konfigurace, kontrola udělených oprávnění, odvolání přístupu, klient Gmail API, adresa schránky); tok připojení a odpojení v `apps/web/src/server/connections.ts`, cesty `/api/integrations/gmail/connect` a `/callback`; návrat na Poštu (`returnTo=mail`) a nový výsledek `propojeni=opravneni` (odškrtnuté oprávnění); položka Pošta v menu (i v mobilní liště) a obrazovka `/app/posta`; dlaždice Gmailu v Propojení; tlačítko „Připojit e-mail“ na Přehledu vede na Poštu; proměnné `GMAIL_CLIENT_ID` a `GMAIL_CLIENT_SECRET`.
- Rozhodnutí:
  - Gmail se nezapíná s přihlášením přes Google; má vlastní proměnné (klient může být stejný).
  - Připojení e-mailu nespouští synchronizaci faktur ani ruční „Aktualizovat“; e-mail zatím nečeká na „první načtení“ (synchronizace pošty je krok 5.4).
  - Text na kartě Přidat aplikaci: „Faktury jen čtu. E-mail pošlu jen ten, který odešleš nebo schválíš.“ (dřív „Přístup je vždy jen pro čtení“, což už neplatí).
- Databáze beze změny (připojení `category = email`).
- Testy: adaptér (autorizační adresa, výměna kódu, oprávnění, odvolání, profil, chyby); tok proti databázi (PKCE, uložení, odškrtnuté oprávnění, nečitelná schránka, `state`, odmítnutí, žádná synchronizace faktur, odpojení s odvoláním); texty a návratové adresy; E2E: Přehled → Pošta → propojení přes náhradní server Googlu (ověřuje PKCE) → stav v Propojení → odpojení; podvržený návrat. Nové položky menu v testech navigace.
- 👤 Zbývá: nastavit Google Cloud Console podle `docs/deploy.md` (sekce Gmail) a zadat proměnné do Railway; ověřit propojení s tvým účtem.

## 2026-10-23 — krok 2.10 Paleta podle libraries.dev a tmavý režim

- Zadání uživatele: podle podkladu „Bystro paleta z libraries.dev“ změnit celý branding, přidat tmavý režim, modrá hlavní tlačítka, mono popisky, inspirovat se i webem libraries.dev; maskota Bystrouše odebrat úplně. Krok vložený před 5.3 (Gmail), plán 5.3 zatím čeká na schválení.
- Hotovo: barvy jako proměnné pro světlý a tmavý režim (`globals.css`), tmavý režim podle systému a přepínač Vzhled v Nastavení → Profil (volba v prohlížeči, bez probliknutí), modrá tlačítka-pilulky se stiskem, akcent na odkazech a aktivní položce menu, segmentové přepínače, mono popisky (Roboto Mono), jemné objevení obrazovek, stránka chyby v nové paletě. Maskot odebraný i s podklady (`docs/prototyp/maskot/`), prázdné stavy mají zpátky ikony. Podklad palety je v `docs/prototyp/paleta-libraries-dev.html`.
- Rozhodnutí (ADR 0003):
  - Tlačítková modrá `#006FF5` místo `#0071FC` z podkladu: bílý text na `#0071FC` má kontrast 4,40 : 1, pod WCAG AA.
  - Barvy stavů zůstávají z Bystra, v tmavém režimu zesvětlené.
  - Tmavé hodnoty jsou v CSS dvakrát (podle systému a podle volby); test hlídá, že jsou stejné.
  - Dlaždice Fakturoidu má i v tmavém režimu bílé pozadí (pravidla jeho loga).
  - Písmo zůstává Geist; Roboto Mono jen na drobné popisky.
- Databáze ani API beze změny.
- Testy: kontrast hlavních dvojic barev v obou režimech, shoda tmavých bloků, úplnost tmavé palety, volba vzhledu; E2E: všechny obrazovky v tmavém režimu na počítači i mobilu (barva pozadí, nic nepřetéká, snímky), přepnutí vzhledu v Nastavení a jeho trvání po obnovení stránky; snímky seznamu faktur a přihlášení v obou režimech.

## 2026-10-19 — krok 5.2 API pro schválení

- Hotovo: `POST /api/v1/actions/{id}/approve` (tělo `{ "approval": true }`) a `POST /api/v1/actions/{id}/reject`; logika v `apps/web/src/server/actions.ts` (`decideOnAction`), společná obsluha cest v `action-route.ts`; kontrola aktuálnosti dat `checkActionStillValid` v `packages/db`; úloha `actions.execute` a její zpracování ve workeru (`apps/worker/src/jobs/execute-action.ts`) s registrem vykonavatelů podle typu akce.
- Rozhodnutí:
  - Schvalovat a zamítat smí majitel a správce, člen ne (schválil uživatel). Upomínka jde jménem firmy klientovi.
  - Odpověď podle kontraktu z kapitoly 23: `{ actionId, status, executedAt, resultReference }`. Provádí se na pozadí, takže po schválení `status: "approved"`, `executedAt: null`. Chyby: 400 `invalid_request`, 401, 403 `forbidden` (role nebo cizí původ požadavku), 404 `not_found` (i akce jiné firmy), 409 `conflict` (už rozhodnuto jinak) a `source_changed` (data se změnila, akce zrušena), 410 `expired`.
  - Dvojklik a opakovaný požadavek se stejným rozhodnutím vrátí 200 s aktuálním stavem a nic nezdvojí; schválení zopakované po výpadku fronty akci zařadí znovu (ID úlohy je odvozené od akce, takže dvakrát se nezařadí).
  - Aktuálnost dat: upomínka dává smysl jen u faktury, která je dnes (Europe/Prague) po splatnosti, nesmazaná, nezaplacená a nestornovaná; stav se počítá stejnou funkcí jako na obrazovce Faktury. Kontroluje se při schválení i těsně před provedením; když neplatí, akce vyprší s důvodem v auditu (`source_changed` / `source_missing`).
  - Provedení: jen akce ve stavu `approved`; přechod do `executing` pod zámkem řádku, takže ze dvou úloh provede akci jen jedna. Úloha se nikdy neopakuje (`attempts: 1`); neúspěch se zapíše na akci s kódem (`executor_error`, když chyba žádný použitelný kód nemá). Typ bez vykonavatele skončí `failed` / `no_executor` a nic neodešle; v produkci zatím žádný vykonavatel není (upomínka přijde v 5.3 a 5.4).
  - **Navíc proti plánu:** sloupec `actions.executed_at` (migrace `0004_action_executed_at`), aby odpověď uměla vrátit čas provedení i po ověření výsledku.
  - Web nově závisí přímo na `zod` (validace těla požadavku).
- Testy: rozhodování proti databázi (schválení a zařazení, dvojklik, tři souběžná schválení, opačné rozhodnutí, zamítnutí, role, cizí firma, zaplacená, smazaná a posunutá faktura, vypršení, výpadek fronty); provedení ve workeru (výsledek a audit, dvě souběžné úlohy, zaplaceno po schválení, po platnosti, chyba s kódem bez opakování, obecný kód, chybějící vykonavatel, neschválená a neznámá akce); definice úlohy; E2E ochrana cest (přihlášení, původ, tělo, cizí a neplatné ID).

## 2026-10-19 — krok 5.1 Action engine

- Hotovo: stavový automat akcí v `packages/core/src/actions.ts` (stavy, události, úrovně schválení, rozhodnutí, `isActionExpired`); tabulky `actions` a `approvals` (migrace `0003_actions`); funkce v `packages/db/src/actions.ts`: `proposeAction`, `getAction`, `listActions`, `getApproval`, `applyActionEvent`, `decideAction`.
- Zdroj: kapitola 13 zadání (co má každá akce mít) a část Action engine; Workflow B pro budoucí kroky.
- Rozhodnutí:
  - Přechody: `proposed` → `approved` / `rejected` / `expired`; `approved` → `executing` / `expired`; `executing` → `succeeded` / `failed`; `succeeded` → `verified`. Zadání píše „succeeded/failed → verified“; `failed` jsme nechali konečný, protože ověřovat výsledek akce, která se neprovedla, nedává smysl. Nový pokus je nový návrh s vlastním schválením.
  - `approved → expired`: schválená akce se ještě před spuštěním dá zrušit, když přestane dávat smysl (faktura mezitím zaplacená; použije krok 5.2).
  - Akci po platnosti nejde schválit ani spustit: v té chvíli se označí `expired` (s auditem) a volající dostane `ActionExpiredError`.
  - Úroveň schválení `user` nebo `none`; systém smí sám schválit jen `none`. Rozhodnutí člověka jde jen přes `decideAction`, které v jedné transakci zapíše `approvals` a změní stav.
  - Idempotence: `(organization_id, idempotency_key)` je unikátní a opakovaný návrh vrátí existující akci (i při souběhu).
  - Souběh: změny stavu zamykají řádek akce; ze dvou současných rozhodnutí projde jedno, druhé skončí `ActionTransitionError` a nic nezapíše.
  - Audit: `action.proposed` a `action.status_changed` (událost, odkud, kam, kdo, kód chyby). Náhled akce (příjemce, text) do auditu nejde. Kód chyby musí být krátký kód, ne zpráva od poskytovatele.
  - Typy akcí zatím jen `invoice_reminder`; další přidá migrace s funkcí, která je potřebuje.
- Databáze: migrace `0003_actions` (výčty `action_type`, `action_status`, `action_approval_level`, `approval_decision`; tabulky `actions`, `approvals` se složeným cizím klíčem přes organizaci). Tabulky se z balíčku neexportují (hlídá test).
- Testy: všech 56 kombinací stav × událost (8 povolených, 48 zakázaných), hranice platnosti; proti databázi: návrh, idempotence i při souběhu, oddělení firem, rozhodnutí a audit, souběh tří rozhodnutí, vypršení při schválení i spuštění, zakázaný přechod bez stopy, chyba s kódem, automatické schválení jen u `none`.
- Otevřené: viz Otevřené body (označování vypršelých akcí, oprávnění podle role v 5.2).

## 2026-10-19 — krok 2.9 Maskot Bystrouš a nové pořadí fází

- **Nové pořadí fází** (rozhodl uživatel 2026-10-19, změněno i pravidlo v `CLAUDE.md`): po fázi 2 přijde fáze 5 (akce, upomínky, schvalování), pak 6 (AI a ranní přehled), pak 3 (banka a párování) a 4 (Hlídač peněz). Důvod: banka je nejnáročnější. Čísla fází zůstala, v `PLAN.md` jsou fáze přeskládané podle pořadí práce. Úpravy kroků: 5.6 pozná zaplacenou fakturu podle fakturačního systému (párování s bankou doplní fáze 3); 6.2 zatím bez nástrojů `finance.getCashPosition` a `finance.getCashflow`; 6.3 na „Zvládnu zaplatit DPH?“ řekne, že bez banky neví; 6.6 bez rizika cashflow. Fáze 3 a 4 mají v úvodu, co do hotových částí doplní. Cena: Hlídač peněz přijde až po AI; na betu je banka potřeba tak jako tak.
- **Maskot:** podklad přesunutý z kořene repozitáře do `docs/prototyp/maskot/`. Komponenta `Mascot` s osmi stavy a třemi velikostmi, styl vygenerovaný z podkladu a omezený na `.masc`, popisky pro čtečky v `apps/web/src/lib/mascot.ts`. Zapojený na existující obrazovky (seznam v ADR 0002); `ScreenEmpty` a `PanelEmpty` mají volbu `mascot`. Proti návrhu: „ahoj“ je v kroku 1 onboardingu (první setkání), ne v kroku 2. Text „Nic po splatnosti“ při fakturách v termínu převzatý z podkladu: „Hlídám dál. Ozvu se, kdyby se něco změnilo.“
- Databáze ani API beze změny.
- Testy: popisky a rozměry maskota, styl pokrývá všechny stavy a nic mimo `.masc`, vypnutí animací; E2E: maskot v onboardingu, na prázdných stavech (počítač i mobil), na kartě Po splatnosti a u chyby propojení.
- Otevřené: ostatní stavy (zaplaceno, oslava, ranní přehled) přidají kroky 5.x a 6.6.

## 2026-10-11 — iDoklad: první pokusy se skutečným účtem

- PKCE jako příčina `invalid_grant` je potvrzené: po nasazení opravy (PR #18) vydání tokenu prošlo.
- Další pokus zastavil iDoklad odpovědí o nedostatečném tarifu při čtení `/Account/CurrentAgenda`. Aplikace ukázala hlášku o tarifu, nic neuložila a přístup u iDokladu vrátila (chování podle návrhu). Účet uživatele je na tarifu Základní, který API nemá.
- Rozhodnutí uživatele: iDoklad vyzkouší s někým, kdo platí tarif s API, a dá vědět. Krok 2.8 zůstává zaškrtnutý s otevřeným bodem „ověření proti skutečnému účtu s daty“.
- Kód se v tomto záznamu neměnil.

## 2026-10-11 — oprava: iDoklad bez PKCE a čitelná příčina nepovedeného připojení

- Důvod: první skutečné připojení iDokladu skončilo hláškou „iDoklad teď neodpovídá“. Z aplikace nešlo poznat proč.
- Do logu webu se nově zapisuje, ve kterém kroku připojení selhalo (`detail`: `not_configured`, `token: <HTTP stav> <kód OAuth>`, `account: <kód>`); žádný text od poskytovatele ani tokeny. Uživatel v logu Railway našel `token: 400 invalid_grant`.
- Příčina: přihlašovací server iDokladu odmítá požadavek na token s `code_verifier` u aplikace registrované s Flow „AuthorizationCode“, přestože v OpenID konfiguraci PKCE uvádí. Dokumentace PKCE nepoužívá. `idokladOAuthConfig` má proto `pkce: "none"`; požadavek dál chrání jednorázový `state` svázaný s uživatelem a firmou a client secret.
- Že je příčinou právě PKCE, je závěr z chování serveru (stejný požadavek s platným client secretem a vymyšleným kódem také vrací `invalid_grant`, takže to z odpovědi samotné jistě poznat nejde). Potvrdí to až další pokus uživatele o připojení.
- Náhradní server v E2E se chová stejně: požadavek s `code_verifier` odmítne.

## 2026-10-11 — krok 2.8 Adapter iDoklad

- Hotovo: adaptér `packages/integrations/src/idoklad` (`IdokladClient`, `IdokladProvider`, `IdokladLists`, OAuth konfigurace, odvolání přístupu, čtení agendy) za rozhraním `InvoiceProvider`; synchronizace přes stejné úlohy jako Fakturoid; připojení a odpojení v aplikaci (`/api/integrations/idoklad/connect`, `/callback`); dlaždice a panel iDokladu v Nastavení → Propojení a v onboardingu; worker i web čtou `IDOKLAD_CLIENT_ID` a `IDOKLAD_CLIENT_SECRET` (obě, nebo žádná).
- Dokumentace: iDoklad API v3 (<https://api.idoklad.cz/Help/v3/cs/>, čteno 2026-10-11) a OpenID konfigurace přihlašovacího serveru. Použité endpointy: `/IssuedInvoices`, `/ProformaInvoices`, `/CreditNotes` (seznam i detail), `/Contacts`, `/IssuedDocumentPayments`, `/Currencies`, `/Countries`, `/Account/CurrentAgenda`, `/Reports/{IssuedInvoice|ProformaInvoice|CreditNote}/{id}/Pdf`; `connect/authorize`, `connect/token`, `connect/revocation`.
- Rozhodnutí:
  - **Oba fakturační systémy jdou připojit najednou** (rozhodl uživatel, proti doporučení jeden systém na firmu). Při připojování druhého aplikace upozorní, že faktury vedené v obou uvidí a započítá dvakrát. Obrazovky jmenují všechny zdroje („Zdroj: Fakturoid a iDoklad“) a jako čas aktualizace ukazují ten starší.
  - Přihlášení: Authorization Code bez PKCE (viz oprava níže; původně s PKCE), client id a secret v těle požadavku, rozsahy `idoklad_api offline_access` i v požadavku na token (podle příkladů v dokumentaci; `OAuthProviderConfig.tokenRequestParams`). Refresh token se při každé obnově mění a worker ukládá nový.
  - U iDokladu si uživatel vybírá firmu (agendu) při přihlášení, takže výběr účtu jako u Fakturoidu není. Agenda se přečte z `/Account/CurrentAgenda` a její id je `external_account_id`. Když ji přečíst nejde, přístup se hned vrátí a nic se neuloží; odpověď 402/403 se uživateli ukáže jako nedostatečný tarif.
  - Externí id dokladů mají předponu druhu (`invoice-16`, `proforma-16`, `credit-16`), protože id tří seznamů jsou na sobě nezávislá. Tři seznamy se čtou za jedním kurzorem (`invoice:2` → `proforma:1` → `credit:1`).
  - Stav: `PaymentStatus` Unpaid a PartialPaid → `open`, Paid a Overpaid → `paid`. iDoklad nemá koncepty ani storno. Datum úhrady se přebírá jen u zaplaceného dokladu.
  - Částky chodí jako JSON čísla. Převádí se z nejkratšího desetinného zápisu čísla (bez počítání s ním) a částka, kterou nejde převést přesně na haléře, znamená odmítnutí odpovědi. Jednotková cena a množství, které se nevejdou do našeho modelu, se vynechají (řádek zůstane).
  - Měna a stát jsou v odpovědích jako id z číselníků; číselníky se načtou jednou za proces a drží 24 hodin (šetří měsíční limit požadavků).
  - **Úhrady zvlášť** (otevřený bod z kroku 2.5): faktura s `payments: null` dostane úhrady dotazem `listPayments({ invoiceExternalIds })`, po dvaceti dokladech na požadavek. Doklad bez jakékoli úhrady o ni nežádá. `ListOptions.invoiceExternalIds` je nové pole v `core`.
  - Chyby: 401 → znovu připojit, 402/403/600 → `account_blocked`, 429 → odložit (hlavička `Retry-After`, jinak minuta), 5xx a síť → opakovat, ostatní → `invalid_response`.
  - Cesty připojení mají společnou obsluhu (`apps/web/src/server/connect-routes.ts`); návrat z poskytovatele nese v adrese i aplikaci (`&aplikace=idoklad`), aby hláška jmenovala tu správnou. Texty stavů připojení skloňují název podle aplikace (`apps/web/src/lib/invoicing-providers.ts`).
- Databáze: beze změny.
- Testy: mapování dokladů, úhrad a kontaktů proti příkladům z dokumentace (haléře bez chyb plovoucí čárky, data, stavy, druhy dokladů, vadné odpovědi), chybové stavy klienta, stránkování a filtry, číselníky, PDF, OAuth konfigurace a odvolání; synchronizace s úhradami zvlášť (včetně odebrané úhrady); worker (střídající se refresh token, výběr adaptéru, proměnné); připojení a odpojení iDokladu proti databázi (state, PKCE, cizí firma, zamítnutí, nedostatečný tarif, oba systémy vedle sebe); texty; E2E připojení iDokladu vedle Fakturoidu, odpojení a podvržený návrat (náhradní server ověřuje PKCE).
- Otevřené: viz Otevřené body (ověření proti skutečnému účtu, výměna client secretu, duplicity mezi systémy, webhooky, měsíční limit, logo, země).

## 2026-10-11 — oprava: je vidět, když se synchronizace nerozběhne

- Důvod: uživateli po připojení Fakturoidu zůstalo trvale „Čekám na první načtení“. Aplikace neuměla říct, že worker neběží nebo nemá nastavení, a zvenku to nešlo zjistit.
- `GET /api/health` nově vrací i `worker: "ok" | "down"`. Worker každých 30 s zapíše do Redisu značku s platností 90 s (`packages/queue`: `writeWorkerHeartbeat`, `readWorkerHeartbeat`); web ji čte. Stav workeru je informativní a nemění stavový kód, aby výpadek workeru neshodil nasazení webu.
- Synchronizace, která nemůže ani začít (`provider_not_configured`, `credentials_missing`), teď přepne připojení do stavu `error` s kódem. Dřív úloha skončila v dead-letter a připojení zůstalo „připojeno“.
- Obrazovka Propojení: když se první načtení nestihne do 3 minut od připojení, místo „Čekám na první načtení“ ukáže „Načtení se zdrželo“ s radou zkusit Aktualizovat; pro oba nové kódy chyby má vlastní text.
- Testy: značka workeru proti Redisu, stav připojení po nerozběhnuté synchronizaci a jeho zotavení, texty stavů, health s vypnutým workerem.
- Otevřené: příčinu u uživatele (nejspíš chybějící proměnné nebo neběžící worker na Railway) ověřit po nasazení přes `/api/health`.

## 2026-10-11 — krok 2.7 Obrazovka Faktury a karta na Přehledu

- Hotovo: obrazovka Faktury podle v4 (souhrnné dlaždice Po splatnosti / Čeká na platbu / Zaplaceno, filtry, hledání, řazení, tabulka); detail faktury (`/app/faktury/{id}`: částka k úhradě, vystaveno, splatnost, variabilní symbol, kontakt, položky, historie); karta „Po splatnosti“ na Přehledu (součet, počet, nejstarší, tři nejstarší faktury) a věta v úvodu Přehledu; čtení z databáze (`listInvoiceOverview`, `getInvoiceDetail`); logika seznamu v `packages/core/src/invoice-overview.ts`; `formatMoney`.
- Rozhodnutí:
  - Stavy, filtry, hledání, řazení a součty počítá čistý kód v `core` nad daty jedné firmy; stránky jen vykreslují. Den se bere v pražském čase.
  - Filtry: Vše / Po splatnosti / Brzy splatné / Čeká / Zaplaceno. „Brzy splatné“ je navíc proti v4 (je v plánu); „Čeká“ zahrnuje i brzy splatné. Filtr, hledání a řazení jsou v adrese (`?stav=`, `?q=`, `?razeni=`), takže fungují bez JavaScriptu a jdou sdílet.
  - Výchozí řazení: nezaplacené nahoře od nejdéle po splatnosti, zaplacené na konci. Řadit jde i podle čísla, klienta a částky.
  - Součty: „Po splatnosti“ a „Čeká na platbu“ sčítají nezaplacený zbytek (po odečtení dílčích plateb), „Zaplaceno“ celé částky. Jen v korunách; faktury v jiné měně se počítají do počtu, ne do částky (schváleno uživatelem).
  - Koncepty, stornované a smazané faktury se v seznamu ani v součtech neukazují.
  - Každé číslo má u sebe zdroj a čas: „Zdroj: Fakturoid · aktualizováno před X“.
  - Detail se hledá vždy spolu s firmou; cizí, smazaná nebo vymyšlená faktura je 404.
  - Texty z Fakturoidu (klient, položky) se vypisují jako prostý text.
  - Bez propojení zůstává prázdný stav z prototypu; po propojení bez faktur „Faktury se načítají“ (před první synchronizací) nebo „Ve Fakturoidu zatím žádné faktury nevidím“.
- Bez migrace a bez nových HTTP cest.
- Testy: 13 testů logiky seznamu v `core` (stavy, dílčí platba, filtry, hledání bez diakritiky, řazení, součty, cizí měna); 5 integračních testů čtení (součet plateb, odebraná platba, platba v jiné měně, oddělení firem, skrytá data, cizí a smazaná faktura v detailu); unit testy textů a adres; E2E se čtyřmi scénáři: součty a pořadí, filtry + hledání + řazení, detail a karta na Přehledu, cizí a vymyšlená faktura (404).
- Otevřené body: ověření se skutečným Fakturoidem, PDF, akce na detailu, stránkování, iniciály (viz sekce výše).
- Další krok: 2.8 Adapter iDoklad

## 2026-10-11 — panel Fakturoidu se otevírá až kliknutím (úprava na přání uživatele)

- Rámeček s požadavky a tlačítkem „Propojit“ už není otevřený předem. Otevře se kliknutím na dlaždici Fakturoidu a druhým kliknutím se zavře, jako v prototypu v4; dokud je zavřený, je pod dlaždicemi „Klikni na aplikaci a uvidíš, co je potřeba.“ Dlaždice je tlačítko ve všech stavech: nepropojeno (požadavky a „Propojit“), propojeno (odkaz na seznam propojených aplikací), nenastaveno („Připravujeme“). Platí v Nastavení → Propojení i v onboardingu.
- Věta „Fakturoid je samostatná placená služba, kterou provozuje Fakturoid s.r.o. Propojení s ní vyvíjí Bystro.“ se přesunula z místa pod všemi dlaždicemi do panelu Fakturoidu. Pravidla loga ji vyžadují v prezentaci doplňku; je tedy u Fakturoidu, jen až po kliknutí. Kdyby to Fakturoid při schvalování integrace chtěl viditelné hned, vrátit ji pod dlaždice.
- Dlaždice a panel jsou nově v klientské komponentě `apps/web/src/components/connections/provider-picker.tsx`; `ProviderTiles` z `bits.tsx` zmizelo.
- Test: E2E ověřuje, že před kliknutím tlačítko „Propojit“ ani věta nejsou, po kliknutí jsou a druhé kliknutí panel zavře.

## 2026-10-11 — dlaždice Fakturoidu vede k tlačítku „Propojit“ (drobná úprava po kroku 2.6)

- Uživatel při prvním pokusu klikal na dlaždici s logem, která nic nedělala (v prototypu v4 se na dlaždice kliká). Když jde Fakturoid připojit, je teď jeho dlaždice odkaz na rámeček s požadavky a tlačítkem „Propojit“; rámeček se po kliknutí zvýrazní. Po připojení a bez nastavení Fakturoidu dlaždice odkazem není. Platí v Nastavení → Propojení i v onboardingu.
- Test: E2E připojení kliká nejdřív na logo a ověřuje, že je tlačítko vidět.

## 2026-10-11 — krok 2.6 Obrazovka Propojení

- Hotovo: připojení Fakturoidu přes OAuth (`POST /api/integrations/fakturoid/connect`, `GET /api/integrations/fakturoid/callback`), stav připojení (`GET /api/integrations/connections`), ruční aktualizace, odpojení a výběr účtu (`POST /api/integrations/connections/{id}/sync|disconnect|account`); logika v `apps/web/src/server/connections.ts`; obrazovka Nastavení → Propojení podle v4 se stavy a tlačítky; onboarding krok 2 nabízí Fakturoid; tlačítka „Připojit fakturaci“ na Přehledu a ve Fakturách vedou na Propojení; nový balíček `packages/queue` (fronty společné pro web a worker); synchronizace se zařadí hned po připojení.
- Rozhodnutí (schváleno uživatelem):
  - Nový balíček `packages/queue`: přesunutý kód front z workeru, web přes něj jen zařazuje úlohy. Struktura v `CLAUDE.md` je doplněná.
  - Po odpojení se faktury, položky, platby a klienti z daného připojení skryjí (`deleted_at`) a zapomene se pozice synchronizace; po opětovném připojení je úplná synchronizace vrátí.
  - Skutečné připojení jde jen na nasazené adrese (Fakturoid nedovolí `localhost`); lokálně a v E2E běží napodobený server.
  - Úklid `oauth_requests` se do audit logu nezapisuje, stačí log workeru (uživatel na opakovaný dotaz nenamítal).
  - Zahájení připojení je POST formulář s kontrolou hlavičky `Origin`; `state` je vázaný na uživatele a firmu, platí 10 minut a jde použít jednou (z kroku 2.1). Kód se mění za tokeny jen na serveru.
  - Kam se po návratu jít (Nastavení nebo onboarding) si pamatuje krátká `HttpOnly` cookie se dvěma povolenými hodnotami; výsledek se stránce předává slovem v adrese (`propojeni=ok|vybrat-ucet|zamitnuto|neplatne|nedostupne|bez-uctu`), nikdy textem od poskytovatele.
  - Účet ve Fakturoidu: jediný účet s právem na faktury se použije rovnou; z více účtů ten se stejným IČO jako firma; jinak uživatel vybírá a volba se ověří proti tomu, co vrací Fakturoid. Uživatel bez použitelného účtu se nepřipojí a přístup se hned odvolá.
  - Ruční „Aktualizovat“ jde jednou za 5 minut (měsíční limit Fakturoidu); `jobId` nese pětiminutové okno.
  - Odpojení: odvolání u Fakturoidu (`POST /oauth/revoke`, jednou, bez blokování), smazání tokenů, stav `revoked`, audit, skrytí dat. Opakované odpojení nic nerozbije.
  - Odpověď `GET /api/integrations/connections` obsahuje jen stav, název účtu, čas poslední synchronizace a strojový kód chyby. Texty stavů skládá web z kódů; neznámý kód se uživateli neukáže.
  - Bez nastavení Fakturoidu (tři proměnné) zůstává všude „Připravujeme“.
- Testy: 13 integračních testů logiky připojení proti databázi (parametry adresy, šifrované tokeny, výběr účtu, cizí, chybějící, vymyšlený a použitý `state`, odmítnutí uživatelem, chyba výměny kódu, uživatel bez účtu, ruční aktualizace a její omezení, odpojení včetně výpadku Fakturoidu a cizí firmy); unit testy textů stavů, návratových adres a nastavení; E2E s napodobeným Fakturoidem: připojení → stav → odpojení s kontrolou, že po odpojení nejsou v databázi tokeny a že se tokeny nikdy nedostaly do prohlížeče, onboarding, podvržený návrat, ochrana cest (bez přihlášení 401, cizí původ 403, cizí nebo neplatné ID 404).
- Nahrané odpovědi ze skutečného účtu Fakturoidu (2 faktury, 2 klienti) jsou v testech adaptéru.
- 👤 Po mergi: na Railway doplnit do služeb web i worker `FAKTUROID_CLIENT_ID`, `FAKTUROID_CLIENT_SECRET`, `INTEGRATIONS_CONTACT_EMAIL` (`docs/deploy.md`), pak v aplikaci Nastavení → Propojení → „Propojit“.
- Otevřené body: zkouška skutečného připojení, lokální vývoj, výběr účtu v provozu, obrazovka Faktury, obnovování stavu, odvolání při výpadku, `QUEUE_PREFIX` (viz sekce výše).
- Další krok: 2.7 Obrazovka Faktury a karta na Přehledu

## 2026-10-11 — krok 2.5 Synchronizace faktur

- Hotovo: datová vrstva `packages/db/src/invoices.ts` (upsert firem, faktur s položkami a plateb, označení smazaných, čtení); logika synchronizace `packages/integrations/src/sync/invoice-sync.ts` nezávislá na poskytovateli; úlohy workeru `sync.invoices` (jedno připojení) a `sync.dispatch-invoices` (zařadí synchronizaci pro každé fakturační připojení); výběr adaptéru podle připojení (`apps/worker/src/providers.ts`); nové rozvrhy; worker čte `ENCRYPTION_KEY` a volitelně nastavení Fakturoidu.
- Rozhodnutí:
  - Dotazování místo webhooků (schváleno uživatelem). Rozvrh jsem proti schválenému návrhu (15 minut, noční porovnání) zpomalil na hodinový přírůstek mezi 6:00 a 20:00 a týdenní úplné porovnání, protože účet ve Fakturoidu má jen 1 500 požadavků měsíčně; uživatel o změně ví.
  - Přírůstek se ptá jen na změny od posledního běhu (s pětiminutovým přesahem) a klienty načítá jen tehdy, když faktura odkazuje na neznámého. Když se nic nezměnilo, stojí běh jeden požadavek.
  - První synchronizace připojení je vždy úplná: klienti a faktury vytvořené za posledních 12 měsíců.
  - Smazání: úplné porovnání vezme faktury, které máme z posledních 12 měsíců a zdroj je už nevypsal, a na každou se zeptá jednotlivě. Smazanou označí `deleted_at` až po odpovědi „neexistuje“; fakturu, která jen vypadla z výpisu, nechá být. Když se faktura u zdroje znovu objeví, obnoví se.
  - Platby se berou z faktury (typ `Invoice` má nově `payments`), aby nebyl potřeba druhý dotaz; seznam u faktury je úplný, takže chybějící platba se označí jako smazaná. `ListOptions` má nově `createdSince`.
  - Nezměněné záznamy se poznají podle otisku (`raw_hash`) a nepřepisují se. Kurzor posledního běhu se uloží až po úspěšném dokončení; nedokončený běh se zopakuje od stejného místa a nic nezdvojí.
  - Stav připojení: start → `syncing`; úspěch → `connected`; 401 nebo odmítnutý refresh token → `reauth_required` (úloha se neopakuje); limit a výpadek → `degraded` (úloha se odloží nebo zopakuje); zablokovaný účet, chybějící oprávnění a odpověď mimo dokumentaci → `error`. Synchronizace označená jako běžící déle než 30 minut se bere jako přerušená a další běh ji převezme.
  - Přístupový token se obnoví, když vyprší do 5 minut; refresh token, který poskytovatel nevrátil znovu, zůstává původní. Tokeny se dešifrují jen v paměti.
  - Limit poskytovatele hlídá omezovač z kroku 2.2 před každým dotazem; klíčem je účet u poskytovatele (slug Fakturoidu).
  - Každá dokončená synchronizace zapíše do audit logu `invoices.synced` s počty (bez částek a jmen); změny stavu připojení audituje `applyConnectionEvent`.
  - Plánovač umí úlohy s daty (`JobSchedule` nese název úlohy, pravidla opakování a data).
  - Testovací pomůcky pro založení organizace jsou dostupné i ostatním balíčkům přes `@bystro/db/testing`.
- Bez migrace a bez HTTP cest.
- Testy: 9 integračních testů synchronizace proti Postgresu (první načtení, dvojí spuštění bez duplicit, smazání a obnovení, faktura mimo výpis, přírůstek se změnou položek a plateb, klienti jen při potřebě, výpadek uprostřed, oddělení organizací se stejnými externími ID, odmítnutí cizího připojení); 12 testů úlohy workeru (úspěch a audit, opakování, obnovení tokenu, odmítnutý refresh, 401, limit poskytovatele, vlastní omezovač, výpadek, vadná odpověď, neočekávaná chyba, souběh a přerušený běh, nenastavený poskytovatel, odpojené připojení); test rozdělovače; testy prostředí workeru a rozvrhů.
- Ověřeno ručně: zabalený worker s místním nastavením nastartoval (`fakturoidConfigured: true`) a založil tři rozvrhy; skutečný Fakturoid uživatele odpovídá podle dokumentace, účet je ale prázdný.
- Otevřené body: měsíční limit, smazání až za týden, spuštění po připojení, platby mimo fakturu, zkouška od začátku do konce, údaje v chatu, proměnné na Railway (viz sekce výše).
- Další krok: 2.6 Obrazovka Propojení

## 2026-10-11 — logo Fakturoidu u propojení (mimo plán, na přání uživatele)

- Hotovo: dlaždice Fakturoidu v onboardingu a v Nastavení → Propojení ukazuje oficiální logo (`apps/web/src/assets/fakturoid-logo.svg`, vodorovná varianta, beze změn) místo písmene.
- Rozhodnutí podle pravidel na https://www.fakturoid.cz/logo (čteno 2026-10-11): značka se nesmí použít bez nápisu a vodorovné logo má mít aspoň 30 px, proto je dlaždice široká dva sloupce (logo vychází kolem 39 px na výšku) a není zprůhledněná jako ostatní; ochranný prostor je součástí souboru. Pravidla pro cizí aplikace vyžadují, aby bylo zřejmé, že Fakturoid je samostatná placená služba provozovaná Fakturoid s.r.o. a že doplněk je náš, proto je pod dlaždicemi věta „Fakturoid je samostatná placená služba, kterou provozuje Fakturoid s.r.o. Propojení s ní vyvíjí Bystro.“
- Ostatní poskytovatelé mají dál písmenné dlaždice; jejich loga přidávat jen po přečtení jejich pravidel.
- Stažený balík log (`RGB (obrazovky _ digital)`) zůstává na disku mimo repozitář.

## 2026-10-11 — krok 2.4 Adapter Fakturoid

- Hotovo: `packages/integrations/src/fakturoid/`: HTTP klient (`client.ts`) a `FakturoidProvider` implementující `InvoiceProvider` (`fakturoid.ts`), mapování faktur, položek, plateb a subjektů na doménové typy, `listFakturoidAccounts` (výběr účtu po připojení), OAuth konfigurace pro helper z kroku 2.1, konstanta limitu pro omezovač; v `packages/core` přesný převod textových částek na haléře (`parseMoneyToMinor`, `parseScaledDecimal`) a společné chyby poskytovatelů (`ProviderError`). Skript `record:fakturoid` na nahrání anonymizovaných odpovědí z testovacího účtu.
- Ověřeno v dokumentaci Fakturoid API v3 (2026-10-11; odkazy v komentářích u klienta): základ `https://app.fakturoid.cz/api/v3`, povinný `User-Agent: Název (e-mail)`, stránky po 40, limit v hlavičkách `X-RateLimit-Policy` / `X-RateLimit` (příklad 400 za 60 s), 429 při překročení, 402 = zablokovaný účet, 503 = údržba; OAuth Authorization Code s Basic autentizací, bez zmínky o scopes a PKCE, token 2 hodiny, refresh token bez expirace, odvolání přes `/oauth/revoke`; účty z `GET /user.json`; platby jen uvnitř faktur; částky jako text; PDF vrací 204, dokud se generuje.
- Rozhodnutí (schváleno uživatelem):
  - Druhy dokladů: `invoice` a `final_invoice` → faktura, `proforma` a `partial_proforma` → zálohová, `correction` → opravný doklad; `tax_document` (daňový doklad k platbě) se přeskakuje i s platbami.
  - Stavy: `open`, `sent`, `overdue` → otevřená, `paid` → zaplacená, `cancelled` a `uncollectible` (nedobytná) → stornovaná.
  - Neznámý druh nebo stav a cokoli, co neodpovídá dokumentaci, je chyba `invalid_response`; adaptér nehádá.
  - DPH celkem = celkem − základ (odpověď ho nemá). Variabilní symbol, který není 1–10 číslic, a neplatný kód země se uloží jako prázdný.
  - Chyby: 401 → `reauth_required`, 402 → `account_blocked`, 403 → `forbidden`, 429 → `rate_limited` s čekáním z hlavičky `X-RateLimit` (jinak `Retry-After`, jinak 60 s), 5xx a síť → `provider_unavailable`, ostatní 4xx a nečitelná odpověď → `invalid_response`. Chyba nikdy neobsahuje token ani obsah odpovědi.
  - Slug účtu a ID faktury se před vložením do adresy ověřují, aby nešlo změnit cestu.
  - Kontakt v `User-Agent` je v proměnné `INTEGRATIONS_CONTACT_EMAIL` (adresu dodal uživatel), ne v kódu.
- Fixtures: příklady odpovědí zkopírované z dokumentace (faktura, subjekt, uživatel, platba); varianty v testech jsou z nich odvozené. Nahrané odpovědi z testovacího účtu zatím nejsou.
- Testy: 27 testů adaptéru (přesné mapování příkladů z dokumentace, všechny stavy a druhy dokladů, opravný doklad se zápornou částkou, cizí měna, položky bez ID, odmítnutí odpovědí mimo dokumentaci, stránkování a `updated_since`, platby z faktur, 404 u detailu, PDF po 204 i trvalé 204, všechny chybové stavy, token ani odpověď v chybě, `User-Agent`, OAuth konfigurace) a 7 testů převodu částek a chyb v `core`.
- Otevřené body: nahrané odpovědi, kódování Basic, návratová adresa pro lokální vývoj, platby přes `updated_since`, přijaté faktury, `INTEGRATIONS_CONTACT_EMAIL` na Railway (viz sekce výše).
- Další krok: 2.5 Synchronizace faktur

## 2026-10-11 — krok 2.3 Doménový model faktur

- Hotovo: `packages/core/src/invoices.ts`: typy `Client`, `Invoice`, `InvoiceLine`, `InvoicePayment`, `InvoiceDocument`, rozhraní `InvoiceProvider` (`listInvoices`, `getInvoice`, `listClients`, `listPayments`, `getDocument`; seznamy stránkované kurzorem s volbou „změněno od“), čisté funkce `invoiceStatus` a `todayInPrague`. Migrace `0002_invoices` s tabulkami `companies`, `contacts`, `invoices`, `invoice_lines`, `invoice_payments`.
- Rozhodnutí (schváleno uživatelem, bez ADR):
  - Model je obecný; konkrétní pole Fakturoidu a iDokladu namapují adaptéry v krocích 2.4 a 2.8 podle dokumentace.
  - Stavy faktury: `paid`, `overdue`, `due_soon`, `open` podle plánu a navíc `draft` a `cancelled`, které se nepočítají nikam. Brzy splatná = do 7 dní včetně. Den splatnosti ještě není po splatnosti. Den se určuje v pražském čase.
  - Zaplacená je faktura, kterou tak označí fakturační systém, nebo když platby v její měně dají přesně celou částku či víc. Částečná platba stav nemění, jen sníží zbývající částku. Platby v jiné měně se nezapočítají.
  - Model rozlišuje druh (faktura, zálohová faktura, opravný doklad) a směr (vydaná, přijatá). Opravný doklad může mít zápornou částku a nikdy není po splatnosti.
  - Částky `bigint` v haléřích (v TypeScriptu `bigint`, i nad 2^53), data splatnosti `date` bez času, množství v tisícinách, sazba DPH v bazických bodech.
  - Každá tabulka má standardní pole externích dat (`organization_id`, `connection_id`, `source`, `external_id`, `source_updated_at`, `synced_at`, `deleted_at`, `raw_hash`) a unikátní klíč `(organization_id, source, external_id)`; položky faktur bez vlastního ID u zdroje dostanou `<id faktury>#<pořadí>`.
  - Odkazy mezi tabulkami jsou složené cizí klíče včetně `organization_id` (nový unikátní klíč `(organization_id, id)` i na `integration_connections`), takže databáze sama odmítne propojit data dvou organizací.
  - Neukládá se surová odpověď poskytovatele (jen otisk) ani poznámky na fakturách.
  - Migraci vygeneroval drizzle-kit; přidání unikátního klíče na `integration_connections` jsem v ní ručně přesunul na začátek, protože ho cizí klíče nových tabulek potřebují dřív.
- Testy: 16 testů stavu faktury (půlnoc v Praze v létě i v zimě, přechod času, den splatnosti, hranice 7 dní, konec měsíce a roku, částečná a přesná platba i přeplatek, cizí měna, koncept, storno, opravný doklad, záloha, neplatná data) a integrační testy tabulek (přesné částky nad 2^53, unikátní klíč, stejné `external_id` ve dvou organizacích, odmítnutí propojení dat dvou organizací, kontroly měny, znaménka částky, variabilního symbolu, sazby DPH a země); test veřejného API ověřuje, že nové tabulky nejsou exportované.
- Otevřené body: cizí měny, přijaté faktury, datová vrstva, data po odpojení (viz sekce výše); stále čeká odpověď, zda u úklidu `oauth_requests` stačí log.
- Další krok: 2.4 Adapter Fakturoid

## 2026-10-08 — krok 2.2 Worker a fronta úloh

- Hotovo: BullMQ 6 ve workeru s frontami `sync`, `actions`, `scheduled` a `dead-letter`; kontrakty úloh v `packages/core/src/jobs.ts` (názvy front, schémata dat, pravidla opakování, `buildJobId`, rozvrhy, rozhodování omezovače, kód chyby); registr handlerů a zpracování v `apps/worker/src/processing.ts`; omezovač počtu volání v `rate-limiter.ts`; plánovač opakovaných úloh v zóně Europe/Prague; první skutečná úloha: noční úklid `oauth_requests` (`deleteExpiredOAuthRequests` v `packages/db`); worker při startu ověří `REDIS_URL` a `DATABASE_URL` a na SIGTERM nechá doběhnout rozdělané úlohy.
- Ověřeno v dokumentaci a v typech BullMQ 6.3.11: knihovna nemá dead-letter frontu, vestavěný limiter platí jen pro celou frontu (limit po skupinách je v placené verzi), úloha se stejným `jobId` se ignoruje jen dokud fronta tu původní drží, `jobId` nesmí obsahovat dvojtečku ani být jen z číslic.
- Rozhodnutí (bez ADR, v mezích daného stacku):
  - Data úloh obsahují jen identifikátory. Redis není šifrovaný, takže do něj nejdou tokeny, částky, e-maily ani texty z externích systémů. Data se validují při zařazení i při zpracování.
  - Opakování: výchozí 3 pokusy, čekání 5 s × 2ⁿ s horní mezí 10 minut a rozptylem; výpočet je čistá funkce v `core`. `PermanentJobError` zbylé pokusy přeskočí.
  - Dead-letter: po posledním neúspěchu se do fronty `dead-letter` zapíše původní fronta, název, `jobId`, data, počet pokusů a strojový kód chyby. Text chyby se neukládá ani neloguje, může citovat externí data. Záznam má `jobId` odvozené od původní úlohy, takže vznikne jen jednou.
  - Neznámý název úlohy a neplatná data jdou do dead-letter hned, bez opakování. Handlery pro `sync` a `actions` zatím neexistují (kroky 2.5 a 5.2); žádné zástupné jsme nepřidali.
  - Omezovač je vlastní počítadlo v Redisu (pevné okno, atomický skript), klíč poskytovatel nebo poskytovatel + připojení. Úloha, která narazí na limit, se odloží do konce okna a nepřijde o pokus.
  - Plánovač při každém startu srovná rozvrhy v Redisu se seznamem v kódu: založí nebo upraví uvedené a smaže ty, které v seznamu už nejsou.
  - Úklid maže žádosti vypršelé před více než 24 hodinami, denně ve 3:30.
  - Klíče front mají předponu `bystro`; testy používají náhodnou předponu a po sobě uklidí.
  - `pnpm`: instalační skript volitelného nativního doplňku `msgpackr-extract` (závislost BullMQ) je výslovně zakázaný; knihovna bez něj funguje.
- Testy: unit testy v `core` (čekání mezi pokusy, `jobId`, schémata, rozhodování omezovače, kód chyby) a ve workeru (prostředí, registr, úklid); integrační testy proti Redisu pokrývají podmínky kroku: úloha dvakrát selže a napotřetí doběhne, stejné `jobId` se nespustí dvakrát, po vyčerpání pokusů je v dead-letter právě jeden záznam; dále omezovač (včetně toho, že odložení nestojí pokus), plánovač (opakovaná registrace, zóna, mazání starých rozvrhů) a neznámé nebo neplatné úlohy. Integrační test úklidu proti Postgresu je v `packages/db`.
- CI: úloha `check` má nově službu Redis; kontrola obrazu workeru ověřuje připojení k Redisu, čisté ukončení a to, že bez nastavení worker nenastartuje.
- 👤 Před nasazením: službě `worker` na Railway doplnit `DATABASE_URL`, `REDIS_URL` a `ENCRYPTION_KEY` (viz `docs/deploy.md`, část 6). Bez prvních dvou worker po nasazení spadne.
- Otevřené body: zařazování úloh z webu, limity poskytovatelů, čtení dead-letter fronty, audit úklidu, více instancí, nastavení Redisu (viz sekce výše).
- Další krok: 2.3 Doménový model faktur

## 2026-10-08 — krok 2.1b Redesign podle prototypu v4

- Hotovo: prototyp v4 a logo v `docs/prototyp/` (starý `docs/prototyp.html` odstraněn); nové tokeny v `globals.css` (písmo Geist, černobílá paleta, nové rádiusy a stíny); logo „by/stro“ se značkou lomítka a ikona webu; tlačítko, pole a popisek v novém vzhledu; rozložení aplikace (šedé menu s firmou, ikonami a uživatelem, bílý list s obsahem, úzké menu 768–1000 px, spodní navigace na mobilu); přihlášení, registrace, zapomenuté a nové heslo a onboarding ve dvoupanelovém rozložení s náčrtem aplikace; Přehled, Asistent, Hlídač peněz, Faktury a Nastavení (karty Profil, Propojení, Upozornění) podle v4.
- Rozhodnutí: [ADR 0002 — Design tokeny podle prototypu v4](decisions/0002-design-tokens-v4.md), nahrazuje ADR 0001. Krok je vložený před 2.2 na přání uživatele. Dále (schváleno uživatelem):
  - Funkce se nemění: přihlášení zůstává heslem a přes Google, onboarding přes IČO a ARES ve třech krocích, menu má pět položek.
  - Přehled nemá ve v4 prázdný stav; drží hlavičku a rozložení v4 a každý panel říká, co chybí. Pole pro otázku asistentovi z Přehledu zmizelo (ve v4 tam není), zůstává na obrazovce Asistent.
  - Platí logo ze samostatných souborů (lomítko, „by/stro“), ne starší značka uvnitř prototypu.
  - Vynecháno z v4: „Rychlé akce ⌘K“, tlačítko „Vystavit fakturu“, karta Předplatné, štítek „Nové“ u Hlídače peněz, pole „Počet lidí ve firmě“, „Změnit fotku“.
  - Texty převzaté z v4 mluví v mužském rodě („Nic jsem nenašel“); původní prototyp mluvil v ženském. Držíme v4.
- Testy: unit testy navigace (skupiny menu, názvy rolí) a E2E upravené na nové texty a rozložení; nově ověřují údaje v menu, karty Nastavení a vypnuté otázky asistenta. Snímky všech obrazovek na šířce 1440, 900 a 390 px porovnané s v4.
- Bez změn databáze, API a workeru.
- Otevřené body: úkoly na Přehledu, ⌘K, profil jen ke čtení, Předplatné, e-mailová šablona (viz sekce výše).
- Další krok: 2.2 Worker a fronta úloh (plán schválen 2026-10-08)

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
