# API Composition (Baseline / BFF / GraphQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng 3 service REST (JSON riêng) + gateway (BFF + GraphQL) + trang dashboard web, rồi đo/so sánh baseline vs BFF vs GraphQL (N+1 trước/sau DataLoader) và hành vi khi Product Service lỗi.

**Architecture:** User/Order/Product là 3 app Express độc lập, mỗi app đọc file JSON riêng qua repository có bộ đếm. Gateway (Express) phục vụ trang web tĩnh, `GET /bff/web/dashboard/:userId` và `POST /graphql` (graphql-yoga). Browser và Node dùng chung `shared/contract.js` (view-model, lỗi, query) nên 3 biến thể trả **cùng một object** và dùng chung `render()`.

**Tech Stack:** Node 26 (ESM, native fetch, `node:test`), express 5, cors, graphql + graphql-yoga, dataloader, concurrently, playwright (dùng Edge có sẵn).

**Spec:** `docs/00-plan.md`

## Global Constraints

- Cổng: gateway 4000, user 4001, order 4002, product 4003 (`shared/config.js`).
- Chỉ client **web**; không có endpoint/query mobile.
- Mỗi service chỉ đọc `data/<DATASET>/<bảng>.json` của mình; `DATASET=small|large`, mặc định `small`.
- 1 DB query = 1 lần gọi hàm repository (batch `findByIds` = 1).
- `GQL_MODE=naive|loader` (mặc định `loader`); DataLoader tạo **mới mỗi request**.
- Policy lỗi: timeout product 1000 ms; trả 200 với `product: null` + `errors: [{ path: ['user','orders',i,'product'], message }]`; không bịa tên/giá.
- `PRODUCT_FAULT=none|slow|error`, `PRODUCT_DELAY_MS` mặc định 2000.
- View-model chung: `{ user: { id, name, email, orders: [{ id, qty, unitPrice, status, createdAt, product: { id, name, price, thumbnail } | null }] } | null, errors: [] }`.
- `QUIET=1` tắt log request.

## Review Focus

1. Product chậm hơn timeout → BFF/GraphQL trả partial trong ~1 s, không treo (test ở Task 4).
2. User không tồn tại → BFF 404, GraphQL `user: null` không lỗi, web hiện thông báo (test ở Task 4, 5).
3. User không có đơn → không gọi Product Service (test ở Task 4).
4. Product lặp giữa các đơn → batch chỉ chứa id duy nhất (test ở Task 4).
5. DataLoader dùng chung giữa các request (cache rò rỉ) → 2 request phải ra 2 call product (test ở Task 5).

## File map

| File | Trách nhiệm |
|---|---|
| `shared/config.js` | Cổng, URL service |
| `shared/contract.js` | View-model, `getJson`, lỗi chuẩn, `DASHBOARD_QUERY` (chạy cả browser lẫn Node) |
| `shared/service.js` | Khung service: CORS, metrics, log trace, `db()` đếm query, `loadTable` |
| `services/{user,order,product}/index.js` | Factory app + chạy khi là main |
| `gateway/clients.js` | Client HTTP gọi 3 service, truyền `x-request-id` |
| `gateway/bff.js` | `composeDashboard()` |
| `gateway/graphql.js` | Schema + resolvers + DataLoader |
| `gateway/index.js` | App gateway (static, BFF, GraphQL) |
| `web/dashboard.html`, `web/app.js`, `web/fetchers.js` | Trang + 3 fetcher |
| `scripts/seed.js` | Sinh `data/small`, `data/large` |
| `scripts/lib/stack.js` | Spawn/stop 4 process, reset/đọc metrics |
| `scripts/smoke.js`, `trace.js`, `verify.js`, `bench.js` | Kiểm tra nhanh, trace, đối chiếu, đo |
| `tests/*.test.js` | `node:test` |

---

### Task 1: Scaffold + dữ liệu mẫu

**Files:**
- Create: `package.json`, `.gitignore`, `shared/config.js`, `scripts/seed.js`, `data/{small,large}/*.json` (sinh ra)

**Interfaces:**
- Produces: `PORTS`, `urlOf(name)`, `SERVICE_URLS` từ `shared/config.js`; dữ liệu: user `u1` (5 đơn small / 200 đơn large), `u2` (3 đơn), product `p1..pN`.

- [ ] **Step 1: git init + package.json**

```bash
git init
```

`package.json`:
```json
{
  "name": "api-composition",
  "private": true,
  "type": "module",
  "scripts": {
    "seed": "node scripts/seed.js",
    "start": "concurrently -k -n user,order,product,gw \"node services/user/index.js\" \"node services/order/index.js\" \"node services/product/index.js\" \"node gateway/index.js\"",
    "test": "node --test tests/",
    "smoke": "node scripts/smoke.js",
    "trace": "node scripts/trace.js",
    "verify": "node scripts/verify.js",
    "bench": "node scripts/bench.js"
  }
}
```

`.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Cài thư viện**

Run: `npm i express cors graphql graphql-yoga dataloader concurrently` rồi `npm i -D playwright`
Expected: cài xong, không lỗi. (Không chạy `playwright install` — dùng Edge có sẵn.)

- [ ] **Step 3: `shared/config.js`**

```js
export const PORTS = { gateway: 4000, user: 4001, order: 4002, product: 4003 };
export const urlOf = (name) => `http://localhost:${PORTS[name]}`;
export const SERVICE_URLS = { user: urlOf('user'), order: urlOf('order'), product: urlOf('product') };
```

- [ ] **Step 4: `scripts/seed.js`**

```js
// Sinh dữ liệu giả, tái lập được (PRNG có seed cố định).
import { mkdirSync, writeFileSync } from 'node:fs';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Bàn phím cơ', 'Chuột không dây', 'Tai nghe Bluetooth', 'Màn hình 24 inch', 'Ổ SSD 1TB',
  'Webcam HD', 'Loa mini', 'Sạc dự phòng', 'Cáp USB-C', 'Đế tản nhiệt', 'Balo laptop', 'Bút cảm ứng',
  'Hub USB', 'Micro thu âm', 'Đèn bàn LED', 'Giá đỡ điện thoại', 'Thẻ nhớ 128GB', 'Router WiFi 6',
  'Bàn di chuột', 'Ghế công thái học'];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const USERS = [
  { id: 'u1', name: 'Nguyễn Văn An', email: 'an@example.com' },
  { id: 'u2', name: 'Trần Thị Bình', email: 'binh@example.com' },
];

function build(seed, nOrders, nProducts) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const products = NAMES.slice(0, nProducts).map((name, i) => ({
    id: `p${i + 1}`, name, price: (Math.floor(rand() * 50) + 1) * 10000,
    thumbnail: `https://picsum.photos/seed/p${i + 1}/64`, category: pick(['accessory', 'audio', 'storage', 'network']),
  }));
  const orders = [];
  const add = (userId, n) => {
    for (let i = 0; i < n; i++) {
      const p = pick(products); // nhiều đơn trùng product → có cái để dedup
      orders.push({
        id: `o${orders.length + 1}`, userId, productId: p.id, qty: 1 + Math.floor(rand() * 3),
        unitPrice: p.price, status: pick(STATUSES),
        createdAt: new Date(Date.UTC(2026, 0, 1) + orders.length * 3_600_000).toISOString(),
      });
    }
  };
  add('u1', nOrders);
  add('u2', 3);
  return { users: USERS, products, orders };
}

