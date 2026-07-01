// Watches for the Instagram `sessionid` cookie and pushes it to the
// configured Discord Notify instance whenever it changes, so the app can
// authenticate its yt-dlp calls without any manual copy/paste.

const KEY_APP_URL = 'appUrl';
const KEY_USER = 'basicUser';
const KEY_PASS = 'basicPass';
const KEY_LAST_SENT = 'lastSentSessionId';
const KEY_LAST_SYNC = 'lastSyncAt';

async function getSettings() {
  const stored = await browser.storage.local.get([KEY_APP_URL, KEY_USER, KEY_PASS]);
  return {
    appUrl: (stored[KEY_APP_URL] || '').replace(/\/+$/, ''),
    user: stored[KEY_USER] || '',
    pass: stored[KEY_PASS] || '',
  };
}

async function readInstagramSessionCookie() {
  const cookie = await browser.cookies.get({ url: 'https://www.instagram.com', name: 'sessionid' });
  return cookie ? cookie.value : null;
}

async function pushSessionId(sessionId) {
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
      body: JSON.stringify({ instagram_session_id: sessionId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Nie udało się połączyć z aplikacją: ${err.message}` };
  }
}

async function syncIfChanged({ force = false } = {}) {
  const sessionId = await readInstagramSessionCookie();
  if (!sessionId) {
    return { ok: false, error: 'Nie znaleziono cookie "sessionid" — zaloguj się na instagram.com.' };
  }

  const { [KEY_LAST_SENT]: lastSent } = await browser.storage.local.get(KEY_LAST_SENT);
  if (!force && sessionId === lastSent) {
    return { ok: true, unchanged: true };
  }

  const result = await pushSessionId(sessionId);
  if (result.ok) {
    await browser.storage.local.set({
      [KEY_LAST_SENT]: sessionId,
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

// Also react immediately if the cookie itself changes (e.g. re-login, switch
// account) without needing a fresh page navigation.
browser.cookies.onChanged.addListener((changeInfo) => {
  const c = changeInfo.cookie;
  if (!changeInfo.removed && c.name === 'sessionid' && c.domain.includes('instagram.com')) {
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
