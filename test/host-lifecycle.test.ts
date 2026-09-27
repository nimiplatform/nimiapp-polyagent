import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolyAgentHost } from '../src-electron/business.js';
import { ExecutorManager } from '../src-electron/executor-manager.js';
import { PolyEngine } from '../src/polyagent/engine.js';

test('Host service stop and shutdown close the executor even when the ledger stop fails', async (t) => {
  let closes = 0;
  t.mock.method(PolyEngine.prototype, 'initialize', async () => {});
  t.mock.method(PolyEngine.prototype, 'stop', async () => {
    throw new Error('storage-unavailable');
  });
  t.mock.method(ExecutorManager.prototype, 'stop', async () => {
    closes++;
  });
  const host = createPolyAgentHost(
    () => {},
    async () => {},
    () => {},
  );
  host.bind({
    storage: {},
    activity: { onOpenRequest: () => ({ stop: async () => {} }) },
  } as never);
  await host.handlers['polyagent.snapshot']({} as never);
  await assert.rejects(
    host.handlers['polyagent.executor.stop']({} as never),
    /storage-unavailable/,
  );
  assert.equal(closes, 1);
  await assert.rejects(host.shutdown(), /storage-unavailable/);
  assert.equal(closes, 2);
});
