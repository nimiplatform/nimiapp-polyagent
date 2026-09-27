import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SecureClient } from '@polymarket/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TradingExecutor } from '../src-executor/trading.js';
import { createExecutorServer } from '../src-executor/main.js';
import { EXECUTOR_VERSION } from '../src/polyagent/integration.js';
import type { Journal } from '../src-executor/journal.js';
import { fixture } from './fixtures.js';

function setup() {
  const { market, quote } = fixture();
  let posts = 0,
    saves = 0;
  const journal: Journal = {
    data: { version: 1, wallet: '0x' + '2'.repeat(40), orders: {}, redemptions: {} },
    save: async () => {
      saves++;
    },
  };
  const client = {
    createMarketOrder: async () => ({ signature: 'unit-test-only' }),
    postOrder: async () => {
      posts++;
      throw new Error('network-lost-after-dispatch');
    },
  } as unknown as SecureClient;
  const data = { market: async () => market, quote: async () => quote } as never;
  const executor = new TradingExecutor(
    journal,
    {
      signingMethod: 'keychain',
      mode: 'live',
      maxBuyOrders: 10,
      maxBuyBudgetUsd: 100,
      wallet: '0x' + '2'.repeat(40),
      maxOrderUsd: 10,
      maxExposureUsd: 50,
    },
    async () => client,
    data,
    async () => false,
  );
  executor.account = async () => ({
    protocol: EXECUTOR_VERSION,
    access: 'live',
    approvedVenues: ['standard', 'neg-risk', 'v2'],
    buyOrdersRemaining: 10,
    remainingBuyBudgetUsd: 100,
    signingMethod: 'keychain',
    wallet: '0x' + '2'.repeat(40),
    ready: true,
    cashUsd: 100,
    exposureUsd: 0,
    approvalsReady: true,
    geoblocked: false,
    maxOrderUsd: 10,
    maxExposureUsd: 50,
    message: 'unit-test only',
  });
  return { executor, journal, posts: () => posts, saves: () => saves };
}
const walletAddress = '0x' + '2'.repeat(40);
const input = () => ({
  signingMethod: 'keychain' as const,
  walletAddress,
  submissionId: randomUUID(),
  marketId: 'm1',
  assetId: '123',
  side: 'buy' as const,
  shares: 5,
  limitPrice: 0.95,
  maxSpendUsd: 5,
});
test('ambiguous post is durably marked unconfirmed and the same submission is never resent', async () => {
  const x = setup(),
    order = input();
  const first = await x.executor.submit(order);
  assert.equal(first.status, 'unconfirmed');
  assert.ok(x.saves() >= 4);
  assert.equal(x.posts(), 1);
  const second = await x.executor.submit(order);
  assert.equal(second.status, 'unconfirmed');
  assert.equal(x.posts(), 1);
  await assert.rejects(x.executor.submit({ ...order, maxSpendUsd: 6 }), /CONFLICT/);
});
test('executor capital ceilings cannot be raised by App or model input', async () => {
  const x = setup();
  await assert.rejects(x.executor.submit({ ...input(), maxSpendUsd: 11 }), /CAPITAL/);
  assert.equal(x.posts(), 0);
  assert.equal(Object.keys(x.journal.data.orders).length, 0);
});
test('durability failure prevents signing or submission', async () => {
  const x = setup();
  x.journal.save = async () => {
    throw new Error('disk-full');
  };
  await assert.rejects(x.executor.submit(input()), /disk-full/);
  assert.equal(x.posts(), 0);
});
test('a canceled queued call cannot dispatch an order', async () => {
  const x = setup();
  const c = new AbortController();
  c.abort();
  await assert.rejects(x.executor.submit(input(), c.signal));
  assert.equal(x.posts(), 0);
});
test('matched but unconfirmed venue trades do not become fills; confirmed partial FAK does', async () => {
  const x = setup();
  let confirmed = false,
    posts = 0;
  const venue = {
    createMarketOrder: async () => ({ signature: 'test-only' }),
    postOrder: async () => {
      posts++;
      assert.equal(Object.values(x.journal.data.orders)[0].receipt.status, 'submitting');
      return { ok: true, orderId: 'venue-1', status: 'matched', tradeIds: ['trade-1'] };
    },
    fetchOrder: async () => ({
      id: 'venue-1',
      assetId: '123',
      side: 'BUY',
      conditionId: 'condition',
      originalSize: '5',
      sizeMatched: '3',
      status: 'MATCHED',
    }),
    listAccountTrades: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          items: [
            {
              id: 'trade-1',
              takerOrderId: 'venue-1',
              status: confirmed ? 'CONFIRMED' : 'MATCHED',
              size: '3',
              price: '0.95',
            },
          ],
          nextCursor: undefined,
        };
      },
    }),
  } as unknown as SecureClient;
  const executor = new TradingExecutor(
    x.journal,
    {
      signingMethod: 'keychain',
      mode: 'live',
      maxBuyOrders: 10,
      maxBuyBudgetUsd: 100,
      wallet: '0x' + '2'.repeat(40),
      maxOrderUsd: 10,
      maxExposureUsd: 50,
    },
    async () => venue,
    x.executor.data,
    async () => false,
  );
  executor.account = x.executor.account;
  const order = input();
  const accepted = await executor.submit(order);
  assert.equal(accepted.status, 'open');
  assert.equal(accepted.filledShares, 0);
  confirmed = true;
  const filled = await executor.get(order.submissionId, walletAddress);
  assert.equal(filled.status, 'partially-filled');
  assert.equal(filled.filledShares, 3);
  assert.equal(filled.notionalUsd, 2.85);
  assert.equal(filled.feeUsd, 0.0057);
  await executor.get(order.submissionId, walletAddress);
  assert.equal(posts, 1);
});
test('unknown redemption retains its transaction reference and is never resubmitted', async () => {
  const x = setup();
  let sends = 0;
  const venue = {
    redeemPositions: async () => {
      sends++;
      return {
        transactionHash: '0x' + '1'.repeat(64),
        transactionId: 'tx-1',
        wait: async () => {
          throw new Error('timeout');
        },
      };
    },
  } as unknown as SecureClient;
  const data = {
    ...x.executor.data,
    resolution: async () => ({
      resolved: true,
      payout: 1,
      source: 'test',
      observedAt: new Date().toISOString(),
    }),
  } as never;
  const executor = new TradingExecutor(
    x.journal,
    {
      signingMethod: 'keychain',
      mode: 'live',
      maxBuyOrders: 10,
      maxBuyBudgetUsd: 100,
      wallet: '0x' + '2'.repeat(40),
      maxOrderUsd: 10,
      maxExposureUsd: 50,
    },
    async () => venue,
    data,
    async () => false,
  );
  assert.equal((await executor.redeem('m1', '123', walletAddress)).settled, false);
  assert.equal((await executor.redeem('m1', '123', walletAddress)).settled, false);
  assert.equal(sends, 1);
  assert.equal(x.journal.data.redemptions.m1.transactionId, 'tx-1');
});
test('MCP exposes real typed operations behind bearer authentication without a wallet', async () => {
  const journal: Journal = {
    data: { version: 1, wallet: '', orders: {}, redemptions: {} },
    save: async () => {},
  };
  const executor = new TradingExecutor(
    journal,
    {
      signingMethod: 'keychain',
      mode: 'disabled',
      maxBuyOrders: 0,
      maxBuyBudgetUsd: 0,
      wallet: '',
      maxOrderUsd: 0,
      maxExposureUsd: 0,
    },
    async () => {
      throw new Error('must not authenticate');
    },
  );
  const token = 'unit-test-token-no-wallet-'.repeat(2);
  const server = createExecutorServer(executor, token);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: 'unit-test', version: '1' });
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 9);
    const result = await client.callTool({ name: 'polyagent.account', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { ready: boolean }).ready, false);
    assert.equal((result.structuredContent as { cashUsd: null }).cashUsd, null);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('a different wallet is rejected before dispatch, cancellation or redemption', async () => {
  const x = setup();
  const wrongWallet = '0x' + '3'.repeat(40);
  await assert.rejects(
    x.executor.submit({ ...input(), walletAddress: wrongWallet }),
    /WALLET_MISMATCH/,
  );
  await assert.rejects(x.executor.cancel(randomUUID(), wrongWallet), /WALLET_MISMATCH/);
  await assert.rejects(x.executor.redeem('m1', '123', wrongWallet), /WALLET_MISMATCH/);
  assert.equal(x.posts(), 0);
  assert.equal(Object.keys(x.journal.data.orders).length, 0);
  assert.equal(Object.keys(x.journal.data.redemptions).length, 0);
});

