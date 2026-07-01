// Watches the Instagram session cookies and pushes them to the configured
// Discord Notify instance whenever they change, so the app can authenticate
// its Instaloader calls without any manual copy/paste.
//
// Instagram's GraphQL API requires more than just `sessionid`: Instaloader's
// proper session-loading path also needs `csrftoken` (sent as the
// X-CSRFToken header on every query) and `ds_user_id` (marks the session as
// logged in internally, unlocking code paths gated behind that flag). A
// sessionid cookie alone gets rejected with a plain 403 — this was a real bug
// fixed after confirming it against Instaloader's own source.

const REQUIRED_COOKIES = ['sessionid', 'csrftoken', 'ds_user_id'];

const KEY_APP_URL = 'appUrl';
const KEY_USER = 'basicUser';
const KEY_PASS = 'basicPass';
const KEY_LAST_SENT = 'lastSentSession';
const KEY_LAST_SYNC = 'lastSyncAt';

async function getSettings() {
  const stored = await browser.storage.local.get([KEY_APP_URL, KEY_USER, KEY_PASS]);
  return {
    appUrl: (stored[KEY_APP_URL] || '').replace(/\/+$/, ''),
    user: stored[KEY_USER] || '',
    pass: stored[KEY_PASS] || '',
  };
}

/** Read the full session cookie set Instaloader needs, or null if incomplete. */
async function readInstagramSession() {
  const cookies = await browser.cookies.getAll({ domain: 'instagram.com' });
  const byName = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
  const session = {};
  for (const name of REQUIRED_COOKIES) {
    if (!byName[name]) return null; // incomplete session — not logged in (yet)
    session[name] = byName[name];
  }
  return session;
}

async function pushSession(session) {
  const { appUrl, user, pass } = await getSettings();
  if (!appUrl) {
    return { ok: false, error: 'Brak skonfigurowanego adresu aplikacji — otwórz opcje wtyczki.' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (user && pass) headers.Authorization = 'Basic ' + btoa(`${user}:${pass}`);

  try {
    const res = await fetch(`${appUrl}/api/config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ instagram_session_id: JSON.stringify(session) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        `Nie udało się połączyć z ${appUrl}: ${err.message}. ` +
        'Sprawdź, czy adres jest poprawny, czy komputer jest w tej samej sieci co NAS, ' +
        'i czy rozszerzenie zostało przeładowane po ostatniej aktualizacji (about:addons → ... → Przeładuj).',
    };
  }
}

async function syncIfChanged({ force = false } = {}) {
  const session = await readInstagramSession();
  if (!session) {
    return {
      ok: false,
      error:
        'Nie znaleziono pełnego zestawu cookies (sessionid, csrftoken, ds_user_id) — ' +
        'zaloguj się na instagram.com na koncie-bocie.',
    };
  }

  const serialized = JSON.stringify(session);
  const { [KEY_LAST_SENT]: lastSent } = await browser.storage.local.get(KEY_LAST_SENT);
  if (!force && serialized === lastSent) {
    return { ok: true, unchanged: true };
  }

  const result = await pushSession(session);
  if (result.ok) {
    await browser.storage.local.set({
      [KEY_LAST_SENT]: serialized,
      [KEY_LAST_SYNC]: new Date().toISOString(),
    });
  }
  return result;
}

// Fires once a top-level navigation to instagram.com finishes loading.
browser.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return; // top-level frames only
    syncIfChanged().catch(() => {});
  },
  { url: [{ hostContains: 'instagram.com' }] }
);

// Also react immediately if any of the required cookies change (e.g.
// re-login, switch account) without needing a fresh page navigation.
browser.cookies.onChanged.addListener((changeInfo) => {
  const c = changeInfo.cookie;
  if (!changeInfo.removed && REQUIRED_COOKIES.includes(c.name) && c.domain.includes('instagram.com')) {
    syncIfChanged().catch(() => {});
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'manual-sync') return syncIfChanged({ force: true });
  if (msg?.type === 'get-status') return getStatus();
  return undefined;
});

async function getStatus() {
  const stored = await browser.storage.local.get([KEY_LAST_SYNC, KEY_LAST_SENT]);
  return { lastSync: stored[KEY_LAST_SYNC] || null, hasSession: Boolean(stored[KEY_LAST_SENT]) };
}
