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
