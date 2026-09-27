import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKey } from '@polymarket/client/viem';
import { authenticationOnlySigner } from '../src-executor/auth-only.js';
test('observation signer permits only fresh ClobAuth for its own address', async () => {
  const base = privateKey('0x' + '1'.repeat(64)); // Public, deterministic test-only key.
  const signer = authenticationOnlySigner(base);
  const payload = {
    domain: { name: 'ClobAuthDomain', version: '1', chainId: 137 },
    primaryType: 'ClobAuth',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ClobAuth: [
        { name: 'address', type: 'address' },
        { name: 'timestamp', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'message', type: 'string' },
      ],
    },
    message: {
      address: await signer.getAddress(),
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: 0,
      message: 'This message attests that I control the given wallet',
    },
  };
  assert.match(await signer.signTypedData(payload as never), /^0x[0-9a-f]+$/i);
  await assert.rejects(
    signer.signTypedData({ ...payload, primaryType: 'Order' } as never),
    /DENIED/,
  );
  await assert.rejects(
    signer.signTypedData({
      ...payload,
      message: { ...payload.message, address: '0x' + '2'.repeat(40) },
    } as never),
    /MISMATCH/,
  );
  await assert.rejects(
    signer.signTypedData({ ...payload, message: { ...payload.message, timestamp: '1' } } as never),
    /EXPIRED/,
  );
  await assert.rejects(signer.signMessage('0x00' as never), /DENIED/);
  await assert.rejects(
    signer.sendTransaction({ chainId: 137, to: await signer.getAddress() }),
    /DENIED/,
  );
});
