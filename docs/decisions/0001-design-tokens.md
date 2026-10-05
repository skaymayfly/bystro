# 0001 — Design tokeny z prototypu

Datum: 2026-10-05
Stav: přijato

## Kontext

Vzhled aplikace určuje `docs/prototyp.html`. Prototyp má všechny hodnoty zapsané přímo ve stylech jednotlivých prvků (barvy jako hex, rozměry v pixelech) a nemá žádný společný slovník. Aby aplikace vypadala jednotně a vzhled šel měnit na jednom místě, potřebujeme z něj vytáhnout tokeny.

Možnosti byly:

1. opisovat hodnoty z prototypu do každé komponenty,
2. převzít výchozí vzhled shadcn/ui a prototyp jen napodobit,
3. zavést tokeny podle prototypu a komponenty shadcn/ui na ně přemapovat.

## Rozhodnutí

Volíme možnost 3. Tokeny žijí v `apps/web/src/app/globals.css` (Tailwind CSS 4, blok `@theme`), komponenty v `apps/web/src/components/ui` vycházejí ze shadcn/ui (styl `base-nova`, Base UI) a jsou upravené na tyto tokeny.

Hodnoty jsou vybrané podle četnosti v prototypu; ojedinělé odstíny (1–2 výskyty) jsme sloučili s nejbližším tokenem.

### Barvy

| Token                | Hodnota   | Použití                                                   |
| -------------------- | --------- | --------------------------------------------------------- |
| `background`         | `#F3F2EF` | pozadí stránky, neaktivní pilulky, sekundární tlačítko    |
| `card`               | `#FFFFFF` | karty, panely, aktivní položka menu                       |
| `muted`              | `#F7F6F3` | řádky a dlaždice uvnitř karet                             |
| `field`              | `#FAFAF8` | pozadí formulářových polí                                 |
| `ink` (`foreground`) | `#161514` | hlavní text, tmavé karty, tmavé tlačítko                  |
| `ink-2`              | `#55534E` | běžný doprovodný text, popisky polí                       |
| `ink-3`              | `#6B6964` | potlačený text (`muted-foreground`)                       |
| `ink-4`              | `#8A877F` | nejslabší text, placeholdery                              |
| `on-ink-muted`       | `#A8A49D` | doprovodný text na tmavém pozadí                          |
| `ink-line`           | `#2E2C29` | linky na tmavém pozadí                                    |
| `brand` (`primary`)  | `#C94A2C` | hlavní tlačítko, zvýraznění v textu, aktivní tečka v menu |
| `brand-strong`       | `#9E3820` | text na světle červeném pozadí, chyby                     |
| `brand-soft`         | `#FBE7E0` | štítky, avatar, hover sekundárních tlačítek               |
| `line` (`border`)    | `#E6E4DF` | rámečky polí, oddělovače                                  |
| `line-soft`          | `#EFEDE9` | jemné oddělovače uvnitř panelů                            |
| `line-dashed`        | `#E0DDD6` | čárkované rámečky prázdných stavů                         |
| `line-strong`        | `#D9D6D0` | osa grafu, vypnutý přepínač                               |
| `dot`                | `#CFCBC4` | tečka neaktivní položky menu                              |
| `success`            | `#2F8F5B` | kladný stav (zaplaceno)                                   |
| `success-strong`     | `#226B43` | text na světle zeleném pozadí                             |
| `success-soft`       | `#E3F1E8` | pozadí kladného štítku                                    |
| `warning-strong`     | `#8A5A00` | text upozornění                                           |
| `warning-soft`       | `#FFF1D6` | pozadí upozornění                                         |

Tmavý režim prototyp nemá, takže ho nezavádíme.

### Písmo

- Rodina **Onest** (Google Fonts, načítaná přes `next/font`, podmnožiny `latin` a `latin-ext` kvůli češtině).
- Váhy: 400 text, 500 velké věty a položky menu, 600 nadpisy, tlačítka a popisky, 700 logo a iniciály.
- Velikosti: 12–13 px drobné popisky a štítky, 14–15 px běžný text a tlačítka, 16 px vstupy a odstavce, 18 px nadpisy karet, 22 px nadpis panelu, 28 px nadpis prázdného stavu, 34 px nadpis přihlášení, 40 px nadpis stránky; velké věty `clamp(26px, 2.6vw, 36px)` až `clamp(30px, 3.4vw, 44px)`.
- Velké nadpisy mají záporné prokládání (−0,02 až −0,03 em).

### Rádiusy

| Token          | Hodnota | Použití                                                 |
| -------------- | ------- | ------------------------------------------------------- |
| `rounded-full` | 999 px  | tlačítka, pilulky, štítky, položky menu                 |
| `radius-panel` | 36 px   | velké panely (úvod Přehledu, prázdné stavy, přihlášení) |
| `radius-card`  | 28 px   | karty                                                   |
| `radius-tile`  | 20 px   | dlaždice a řádky uvnitř karet                           |
| `radius-field` | 16 px   | formulářová pole, hlášky                                |

### Stíny

Prototyp je plochý; stín používá jen dvakrát. Tokeny `shadow-soft` (`0 1px 4px rgb(0 0 0 / 0.08)`) a `shadow-raised` (`0 1px 4px rgb(0 0 0 / 0.12)`) jsou připravené pro přepínače a plovoucí prvky.

### Mezery a rozložení

- Používáme výchozí stupnici Tailwindu (násobky 4 px); prototyp do ní zapadá: mezery mezi kartami 16 px, uvnitř karet 12–14 px, vnitřní okraj karet 24–28 px, panelů 32–40 px.
- Postranní menu má šířku 236 px a je vidět od šířky 768 px.
- Mřížky karet se skládají samy podle šířky (`repeat(auto-fit, minmax(min(100%, 300px), 1fr))`), stejně jako v prototypu.

### Co v prototypu není

- **Mobilní zobrazení.** Prototyp nemá žádná pravidla pro malé obrazovky. Pod 768 px proto nahrazujeme postranní menu horní lištou (logo, „Odejít“) a spodní lištou s pěti položkami.
- **Neaktivní prvky.** Věci z pozdějších fází zobrazujeme jako v prototypu, ale vypnuté a se štítkem „Připravujeme“ (`brand-soft` + `brand-strong`).

## Důsledky

- Barvy, rádiusy ani písmo se v komponentách nezapisují přímo; používají se třídy odvozené z tokenů (`bg-card`, `text-ink-2`, `rounded-card`, …). Výjimkou jsou rozměry převzaté z prototypu na pixel (např. `text-[13px]`).
- Změna vzhledu znamená úpravu `globals.css` a tohoto dokumentu.
- Písmo Onest se stahuje při sestavení webu, takže `pnpm build` potřebuje přístup k internetu.
- Nové komponenty ze shadcn/ui (`pnpm dlx shadcn@latest add …` v `apps/web`) přijdou ve výchozím vzhledu a je potřeba je upravit na tokeny.
- Tmavý režim by vyžadoval nové ADR a druhou sadu hodnot.
