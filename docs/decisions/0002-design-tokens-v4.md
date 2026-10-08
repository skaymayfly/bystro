# 0002 — Design tokeny podle prototypu v4

Datum: 2026-10-08
Stav: přijato

Nahrazuje [0001 — Design tokeny z prototypu](0001-design-tokens.md).

## Kontext

Uživatel dodal nový prototyp `docs/prototyp/prototyp-v4.dc.html` a nové logo (`docs/prototyp/logo-znacka.svg`, `logo-wordmark.svg`). Vzhled se proti původnímu prototypu mění celý: jiné písmo, černobílá paleta místo cihlové, jiné rádiusy a jiné rozložení aplikace. Tokeny z ADR 0001 tím přestaly platit.

Prototyp v4 zároveň ukazuje věci, které se neshodují s hotovou aplikací nebo s plánem. U každé jsme rozhodli, co platí (schváleno uživatelem 2026-10-08):

| Prototyp v4                                              | Co platí v aplikaci                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Přihlášení jednorázovým kódem, bez hesla a bez Googlu    | Zůstává e-mail + heslo, Google a reset hesla (`CLAUDE.md`), jen v novém vzhledu.                      |
| Onboarding: název firmy, IČO, počet lidí; „Krok X ze 4“  | Zůstává IČO → ARES → potvrzení, tři kroky. Počet lidí neukládáme.                                     |
| Přehled jen s daty: tabulka úkolů, graf, kalendář        | Hlavička a úvodní věta podle v4, pod nimi prázdné panely s výzvou k propojení.                        |
| Menu: navíc Pošta, Kalendář, Banka, Klienti, Propojení   | Jen pět existujících položek. Další přibudou se svou fází.                                            |
| „Rychlé akce ⌘K“ (vyhledávací paleta)                    | Odloženo, je to nová funkce.                                                                          |
| Značka „b“ s tečkou a nápis „bystro“ uvnitř prototypu    | Platí novější samostatné logo: černý čtverec s bílým lomítkem a nápis „by/stro“.                      |
| Tlačítko „Vystavit fakturu“, karta „Předplatné“ s cenami | Vynecháno: Bystro faktury nevystavuje a ceny potvrdí uživatel až v kroku 9.1.                         |
| Mobil: menu se pod 1000 px jen zúží na ikony             | 768–1000 px úzké menu s ikonami jako ve v4; pod 768 px horní lišta a spodní navigace (vlastní návrh). |

## Rozhodnutí

Tokeny žijí dál v `apps/web/src/app/globals.css` (Tailwind CSS 4, blok `@theme`) a komponenty v `apps/web/src/components/ui` jsou na ně přemapované. Hodnoty jsou vybrané podle četnosti ve v4; ojedinělé odstíny jsme sloučili s nejbližším tokenem.

### Barvy

| Token                 | Hodnota   | Použití                                               |
| --------------------- | --------- | ----------------------------------------------------- |
| `background` / `card` | `#FFFFFF` | pozadí stránky, karty, list s obsahem aplikace        |
| `chrome`              | `#F5F5F5` | pozadí kolem obsahu aplikace (postranní menu)         |
| `subtle`              | `#FAFAFA` | panel s formulářem u přihlášení a onboardingu         |
| `muted`               | `#F4F4F5` | řádky a dlaždice uvnitř karet, sekundární tlačítko    |
| `fill`                | `#F1F1F2` | štítky, ikony prázdných stavů, hover                  |
| `ink` (`foreground`)  | `#111111` | hlavní text, hlavní tlačítko, logo, avatar            |
| `ink-hover`           | `#333333` | hlavní tlačítko pod kurzorem                          |
| `ink-2`               | `#3F3F46` | doprovodný text, popisky polí, neaktivní položka menu |
| `ink-3`               | `#71717A` | potlačený text (`muted-foreground`)                   |
| `ink-4`               | `#A1A1AA` | nejslabší text, placeholdery, lomítko v logu          |
| `line` (`border`)     | `#E7E7E9` | rámečky karet                                         |
| `line-soft`           | `#EFEFF0` | jemné oddělovače                                      |
| `line-strong`         | `#E4E4E7` | rámečky polí a sekundárních tlačítek                  |
| `line-dark`           | `#D4D4D8` | vypnutý přepínač, tečka „nepropojeno“                 |
| `danger`              | `#DC2626` | varování, pokles pod nulu                             |
| `danger-strong`       | `#B91C1C` | text chyby                                            |
| `danger-soft`         | `#FEF2F2` | pozadí varování                                       |
| `success`             | `#16A34A` | kladný stav (zaplaceno, propojeno)                    |
| `success-strong`      | `#15803D` | text na světle zeleném pozadí                         |
| `success-soft`        | `#F0FDF4` | pozadí kladného štítku                                |
| `warning-strong`      | `#B45309` | text upozornění                                       |
| `warning-soft`        | `#FFFBEB` | pozadí upozornění                                     |

