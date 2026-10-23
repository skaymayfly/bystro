# 0003 — Paleta podle libraries.dev a tmavý režim

Datum: 2026-10-23
Stav: přijato

Nahrazuje barvy, stíny a tvar tlačítek z [0002 — Design tokeny podle prototypu v4](0002-design-tokens-v4.md). Písmo, rozložení obrazovek, logo a odchylky od prototypu v4 platí z ADR 0002 dál.

## Kontext

Uživatel dodal podklad `docs/prototyp/paleta-libraries-dev.html` („Bystro paleta z libraries.dev“): barvy vytažené z CSS webu libraries.dev, jejich mapování na role v Bystru a tokeny pro světlý i tmavý režim. Zadání uživatele (2026-10-23): změnit podle něj celý branding, přidat tmavý režim, hlavní tlačítka modrá, mono písmo na popisky a inspirovat se i samotným webem libraries.dev. Zároveň odebrat maskota Bystrouše.

## Rozhodnutí

Barvy jsou proměnné `--bz-*` v `apps/web/src/app/globals.css`; Tailwind (`@theme`) i role shadcn/ui se na ně jen odkazují. Přepnutím proměnných se přebarví celá aplikace.

### Barvy

| Role                                 | Světlý režim          | Tmavý režim            | Třída                        |
| ------------------------------------ | --------------------- | ---------------------- | ---------------------------- |
| Pozadí stránky                       | `#FDFDFD`             | `#121212`              | `bg-background`              |
| Karta, list s obsahem                | `#FFFFFF`             | `#181818`              | `bg-card`                    |
| Postranní menu, jemné pozadí         | `#F9F9F9`             | `#131313`              | `bg-chrome`, `bg-subtle`     |
| Šedý chip, dlaždice, lišta přepínače | `#F4F4F4`             | bílá 7 %               | `bg-chip`, `bg-muted`        |
| Chip pod kurzorem / stisknutý        | `#F1F1F1` / `#EAE9E9` | bílá 10 % / 8 %        | `bg-fill`, `bg-chip-pressed` |
| Vybraný segment přepínače            | `#FFFFFF`             | `#2A2A2A`              | `bg-pill`                    |
| Hlavní text, logo                    | `#0D0D0D`             | `#FFFFFF`              | `text-ink`                   |
| Doprovodný text                      | `#3A3A3A`             | `#DEDEDE`              | `text-ink-2`                 |
| Potlačený text                       | `#6C6C6C`             | `rgba(202,202,202,.7)` | `text-ink-3`                 |
| Nejslabší text, lomítko v logu       | `#8F8F8F`             | `#8F8F8F`              | `text-ink-4`                 |
| Text na ploše hlavní barvy (avatar)  | `#FFFFFF`             | `#0D0D0D`              | `text-on-ink`                |
| Mono popisek                         | `#5E6073`             | `#8A8CA0`              | `label-mono`                 |
| Okraj karty                          | černá 6 %             | bílá 8 %               | `border-line`                |
| Oddělovač                            | `#EEEEEE`             | bílá 8 %               | `border-line-soft`           |
| Okraj pole                           | černá 10 %            | bílá 12 %              | `border-line-strong`         |
| Akcent: odkazy, aktivní položka menu | `#0073E5`             | `#55CFFF`              | `text-link`                  |
| Hlavní tlačítko                      | `#006FF5`             | `#006FF5`              | `bg-cta`                     |

- **Hlavní tlačítko:** podklad má `#0071FC`. Bílý text na něm má kontrast 4,40 : 1, pod hranicí WCAG AA (4,5 : 1) pro text této velikosti. Proto `#006FF5` (4,57 : 1), okem k nerozeznání. Pod kurzorem `#0062D6`.
- **Barvy stavů** (zaplaceno, po splatnosti, varování) zůstávají z Bystra, jak podklad doporučuje: nesou význam a nemají se plést s akcentem. V tmavém režimu jsou zesvětlené (např. červená `#F87171`, zelená `#4ADE80`, jantarová `#FBBF24`) a jejich podklady jsou průsvitné.
- Kontrast hlavních dvojic (text, potlačený text, akcent a stavy na pozadí i na kartě, text tlačítka) hlídá test `apps/web/src/lib/theme.test.ts` v obou režimech.

### Tmavý režim

- Řídí se nastavením systému (`prefers-color-scheme`). V Nastavení → Profil → Vzhled jde zvolit Podle systému / Světlý / Tmavý. Volba je v `localStorage` prohlížeče (je to předvolba, ne data) a skript v `<head>` ji nastaví na `<html data-theme>` ještě před vykreslením, takže stránka neproblikne v druhém režimu.
- Tmavé hodnoty jsou v CSS dvakrát (podle systému a podle volby), protože CSS neumí spojit dotaz na médium se selektorem. Test hlídá, že jsou oba bloky stejné a že každá barva světlého režimu má tmavou dvojici.
- Dlaždice Fakturoidu má i v tmavém režimu bílé pozadí: pravidla pro jeho logo chtějí klidné světlé pozadí.
- Stránka poslední záchrany (`global-error.tsx`) má vlastní malou paletu, protože nemůže spoléhat na tokeny.

### Tvary, stíny a pohyb (inspirace webem libraries.dev)

- Tlačítka jsou pilulky (`rounded-full`; ve formulářích `rounded-pill`, 24 px). Hlavní modré, vedlejší šedý chip, obrysové s okrajem.
- Při stisku se tlačítko nepatrně zmenší (`scale(0.98)`), přechody mají křivku `cubic-bezier(0.22, 1, 0.36, 1)` z libraries.dev.
- Přepínače (filtry faktur, volby, vzhled) jsou segmentové: šedá lišta a vybraný segment jako vystouplá pilulka (`SEGMENTED_BAR`, `segmentClass` v `components/bits.tsx`).
- Stín karet `0 1px 3px rgba(0,0,0,.04)`; plovoucí prvky stín menu z libraries.dev. Fokus je modrý prstenec.
- Obrazovky aplikace se při přechodu jemně objeví (250 ms, posun 6 px). Uživatelé s omezením pohybu animace nedostanou.

### Písmo

- Text a nadpisy zůstávají v **Geist** (podklad ho doporučuje místo placeného Saans z libraries.dev).
- Nově **Roboto Mono** (váhy 400 a 500, `latin-ext`) pro drobné popisky: třída `label-mono` (11 px, velká písmena, prostrkání 0,08 em, barva mono popisku). Použitá na záhlaví sloupců tabulky faktur a na nadpisy skupin na obrazovce Asistent.

### Maskot

Maskot Bystrouš (krok 2.9, ADR 0002) je na přání uživatele odebraný celý: komponenta, styly, testy i podklady. Prázdné stavy mají zpátky ikony.

## Důsledky

- Barvy se v komponentách nezapisují přímo, jen přes třídy z tokenů. Výjimkou je bílé pozadí dlaždice Fakturoidu a stránka `global-error.tsx`.
- Nová obrazovka musí vypadat dobře v obou režimech; E2E test prochází všechny obrazovky aplikace i v tmavém režimu a dělá snímky.
- `pnpm build` stahuje dvě písma z Google Fonts (Geist a Roboto Mono).
