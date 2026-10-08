import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORTS, SERVICE_URLS } from '../shared/config.js';
import { logRequest } from '../shared/service.js';
import { createClients } from './clients.js';
import { composeDashboard } from './bff.js';
import { createGraphQL } from './graphql.js';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

export function createGatewayApp({ urls = SERVICE_URLS, gqlMode = process.env.GQL_MODE ?? 'loader' } = {}) {
  const app = express();
  app.get('/', (req, res) => res.redirect('/dashboard.html'));
  app.use(express.static(dir('../web/')));
  app.use('/shared', express.static(dir('../shared/')));
  app.get('/config', (req, res) => res.json({ gqlMode, dataset: process.env.DATASET ?? 'small' }));

  app.use((req, res, next) => { // mỗi API request có 1 trace id, truyền xuống các service
    req.headers['x-request-id'] ??= `gw-${randomUUID().slice(0, 8)}`;
    res.set('x-request-id', req.headers['x-request-id']);
    logRequest('gateway', req.headers['x-request-id'], req);
    next();
  });

  app.get('/bff/web/dashboard/:userId', async (req, res) => {
    try {
      res.json(await composeDashboard(createClients(req.headers['x-request-id'], urls), req.params.userId));
    } catch (e) {
      res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
    }
  });

  const yoga = createGraphQL({ urls, mode: gqlMode });
  app.use(yoga.graphqlEndpoint, yoga); // POST /graphql; GET /graphql mở GraphiQL

  return app;
}

if (import.meta.main) {
  createGatewayApp().listen(PORTS.gateway, () =>
    console.log(`gateway :${PORTS.gateway} GQL_MODE=${process.env.GQL_MODE ?? 'loader'} → http://localhost:${PORTS.gateway}/`));
}
