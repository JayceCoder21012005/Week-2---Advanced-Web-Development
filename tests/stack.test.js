import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStack } from '../scripts/lib/stack.js';
import { PORTS } from '../shared/config.js';

test('startStack: cổng đã bị chiếm → báo lỗi thay vì đo nhầm stack cũ', async (t) => {
  const blocker = createServer((req, res) => res.end('{}')); // giả lập stack cũ đang chạy
  const ok = await new Promise((r) => blocker.once('error', () => r(false)).listen(PORTS.product, () => r(true)));
  if (!ok) return t.skip(`cổng ${PORTS.product} đang bận (npm start đang chạy?)`);
  try {
    await assert.rejects(startStack({ QUIET: '1' }), /exited|thoát/);
  } finally { blocker.closeAllConnections(); blocker.close(); }
});
