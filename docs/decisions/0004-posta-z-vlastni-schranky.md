# 0004 — Pošta a upomínky z vlastní schránky uživatele (Gmail)

Datum: 2026-10-23
Stav: přijato

## Kontext

Krok 5.3 měl rozhodnout, odkud budou odcházet upomínky. Zvažované možnosti (dokumentace ověřená 2026-10-23):

- **Přes fakturační systém.** Fakturoid má `POST /accounts/{slug}/invoices/{id}/message.json` (jen placené tarify, denní limit, odpověď `204` bez ID zprávy), iDoklad `POST /v3/Mails/Reminders/Send`.
- **Přes Resend z domény Bystra.** Má ID zprávy, ale potřebuje vlastní ověřenou doménu a klient dostane e-mail z cizí adresy.
- **Z vlastní schránky uživatele.** Klient dostane e-mail ze známé adresy, ten je vidět v Odeslaných a odpověď přijde rovnou uživateli.

Uživatel rozhodl (2026-10-23): upomínky z vlastní schránky, ne přes Fakturoid ani iDoklad. A rovnou celá sekce Pošta, tedy i čtení pošty, ne jen posílání. Tím se Gmail přesouvá před betu; Outlook, Seznam a kalendář zůstávají po betě.

## Rozhodnutí

- **Gmail první.** OAuth 2.0 Authorization Code s PKCE (S256), `access_type=offline` a `prompt=consent` (refresh token i při opakovaném připojení). Endpointy a PKCE podle dokumentace Googlu a jeho OpenID konfigurace.
- **Oprávnění `https://www.googleapis.com/auth/gmail.modify`.** Pokrývá čtení, štítky (archivace) i odeslání, bez trvalého mazání. Je to „restricted“ scope. Užší kombinace by stejně potřebovala aspoň jeden restricted scope (`gmail.readonly`), takže kvůli ověření nic neušetří.
  - Google na obrazovce souhlasu dovolí oprávnění odškrtnout. Bez `gmail.modify` se přístup hned vrátí a nic se neuloží.
- **Adresa schránky** se čte z `users.getProfile` (`emailAddress`, `historyId`). Ukládá se jako účet připojení; nikdy se neloguje.
- **Odpojení** odvolá přístup u Googlu (`POST https://oauth2.googleapis.com/revoke`) a smaže tokeny.
- **Konfigurace** `GMAIL_CLIENT_ID` a `GMAIL_CLIENT_SECRET`. Může to být stejný OAuth klient jako přihlášení přes Google, ale zapíná se zvlášť, aby se Gmail neobjevil omylem.
- **Text e-mailů se bude ukládat šifrovaně** (krok 5.4) a zobrazovat jen jako text, nikdy jako HTML (krok 5.5), protože je nedůvěryhodný.
- **Odeslání** (odpověď, nový e-mail, upomínka) jde vždy přes Action engine. Kliknutí uživatele na „Odeslat“ nebo schválení návrhu je schválení; odejde právě jednou.

## Důsledky

- 👤 **Před betou** musí aplikace projít ověřením u Googlu včetně bezpečnostního posouzení pro restricted scope (krok 8.3). Postup a cenu ověřit, až na to přijde řada.
- **Do té doby testovací režim:** Gmail funguje jen pro účty přidané jako testovací uživatelé a refresh token platí 7 dní (dokumentace Googlu: „A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of ‚Testing‘ is issued a refresh token expiring in 7 days“). Pak je potřeba Gmail připojit znovu; aplikace to ukáže jako „Je potřeba znovu připojit“.
- Google drží nejvýš 100 refresh tokenů na účet a klienta; nejstarší se při překročení bez varování zneplatní.
- Limit Gmail API je 6 000 jednotek za minutu na uživatele (načtení zprávy 20–60, odeslání 100). Synchronizace (5.4) ho musí hlídat.
- Firmy bez Gmailu zatím upomínky z vlastní schránky posílat nemohou. Outlook (Microsoft Graph) přijde ve fázi 8. Seznam.cz nemá pro poštu veřejné OAuth API, jen SMTP a IMAP s heslem, a hesla Bystro neukládá.
- „Shrnutí od asistenta“ a „Návrh odpovědi“ z prototypu potřebují jazykový model, takže patří do fáze 6 (krok 6.6b).
