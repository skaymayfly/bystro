# 0007 — Odesílání pošty z Bystra

Datum: 2026-10-26
Stav: přijato

Navazuje na [0004](0004-posta-z-vlastni-schranky.md) (pošta z vlastní schránky) a [0006](0006-synchronizace-posty.md) (synchronizace).

## Kontext

Krok 5.6: odpovídat ve vlákně a psát nové e-maily přímo z Pošty. Odeslání e-mailu je citlivá akce (CLAUDE.md, pravidlo 8): musí jít přes Action engine se schválením a odejít právě jednou. Dokumentace Gmail API ověřená 2026-10-26:

- `messages.send` přijímá `{ raw, threadId }`; `raw` je celá zpráva podle RFC 2822 v base64url. Stojí 100 jednotek kvóty, stačí `gmail.modify`.
- Do vlákna Gmail zařadí zprávu se stejným `threadId`, hlavičkami `In-Reply-To`/`References` podle RFC 2822 a odpovídajícím předmětem.
- Odpověď 200 znamená přijetí, ne doručení. Denní limity odesílání jsou společné pro všechny klienty uživatele (429).
- Vyhledávací operátor `rfc822msgid:` najde zprávu podle hlavičky `Message-ID`.

## Rozhodnutí

- **Kliknutí na „Odeslat“ je schválení.** Web navrhne akci `mail_send` a hned ji schválí jménem toho, kdo klikl; provede ji worker. Odesílat smí majitel a správce (stejně jako schvalovat akce).
- **Jedno okno editoru, jeden e-mail.** Editor si při otevření vytvoří klíč; klíč akce je `mail_send:<uživatel>:<klíč editoru>`. Dvojklik i opakovaný požadavek najdou tutéž akci.
- **Jen prostý text** v UTF-8 (base64), bez HTML a příloh. Hlavičky s diakritikou podle RFC 2047. Konce řádků v předmětu, jménech a adresách se odmítnou (ochrana proti vložení hlaviček). Nejvýš 20 příjemců, text do 100 000 znaků.
- **Náhled akce** (příjemci, předmět, vlákno, hlavičky pro odpověď) je čitelný, **text je šifrovaný** `ENCRYPTION_KEY` jako ostatní pošta. Audit náhled neobsahuje.
- **Pojistka proti dvojímu odeslání při pádu:** zpráva dostane `Message-ID` odvozené z ID akce (`<bystro.<id akce>@<doména schránky>>`). Worker se před odesláním podívá do Odeslaných (`rfc822msgid:`); když tam zpráva je, neodešle ji znovu a jen si zapíše její ID.
- **Visící akce:** úloha `maintenance.recover-actions` (každých 10 minut) projde akce `mail_send`, které jsou déle než 15 minut ve stavu `executing`. Zpráva v Odeslaných → `succeeded` s jejím ID; jinak `failed` s kódem `interrupted`. Když se Gmailu nejde zeptat, nechá akci na příští běh. Nikdy nic neodesílá.
- **Výsledek akce** je ID odeslané zprávy z Gmailu. Po odeslání se zařadí synchronizace pošty, aby se zpráva objevila ve vlákně.
- Akce platí hodinu; co se do té doby neodešle, vyprší neodeslané.
- Editor se na stav akce ptá (`GET /api/mail/send/{id}`, nikdy nevrací text). Když do minuty nedoběhne, řekne „odesílá se na pozadí“, ne „odesláno“.

## Důsledky

- Migrace `0007_action_mail_send` přidává hodnotu `mail_send` k typům akcí.
- Gmail může `Message-ID` od klienta nahradit vlastním; pak pojistka přes Odeslané nic nenajde a platí jen ochrana přes stav akce. Ověřit na skutečném odeslání a podle toho upravit.
- Odpověď jde všem, kdo jsou v poli Komu; „Odpovědět všem“ zatím není.