for (const [name, nOrders, nProducts] of [['small', 5, 3], ['large', 200, 20]]) {
  const dir = new URL(`../data/${name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [table, rows] of Object.entries(build(42, nOrders, nProducts))) {
    writeFileSync(new URL(`${table}.json`, dir), JSON.stringify(rows, null, 2));
  }
  console.log(`data/${name}: ${nOrders} đơn của u1, ${nProducts} product`);
}
```

- [ ] **Step 5: Chạy seed**

Run: `npm run seed`
Expected: in 2 dòng; `data/small/orders.json` có 8 đơn (5 của u1, 3 của u2), productId của u1 có ít nhất 1 giá trị lặp.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold project and seed data"
```

---

### Task 2: Khung service + 3 service REST

**Files:**
- Create: `shared/service.js`, `services/user/index.js`, `services/order/index.js`, `services/product/index.js`, `tests/helpers.js`, `tests/services.test.js`

**Interfaces:**
- Consumes: `PORTS` (Task 1).
- Produces:
  - `createService(name) → { app, metrics: { service, calls, dbQueries }, db(fn) }`, `loadTable(dataset, table)`, `datasetFromEnv()`, `logRequest(who, rid, req)`.
  - `createUserApp({ dataset }) → { app, metrics }`, `createOrderApp({ dataset })`, `createProductApp({ dataset, fault, delayMs })`.
  - HTTP: `GET /users/:id`, `GET /orders?userId=`, `GET /products/:id`, `GET /products?ids=a,b`, `GET /metrics`, `POST /metrics/reset`.
  - `tests/helpers.js`: `listen(app) → { server, url }`, `close(...servers)`.

- [ ] **Step 1: Viết test (fail)**

`tests/helpers.js`:
```js
export function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
  });
}
export function close(...servers) {
  for (const s of servers) { s.closeAllConnections(); s.close(); }
}
```

`tests/services.test.js`:
```js
process.env.QUIET = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserApp } from '../services/user/index.js';
import { createOrderApp } from '../services/order/index.js';
import { createProductApp } from '../services/product/index.js';
import { listen, close } from './helpers.js';

test('user: GET /users/:id, 404 khi không có; mỗi request = 1 call + 1 db query', async () => {
  const { app, metrics } = createUserApp({ dataset: 'small' });
  const { server, url } = await listen(app);
  try {
    assert.equal((await (await fetch(`${url}/users/u1`)).json()).name, 'Nguyễn Văn An');
    assert.equal((await fetch(`${url}/users/nope`)).status, 404);
    assert.deepEqual([metrics.calls, metrics.dbQueries], [2, 2]);
  } finally { close(server); }
});

test('order: lọc theo userId, thiếu userId → 400', async () => {
  const { app } = createOrderApp({ dataset: 'small' });
  const { server, url } = await listen(app);
  try {
    const orders = await (await fetch(`${url}/orders?userId=u1`)).json();
    assert.equal(orders.length, 5);
    assert.ok(orders.every((o) => o.userId === 'u1'));
    assert.equal((await fetch(`${url}/orders`)).status, 400);
  } finally { close(server); }
});

test('product: batch = 1 db query, giữ thứ tự, bỏ id không tồn tại', async () => {
  const { app, metrics } = createProductApp({ dataset: 'small' });
  const { server, url } = await listen(app);
  try {
    const list = await (await fetch(`${url}/products?ids=p3,p1,zz`)).json();
    assert.deepEqual(list.map((p) => p.id), ['p3', 'p1']);
    assert.deepEqual([metrics.calls, metrics.dbQueries], [1, 1]);
  } finally { close(server); }
});

test('metrics: GET /metrics và POST /metrics/reset không bị đếm', async () => {
  const { app } = createProductApp({ dataset: 'small' });
  const { server, url } = await listen(app);
  try {
    await fetch(`${url}/products/p1`);
    assert.equal((await (await fetch(`${url}/metrics`)).json()).calls, 1);
    await fetch(`${url}/metrics/reset`, { method: 'POST' });
    assert.deepEqual(await (await fetch(`${url}/metrics`)).json(), { service: 'product', calls: 0, dbQueries: 0 });
  } finally { close(server); }
});

test('product fault=error → 503, không chạm DB', async () => {
  const { app, metrics } = createProductApp({ dataset: 'small', fault: 'error' });
  const { server, url } = await listen(app);
  try {
    assert.equal((await fetch(`${url}/products/p1`)).status, 503);
    assert.equal(metrics.dbQueries, 0);
  } finally { close(server); }
});
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `npm test`
Expected: FAIL, `Cannot find module .../services/user/index.js`

- [ ] **Step 3: `shared/service.js`**

```js
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';

export const datasetFromEnv = () => process.env.DATASET ?? 'small';

/** "CSDL" của service: 1 file JSON riêng, nạp vào RAM lúc khởi động. */
export function loadTable(dataset, table) {
  return JSON.parse(readFileSync(new URL(`../data/${dataset}/${table}.json`, import.meta.url), 'utf8'));
}

/** Dòng trace: giờ, request id, ai nhận, method + url. */
export function logRequest(who, rid, req) {
  if (!process.env.QUIET) console.log(`${new Date().toISOString().slice(11, 23)} [${rid}] ${who} ${req.method} ${req.originalUrl}`);
}

export function createService(name) {
  const metrics = { service: name, calls: 0, dbQueries: 0 };
  const app = express();
  app.use(cors()); // baseline: browser gọi thẳng service khác origin
  app.use((req, res, next) => { res.set('Timing-Allow-Origin', '*'); next(); }); // để Resource Timing đọc được size
  // Khai báo TRƯỚC middleware đếm → không bị tính vào calls.
  app.get('/metrics', (req, res) => res.json(metrics));
  app.post('/metrics/reset', (req, res) => { metrics.calls = 0; metrics.dbQueries = 0; res.json(metrics); });
  app.use((req, res, next) => {
    metrics.calls++;
    logRequest(name, req.get('x-request-id') ?? 'browser', req);
    next();
  });
  /** Bọc hàm repository: mỗi lần gọi = 1 DB query. */
  const db = (fn) => (...args) => { metrics.dbQueries++; return fn(...args); };
  return { app, metrics, db };
}
```

- [ ] **Step 4: `services/user/index.js`**

```js
import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createUserApp({ dataset = datasetFromEnv() } = {}) {
  const { app, metrics, db } = createService('user');
  const users = new Map(loadTable(dataset, 'users').map((u) => [u.id, u]));
  const repo = { findById: db((id) => users.get(id)) };

  app.get('/users/:id', (req, res) => {
    const user = repo.findById(req.params.id);
    user ? res.json(user) : res.status(404).json({ error: 'user not found' });
  });
  return { app, metrics };
}

if (import.meta.main) {
  createUserApp().app.listen(PORTS.user, () => console.log(`user-service :${PORTS.user} DATASET=${datasetFromEnv()}`));
}
```

- [ ] **Step 5: `services/order/index.js`**

```js
import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createOrderApp({ dataset = datasetFromEnv() } = {}) {
  const { app, metrics, db } = createService('order');
  const orders = loadTable(dataset, 'orders');
  const repo = { findByUser: db((userId) => orders.filter((o) => o.userId === userId)) };

  app.get('/orders', (req, res) => {
    if (!req.query.userId) return res.status(400).json({ error: 'userId required' });
    res.json(repo.findByUser(req.query.userId));
  });
  return { app, metrics };
}

if (import.meta.main) {
  createOrderApp().app.listen(PORTS.order, () => console.log(`order-service :${PORTS.order} DATASET=${datasetFromEnv()}`));
}
```

- [ ] **Step 6: `services/product/index.js`**

