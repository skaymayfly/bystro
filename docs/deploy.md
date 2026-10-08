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

| Proměnná                  | Hodnota                              | Poznámka                                                          |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile`                | říká Railway, který Dockerfile použít                             |
| `PORT`                    | `3000`                               | port, na kterém web poslouchá; musí sedět s cílovým portem domény |
| `DATABASE_URL`            | `${{Postgres.DATABASE_URL}}`         | odkaz na službu Postgres                                          |
| `REDIS_URL`               | `${{Redis.REDIS_URL}}`               | odkaz na službu Redis                                             |
| `BETTER_AUTH_SECRET`      | první vygenerovaný klíč              | **tajné**                                                         |
| `BETTER_AUTH_URL`         | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | veřejná adresa webu; musí sedět s adresou v prohlížeči            |
| `ENCRYPTION_KEY`          | druhý vygenerovaný klíč              | **tajné**; zatím se nepoužívá, od fáze 2 šifruje tokeny           |
| `RESEND_API_KEY`          | nový klíč z Resendu                  | **tajné**                                                         |
| `EMAIL_FROM`              | `Bystro <onboarding@resend.dev>`     | zkušební odesílatel; doručí jen na e-mail tvého účtu u Resendu    |
| `GOOGLE_CLIENT_ID`        | Client ID z Google Cloud Console     |                                                                   |
| `GOOGLE_CLIENT_SECRET`    | nový Client secret                   | **tajné**                                                         |
| `SENTRY_DSN`              | DSN ze Sentry                        | stejná hodnota jako v lokálním `.env`                             |
| `NEXT_PUBLIC_SENTRY_DSN`  | stejné DSN                           | použije se při sestavení pro hlášení chyb z prohlížeče            |
| `SENTRY_ENVIRONMENT`      | `staging`                            | aby šly chyby z testovacího prostředí odlišit                     |

Nepovinné, pro čitelné chyby v Sentry (nahrání zdrojových map): `SENTRY_AUTH_TOKEN` (**tajné**), `SENTRY_ORG`, `SENTRY_PROJECT`. Bez nich nasazení funguje stejně, jen chyby z produkčního sestavení mají hůř čitelný výpis.

`PORT=3000` je potřeba zadat výslovně. Railway jinak aplikaci přidělí vlastní port: health check projde, ale veřejná doména mířící na 3000 vrací `502 Application failed to respond`.

`NODE_ENV` nenastavuj, `NODE_ENV=production` je v obrazu.

## 5. Google: návratová adresa

V Google Cloud Console u OAuth klienta přidej do povolených návratových adres (Authorized redirect URIs):

```
https://<veřejná doména webu>/api/auth/callback/google
```

Adresu pro `localhost` tam nech, ať funguje i lokální vývoj.

## 6. Služba worker

1. Přidej druhou službu ze stejného repozitáře a větve. Pojmenuj ji `worker`.
2. Kořenový adresář opět nech na kořeni repozitáře.
3. Veřejnou doménu negeneruj; worker nepřijímá požadavky z internetu.
4. Proměnné:

| Proměnná                  | Hodnota                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `RAILWAY_DOCKERFILE_PATH` | `apps/worker/Dockerfile`                                     |
| `DATABASE_URL`            | `${{Postgres.DATABASE_URL}}`                                 |
| `REDIS_URL`               | `${{Redis.REDIS_URL}}`                                       |
| `ENCRYPTION_KEY`          | stejná hodnota jako u webu; **tajné**                        |
| `SENTRY_DSN`              | DSN ze Sentry                                                |
| `SENTRY_ENVIRONMENT`      | `staging`                                                    |
| `WORKER_CONCURRENCY`      | nepovinné; kolik úloh jedné fronty běží najednou (výchozí 5) |

Bez `DATABASE_URL` a `REDIS_URL` worker nenastartuje a nasazení skončí chybou. `ENCRYPTION_KEY` začne worker číst, až bude synchronizovat data (krok 2.5); nastav ho už teď, ať se na něj nezapomene. Musí být stejný jako u webu, jinak worker tokeny nerozšifruje.

Worker si při startu sám založí opakované úlohy (zatím noční úklid vypršelých žádostí o propojení ve 3:30 našeho času). Fronty žijí v Redisu pod předponou `bystro`.

## 7. Kontrola po nasazení

1. Obě služby mají poslední nasazení ve stavu úspěšně dokončeno.
2. `https://<doména>/api/health` vrátí `{"status":"ok","database":"ok","redis":"ok"}`.
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
