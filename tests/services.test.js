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
