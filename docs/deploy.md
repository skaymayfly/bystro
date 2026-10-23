# Nasazení Bystra na Railway

Návod pro testovací prostředí. Počítá s tím, že kód je na GitHubu v repozitáři `skaymayfly/bystro` a větev `main` prošla CI.

Výsledkem jsou čtyři služby v jednom projektu: **web**, **worker**, **Postgres** a **Redis**.

> Názvy tlačítek a záložek v Railway se čas od času mění. Kde návod uvádí název položky v administraci, ber ho jako orientační; co se má nastavit, je vždy popsané i slovy.

## Co se při nasazení děje

- Railway sestaví obraz podle `apps/web/Dockerfile` (web) a `apps/worker/Dockerfile` (worker). Oba se sestavují z kořene repozitáře.
- Před spuštěním nové verze webu proběhnou migrace databáze příkazem `node migrate.cjs`. Jsou bezpečné při opakování i při souběhu.
- Railway pak volá `GET /api/health`. Novou verzi pustí do provozu, až když odpoví `200` (databáze i Redis jsou dostupné).
- Žádná tajná hodnota není v repozitáři ani v obrazu. Všechny se zadávají jako proměnné služby v Railway.

## 0. Než začneš: nové klíče

Vývojové klíče Resend a Google byly sdílené v chatu, proto je pro nasazení **nepoužívej**.

1. **Resend:** v sekci API Keys starý klíč smaž a vytvoř nový (oprávnění Sending access).
2. **Google:** v Google Cloud Console u OAuth klienta zvol reset tajného klíče (Client secret).
3. Nové hodnoty si nech otevřené v prohlížeči, zadáš je přímo do Railway (krok 4). Do lokálního `.env` si je doplň taky, jinak ti lokálně přestane fungovat Google přihlášení a odesílání e-mailů.

Vygeneruj dva nové tajné klíče pro toto prostředí (každý příkaz spusť zvlášť a výsledek si poznamenej):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- první použiješ jako `BETTER_AUTH_SECRET`,
- druhý jako `ENCRYPTION_KEY`.

`ENCRYPTION_KEY` si bezpečně ulož (správce hesel). Jeho ztráta znamená ztrátu všech zašifrovaných tokenů integrací.

## 1. Účet a projekt

1. Zaregistruj se na https://railway.com (zkušební období: kredit 5 $ na 30 dní, bez karty; potom plán Hobby za 5 $ měsíčně).
2. Vytvoř nový prázdný projekt a pojmenuj ho `bystro`.

## 2. Databáze a Redis

1. V projektu přidej službu **PostgreSQL** (z nabídky databází). Nech jí název `Postgres`.
2. Přidej službu **Redis**. Nech jí název `Redis`.

Na názvech záleží: proměnné webu se na ně odkazují jako `${{Postgres.DATABASE_URL}}` a `${{Redis.REDIS_URL}}`. Pokud je pojmenuješ jinak, uprav odkazy v kroku 4.

## 3. Služba web

1. Přidej službu z GitHub repozitáře `skaymayfly/bystro`, větev `main`. Pojmenuj ji `web`.
2. Kořenový adresář služby nech na kořeni repozitáře (nenastavuj `apps/web`), jinak sestavení nenajde sdílené balíčky.
3. V nastavení služby zadej:
   - **Příkaz před nasazením (Pre-deploy command):** `node migrate.cjs`
   - **Cesta health checku (Healthcheck path):** `/api/health`
4. V síťovém nastavení služby vygeneruj veřejnou doménu a jako cílový port zadej **3000**. Stejné číslo nastavíš v kroku 4 proměnnou `PORT`; obě hodnoty musí být shodné.

Tyto hodnoty jsou zapsané i v `apps/web/railway.json`. Pokud Railway u služby nabízí cestu ke konfiguračnímu souboru, můžeš místo ručního zadání nastavit `apps/web/railway.json`.

## 4. Proměnné služby web

Zadej je v záložce proměnných služby `web`. Hodnoty označené jako tajné ulož jako zapečetěné (sealed), pokud to Railway nabízí.

