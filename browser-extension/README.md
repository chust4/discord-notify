# Discord Notify — Instagram Session Sync (wtyczka Firefox)

Automatycznie wysyła cookie sesji Instagram (`sessionid`) do Twojej instancji
Discord Notify za każdym razem, gdy odwiedzasz `instagram.com` zalogowany. Bez
tego cookie **wykrywanie postów/Reels/Stories na Instagramie w ogóle nie
działa** — Instagram nie ma do tego darmowego, publicznego API.

## ⚠️ Zanim zainstalujesz — realne ryzyko

Wysyłanie cookie sesji do automatycznego sprawdzania profilu to **automatyzacja
konta Instagram**, co **łamie regulamin Instagrama** i może skutkować
ograniczeniem funkcji, wylogowaniem lub zbanowaniem tego konta.

**Użyj dedykowanego, zapasowego konta Instagram** — załóż nowe, osobne konto
tylko do tego celu i zaloguj je w tej przeglądarce (najlepiej w osobnym
profilu Firefoksa, patrz niżej). **Nigdy nie używaj do tego swojego głównego
konta.**

## Jak to działa

1. Wtyczka nasłuchuje, kiedy odwiedzasz `instagram.com` (lub gdy zmienia się
   cookie `sessionid` — np. po ponownym zalogowaniu).
2. Odczytuje wartość cookie `sessionid` przez `browser.cookies` API.
3. Jeśli zmieniła się od ostatniej wysyłki, wysyła ją do Twojej aplikacji:
   `PUT {adres_aplikacji}/api/config` z ciałem `{"instagram_session_id": "..."}`.
4. Aplikacja zapisuje ją i używa jako cookie dla `yt-dlp` przy sprawdzaniu
   Instagrama — identycznie jak wpisanie tej wartości ręcznie w panelu,
   sekcja **Ustawienia**.

Wtyczka **nie wysyła** nic innego — żadnej historii przeglądania, żadnych
innych cookies, tylko tę jedną wartość, tylko do adresu, który sam wskażesz.

## Instalacja

### Osobny profil Firefoksa (zalecane)

Żeby nie mieszać sesji swojego głównego konta Instagram z kontem-botem:

```
firefox -P
```

Utwórz nowy profil (np. „discord-notify-ig"), zaloguj w nim **zapasowe** konto
Instagram, i tam zainstaluj poniżej opisaną wtyczkę.

### Wariant A — tymczasowo (do testów)

1. `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
2. Wskaż plik `manifest.json` z tego folderu.
3. Działa do zamknięcia przeglądarki — po restarcie trzeba wgrać ponownie.

### Wariant B — na stałe (samopodpisane rozszerzenie)

Firefox (poza wersjami Developer Edition/Nightly) wymaga podpisanych
rozszerzeń nawet do użytku prywatnego. Mozilla oferuje darmowe **podpisywanie
bez publikacji** (self-distribution):

1. Spakuj folder do `.zip` (zawartość, nie sam folder w środku):
   ```bash
   cd browser-extension
   zip -r -FS ../discord-notify-ig-sync.zip . -x '*.md'
   ```
2. Wejdź na <https://addons.mozilla.org/developers/> → zaloguj się (darmowe
   konto) → **Submit a New Add-on** → **On your own** (self-distribution,
   *nie* "On this site").
3. Wgraj `.zip`, poczekaj na automatyczne podpisanie (zwykle sekundy/minuty),
   pobierz podpisany plik `.xpi`.
4. Otwórz pobrany `.xpi` w Firefoksie (przeciągnij do okna przeglądarki lub
   `Plik → Otwórz plik`) → **Zainstaluj**. Zostaje na stałe, przeżywa restart.

Alternatywnie: **Firefox Developer Edition** lub **Nightly** pozwalają
całkowicie wyłączyć wymóg podpisu (`about:config` →
`xpinstall.signatures.required` → `false`) i wtedy Wariant A działa na stałe.

## Konfiguracja po instalacji

Przy instalacji Firefox raz zapyta o zgodę na dostęp wtyczki „do wszystkich
stron" — to wymagane, bo adres Twojego NAS nie jest znany z góry (nie da się
zadeklarować go w manifeście na sztywno). Wtyczka i tak łączy się wyłącznie
z adresem, który sam podasz poniżej — zaakceptuj to okno przy instalacji.

1. Kliknij ikonę wtyczki na pasku → **Ustawienia wtyczki** (albo od razu
   otworzy się strona opcji po instalacji).
2. Wpisz adres swojej aplikacji, np. `http://192.168.0.32:8092`.
3. Jeśli masz włączony `PANEL_USER`/`PANEL_PASSWORD` w Portainerze, podaj je
   też tutaj (Basic Auth) — inaczej wtyczka nie przejdzie autoryzacji panelu.
4. **Zapisz**.
5. Wejdź na `instagram.com` zalogowany na docelowe konto. Cookie zostanie
   wysłane automatycznie w tle.
6. Sprawdź w panelu Discord Notify → **Ustawienia** → pole „Instagram Session
   ID" powinno pokazać `ustawione ••••xxxx`.

> Jeśli po zapisaniu widzisz błąd „NetworkError when attempting to fetch
> resource" — zaktualizuj wtyczkę do najnowszej wersji z tego repo (starsze
> wersje prosiły o dostęp dopiero w trakcie działania, co w Firefoksie bywa
> zawodne) i przeładuj ją: `about:addons` → wtyczka → ikona koła zębatego →
> **Przeładuj**.

## Ręczna synchronizacja / status

Ikona wtyczki na pasku narzędzi pokazuje status ostatniej synchronizacji i ma
przycisk **„Wyślij teraz"** — przydatny, jeśli automatyczne wykrycie się nie
uruchomiło (np. cookie ustawione zanim wtyczka śledziła zmiany).

## Bezpieczeństwo

- Wtyczka **nie zbiera i nie wysyła żadnych danych** do Mozilli ani do twórcy
  wtyczki (manifest deklaruje `data_collection_permissions: none`) — jedyny
  ruch sieciowy to cookie wysyłane pod adres, który sam podasz.
- Cookie trafia **wyłącznie** pod adres, który sam skonfigurujesz — nie ma
  żadnego zewnętrznego serwera pośredniczącego. Firefox pokazuje przy
  instalacji szerokie uprawnienie „dostęp do wszystkich stron" (techniczne
  wymaganie, bo adres NAS nie jest znany z góry) — wtyczka mimo to *łączy się*
  wyłącznie z jednym, skonfigurowanym przez Ciebie adresem.
- Adres/login/hasło do panelu są przechowywane lokalnie w `storage.local`
  przeglądarki (nie synchronizowane z kontem Firefox, chyba że masz włączoną
  synchronizację rozszerzeń — wtedy rozważ użycie osobnego profilu bez sync).
- Jeśli używasz `PANEL_USER`/`PANEL_PASSWORD`, upewnij się, że aplikacja jest
  dostępna tylko w Twojej sieci LAN (domyślna konfiguracja tego projektu) —
  nie wystawiaj panelu do internetu bez dodatkowego zabezpieczenia (np. VPN).
