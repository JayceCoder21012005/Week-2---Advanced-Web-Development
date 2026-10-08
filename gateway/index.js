import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORTS, SERVICE_URLS } from '../shared/config.js';
import { logRequest } from '../shared/service.js';
import { createClients } from './clients.js';
import { composeDashboard, composeMobileOrders } from './bff.js';
import { createGraphQL } from './graphql.js';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

export function createGatewayApp({ urls = SERVICE_URLS, gqlMode = process.env.GQL_MODE ?? 'loader' } = {}) {
  const app = express();
  app.get('/', (req, res) => res.redirect('/dashboard.html'));
  app.use(express.static(dir('../web/')));
  app.use('/shared', express.static(dir('../shared/')));
  // Thumbnail giả (SVG sinh tại chỗ) → demo chạy offline, không phụ thuộc mạng ngoài.
  app.get('/thumbs/:file', (req, res) => {
    const id = req.params.file.replace(/\.svg$/, '').replace(/\W/g, '').slice(0, 8);
    const hue = ([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) * 47) % 360; // id liền nhau → màu cách xa
    res.type('image/svg+xml').set('cache-control', 'max-age=86400').send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="10" fill="hsl(${hue} 65% 55%)"/>`
      + `<text x="32" y="40" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">${id}</text></svg>`);
  });
  app.get('/config',(req, res) => res.json({ gqlMode, dataset: process.env.DATASET ?? 'small' }));

  app.use((req, res, next) => { // mỗi API request có 1 trace id, truyền xuống các service
    req.headers['x-request-id'] ??= `gw-${randomUUID().slice(0, 8)}`;
    res.set('x-request-id', req.headers['x-request-id']);
    logRequest('gateway', req.headers['x-request-id'], req);
    next();
  });

  // Mỗi loại client một endpoint BFF.
  const bff = (compose) => async (req, res) => {
    try {
      res.json(await compose(createClients(req.headers['x-request-id'], urls), req.params.userId));
    } catch (e) {
      res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
    }
  };
  app.get('/bff/web/dashboard/:userId', bff(composeDashboard));
  app.get('/bff/mobile/orders/:userId', bff(composeMobileOrders));

  const yoga = createGraphQL({ urls, mode: gqlMode });
  app.use(yoga.graphqlEndpoint, yoga); // POST /graphql; GET /graphql mở GraphiQL

  return app;
}

if (import.meta.main) {
  createGatewayApp().listen(PORTS.gateway, () =>
    console.log(`gateway :${PORTS.gateway} GQL_MODE=${process.env.GQL_MODE ?? 'loader'} → http://localhost:${PORTS.gateway}/`));
}
