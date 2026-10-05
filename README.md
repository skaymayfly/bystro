# Bystro

SaaS pro majitele malých českých firem: propojí fakturaci, banku, e-mail, kalendář a CRM, hlídá peníze a pomáhá věci rovnou vyřešit.

Pravidla a postup práce jsou v [CLAUDE.md](CLAUDE.md), plán v [docs/PLAN.md](docs/PLAN.md), deník v [docs/PROGRESS.md](docs/PROGRESS.md).

## Co potřebuješ

- Node.js 24 (viz `.nvmrc`)
- pnpm 12
- Git
- Docker Desktop (Postgres a Redis)

**Windows:** pnpm vytváří symbolické odkazy. Zapni Režim pro vývojáře (Nastavení → Aktualizace a zabezpečení → Pro vývojáře), jinak `pnpm install` skončí chybou „Přístup byl odepřen“.

## Spuštění lokálně

```
pnpm install
cp .env.example .env      # a doplň ENCRYPTION_KEY podle návodu v souboru
docker compose up -d
pnpm db:migrate
pnpm dev
```

- Web běží na http://localhost:3000.
- Worker zatím jen vypíše pozdrav a čeká; fronty přijdou v kroku 2.2.

## Příkazy

| Příkaz                 | Co dělá                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `pnpm dev`             | Spustí web i worker ve vývojovém režimu                     |
| `pnpm lint`            | ESLint ve všech balíčcích                                   |
| `pnpm typecheck`       | Kontrola typů (TypeScript strict)                           |
| `docker compose up -d` | Spustí Postgres a Redis                                     |
| `pnpm db:migrate`      | Aplikuje migrace na databázi z `DATABASE_URL`               |
| `pnpm db:generate`     | Vytvoří novou migraci ze schématu                           |
| `pnpm test`            | Unit a integrační testy (Vitest); potřebuje běžící Postgres |
| `pnpm build`           | Produkční build webu (`.next`) a workeru (`dist`)           |
| `pnpm format`          | Zformátuje kód Prettierem                                   |
| `pnpm format:check`    | Zkontroluje formátování bez zápisu                          |

## Struktura

```
apps/
  web/            Next.js: UI + tenké API route handlers
  worker/         Node worker: synchronizace, plánované úlohy, provádění akcí
packages/
  db/             Drizzle schéma, migrace, tenant-scoped přístup k datům, šifrování
  core/           Doménová logika bez I/O
  integrations/   Adaptery externích systémů za rozhraními Provider
  ai/             LlmProvider, nástroje, prompty, evaluace
  config/         Sdílený tsconfig, ESLint, Prettier
docs/             Plán, deník, zadání, prototyp, rozhodnutí
```

Interní balíčky se nesestavují zvlášť: exportují zdrojový TypeScript, web je překládá přes `transpilePackages` a worker je přibalí při buildu.
