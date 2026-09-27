import { z } from 'zod';
import type { NimiLocalAppIntegrationClient, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
export const EXECUTOR_VERSION = 'polyagent.trade.v1';
export const walletAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const WALLET_OPERATIONS = [
  'polyagent.wallet.open',
  'polyagent.wallet.status',
  'polyagent.wallet.disconnect',
] as const;
export const LIVE_OPERATIONS = [
  'polyagent.account',
  'polyagent.order.submit',
  'polyagent.order.get',
  'polyagent.order.cancel',
  'polyagent.position.redeem',
  'polyagent.position.redemption',
] as const;
export const receiptSchema = z.object({
  protocol: z.literal(EXECUTOR_VERSION),
  walletAddress: walletAddressSchema,
  submissionId: z.string(),
  status: z.enum([
    'prepared',
    'submitting',
    'open',
    'filled',
    'partially-filled',
    'canceled',
    'rejected',
    'unconfirmed',
  ]),
  exchangeOrderId: z.string().optional(),
  filledShares: z.number().nonnegative(),
  notionalUsd: z.number().nonnegative(),
  feeUsd: z.number().nonnegative(),
  tradeIds: z.array(z.string()),
  message: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;
export const accountSchema = z.object({
  protocol: z.literal(EXECUTOR_VERSION),
  access: z.enum(['disabled', 'observe', 'live']),
  approvedVenues: z.array(z.enum(['standard', 'neg-risk', 'v2'])),
  buyOrdersRemaining: z.number().int().nonnegative(),
  remainingBuyBudgetUsd: z.number().nonnegative(),
  signingMethod: z.enum(['keychain', 'wallet']),
  wallet: z.string(),
  ready: z.boolean(),
  cashUsd: z.number().nonnegative().nullable(),
  exposureUsd: z.number().nonnegative().nullable(),
  approvalsReady: z.boolean(),
  geoblocked: z.boolean(),
  maxOrderUsd: z.number().nonnegative(),
  maxExposureUsd: z.number().nonnegative(),
  message: z.string(),
});
export type TradingAccount = z.infer<typeof accountSchema>;
export function compatible(t: NimiIntegrationTarget) {
  return LIVE_OPERATIONS.every((name) => t.operations.some((o) => o.name === name)) && t.available;
}
export function permitted(t: NimiIntegrationTarget, method?: 'keychain' | 'wallet') {
  return [...LIVE_OPERATIONS, ...(method === 'wallet' ? WALLET_OPERATIONS : [])].every((name) =>
    t.permittedOperations.includes(name),
  );
}
export function unpackIntegrationResult(resultJson: string): unknown {
  const raw = JSON.parse(resultJson);
  if (raw && typeof raw === 'object' && 'structuredContent' in raw) return raw.structuredContent;
  if (raw && typeof raw === 'object' && Array.isArray(raw.content)) {
    const text = raw.content.find((x: { type?: string }) => x.type === 'text')?.text;
    if (typeof text === 'string') return JSON.parse(text);
  }
  return raw;
}
/** Never resend. A call ID is persisted before awaiting its terminal result. */
export async function invokeIntegration(
  client: NimiLocalAppIntegrationClient,
  targetRef: string,
  operation: string,
  input: unknown,
  options: {
    signal?: AbortSignal;
    accepted?: (callId: string) => Promise<void>;
    timeoutMs?: number;
  } = {},
) {
  options.signal?.throwIfAborted();
  let call = await client.invoke({ targetRef, operation, inputJson: JSON.stringify(input) });
  await options.accepted?.(call.callId);
  const end = Date.now() + (options.timeoutMs ?? 85000);
  while (call.status === 'accepted') {
    if (options.signal?.aborted || Date.now() > end) {
      await client.cancelCall({ callId: call.callId }).catch(() => undefined);
      throw Object.assign(new Error('调用结果尚未确认，请核对原调用，不要重新提交'), {
        callId: call.callId,
        unconfirmed: true,
      });
    }
    await new Promise((r) => setTimeout(r, 450));
    call = await client.getCall({ callId: call.callId });
  }
  if (call.status !== 'completed')
    throw Object.assign(
      new Error(
        call.errorCode === 'INTEGRATION_NETWORK_FAILED'
          ? '无法连接交易服务。请在策略与连接中检查本机服务是否启动，再核对账户；未确认订单只核对原记录，不要重新提交。'
          : `交易执行器：${call.errorCode || call.status}`,
      ),
      {
        callId: call.callId,
        unconfirmed: call.status === 'unconfirmed',
      },
    );
  options.signal?.throwIfAborted();
  return unpackIntegrationResult(call.resultJson);
}
