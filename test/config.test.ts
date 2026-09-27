import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { validateSource } from '../src-executor/config.js';
test('explicit .env import maps only the four documented business fields and verifies the signer', () => {
  const key = '0x' + '1'.repeat(64),
    signer = privateKeyToAccount(key as never).address;
  const source = {
    POLYMARKET_RELAYER_API_KEY: 'test-only-not-an-api-key',
    POLYMARKET_RELAYER_ADDRESS: signer,
    POLYMARKET_RELAYER_PRIVATE_KEY: key,
    POLYMARKET_DEV_ADDRESS: '0x' + '2'.repeat(40),
  };
  const value = validateSource(source, 'keychain');
  assert.equal(
    validateSource({ ...source, POLYMARKET_RELAYER_API_KEY: undefined }, 'keychain').relayerKey,
    undefined,
  );
  assert.equal(value.signer, signer);
  assert.equal(value.wallet, source.POLYMARKET_DEV_ADDRESS);
  assert.throws(
    () =>
      validateSource({ ...source, POLYMARKET_RELAYER_ADDRESS: '0x' + '3'.repeat(40) }, 'keychain'),
    /不匹配/,
  );
  assert.equal(
    validateSource({ ...source, POLYMARKET_RELAYER_PRIVATE_KEY: undefined }, 'wallet').key,
    undefined,
  );
});
