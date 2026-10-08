import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createOrderApp({ dataset = datasetFromEnv() } = {}) {
  const { app, metrics, db } = createService('order');
  const orders = loadTable(dataset, 'orders');
  const repo = { findByUser: db((userId) => orders.filter((o) => o.userId === userId)) };

  app.get('/orders', (req, res) => {
    if (!req.query.userId) return res.status(400).json({ error: 'userId required' });
    res.json(repo.findByUser(req.query.userId));
  });
  return { app, metrics };
}

if (import.meta.main) {
  createOrderApp().app.listen(PORTS.order, () => console.log(`order-service :${PORTS.order} DATASET=${datasetFromEnv()}`));
}
