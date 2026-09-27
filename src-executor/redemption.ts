import { AsyncLocalStorage } from 'node:async_hooks';
import type { Signer, SignerTransactionRequest, TransactionHandle } from '@polymarket/client';
import { createPublicClient, http, type Hex } from 'viem';
import { polygon } from 'viem/chains';
import type {
  Journal,
  JournalRedemption,
  RedemptionTransaction,
  TransactionIntent,
} from './journal.js';

type Chain = Pick<
  ReturnType<typeof createPublicClient>,
  'getTransaction' | 'getTransactionReceipt' | 'getBlockNumber'
>;

export function transactionIntent(
  from: string,
  request: SignerTransactionRequest,
): TransactionIntent {
  if (request.chainId !== 137) throw new Error('REDEMPTION_CHAIN_MISMATCH');
  return {
    chainId: request.chainId,
    from,
    to: request.to,
    data: request.data ?? '0x',
    value: (request.value ?? 0n).toString(),
  };
}

export function assertTransactionMatches(
  intent: TransactionIntent,
  observed: { from: string; to: string | null; input: string; value: bigint },
) {
  if (
    intent.chainId !== 137 ||
    observed.from.toLowerCase() !== intent.from.toLowerCase() ||
    observed.to?.toLowerCase() !== intent.to.toLowerCase() ||
    observed.input.toLowerCase() !== intent.data.toLowerCase() ||
    observed.value !== BigInt(intent.value)
  )
    throw new Error('链上交易与请求不一致，需人工核对');
}

/** Capture the exact public SDK transaction before a signer can broadcast it. */
export class RedemptionTracker {
  private scope = new AsyncLocalStorage<JournalRedemption>();
  constructor(
    readonly journal: Journal,
    readonly chain: Chain = createPublicClient({ chain: polygon, transport: http() }),
  ) {}

  async run(row: JournalRedemption, submit: () => Promise<TransactionHandle>) {
    return this.scope.run(row, async () => {
      const handle = await submit();
      // A market redemption may send more than one transaction. An interrupted
      // workflow must not settle the whole market after only its first send.
      row.transactionHash = handle.transactionHash ?? undefined;
      row.transactionId = handle.transactionId ?? undefined;
      row.submissionComplete = true;
      await this.journal.save();
      return handle;
    });
  }

  wrapSigner(signer: Signer): Signer {
    return {
      getAddress: () => signer.getAddress(),
      signMessage: (message) => signer.signMessage(message),
      signTypedData: (payload) => signer.signTypedData(payload),
      sendTransaction: async (request) => {
        const row = this.scope.getStore();
        if (!row) throw new Error('TRANSACTION_OUTSIDE_REDEMPTION');
        const transaction: RedemptionTransaction = {
          intent: transactionIntent(await signer.getAddress(), request),
        };
        row.directTransactions.push(transaction);
        await this.journal.save();
        const handle = await signer.sendTransaction(request);
        transaction.transactionHash = handle.transactionHash ?? undefined;
        await this.journal.save();
        return {
          get transactionHash() {
            return handle.transactionHash;
          },
          get transactionId() {
            return handle.transactionId;
          },
          wait: async () => {
            let result;
            try {
              result = await handle.wait();
            } finally {
              // Keep a replacement hash even when waiting for it times out.
              if (
                handle.transactionHash &&
                handle.transactionHash !== transaction.transactionHash
              ) {
                transaction.transactionHash = handle.transactionHash;
                await this.journal.save();
              }
            }
            transaction.transactionHash = result.transactionHash;
            await this.journal.save();
            // The SDK may await this step before sending the next transaction.
            // Verified inclusion can continue that workflow; ledger settlement
            // still requires the confirmation depth checked by confirmed().
            if ((await this.transactionState(transaction)) === 'pending')
              throw new Error('赎回交易尚未取得成功的链上回执');
            return result;
          },
        };
      },
    };
  }

  private async transactionState(
    transaction: RedemptionTransaction,
  ): Promise<'pending' | 'included' | 'confirmed'> {
    if (transaction.confirmed) return 'confirmed';
    if (!transaction.transactionHash || !transaction.intent) return 'pending';
    const hash = transaction.transactionHash as Hex;
    const [observed, receipt, block] = await Promise.all([
      this.chain.getTransaction({ hash }),
      this.chain.getTransactionReceipt({ hash }),
      this.chain.getBlockNumber(),
    ]);
    assertTransactionMatches(transaction.intent, observed);
    if (
      observed.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      receipt.status !== 'success'
    )
      return 'pending';
    if (block - receipt.blockNumber < 2n) return 'included';
    transaction.confirmed = true;
    await this.journal.save();
    return 'confirmed';
  }

  async confirmed(row: JournalRedemption) {
    if (!row.submissionComplete || !row.directTransactions?.length) return false;
    for (const transaction of row.directTransactions)
      if ((await this.transactionState(transaction)) !== 'confirmed') return false;
    return true;
  }
}