| Proměnná                     | Hodnota                                         | Poznámka                                                          |
| ---------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `RAILWAY_DOCKERFILE_PATH`    | `apps/web/Dockerfile`                           | říká Railway, který Dockerfile použít                             |
| `PORT`                       | `3000`                                          | port, na kterém web poslouchá; musí sedět s cílovým portem domény |
| `DATABASE_URL`               | `${{Postgres.DATABASE_URL}}`                    | odkaz na službu Postgres                                          |
| `REDIS_URL`                  | `${{Redis.REDIS_URL}}`                          | odkaz na službu Redis                                             |
| `BETTER_AUTH_SECRET`         | první vygenerovaný klíč                         | **tajné**                                                         |
| `BETTER_AUTH_URL`            | `https://${{RAILWAY_PUBLIC_DOMAIN}}`            | veřejná adresa webu; musí sedět s adresou v prohlížeči            |
| `ENCRYPTION_KEY`             | druhý vygenerovaný klíč                         | **tajné**; šifruje tokeny propojení, stejný musí mít i worker     |
| `FAKTUROID_CLIENT_ID`        | Client ID integrace ve Fakturoidu               | nepovinné; bez něj je Fakturoid v aplikaci „Připravujeme“         |
| `FAKTUROID_CLIENT_SECRET`    | Client Secret integrace                         | **tajné**; nepovinné                                              |
| `INTEGRATIONS_CONTACT_EMAIL` | kontaktní e-mail                                | jde do hlavičky `User-Agent`, kterou Fakturoid vyžaduje           |
| `IDOKLAD_CLIENT_ID`          | Client Id aplikace z Developer portálu iDokladu | nepovinné; bez něj je iDoklad v aplikaci „Připravujeme“           |
| `IDOKLAD_CLIENT_SECRET`      | Client secret aplikace                          | **tajné**; nepovinné                                              |
| `GMAIL_CLIENT_ID`            | Client ID OAuth klienta z Google Cloud Console  | nepovinné; bez něj je Gmail v aplikaci „Připravujeme“             |
| `GMAIL_CLIENT_SECRET`        | Client secret téhož klienta                     | **tajné**; nepovinné                                              |
| `RESEND_API_KEY`             | nový klíč z Resendu                             | **tajné**                                                         |
| `EMAIL_FROM`                 | `Bystro <onboarding@resend.dev>`                | zkušební odesílatel; doručí jen na e-mail tvého účtu u Resendu    |
| `GOOGLE_CLIENT_ID`           | Client ID z Google Cloud Console                |                                                                   |
| `GOOGLE_CLIENT_SECRET`       | nový Client secret                              | **tajné**                                                         |
| `SENTRY_DSN`                 | DSN ze Sentry                                   | stejná hodnota jako v lokálním `.env`                             |
| `NEXT_PUBLIC_SENTRY_DSN`     | stejné DSN                                      | použije se při sestavení pro hlášení chyb z prohlížeče            |
| `SENTRY_ENVIRONMENT`         | `staging`                                       | aby šly chyby z testovacího prostředí odlišit                     |

Nepovinné, pro čitelné chyby v Sentry (nahrání zdrojových map): `SENTRY_AUTH_TOKEN` (**tajné**), `SENTRY_ORG`, `SENTRY_PROJECT`. Bez nich nasazení funguje stejně, jen chyby z produkčního sestavení mají hůř čitelný výpis.

`PORT=3000` je potřeba zadat výslovně. Railway jinak aplikaci přidělí vlastní port: health check projde, ale veřejná doména mířící na 3000 vrací `502 Application failed to respond`.

`NODE_ENV` nenastavuj, `NODE_ENV=production` je v obrazu.

## 5. Google: návratová adresa

V Google Cloud Console u OAuth klienta přidej do povolených návratových adres (Authorized redirect URIs):

```
https://<veřejná doména webu>/api/auth/callback/google
```

Adresu pro `localhost` tam nech, ať funguje i lokální vývoj.

### Fakturoid

1. Ve Fakturoidu založ integraci: **Nastavení → Napojení na jiné aplikace → OAuth 2 pro tvůrce aplikací**.
2. Jako adresu pro přesměrování zadej přesně `https://<veřejná doména webu>/api/integrations/fakturoid/callback`. Fakturoid nedovolí `localhost`.
3. Client ID a Client Secret zadej do proměnných služby **web** i **worker** spolu s `INTEGRATIONS_CONTACT_EMAIL`. Na obou službách musí být stejné hodnoty.
4. Po nasazení je v aplikaci v Nastavení → Propojení u Fakturoidu tlačítko „Propojit“.