test('the selected signing method cannot fall back to an imported private key', async () => {
  const x = setup();
  await assert.rejects(
    x.executor.submit({ ...input(), signingMethod: 'wallet' }),
    /SIGNING_METHOD_MISMATCH/,
  );
  assert.equal(x.posts(), 0);
});

test('a market closing while the wallet signs prevents later submission', async () => {
  const x = setup();
  const f = fixture();
  let posts = 0;
  const venue = {
    createMarketOrder: async () => {
      f.market.closed = true;
      return { signature: 'test-only' };
    },
    postOrder: async () => {
      posts++;
    },
  } as unknown as SecureClient;
  const executor = new TradingExecutor(
    x.journal,
    {
      mode: 'live',
      maxBuyOrders: 10,
      maxBuyBudgetUsd: 100,
      signingMethod: 'wallet',
      wallet: walletAddress,
      maxOrderUsd: 10,
      maxExposureUsd: 50,
    },
    async () => venue,
    { market: async () => f.market, quote: async () => f.quote } as never,
    async () => false,
    () => true,
  );
  executor.account = x.executor.account;
  const result = await executor.submit({ ...input(), signingMethod: 'wallet' });
  assert.equal(result.status, 'canceled');
  assert.equal(posts, 0);
});

test('observation mode refuses every financial write before touching the client', async () => {
  const x = setup();
  x.executor.limits.mode = 'observe';
  await assert.rejects(x.executor.submit(input()), /LIVE_NOT_ENABLED/);
  await assert.rejects(x.executor.cancel(randomUUID(), walletAddress), /LIVE_NOT_ENABLED/);
  await assert.rejects(x.executor.redeem('m1', '123', walletAddress), /LIVE_NOT_ENABLED/);
  assert.equal(x.posts(), 0);
  assert.equal(Object.keys(x.journal.data.orders).length, 0);
});

test('a dispatched buy consumes its single-order slot even after its final result', async () => {
  const x = setup();
  x.executor.limits.maxBuyOrders = 1;
  const request = input();
  await x.executor.submit(request);
  x.journal.data.orders[request.submissionId].receipt.status = 'canceled';
  await assert.rejects(x.executor.submit(input()), /TEST_BUDGET_EXHAUSTED/);
  assert.equal(x.posts(), 1);
});

test('the independent cumulative buy budget cannot be exceeded', async () => {
  const x = setup();
  x.executor.limits.maxBuyBudgetUsd = 4;
  await assert.rejects(x.executor.submit(input()), /TEST_BUDGET_EXHAUSTED/);
  assert.equal(x.posts(), 0);
});

test('a venue without its own required approval cannot receive an order', async () => {
  const x = setup();
  const original = x.executor.account;
  x.executor.account = async () => ({ ...(await original()), approvedVenues: ['v2'] });
  await assert.rejects(x.executor.submit(input()), /MARKET_APPROVALS_MISSING/);
  assert.equal(x.posts(), 0);
});
