import { AssetType } from '@polymarket/bindings/clob';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { OrderSide, OrderType, type SecureClient } from '@polymarket/client';
import { fetchBalanceAllowance } from '@polymarket/client/actions';
import { fetchTransaction } from '@polymarket/client/actions';
import {
  EXECUTOR_VERSION,
  walletAddressSchema,
  type Receipt,
  type TradingAccount,
} from '../src/polyagent/integration.js';
import { PolymarketData } from '../src/polyagent/market-data.js';
import { bestBid, bestAsk, money, tradingFee } from '../src/polyagent/strategy.js';
import type { Journal, JournalOrder, JournalRedemption } from './journal.js';
import { approvedPredictionVenues } from './approvals.js';
import { RedemptionTracker } from './redemption.js';

export const submitSchema = z
  .object({
    signingMethod: z.enum(['keychain', 'wallet']),
    walletAddress: walletAddressSchema,
    submissionId: z.string().uuid(),
    marketId: z.string().min(1).max(128),
    assetId: z.string().regex(/^\d+$/).max(128),
    side: z.enum(['buy', 'sell']),
    shares: z.number().positive().max(1e8),
    limitPrice: z.number().positive().lt(1),
    maxSpendUsd: z.number().positive().max(1e6),
  })
  .strict();
export type Submit = z.infer<typeof submitSchema>;
export type ExecutorLimits = {
  signingMethod: 'keychain' | 'wallet';
  mode: 'disabled' | 'observe' | 'live';
  wallet: string;
  maxOrderUsd: number;
  maxExposureUsd: number;
  maxBuyOrders: number;
  maxBuyBudgetUsd: number;
};
const final = (r: Receipt) =>
  ['filled', 'partially-filled', 'canceled', 'rejected'].includes(r.status);
