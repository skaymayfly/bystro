# 0008 — Upomínky faktur

Datum: 2026-10-26
Stav: přijato

Navazuje na [0007](0007-odesilani-posty.md) (odesílání pošty přes Action engine).

## Kontext

Krok 5.7: první akce, kterou Bystro navrhuje samo. Faktura po splatnosti → návrh upomínky → uživatel text upraví a odešle → upomínka odejde z jeho schránky → faktura má stav „Připomenuto“. Dokumentace Fakturoidu (2026-10-26): `GET …/invoices/{id}/download.pdf` vrací `application/pdf`, dokud PDF není vygenerované, `204`. Adaptéry Fakturoidu i iDokladu PDF už stahují (`getDocument`).

## Rozhodnutí

- **Kdy navrhnout** (čistá funkce `shouldProposeReminder` v `packages/core`): faktura je aspoň N dní po splatnosti, klient má e-mail a za posledních X dní k ní nevznikla upomínka (odeslaná, navržená ani zamítnutá). Výchozí N = 3, X = 7; firma si je nastaví v Nastavení → Upozornění (1–60 dní, sloupce `organizations.reminder_after_days`, `reminder_repeat_days`, migrace `0008_reminder_settings`).
- **Ranní úloha** `actions.propose-reminders` v 7:30 (Europe/Prague), jen pro firmy s propojeným Gmailem (odkud by upomínka odešla). Klíč akce obsahuje fakturu a den, opakovaný běh nic nezdvojí. Návrh platí X dní.
- **Návrh nese jen příjemce a předmět.** Text vzniká až v kartě na detailu faktury ze šablony (dva tóny podle prototypu, podpis jménem přihlášeného uživatele) a ukládá se **šifrovaně až při odeslání** spolu s volbou přílohy (`updateProposedActionPreview`, audit bez obsahu).
- **„Odeslat připomínku“ je schválení**, „Teď ne“ zamítnutí; smí majitel a správce. Uživatel může upomínku poslat i bez návrhu („Poslat připomínku“ vytvoří akci `user_requested`).
- **Odeslání** jde stejnou cestou jako `mail_send`: Message-ID z ID akce, kontrola Odeslaných, Gmail z vlastní schránky, dořešení visících akcí. Před provedením se znovu ověří, že faktura je po splatnosti; zaplacená faktura → akce vyprší a nic neodejde.
- **PDF v příloze** (výchozí zapnuto) se stahuje z fakturačního systému až při odeslání, v rámci jeho limitu požadavků. Když PDF není (204, výpadek), upomínka odejde bez přílohy; neodeslání upomínky kvůli příloze by bylo horší.
- **Stav „Připomenuto“** (tón varování) má faktura po splatnosti, ke které po dni splatnosti odešla upomínka; v historii detailu přibude řádek „Připomenuto“.

## Důsledky

- Text upomínky není nikde uložený, dokud ho uživatel neodešle; náhled z ranní úlohy obsahuje jen adresu klienta a předmět.
- Každé odeslání s přílohou stojí jeden požadavek z měsíčního limitu Fakturoidu (1 500 na tarifu uživatele).
- Hlídání, jestli po upomínce přišla platba, a návrh dalšího kroku jsou krok 5.9.
