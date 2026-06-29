import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, isAuthEnabled } from '../config.js';
import { createLogger } from '../logger.js';
import { apiRouter } from './api.js';

const log = createLogger('web');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

function basicAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  // Allow unauthenticated health checks.
  if (req.path === '/api/health') return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === config.auth.user && pass === config.auth.password) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Discord Notify"');
  return res.status(401).send('Authentication required');
}

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Lightweight request logging (debug level keeps normal logs clean).
  app.use((req, _res, next) => {
    log.debug(`${req.method} ${req.path}`);
    next();
  });

  app.use(basicAuth);
  app.use('/api', apiRouter);

  app.use(express.static(publicDir));
  // SPA fallback for client-side routing.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

export function startWeb() {
  const app = createServer();
  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      log.info('Web panel listening', { url: `http://${config.host}:${config.port}` });
      resolve(server);
    });
  });
}
