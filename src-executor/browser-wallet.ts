import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Hex,
} from 'viem';
import { polygon } from 'viem/chains';
import { signerFrom } from '@polymarket/client/viem';
import type { Signer } from '@polymarket/client';
import { browserWalletPage } from './browser-wallet-page.js';

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const equal = (a: string, b: string) =>
  Boolean(
    a &&
    b &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  );
type Rpc = { method: string; params?: unknown };
type Pending = Rpc & {
  id: string;
  expiresAt: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Session-only EIP-1193 transport. Wallet keys and browser session tokens are never persisted. */
export class BrowserWallet {
  private link?: { token: string; expiresAt: number };
  private session?: {
    token: string;
    address: `0x${string}` | null;
    seenAt: number;
    generation: number;
  };
  private pending?: Pending;
  private generation = 0;
  constructor(
    readonly accountWallet: string,
    readonly invalidate: () => void = () => {},
    readonly requestTimeoutMs = 45000,
  ) {}
  open(origin: string) {
    if (this.pending) throw new Error('先在钱包中完成或拒绝当前签名请求');
    this.link = { token: randomBytes(32).toString('hex'), expiresAt: Date.now() + 60000 };
    return {
      url: `${origin}/wallet#${this.link.token}`,
      expiresAt: new Date(this.link.expiresAt).toISOString(),
    };
  }
  status() {
    if (this.session && Date.now() - this.session.seenAt > 15000) this.disconnect();
    return {
      connected: Boolean(this.session?.address),
      signerAddress: this.session?.address ?? null,
      walletAddress: this.accountWallet,
      chainId: 137,
      pending: this.pending
        ? {
            id: this.pending.id,
            method: this.pending.method,
            expiresAt: new Date(this.pending.expiresAt).toISOString(),
          }
        : null,
    };
  }
  disconnect() {
    this.link = undefined;
    this.session = undefined;
    this.generation++;
    this.rejectPending('钱包连接已关闭；尚未提交的签名请求已取消');
    this.invalidate();
  }
  private rejectPending(message: string) {
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
  }
  private current(generation?: number) {
    this.status();
    if (
      !this.session?.address ||
      (generation !== undefined && this.session.generation !== generation)
    )
      throw new Error('钱包未连接或账户已变化，请重新连接并核对账户');
    return this.session as typeof this.session & { address: `0x${string}` };
  }
  signer(): Signer {
    const session = this.current();
    const epoch = session.generation;
    const chain = createPublicClient({ chain: polygon, transport: http() });
    const adapter = signerFrom(
      createWalletClient({
        account: session.address,
        chain: polygon,
        transport: custom(
          {
            request: async (rpc: Rpc) => {
              const active = this.current(epoch);
              if (rpc.method === 'eth_accounts') return [active.address];
              if (rpc.method === 'eth_chainId') return '0x89';
              if (
                !['eth_signTypedData_v4', 'personal_sign', 'eth_sendTransaction'].includes(
                  rpc.method,
                )
              ) {
                if (
                  ![
                    'eth_getTransactionReceipt',
                    'eth_getTransactionByHash',
                    'eth_blockNumber',
                    'eth_getBlockByNumber',
                    'eth_getTransactionCount',
                    'eth_estimateGas',
                    'eth_gasPrice',
                    'eth_maxPriorityFeePerGas',
                    'eth_feeHistory',
                    'eth_call',
                  ].includes(rpc.method)
                )
                  throw new Error('不支持的钱包 RPC');
                return chain.request(rpc as never);
              }
              if (this.pending) throw new Error('已有待确认的钱包请求');
              const value = await new Promise<unknown>((resolve, reject) => {
                const id = randomUUID();
                const timer = setTimeout(() => {
                  if (this.pending?.id === id)
                    this.rejectPending('钱包确认超时，本次请求不会自动重发');
                }, this.requestTimeoutMs);
                this.pending = {
                  ...rpc,
                  id,
                  expiresAt: Date.now() + this.requestTimeoutMs,
                  resolve,
                  reject,
                  timer,
                };
              });
              this.current(epoch);
              if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value))
                throw new Error('钱包返回格式无效');
              if (rpc.method === 'eth_sendTransaction') {
                if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('钱包交易标识无效');
              } else {
                const params = rpc.params as string[];
                const recovered =
                  rpc.method === 'personal_sign'
                    ? await recoverMessageAddress({
                        message: { raw: params[0] as Hex },
                        signature: value as Hex,
                      })
                    : await recoverTypedDataAddress({ ...JSON.parse(params[1]), signature: value });
                if (recovered.toLowerCase() !== active.address.toLowerCase())
                  throw new Error('签名与已连接钱包不一致');
              }
              return value;
            },
          },
          { retryCount: 0 },
        ),
      }),
    );
    return {
      getAddress: async () =>
        this.current(epoch).address as Awaited<ReturnType<Signer['getAddress']>>,
      signMessage: async (message) => {
        this.current(epoch);
        return adapter.signMessage(message);
      },
      signTypedData: async (payload) => {
        this.current(epoch);
        return adapter.signTypedData(payload);
      },
      sendTransaction: async (request) => {
        this.current(epoch);
        if (request.chainId !== 137) throw new Error('仅支持 Polygon 钱包操作');
        const tx = await adapter.sendTransaction(request);
        return {
          ...tx,
          transactionHash: tx.transactionHash,
          transactionId: tx.transactionId,
          wait: async () => {
            const result = await tx.wait();
            const observed = await chain.getTransaction({ hash: result.transactionHash as Hex });
            if (
              observed.from.toLowerCase() !== session.address.toLowerCase() ||
              observed.to?.toLowerCase() !== request.to.toLowerCase() ||
              observed.input !== (request.data ?? '0x') ||
              observed.value !== (request.value ?? 0n)
            )
              throw new Error('链上交易与请求不一致，需人工核对');
            return result;
          },
        };
      },
    };
  }
  async handle(req: IncomingMessage, res: ServerResponse, origin: string) {
    if (!req.url?.startsWith('/wallet')) return false;
    const json = (code: number, body: unknown) => {
      res
        .writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
    };
    const host = new URL(origin).host;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin)) {
      json(403, { error: '连接来源无效' });
      return true;
    }
    if (req.method === 'GET' && req.url === '/wallet') {
      const nonce = randomBytes(18).toString('base64');
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        })
        .end(browserWalletPage(nonce));
      return true;
    }
    if (
      req.method !== 'POST' ||
      req.headers.origin !== origin ||
      !req.headers['content-type']?.startsWith('application/json')
    ) {
      json(403, { error: '连接来源无效' });
      return true;
    }
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 128 * 1024) {
        json(413, { error: '请求过大' });
        return true;
      }
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch {
      json(400, { error: '请求格式无效' });
      return true;
    }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.url === '/wallet/claim') {
      if (!this.link || Date.now() > this.link.expiresAt || !equal(bearer, this.link.token)) {
        json(401, { error: '连接链接已失效，请从 PolyAgent 重新打开' });
        return true;
      }
      this.disconnect();
      this.session = {
        token: randomBytes(32).toString('hex'),
        address: null,
        seenAt: Date.now(),
        generation: ++this.generation,
      };
      json(200, { token: this.session.token, walletAddress: this.accountWallet });
      return true;
    }
    this.status();
    if (!this.session || !equal(bearer, this.session.token)) {
      json(401, { error: '钱包会话已结束，请从 PolyAgent 重新连接' });
      return true;
    }
    this.session.seenAt = Date.now();
    if (req.url === '/wallet/connect') {
      if (
        this.session.address ||
        typeof body.address !== 'string' ||
        !addressPattern.test(body.address) ||
        body.chainId !== '0x89'
      ) {
        json(400, { error: '请使用 Polygon 网络并重新连接' });
        return true;
      }
      this.session.address = body.address as `0x${string}`;
      this.invalidate();
      json(200, this.status());
    } else if (req.url === '/wallet/poll') {
      json(200, {
        ...this.status(),
        request: this.pending
          ? {
              id: this.pending.id,
              method: this.pending.method,
              params: this.pending.params,
              expiresAt: this.pending.expiresAt,
            }
          : null,
      });
    } else if (req.url === '/wallet/respond') {
      const p = this.pending;
      if (!p || body.id !== p.id || Date.now() > p.expiresAt) {
        json(409, { error: '签名请求已失效，不会重发' });
        return true;
      }
      this.pending = undefined;
      clearTimeout(p.timer);
      if (body.rejected === true)
        p.reject(Object.assign(new Error('用户在钱包中拒绝签名'), { code: 4001 }));
      else p.resolve(body.result);
      json(200, { received: true });
    } else if (req.url === '/wallet/disconnect') {
      this.disconnect();
      json(200, { disconnected: true });
    } else json(404, { error: '未知钱包操作' });
    return true;
  }
}
