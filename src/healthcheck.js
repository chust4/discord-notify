// Standalone health probe used by the Docker HEALTHCHECK. Exits 0 when the web
// panel answers /api/health, non-zero otherwise.
import { config } from './config.js';

const url = `http://127.0.0.1:${config.port}/api/health`;

try {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(t);
  if (!res.ok) {
    console.error(`healthcheck: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  if (body.status !== 'ok') {
    console.error('healthcheck: unexpected body', body);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('healthcheck failed:', err.message);
  process.exit(1);
}
