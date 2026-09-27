import test from 'node:test';
import assert from 'node:assert/strict';
import type { SecureClient, SignerTransactionRequest } from '@polymarket/client';
import { TradingExecutor, type ExecutorLimits } from '../src-executor/trading.js';
import { RedemptionTracker, transactionIntent } from '../src-executor/redemption.js';
import type { Journal, JournalData } from '../src-executor/journal.js';
import { fixture } from './fixtures.js';

const wallet = '0x' + '2'.repeat(40);
const txHash = '0x' + 'a'.repeat(64);
const request: SignerTransactionRequest = {
  chainId: 137,
  to: ('0x' + '3'.repeat(40)) as never,
  data: '0x1234' as never,
  value: 0n,
};

// Explicit local signer and chain doubles. These tests never reach a real wallet or RPC.
function setup() {
  let saved: JournalData = { version: 1, wallet, orders: {}, redemptions: {} };
  const journal: Journal = {
    data: structuredClone(saved),
    save: async () => {
      saved = structuredClone(journal.data);
    },
  };
  let sends = 0;
  let waitError: Error | undefined;
  const observed = { from: wallet, to: request.to, input: request.data, value: 0n, hash: txHash };
  const laterTransactions = new Map<string, typeof observed>();
  const receipt = { transactionHash: txHash, status: 'success', blockNumber: 10n };
  let head = 12n;
  const chain = {
    getTransaction: async ({ hash }: { hash: string }) => ({
      ...(laterTransactions.get(hash) ?? observed),
    }),
    getTransactionReceipt: async ({ hash }: { hash: string }) => ({
      ...receipt,
      transactionHash: hash,
    }),
    getBlockNumber: async () => head,
  };
  const tracker = new RedemptionTracker(journal, chain as never);
  const signer = tracker.wrapSigner({
    getAddress: async () => wallet as never,
    signMessage: async () => {
      throw new Error('unexpected signature');
    },
    signTypedData: async () => {
      throw new Error('unexpected signature');
    },
    sendTransaction: async (input) => {
      assert.deepEqual(
        saved.redemptions.m1.directTransactions.at(-1)!.intent,
        transactionIntent(wallet, input),
      );
      sends++;
      const hash = sends === 1 ? txHash : '0x' + String(sends).padStart(64, '0');
      if (sends > 1)
        laterTransactions.set(hash, {
          ...observed,
          hash,
          to: input.to,
          input: input.data,
          value: input.value ?? 0n,
        });
      return {
        transactionHash: hash as never,
        transactionId: null,
        wait: async () => {
          if (waitError) throw waitError;
          return { transactionHash: hash as never, transactionId: null };
        },
      };
    },
  });
  const venue = { redeemPositions: async () => signer.sendTransaction(request) };
  const limits: ExecutorLimits = {
    signingMethod: 'wallet',
    mode: 'live',
    wallet,
    maxOrderUsd: 5,
    maxExposureUsd: 5,
    maxBuyOrders: 1,
    maxBuyBudgetUsd: 10,
  };
  const data = {
    market: async () => fixture().market,
    resolution: async () => ({ resolved: true, payout: 1 }),
  } as never;
  const executor = new TradingExecutor(
    journal,
    limits,
    async () => venue as unknown as SecureClient,
    data,
    async () => false,
    () => true,
    tracker,
  );
  const reopen = () => {
    const next: Journal = {
      data: structuredClone(saved),
      save: async () => {
        saved = structuredClone(next.data);
      },
    };
    return new TradingExecutor(
      next,
      limits,
      async () => {
        throw new Error('recovery must only read the chain');
      },
      data,
      async () => false,
      () => false,
      new RedemptionTracker(next, chain as never),
    );
  };
  return {
    executor,
    journal,
    venue,
    signer,
    observed,
    receipt,
    reopen,
    sends: () => sends,
    waitError: (error?: Error) => {
      waitError = error;
    },
    head: (value: bigint) => {
      head = value;
    },
  };
}

