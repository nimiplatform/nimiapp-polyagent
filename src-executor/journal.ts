import { mkdir, readFile, open, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Receipt } from '../src/polyagent/integration.js';
export type JournalOrder = {
  requestHash: string;
  request: {
    signingMethod: 'keychain' | 'wallet';
    walletAddress: string;
    submissionId: string;
    marketId: string;
    assetId: string;
    side: 'buy' | 'sell';
    shares: number;
    limitPrice: number;
    maxSpendUsd: number;
  };
  receipt: Receipt;
  createdAt: string;
  dispatchedAt?: string;
  signedOrder?: unknown;
  response?: unknown;
  marketFee?: import('../src/polyagent/model.js').Market['fee'];
};
export type JournalData = {
  version: 1;
  wallet: string;
  orders: Record<string, JournalOrder>;
  redemptions: Record<
    string,
    {
      status: 'submitting' | 'confirmed' | 'unconfirmed';
      transactionHash?: string;
      transactionId?: string;
    }
  >;
};
export interface Journal {
  data: JournalData;
  save(): Promise<void>;
}
export class FileJournal implements Journal {
  data: JournalData = { version: 1, wallet: '', orders: {}, redemptions: {} };
  constructor(readonly directory: string) {}
  async load(wallet: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(
        await readFile(path.join(this.directory, 'journal.json'), 'utf8'),
      ) as JournalData;
      if (
        value.version !== 1 ||
        typeof value.wallet !== 'string' ||
        !value.orders ||
        !value.redemptions
      )
        throw new Error('Executor journal belongs to another wallet or is invalid');
      // A disabled executor may be configured before its first wallet. Bind only
      // an untouched, unbound journal; an existing wallet is never substituted.
      if (
        !value.wallet &&
        Object.keys(value.orders).length === 0 &&
        Object.keys(value.redemptions).length === 0
      )
        value.wallet = wallet;
      if (value.wallet.toLowerCase() !== wallet.toLowerCase())
        throw new Error('Executor journal belongs to another wallet');
      this.data = value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.data.wallet = wallet;
      await this.save();
    }
    for (const row of Object.values(this.data.orders))
      if (row.receipt.status === 'submitting') row.receipt.status = 'unconfirmed';
    for (const row of Object.values(this.data.redemptions))
      if (row.status === 'submitting') row.status = 'unconfirmed';
    await this.save();
  }
  async save() {
    const file = path.join(this.directory, 'journal.json');
    const next = path.join(this.directory, 'journal.next');
    const handle = await open(next, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(this.data));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(next, file);
  }
}
