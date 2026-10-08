import { setTimeout as sleep } from 'node:timers/promises';
import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createProductApp({
  dataset = datasetFromEnv(),
  fault = process.env.PRODUCT_FAULT ?? 'none', // none | slow | error
  delayMs = Number(process.env.PRODUCT_DELAY_MS ?? 2000),
} = {}) {
  const { app, metrics, db } = createService('product');
  const products = new Map(loadTable(dataset, 'products').map((p) => [p.id, p]));
  const repo = {
    findById: db((id) => products.get(id)),
    findByIds: db((ids) => ids.map((id) => products.get(id)).filter(Boolean)), // 1 query cho cả lô
  };

  app.use('/products', async (req, res, next) => { // gây lỗi có chủ đích
    if (fault === 'error') return res.status(503).json({ error: 'product service unavailable (injected)' });
    if (fault === 'slow') await sleep(delayMs);
    next();
  });
  app.get('/products', (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    res.json(repo.findByIds(ids));
  });
  app.get('/products/:id', (req, res) => {
    const product = repo.findById(req.params.id);
    product ? res.json(product) : res.status(404).json({ error: 'product not found' });
  });
  return { app, metrics };
}

if (import.meta.main) {
  createProductApp().app.listen(PORTS.product, () =>
    console.log(`product-service :${PORTS.product} DATASET=${datasetFromEnv()} FAULT=${process.env.PRODUCT_FAULT ?? 'none'}`));
}
