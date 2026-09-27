import test from 'node:test';
import assert from 'node:assert/strict';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { LIVE_OPERATIONS, EXECUTOR_VERSION } from '../src/polyagent/integration.js';
import type { Workspace } from '../src/polyagent/model.js';
import { PolyEngine } from '../src/polyagent/engine.js';
import { newWorkspace } from '../src/polyagent/model.js';
import type { WorkspaceStore } from '../src/polyagent/store.js';
import { fixture } from './fixtures.js';
import { prepareOrder, executePaper } from '../src/polyagent/paper.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TradingExecutor } from '../src-executor/trading.js';
import { createExecutorServer } from '../src-executor/main.js';
import type { Journal } from '../src-executor/journal.js';

class TestStore implements WorkspaceStore {
  value: Workspace | null = null;
  fail = false;
  async load() {
    return structuredClone(this.value);
  }
  async save(w: Workspace) {
    if (this.fail) throw new Error('disk-full');
    this.value = structuredClone(w);
  }
}
function setup() {
  const store = new TestStore();
  let submitted = 0;
  const f = fixture();
  const services = {
    agentWork: {
      listReferences: async () => [
        {
          agentHandle: 'handle',
          agentBinding: 'binding',
          activityAgentRef: 'activity',
          displayName: 'Test Agent',
          avatarUrl: null,
        },
      ],
      status: async () => ({ busy: false, ownExecutionId: null }),
      start: async () => ({ executionId: 'exec' }),
      listToolCalls: async () => [
        {
          callId: 'c1',
          name: 'record_market_decision',
          argumentsJson: JSON.stringify({ action: 'buy', reason: 'Controlled unit-test decision' }),
        },
      ],
      submitToolResult: async () => {
        submitted++;
        return { callId: 'c1' };
      },
      get: async () => ({ state: 'succeeded', outputText: 'done' }),
      cancel: async () => ({ state: 'cancelled' }),
    },
    integration: { listConnections: async () => [] },
    activity: { put: async () => ({}) },
  } as unknown as NimiElectronAppBusinessServices;
  const data = {
    scan: async () => [f.market],
    market: async () => f.market,
    quote: async () => f.quote,
    resolution: async () => ({
      resolved: false,
      payout: null,
      observedAt: new Date().toISOString(),
      source: 'test',
    }),
  };
  const engine = new PolyEngine(services, data, store);
  return { engine, services, store, data, submitted: () => submitted };
}
test('a persisted Agent decision produces a constrained paper entry and can be explicitly exited', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.agentName = 'Test Agent';
    w.running = true;
  });
  await x.engine.scan(true);
  assert.equal(x.engine.workspace!.paper.orders.length, 1);
  assert.equal(x.engine.workspace!.paper.orders[0].mode, 'paper');
  assert.equal(x.engine.workspace!.decisions[0].complete, true);
  assert.equal(x.submitted(), 1);
  await x.engine.stop();
  await x.engine.closePosition(x.engine.workspace!.paper.positions[0].id);
  assert.equal(x.engine.workspace!.paper.positions[0].shares, 0);
  x.engine.dispose();
});
test('storage failure before order creation prevents a simulated or live effect', async () => {
  const x = setup();
  await x.engine.initialize();
  x.store.fail = true;
  await assert.rejects(
    x.engine.modify((w) => {
      w.running = true;
    }),
    /disk-full/,
  );
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.engine.workspace!.paper.orders.length, 0);
  x.engine.dispose();
});
test('two concurrent close requests cannot sell the same shares twice', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  await x.engine.stop();
  const id = x.engine.workspace!.paper.positions[0].id;
  const results = await Promise.allSettled([
    x.engine.closePosition(id),
    x.engine.closePosition(id),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(x.engine.workspace!.paper.positions[0].shares, 0);
  assert.equal(x.engine.workspace!.paper.orders.filter((o) => o.side === 'sell').length, 1);
  x.engine.dispose();
});
test('reopening retains records but never re-arms trading', async () => {
  const x = setup();
  x.store.value = newWorkspace();
  x.store.value.running = true;
  await x.engine.initialize();
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.store.value!.running, false);
  x.engine.dispose();
});
test('stopping during an account check prevents a pending start from re-arming', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.mode = 'live';
    w.agentBinding = 'binding';
    w.liveLimitsConfirmed = true;
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  x.engine.refreshAccount = async () => {
    await gate;
    return { ready: true, maxOrderUsd: 10, maxExposureUsd: 50 } as never;
  };
  const start = x.engine.start();
  await x.engine.stop();
  release();
  await assert.rejects(start, /已停止/);
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.engine.workspace!.live.orders.length, 0);
  x.engine.dispose();
});
test('failed Agent terminal result keeps the draft decision and places no order', async () => {
  const x = setup();
  x.services.agentWork.get = async () => ({ state: 'failed', message: 'model failed' }) as never;
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  assert.equal(x.engine.workspace!.paper.orders.length, 0);
  assert.equal(x.engine.workspace!.decisions[0].complete, false);
  x.engine.dispose();
});
test('Agent busy in another App does not cancel it or produce a trade', async () => {
  const x = setup();
  let cancels = 0;
  x.services.agentWork.status = async () => ({ busy: true, ownExecutionId: null });
  x.services.agentWork.cancel = async () => {
    cancels++;
    return {} as never;
  };
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  assert.equal(x.engine.workspace!.paper.orders.length, 0);
  assert.equal(cancels, 0);
  x.engine.dispose();
});
test('stopping while a quote is in flight prevents later entry', async () => {
  const x = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const original = x.data.quote;
  x.data.quote = async () => {
    await gate;
    return original();
  };
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  const scan = x.engine.scan(true);
  await new Promise((r) => setTimeout(r, 10));
  await x.engine.stop();
  release();
  await scan;
  assert.equal(x.engine.workspace!.paper.orders.length, 0);
  assert.equal(x.engine.workspace!.running, false);
  x.engine.dispose();
});