Značková barva (`brand`) už neexistuje; hlavní akce je černá. Barvy poskytovatelů na dlaždicích propojení (Gmail, Fio, Fakturoid…) jsou data v `apps/web/src/lib/content.ts`, ne tokeny. Tmavý režim prototyp nemá, takže ho nezavádíme.

### Písmo

- Rodina **Geist** (Google Fonts, načítaná přes `next/font`, podmnožiny `latin` a `latin-ext` kvůli češtině).
- Váhy: 400 text, 500 nadpisy stránek a karet, 600 nadpisy formulářů, čísla a hlavní tlačítka, 700 iniciály.
- Nadpis stránky `clamp(34px, 3.4vw, 46px)`, váha 500, prokládání −0,035 em; druhá část nadpisu může být šedá (`ink-3`). Přehled má kompaktní nadpis 30 px, váha 600.
- Nadpis formuláře (přihlášení, onboarding) `clamp(32px, 3vw, 40px)`, váha 600.

### Rádiusy

| Token            | Hodnota | Použití                                                 |
| ---------------- | ------- | ------------------------------------------------------- |
| `rounded-full`   | 999 px  | tlačítka a přepínače uvnitř aplikace                    |
| `radius-panel`   | 28 px   | levý horní roh listu s obsahem                          |
| `radius-card`    | 26 px   | karty                                                   |
| `radius-tile`    | 16 px   | dlaždice a řádky uvnitř karet                           |
| `radius-box`     | 14 px   | kompaktní panely Přehledu, položky nabídky v Nastavení  |
| `radius-control` | 10 px   | pole a tlačítka ve formulářích (přihlášení, onboarding) |

Prototyp v4 má vědomě dva styly: Přehled je kompaktní (panely 14 px, tlačítka 32 px vysoká s rádiusem 8 px), ostatní obrazovky mají velké karty a tlačítka-pilulky vysoká 46 px. Držíme se ho obrazovku po obrazovce; tvar tlačítka určuje jeho velikost (`default`, `sm`, `form`, `icon`).

### Stíny

- `shadow-soft` (`0 1px 2px rgb(0 0 0 / 0.04)`) pro panely propojení,
- `shadow-focus` (`0 0 0 4px rgb(17 17 17 / 0.08)`) pro pole a tlačítka s fokusem,
- `shadow-raised` (`0 24px 60px -12px rgb(0 0 0 / 0.25)`) připravený pro plovoucí okna.

### Logo

- Značka: černý čtverec (`#111111`, zaoblení čtvrtina strany) s bílým lomítkem. Komponenta `LogoMark`, ikona webu `apps/web/src/app/icon.svg`.
- Nápis: „by/stro“ písmem Geist, váha 600, lomítko `ink-4` s váhou 400. Komponenta `Wordmark`; čtečky obrazovky dostanou „Bystro“.

### Rozložení

- Aplikace: šedé pozadí, vlevo menu široké 288 px (firma a e-mail, dvě skupiny položek, dole uživatel s rolí a „Odhlásit“), vpravo bílý list se zaobleným levým horním rohem, obsah nejvýš 1440 px.
- Mezi 768 a 1000 px se menu zúží na 84 px a ukazuje jen ikony. Pod 768 px je horní lišta s logem a spodní navigace s pěti položkami.
- Přihlášení a onboarding: vlevo formulář na světlém panelu (nejvýš 500 px), vpravo od 1024 px ozdobný náčrt aplikace.
- Nastavení je rozdělené na karty Profil, Propojení a Upozornění (`?karta=`).

## Důsledky

- Barvy, rádiusy ani písmo se v komponentách nezapisují přímo; používají se třídy odvozené z tokenů. Výjimkou jsou rozměry převzaté z prototypu na pixel.
- Změna vzhledu znamená úpravu `globals.css` a tohoto dokumentu.
- Prototyp je soubor `.dc.html`, který se vykreslí jen spolu s `support.js` ve stejné složce (`docs/prototyp/`).
- Písmo Geist se stahuje při sestavení webu, takže `pnpm build` potřebuje přístup k internetu (stejně jako dřív Onest).
- Ikony jsou z `lucide-react` s tenkou čarou (1,6–1,7), aby odpovídaly prototypu.
- Nové obrazovky z v4 (Banka, Klienti, Pošta, Kalendář, úvodní stránka, detail faktury) se staví až ve svých krocích plánu, už v tomto vzhledu.
