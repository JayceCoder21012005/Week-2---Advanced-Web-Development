// Ghi trace thật: GraphQL naive vs loader (N+1 trước/sau) và call graph BFF.
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startStack, resetMetrics, readMetrics } from './lib/stack.js';
import { createFetchers } from '../web/fetchers.js';
import { SERVICE_URLS, urlOf } from '../shared/config.js';

const dataset = process.env.DATASET ?? 'small';
const fetchers = createFetchers({ services: SERVICE_URLS, gateway: urlOf('gateway') });
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });

for (const [name, variant, mode] of [['graphql-naive', 'graphql', 'naive'], ['graphql-loader', 'graphql', 'loader'], ['bff', 'bff', 'loader']]) {
  const stack = await startStack({ DATASET: dataset, GQL_MODE: mode });
  try {
    await resetMetrics();
    await fetchers[variant]('u1');
    await sleep(200); // chờ stdout các process về hết
    const m = await readMetrics();
    const summary = Object.values(m).map((x) => `${x.service}: calls=${x.calls} db=${x.dbQueries}`).join(' | ');
    const text = [`# ${variant} (GQL_MODE=${mode}, DATASET=${dataset})`, ...[...stack.logs].sort(), '', summary].join('\n');
    writeFileSync(new URL(`../results/trace-${name}-${dataset}.log`, import.meta.url), text);
    console.log(`${text}\n`);
  } finally { await stack.stop(); }
}
