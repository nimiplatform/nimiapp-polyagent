import { z } from 'zod';

export type Mode = 'paper' | 'live';
export type SigningMethod = 'keychain' | 'wallet';
export type Side = 'buy' | 'sell';
export type Level = { price: number; size: number };
export type Market = {
  venue?: 'standard' | 'neg-risk' | 'v2';
  id: string;
  eventId: string;
  conditionId: string;
  outcomeIndex: 0 | 1;
  slug: string;
  question: string;
  outcome: string;
  tokenId: string;
  indicativePrice: number;
  endAt: string;
  description: string;
  resolutionSource: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: number;
  volume: number;
  observedAt: string;
  fee: { enabled: boolean; rate: number; exponent: number } | null;
};
export type Quote = {
  tokenId: string;
  bids: Level[];
  asks: Level[];
  tickSize: number;
  minOrderSize: number;
  observedAt: string;
  source: 'polymarket';
  hash: string;
};
export type Settlement = {
  resolved: boolean;
  payout: number | null;
  observedAt: string;
  source: string;
};
export const policySchema = z
  .object({
    minPrice: z.number().min(0.5).max(0.999),
    maxPrice: z.number().min(0.5).max(0.999),
    minMinutes: z.number().int().min(1).max(10080),
    maxHours: z.number().min(0.1).max(168),
    minLiquidityUsd: z.number().min(0).max(1e9),
    maxSpread: z.number().min(0.001).max(0.2),
    orderUsd: z.number().min(1).max(100000),
    maxExposureUsd: z.number().min(1).max(1000000),
    maxEventExposureUsd: z.number().min(1).max(100000),
    maxLossUsd: z.number().min(0.1).max(100000),
    minPayoutMarginBps: z.number().min(0).max(5000),
    slippageBps: z.number().int().min(0).max(500),
    takeProfitPrice: z.number().min(0.5).max(1),
    stopLossFraction: z.number().min(0.005).max(0.5),
    quoteMaxAgeSeconds: z.number().int().min(5).max(120),
    scanIntervalSeconds: z.number().int().min(30).max(3600),
    maxCandidatesPerScan: z.number().int().min(1).max(20),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.maxPrice < p.minPrice)
      ctx.addIssue({ code: 'custom', message: '最高入场价不能低于最低入场价' });
    if (p.maxHours * 60 <= p.minMinutes)
      ctx.addIssue({ code: 'custom', message: '到期时间范围无效' });
    if (p.orderUsd > p.maxEventExposureUsd || p.maxEventExposureUsd > p.maxExposureUsd)
      ctx.addIssue({ code: 'custom', message: '单笔、单事件与总敞口上限必须依次递增' });
    if (p.takeProfitPrice <= p.maxPrice)
      ctx.addIssue({ code: 'custom', message: '止盈价必须高于最高入场价' });
  });
export type Policy = z.infer<typeof policySchema>;
export const paperPolicy: Policy = {
  minPrice: 0.9,
  maxPrice: 0.98,
  minMinutes: 10,
  maxHours: 48,
  minLiquidityUsd: 1000,
  maxSpread: 0.025,
  orderUsd: 5,
  maxExposureUsd: 25,
  maxEventExposureUsd: 10,
  maxLossUsd: 5,
  minPayoutMarginBps: 50,
  slippageBps: 30,
  takeProfitPrice: 0.995,
  stopLossFraction: 0.05,
  quoteMaxAgeSeconds: 30,
  scanIntervalSeconds: 90,
  maxCandidatesPerScan: 3,
};
export type Decision = {
  evidence?: string;
  id: string;
  market: Market;
  at: string;
  action: 'buy' | 'hold' | 'reject';
  reason: string;
  agentName: string;
  executionId: string;
  complete: boolean;
  quote: Quote;
  policy: Policy;
  riskReasons: string[];
};
export type OrderStatus =
  | 'prepared'
  | 'submitting'
  | 'open'
  | 'filled'
  | 'partially-filled'
  | 'canceled'
  | 'rejected'
  | 'unconfirmed';
