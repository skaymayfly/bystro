# 0005 — Rozložení podle Revolut Business a Stripe

Datum: 2026-10-23
Stav: přijato

Mění rozložení aplikace z [0002](0002-design-tokens-v4.md). Barvy, písmo, tvary a tmavý režim platí z [0003](0003-paleta-libraries-dev.md) beze změny.

## Kontext

Uživatel chce, aby aplikace víc připomínala Revolut Business (web) a Stripe Dashboard. Vzory jsou vytažené z Mobbinu a popsané v [`docs/design/ui-reference.md`](../design/ui-reference.md) i s odkazy. Od Revolutu a Stripe bereme rozložení a vzory, ne jejich barvy, ikony ani značku.

## Rozhodnutí

### Shell

- Celá aplikace stojí na šedé ploše (`bg-chrome`); obsah leží přímo na ní v bílých kartách. Bílý list se zaobleným rohem z ADR 0002 je pryč.
- Postranní menu 232 px (pod 1100 px jen ikony, 72 px): logo nahoře, položky výšky 40 px s ikonou 18 px, aktivní položka na šedém chipu s modrou ikonou. Nastavení je oddělené dole (Revolut), pod ním uživatel, role, e-mail a Odhlásit.
- Horní lišta (sticky, průsvitná): vlevo dnešní datum, vpravo firma jako pilulka s iniciálami tam, kde má Revolut přepínač firem. Přepínač zatím není, protože účet má jen jednu firmu (otevřený bod v `PROGRESS.md`).
- Mobil beze změny principu: horní lišta s logem a Odhlásit, spodní lišta se šesti položkami.

### Přehled

- Dva sloupce od 1024 px: hlavní sloupec a 340 px widgetů (Revolut „Widgets“). Na mobilu pod sebou.
- Hlavní karta jako zůstatková karta Revolutu: velké číslo „Po splatnosti“ (34 px, tabulkové číslice), pod ním počet a nejstarší, vpravo pilulka „Všechny faktury“, pod tím tabulka faktur po splatnosti (avatar, klient, číslo, stavový štítek, částka) a dole zdroj s časem aktualizace (pravidlo 9 z CLAUDE.md, styl Stripe „Updated 11:08“).
- Karta „Zůstatek na účtech dnes“ stejného tvaru, zatím s prázdným stavem banky.
- Widget „Dokonči nastavení“ s kruhovým ukazatelem (Revolut „Finish account setup“): Firma, Fakturace, Schránka, Banka. Krok ukazuje skutečný stav propojení; nedostupný krok má „Připravujeme“. Tlačítko vede na první krok, který jde udělat.
- Widgety „Odpovědět“ a „Dnešní schůzky“ beze změny obsahu.

### Komponenty

- `PageHeader`: 28 px, tučnost 600 (místo 34–46 px, 500).
- `Card` a `Panel`: rádius 16 px (`rounded-tile`), okraj a jemný stín, nadpis 15–16 px / 600.
- `StatusPill` jako štítek Stripe: měkké pozadí barvy stavu, bez okraje.
- `BigFigure` (velké číslo s popiskem a akcemi) v `components/invoices/overdue-panel.tsx`.
- Řádky tabulek: zaoblené zvýraznění pod kurzorem, částky tabulkovými číslicemi.

### Co z podkladu zatím není

Boční panel pro detail faktury, rychlé vytvoření „+“, hledání v horní liště a seskupené seznamy v Nastavení. Detail faktury zůstává samostatnou stránkou; ostatní by bez funkcí za nimi byly jen kulisa. Vrátit se k nim, až bude co vytvářet a hledat (fáze 5 a 6).

## Důsledky

- `NAV_ITEMS` mají skupiny `main` a `footer` místo `1` a `2`.
- E2E test hledá firmu v horní liště (`banner`), ne v postranním menu.
- Datum v horní liště formátuje server (Europe/Prague) a posílá ho do klientského shellu, aby se kolem půlnoci nelišilo vykreslení na serveru a v prohlížeči.
