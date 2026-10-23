# Bystro — UI reference (Revolut Business + Stripe Dashboard)

Podklad pro krok 1.5 (design tokeny a layout). Barvy a typografie = `tokens-libraries.css` (libraries.dev). Struktura a vzory obrazovek = Revolut Business (web) a Stripe Dashboard, vytaženo z Mobbinu 23. 10. 2026.

**Pravidlo:** od Revolutu a Stripe bereme rozložení a vzory, ne jejich barvy, ikony ani značku. Vzhled je vždy Bystro (libraries.dev tokeny, logo `by/stro`, tón z prototypu).

## Zdroje na Mobbinu

| Co                                                                     | Odkaz                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Revolut Business — Home, světlý režim (zůstatek + transakce + widgety) | https://mobbin.com/screens/c2197b76-d557-4782-943d-b4311f37f90d |
| Revolut Business — Home s plnou tabulkou transakcí a widgety           | https://mobbin.com/screens/ce86e78a-f8da-40a6-b6c2-a7278202f23e |
| Revolut Business — přepínač účtů (dropdown u zůstatku)                 | https://mobbin.com/screens/79ac1b27-feba-4e55-8d5b-12faace3fe8b |
| Revolut Business — přepínač firmy (pravý horní roh)                    | https://mobbin.com/screens/7a782d65-9d82-4178-ad92-ca77dc3180bd |
| Revolut Business — boční panel (sheet) se seznamem akcí                | https://mobbin.com/screens/00741f67-950f-4712-b95c-15b6dec72708 |
| Revolut Business — modální vysvětlení s jedním tlačítkem               | https://mobbin.com/screens/931c3de2-5b60-4d25-8f9f-1ed55c8a452f |
| Revolut Business — aktivace účtu (checklist kroků vpravo)              | https://mobbin.com/screens/50904caf-e261-4166-a68a-bba46b9067be |
| Revolut Business — prázdný stav „You're all set“                       | https://mobbin.com/screens/4e946d9b-9473-4128-8b76-9b106bb680a1 |
| Revolut (osobní web) — nastavení jako seskupené seznamy                | https://mobbin.com/flows/66a7833f-fc40-4cf9-bdf5-c95b7c53e9ec   |
| Revolut — přihlášení                                                   | https://mobbin.com/flows/266aca43-94df-4114-95e3-0b802d0bb28b   |
| Stripe — „Today“ + „Your overview“ (graf + karty metrik)               | https://mobbin.com/screens/a31f7d76-ade4-4cae-a816-a4c9b33814c3 |
| Stripe — mřížka karet metrik s „Updated 11:08“                         | https://mobbin.com/screens/673e89af-fe9e-4ab9-ac27-435dedf21888 |
| Stripe — „Get started“ blok nad přehledem                              | https://mobbin.com/screens/e56b763c-5f8a-4002-bfa1-05f9b0341f38 |
| Stripe — rychlé vytvoření (+ menu se zkratkami)                        | https://mobbin.com/screens/ad9038b7-08ba-4302-9055-2c193819ed76 |

## Shell aplikace

- **Levý sidebar ~220 px** (Revolut/Stripe): logo `by/stro` nahoře, položky s ikonou 16 px a textem 14 px, aktivní položka = měkké pozadí `--bz-chip` se zaoblením 10 px. Položky: Přehled, Asistent, Hlídač peněz, Faktury, Akce, Nastavení (dole).
- **Horní lišta:** nadpis stránky vlevo (Revolut: „Home“, 20 px semibold), vpravo hledání, nastavení a **přepínač firmy** jako pilulka s iniciálami (`DI  Dvořák Interiéry ▾`) + avatar uživatele.
- **Obsah:** pozadí `--bz-stage`, karty `--bz-surface` s rádiusem 16 px, jemný `--bz-border` a `--bz-shadow-card`. Dvousloupcové rozložení: hlavní sloupec ~2/3, pravý sloupec widgetů ~1/3 (Revolut).
- **Mobil:** sidebar → spodní lišta s 5 položkami, pravý sloupec widgetů padá pod hlavní obsah.

