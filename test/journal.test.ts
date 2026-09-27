import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { FileJournal } from '../src-executor/journal.js';
import { TradingExecutor, type ExecutorLimits, type Submit } from '../src-executor/trading.js';

async function testDirectory() {
  const root = path.resolve('.nimi/local/tests');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'journal-'));
}

test('an untouched disabled journal binds its first wallet, then rejects replacement', async () => {
  const directory = await testDirectory();
  try {
    await new FileJournal(directory).load('');
    const wallet = '0x' + '2'.repeat(40);
    const journal = new FileJournal(directory);
    await journal.load(wallet);
    assert.equal(journal.data.wallet, wallet);
    await assert.rejects(new FileJournal(directory).load('0x' + '3'.repeat(40)), /another wallet/);
    const reopened = new FileJournal(directory);
    await reopened.load(wallet);
    assert.equal(reopened.data.wallet, wallet);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a refused submission survives journal reload and can never be dispatched by replay', async () => {
  const directory = await testDirectory();
  const wallet = '0x' + '2'.repeat(40);
  const limits: ExecutorLimits = {
    mode: 'observe',
    signingMethod: 'keychain',
    wallet,
    maxOrderUsd: 5,
    maxExposureUsd: 5,
    maxBuyOrders: 1,
    maxBuyBudgetUsd: 10,
  };
  const request: Submit = {
    submissionId: crypto.randomUUID(),
    walletAddress: wallet,
    signingMethod: 'keychain',
    marketId: 'm1',
    assetId: '123',
    side: 'buy',
    shares: 5,
    limitPrice: 0.95,
    maxSpendUsd: 5,
  };
  const noClient = async (): Promise<never> => {
    throw new Error('must not reach a venue');
  };
  try {
    const journal = new FileJournal(directory);
    await journal.load(wallet);
    const first = new TradingExecutor(journal, limits, noClient);
    const refused = await first.submit(request);
    assert.equal(refused.status, 'rejected');
    const reopened = new FileJournal(directory);
    await reopened.load(wallet);
    const resumed = new TradingExecutor(reopened, { ...limits, mode: 'live' }, noClient);
    assert.deepEqual(await resumed.get(request.submissionId, wallet), refused);
    assert.deepEqual(await resumed.submit(request), refused);

    const prepared = structuredClone(reopened.data.orders[request.submissionId]);
    prepared.receipt.status = 'prepared';
    reopened.data.orders[request.submissionId] = prepared;
    const dispatched = structuredClone(prepared);
    dispatched.request.submissionId = dispatched.receipt.submissionId = crypto.randomUUID();
    dispatched.receipt.status = 'submitting';
    dispatched.dispatchedAt = new Date().toISOString();
    reopened.data.orders[dispatched.request.submissionId] = dispatched;
    await reopened.save();
    const recovered = new FileJournal(directory);
    await recovered.load(wallet);
    assert.equal(recovered.data.orders[request.submissionId].receipt.status, 'canceled');
    assert.equal(
      recovered.data.orders[dispatched.request.submissionId].receipt.status,
      'unconfirmed',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
