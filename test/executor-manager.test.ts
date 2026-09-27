import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutorManager } from '../src-electron/executor-manager.js';
import type { ExecutorConfig } from '../src-executor/config.js';
const config = { mode: 'live', port: 17846 } as ExecutorConfig;
test('Host never inherits live mode from configuration and serially closes the old service', async () => {
  const events: string[] = [];
  const manager = new ExecutorManager(
    async () => config,
    async (c) => {
      events.push(c.mode);
      return {
        stop: async () => {
          events.push('stop');
        },
      };
    },
  );
  assert.equal(manager.status().state, 'stopped');
  await manager.start('file', 'observe', () => {});
  assert.equal(manager.status().mode, 'observe');
  await manager.start('file', 'live', () => {}); // Explicit test double, no signer/network.
  assert.deepEqual(events, ['observe', 'stop', 'live']);
  await manager.stop();
  assert.equal(manager.status().mode, null);
});
test('invalidating during startup closes the late service and cannot leave live enabled', async () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  let closed = 0;
  const manager = new ExecutorManager(
    async () => config,
    async () => {
      started();
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        stop: async () => {
          closed++;
        },
      };
    },
  );
  const pending = manager.start('file', 'live', () => {});
  const rejected = assert.rejects(pending);
  await entered;
  const stopped = manager.stop();
  release();
  await rejected;
  await stopped;
  assert.equal(closed, 1);
  assert.equal(manager.status().state, 'stopped');
});
test('a validation refusal leaves the existing observer intact', async () => {
  let launches = 0,
    closes = 0;
  const manager = new ExecutorManager(
    async () => config,
    async () => {
      launches++;
      return {
        stop: async () => {
          closes++;
        },
      };
    },
  );
  await manager.start('file', 'observe', () => {});
  await assert.rejects(
    manager.start('file', 'live', () => {
      throw new Error('permission missing');
    }),
    /permission missing/,
  );
  assert.equal(launches, 1);
  assert.equal(closes, 0);
  assert.equal(manager.status().mode, 'observe');
});
test('port conflict reports a recoverable failure without claiming a running service', async () => {
  const manager = new ExecutorManager(
    async () => config,
    async () => {
      throw Object.assign(new Error('secret upstream diagnostic'), { code: 'EADDRINUSE' });
    },
  );
  await assert.rejects(
    manager.start('file', 'observe', () => {}),
    /占用/,
  );
  assert.equal(manager.status().state, 'error');
  assert.equal(manager.status().mode, null);
  assert.ok(!manager.status().message.includes('secret'));
});
test('queued startup is invalidated before it can launch', async () => {
  let launches = 0;
  const manager = new ExecutorManager(
    async () => config,
    async () => {
      launches++;
      return { stop: async () => {} };
    },
  );
  const pending = manager.start('file', 'live', () => {});
  const rejected = assert.rejects(pending);
  await manager.stop();
  await rejected;
  assert.equal(launches, 0);
});
