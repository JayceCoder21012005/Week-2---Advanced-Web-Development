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

/** Product Service giả: batch trả rỗng, lẻ trả 404 — product id không tồn tại. */
async function startWithEmptyProducts(gqlMode) {
  const { default: express } = await import('express');
  const stub = express();
  stub.get('/products', (req, res) => res.json([]));
  stub.get('/products/:id', (req, res) => res.status(404).json({ error: 'product not found' }));
  const u = createUserApp({ dataset: 'small' });
  const o = createOrderApp({ dataset: 'small' });
  const [us, os, ps] = await Promise.all([listen(u.app), listen(o.app), listen(stub)]);
  const gw = await listen(createGatewayApp({ urls: { user: us.url, order: os.url, product: ps.url }, gqlMode }));
  return { url: gw.url, close: () => close(us.server, os.server, ps.server, gw.server) };
}

for (const gqlMode of ['naive', 'loader']) {
  test(`product không tồn tại → BFF và GraphQL ${gqlMode} đều đánh dấu lỗi giống baseline`, async () => {
    const s = await startWithEmptyProducts(gqlMode);
    try {
      const bff = await (await fetch(`${s.url}/bff/web/dashboard/u1`)).json();
      const body = await gql(s.url);
      for (const errors of [bff.errors, body.errors]) {
        assert.equal(errors.length, 5);
        assert.equal(errors.find((e) => e.path[2] === 0).message, '/products/p1 → HTTP 404');
      }
    } finally { s.close(); }
  });
}

test('User Service sập → fetcher GraphQL báo lỗi, không coi là "không tìm thấy user"', async () => {
  const { createFetchers } = await import('../web/fetchers.js');
  const s = await startInProcess();
  const dead = await listen(createUserApp({ dataset: 'small' }).app);
  close(dead.server); // cổng đã đóng → kết nối bị từ chối
  const gw = await listen(createGatewayApp({ urls: { user: dead.url, order: s.url, product: s.url } }));
  try {
    await assert.rejects(createFetchers({ services: {}, gateway: gw.url }).graphql('u1'));
  } finally { s.close(); close(gw.server); }
});

/** Response mobile chỉ được chứa đúng các key mobile cần. */
function assertMobileShape(orders) {
  for (const o of orders) {
    assert.deepEqual(Object.keys(o).sort(), ['id', 'product', 'status']);
    if (o.product) assert.deepEqual(Object.keys(o.product).sort(), ['name', 'thumbnail']);
  }
}

test('BFF mobile: endpoint riêng, chỉ field mobile, 1 call product', async () => {
  const s = await startInProcess();
  try {
    const vm = await (await fetch(`${s.url}/bff/mobile/orders/u1`)).json();
    assert.deepEqual(Object.keys(vm).sort(), ['errors', 'orders']);
    assert.equal(vm.orders.length, 5);
    assertMobileShape(vm.orders);
    assert.equal(s.product.calls, 1);
    assert.equal((await fetch(`${s.url}/bff/mobile/orders/nope`)).status, 404);
  } finally { s.close(); }
});

test('GraphQL MobileOrders: cùng endpoint, query khác → chỉ field mobile, khớp BFF mobile', async () => {
  const { MOBILE_ORDERS_QUERY } = await import('../shared/contract.js');
  const s = await startInProcess({ gqlMode: 'loader' });
  try {
    const body = await fetch(`${s.url}/graphql`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: MOBILE_ORDERS_QUERY, variables: { userId: 'u1' } }),
    }).then((r) => r.json());
    assert.deepEqual(Object.keys(body.data.user), ['orders']);
    assertMobileShape(body.data.user.orders);
    assert.equal(s.product.calls, 1);
    const bff = await (await fetch(`${s.url}/bff/mobile/orders/u1`)).json();
    assert.deepEqual(body.data.user.orders, bff.orders);
  } finally { s.close(); }
});

test('fetchers.mobile: baseline, BFF, GraphQL trả cùng dữ liệu mobile', async () => {
  const { createFetchers } = await import('../web/fetchers.js');
  const u = createUserApp({ dataset: 'small' });
  const o = createOrderApp({ dataset: 'small' });
  const p = createProductApp({ dataset: 'small' });
  const [us, os, ps] = await Promise.all([listen(u.app), listen(o.app), listen(p.app)]);
  const gw = await listen(createGatewayApp({ urls: { user: us.url, order: os.url, product: ps.url } }));
  try {
    const f = createFetchers({ services: { user: us.url, order: os.url, product: ps.url }, gateway: gw.url });
    const [base, bff, gql] = [await f.mobile.baseline('u1'), await f.mobile.bff('u1'), await f.mobile.graphql('u1')];
    assert.equal(base.orders.length, 5);
    assert.deepEqual(bff, base);
    assert.deepEqual(gql, base);
  } finally { close(us.server, os.server, ps.server, gw.server); }
});
