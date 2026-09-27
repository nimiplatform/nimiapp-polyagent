import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { stringToHex } from 'viem';
import { BrowserWallet } from '../src-executor/browser-wallet.js';
import { TradingExecutor } from '../src-executor/trading.js';
import { createExecutorServer } from '../src-executor/main.js';

// Public, deterministic test-only keys. These never access a wallet or a chain.
const account = privateKeyToAccount(('0x' + '1'.repeat(64)) as `0x${string}`);
async function fixture(timeout = 2000) {
  const wallet = new BrowserWallet(account.address, () => {}, timeout);
  const executor = new TradingExecutor(
    {
      data: { version: 1, wallet: account.address, orders: {}, redemptions: {} },
      save: async () => {},
    },
    {
      mode: 'disabled',
      maxBuyOrders: 0,
      maxBuyBudgetUsd: 0,
      signingMethod: 'wallet',
      wallet: account.address,
      maxOrderUsd: 0,
      maxExposureUsd: 0,
    },
    async () => {
      throw new Error('must not authenticate');
    },
  );
  const server = createExecutorServer(
    executor,
    'disabled-test-executor-no-funds-'.repeat(2),
    wallet,
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const link = wallet.open(origin);
  const token = new URL(link.url).hash.slice(1);
  const post = (
    operation: string,
    credential: string,
    input: unknown = {},
    originHeader = origin,
  ) =>
    fetch(origin + '/wallet/' + operation, {
      method: 'POST',
      headers: {
        origin: originHeader,
        authorization: 'Bearer ' + credential,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  const connect = async () => {
    const claimed = await post('claim', token);
    assert.equal(claimed.status, 200);
    const session = (await claimed.json()).token as string;
    const result = await post('connect', session, { address: account.address, chainId: '0x89' });
    assert.equal(result.status, 200);
    return session;
  };
  const close = async () => {
    wallet.disconnect();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { wallet, origin, token, post, connect, close };
}

test('browser wallet links are one-use, origin-bound and absent from served HTML', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post('claim', f.token, {}, 'https://unrelated.invalid')).status, 403);
    const page = await fetch(f.origin + '/wallet');
    const html = await page.text();
    assert.ok(page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.equal(html.includes(f.token), false);
    const session = await f.connect();
    assert.equal((await f.post('claim', f.token)).status, 401);
    assert.equal((await f.post('poll', 'wrong-token')).status, 401);
    assert.equal((await f.post('poll', session)).status, 200);
    assert.equal(f.wallet.status().connected, true);
  } finally {
    await f.close();
  }
});

test('official signer adapter verifies an EIP-1193 signature and rejects replay', async () => {
  const f = await fixture();
  try {
    const session = await f.connect();
    const signer = f.wallet.signer();
    const result = signer.signMessage(stringToHex('PolyAgent synthetic transport test') as never);
    await new Promise(setImmediate);
    const { request } = await (await f.post('poll', session)).json();
    assert.equal(request.method, 'personal_sign');
    const signature = await account.signMessage({ message: { raw: request.params[0] } });
    assert.equal(
      (await f.post('respond', session, { id: request.id, result: signature })).status,
      200,
    );
    assert.equal(await result, signature);
    assert.equal(
      (await f.post('respond', session, { id: request.id, result: signature })).status,
      409,
    );
    await f.post('disconnect', session);
    await assert.rejects(signer.getAddress(), /钱包未连接/);
    assert.equal(f.wallet.status().pending, null);
  } finally {
    await f.close();
  }
});

test('wrong-wallet signatures, explicit rejection and timeout never become a valid signature', async () => {
  const f = await fixture(500);
  try {
    const session = await f.connect(),
      signer = f.wallet.signer();
    const signing = signer.signMessage(stringToHex('test') as never);
    const rejected = assert.rejects(signing);
    await new Promise(setImmediate);
    let { request } = await (await f.post('poll', session)).json();
    const wrong = privateKeyToAccount(('0x' + '2'.repeat(64)) as `0x${string}`);
    await f.post('respond', session, {
      id: request.id,
      result: await wrong.signMessage({ message: { raw: request.params[0] } }),
    });
    await rejected;
    const pending = signer.signMessage(stringToHex('test') as never);
    const declined = assert.rejects(pending);
    await new Promise(setImmediate);
    ({ request } = await (await f.post('poll', session)).json());
    await f.post('respond', session, { id: request.id, rejected: true });
    await declined;
    await assert.rejects(signer.signMessage(stringToHex('expires') as never));
    assert.equal(f.wallet.status().pending, null);
  } finally {
    await f.close();
  }
});

test('disconnect rejects a pending signature and a new connection cannot reuse the old signer', async () => {
  const f = await fixture();
  try {
    const session = await f.connect(),
      signer = f.wallet.signer();
    const signing = assert.rejects(signer.signMessage(stringToHex('stop') as never));
    await new Promise(setImmediate);
    await f.post('disconnect', session);
    await signing;
    const newLink = f.wallet.open(f.origin);
    const response = await f.post('claim', new URL(newLink.url).hash.slice(1));
    const next = (await response.json()).token;
    await f.post('connect', next, { address: account.address, chainId: '0x89' });
    await assert.rejects(signer.getAddress(), /账户已变化/);
  } finally {
    await f.close();
  }
});

test('the official adapter round-trips EIP-712 typed data used by trading signatures', async () => {
  const f = await fixture();
  try {
    const session = await f.connect();
    const payload = {
      domain: { name: 'PolyAgent test-only domain', version: '1', chainId: 137 },
      types: {
        Observation: [
          { name: 'nonce', type: 'uint256' },
          { name: 'description', type: 'string' },
        ],
      },
      primaryType: 'Observation',
      message: { nonce: '123', description: 'Synthetic transport test, no trading authority' },
    };
    const pending = f.wallet.signer().signTypedData(payload as never);
    await new Promise(setImmediate);
    const { request } = await (await f.post('poll', session)).json();
    assert.equal(request.method, 'eth_signTypedData_v4');
    assert.equal(request.params[0].toLowerCase(), account.address.toLowerCase());
    const signature = await account.signTypedData(JSON.parse(request.params[1]));
    await f.post('respond', session, { id: request.id, result: signature });
    assert.equal(await pending, signature);
  } finally {
    await f.close();
  }
});