export class TradingExecutor {
  private queue = Promise.resolve();
  constructor(
    readonly journal: Journal,
    readonly limits: ExecutorLimits,
    readonly client: () => Promise<SecureClient>,
    readonly data = new PolymarketData(),
    readonly geoblock: () => Promise<boolean> = checkGeoblock,
    readonly walletConnected: () => boolean = () => true,
    readonly redemptions = new RedemptionTracker(journal),
  ) {}
  assertWallet(address: string) {
    if (
      !walletAddressSchema.safeParse(address).success ||
      address.toLowerCase() !== this.limits.wallet.toLowerCase() ||
      address.toLowerCase() !== this.journal.data.wallet.toLowerCase()
    )
      throw new Error('WALLET_MISMATCH');
  }
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async account(ignoreSubmissionId?: string): Promise<TradingAccount> {
    const budget = this.buyBudget(ignoreSubmissionId);
    const base = {
      protocol: EXECUTOR_VERSION,
      access: this.limits.mode,
      approvedVenues: [],
      buyOrdersRemaining: budget.orders,
      remainingBuyBudgetUsd: budget.cash,
      signingMethod: this.limits.signingMethod,
      wallet: this.limits.wallet,
      ready: false,
      cashUsd: null,
      exposureUsd: null,
      approvalsReady: false,
      geoblocked: false,
      maxOrderUsd: this.limits.maxOrderUsd,
      maxExposureUsd: this.limits.maxExposureUsd,
      message: '执行器未启用实盘，尚未读取真实余额',
    } as TradingAccount;
    if (this.limits.mode === 'disabled' || !this.limits.wallet) return base;
    if (this.limits.signingMethod === 'wallet' && !this.walletConnected())
      return { ...base, message: '请连接浏览器钱包，并保持签名窗口打开' };
    const blocked = await this.geoblock();
    if (blocked) return { ...base, geoblocked: true, message: '该执行位置不允许交易' };
    const c = await this.client();
    const [balance, approval] = await Promise.all([
      fetchBalanceAllowance(c, { assetType: AssetType.COLLATERAL }),
      c.fetchTradingApprovalsState(),
    ]);
    const approvedVenues = approvedPredictionVenues(
      approval,
      balance.allowances,
      this.limits.maxOrderUsd,
    );
    let exposure = new Decimal(0),
      reserved = new Decimal(0);
    let pages = 0;
    for await (const page of c.listPositions()) {
      for (const p of page.items)
        if (new Decimal(p.currentSize).gt(0))
          exposure = exposure.plus(Decimal.max(p.totalCostUsdc, p.currentValue));
      if (++pages > 30) throw new Error('ACCOUNT_POSITION_SCAN_INCOMPLETE');
    }
    for await (const page of c.listOpenOrders()) {
      for (const o of page.items)
        if (o.side.toLowerCase() === 'buy')
          reserved = reserved.plus(
            Decimal.max(0, new Decimal(o.originalSize).minus(o.sizeMatched)).mul(o.price),
          );
      if (++pages > 60) throw new Error('ACCOUNT_ORDER_SCAN_INCOMPLETE');
    }
    exposure = Decimal.max(exposure, knownExecutorExposure(this.journal.data)).plus(reserved);
    const uncertain = Object.values(this.journal.data.orders).some(
      (o) => o.request.submissionId !== ignoreSubmissionId && !final(o.receipt),
    );
    const cash = Decimal.max(
      0,
      new Decimal(balance.balance.toString()).div(1e6).minus(reserved),
    ).toNumber();
    if (!Number.isFinite(cash) || !exposure.isFinite() || cash < 0)
      throw new Error('ACCOUNT_VALUE_INVALID');
    return {
      ...base,
      cashUsd: cash,
      exposureUsd: exposure.toDecimalPlaces(6, Decimal.ROUND_UP).toNumber(),
      approvedVenues,
      approvalsReady: approvedVenues.length > 0,
      ready:
        this.limits.mode === 'live' &&
        this.limits.maxOrderUsd > 0 &&
        approvedVenues.length > 0 &&
        !uncertain &&
        cash > 0 &&
        budget.orders > 0 &&
        budget.cash >= this.limits.maxOrderUsd,
      message:
        this.limits.mode === 'observe'
          ? '真实账户已核对；观察模式禁止买卖、撤单和链上交易'
          : uncertain
            ? '有未核对订单，已禁止新买入'
            : !approvedVenues.length
              ? '请先在钱包完成交易授权'
              : cash <= 0
                ? '钱包尚未入金'
                : budget.orders <= 0 || budget.cash < this.limits.maxOrderUsd
                  ? '本轮买入额度已用完，仅可处理已有持仓'
                  : '账户已就绪',
    };
  }
  private buyBudget(ignoreSubmissionId?: string) {
    const buys = Object.values(this.journal.data.orders).filter(
      (o) =>
        o.request.side === 'buy' &&
        o.request.submissionId !== ignoreSubmissionId &&
        (o.dispatchedAt || o.receipt.filledShares > 0 || o.receipt.status === 'unconfirmed'),
    );
    const used = buys.reduce(
      (sum, o) =>
        sum.plus(
          final(o.receipt)
            ? new Decimal(o.receipt.notionalUsd).plus(o.receipt.feeUsd)
            : o.request.maxSpendUsd,
        ),
      new Decimal(0),
    );
    return {
      orders: Math.max(0, this.limits.maxBuyOrders - buys.length),
      cash: Decimal.max(0, new Decimal(this.limits.maxBuyBudgetUsd).minus(used)).toNumber(),
    };
  }
  submit(input: unknown, signal?: AbortSignal) {
    return this.serial(() => this.submitOnce(submitSchema.parse(input), signal));
  }
  private async submitOnce(input: Submit, signal?: AbortSignal): Promise<Receipt> {
    this.assertWallet(input.walletAddress);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.journal.data.orders[input.submissionId];
    if (existing) {
      if (existing.requestHash !== hash) throw new Error('SUBMISSION_ID_CONFLICT');
      return this.getUnlocked(input.submissionId);
    }
    const receipt: Receipt = {
      protocol: EXECUTOR_VERSION,
      walletAddress: this.limits.wallet,
      submissionId: input.submissionId,
      status: 'prepared',
      filledShares: 0,
      notionalUsd: 0,
      feeUsd: 0,
      tradeIds: [],
      message: '尚未提交',
    };
    const row: JournalOrder = {
      requestHash: hash,
      request: input,
      receipt,
      createdAt: new Date().toISOString(),
    };
    this.journal.data.orders[input.submissionId] = row;
    const checkDispatch = () => {
      signal?.throwIfAborted();
      if (this.limits.mode !== 'live') throw new Error('LIVE_NOT_ENABLED');
    };
    let c: SecureClient;
    // Every valid, wallet-bound submission gets a durable receipt, including
    // checks that reject it before any signature or exchange dispatch.
    try {
      await this.journal.save();
      checkDispatch();
      if (input.signingMethod !== this.limits.signingMethod)
        throw new Error('SIGNING_METHOD_MISMATCH');
      const budget = this.buyBudget(input.submissionId);
      if (input.side === 'buy' && (budget.orders <= 0 || input.maxSpendUsd > budget.cash))
        throw new Error('EXECUTOR_TEST_BUDGET_EXHAUSTED');
      const account = await this.account(input.submissionId);
      if (!account.approvalsReady || account.geoblocked || account.cashUsd === null)
        throw new Error('ACCOUNT_NOT_READY');
      if (
        input.side === 'buy' &&
        (!account.ready ||
          input.maxSpendUsd > this.limits.maxOrderUsd ||
          account.cashUsd < input.maxSpendUsd ||
          account.exposureUsd === null ||
          account.exposureUsd + input.maxSpendUsd > this.limits.maxExposureUsd)
      )
        throw new Error('EXECUTOR_CAPITAL_LIMIT');
      const m = await this.data.market(input.marketId, input.assetId);
      if (!m.venue || !account.approvedVenues.includes(m.venue))
        throw new Error('MARKET_APPROVALS_MISSING');
      if (!m.fee) throw new Error('MARKET_FEE_UNAVAILABLE');
      if (!m.active || m.closed || !m.acceptingOrders) throw new Error('MARKET_NOT_TRADING');
      const q = await this.data.quote(input.assetId);
      if (
        !new Decimal(input.limitPrice).div(q.tickSize).isInteger() ||
        input.shares < q.minOrderSize
      )
        throw new Error('ORDER_TICK_OR_SIZE_INVALID');
      if (input.side === 'buy' && (bestAsk(q) === null || bestAsk(q)! > input.limitPrice))
        throw new Error('BUY_PRICE_LIMIT');
      if (input.side === 'sell' && (bestBid(q) === null || bestBid(q)! < input.limitPrice))
        throw new Error('SELL_PRICE_LIMIT');
      c = await this.client();
      if (input.side === 'sell') {
        let held = 0;
        for await (const page of c.listPositions())
          for (const p of page.items)
            if (p.assetId === input.assetId) held += Number(p.currentSize);
        if (input.shares > held + 0.000001) throw new Error('INSUFFICIENT_POSITION');
      }
      row.marketFee = m.fee;
      checkDispatch();
      row.signedOrder = await c.createMarketOrder(
        input.side === 'buy'
          ? {
              assetId: input.assetId,
              side: OrderSide.BUY,
              amount: money(new Decimal(input.shares).mul(input.limitPrice)),
              maxSpend: input.maxSpendUsd,
              maxPrice: input.limitPrice,
              orderType: OrderType.FAK,
            }
          : {
              assetId: input.assetId,
              side: OrderSide.SELL,
              shares: input.shares,
              minPrice: input.limitPrice,
              orderType: OrderType.FAK,
            },
      );
      await this.journal.save();
    } catch (e) {
      row.receipt.status = signal?.aborted ? 'canceled' : 'rejected';
      row.receipt.message = signal?.aborted ? '提交前已取消，未向交易所派发' : rejectionMessage(e);
      await this.journal.save();
      return row.receipt;
    }
    if (signal?.aborted) {
      row.receipt.status = 'canceled';
      row.receipt.message = '提交前已取消';
      await this.journal.save();
      return row.receipt;
    }
    // Human wallet approval may take time. A signature never freezes market state.
    if (this.limits.signingMethod === 'wallet') {
      try {
        const fresh = await this.data.market(input.marketId, input.assetId);
        const book = await this.data.quote(input.assetId);
        const account = await this.account(input.submissionId);
        if (
          !account.approvalsReady ||
          account.geoblocked ||
          (input.side === 'buy' &&
            (!account.ready ||
              account.cashUsd === null ||
              account.cashUsd < input.maxSpendUsd ||
              account.exposureUsd === null ||
              account.exposureUsd + input.maxSpendUsd > this.limits.maxExposureUsd))
        )
          throw new Error('WALLET_APPROVAL_ACCOUNT_CHANGED');
        if (
          !this.walletConnected() ||
          !fresh.active ||
          fresh.closed ||
          !fresh.acceptingOrders ||
          (input.side === 'buy' && Date.parse(fresh.endAt) <= Date.now()) ||
          (input.side === 'buy'
            ? bestAsk(book) === null || bestAsk(book)! > input.limitPrice
            : bestBid(book) === null || bestBid(book)! < input.limitPrice)
        )
          throw new Error('WALLET_APPROVAL_MARKET_CHANGED');
      } catch {
        row.receipt.status = 'canceled';
        row.receipt.message = '钱包确认后检查未通过，签名订单未提交';
        await this.journal.save();
        return row.receipt;
      }
    }
    try {
      checkDispatch();
      row.receipt.status = 'submitting';
      row.receipt.message = '已开始提交，等待交易所结果';
      row.dispatchedAt = new Date().toISOString();
      await this.journal.save();
      checkDispatch();
    } catch (e) {
      delete row.dispatchedAt;
      row.receipt.status = signal?.aborted ? 'canceled' : 'rejected';
      row.receipt.message = signal?.aborted ? '提交前已取消，未向交易所派发' : rejectionMessage(e);
      await this.journal.save();
      return row.receipt;
    }
    // After this boundary an error cannot prove that no exchange effect occurred.
    try {
      const response = await c.postOrder(
        row.signedOrder as Awaited<ReturnType<SecureClient['createMarketOrder']>>,
      );
      row.response = response;
      if (!response.ok) {
        row.receipt.status = 'rejected';
        row.receipt.message = `交易所拒绝：${response.code}`;
        await this.journal.save();
        return row.receipt;
      }
      row.receipt.exchangeOrderId = response.orderId;
      if (String(response.status).toLowerCase() === 'unmatched' && response.tradeIds.length === 0) {
        row.receipt.status = 'canceled';
        row.receipt.message = 'FAK 未成交，余量已取消';
        await this.journal.save();
        return row.receipt;
      }
      row.receipt.status = 'open';
      row.receipt.tradeIds = response.tradeIds;
      row.receipt.message = '交易所已接受，正在核对链上成交';
      await this.journal.save();
      return this.getUnlocked(input.submissionId);
    } catch {
      row.receipt.status = 'unconfirmed';
      row.receipt.message = '交易所结果未确认。保留原签名订单，不自动重发。';
      await this.journal.save();
      return row.receipt;
    }
  }
  get(id: string, walletAddress: string) {
    this.assertWallet(walletAddress);
    return this.serial(() => this.getUnlocked(id));
  }
  private async getUnlocked(id: string): Promise<Receipt> {
    const row = this.journal.data.orders[id];
    if (!row) throw new Error('SUBMISSION_NOT_FOUND');
    if (final(row.receipt)) return row.receipt;
    if (!row.receipt.exchangeOrderId)
      return {
        ...row.receipt,
        status: 'unconfirmed',
        message: '未获得可核对的交易所订单号，请人工检查交易所账户；禁止重新提交',
      };
    const c = await this.client();
    const order = await c.fetchOrder({ orderId: row.receipt.exchangeOrderId });
    if (order.assetId !== row.request.assetId || order.side.toLowerCase() !== row.request.side)
      throw new Error('ORDER_CORRELATION_FAILED');
    const trades = [];
    let pages = 0;
    for await (const page of c.listAccountTrades({ market: order.conditionId })) {
      for (const t of page.items) if (t.takerOrderId === order.id) trades.push(t);
      if (++pages >= 40) {
        if (page.nextCursor) throw new Error('TRADE_SCAN_INCOMPLETE');
        break;
      }
    }
    const settled = trades.filter((t) => t.status.toLowerCase() === 'confirmed');
    const shares = settled.reduce((s, t) => s.plus(t.size), new Decimal(0)).toNumber();
    const notional = settled
      .reduce((s, t) => s.plus(new Decimal(t.size).mul(t.price)), new Decimal(0))
      .toNumber();
    const fee = settled
      .reduce(
        (s, t) => s.plus(tradingFee(Number(t.size), Number(t.price), row.marketFee ?? null)),
        new Decimal(0),
      )
      .toNumber();
    if (shares + 0.000001 < row.receipt.filledShares) throw new Error('TRADE_HISTORY_REGRESSION');
    const pending =
      trades.some((t) => !['confirmed', 'failed'].includes(t.status.toLowerCase())) ||
      shares + 0.000001 < Number(order.sizeMatched);
    let status: Receipt['status'] = 'open';
    if (!pending && !['live', 'open', 'delayed'].includes(order.status.toLowerCase())) {
      if (shares > 0)
        status = shares + 0.000001 < Number(order.originalSize) ? 'partially-filled' : 'filled';
      else if (
        ['canceled', 'cancelled', 'unmatched', 'expired'].includes(order.status.toLowerCase())
      )
        status = 'canceled';
    }
    Object.assign(row.receipt, {
      filledShares: money(shares),
      notionalUsd: money(notional),
      feeUsd: money(fee),
      tradeIds: settled.map((t) => t.id),
      status,
      message: pending
        ? '成交仍在结算中；未将未确认成交计入持仓'
        : '已核对确认成交；费用按当前市场费率估算，账户余额为最终依据',
    });
    await this.journal.save();
    return row.receipt;
  }
  cancel(id: string, walletAddress: string) {
    return this.serial(async () => {
      if (this.limits.mode !== 'live') throw new Error('LIVE_NOT_ENABLED');
      this.assertWallet(walletAddress);
      const row = this.journal.data.orders[id];
      if (!row?.receipt.exchangeOrderId) throw new Error('ORDER_ID_UNCONFIRMED');
      const c = await this.client();
      await c.cancelOrder({ orderId: row.receipt.exchangeOrderId });
      return this.getUnlocked(id);
    });
  }
  redeem(marketId: string, assetId: string, walletAddress: string, signal?: AbortSignal) {
    return this.serial(async () => {
      signal?.throwIfAborted();
      this.assertWallet(walletAddress);
      if (this.limits.mode !== 'live') throw new Error('LIVE_NOT_ENABLED');
      const key = marketId;
      const prior = this.journal.data.redemptions[key];
      if (prior) {
        if (prior.status === 'confirmed')
          return {
            walletAddress: this.limits.wallet,
            settled: true,
            transactionHash: prior.transactionHash,
          };
        return {
          walletAddress: this.limits.wallet,
          settled: false,
          message: '先前赎回结果未确认，不自动重复提交',
          transactionHash: prior.transactionHash,
        };
      }
      const m = await this.data.market(marketId, assetId);
      const resolution = await this.data.resolution(m);
      if (!resolution.resolved) throw new Error('MARKET_NOT_RESOLVED');
      const row: JournalRedemption = {
        status: 'submitting',
        directTransactions: [],
        submissionComplete: false,
      };
      this.journal.data.redemptions[key] = row;
      await this.journal.save();
      try {
        const c = await this.client();
        signal?.throwIfAborted();
        if (this.limits.mode !== 'live') throw new Error('LIVE_NOT_ENABLED');
        const tx = await this.redemptions.run(row, () => c.redeemPositions({ marketId }));
        const result = await tx.wait();
        row.transactionHash = result.transactionHash;
        if (
          row.directTransactions.length
            ? !(await this.redemptions.confirmed(row))
            : !row.transactionId || result.transactionId !== row.transactionId
        )
          throw new Error('REDEMPTION_CORRELATION_UNCONFIRMED');
        row.status = 'confirmed';
        await this.journal.save();
        return {
          walletAddress: this.limits.wallet,
          settled: true,
          transactionHash: result.transactionHash,
        };
      } catch {
        row.status = 'unconfirmed';
        await this.journal.save();
        return {
          walletAddress: this.limits.wallet,
          settled: false,
          message: '赎回结果未确认，不自动重发',
          transactionHash: row.transactionHash,
        };
      }
    });
  }
  redemption(marketId: string, walletAddress: string) {
    return this.serial(async () => {
      this.assertWallet(walletAddress);
      const row = this.journal.data.redemptions[marketId];
      if (!row)
        return {
          walletAddress: this.limits.wallet,
          settled: false,
          status: 'unknown',
          message: '没有可核对的本机赎回记录',
        };
      if (row.status === 'confirmed')
        return {
          walletAddress: this.limits.wallet,
          settled: true,
          status: 'confirmed',
          transactionHash: row.transactionHash,
        };
      if (row.submissionComplete && row.transactionId && !row.directTransactions?.length) {
        const tx = await fetchTransaction(await this.client(), {
          transactionId: row.transactionId,
        });
        row.transactionHash = tx.transactionHash ?? row.transactionHash;
        if (String(tx.state) === 'STATE_CONFIRMED') row.status = 'confirmed';
      } else {
        try {
          if (await this.redemptions.confirmed(row)) {
            row.status = 'confirmed';
            row.transactionHash = row.directTransactions.at(-1)!.transactionHash;
          }
        } catch {
          /* Still unconfirmed; never infer absence of an effect. */
        }
      }
      await this.journal.save();
      return {
        walletAddress: this.limits.wallet,
        settled: row.status === 'confirmed',
        status: row.status,
        transactionHash: row.transactionHash,
        message: row.status === 'confirmed' ? '链上赎回已确认' : '赎回尚未确认，不要重新提交',
      };
    });
  }
}
function rejectionMessage(error: unknown): string {
  const reasons: Record<string, string> = {
    LIVE_NOT_ENABLED: '执行器未启用实盘',
    SIGNING_METHOD_MISMATCH: '签名方式与执行器不一致',
    EXECUTOR_TEST_BUDGET_EXHAUSTED: '本轮买入额度已用完',
    ACCOUNT_NOT_READY: '交易账户尚未就绪',
    EXECUTOR_CAPITAL_LIMIT: '超过执行器资金上限或可用余额',
    MARKET_APPROVALS_MISSING: '当前市场缺少交易授权',
    MARKET_FEE_UNAVAILABLE: '市场费用规则暂不可用',
    MARKET_NOT_TRADING: '市场已停止交易',
    ORDER_TICK_OR_SIZE_INVALID: '订单价格步长或份额不符合交易所要求',
    BUY_PRICE_LIMIT: '当前卖价超过买入限价',
    SELL_PRICE_LIMIT: '当前买价低于卖出限价',
    INSUFFICIENT_POSITION: '实际持仓不足',
  };
  const reason = error instanceof Error ? reasons[error.message] : undefined;
  return `${reason ?? '提交前检查或签名准备失败'}；未向交易所派发`;
}
export async function checkGeoblock() {
  const response = await fetch('https://polymarket.com/api/geoblock', {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('ELIGIBILITY_CHECK_UNAVAILABLE');
  const body = (await response.json()) as { blocked?: unknown };
  if (typeof body.blocked !== 'boolean') throw new Error('ELIGIBILITY_RESPONSE_INVALID');
  return body.blocked;
}

/** Retain known fills as an exposure floor while the venue position index catches up. */
export function knownExecutorExposure(journal: Journal['data']): Decimal {
  const assets = new Map<string, { shares: Decimal; cost: Decimal; marketId: string }>();
  for (const order of Object.values(journal.orders).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    const r = order.receipt;
    if (r.filledShares <= 0) continue;
    const key = order.request.assetId;
    const p = assets.get(key) ?? {
      shares: new Decimal(0),
      cost: new Decimal(0),
      marketId: order.request.marketId,
    };
    if (order.request.side === 'buy') {
      p.shares = p.shares.plus(r.filledShares);
      p.cost = p.cost.plus(r.notionalUsd).plus(r.feeUsd);
    } else if (p.shares.gt(0)) {
      const sold = Decimal.min(p.shares, r.filledShares);
      p.cost = p.cost.mul(p.shares.minus(sold)).div(p.shares);
      p.shares = p.shares.minus(sold);
    }
    assets.set(key, p);
  }
  return [...assets.values()].reduce(
    (s, p) => (journal.redemptions[p.marketId]?.status === 'confirmed' ? s : s.plus(p.cost)),
    new Decimal(0),
  );
}
