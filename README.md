# 🔔 Discord Notify

Panel webowy + bot Discord do powiadamiania o **nowych filmach, postach i transmisjach live**
z **YouTube, TikTok, Twitch, Kick i Instagrama**. Zaprojektowany do uruchomienia na **Synology NAS**
przez **Portainer → Stacks → Add stack → Git repository**.

- 🌐 Nowoczesny, responsywny panel (dark mode) pod `http://192.168.0.32:8092`
- 🤖 Bot Discord ze slash commands, działający tylko na **autoryzowanych** serwerach
- 🗂️ Wiele profili twórców, każdy z osobnymi ustawieniami powiadomień per serwer
- 🧩 Edytowalne szablony wiadomości ze zmiennymi + walidacja + podgląd + test
- 🔁 Tryb „panel" — bot edytuje jedną wiadomość zamiast spamować nowymi
- 🛡️ Anty-duplikaty trwałe po restarcie kontenera
- 📊 Diagnostyka, historia zdarzeń, czytelne logi + automatyczna rotacja logów

---

## Spis treści

1. [Wymagania](#wymagania)
2. [Konfiguracja bota Discord](#1-konfiguracja-bota-discord)
3. [Wdrożenie przez Portainer (Git repository)](#2-wdrożenie-przez-portainer-git-repository)
4. [Zmienne środowiskowe](#3-zmienne-środowiskowe-do-uzupełnienia-w-portainerze)
5. [Pierwsze uruchomienie](#4-pierwsze-uruchomienie)
6. [Sprawdzanie logów](#5-sprawdzanie-logów)
7. [Aktualizacja aplikacji po zmianach w GitHub](#6-aktualizacja-aplikacji-po-zmianach-w-github)
8. [Klucze API platform](#7-klucze-api-platform-opcjonalne)
9. [Funkcje / Architektura](#8-architektura)
10. [FAQ / Rozwiązywanie problemów](#9-faq--rozwiązywanie-problemów)

---

## Wymagania

- Synology NAS z zainstalowanym **Container Manager / Docker** oraz **Portainer**
- Dostęp do internetu z NAS (bez proxy) — bot łączy się z Discordem i platformami
- Konto Discord Developer (do utworzenia bota)
- Folder na dane na NAS, np. `/volume1/docker/discord-notify-bot`
  (to jest udział `\\DrOktopus\docker\discord-notify-bot`)

---

## 1. Konfiguracja bota Discord

1. Wejdź na <https://discord.com/developers/applications> → **New Application**.
2. Zakładka **Bot** → **Reset Token** → skopiuj **token** (to jest `DISCORD_TOKEN`).
   - ⚠️ Token to sekret — trafia tylko do zmiennych środowiskowych, nigdy do repo.
3. Zakładka **General Information** → skopiuj **Application ID** (to jest `DISCORD_CLIENT_ID`).
4. **Intents:** ten bot **nie wymaga** żadnych Privileged Intents (działa na zwykłym
   intencie `Guilds`), więc nic nie musisz włączać.
5. **Zaproszenie bota na serwer** — OAuth2 → URL Generator:
   - **Scopes:** `bot`, `applications.commands`
   - **Bot Permissions:** `View Channels`, `Send Messages`, `Embed Links`,
     `Manage Messages` (do panelu / przypinania), `Read Message History`
   - Skopiuj wygenerowany URL, otwórz w przeglądarce i dodaj bota na swój serwer.

> Bot pojawi się w panelu (sekcja **Serwery**) jako **niezautoryzowany**. Musisz go
> ręcznie autoryzować — to mechanizm bezpieczeństwa: bot wysyła powiadomienia
> **wyłącznie** na serwery, które sam zatwierdzisz.

---

## 2. Wdrożenie przez Portainer (Git repository)

1. Wgraj ten projekt na GitHub (repo: `chust4/discord-notify`).
2. W Portainerze: **Stacks → + Add stack**.
3. **Build method:** wybierz **Repository**.
4. Wypełnij:
   - **Repository URL:** `https://github.com/chust4/discord-notify`
   - **Repository reference:** `refs/heads/main` (lub Twoja gałąź)
   - **Compose path:** `docker-compose.yml`
5. Rozwiń **Environment variables** i dodaj zmienne z sekcji
   [poniżej](#3-zmienne-środowiskowe-do-uzupełnienia-w-portainerze)
   (minimum: `DISCORD_TOKEN` i `DISCORD_CLIENT_ID`).
6. Kliknij **Deploy the stack**.

Portainer sklonuje repo, **zbuduje obraz z Dockerfile** i uruchomi kontener.
Pierwszy build trwa kilka minut (kompilacja zależności). Aplikacja będzie pod
`http://<IP-NAS>:8092` → w Twoim przypadku **http://192.168.0.32:8092/**.

> 💡 Dane (baza SQLite + logi) zapisują się na NAS w folderze z `DATA_PATH`
> (domyślnie `/volume1/docker/discord-notify-bot`). Zobaczysz tam plik
> `discord-notify.sqlite` oraz katalog `logs/`.

---

## 3. Zmienne środowiskowe do uzupełnienia w Portainerze

W sekcji **Environment variables** stacku dodaj poniższe. Pełna lista z opisem jest
w pliku [`.env.example`](.env.example).

### Wymagane (żeby bot działał)

| Zmienna | Opis |
|---|---|
| `DISCORD_TOKEN` | Token bota z Discord Developer Portal (sekret!) |
| `DISCORD_CLIENT_ID` | Application ID bota |

### Zalecane / opcjonalne

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `APP_PORT` | `8092` | Port na NAS (`http://<IP>:APP_PORT`) |
| `DATA_PATH` | `/volume1/docker/discord-notify-bot` | Folder na NAS na bazę + logi |
| `POLL_INTERVAL_SECONDS` | `300` | Co ile sekund sprawdzać (min. 60) |
| `YOUTUBE_SHORT_MAX_SECONDS` | `180` | Film krótszy = Short, równy/dłuższy = zwykły film |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `DEBUG` | `false` | `true` = pełne logi DEBUG |
| `LOG_RETENTION_DAYS` | `7` | Po ilu dniach kasować stare pliki logów |
| `DISCORD_AUTHORIZED_GUILD_IDS` | – | ID serwerów autoryzowanych z góry (po przecinku) |
| `DISCORD_OWNER_IDS` | – | ID użytkowników mogących używać komend admina |
| `YOUTUBE_API_KEY` | – | Avatary YouTube + rozróżnianie Shorts/live |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | – | Wykrywanie live na Twitch |
| `PANEL_USER` / `PANEL_PASSWORD` | – | Login/hasło do panelu (Basic Auth) |
| `SEED_DEMO_DATA` | `false` | Wgrać dane demo przy pierwszym starcie |

> 🔐 **Bezpieczeństwo:** żadnych sekretów w repozytorium. Wszystkie tokeny/hasła/klucze
> wpisujesz wyłącznie jako zmienne środowiskowe w Portainerze. Plik `.env` jest w
> `.gitignore`. W repo jest tylko `.env.example` bez prawdziwych wartości.

---

## 4. Pierwsze uruchomienie

1. Po **Deploy the stack** odczekaj na zbudowanie obrazu (Portainer pokaże logi builda).
2. Sprawdź status kontenera: **Containers → discord-notify** powinien być
   `running (healthy)` (healthcheck odpytuje `/api/health`).
3. Otwórz panel: **http://192.168.0.32:8092/**
4. Wejdź do sekcji **Serwery Discord** → **autoryzuj** swój serwer przełącznikiem.
5. Na dashboardzie kliknij **➕ Dodaj profil**, podaj nazwę twórcy.
6. W profilu dodaj konta platform (wklej linki, np. `https://youtube.com/@kanal`).
   Avatar i nazwa pobiorą się automatycznie (jeśli platforma na to pozwala).
7. Wybierz serwer Discord i włącz interesujące Cię powiadomienia, ustaw kanał,
   tryb (wiadomość / embed / panel / przypięty panel), szablon — i kliknij
   **📨 Wyślij test na Discord**, by sprawdzić działanie.
8. Gotowe — aplikacja sama sprawdza nowe materiały co `POLL_INTERVAL_SECONDS`.

### Komendy bota (slash commands)

`/setup` · `/status` · `/profiles` · `/test_notification` · `/panel_create` ·
`/panel_refresh` · `/panel_remove` · `/notify_on` · `/notify_off` · `/channel_set` · `/help`

---

## 5. Sprawdzanie logów

Aplikacja loguje czytelnie na **stdout/stderr**, więc logi są od razu widoczne w Portainerze:

- **Portainer → Containers → discord-notify → Logs** (z opcją auto-refresh / „wrap lines").
- Poziomy: `INFO` (normalne), `WARN` (problemy bez zatrzymania), `ERROR` (błędy),
  `DEBUG` (po `DEBUG=true`). Linie `WARN`/`ERROR` idą na stderr.

Dodatkowo logi zapisywane są do plików na NAS:

```
/volume1/docker/discord-notify-bot/logs/app-YYYY-MM-DD.log
```

- 🔁 **Rotacja:** nowy plik każdego dnia, a pliki starsze niż `LOG_RETENTION_DAYS`
  (domyślnie 7 dni) są **automatycznie kasowane** — dysk NAS się nie zapcha.
- Logi kontenera Dockera też mają limit (`max-size: 10m`, `max-file: 5`) ustawiony
  w `docker-compose.yml`.

W panelu webowym znajdziesz też sekcję **Logi / Historia** (zdarzenia: wykryto,
wysłano, pominięto duplikat, błąd API, brak uprawnień, edycja panelu, nieudana wysyłka)
oraz **Diagnostykę** (status, liczba serwerów/profili, uptime, ostatnie błędy).

---

## 6. Aktualizacja aplikacji po zmianach w GitHub

Po wypchnięciu zmian na GitHub:

**Wariant A — w Portainerze (zalecany):**
1. **Stacks → discord-notify**.
2. Kliknij **Pull and redeploy** (pobiera najnowszy commit z Git i przebudowuje obraz).
3. ⚠️ **NIE zaznaczaj „Re-pull image"** — ten obraz nie istnieje w żadnym rejestrze,
   bo jest budowany lokalnie z `Dockerfile`. Zaznaczenie tej opcji kończy się błędem
   `pull access denied for discord-notify`. Stack ma już `pull_policy: build`, więc
   Docker zawsze **buduje** obraz zamiast go pobierać.
4. Portainer pobierze najnowszy kod z repo, przebuduje obraz i zrestartuje kontener.
   Dane (baza, logi) zostają nienaruszone na wolumenie.

> Jeśli mimo wszystko widzisz `pull access denied`: w edytorze stacku kliknij
> **Update the stack** z odznaczoną opcją „Re-pull image" — samo zaktualizowanie
> (redeploy) przebuduje obraz z nowego kodu.

**Wariant B — automatycznie:** w ustawieniach stacku włącz **GitOps updates /
Automatic updates** (polling repo), aby Portainer sam pobierał zmiany w interwale.

> Migracje bazy uruchamiają się automatycznie przy każdym starcie kontenera —
> nie musisz nic robić ręcznie. Nowe migracje dodawaj jako kolejne pliki
> `src/db/migrations/NNN_*.sql`.

> **Numer wersji** (widoczny w panelu, lewy górny róg i Diagnostyka) jest czytany
> z `package.json`, więc **aktualizuje się automatycznie** po przebudowie obrazu
> z nowym kodem. Jeśli po redeployu nadal widzisz starą wersję — obraz nie został
> przebudowany (patrz uwaga o „Re-pull image" powyżej) lub przeglądarka trzyma
> stary panel w cache (zrób **Ctrl + F5**).

---

## 7. Klucze API platform (opcjonalne)

| Platforma | Wymaga klucza? | Po co |
|---|---|---|
| **YouTube** | Opcjonalnie (`YOUTUBE_API_KEY`) | Bez klucza: wykrywanie **nowych filmów** działa (RSS). Z kluczem: dochodzą **avatary**, rozróżnianie **Shorts vs film** (po długości) oraz wykrywanie **live**. |
| **Twitch** | Tak (`TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`) | Wykrywanie **live start/end**, avatar, kategoria, liczba widzów. |
| **Kick** | Nie | Publiczne API — live start/end, avatar (best-effort). |
| **TikTok** | Nie (opcjonalnie `SIGN_API_KEY`) | **LIVE** przez `tiktok-live-connector` (node'owy odpowiednik [isaackogan/TikTokLive](https://github.com/isaackogan/TikTokLive)). **Nowe filmy** przez wbudowany **yt-dlp** (`YTDLP_ENABLED=true`), z fallbackiem do scrapingu. |
| **Instagram** | **Tak** (`INSTAGRAM_SESSION_ID`) ⚠️ | Instagram **nie ma** darmowego publicznego API do tego celu. Posty/Reels/Stories wymagają cookie zalogowanej sesji — bez niego wykrywanie w ogóle się nie uruchomi. |

- **YouTube API key:** Google Cloud Console → włącz *YouTube Data API v3* → utwórz *API key*.
- **Twitch:** <https://dev.twitch.tv/console/apps> → *Register Your Application* →
  skopiuj *Client ID* i *Client Secret*.
- **TikTok LIVE:** działa od razu (`TIKTOK_LIVE_ENABLED=true`). Jeśli trafisz na
  limity zapytań, załóż darmowy klucz na <https://www.eulerstream.com> i ustaw
  `SIGN_API_KEY`. Uwaga: biblioteka wykrywa **transmisje live**, nie nowe filmy.
- **Instagram — ⚠️ przeczytaj przed użyciem:** najłatwiej zainstaluj wtyczkę
  Firefox z folderu [`browser-extension/`](browser-extension/README.md) —
  automatycznie wysyła komplet wymaganych cookies za każdym razem, gdy
  przeglądasz `instagram.com`. Ręcznie w panelu → **Ustawienia** (pole
  „Instagram Session") trzeba wkleić **JSON, nie samo `sessionid`** — Instagram
  odrzuca zapytania bez poprawnego tokenu CSRF:
  `{"sessionid":"...","csrftoken":"...","ds_user_id":"..."}` (wszystkie trzy
  cookies z zalogowanej sesji, patrz DevTools przeglądarki → Storage →
  Cookies → instagram.com). **To jest automatyzacja konta i łamie regulamin
  Instagrama** — realne ryzyko ograniczenia/bana tego konta. Użyj
  **dedykowanego, zapasowego konta**, nigdy głównego. Detekcja korzysta
  z **Instaloadera** (biblioteka Pythona budowana wyłącznie pod Instagrama,
  wbudowana w obraz) zamiast yt-dlp — Instagram aktywnie zwalcza
  automatyzację, więc mimo to możliwe są okresowe błędy (403/429, wygasła
  sesja); w takim wypadku sprawdź w panelu → **Logi / Historia** dokładny
  komunikat.

---

## 8. Architektura

```
docker-compose.yml      # stack: build z Dockerfile, port 8092, wolumen, healthcheck, log-rotation
Dockerfile              # node:22-slim, multi-stage, tini, healthcheck
.env.example            # wzór zmiennych (bez sekretów)
src/
  index.js              # start: migracje -> web -> bot -> poller -> retencja
  config.js             # konfiguracja z ENV
  logger.js             # logi stdout/stderr + pliki + rotacja 7 dni
  constants.js          # typy zdarzeń, tryby, zmienne szablonów, domyślne szablony
  db/                   # SQLite (better-sqlite3) + runner migracji + seed
  platforms/            # youtube / tiktok / twitch / kick (resolve + check)
  notifications/        # silnik szablonów (walidacja/preview) + dispatcher (Discord)
  bot/                  # klient discord.js, slash commands, uprawnienia, panele
  poller.js             # cykliczne sprawdzanie + anty-duplikaty
  web/                  # serwer Express + REST API
public/                 # frontend (HTML/CSS/JS, bez kroku build) — dark mode, responsywny
```

**Stos:** Node.js 22 · Express · discord.js v14 · SQLite (better-sqlite3). Bot i panel
działają w **jednym kontenerze/procesie** (brak problemów ze współdzieleniem bazy),
SQLite trzyma się prosto i bez osobnego kontenera bazy — idealne na NAS.

**Tryb „panel":** bot zapisuje `message_id` wysłanej wiadomości i przy kolejnych
zdarzeniach **edytuje tę samą wiadomość** zamiast wysyłać nową.

**Tryb „przypięty panel" (hybrydowy):** bot utrzymuje i edytuje stały, przypięty
panel ze statusem, a **dodatkowo** przy każdym nowym zdarzeniu wysyła osobną
wiadomość z pingiem roli (`{role_ping}` w treści, `allowed_mentions` ograniczone
do wybranej roli) — żeby ludzie dostali realne powiadomienie. Po wysłaniu nowej
bot **usuwa swoją poprzednią tymczasową** wiadomość tego samego typu (pojedynczo,
tylko własne wiadomości zapisane w tabeli `temp_notifications` — nigdy panelu,
nigdy wiadomości użytkowników, bez bulk-delete). Stan przeżywa restart kontenera.

**Ustawienia / Klucze API:** w panelu (sekcja **Ustawienia**) możesz wpisać klucze
API (YouTube, Twitch, TikTok SIGN) bez restartu — nadpisują zmienne środowiskowe
i są maskowane w UI.

**Anty-duplikaty:** każde obsłużone zdarzenie zapisywane jest w tabeli `seen_items`
(trwale w SQLite), więc restart kontenera **nie powtórzy** powiadomień.

---

## 9. FAQ / Rozwiązywanie problemów

**Kontener `unhealthy` lub brak panelu** — sprawdź logi w Portainerze. Najczęściej zła
ścieżka `DATA_PATH` (folder nie istnieje) lub zajęty port (zmień `APP_PORT`).

**Bot offline w diagnostyce** — brak/niepoprawny `DISCORD_TOKEN`. Panel działa nawet bez
tokenu, ale powiadomienia wymagają działającego bota.

**Slash commands się nie pojawiają** — bot rejestruje komendy per-serwer od razu po
dołączeniu; globalne mogą propagować się do ~1h. Użyj `/help`, by sprawdzić.

**„Brak uprawnień" przy wysyłce** — nadaj botowi na kanale: *Send Messages*, *Embed Links*,
a dla paneli także *Manage Messages*. Panel i logi jasno pokazują, czego brakuje.

**Powiadomienia nie wychodzą** — upewnij się, że serwer jest **autoryzowany** (sekcja
Serwery), powiadomienie **włączone**, ustawiony **kanał**, a token bota działa.

**Uprawnienia do plików na NAS** — kontener pisze do `DATA_PATH`. Jeśli wystąpią błędy
zapisu, w File Station nadaj folderowi prawa zapisu (lub utwórz go ręcznie przed deployem).

---

## Licencja

MIT
