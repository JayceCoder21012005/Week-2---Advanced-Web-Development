import { createService, loadTable, datasetFromEnv } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';

export function createUserApp({ dataset = datasetFromEnv() } = {}) {
  const { app, metrics, db } = createService('user');
  const users = new Map(loadTable(dataset, 'users').map((u) => [u.id, u]));
  const repo = { findById: db((id) => users.get(id)) };

  app.get('/users/:id', (req, res) => {
    const user = repo.findById(req.params.id);
    user ? res.json(user) : res.status(404).json({ error: 'user not found' });
  });
  return { app, metrics };
}

if (import.meta.main) {
  createUserApp().app.listen(PORTS.user, () => console.log(`user-service :${PORTS.user} DATASET=${datasetFromEnv()}`));
}