test('redemption saves transaction intent before sending and confirms a matching transaction', async () => {
  const x = setup();
  assert.equal((await x.executor.redeem('m1', '123', wallet)).settled, true);
  assert.equal(x.sends(), 1);
  assert.equal(x.journal.data.redemptions.m1.directTransactions[0].confirmed, true);
  assert.equal((await x.reopen().redemption('m1', wallet)).settled, true);
});

for (const field of ['from', 'to', 'input', 'value'] as const) {
  test(`redemption recovery rejects a successful transaction with mismatched ${field}`, async () => {
    const x = setup();
    x.waitError(new Error('链上交易与请求不一致，需人工核对'));
    if (field === 'value') x.observed.value = 1n;
    else x.observed[field] = (field === 'input' ? '0xffff' : '0x' + '4'.repeat(40)) as never;
    assert.equal((await x.executor.redeem('m1', '123', wallet)).settled, false);
    const recovered = x.reopen();
    assert.equal((await recovered.redemption('m1', wallet)).settled, false);
    assert.equal((await recovered.redeem('m1', '123', wallet)).settled, false);
    assert.equal(x.sends(), 1, 'an uncertain redemption is never resubmitted');
  });
}

test('a timed-out matching redemption can be confirmed after restart without sending again', async () => {
  const x = setup();
  x.waitError(new Error('timeout'));
  assert.equal((await x.executor.redeem('m1', '123', wallet)).settled, false);
  const recovered = x.reopen();
  x.head(11n);
  assert.equal((await recovered.redemption('m1', wallet)).settled, false);
  x.head(12n);
  const result = await recovered.redemption('m1', wallet);
  assert.equal(result.settled, true);
  assert.equal(result.transactionHash, txHash);
  assert.equal(x.sends(), 1);
});

test('a bare hash without recorded transaction intent cannot settle a redemption', async () => {
  const x = setup();
  x.journal.data.redemptions.m1 = {
    status: 'unconfirmed',
    transactionHash: txHash,
    directTransactions: [],
    submissionComplete: true,
  };
  assert.equal((await x.executor.redemption('m1', wallet)).settled, false);
});

test('a partly submitted multi-transaction redemption cannot settle the whole market', async () => {
  const x = setup();
  x.venue.redeemPositions = async () => {
    const first = await x.signer.sendTransaction(request);
    await first.wait();
    throw new Error('workflow interrupted before the next transaction');
  };
  assert.equal((await x.executor.redeem('m1', '123', wallet)).settled, false);
  assert.equal(x.journal.data.redemptions.m1.directTransactions[0].confirmed, true);
  assert.equal(x.journal.data.redemptions.m1.submissionComplete, false);
  assert.equal((await x.reopen().redemption('m1', wallet)).settled, false);
  assert.equal(x.sends(), 1);
});

test('a multi-transaction workflow continues after inclusion but settles only after confirmation', async () => {
  const x = setup();
  x.head(11n);
  x.venue.redeemPositions = async () => {
    const first = await x.signer.sendTransaction(request);
    await first.wait();
    return x.signer.sendTransaction({ ...request, data: '0x5678' as never });
  };
  assert.equal((await x.executor.redeem('m1', '123', wallet)).settled, false);
  assert.equal(x.journal.data.redemptions.m1.submissionComplete, true);
  assert.equal(x.journal.data.redemptions.m1.directTransactions.length, 2);
  x.head(12n);
  assert.equal((await x.reopen().redemption('m1', wallet)).settled, true);
  assert.equal(x.sends(), 2);
});

test('failure to save redemption intent prevents the signer from sending', async () => {
  const x = setup();
  x.journal.save = async () => {
    if (x.journal.data.redemptions.m1?.directTransactions.length) throw new Error('disk-full');
  };
  await assert.rejects(x.executor.redeem('m1', '123', wallet), /disk-full/);
  assert.equal(x.sends(), 0);
});

test('direct transactions outside the redemption workflow never reach the signer', async () => {
  const x = setup();
  await assert.rejects(x.signer.sendTransaction(request), /TRANSACTION_OUTSIDE_REDEMPTION/);
  assert.equal(x.sends(), 0);
});