### Gmail (sekce Pošta)

Gmail používá oprávnění `gmail.modify` (čtení, archivace a posílání pošty). Do ověření aplikace u Googlu (krok 8.3) běží v testovacím režimu: funguje jen pro účty na seznamu testovacích uživatelů a přístup vyprší po 7 dnech (pak stačí Gmail znovu připojit). Viz ADR 0004.

Postup v [Google Cloud Console](https://console.cloud.google.com/), ve stejném projektu jako přihlášení přes Google (názvy položek se u Googlu občas mění):

1. **APIs & Services → Library**: vyhledej **Gmail API** a dej **Enable**.
2. **Google Auth Platform → Data access → Add or remove scopes**: přidej `https://www.googleapis.com/auth/gmail.modify` (ručně do pole „Manually add scopes“) a ulož.
3. **Google Auth Platform → Audience → Test users**: přidej svůj e-mail (a e-maily dalších testerů).
4. **Google Auth Platform → Clients**: otevři webového klienta (nebo vytvoř nový typu „Web application“) a do **Authorized redirect URIs** přidej:
   - `https://<veřejná doména webu>/api/integrations/gmail/callback`
   - `http://localhost:3000/api/integrations/gmail/callback` (lokální vývoj)
5. Client ID a Client secret zadej jako `GMAIL_CLIENT_ID` a `GMAIL_CLIENT_SECRET` do služby **web** i **worker** (worker je bude potřebovat od kroku 5.4) a do lokálního `.env`.
6. Po nasazení je v menu **Pošta** s tlačítkem „Propojit e-mail“. Google ukáže varování, že aplikace není ověřená; v testovacím režimu je to v pořádku (pokračuj přes „Pokračovat“).

### iDoklad

1. Zaregistruj se na Developer portálu iDokladu: <https://developer.idoklad.cz>. Účet na portálu je něco jiného než účet v iDokladu, i když mají stejný e-mail.
2. V **Nová aplikace** zadej jméno `Bystro`, Flow **AuthorizationCode** a ulož. (Flow `ClientCredentials` je jen pro práci s jedním vlastním účtem; pro zákazníky Bystra nestačí.)
3. V seznamu aplikací je ve sloupci **Client Id** první hodnota. Po kliknutí na **Podrobnosti** je v záložce **Client secret** druhá hodnota; novou vytvoříš přes „Nový client secret“, starou smažeš přes „Smazat“.
4. V záložce **Redirect uri** přidej přesně `https://<veřejná doména webu>/api/integrations/idoklad/callback`.
5. `IDOKLAD_CLIENT_ID` a `IDOKLAD_CLIENT_SECRET` zadej do proměnných služby **web** i **worker**. Na obou službách musí být stejné hodnoty.
6. Po nasazení je v Nastavení → Propojení dlaždice iDokladu s tlačítkem „Propojit“.

iDoklad povoluje API jen na některých tarifech (dokumentace uvádí měsíční limity pro tarify Oblíbený a Prémiový). Účtu s nedostatečným tarifem API odpovídá `402`; Bystro pak při připojování napíše, že tarif nestačí, a nic neuloží.

## 6. Služba worker

1. Přidej druhou službu ze stejného repozitáře a větve. Pojmenuj ji `worker`.
2. Kořenový adresář opět nech na kořeni repozitáře.
3. Veřejnou doménu negeneruj; worker nepřijímá požadavky z internetu.
4. Proměnné:

| Proměnná                     | Hodnota                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `RAILWAY_DOCKERFILE_PATH`    | `apps/worker/Dockerfile`                                                   |
| `DATABASE_URL`               | `${{Postgres.DATABASE_URL}}`                                               |
| `REDIS_URL`                  | `${{Redis.REDIS_URL}}`                                                     |
| `ENCRYPTION_KEY`             | stejná hodnota jako u webu; **tajné**, povinné                             |
| `FAKTUROID_CLIENT_ID`        | Client ID integrace ve Fakturoidu; nepovinné                               |
| `FAKTUROID_CLIENT_SECRET`    | Client Secret integrace; **tajné**, nepovinné                              |
| `INTEGRATIONS_CONTACT_EMAIL` | kontaktní e-mail, který Fakturoid uvidí v hlavičce `User-Agent`; nepovinné |
| `IDOKLAD_CLIENT_ID`          | Client Id aplikace z Developer portálu iDokladu; nepovinné                 |
| `IDOKLAD_CLIENT_SECRET`      | Client secret aplikace; **tajné**, nepovinné                               |
| `GMAIL_CLIENT_ID`            | Client ID OAuth klienta pro Gmail; nepovinné (potřeba od kroku 5.4)        |
| `GMAIL_CLIENT_SECRET`        | Client secret téhož klienta; **tajné**, nepovinné                          |
| `SENTRY_DSN`                 | DSN ze Sentry                                                              |
| `SENTRY_ENVIRONMENT`         | `staging`                                                                  |
| `WORKER_CONCURRENCY`         | nepovinné; kolik úloh jedné fronty běží najednou (výchozí 5)               |

Bez `DATABASE_URL`, `REDIS_URL` a `ENCRYPTION_KEY` worker nenastartuje a nasazení skončí chybou. `ENCRYPTION_KEY` musí být stejný jako u webu, jinak worker tokeny propojení nerozšifruje.

Tři hodnoty pro Fakturoid nastav buď všechny, nebo žádnou; neúplné nastavení worker při startu odmítne. Bez nich worker běží, jen synchronizace Fakturoidu skončí chybou `provider_not_configured`. V logu při startu je vidět `fakturoidConfigured: true` nebo `false`.

Worker si při startu sám založí opakované úlohy v našem čase: noční úklid vypršelých žádostí o propojení (3:30), synchronizaci faktur každou hodinu mezi 6:00 a 20:00 a úplné porovnání faktur v neděli ve 2:30. Fronty žijí v Redisu pod předponou `bystro`.

## 7. Kontrola po nasazení

1. Obě služby mají poslední nasazení ve stavu úspěšně dokončeno.
2. `https://<doména>/api/health` vrátí `{"status":"ok","database":"ok","redis":"ok","worker":"ok"}`. Když je `worker` `down`, služba worker neběží (nebo nemá stejný Redis): web funguje, ale nic se nesynchronizuje. Podívej se do logu služby worker.
3. V logu služby `worker` je řádek `Bystro worker: ready`.
4. V logu nasazení webu je před startem řádek `Migrations applied.`
5. Ruční průchod: registrace → zadání IČO → založení firmy → Přehled. Pak odhlášení a přihlášení, případně přes Google.
6. Reset hesla: e-mail dorazí jen na adresu, kterou máš registrovanou u Resendu (omezení zkušebního odesílatele).

## Když něco nefunguje

- **Nasazení je úspěšné, ale adresa vrací `502 Application failed to respond`:** doména míří na jiný port, než na kterém aplikace poslouchá. V logu běžící aplikace najdi řádek `Local: http://localhost:<port>` a porovnej ho s cílovým portem domény. Oprava: proměnná `PORT=3000` u služby `web` (viz krok 4), nebo změna cílového portu domény.
- **Health check vrací 503:** odpověď říká, která část je `down`. Zkontroluj odkazy `${{Postgres.DATABASE_URL}}` a `${{Redis.REDIS_URL}}` a názvy služeb.
- **Přihlášení vrací chybu nebo se točí dokola:** `BETTER_AUTH_URL` nesedí s adresou v prohlížeči (včetně `https://`).
- **Google hlásí neplatnou návratovou adresu:** chybí krok 5, nebo se doména změnila.
- **Sestavení nenajde balíčky `@bystro/*`:** služba má nastavený kořenový adresář na podsložku; vrať ho na kořen repozitáře.
- **Nasazení skončí na migracích:** v logu je řádek `Migration failed: …`. Aplikace se v tom případě nespustí a běží dál předchozí verze.

## Další nasazení

Každý merge do `main` spustí nové sestavení obou služeb. Migrace proběhnou samy před startem nové verze.

Návrat k předchozí verzi: v Railway u služby zvol dřívější úspěšné nasazení a nasaď ho znovu. Pozor: migrace se zpět nevracejí. Pokud nová verze změnila schéma databáze, starší kód s ním musí umět pracovat, jinak je potřeba opravná migrace.

## Co tento návod neřeší

- Vlastní doménu a ověření domény v Resendu (před betou, fáze 7).
- Zálohy databáze a zkoušku obnovy (krok 7.3).
- Ostré produkční prostředí oddělené od testovacího (fáze 9).
