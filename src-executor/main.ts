import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { open, unlink, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readExecutorSecrets, type ExecutorConfig } from './config.js';
import { authenticationOnlySigner } from './auth-only.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSecureClient, relayerApiKey, type SecureClient } from '@polymarket/client';
import { keychainSigner } from './keychain.js';
import { z } from 'zod';
import { TradingExecutor, submitSchema } from './trading.js';
import { FileJournal } from './journal.js';
import { walletAddressSchema } from '../src/polyagent/integration.js';
import { BrowserWallet } from './browser-wallet.js';

export function createExecutorServer(
  executor: TradingExecutor,
  token: string,
  browserWallet?: BrowserWallet,
): Server {
  if (token.length < 32)
    throw new Error('Executor bearer token must contain at least 32 characters');
  return createServer((req, res) => {
    void (async () => {
      const origin = `http://127.0.0.1:${req.socket.localPort}`;
      if (browserWallet && (await browserWallet.handle(req, res, origin))) return;
      const host = (req.headers.host ?? '').split(':')[0];
      const auth = req.headers.authorization ?? '';
      const expected = `Bearer ${token}`;
      if (
        !['127.0.0.1', 'localhost'].includes(host) ||
        req.headers.origin ||
        Buffer.byteLength(auth) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
      ) {
        res.writeHead(401).end('Unauthorized');
        return;
      }
      if (req.url !== '/mcp' || req.method !== 'POST') {
        res.writeHead(405).end('Use POST /mcp');
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 256 * 1024) {
          res.writeHead(413).end();
          return;
        }
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const server = new McpServer({ name: 'PolyAgent Polymarket executor', version: '1.0.0' });
      const result = (value: unknown) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
        structuredContent: value as Record<string, unknown>,
      });
      const fail = () => ({
        content: [
          { type: 'text' as const, text: '执行未完成。请检查执行器账户、权限、限额及原订单状态。' },
        ],
        isError: true,
      });
      const empty = z.object({}).strict();
      const id = z
        .object({ submissionId: z.string().uuid(), walletAddress: walletAddressSchema })
        .strict();
      const output = z.object({}).passthrough();
      for (const operation of ['open', 'status', 'disconnect'] as const) {
        server.registerTool(
          `polyagent.wallet.${operation}`,
          {
            description:
              operation === 'open'
                ? 'Open a one-use local browser wallet connection link. Never signs or submits a trade.'
                : operation === 'status'
                  ? 'Read the current browser wallet connection and pending signature status.'
                  : 'Disconnect the browser wallet and reject pending signing requests. Existing venue orders remain.',
            inputSchema: empty,
            outputSchema: output,
            annotations: { readOnlyHint: operation === 'status' },
          },
          async () => {
            if (!browserWallet) return fail();
            try {
              if (operation === 'open') return result(browserWallet.open(origin));
              if (operation === 'disconnect') browserWallet.disconnect();
              return result(browserWallet.status());
            } catch {
              return fail();
            }
          },
        );
      }
      server.registerTool(
        'polyagent.account',
        {
          description:
            'Read this executor account readiness, actual balance and independent capital limits. Does not authorize or fund a wallet.',
          inputSchema: empty,
          outputSchema: output,
          annotations: { readOnlyHint: true },
        },
        async () => {
          try {
            return result(await executor.account());
          } catch {
            return fail();
          }
        },
      );
      server.registerTool(
        'polyagent.order.submit',
        {
          description:
            'Submit one bounded FAK order with a durable submission ID. Never repeat an uncertain write; query the same submission ID.',
          inputSchema: submitSchema,
          outputSchema: output,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        },
        async (input, extra) => {
          try {
            extra.signal.throwIfAborted();
            return result(await executor.submit(input, extra.signal));
          } catch {
            return fail();
          }
        },
      );
      server.registerTool(
        'polyagent.order.get',
        {
          description:
            'Reconcile one exact submission against exchange orders and confirmed trades. Missing correlation stays uncertain.',
          inputSchema: id,
          outputSchema: output,
          annotations: { readOnlyHint: true },
        },
        async (input) => {
          try {
            return result(await executor.get(input.submissionId, input.walletAddress));
          } catch {
            return fail();
          }
        },
      );
      server.registerTool(
        'polyagent.order.cancel',
        {
          description:
            'Cancel the remaining amount of this exact known exchange order, then reconcile actual fills.',
          inputSchema: id,
          outputSchema: output,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        },
        async (input, extra) => {
          try {
            extra.signal.throwIfAborted();
            return result(await executor.cancel(input.submissionId, input.walletAddress));
          } catch {
            return fail();
          }
        },
      );
      server.registerTool(
        'polyagent.position.redeem',
        {
          description:
            'Redeem resolved market positions once. Return confirmed only after actual transaction settlement.',
          inputSchema: z
            .object({
              signingMethod: z.enum(['keychain', 'wallet']),
              walletAddress: walletAddressSchema,
              marketId: z.string().min(1).max(128),
              assetId: z.string().regex(/^\d+$/).max(128),
            })
            .strict(),
          outputSchema: output,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        },
        async (input, extra) => {
          try {
            extra.signal.throwIfAborted();
            if (input.signingMethod !== executor.limits.signingMethod) return fail();
            return result(
              await executor.redeem(
                input.marketId,
                input.assetId,
                input.walletAddress,
                extra.signal,
              ),
            );
          } catch {
            return fail();
          }
        },
      );
      server.registerTool(
        'polyagent.position.redemption',
        {
          description:
            'Read and reconcile a prior redemption without submitting any new transaction.',
          inputSchema: z
            .object({ marketId: z.string().min(1).max(128), walletAddress: walletAddressSchema })
            .strict(),
          outputSchema: output,
          annotations: { readOnlyHint: true },
        },
        async (input) => {
          try {
            return result(await executor.redemption(input.marketId, input.walletAddress));
          } catch {
            return fail();
          }
        },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
      } catch {
        if (!res.headersSent) res.writeHead(500).end('Executor transport failed');
      }
    })().catch(() => {
      if (!res.headersSent && !res.destroyed) res.writeHead(400).end('Invalid executor request');
    });
  });
}
export async function startExecutor(config: ExecutorConfig) {
  const { mode, signingMethod, port } = config;
  const directory = path.resolve(config.stateDirectory);
  const wallet = config.wallet.walletAddress;
  const { maxOrderUsd, maxExposureUsd, maxBuyOrders, maxBuyBudgetUsd } = config.limits;
  const secrets = await readExecutorSecrets(config.secretsRef);
  const token = secrets.bearer;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, 'executor.lock');
  // Recover only a proven-dead owner; never reset the submission journal.
  try {
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('EXECUTOR_LOCK_INVALID');
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lockPath);
      else throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx', 0o600);
  const releaseLock = async () => {
    await lock.close();
    await unlink(lockPath);
  };
  try {
    await lock.writeFile(String(process.pid));
    let client: Promise<SecureClient> | undefined;
    const browserWallet =
      signingMethod === 'wallet'
        ? new BrowserWallet(wallet, () => {
            client = undefined;
          })
        : undefined;
    const connect = () => {
      if (mode === 'disabled') throw new Error('ACCOUNT_ACCESS_DISABLED');
      if (!client) {
        const baseSigner = browserWallet
          ? browserWallet.signer()
          : keychainSigner(config.wallet.credentialRef!);
        const signer = mode === 'observe' ? authenticationOnlySigner(baseSigner) : baseSigner;
        client = (async () => {
          if (
            (await signer.getAddress()).toLowerCase() !== config.wallet.signerAddress.toLowerCase()
          )
            throw new Error('SIGNER_ADDRESS_MISMATCH');
          const value = await createSecureClient({
            wallet,
            signer,
            ...(secrets.relayerKey
              ? {
                  apiKey: relayerApiKey({
                    key: secrets.relayerKey,
                    address: secrets.relayerAddress,
                  }),
                }
              : {}),
          });
          if (
            value.account.wallet.toLowerCase() !== wallet.toLowerCase() ||
            value.account.signer.toLowerCase() !== config.wallet.signerAddress.toLowerCase() ||
            value.account.signerType !== 'OWNER'
          )
            throw new Error('ACCOUNT_IDENTITY_MISMATCH');
          return value;
        })().catch((error) => {
          client = undefined;
          throw error;
        });
      }
      return client;
    };
    const journal = new FileJournal(directory);
    await journal.load(wallet);
    const executor = new TradingExecutor(
      journal,
      {
        mode,
        maxBuyOrders,
        maxBuyBudgetUsd,
        wallet,
        maxOrderUsd,
        maxExposureUsd,
        signingMethod: signingMethod as 'keychain' | 'wallet',
      },
      connect,
      undefined,
      undefined,
      () => browserWallet?.status().connected ?? false,
    );
    const server = createExecutorServer(executor, token, browserWallet);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    let stopping: Promise<void> | undefined;
    return {
      mode,
      url: `http://127.0.0.1:${port}/mcp`,
      stop: () =>
        (stopping ??= (async () => {
          // Refuse newly queued financial work, drain accepted work, then release ownership.
          executor.limits.mode = 'disabled';
          browserWallet?.disconnect();
          const closed = new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          server.closeIdleConnections();
          await executor.serial(async () => undefined);
          await closed;
          await releaseLock();
        })()),
    };
  } catch (error) {
    await releaseLock();
    throw error;
  }
}