```js
import { setTimeout as sleep } from 'node:timers/promises';
import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createProductApp({
  dataset = datasetFromEnv(),
  fault = process.env.PRODUCT_FAULT ?? 'none', // none | slow | error
  delayMs = Number(process.env.PRODUCT_DELAY_MS ?? 2000),
} = {}) {
  const { app, metrics, db } = createService('product');
  const products = new Map(loadTable(dataset, 'products').map((p) => [p.id, p]));
  const repo = {
    findById: db((id) => products.get(id)),
    findByIds: db((ids) => ids.map((id) => products.get(id)).filter(Boolean)), // 1 query cho cả lô
  };

  app.use('/products', async (req, res, next) => { // gây lỗi có chủ đích
    if (fault === 'error') return res.status(503).json({ error: 'product service unavailable (injected)' });
    if (fault === 'slow') await sleep(delayMs);
    next();
  });
  app.get('/products', (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    res.json(repo.findByIds(ids));
  });
  app.get('/products/:id', (req, res) => {
    const product = repo.findById(req.params.id);
    product ? res.json(product) : res.status(404).json({ error: 'product not found' });
  });
  return { app, metrics };
}

if (import.meta.main) {
  createProductApp().app.listen(PORTS.product, () =>
    console.log(`product-service :${PORTS.product} DATASET=${datasetFromEnv()} FAULT=${process.env.PRODUCT_FAULT ?? 'none'}`));
}
```

- [ ] **Step 7: Chạy test → PASS**

Run: `npm test`
Expected: 5 test PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: user/order/product services with metrics and fault injection"
```

---

### Task 3: Contract chung + trang web + baseline

**Files:**
- Create: `shared/contract.js`, `web/fetchers.js`, `web/app.js`, `web/dashboard.html`, `gateway/clients.js`, `gateway/index.js`, `scripts/smoke.js`, `docs/01-baseline.md`

**Interfaces:**
- Consumes: `SERVICE_URLS`, `PORTS`, `urlOf` (Task 1); `logRequest` (Task 2).
- Produces:
  - `shared/contract.js`: `toUserView(u)`, `toProductView(p)`, `toOrderView(o, p)`, `productError(i, message)`, `httpError(url, status)`, `timeoutError(url, ms)`, `getJson(url, { headers, timeoutMs })`, `PRODUCT_TIMEOUT_MS = 1000`, `DASHBOARD_QUERY`.
  - `web/fetchers.js`: `createFetchers({ services, gateway = '' }) → { baseline(userId), bff(userId), graphql(userId) }`, mỗi hàm trả view-model.
  - `gateway/clients.js`: `createClients(rid, urls = SERVICE_URLS) → { getUser, getOrdersByUser, getProduct, getProductsByIds }`.
  - `gateway/index.js`: `createGatewayApp({ urls, gqlMode }) → express app`.
  - Trang set `window.__done` (ms từ navigation start) sau khi render.

- [ ] **Step 1: `shared/contract.js`**

```js
// Dùng chung cho browser (baseline) và Node (gateway, scripts). Không import gì.

export const PRODUCT_TIMEOUT_MS = 1000;

export const toUserView = (u) => ({ id: u.id, name: u.name, email: u.email });
export const toProductView = (p) => (p ? { id: p.id, name: p.name, price: p.price, thumbnail: p.thumbnail } : null);
export const toOrderView = (o, p) => ({
  id: o.id, qty: o.qty, unitPrice: o.unitPrice, status: o.status, createdAt: o.createdAt, product: toProductView(p),
});
/** Cùng hình dạng với lỗi GraphQL: path tới field product của đơn thứ i. */
export const productError = (index, message) => ({ path: ['user', 'orders', index, 'product'], message });

const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
export function httpError(url, status) {
  const e = new Error(`${pathOf(url)} → HTTP ${status}`);
  e.status = status;
  return e;
}
export function timeoutError(url, ms) {
  const e = new Error(`${pathOf(url)} timeout after ${ms}ms`);
  e.status = 504;
  return e;
}

/** GET JSON; lỗi luôn là httpError/timeoutError để mọi biến thể có cùng thông điệp. */
export async function getJson(url, { headers, timeoutMs } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
  } catch (e) {
    if (e.name === 'TimeoutError') throw timeoutError(url, timeoutMs);
    throw e;
  }
  if (!res.ok) throw httpError(url, res.status);
  return res.json();
}

export const DASHBOARD_QUERY = `query Dashboard($userId: ID!) {
  user(id: $userId) {
    id name email
    orders { id qty unitPrice status createdAt product { id name price thumbnail } }
  }
}`;
```

- [ ] **Step 2: `web/fetchers.js`** (đủ 3 biến thể ngay; bff/graphql sẽ chạy được sau Task 4–5)

```js
import { getJson, toUserView, toOrderView, productError, DASHBOARD_QUERY, PRODUCT_TIMEOUT_MS } from '../shared/contract.js';

