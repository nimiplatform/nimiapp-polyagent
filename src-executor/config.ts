import { AsyncEntry } from '@napi-rs/keyring';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { importWallet, removeWallet, validateImport } from './keychain.js';
import { walletAddressSchema } from '../src/polyagent/integration.js';

const service = 'ai.nimi.polyagent.executor.secrets';
const secretsSchema = z.object({
  bearer: z.string().min(32),
  relayerKey: z.string().min(1).optional(),
  relayerAddress: walletAddressSchema,
});
export const configSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['disabled', 'observe', 'live']),
    signingMethod: z.enum(['keychain', 'wallet']),
    wallet: z.object({
      credentialRef: z
        .string()
        .regex(/^polyagent-[0-9a-f-]{36}$/)
        .optional(),
      signerAddress: walletAddressSchema,
      walletAddress: walletAddressSchema,
    }),
    secretsRef: z.string().regex(/^executor-[0-9a-f-]{36}$/),
    port: z.number().int().min(1024).max(65535),
    stateDirectory: z.string().min(1),
    limits: z
      .object({
        maxOrderUsd: z.number().positive(),
        maxExposureUsd: z.number().positive(),
        maxBuyOrders: z.number().int().positive(),
        maxBuyBudgetUsd: z.number().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.signingMethod === 'keychain' && !c.wallet.credentialRef)
      ctx.addIssue({ code: 'custom', message: 'Keychain 引用缺失' });
    if (
      c.limits.maxOrderUsd > c.limits.maxExposureUsd ||
      c.limits.maxExposureUsd > c.limits.maxBuyBudgetUsd
    )
      ctx.addIssue({ code: 'custom', message: '资金上限顺序无效' });
  });
export type ExecutorConfig = z.infer<typeof configSchema>;
function entry(ref: string) {
  if (process.platform !== 'darwin' || !/^executor-[0-9a-f-]{36}$/.test(ref))
    throw new Error('执行器凭据引用无效');
  return new AsyncEntry(service, ref);
}
export async function readExecutorSecrets(ref: string) {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await entry(ref).getSecret();
    if (!bytes) throw new Error();
    return secretsSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    throw new Error('执行器 Keychain 凭据不可用');
  } finally {
    bytes?.fill(0);
  }
}
export async function loadExecutorConfig(file: string) {
  try {
    return configSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    throw new Error('执行器配置无效，请运行 executor:prepare 或检查指定配置文件');
  }
}
export function validateSource(
  source: Record<string, string | undefined>,
  method: 'keychain' | 'wallet',
) {
  const wallet = walletAddressSchema.parse(source.POLYMARKET_DEV_ADDRESS);
  const signer = walletAddressSchema.parse(source.POLYMARKET_RELAYER_ADDRESS);
  const relayerKey = source.POLYMARKET_RELAYER_API_KEY?.trim();
  let key = source.POLYMARKET_RELAYER_PRIVATE_KEY?.trim();
  if (method === 'keychain') {
    if (key && /^[0-9a-fA-F]{64}$/.test(key)) key = '0x' + key;
    const identity = validateImport(key, wallet);
    if (identity.signerAddress.toLowerCase() !== signer.toLowerCase())
      throw new Error('签名私钥与 Relayer 地址不匹配');
  }
  return {
    wallet,
    signer,
    relayerKey: relayerKey || undefined,
    key: method === 'keychain' ? key : undefined,
  };
}
/** Explicit one-time import; the source file is never changed, copied or logged. */
export async function prepareExecutor(
  sourceFile: string,
  configFile: string,
  limits: ExecutorConfig['limits'],
  method: 'keychain' | 'wallet' = 'keychain',
) {
  try {
    await access(configFile);
    throw new Error('CONFIG_EXISTS');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const source = validateSource(parseEnv(await readFile(sourceFile, 'utf8')), method);
  const secretsRef = 'executor-' + randomUUID();
  let walletRef: Awaited<ReturnType<typeof importWallet>> | undefined,
    savedSecrets = false;
  const payload = Buffer.from(
    JSON.stringify({
      bearer: randomBytes(32).toString('hex'),
      relayerKey: source.relayerKey,
      relayerAddress: source.signer,
    }),
  );
  try {
    if (method === 'keychain') walletRef = await importWallet(source.key, source.wallet);
    await entry(secretsRef).setSecret(payload);
    savedSecrets = true;
    const config = configSchema.parse({
      version: 1,
      mode: 'observe',
      signingMethod: method,
      wallet: {
        credentialRef: walletRef?.credentialRef,
        signerAddress: source.signer,
        walletAddress: source.wallet,
      },
      secretsRef,
      port: 17846,
      stateDirectory: path.join(os.homedir(), '.polyagent-executor', source.wallet.toLowerCase()),
      limits,
    });
    await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return config;
  } catch (error) {
    if (savedSecrets) await entry(secretsRef).deleteCredential();
    if (walletRef) await removeWallet(walletRef.credentialRef);
    throw error;
  } finally {
    payload.fill(0);
  }
}
