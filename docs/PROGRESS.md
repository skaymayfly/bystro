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
- **Audit přihlášení a registrace:** `audit_logs` vyžaduje organizaci, takže události uživatele bez organizace se nezapisují. Rozhodnout v kroku 1.7 nebo 7.3, jestli je logovat jinam.
- **Přepínání mezi organizacemi:** aktivní je první organizace, ve které je uživatel členem. Až bude potřeba víc firem na účet, doplnit výběr.
- **Kontrola členství u nových API:** `getRequestContext()` vrací jen organizaci, ve které je uživatel členem. Každý nový route handler ji musí použít; automatické testy izolace endpointů jsou až v kroku 7.3.
- **Načítání `.env` ve workeru:** web čte kořenový `.env` přes `next.config.ts`; worker ho začne potřebovat v kroku 2.2.
- **Stahování Chromia pro Playwright** na vývojovém počítači vyprší (CDN je dostupná, stahovač Playwrightu ne). Lokálně se používá nainstalovaný Chrome přes `E2E_BROWSER_CHANNEL=chrome`; v CI (krok 1.7) ověřit běžnou instalaci.
- **Rozpor prototyp × plán — „Nahrát PDF faktury“:** prototyp má v prázdném stavu Faktur tlačítko pro nahrání PDF, žádný krok plánu ho neobsahuje. V aplikaci není; rozhodnout, jestli funkci doplnit do plánu.
- **Rozpor prototyp × plán — e-mail, kalendář a CRM:** prototyp je ukazuje na Přehledu a v Nastavení, podle plánu přijdou až ve fázi 8 a po spuštění. Zobrazují se neaktivní se štítkem „Připravujeme“.
- **Prvky „Připravujeme“:** tlačítka pro připojení, pole asistenta, přepínače období a volby v Nastavení jsou vypnuté. Zprovoznit je v krocích 2.6 (fakturace), 3.3 (banka), 4.5–4.6 (Hlídač peněz), 6.4 (asistent) a 6.6 (ranní přehled).
- **Úvodní věta Přehledu** je zatím pevný text pro stav bez propojení a bez oslovení jménem (prototyp oslovuje 5. pádem, který z jména spolehlivě neodvodíme). Skutečný ranní přehled je krok 6.6.
- **Mobilní zobrazení** není v prototypu; navržené je v ADR 0001 (horní lišta + spodní navigace). Ověřit s uživateli v betě.
- **Detail faktury** z prototypu zatím neexistuje (nemá prázdný stav); vznikne v kroku 2.7.
- **Izolace tenantů je na úrovni kódu, ne databáze:** firemní tabulky nejsou exportované z `@bystro/db` a aplikace mají ESLintem zakázaný `drizzle-orm`, `pg`, `.execute()` a `$client`. Lint jde vědomě obejít (`eslint-disable`), proto v kroku 7.3 zvážit Row Level Security jako druhou vrstvu.
- **Pozvánky dalších členů do organizace** nejsou v plánu rozepsané; role `admin` a `member` zatím nemá jak vzniknout přes UI.
- **Mazání uživatele a organizace:** cizí klíče z `memberships` a `audit_logs` nemažou kaskádově, takže smazání uživatele s členstvím selže. Vyřešit v kroku 7.4 (GDPR).
- **Adresa organizace je nepovinná** (ARES nemusí odpovědět); povinnost polí rozhodnout v kroku 1.6.
- **Migrace při nasazení (krok 1.8):** `runMigrations` hledá složku `packages/db/migrations` relativně ke zdrojovému souboru. Funguje přes `tsx` a ve Vitestu, ale ne po zabalení do bundlu; v kroku 1.8 je potřeba rozhodnout, jak se migrace pouští v produkci.
- **Rotace `ENCRYPTION_KEY`:** formát šifry má prefix verze (`v1`), ale postup rotace klíče zatím neexistuje. Vyřešit před ostrým provozem (nejpozději fáze 7).
- **Soubory `.DS_Store`** v kořeni a v `docs/` zůstávají na disku, jen jsou v `.gitignore`.

---

## Záznamy

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