/** 3 cách lấy cùng một view-model. services: URL 3 service; gateway: '' (browser) hoặc URL gateway (Node). */
export function createFetchers({ services, gateway = '' }) {
  return {
    // Baseline: client tự gọi TUẦN TỰ 2 + N request rồi tự ghép.
    async baseline(userId) {
      const user = await getJson(`${services.user}/users/${userId}`);
      const orders = await getJson(`${services.order}/orders?userId=${userId}`);
      const views = [];
      const errors = [];
      for (const [i, o] of orders.entries()) {
        let product = null;
        try {
          product = await getJson(`${services.product}/products/${o.productId}`, { timeoutMs: PRODUCT_TIMEOUT_MS });
        } catch (e) {
          errors.push(productError(i, e.message));
        }
        views.push(toOrderView(o, product));
      }
      return { user: { ...toUserView(user), orders: views }, errors };
    },

    // BFF: 1 request, server đã ghép sẵn.
    bff: (userId) => getJson(`${gateway}/bff/web/dashboard/${userId}`),

    // GraphQL: 1 request, client chọn field.
    async graphql(userId) {
      const res = await fetch(`${gateway}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: DASHBOARD_QUERY, variables: { userId } }),
      });
      const body = await res.json();
      return { user: body.data?.user ?? null, errors: (body.errors ?? []).map(({ path, message }) => ({ path, message })) };
    },
  };
}
```

- [ ] **Step 3: `web/dashboard.html`**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Dashboard — API composition</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 24px; color: #222; }
    nav a { margin-right: 12px; padding: 4px 10px; border: 1px solid #ccc; border-radius: 6px; text-decoration: none; color: #333; }
    nav a.active { background: #333; color: #fff; }
    table { border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #eee; padding: 4px 10px; text-align: left; }
    .warn { color: #b45309; }
    #timing { color: #666; }
  </style>
</head>
<body>
  <nav>
    <a data-variant="baseline" href="?variant=baseline">Baseline (REST)</a>
    <a data-variant="bff" href="?variant=bff">BFF</a>
    <a data-variant="graphql" href="?variant=graphql">GraphQL</a>
  </nav>
  <h1 id="title">Đang tải…</h1>
  <p id="timing"></p>
  <p id="errors" class="warn"></p>
  <table>
    <thead><tr><th>Mã đơn</th><th>Product</th><th>SL</th><th>Đơn giá</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
    <tbody id="orders"></tbody>
  </table>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: `web/app.js`**

```js
import { createFetchers } from './fetchers.js';
import { SERVICE_URLS } from '../shared/config.js';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'baseline';
const userId = params.get('user') ?? 'u1';
const fetchers = createFetchers({ services: SERVICE_URLS });

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `${n.toLocaleString('vi-VN')} ₫`;

/** Một hàm render cho cả 3 biến thể. */
function render(vm) {
  if (!vm.user) { $('#title').textContent = `Không tìm thấy user ${userId}`; return; }
  $('#title').textContent = `${vm.user.name} — ${vm.user.orders.length} đơn`;
  $('#orders').innerHTML = vm.user.orders.map((o) => `<tr>
    <td>${esc(o.id)}</td>
    <td>${o.product ? esc(o.product.name) : '<span class="warn">⚠ không tải được product</span>'}</td>
    <td>${o.qty}</td><td>${money(o.unitPrice)}</td><td>${esc(o.status)}</td>
    <td>${o.createdAt.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');
  $('#errors').textContent = vm.errors.length ? `${vm.errors.length} lỗi — ${vm.errors[0].message}` : '';
}

for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.variant === variant);
try {
  render(await fetchers[variant](userId));
} catch (e) {
  $('#title').textContent = `Lỗi: ${e.message}`;
}
performance.mark('done');            // mốc "màn hình hoàn tất"
window.__done = performance.now();   // ms tính từ navigation start
$('#timing').textContent = `variant=${variant} · màn hình hoàn tất sau ${window.__done.toFixed(0)} ms`;
```

- [ ] **Step 5: `gateway/clients.js`**

```js
import { getJson, PRODUCT_TIMEOUT_MS } from '../shared/contract.js';
import { SERVICE_URLS } from '../shared/config.js';

/** Client gọi 3 service; mọi call mang x-request-id của request gốc để dựng trace. */
export function createClients(rid, urls = SERVICE_URLS) {
  const opts = { headers: { 'x-request-id': rid } };
  const productOpts = { ...opts, timeoutMs: PRODUCT_TIMEOUT_MS };
  const q = encodeURIComponent;
  return {
    getUser: (id) => getJson(`${urls.user}/users/${q(id)}`, opts),
    getOrdersByUser: (userId) => getJson(`${urls.order}/orders?userId=${q(userId)}`, opts),
    getProduct: (id) => getJson(`${urls.product}/products/${q(id)}`, productOpts),
    getProductsByIds: (ids) => getJson(`${urls.product}/products?ids=${ids.map(q).join(',')}`, productOpts),
  };
}
```

- [ ] **Step 6: `gateway/index.js`** (chưa có BFF/GraphQL)

```js
import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORTS, SERVICE_URLS } from '../shared/config.js';
import { logRequest } from '../shared/service.js';

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

  return app;
}

if (import.meta.main) {
  createGatewayApp().listen(PORTS.gateway, () =>
    console.log(`gateway :${PORTS.gateway} GQL_MODE=${process.env.GQL_MODE ?? 'loader'} → http://localhost:${PORTS.gateway}/`));
}
```

- [ ] **Step 7: `scripts/smoke.js`**

```js
// Mở trang thật trên Edge cho từng biến thể, in tiêu đề / thời gian / số dòng / lỗi. Cần `npm start` đang chạy.
import { chromium } from 'playwright';
import { urlOf } from '../shared/config.js';

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['baseline', 'bff', 'graphql'];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' });
const page = await browser.newPage();
for (const v of variants) {
  await page.goto(`${urlOf('gateway')}/dashboard.html?variant=${v}`);
  await page.waitForFunction(() => window.__done !== undefined, null, { timeout: 60_000 });
  console.log([v, await page.textContent('#title'), await page.textContent('#timing'),
    `rows=${await page.locator('#orders tr').count()}`, await page.textContent('#errors')].join(' | '));
}
await browser.close();
```

- [ ] **Step 8: Chạy baseline thật**

Run (nền): `npm start`
Run: `npm run smoke -- baseline`
Expected: `baseline | Nguyễn Văn An — 5 đơn | variant=baseline · màn hình hoàn tất sau …ms | rows=5 | ` ; log của `npm start` có 1 dòng user, 1 dòng order, 5 dòng product với rid `browser`.

- [ ] **Step 9: Viết `docs/01-baseline.md`**

Nội dung (tiếng Việt, dùng làm tài liệu + slide "Problem"):
1. Bài toán & 3 service: bảng contract (copy từ `docs/00-plan.md` mục 5), schema, cách sinh dữ liệu (`npm run seed`, small/large, product lặp).
2. Database-per-service: mỗi service một JSON, cách đếm DB query bằng `db()` (trích `shared/service.js`).
3. Baseline: trích hàm `baseline()` trong `web/fetchers.js`; giải thích vì sao là **2 + N request tuần tự** và đây là N+1 ở phía client.
4. Evidence: dán output `npm run smoke -- baseline` và đoạn log request thật từ `npm start`.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: shared contract, dashboard page and baseline variant"
```

---

### Task 4: BFF

**Files:**
- Create: `gateway/bff.js`, `tests/bff.test.js`, `tests/gateway.test.js`, `docs/02-bff.md`
- Modify: `gateway/index.js` (thêm route BFF)

**Interfaces:**
- Consumes: `createClients` (Task 3), `toUserView/toOrderView/productError` (Task 3), `createGatewayApp` (Task 3), service factories (Task 2), `listen/close` (Task 2).
- Produces: `composeDashboard(clients, userId) → Promise<viewModel>`; `GET /bff/web/dashboard/:userId` (404 nếu user không có, 502 nếu user/order lỗi).

- [ ] **Step 1: Unit test BFF với client giả (fail)**

`tests/bff.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDashboard } from '../gateway/bff.js';

const order = (id, productId) => ({ id, userId: 'u1', productId, qty: 1, unitPrice: 10, status: 'paid', createdAt: '2026-01-01T00:00:00.000Z' });

function fakeClients({ orders, productsFail = false }) {
  const batches = [];
  const clients = {
    getUser: async (id) => ({ id, name: 'An', email: 'an@example.com', secret: 'không được lộ' }),
    getOrdersByUser: async () => orders,
    getProduct: async () => { throw new Error('BFF không được gọi từng product'); },
    getProductsByIds: async (ids) => {
      batches.push(ids);
      if (productsFail) throw new Error('/products → HTTP 503');
      return ids.map((id) => ({ id, name: `N-${id}`, price: 10, thumbnail: 't', category: 'c' }));
    },
  };
  return { clients, batches };
}

test('gọi product 1 lần với id đã dedup; chỉ trả field cần hiển thị', async () => {
  const { clients, batches } = fakeClients({ orders: [order('o1', 'p1'), order('o2', 'p2'), order('o3', 'p1')] });
  const vm = await composeDashboard(clients, 'u1');
  assert.deepEqual(batches, [['p1', 'p2']]);
  assert.equal(vm.user.orders[2].product.name, 'N-p1');
  assert.equal(vm.user.secret, undefined);
  assert.equal(vm.user.orders[0].product.category, undefined);
  assert.deepEqual(vm.errors, []);
});

test('user không có đơn → không gọi product', async () => {
  const { clients, batches } = fakeClients({ orders: [] });
  const vm = await composeDashboard(clients, 'u1');
  assert.deepEqual(batches, []);
  assert.deepEqual(vm.user.orders, []);
});

test('product lỗi → partial: giữ user + đơn, product null, 1 lỗi mỗi đơn', async () => {
  const { clients } = fakeClients({ orders: [order('o1', 'p1'), order('o2', 'p1')], productsFail: true });
  const vm = await composeDashboard(clients, 'u1');
  assert.equal(vm.user.name, 'An');
  assert.deepEqual(vm.user.orders.map((o) => o.product), [null, null]);
  assert.deepEqual(vm.errors, [
    { path: ['user', 'orders', 0, 'product'], message: '/products → HTTP 503' },
    { path: ['user', 'orders', 1, 'product'], message: '/products → HTTP 503' },
  ]);
});
```

`tests/gateway.test.js`:
```js
process.env.QUIET = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserApp } from '../services/user/index.js';
import { createOrderApp } from '../services/order/index.js';
import { createProductApp } from '../services/product/index.js';
import { createGatewayApp } from '../gateway/index.js';
import { DASHBOARD_QUERY } from '../shared/contract.js';
import { listen, close } from './helpers.js';

/** Dựng 3 service + gateway trong cùng process, cổng ngẫu nhiên. */
async function startInProcess({ gqlMode = 'loader', fault = 'none', delayMs } = {}) {
  const u = createUserApp({ dataset: 'small' });
  const o = createOrderApp({ dataset: 'small' });
  const p = createProductApp({ dataset: 'small', fault, delayMs });
  const [us, os, ps] = await Promise.all([listen(u.app), listen(o.app), listen(p.app)]);
  const gw = await listen(createGatewayApp({ urls: { user: us.url, order: os.url, product: ps.url }, gqlMode }));
  return { url: gw.url, product: p.metrics, close: () => close(us.server, os.server, ps.server, gw.server) };
}

const gql = (url, userId = 'u1') => fetch(`${url}/graphql`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: DASHBOARD_QUERY, variables: { userId } }),
}).then((r) => r.json());

test('BFF: 5 đơn, product service nhận đúng 1 call / 1 db query', async () => {
  const s = await startInProcess();
  try {
    const vm = await (await fetch(`${s.url}/bff/web/dashboard/u1`)).json();
    assert.equal(vm.user.orders.length, 5);
    assert.ok(vm.user.orders.every((o) => o.product?.name));
    assert.deepEqual([s.product.calls, s.product.dbQueries], [1, 1]);
  } finally { s.close(); }
});

test('BFF: user không tồn tại → 404', async () => {
  const s = await startInProcess();
  try {
    assert.equal((await fetch(`${s.url}/bff/web/dashboard/nope`)).status, 404);
  } finally { s.close(); }
});

test('BFF: product chậm hơn timeout → partial trong ~1s', async () => {
  const s = await startInProcess({ fault: 'slow', delayMs: 1500 });
  try {
    const t = performance.now();
    const vm = await (await fetch(`${s.url}/bff/web/dashboard/u1`)).json();
    assert.ok(performance.now() - t < 1400);
    assert.equal(vm.user.orders.length, 5);
    assert.ok(vm.user.orders.every((o) => o.product === null));
    assert.match(vm.errors[0].message, /timeout after 1000ms/);
  } finally { s.close(); }
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `npm test`
Expected: FAIL `Cannot find module .../gateway/bff.js`

- [ ] **Step 3: `gateway/bff.js`**

```js
import { toUserView, toOrderView, productError } from '../shared/contract.js';

/**
 * BFF cho dashboard web:
 *   user ∥ orders (song song, không phụ thuộc nhau)
 *   → 1 batch GET /products?ids=… với id đã dedup
 *   → ghép thành view-model (chỉ field web cần).
 */
export async function composeDashboard(clients, userId) {
  const [user, orders] = await Promise.all([clients.getUser(userId), clients.getOrdersByUser(userId)]);
  const ids = [...new Set(orders.map((o) => o.productId))];

  let byId = new Map();
  let failure = null;
  if (ids.length) {
    try {
      byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
    } catch (e) {
      failure = e; // policy: partial + đánh dấu lỗi, không bịa dữ liệu
    }
  }
  return {
    user: { ...toUserView(user), orders: orders.map((o) => toOrderView(o, byId.get(o.productId))) },
    errors: failure ? orders.map((_, i) => productError(i, failure.message)) : [],
  };
}
```

- [ ] **Step 4: Thêm route vào `gateway/index.js`**

Thêm import:
```js
import { createClients } from './clients.js';
import { composeDashboard } from './bff.js';
```
Thêm ngay trước `return app;`:
```js
  app.get('/bff/web/dashboard/:userId', async (req, res) => {
    try {
      res.json(await composeDashboard(createClients(req.headers['x-request-id'], urls), req.params.userId));
    } catch (e) {
      res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
    }
  });
```

- [ ] **Step 5: Chạy → PASS**

Run: `npm test`
Expected: toàn bộ test PASS (5 service + 3 bff + 3 gateway).

- [ ] **Step 6: Chạy thật**

Run (restart `npm start` nền): `npm run smoke -- baseline bff`
Expected: cả 2 dòng `Nguyễn Văn An — 5 đơn`, rows=5. Log `npm start`: 1 dòng `gateway GET /bff/web/dashboard/u1`, cùng rid `gw-xxxx` ở user, order và **1** dòng `product GET /products?ids=…`.

- [ ] **Step 7: Viết `docs/02-bff.md`**

1. BFF là gì, khi nào dùng (1 endpoint/1 loại client, server ghép thay client).
2. Code: trích `composeDashboard` + route; giải thích song song user ∥ orders, dedup + batch.
3. **Call graph nội bộ** (sơ đồ ASCII: browser → gateway → user ∥ order → product batch) + log trace thật cùng rid từ Step 6.
4. Policy lỗi trong BFF (trích phần `failure`).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: BFF dashboard endpoint with batched, deduped product fetch"
```

---

### Task 5: GraphQL — tái hiện N+1 rồi sửa bằng DataLoader

**Files:**
- Create: `gateway/graphql.js`, `scripts/lib/stack.js`, `scripts/trace.js`, `docs/03-graphql-n+1.md`
- Modify: `gateway/index.js` (mount yoga), `tests/gateway.test.js` (thêm test GraphQL)

**Interfaces:**
- Consumes: `createClients` (Task 3), `DASHBOARD_QUERY` (Task 3), `startInProcess`, `gql` trong `tests/gateway.test.js` (Task 4), `createFetchers` (Task 3).
- Produces:
  - `createGraphQL({ urls, mode }) → yoga` (mount tại `/graphql`).
  - `scripts/lib/stack.js`: `startStack(env) → Promise<{ logs: string[], stop(): Promise }>`, `resetMetrics()`, `readMetrics() → { user, order, product }` (mỗi cái `{ service, calls, dbQueries }`).

- [ ] **Step 1: Thêm test GraphQL vào cuối `tests/gateway.test.js` (fail)**

```js
test('GraphQL naive: N+1 — product nhận 5 call cho 5 đơn', async () => {
  const s = await startInProcess({ gqlMode: 'naive' });
  try {
    const body = await gql(s.url);
    assert.equal(body.data.user.orders.length, 5);
    assert.equal(s.product.calls, 5);
  } finally { s.close(); }
});

test('GraphQL loader: 1 call product, dữ liệu trùng khớp BFF', async () => {
  const s = await startInProcess({ gqlMode: 'loader' });
  try {
    const body = await gql(s.url);
    assert.deepEqual([s.product.calls, s.product.dbQueries], [1, 1]);
    const bff = await (await fetch(`${s.url}/bff/web/dashboard/u1`)).json();
    assert.deepEqual(body.data.user, bff.user);
  } finally { s.close(); }
});

test('GraphQL loader: DataLoader theo từng request — 2 request = 2 call', async () => {
  const s = await startInProcess({ gqlMode: 'loader' });
  try {
    await gql(s.url);
    await gql(s.url);
    assert.equal(s.product.calls, 2);
  } finally { s.close(); }
});

test('GraphQL: user không tồn tại → user null, không lỗi', async () => {
  const s = await startInProcess();
  try {
    const body = await gql(s.url, 'nope');
    assert.equal(body.data.user, null);
    assert.equal(body.errors, undefined);
  } finally { s.close(); }
});

test('GraphQL: product lỗi → partial, product null, errors có path từng đơn', async () => {
  const s = await startInProcess({ fault: 'error' });
  try {
    const body = await gql(s.url);
    assert.equal(body.data.user.name, 'Nguyễn Văn An');
    assert.ok(body.data.user.orders.every((o) => o.product === null));
    assert.deepEqual(body.errors.map((e) => e.path.join('.')).sort(),
      [0, 1, 2, 3, 4].map((i) => `user.orders.${i}.product`).sort());
    assert.equal(body.errors[0].message, '/products → HTTP 503');
  } finally { s.close(); }
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `npm test`
Expected: các test GraphQL FAIL (404 ở `/graphql` → `res.json()` lỗi).

- [ ] **Step 3: `gateway/graphql.js`**

```js
import { createSchema, createYoga } from 'graphql-yoga';
import DataLoader from 'dataloader';
import { createClients } from './clients.js';

const typeDefs = /* GraphQL */ `
  type Query { user(id: ID!): User }
  type User { id: ID! name: String! email: String! orders: [Order!]! }
  type Order { id: ID! qty: Int! unitPrice: Float! status: String! createdAt: String! product: Product }
  type Product { id: ID! name: String! price: Float! thumbnail: String! }
`;

/** mode: 'naive' (tái hiện N+1) | 'loader' (DataLoader: batch + dedup trong 1 request). */
export function createGraphQL({ urls, mode }) {
  const resolvers = {
    Query: {
      user: async (_, { id }, ctx) => {
        try { return await ctx.clients.getUser(id); }
        catch (e) { if (e.status === 404) return null; throw e; }
      },
    },
    User: {
      orders: (user, _, ctx) => ctx.clients.getOrdersByUser(user.id),
    },
    Order: {
      product: (order, _, ctx) => (mode === 'naive'
        ? ctx.clients.getProduct(order.productId)        // N đơn → N call
        : ctx.productLoader.load(order.productId)),      // N đơn → 1 call
    },
  };

  return createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    maskedErrors: false, // giữ message thật ("/products → HTTP 503") để đánh dấu lỗi
    context: ({ request }) => {
      const clients = createClients(request.headers.get('x-request-id'), urls);
      // Loader mới cho MỖI request: dedup/cache chỉ sống trong request này.
      const productLoader = new DataLoader(async (ids) => {
        const byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
        return ids.map((id) => byId.get(id) ?? null);
      });
      return { clients, productLoader };
    },
  });
}
```

- [ ] **Step 4: Mount vào `gateway/index.js`**

Thêm import:
```js
import { createGraphQL } from './graphql.js';
```
Thêm ngay trước `return app;`:
```js
  const yoga = createGraphQL({ urls, mode: gqlMode });
  app.use(yoga.graphqlEndpoint, yoga); // POST /graphql; GET /graphql mở GraphiQL
```

- [ ] **Step 5: Chạy → PASS**

Run: `npm test`
Expected: toàn bộ PASS.

- [ ] **Step 6: `scripts/lib/stack.js`**

```js
// Spawn 4 process thật (user, order, product, gateway) với env cho trước.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { urlOf } from '../../shared/config.js';

const ENTRIES = {
  user: 'services/user/index.js', order: 'services/order/index.js',
  product: 'services/product/index.js', gateway: 'gateway/index.js',
};
const SERVICES = ['user', 'order', 'product'];

export async function startStack(env = {}) {
  const logs = [];
  const procs = Object.entries(ENTRIES).map(([name, file]) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL(`../../${file}`, import.meta.url))], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.stdout.on('data', (d) => logs.push(...String(d).split(/\r?\n/).filter(Boolean)));
    p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
    return p;
  });
  await waitReady();
  logs.length = 0; // bỏ log khởi động
  return {
    logs,
    stop: () => Promise.all(procs.map((p) => new Promise((r) => { p.once('exit', r); p.kill(); }))),
  };
}

