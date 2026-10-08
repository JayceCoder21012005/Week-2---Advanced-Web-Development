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