export type Order = {
  id: string;
  mode: Mode;
  market: Market;
  side: Side;
  requestedShares: number;
  limitPrice: number;
  filledShares: number;
  notionalUsd: number;
  feeUsd: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  reason: string;
  decisionId?: string;
  exchangeOrderId?: string;
  integrationCallId?: string;
  executorRef?: string;
  submissionId: string;
  quote: Quote;
  tradeIds: string[];
};
export type Position = {
  id: string;
  market: Market;
  shares: number;
  costUsd: number;
  openedAt: string;
  lastBid: number | null;
  markedAt: string | null;
  realizedPnlUsd: number;
  settled: boolean;
  payout: number | null;
  redemptionId?: string;
  redemptionStatus?: 'pending' | 'unconfirmed' | 'confirmed';
  redemptionCallId?: string;
  redemptionExecutorRef?: string;
};
export type Ledger = {
  walletAddress?: string;
  initialCashUsd: number;
  cashUsd: number;
  orders: Order[];
  positions: Position[];
  realizedPnlUsd: number;
};
export type Event = {
  id: string;
  at: string;
  kind: 'info' | 'decision' | 'order' | 'error' | 'stop';
  text: string;
};
export type Workspace = {
  executorConfigPath?: string;
  wallet?: {
    credentialRef: string;
    signerAddress: string;
    walletAddress: string;
    importedAt: string;
  };
  version: 1;
  mode: Mode;
  signingMethod?: SigningMethod;
  agentBinding: string | null;
  agentName: string;
  connectionRef: string | null;
  policy: Policy;
  running: boolean;
  armedAt: string | null;
  lastScanAt: string | null;
  markets: Market[];
  decisions: Decision[];
  paper: Ledger;
  live: Ledger;
  events: Event[];
  liveLimitsConfirmed: boolean;
  notifyHome: boolean;
};
export const uid = () => crypto.randomUUID();
export const iso = () => new Date().toISOString();
export function emptyLedger(cash = 100): Ledger {
  return { initialCashUsd: cash, cashUsd: cash, orders: [], positions: [], realizedPnlUsd: 0 };
}
export function newWorkspace(): Workspace {
  return {
    version: 1,
    mode: 'paper',
    signingMethod: 'keychain',
    agentBinding: null,
    agentName: '',
    connectionRef: null,
    policy: { ...paperPolicy },
    running: false,
    armedAt: null,
    lastScanAt: null,
    markets: [],
    decisions: [],
    paper: emptyLedger(),
    live: emptyLedger(0),
    events: [],
    liveLimitsConfirmed: false,
    notifyHome: true,
  };
}
export function currentLedger(w: Workspace) {
  return w[w.mode];
}
export function event(w: Workspace, kind: Event['kind'], text: string) {
  w.events.unshift({ id: uid(), at: iso(), kind, text });
  w.events = w.events.slice(0, 500);
}
export function validateWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== 'object') throw new Error('本机账本格式无效，已停止自动交易');
  const w = value as Workspace;
  if (
    w.version !== 1 ||
    !['paper', 'live'].includes(w.mode) ||
    !Array.isArray(w.decisions) ||
    !Array.isArray(w.events)
  )
    throw new Error('本机账本版本无效');
  policySchema.parse(w.policy);
  for (const l of [w.paper, w.live]) {
    if (
      !l ||
      !Number.isFinite(l.cashUsd) ||
      l.cashUsd < 0 ||
      !Number.isFinite(l.initialCashUsd) ||
      !Number.isFinite(l.realizedPnlUsd) ||
      !Array.isArray(l.orders) ||
      !Array.isArray(l.positions)
    )
      throw new Error('资金账本无效，无法继续');
    for (const p of l.positions)
      if (
        !Number.isFinite(p.shares) ||
        p.shares < 0 ||
        !Number.isFinite(p.costUsd) ||
        p.costUsd < 0
      )
        throw new Error('持仓账本无效');
  }
  return w;
}