async function waitReady() {
  const probes = [...SERVICES.map((s) => `${urlOf(s)}/metrics`), `${urlOf('gateway')}/config`];
  for (let i = 0; i < 100; i++) {
    try {
      await Promise.all(probes.map(async (u) => { if (!(await fetch(u)).ok) throw new Error(u); }));
      return;
    } catch { await sleep(100); }
  }
  throw new Error('stack không lên được — cổng 4000-4003 đang bị chiếm? (tắt `npm start` trước)');
}

export const resetMetrics = () =>
  Promise.all(SERVICES.map((s) => fetch(`${urlOf(s)}/metrics/reset`, { method: 'POST' })));

export async function readMetrics() {
  const out = {};
  for (const s of SERVICES) out[s] = await (await fetch(`${urlOf(s)}/metrics`)).json();
  return out;
}
```

- [ ] **Step 7: `scripts/trace.js`**

```js
// Ghi trace thật: GraphQL naive vs loader (N+1 trước/sau) và call graph BFF, trên dữ liệu small.
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startStack, resetMetrics, readMetrics } from './lib/stack.js';
import { createFetchers } from '../web/fetchers.js';
import { SERVICE_URLS, urlOf } from '../shared/config.js';

const fetchers = createFetchers({ services: SERVICE_URLS, gateway: urlOf('gateway') });
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });

