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
