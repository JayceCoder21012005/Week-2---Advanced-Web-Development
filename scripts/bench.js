// Đo trên browser thật (Edge qua Playwright): mỗi tổ hợp dataset × client × biến thể → restart stack → 1 lạnh + 5 ấm.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startStack, resetMetrics, readMetrics } from './lib/stack.js';
import { urlOf } from '../shared/config.js';

const RUNS = Number(process.env.RUNS ?? 6);
const DATASETS = ['small', 'large'];
const CLIENTS = {
  web: { page: 'dashboard.html', viewport: { width: 1280, height: 720 } },
  mobile: { page: 'mobile.html', viewport: { width: 390, height: 844 } },
};
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
  for (const [client, cfg] of Object.entries(CLIENTS)) {
    for (const v of VARIANTS) {
      const stack = await startStack({ DATASET: dataset, QUIET: '1', ...v.env }); // restart → lần 1 là "lạnh"
      try {
        for (let run = 1; run <= RUNS; run++) {
          await resetMetrics();
          const ctx = await browser.newContext({ viewport: cfg.viewport }); // context mới: không cache HTTP giữa các lần
          const page = await ctx.newPage();
          await page.goto(`${urlOf('gateway')}/${cfg.page}?variant=${v.page}&user=u1`);
          await page.waitForFunction(() => window.__done !== undefined, null, { timeout: 120_000 });
          const { done, resources } = await page.evaluate(() => ({
            done: window.__done,
            resources: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'fetch')
              .map((r) => ({ name: r.name, start: r.startTime, end: r.responseEnd, bytes: r.encodedBodySize })),
          }));
          await ctx.close();
          const m = await readMetrics();
          const row = {
            dataset, client, variant: v.name, run, mode: run === 1 ? 'cold' : 'warm', doneMs: +done.toFixed(1),
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
}
await browser.close();

const dir = new URL('../results/', import.meta.url);
mkdirSync(dir, { recursive: true });

// raw.csv — từng lần chạy
const cols = Object.keys(rows[0]);
writeFileSync(new URL('raw.csv', dir), [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n'));

// summary.md — lạnh riêng; ấm: median [min–max]
const lines = [
  '| dataset | client | variant | lạnh done (ms) | ấm done median [min–max] (ms) | client req | payload (B) | user calls/db | order calls/db | product calls/db |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
const picked = [];
for (const dataset of DATASETS) {
  for (const client of Object.keys(CLIENTS)) {
    for (const v of VARIANTS) {
      const g = rows.filter((r) => r.dataset === dataset && r.client === client && r.variant === v.name);
      const cold = g.find((r) => r.mode === 'cold');
      const warm = g.filter((r) => r.mode === 'warm');
      const d = warm.map((r) => r.doneMs);
      const med = (k) => median(warm.map((r) => r[k]));
      lines.push(`| ${dataset} | ${client} | ${v.name} | ${cold.doneMs} | ${median(d)} [${Math.min(...d)}–${Math.max(...d)}] | ${med('clientRequests')} | ${med('payloadBytes')} | ${med('userCalls')}/${med('userDb')} | ${med('orderCalls')}/${med('orderDb')} | ${med('productCalls')}/${med('productDb')} |`);
      const medRun = warm.reduce((a, b) => (Math.abs(b.doneMs - median(d)) < Math.abs(a.doneMs - median(d)) ? b : a));
      picked.push(traces.find((t) => t.dataset === dataset && t.client === client && t.variant === v.name && t.run === medRun.run));
    }
  }
}
writeFileSync(new URL('summary.md', dir), `${lines.join('\n')}\n\nRUNS=${RUNS} (1 lạnh + ${RUNS - 1} ấm), browser=${process.env.BROWSER_CHANNEL ?? 'msedge'}, ${new Date().toISOString()}\n`);

// waterfall.html — lần ấm gần median nhất của mỗi tổ hợp, vạch đỏ = màn hình hoàn tất
const section = (w) => {
  const scale = Math.max(w.doneMs, ...w.resources.map((r) => r.end)) || 1;
  const pct = (x) => ((x / scale) * 100).toFixed(2);
  const bars = w.resources.map((r) => {
    const u = new URL(r.name);
    return `<div class="row"><span class="lbl">:${u.port} ${u.pathname}${u.search}</span><span class="track"><i style="left:${pct(r.start)}%;width:${Math.max(0.3, pct(r.end - r.start))}%"></i><b style="left:${pct(w.doneMs)}%"></b></span><span class="ms">${(r.end - r.start).toFixed(1)}ms</span></div>`;
  }).join('');
  return `<section id="${w.dataset}-${w.client}-${w.variant}"><h2>${w.dataset} · ${w.client} · ${w.variant} · run ${w.run} — done ${w.doneMs} ms · ${w.resources.length} request · ${w.payloadBytes} B</h2>${bars}</section>`;
};
writeFileSync(new URL('waterfall.html', dir), `<!doctype html><meta charset="utf-8"><title>Waterfall</title>
<style>body{font:12px system-ui;margin:20px}h2{font-size:14px;margin:18px 0 6px}.row{display:flex;align-items:center;height:14px}
.lbl{width:260px;overflow:hidden;white-space:nowrap}.track{position:relative;flex:1;height:10px;background:#f3f3f3}
.track i{position:absolute;top:0;height:10px;background:#3b82f6}.track b{position:absolute;top:-2px;width:2px;height:14px;background:#dc2626}
.ms{width:70px;text-align:right}</style>
<p>Thanh xanh = request (thời điểm bắt đầu → responseEnd). Vạch đỏ = màn hình hoàn tất (window.__done). Trục tính từ navigation start. "run N" = lần ấm có thời gian gần median nhất.</p>
${picked.map(section).join('\n')}`);
console.log('→ results/raw.csv, results/summary.md, results/waterfall.html');