for (const [file, variant, mode] of [['trace-graphql-naive', 'graphql', 'naive'], ['trace-graphql-loader', 'graphql', 'loader'], ['trace-bff', 'bff', 'loader']]) {
  const stack = await startStack({ DATASET: process.env.DATASET ?? 'small', GQL_MODE: mode });
  try {
    await resetMetrics();
    await fetchers[variant]('u1');
    await sleep(200); // chờ stdout các process về hết
    const m = await readMetrics();
    const summary = Object.values(m).map((x) => `${x.service}: calls=${x.calls} db=${x.dbQueries}`).join(' | ');
    const text = [`# ${variant} (GQL_MODE=${mode})`, ...[...stack.logs].sort(), '', summary].join('\n');
    writeFileSync(new URL(`../results/${file}.log`, import.meta.url), text);
    console.log(`${text}\n`);
  } finally { await stack.stop(); }
}
```

- [ ] **Step 8: Chạy trace**

Tắt `npm start` nếu đang chạy. Run: `npm run trace`
Expected: `trace-graphql-naive` có 5 dòng `product GET /products/pX` (có id lặp) và `product: calls=5 db=5`; `trace-graphql-loader` có 1 dòng `product GET /products?ids=…` và `product: calls=1 db=1`; `trace-bff` tương tự loader. Lặp với `DATASET=large` (PowerShell: `$env:DATASET='large'; npm run trace; Remove-Item Env:DATASET`) → naive `calls=200`, loader `calls=1`.

- [ ] **Step 9: Viết `docs/03-graphql-n+1.md`**

1. GraphQL: 1 endpoint, client chọn field; schema + query (trích).
2. N+1 là gì: resolver `Order.product` chạy 1 lần mỗi đơn → N call. Dán `results/trace-graphql-naive.log` (small) + số calls ở large (200).
3. Sửa bằng DataLoader: cơ chế gom trong 1 tick (batch), dedup key, cache theo request; vì sao tạo loader trong `context` (test "2 request = 2 call").
4. Dán `results/trace-graphql-loader.log`; bảng before/after small vs large (calls product: 5→1, 200→1).
5. So với BFF: GraphQL gọi user rồi mới orders (tuần tự theo cây resolver), BFF gọi song song.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: GraphQL endpoint with naive N+1 mode and DataLoader fix; trace script"
```

---

### Task 6: Đối chiếu dữ liệu + đo bằng Playwright

