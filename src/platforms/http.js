const DEFAULT_UA =
  'Mozilla/5.0 (compatible; DiscordNotifyBot/1.0; +https://github.com/chust4/discord-notify)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a timeout, a sane default User-Agent and automatic retries on
 * transient failures (network errors, timeouts, HTTP 429/5xx). Throws on a
 * non-2xx final response unless `allowStatuses` includes the status code.
 *
 * YouTube's RSS feed endpoint in particular returns sporadic HTTP 500s *and*
 * HTTP 404s for channels that demonstrably exist (confirmed by immediately
 * re-requesting the same URL) — an edge/CDN flakiness, not a real 404. Callers
 * that know a status is flaky-but-not-fatal for their endpoint can widen
 * retries via `retryStatuses` (e.g. youtube.js adds 404 for the feed URL).
 */
export async function httpGet(
  url,
  {
    headers = {},
    timeoutMs = 15000,
    allowStatuses = [],
    retries = 2,
    retryDelayMs = 800,
    retryStatuses = [],
  } = {}
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...headers },
        signal: controller.signal,
      });
      if (!res.ok && !allowStatuses.includes(res.status)) {
        const transient = res.status === 429 || res.status >= 500 || retryStatuses.includes(res.status);
        if (transient && attempt < retries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        // Don't dump the (usually HTML) error page into logs — just a snippet.
        const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
        const err = new Error(`HTTP ${res.status} for ${url}${body ? ` — ${body}` : ''}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const networkish = err.name === 'AbortError' || err.name === 'TypeError' || Boolean(err.cause);
      const retriableStatus =
        err.status === 429 || (err.status >= 500 && err.status < 600) || retryStatuses.includes(err.status);
      if (attempt < retries && (networkish || retriableStatus)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function httpGetJson(url, opts) {
  const res = await httpGet(url, opts);
  return res.json();
}

export async function httpGetText(url, opts) {
  const res = await httpGet(url, opts);
  return res.text();
}