test('a failed stop save cannot re-arm the automatic timer when storage recovers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const x = setup();
  t.after(() => x.engine.dispose());
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
    w.armedAt = new Date().toISOString();
    w.policy.scanIntervalSeconds = 30;
  });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = x.data.scan;
  x.data.scan = async () => {
    entered();
    await gate;
    return original();
  };
  const scan = x.engine.scan(true);
  await started;
  x.store.fail = true;
  await assert.rejects(x.engine.stop(), /disk-full/);
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.engine.workspace!.armedAt, null);
  release();
  await scan;
  x.store.fail = false;
  t.mock.timers.tick(31_000);
  await new Promise(setImmediate);
  assert.equal(x.engine.workspace!.paper.orders.length, 0);
  assert.equal(x.engine.workspace!.running, false);
  await x.engine.start();
  assert.equal(x.engine.workspace!.running, true, 'an explicit later start remains available');
});

test('a save started before stop cannot restore a running snapshot', async (t) => {
  const x = setup();
  t.after(() => x.engine.dispose());
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.running = true;
  });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  x.store.save = async (w) => {
    if (w.running) {
      entered();
      await gate;
      x.store.value = structuredClone(w);
    } else throw new Error('disk-full');
  };
  const pendingSave = x.engine.modify((w) => {
    w.notifyHome = false;
  });
  await started;
  const stopped = assert.rejects(x.engine.stop(), /disk-full/);
  assert.equal(x.engine.workspace!.running, false);
  release();
  await pendingSave;
  await stopped;
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.engine.workspace!.armedAt, null);
});