**Files:**
- Create: `scripts/verify.js`, `scripts/bench.js`, `docs/04-measurement.md`
- Output: `results/verify.txt`, `results/raw.csv`, `results/summary.md`, `results/waterfall.html`

**Interfaces:**
- Consumes: `startStack/resetMetrics/readMetrics` (Task 5), `createFetchers` (Task 3), `urlOf/SERVICE_URLS` (Task 1).

- [ ] **Step 1: `scripts/verify.js`**

```js
// Tiêu chí đạt: 3 biến thể trả cùng dữ liệu; N+1 trước/sau; hành vi khi Product lỗi/chậm.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startStack, resetMetrics, readMetrics } from './lib/stack.js';
import { createFetchers } from '../web/fetchers.js';
import { SERVICE_URLS, urlOf } from '../shared/config.js';

const fetchers = createFetchers({ services: SERVICE_URLS, gateway: urlOf('gateway') });
const out = [];
const log = (s) => { console.log(s); out.push(s); };
let failed = 0;
async function check(name, fn) {
  try { await fn(); log(`PASS ${name}`); }
  catch (e) { failed++; log(`FAIL ${name}\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}`); }
}
const errorPaths = (vm) => vm.errors.map((e) => e.path.join('.')).sort();

// 1) Dữ liệu trùng khớp + số call product
for (const dataset of ['small', 'large']) {
  for (const mode of ['naive', 'loader']) {
    const stack = await startStack({ DATASET: dataset, GQL_MODE: mode, QUIET: '1' });
    try {
      const base = await fetchers.baseline('u1');
      const bff = await fetchers.bff('u1');
      await resetMetrics();
      const gql = await fetchers.graphql('u1');
      const m = await readMetrics();
      const n = base.user.orders.length;
      const tag = `[${dataset}, GQL_MODE=${mode}]`;
      await check(`${tag} baseline == BFF`, () => assert.deepEqual(bff, base));
      await check(`${tag} baseline == GraphQL`, () => assert.deepEqual(gql, base));
      log(`  ${n} đơn; GraphQL → product calls=${m.product.calls}, db=${m.product.dbQueries}`);
      if (mode === 'naive') await check(`${tag} N+1: product calls == số đơn (${n})`, () => assert.equal(m.product.calls, n));
      else await check(`${tag} sau sửa: product calls == 1`, () => assert.equal(m.product.calls, 1));
    } finally { await stack.stop(); }
  }
}

// 2) Product lỗi / chậm → partial có đánh dấu lỗi, không bịa dữ liệu
for (const fault of ['error', 'slow']) {
  const stack = await startStack({ DATASET: 'small', GQL_MODE: 'loader', PRODUCT_FAULT: fault, QUIET: '1' });
  try {
    for (const v of ['baseline', 'bff', 'graphql']) {
      const t = performance.now();
      const vm = await fetchers[v]('u1');
      const ms = (performance.now() - t).toFixed(0);
      log(`  [fault=${fault}] ${v}: ${ms}ms, user=${vm.user?.name}, products=[${vm.user?.orders.map((o) => o.product?.name ?? 'null')}], errors=${vm.errors.length}, message="${vm.errors[0]?.message}"`);
      await check(`[fault=${fault}] ${v}: giữ user + đơn, product null, 1 lỗi/đơn`, () => {
        assert.equal(vm.user.id, 'u1');
        assert.ok(vm.user.orders.length > 0);
        assert.ok(vm.user.orders.every((o) => o.product === null));
        assert.deepEqual(errorPaths(vm), vm.user.orders.map((_, i) => `user.orders.${i}.product`).sort());
      });
    }
  } finally { await stack.stop(); }
}

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/verify.txt', import.meta.url), out.join('\n'));
log(failed ? `\n${failed} FAIL` : '\nALL PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Chạy verify**

Run: `npm run verify`
Expected: `ALL PASS`; dòng `[small, GQL_MODE=naive] … product calls=5`, `[large, GQL_MODE=naive] … calls=200`, loader `calls=1` ở cả hai; fault `slow` baseline ~5000ms (5 × timeout tuần tự), BFF/GraphQL ~1000ms. Nếu FAIL: ghi nhận nguyên văn vào doc (số liệu thật kể cả chưa đạt) rồi debug bằng superpowers:systematic-debugging.

- [ ] **Step 3: `scripts/bench.js`**

```js
// Đo trên browser thật (Edge qua Playwright): mỗi tổ hợp dataset × biến thể → restart stack → 1 lạnh + 5 ấm.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startStack, resetMetrics, readMetrics } from './lib/stack.js';
import { urlOf } from '../shared/config.js';

const RUNS = Number(process.env.RUNS ?? 6);
const DATASETS = ['small', 'large'];
const VARIANTS = [
  { name: 'baseline', page: 'baseline', env: {} },
  { name: 'bff', page: 'bff', env: {} },
  { name: 'graphql-naive', page: 'graphql', env: { GQL_MODE: 'naive' } },
  { name: 'graphql-loader', page: 'graphql', env: { GQL_MODE: 'loader' } },
];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rows = [];
const traces = [];

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' });
for (const dataset of DATASETS) {
  for (const v of VARIANTS) {
    const stack = await startStack({ DATASET: dataset, QUIET: '1', ...v.env }); // restart → lần 1 là "lạnh"
    try {
      for (let run = 1; run <= RUNS; run++) {
        await resetMetrics();
        const ctx = await browser.newContext(); // context mới: không cache HTTP giữa các lần
        const page = await ctx.newPage();
        await page.goto(`${urlOf('gateway')}/dashboard.html?variant=${v.page}&user=u1`);
        await page.waitForFunction(() => window.__done !== undefined, null, { timeout: 120_000 });
        const { done, resources } = await page.evaluate(() => ({
          done: window.__done,
          resources: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'fetch')
            .map((r) => ({ name: r.name, start: r.startTime, end: r.responseEnd, bytes: r.encodedBodySize })),
        }));
        await ctx.close();
        const m = await readMetrics();
        const row = {
          dataset, variant: v.name, run, mode: run === 1 ? 'cold' : 'warm', doneMs: +done.toFixed(1),
          clientRequests: resources.length, payloadBytes: resources.reduce((s, r) => s + r.bytes, 0),
          userCalls: m.user.calls, userDb: m.user.dbQueries, orderCalls: m.order.calls, orderDb: m.order.dbQueries,
          productCalls: m.product.calls, productDb: m.product.dbQueries,
        };
        rows.push(row);
        traces.push({ ...row, resources });
        console.log(Object.values(row).join('\t'));
      }
    } finally { await stack.stop(); }
  }
}
await browser.close();

const dir = new URL('../results/', import.meta.url);
mkdirSync(dir, { recursive: true });

