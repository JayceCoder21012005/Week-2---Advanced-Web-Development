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