for (const loseSubmitResponse of [false, true]) {
  test(`a preflight rejection recovers through MCP${loseSubmitResponse ? ' after a lost response' : ''}`, async (t) => {
    const x = setup();
    t.after(() => x.engine.dispose());
    const wallet = '0x' + '2'.repeat(40);
    const journal: Journal = {
      data: { version: 1, wallet, orders: {}, redemptions: {} },
      save: async () => {},
    };
    let venueCalls = 0;
    const executor = new TradingExecutor(
      journal,
      {
        mode: 'live',
        signingMethod: 'keychain',
        wallet,
        maxOrderUsd: 10,
        maxExposureUsd: 50,
        maxBuyOrders: 10,
        maxBuyBudgetUsd: 100,
      },
      async () => {
        venueCalls++;
        throw new Error('must not sign or dispatch');
      },
      {
        ...x.data,
        quote: async () => ({ ...fixture().quote, asks: [{ price: 0.97, size: 100 }] }),
      } as never,
      async () => false,
    );
    executor.account = async () => ({
      protocol: EXECUTOR_VERSION,
      access: 'live',
      approvedVenues: ['standard'],
      buyOrdersRemaining: 10,
      remainingBuyBudgetUsd: 100,
      signingMethod: 'keychain',
      wallet,
      ready: true,
      cashUsd: 100,
      exposureUsd: 0,
      approvalsReady: true,
      geoblocked: false,
      maxOrderUsd: 10,
      maxExposureUsd: 50,
      message: 'Test account',
    });
    const bearer = 'test-only-no-wallet-'.repeat(3);
    const server = createExecutorServer(executor, bearer);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const client = new Client({ name: 'rejection-regression', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
        }),
      );
      x.services.integration.listConnections = async () =>
        [
          {
            targetRef: 'test',
            available: true,
            operations: LIVE_OPERATIONS.map((name) => ({ name })),
            permittedOperations: [...LIVE_OPERATIONS],
          },
        ] as never;
      x.services.integration.invoke = async ({ operation, inputJson }) => {
        const result = await client.callTool({ name: operation, arguments: JSON.parse(inputJson) });
        if (loseSubmitResponse && operation === 'polyagent.order.submit')
          throw new Error('response-lost');
        return {
          callId: crypto.randomUUID(),
          status: 'completed',
          resultJson: JSON.stringify(result),
        } as never;
      };
      await x.engine.initialize();
      await x.engine.modify((w) => {
        w.mode = 'live';
        w.connectionRef = 'test';
        w.agentBinding = 'binding';
        w.liveLimitsConfirmed = true;
        w.running = true;
        w.live.cashUsd = 100;
      });
      await x.engine.scan(true);
      assert.equal(
        x.engine.workspace!.live.orders[0].status,
        loseSubmitResponse ? 'unconfirmed' : 'rejected',
      );
      await x.engine.reconcileAll();
      assert.equal(x.engine.workspace!.live.orders[0].status, 'rejected');
      assert.equal(x.engine.workspace!.live.positions.length, 0);
      assert.equal(venueCalls, 0);
      assert.equal(Object.keys(journal.data.orders).length, 1);
      await x.engine.stop();
      await x.engine.start();
      assert.equal(x.engine.workspace!.running, true);
    } finally {
      x.engine.dispose();
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('account-read permission alone verifies and binds a wallet while refusing later identity changes', async () => {
  const x = setup();
  await x.engine.initialize();
  let wallet = '0x' + '2'.repeat(40);
  x.engine.connections = [
    {
      targetRef: 'executor',
      available: true,
      operations: LIVE_OPERATIONS.map((name) => ({ name })),
      permittedOperations: ['polyagent.account'],
    },
  ] as never;
  x.services.integration.invoke = async () =>
    ({
      callId: 'account',
      status: 'completed',
      resultJson: JSON.stringify({
        protocol: EXECUTOR_VERSION,
        access: 'live',
        approvedVenues: ['standard', 'neg-risk', 'v2'],
        buyOrdersRemaining: 1,
        remainingBuyBudgetUsd: 10,
        signingMethod: 'keychain',
        wallet,
        ready: true,
        cashUsd: 100,
        exposureUsd: 0,
        approvalsReady: true,
        geoblocked: false,
        maxOrderUsd: 10,
        maxExposureUsd: 50,
        message: 'unit test',
      }),
    }) as never;
  await x.engine.modify((w) => {
    w.connectionRef = 'executor';
  });
  await x.engine.refreshAccount();
  assert.equal(x.engine.workspace!.live.walletAddress, wallet);
  assert.equal(x.engine.workspace!.live.cashUsd, 100);
  wallet = '0x' + '3'.repeat(40);
  await assert.rejects(x.engine.refreshAccount(), /钱包不一致/);
  assert.equal(x.engine.account, null);
  assert.equal(x.engine.workspace!.live.walletAddress, '0x' + '2'.repeat(40));
  x.engine.dispose();
});

test('a live position prevents switching its execution connection', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  await x.engine.stop();
  await x.engine.modify((w) => {
    w.live.positions = structuredClone(w.paper.positions);
    w.connectionRef = 'original';
  });
  const w = x.engine.workspace!;
  await assert.rejects(
    x.engine.configure({
      mode: w.mode,
      agentBinding: w.agentBinding,
      connectionRef: 'replacement',
      policy: w.policy,
      liveLimitsConfirmed: false,
      notifyHome: false,
    }),
    /未完成订单与持仓/,
  );
  assert.equal(x.engine.workspace!.connectionRef, 'original');
  x.engine.dispose();
});

test('wallet settings can be saved before limits are approved, but cannot start trading', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.configure({
    mode: 'live',
    signingMethod: 'wallet',
    agentBinding: 'binding',
    connectionRef: null,
    policy: x.engine.workspace!.policy,
    liveLimitsConfirmed: false,
    notifyHome: false,
  });
  assert.equal(x.engine.workspace!.signingMethod, 'wallet');
  await assert.rejects(x.engine.start(), /确认实盘资金上限/);
  assert.equal(x.engine.workspace!.running, false);
  await x.engine.configure({
    mode: 'paper',
    signingMethod: 'keychain',
    agentBinding: 'binding',
    connectionRef: null,
    policy: x.engine.workspace!.policy,
    liveLimitsConfirmed: false,
    notifyHome: false,
  });
  assert.equal(x.engine.workspace!.paper.cashUsd, 100);
  x.engine.dispose();
});

