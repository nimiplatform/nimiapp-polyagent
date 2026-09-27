import { AsyncEntry } from '@napi-rs/keyring';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { privateKey } from '@polymarket/client/viem';
import type { Signer } from '@polymarket/client';

const SERVICE = 'ai.nimi.polyagent.polymarket.signer';
export type WalletReference = {
  credentialRef: string;
  signerAddress: string;
  walletAddress: string;
  importedAt: string;
};
function entry(ref: string) {
  if (process.platform !== 'darwin') throw new Error('当前私钥导入仅支持 macOS Keychain');
  if (!/^polyagent-[0-9a-f-]{36}$/.test(ref)) throw new Error('钱包凭据引用无效');
  return new AsyncEntry(SERVICE, ref);
}
export function validateImport(value: unknown, wallet: unknown) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.trim()))
    throw new Error('请输入 0x 开头的 64 位十六进制私钥');
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet.trim()))
    throw new Error('请输入 Polymarket 账户的钱包地址');
  try {
    const signerAddress = privateKeyToAccount(value.trim() as `0x${string}`).address;
    return { signerAddress, walletAddress: wallet.trim() };
  } catch {
    throw new Error('私钥不是有效的签名密钥');
  }
}
/** One-time business-account import. This module exposes no renderer secret getter. */
export async function importWallet(value: unknown, wallet: unknown): Promise<WalletReference> {
  const identity = validateImport(value, wallet);
  const ref = `polyagent-${randomUUID()}`;
  const bytes = Uint8Array.from(Buffer.from((value as string).trim().slice(2), 'hex'));
  try {
    await entry(ref).setSecret(bytes);
    return { ...identity, credentialRef: ref, importedAt: new Date().toISOString() };
  } catch {
    throw new Error('无法将私钥保存到 macOS Keychain。请检查钥匙串是否已解锁。');
  } finally {
    bytes.fill(0);
  }
}
export async function walletStatus(ref: string) {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await entry(ref).getSecret();
    return { available: bytes?.length === 32, reason: bytes ? 'ready' : 'not-found' };
  } catch {
    return { available: false, reason: 'keychain-unavailable' };
  } finally {
    bytes?.fill(0);
  }
}
export async function removeWallet(ref: string) {
  try {
    return await entry(ref).deleteCredential();
  } catch {
    throw new Error('Keychain 未允许删除凭据，当前引用仍保留。');
  }
}
/** The cached SDK client retains this reference-only signer, never a cached private key. */
export function keychainSigner(ref: string): Signer {
  const withSigner = async <T>(action: (signer: Signer) => Promise<T>): Promise<T> => {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await entry(ref).getSecret();
      if (!bytes || bytes.length !== 32) throw new Error('KEYCHAIN_CREDENTIAL_MISSING');
      const signer = privateKey(`0x${Buffer.from(bytes).toString('hex')}`);
      return await action(signer);
    } finally {
      bytes?.fill(0);
    }
  };
  return {
    getAddress: () => withSigner((s) => s.getAddress()),
    signTypedData: (payload) => withSigner((s) => s.signTypedData(payload)),
    signMessage: (message) => withSigner((s) => s.signMessage(message)),
    sendTransaction: (request) => withSigner((s) => s.sendTransaction(request)),
  };
}
