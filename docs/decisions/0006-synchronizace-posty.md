# 0006 — Synchronizace pošty (Gmail)

Datum: 2026-10-24
Stav: přijato

Navazuje na [0004 — Pošta a upomínky z vlastní schránky](0004-posta-z-vlastni-schranky.md).

## Kontext

Krok 5.4: Bystro má mít poštu posledních 30 dní a průběžně ji držet aktuální. Dokumentace Gmail API ověřená 2026-10-24:

- `messages.list` vrací jen `id` a `threadId` (nejvýš 500 na stránku), stojí 5 jednotek kvóty.
- `messages.get` s `format=full` vrací hlavičky a strom MIME s textem v base64url (60 jednotek), `format=minimal` jen štítky (20).
- `history.list` vrací změny od `startHistoryId` (přidané a smazané zprávy, přidané a odebrané štítky), stojí 2 jednotky. Neplatné nebo staré ID vrátí 404 a je potřeba úplná synchronizace; historie bývá dostupná zhruba týden, výjimečně jen hodiny.
- Kvóta 6 000 jednotek za minutu na uživatele. Dávkové požadavky kvótu nešetří (každý dílčí se počítá zvlášť) a Google doporučuje nejvýš 50 v dávce.

## Rozhodnutí

### Co se ukládá

- Tabulky `mail_messages` a `mail_threads` se standardními externími sloupci a unikátním klíčem `(organization_id, source, external_id)`.
- **Čitelně:** předmět, odesílatel, příjemci (To, Cc), čas, štítky a hlavičky pro odpověď ve vláknu (`Message-ID`, `In-Reply-To`, `References`).
- **Šifrovaně (AES-256-GCM, `ENCRYPTION_KEY`):** text e-mailu a úryvek od Gmailu.
- **Text, nikdy HTML.** Přednost má část `text/plain`; když chybí, HTML se převede na prostý text (bez skriptů, stylů a cílů odkazů). Znaková sada podle `Content-Type` (i `windows-1250`, `iso-8859-2`). Nejvýš 100 000 znaků na zprávu.
- **Přílohy jen jako příznak** „má přílohu“; obsah se nestahuje.
- **Štítky jen systémové:** `INBOX`, `SENT`, `UNREAD`, `TRASH`, `SPAM`, `DRAFT`. Vlastní štítky uživatele a kategorie se neukládají.
- `mail_threads` se po každém běhu přepočítá ze zpráv (předmět první zprávy, čas poslední, počet, nepřečtené, v Doručených, odeslané).

### Které zprávy

- Do Bystra se stáhnou zprávy z Doručených nebo Odeslaných za posledních 30 dní, ne koncepty, koš a spam.
- Zpráva archivovaná jinde zůstává (bez štítku `INBOX`), přečtená ztratí `UNREAD`.
- Koš, spam a trvale smazané zprávy se v Bystru **smažou natvrdo**, stejně jako vše starší než 30 dní.
- **Po odpojení** schránky se smaže všechna její pošta, v téže transakci jako tokeny.

### Jak se synchronizuje

- **Úplná synchronizace** (první, každou noc v 3:15 a po prošlé historii): nejdřív `getProfile` pro aktuální `historyId` (aby se nic, co se změní během výpisu, neztratilo), pak `messages.list` po štítcích (`INBOX`, `SENT`, `UNREAD`, `TRASH`, `SPAM`) s `q=newer_than:30d`. Štítky uložených zpráv se nastaví podle výpisů, takže se nestahuje nic navíc; s `format=full` se stahují jen zprávy, které Bystro ještě nemá.
- **Průběžná synchronizace:** `history.list` od uloženého `historyId`; změny se poskládají v pořadí (pozdější vyhrává). Při 404 proběhne úplná.
- **Interval:** každých 5 minut mezi 6:00 a 21:55, v noci jednou za hodinu (čas Europe/Prague). Průběžný běh bez změn stojí pár jednotek.
- Nové zprávy se ukládají po 20; přerušený běh si nechá, co stáhl, a další naváže (uložené zprávy znovu nestahuje).
- **Kvóta se počítá v jednotkách**, ne v požadavcích: omezovač ve workeru dostal váhu volání. Na Gmail se při vyčerpání kvóty čeká uvnitř úlohy (nejvýš 5 minut), místo aby se úloha vracela do fronty a začínala znovu.
- Dávkové požadavky se nepoužívají: kvótu nešetří a přidávají složitost. První načtení pár tisíc zpráv proto trvá řádově desítky minut.
- Obnova tokenu je společná se synchronizací faktur. Google v testovacím režimu vydává refresh token na 7 dní; po jeho odmítnutí je připojení „Je potřeba znovu připojit“.
- Po připojení Gmailu web hned zařadí první (úplnou) synchronizaci.

## Důsledky

- Worker potřebuje `GMAIL_CLIENT_ID` a `GMAIL_CLIENT_SECRET` stejně jako web.
- Předmět, odesílatel a příjemci jsou osobní údaje uložené čitelně kvůli seznamu a hledání (krok 5.5). Chrání je mazání po 30 dnech a po odpojení; do logů, auditu ani Sentry nejdou, tam jsou jen počty.
- Adaptér je otestovaný na odpovědích podle dokumentace (`packages/integrations/src/gmail/fixtures/`). Skutečné odpovědi se nahrají, až bude nastavený testovací Gmail.
- Úplná synchronizace pozná trvale smazanou zprávu jen přes historii; zpráva smazaná v době, kdy byla historie prošlá, zůstane v Bystru bez štítků, dokud nevypadne z okna 30 dní.

## Doplněno v kroku 5.5 (obrazovka Pošta, 2026-10-24)

- **Archivace** volá `threads.modify` s `removeLabelIds: ["INBOX"]` (dokumentace ověřená 2026-10-24; platí pro všechny zprávy vlákna, 10 jednotek kvóty). Nejdřív Gmail, teprve po úspěchu Bystro; odmítne-li Gmail, v Bystru se nic nezmění. Vlákno, které už v Gmailu není, zmizí z Doručených i v Bystru.
- Archivace **nejde přes Action engine**: je to přímé kliknutí uživatele, dá se vrátit a nic neodesílá. Schvalování z CLAUDE.md platí pro odeslání e-mailu, kalendář a CRM. Audit `mail.thread_archived` nese jen ID vlákna a počet zpráv.
- Web volá Gmail sám, proto se obnova tokenu přestěhovala z workeru do `packages/integrations` (`freshConnectionTokens`).
- **Hledání** jen v předmětu, jménech a adresách; text e-mailu je šifrovaný, takže se v něm hledat nedá. Obrazovka to u prázdného výsledku říká.
- **Otevření vlákna v Bystru ho v Gmailu neoznačí jako přečtené**; nepřečtené je podle Gmailu. Označování může přijít později.
- Text e-mailu se vykresluje jen jako text (`white-space: pre-wrap`), nikdy jako HTML; odkazy zůstávají textem. Přílohy jen jako poznámka „otevřeš ji v Gmailu“.