## Komponenty a odkud je bereme

| Komponenta                       | Vzor                                                                                  | Bystro použití                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Velké číslo zůstatku + dropdown  | Revolut `S$8.00 ▾` + „Main · SGD · Default“                                           | „Zůstatek na účtech dnes“: `248 300 Kč ▾`, pod tím „Fio · aktualizováno před 4 min“                    |
| Akční pilulky u zůstatku         | Revolut `··· / Details / Move / + Add money` (poslední primární)                      | `··· / Výpis / + Připojit banku` — primární = `--bz-cta`, ostatní `--bz-chip`                          |
| Tabulka transakcí v kartě        | Revolut: avatar s ikonou, název + podtext, datum, stav, částka vpravo, „See all“ dole | Pohyby na účtu, Faktury. Částky tabulárními číslicemi, příjem zeleně `+`, výdaj neutrálně              |
| Stavové štítky                   | Stripe `Failed` (červený soft badge)                                                  | `Po splatnosti` (danger-soft), `Brzy splatné` (warn-soft), `Zaplaceno` (ok-soft), `Připomenuto` (chip) |
| Widget karty vpravo              | Revolut „Widgets“ (Total assets, Invoices, Cards)                                     | „Co dnes vyřešit“, „Ranní přehled 7:00“, „Propojeno“                                                   |
| Checklist nastavení              | Revolut „Finish account setup 1/4“ s kruhovým progresem + tlačítko                    | Onboarding: „Dokonči nastavení 1/3“ → firma, propojení, čas přehledu                                   |
| Karty metrik s časem aktualizace | Stripe: název + ⓘ, hodnota, mini graf, „View more“ / „Updated 11:08“                  | Hlídač peněz a Přehled: každé číslo má zdroj a „Aktualizováno 7:02“ (pravidlo 9 z CLAUDE.md)           |
| Graf + přepínač období           | Stripe „Last 7 days / compared to / Daily“                                            | Cashflow 30 / 60 / 90 dní + scénář (Včas / Se zpožděním / Nejhorší) jako segmented control             |
| Boční sheet                      | Revolut „Business account“ panel zprava                                               | Detail faktury, detail akce ke schválení, „Proč to vidím?“                                             |
| Modál s jedním rozhodnutím       | Revolut „Default currency account — Got it“                                           | Potvrzení schválení upomínky, vysvětlivky                                                              |
| Rychlé vytvoření                 | Stripe „+“ menu se zkratkami                                                          | „+“ → Upomínka, Ruční položka cashflow, Otázka asistentovi                                             |
| Seskupené seznamy v nastavení    | Revolut osobní: bílé skupiny řádků s ikonou                                           | Nastavení: Firma, Propojení, Ranní přehled, Upozornění, Účet                                           |
| Prázdný stav                     | Revolut „You're all set“ — velký nadpis, jedna věta, ilustrace                        | Texty z prototypu („Faktury zatím nevidím“), místo 3D ilustrace maskot Bystra                          |

## Typografie a rytmus

- Nadpis stránky 20–24 px / 600, nadpis karty 15 px / 600, text 14 px, popisky 12–13 px `--bz-text-muted`.
- Velká čísla (zůstatek) 32–40 px / 600, `letter-spacing: -0.02em`, `font-variant-numeric: tabular-nums`.
- Mono popisky (`--bz-font-mono`, `--bz-label-mono`) jen pro zdroje a časy: „FIO · 7:02“.
- Řádek tabulky ~56 px, padding karty 20–24 px, mezera mezi kartami 16 px.
- Tlačítka jako pilulky (`--bz-radius-pill`), výška 36 px (sekundární) / 40 px (primární).

## Světlý vs. tmavý režim

Revolut Business je výchozí tmavý s modrým přechodem v rohu, libraries.dev také. Navrhuji **světlý režim jako výchozí** (odpovídá prototypu a cílovce — řemeslníci, služby) a tmavý přes `data-theme="dark"` z `tokens-libraries.css`. Rozhodnutí zapsat do ADR 0001.
