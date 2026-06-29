const DEFAULT_UA =
  'Mozilla/5.0 (compatible; DiscordNotifyBot/1.0; +https://github.com/chust4/discord-notify)';

/**
 * fetch with a timeout and a sane default User-Agent. Throws on non-2xx unless
 * `allowStatuses` includes the status code.
 */
export async function httpGet(url, { headers = {}, timeoutMs = 15000, allowStatuses = [] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...headers },
      signal: controller.signal,
    });
    if (!res.ok && !allowStatuses.includes(res.status)) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGetJson(url, opts) {
  const res = await httpGet(url, opts);
  return res.json();
}

export async function httpGetText(url, opts) {
  const res = await httpGet(url, opts);
  return res.text();
}