// raw.csv — từng lần chạy
const cols = Object.keys(rows[0]);
writeFileSync(new URL('raw.csv', dir), [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n'));

// summary.md — lạnh riêng; ấm: median [min–max]
const lines = [
  '| dataset | variant | lạnh done (ms) | ấm done median [min–max] (ms) | client req | payload (B) | user calls/db | order calls/db | product calls/db |',
  '|---|---|---|---|---|---|---|---|---|',
];
const picked = [];
for (const dataset of DATASETS) {
  for (const v of VARIANTS) {
    const g = rows.filter((r) => r.dataset === dataset && r.variant === v.name);
    const cold = g.find((r) => r.mode === 'cold');
    const warm = g.filter((r) => r.mode === 'warm');
    const d = warm.map((r) => r.doneMs);
    const med = (k) => median(warm.map((r) => r[k]));
    lines.push(`| ${dataset} | ${v.name} | ${cold.doneMs} | ${median(d)} [${Math.min(...d)}–${Math.max(...d)}] | ${med('clientRequests')} | ${med('payloadBytes')} | ${med('userCalls')}/${med('userDb')} | ${med('orderCalls')}/${med('orderDb')} | ${med('productCalls')}/${med('productDb')} |`);
    const medRun = warm.reduce((a, b) => (Math.abs(b.doneMs - median(d)) < Math.abs(a.doneMs - median(d)) ? b : a));
    picked.push(traces.find((t) => t.dataset === dataset && t.variant === v.name && t.run === medRun.run));
  }
}
writeFileSync(new URL('summary.md', dir), `${lines.join('\n')}\n\nRUNS=${RUNS} (1 lạnh + ${RUNS - 1} ấm), browser=${process.env.BROWSER_CHANNEL ?? 'msedge'}, ${new Date().toISOString()}\n`);

// waterfall.html — lần ấm gần median nhất của mỗi tổ hợp, vạch đỏ = màn hình hoàn tất
const section = (w) => {
  const scale = Math.max(w.doneMs, ...w.resources.map((r) => r.end)) || 1;
  const pct = (x) => ((x / scale) * 100).toFixed(2);
  const bars = w.resources.map((r) => {
    const u = new URL(r.name);
    return `<div class="row"><span class="lbl">${u.host.split(':')[1]} ${u.pathname}${u.search}</span><span class="track"><i style="left:${pct(r.start)}%;width:${Math.max(0.3, pct(r.end - r.start))}%"></i><b style="left:${pct(w.doneMs)}%"></b></span><span class="ms">${(r.end - r.start).toFixed(1)}ms</span></div>`;
  }).join('');
  return `<section><h2>${w.dataset} · ${w.variant} · run ${w.run} — done ${w.doneMs} ms · ${w.resources.length} request · ${w.payloadBytes} B</h2>${bars}</section>`;
};
writeFileSync(new URL('waterfall.html', dir), `<!doctype html><meta charset="utf-8"><title>Waterfall</title>
<style>body{font:12px system-ui;margin:20px}h2{font-size:14px;margin:18px 0 6px}.row{display:flex;align-items:center;height:14px}
.lbl{width:260px;overflow:hidden;white-space:nowrap}.track{position:relative;flex:1;height:10px;background:#f3f3f3}
.track i{position:absolute;top:0;height:10px;background:#3b82f6}.track b{position:absolute;top:-2px;width:2px;height:14px;background:#dc2626}
.ms{width:70px;text-align:right}</style>
<p>Thanh xanh = request (thời điểm bắt đầu → responseEnd). Vạch đỏ = màn hình hoàn tất (window.__done). Trục tính từ navigation start.</p>
${picked.map(section).join('\n')}`);
console.log('→ results/raw.csv, results/summary.md, results/waterfall.html');
```

- [ ] **Step 4: Chạy bench**

Tắt `npm start`. Run: `npm run bench` (timeout ~10 phút)
Expected: in 48 dòng (2 × 4 × 6); `summary.md` có baseline small `client req = 7`, large `202`; bff/graphql `1`; product calls: baseline = số đơn, graphql-naive = số đơn, bff/graphql-loader = 1. Mở `results/waterfall.html` xem.

- [ ] **Step 5: Viết `docs/04-measurement.md`**

1. Định nghĩa từng chỉ số và **cách đếm** (bảng mục 7 của `docs/00-plan.md`, chỉ rõ code: `db()`, middleware đếm, Resource Timing, `window.__done`).
2. Chế độ lạnh/ấm, số lần chạy, cách chạy lại (`npm run bench`, `RUNS=…`).
3. Dán nguyên `results/summary.md`; link `results/raw.csv`, `results/waterfall.html` (kèm 1–2 ảnh chụp waterfall baseline vs bff ở large).
4. Dán `results/verify.txt` phần đối chiếu dữ liệu.
5. Nhận xét dựa trên số thật (không suy đoán): request client 2+N → 1; product calls theo N → 1; thời gian thay đổi thế nào giữa small/large; chỗ nào kết quả không như kỳ vọng.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: verify and Playwright bench with raw table, summary and waterfall"
```

---

### Task 7: Product Service chậm/lỗi + tài liệu tổng kết

**Files:**
- Create: `docs/05-fault.md`, `docs/06-tradeoffs.md`, `README.md`

**Interfaces:**
- Consumes: `PRODUCT_FAULT`, `PRODUCT_DELAY_MS` (Task 2); `results/verify.txt` (Task 6); `scripts/smoke.js` (Task 3).

- [ ] **Step 1: Chụp hành vi lỗi trên UI**

PowerShell:
```powershell
$env:PRODUCT_FAULT='error'; npm start
```
(cửa sổ khác) `npm run smoke` → ghi lại 3 dòng (mỗi biến thể: rows=5, errors "5 lỗi — …HTTP 503"). Lặp với `$env:PRODUCT_FAULT='slow'`. Xong: `Remove-Item Env:PRODUCT_FAULT`.
Expected: không biến thể nào hiển thị tên/giá giả; baseline slow chậm ~5s, BFF/GraphQL ~1s.

- [ ] **Step 2: Viết `docs/05-fault.md`**

1. Policy đã chọn (partial + errors[], timeout 1000 ms, không bịa dữ liệu) và lý do.
2. Cách gây lỗi (`PRODUCT_FAULT`, `PRODUCT_DELAY_MS`) — trích middleware trong `services/product/index.js`.
3. Hiện thực ở BFF (khối `failure`) vs GraphQL (field nullable + `maskedErrors: false`) — cùng hình dạng `errors[].path`.
4. Evidence: phần fault trong `results/verify.txt` + output smoke Step 1 (thời gian từng biến thể).

- [ ] **Step 3: Viết `docs/06-tradeoffs.md`**

1. Bảng so sánh Baseline / BFF / GraphQL: số request, độ phức tạp, ai sở hữu logic ghép, cache HTTP (GET BFF cache được, POST GraphQL khó), over/under-fetching, khả năng song song (BFF song song user∥orders; GraphQL tuần tự theo cây), rủi ro N+1, policy lỗi.
2. Giới hạn phép đo: localhost (độ trễ mạng ≈ 0), JSON trong RAM, 1 máy, Edge/Playwright overhead, số lần chạy ít, lạnh chỉ là restart process (không phải cold OS cache), không có client mobile.
3. Dàn ý thuyết trình 5 phần (Problem → `01`, Solution → `02`/`03`, Demo → các lệnh README, Evidence → `04`/`05`, Trade-off → `06`).

- [ ] **Step 4: Viết `README.md`**

Gồm: yêu cầu (Node ≥ 24, Microsoft Edge); `npm i`; `npm run seed`; `npm start` + URL `http://localhost:4000/` (3 tab biến thể), GraphiQL `http://localhost:4000/graphql`; biến môi trường (`DATASET`, `GQL_MODE`, `PRODUCT_FAULT`, `PRODUCT_DELAY_MS`, `QUIET`, `RUNS`, `BROWSER_CHANNEL`) với cú pháp PowerShell; `npm test`, `npm run verify`, `npm run trace`, `npm run bench` và file output trong `results/`; kịch bản demo trên dữ liệu small (baseline → BFF → GraphQL naive → loader → fault); mục lục `docs/`.

- [ ] **Step 5: Kiểm tra cuối**

Run: `npm test` và `npm run verify`
Expected: tất cả PASS (hoặc ghi rõ cái FAIL vào doc).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "docs: fault behaviour, trade-offs, README"
```