test('a disconnected wallet stops before even preparing an exit order', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  await x.engine.stop();
  await x.engine.modify((w) => {
    w.live = structuredClone(w.paper);
    w.live.orders = [];
    w.mode = 'live';
    w.signingMethod = 'wallet';
    w.running = true;
  });
  x.engine.refreshAccount = async () =>
    ({
      ready: false,
      approvalsReady: false,
      geoblocked: false,
      cashUsd: null,
      message: '钱包未连接',
    }) as never;
  await assert.rejects(
    x.engine.closePosition(x.engine.workspace!.live.positions[0].id),
    /钱包未连接/,
  );
  assert.equal(x.engine.workspace!.live.orders.length, 0);
  assert.equal(x.engine.workspace!.running, false);
  x.engine.dispose();
});

test('the final permitted round trip stops after confirmed exit instead of re-entering', async () => {
  const x = setup();
  await x.engine.initialize();
  await x.engine.modify((w) => {
    w.agentBinding = 'binding';
    w.running = true;
  });
  await x.engine.scan(true);
  await x.engine.stop();
  const wallet = '0x' + '2'.repeat(40);
  const position = x.engine.workspace!.paper.positions[0];
  const { quote } = fixture();
  const sell = prepareOrder(
    position.market,
    quote,
    'sell',
    position.shares,
    0.94,
    'test exit',
    'live',
  );
  sell.status = 'open';
  sell.executorRef = 'executor';
  await x.engine.modify((w) => {
    w.live = structuredClone(w.paper);
    w.live.walletAddress = wallet;
    w.live.orders.unshift(sell);
    w.mode = 'live';
    w.running = true;
  });
  x.engine.account = { buyOrdersRemaining: 0 } as never;
  x.services.integration.invoke = async () =>
    ({
      callId: 'fill',
      status: 'completed',
      resultJson: JSON.stringify({
        protocol: EXECUTOR_VERSION,
        walletAddress: wallet,
        submissionId: sell.submissionId,
        status: 'filled',
        filledShares: position.shares,
        notionalUsd: position.shares * 0.94,
        feeUsd: 0,
        tradeIds: ['confirmed-test-fill'],
        message: 'test-only confirmed exit',
      }),
    }) as never;
  await x.engine.reconcileAll();
  assert.equal(x.engine.workspace!.live.positions[0].shares, 0);
  assert.equal(x.engine.workspace!.running, false);
  assert.equal(x.engine.workspace!.armedAt, null);
  x.engine.dispose();
});

test('a sub-minimum partial fill remains a position without creating a phantom exit order', async () => {
  const x = setup();
  await x.engine.initialize();
  const { market, quote } = fixture();
  quote.asks = [{ price: 0.95, size: 2 }];
  await x.engine.modify((w) => {
    const order = prepareOrder(market, quote, 'buy', 5, 0.95, 'partial fixture', 'paper');
    w.paper.orders.push(order);
    executePaper(w.paper, order);
  });
  const position = x.engine.workspace!.paper.positions[0];
  assert.equal(position.shares, 2);
  await assert.rejects(x.engine.closePosition(position.id), /最小订单/);
  assert.equal(x.engine.workspace!.paper.orders.length, 1);
  assert.equal(x.engine.workspace!.paper.positions[0].shares, 2);
  x.data.resolution = async () => ({
    resolved: true,
    payout: 1,
    observedAt: new Date().toISOString(),
    source: 'test',
  });
  await x.engine.scan(false);
  assert.equal(x.engine.workspace!.paper.positions[0].settled, true);
  x.engine.dispose();
});
