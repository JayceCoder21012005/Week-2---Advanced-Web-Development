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

test('mobile: chỉ trả id, status, product.name, product.thumbnail; vẫn 1 batch đã dedup', async () => {
  const { composeMobileOrders } = await import('../gateway/bff.js');
  const { clients, batches } = fakeClients({ orders: [order('o1', 'p1'), order('o2', 'p1')] });
  const vm = await composeMobileOrders(clients, 'u1');
  assert.deepEqual(batches, [['p1']]);
  assert.deepEqual(vm, {
    orders: [
      { id: 'o1', status: 'paid', product: { name: 'N-p1', thumbnail: 't' } },
      { id: 'o2', status: 'paid', product: { name: 'N-p1', thumbnail: 't' } },
    ],
    errors: [],
  });
});
