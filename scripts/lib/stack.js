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
    p.name = name;
    return p;
  });
  const stop = () => Promise.all(procs.map((p) => (p.exitCode !== null || p.signalCode !== null
    ? undefined
    : new Promise((r) => { p.once('exit', r); p.kill(); }))));
  try {
    await waitReady(procs);
  } catch (e) {
    await stop();
    throw e;
  }
  logs.length = 0; // bỏ log khởi động
  return { logs, stop };
}

/** Chờ cả 4 process trả lời; process nào thoát sớm (vd. EADDRINUSE) → lỗi ngay, không đo nhầm stack cũ. */
async function waitReady(procs) {
  const probes = [...SERVICES.map((s) => `${urlOf(s)}/metrics`), `${urlOf('gateway')}/config`];
  for (let i = 0; i < 100; i++) {
    const dead = procs.find((p) => p.exitCode !== null);
    if (dead) throw new Error(`${dead.name} exited (code ${dead.exitCode}) — cổng 4000-4003 đang bị chiếm? (tắt \`npm start\` trước)`);
    try {
      await Promise.all(probes.map(async (u) => { if (!(await fetch(u)).ok) throw new Error(u); }));
      await sleep(200); // process vừa lỗi cổng có thể thoát trễ hơn probe
      const late = procs.find((p) => p.exitCode !== null);
      if (late) throw new Error(`${late.name} exited (code ${late.exitCode}) — cổng đang bị chiếm?`);
      return;
    } catch (e) {
      if (/exited/.test(e.message)) throw e;
      await sleep(100);
    }
  }
  throw new Error('stack không lên được sau 10 s');
}

export const resetMetrics = () =>
  Promise.all(SERVICES.map((s) => fetch(`${urlOf(s)}/metrics/reset`, { method: 'POST' })));

export async function readMetrics() {
  const out = {};
  for (const s of SERVICES) out[s] = await (await fetch(`${urlOf(s)}/metrics`)).json();
  return out;
}
