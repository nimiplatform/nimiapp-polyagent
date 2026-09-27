import { Decimal } from 'decimal.js';
import { iso, uid, type Ledger, type Market, type Order, type Quote, type Side } from './model.js';
import { money, tradingFee } from './strategy.js';

/** FAK simulation against the observed book, with no synthetic resting fills. */
export function simulateFill(input: {
  market: Market;
  quote: Quote;
  side: Side;
  shares: number;
  limitPrice: number;
  cashUsd: number;
  heldShares: number;
}) {
  const { market: m, quote: q, side, limitPrice } = input;
  if (q.tokenId !== m.tokenId || !m.fee) throw new Error('盘口或费用规则不匹配');
  if (!Number.isFinite(input.shares) || input.shares <= 0 || limitPrice <= 0 || limitPrice >= 1)
    throw new Error('订单参数无效');
  if (input.shares + 1e-9 < q.minOrderSize) throw new Error('订单份额低于交易所最小值');
  if (!new Decimal(limitPrice).div(q.tickSize).isInteger())
    throw new Error('限价不符合交易所价格步长');
  if (side === 'sell' && input.shares > input.heldShares + 0.000001)
    throw new Error('卖出份额超过已持有份额');
  let remaining = new Decimal(input.shares),
    shares = new Decimal(0),
    notional = new Decimal(0),
    fee = new Decimal(0);
  const levels =
    side === 'buy'
      ? [...q.asks].sort((a, b) => a.price - b.price)
      : [...q.bids].sort((a, b) => b.price - a.price);
  for (const level of levels) {
    if (
      (side === 'buy' && level.price > limitPrice) ||
      (side === 'sell' && level.price < limitPrice)
    )
      continue;
    let fill = Decimal.min(remaining, level.size);
    if (side === 'buy') {
      const unit = new Decimal(level.price).plus(tradingFee(1, level.price, m.fee));
      fill = Decimal.min(fill, new Decimal(input.cashUsd).minus(notional).minus(fee).div(unit));
    }
    fill = fill.toDecimalPlaces(6, Decimal.ROUND_DOWN);
    if (fill.lte(0)) break;
    shares = shares.plus(fill);
    notional = notional.plus(fill.mul(level.price));
    fee = fee.plus(tradingFee(fill.toNumber(), level.price, m.fee));
    remaining = remaining.minus(fill);
    if (remaining.lte(0.000001)) break;
  }
  return { filledShares: money(shares), notionalUsd: money(notional), feeUsd: money(fee) };
}
export function prepareOrder(
  m: Market,
  q: Quote,
  side: Side,
  shares: number,
  limitPrice: number,
  reason: string,
  mode: 'paper' | 'live',
  decisionId?: string,
): Order {
  const at = iso(),
    id = uid();
  return {
    id,
    submissionId: id,
    mode,
    market: structuredClone(m),
    quote: structuredClone(q),
    side,
    requestedShares: shares,
    limitPrice,
    filledShares: 0,
    notionalUsd: 0,
    feeUsd: 0,
    status: 'prepared',
    createdAt: at,
    updatedAt: at,
    reason,
    decisionId,
    tradeIds: [],
  };
}
/** Apply cumulative confirmed fills once. Open/accepted orders alone change no cash. */
export function applyCumulativeFill(
  l: Ledger,
  order: Order,
  fill: { filledShares: number; notionalUsd: number; feeUsd: number },
) {
  if (
    fill.filledShares < order.filledShares ||
    fill.notionalUsd < order.notionalUsd ||
    fill.feeUsd < order.feeUsd ||
    (order.side === 'sell' && fill.filledShares > order.requestedShares + 0.000001)
  )
    throw new Error('成交记录倒退或超过委托，需人工核对');
  const shares = money(fill.filledShares - order.filledShares),
    notional = money(fill.notionalUsd - order.notionalUsd),
    fee = money(fill.feeUsd - order.feeUsd);
  if (shares === 0 && notional === 0 && fee === 0) return;
  let p = l.positions.find((p) => p.market.tokenId === order.market.tokenId && !p.settled);
  if (order.side === 'buy') {
    if (l.cashUsd + 0.000001 < notional + fee) throw new Error('成交超过可用资金，需核对账本');
    l.cashUsd = money(new Decimal(l.cashUsd).minus(notional).minus(fee));
    if (!p) {
      p = {
        id: uid(),
        market: order.market,
        shares: 0,
        costUsd: 0,
        openedAt: order.createdAt,
        lastBid: null,
        markedAt: null,
        realizedPnlUsd: 0,
        settled: false,
        payout: null,
      };
      l.positions.push(p);
    }
    p.shares = money(new Decimal(p.shares).plus(shares));
    p.costUsd = money(new Decimal(p.costUsd).plus(notional).plus(fee));
  } else {
    if (!p || p.shares + 0.000001 < shares) throw new Error('成交超过持仓，需核对账本');
    const cost = money(new Decimal(p.costUsd).mul(shares).div(p.shares));
    const pnl = money(new Decimal(notional).minus(fee).minus(cost));
    p.shares = money(new Decimal(p.shares).minus(shares));
    p.costUsd = money(new Decimal(p.costUsd).minus(cost));
    p.realizedPnlUsd = money(new Decimal(p.realizedPnlUsd).plus(pnl));
    l.realizedPnlUsd = money(new Decimal(l.realizedPnlUsd).plus(pnl));
    l.cashUsd = money(new Decimal(l.cashUsd).plus(notional).minus(fee));
  }
  Object.assign(order, fill, { updatedAt: iso() });
}
export function executePaper(l: Ledger, o: Order) {
  if (o.mode !== 'paper' || o.status !== 'prepared') throw new Error('模拟订单状态无效');
  const held =
    l.positions.find((p) => p.market.tokenId === o.market.tokenId && !p.settled)?.shares ?? 0;
  const fill = simulateFill({
    market: o.market,
    quote: o.quote,
    side: o.side,
    shares: o.requestedShares,
    limitPrice: o.limitPrice,
    cashUsd: l.cashUsd,
    heldShares: held,
  });
  applyCumulativeFill(l, o, fill);
  o.status =
    fill.filledShares <= 0
      ? 'canceled'
      : fill.filledShares + 0.000001 < o.requestedShares
        ? 'partially-filled'
        : 'filled';
  o.updatedAt = iso();
}
export function settlePosition(l: Ledger, tokenId: string, payout: number) {
  if (![0, 0.5, 1].includes(payout)) throw new Error('结算结果无效');
  const p = l.positions.find((p) => p.market.tokenId === tokenId && !p.settled);
  if (!p) return;
  const proceeds = money(new Decimal(p.shares).mul(payout)),
    pnl = money(new Decimal(proceeds).minus(p.costUsd));
  l.cashUsd = money(new Decimal(l.cashUsd).plus(proceeds));
  l.realizedPnlUsd = money(new Decimal(l.realizedPnlUsd).plus(pnl));
  p.realizedPnlUsd = money(new Decimal(p.realizedPnlUsd).plus(pnl));
  p.shares = 0;
  p.costUsd = 0;
  p.settled = true;
  p.payout = payout;
}
