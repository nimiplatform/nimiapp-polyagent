import { Decimal } from 'decimal.js';
import type { Ledger, Market, Policy, Quote } from './model.js';
export const money = (v: number | Decimal) =>
  new Decimal(v).toDecimalPlaces(6, Decimal.ROUND_DOWN).toNumber();
export const bestBid = (q: Quote) =>
  q.bids.length ? Math.max(...q.bids.map((l) => l.price)) : null;
export const bestAsk = (q: Quote) =>
  q.asks.length ? Math.min(...q.asks.map((l) => l.price)) : null;
export function tradingFee(shares: number, price: number, fee: Market['fee']): number {
  if (!fee) throw new Error('费用数据缺失');
  if (!fee.enabled) return 0;
  return new Decimal(shares)
    .mul(fee.rate)
    .mul(new Decimal(price).mul(new Decimal(1).minus(price)).pow(fee.exponent))
    .toDecimalPlaces(5, Decimal.ROUND_HALF_UP)
    .toNumber();
}
export function entryAssessment(m: Market, q: Quote, p: Policy, l: Ledger, now = Date.now()) {
  const reasons: string[] = [];
  const ask = bestAsk(q),
    bid = bestBid(q);
  const until = Date.parse(m.endAt) - now;
  if (!m.active || m.closed || !m.acceptingOrders) reasons.push('市场未开放交易');
  if (!Number.isFinite(until) || until < p.minMinutes * 60000 || until > p.maxHours * 3600000)
    reasons.push('不在策略的到期时间窗口');
  if (q.tokenId !== m.tokenId) reasons.push('盘口与结果标识不匹配');
  const age = now - Date.parse(q.observedAt);
  if (!Number.isFinite(age) || age < -5000 || age > p.quoteMaxAgeSeconds * 1000)
    reasons.push('盘口已过期');
  if (m.liquidity < p.minLiquidityUsd) reasons.push('市场流动性不足');
  if (ask === null || bid === null) reasons.push('买卖盘口不完整');
  if (ask !== null && (ask < p.minPrice || ask > p.maxPrice)) reasons.push('价格不在入场区间');
  if (ask !== null && bid !== null && (ask - bid > p.maxSpread || ask < bid))
    reasons.push('买卖价差异常或过大');
  if (!m.fee) reasons.push('尚未取得费用规则');
  const exposure = l.positions.filter((x) => !x.settled).reduce((s, x) => s + x.costUsd, 0);
  const reserved = l.orders
    .filter(
      (o) =>
        o.side === 'buy' && ['prepared', 'submitting', 'open', 'unconfirmed'].includes(o.status),
    )
    .reduce((s, o) => s + Math.max(0, o.requestedShares - o.filledShares) * o.limitPrice, 0);
  const eventExposure = l.positions
    .filter((x) => !x.settled && x.market.eventId === m.eventId)
    .reduce((s, x) => s + x.costUsd, 0);
  if (l.orders.some((o) => ['prepared', 'submitting', 'open', 'unconfirmed'].includes(o.status)))
    reasons.push('有待核对订单，暂不增加敞口');
  if (l.positions.some((x) => x.market.tokenId === m.tokenId && x.shares > 0 && !x.settled))
    reasons.push('已有该结果持仓');
  if (exposure + reserved + p.orderUsd > p.maxExposureUsd + 0.000001)
    reasons.push('达到总资金敞口上限');
  if (eventExposure + p.orderUsd > p.maxEventExposureUsd + 0.000001)
    reasons.push('达到单事件敞口上限');
  if (l.cashUsd < p.orderUsd) reasons.push('可用资金不足');
  const pnl =
    l.realizedPnlUsd +
    l.positions
      .filter((x) => !x.settled)
      .reduce((s, x) => s + (x.lastBid === null ? 0 : x.shares * x.lastBid - x.costUsd), 0);
  if (pnl <= -p.maxLossUsd) reasons.push('达到亏损停止线');
  if (
    l.positions.some(
      (x) =>
        !x.settled &&
        x.shares > 0 &&
        (x.lastBid === null ||
          !x.markedAt ||
          now - Date.parse(x.markedAt) > p.quoteMaxAgeSeconds * 1000),
    )
  )
    reasons.push('现有持仓估值需刷新');
  if (ask !== null && m.fee) {
    const fee = tradingFee(1, ask, m.fee);
    if ((1 - ask - fee) * 10000 < p.minPayoutMarginBps) reasons.push('扣费后的满额兑付价差不足');
    const depth = q.asks
      .filter((x) => x.price <= p.maxPrice)
      .reduce((s, x) => s + x.price * x.size, 0);
    if (depth < p.orderUsd) reasons.push('限价内可成交深度不足');
    if (p.orderUsd / ask < q.minOrderSize) reasons.push('单笔金额不足交易所最小份额');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    ask,
    bid,
    exposureUsd: money(exposure + reserved),
  };
}
export function buyLimit(q: Quote, p: Policy): number {
  const ask = bestAsk(q);
  if (ask === null) throw new Error('卖盘为空');
  return new Decimal(Math.min(p.maxPrice, ask * (1 + p.slippageBps / 10000)))
    .div(q.tickSize)
    .floor()
    .mul(q.tickSize)
    .toNumber();
}
export function exitReason(position: { shares: number; costUsd: number }, q: Quote, p: Policy) {
  const bid = bestBid(q);
  if (bid === null) return null;
  if (bid >= p.takeProfitPrice) return '达到止盈价';
  if (position.shares > 0 && bid <= (position.costUsd / position.shares) * (1 - p.stopLossFraction))
    return '触及止损价';
  return null;
}
