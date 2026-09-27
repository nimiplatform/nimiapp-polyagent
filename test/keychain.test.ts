import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport, keychainSigner } from '../src-executor/keychain.js';

test('private-key import validates both identities without storing or printing input', () => {
  const wallet = '0x' + '2'.repeat(40);
  assert.throws(() => validateImport('not-a-key', wallet), /请输入/);
  assert.throws(() => validateImport('0x' + '0'.repeat(64), wallet), /有效/);
  assert.throws(() => validateImport('0x' + '1'.repeat(64), 'bad-wallet'), /钱包地址/);
  const result = validateImport('0x' + '1'.repeat(64), wallet);
  assert.deepEqual(Object.keys(result).sort(), ['signerAddress', 'walletAddress']);
  assert.match(result.signerAddress, /^0x[0-9a-fA-F]{40}$/);
});
test('reference-only signer rejects a foreign service selector before reading credentials', async () => {
  await assert.rejects(keychainSigner('another-app-secret').getAddress(), /引用无效|仅支持/);
});
