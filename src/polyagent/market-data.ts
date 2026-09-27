import {
  createPublicClient,
  type PublicClient,
  type Market as VenueMarket,
} from '@polymarket/client';
import { iso, type Market, type Policy, type Quote, type Settlement } from './model.js';
import { fetchNegRisk } from '@polymarket/client/actions';

export interface MarketData {
  scan(policy: Policy): Promise<Market[]>;
  market(id: string, tokenId: string): Promise<Market>;
  quote(tokenId: string): Promise<Quote>;
  resolution(market: Market): Promise<Settlement>;
}
export function normalizeMarket(m: VenueMarket): Market[] {
  if (
    !m.conditionId ||
    !m.question ||
    !m.state.endDate ||
    !Number.isFinite(Date.parse(m.state.endDate))
  )
    return [];
  const schedule = m.trading.feeSchedule;
  const enabled = m.trading.feesEnabled;
  const rate = Number(schedule?.rate),
    exponent = Number(schedule?.exponent);
  const fee =
    enabled === false
      ? { enabled: false, rate: 0, exponent: 1 }
      : enabled === true &&
          Number.isFinite(rate) &&
          rate >= 0 &&
          Number.isFinite(exponent) &&
          exponent > 0
        ? { enabled: true, rate, exponent }
        : null;
  return ([m.outcomes.yes, m.outcomes.no] as const).flatMap((o, index) => {
    const tokenId = m.version === 'v2' ? o.positionId : o.tokenId;
    const price = o.price === null ? NaN : Number(o.price);
    if (!tokenId || !Number.isFinite(price) || price < 0 || price > 1) return [];
    return [
      {
        venue: m.version === 'v2' ? 'v2' : undefined,
        id: m.id,
        eventId: m.events[0]?.id ?? m.id,
        conditionId: m.conditionId!,
        outcomeIndex: index as 0 | 1,
        slug: m.slug ?? '',
        question: m.question!,
        outcome: o.label,
        tokenId,
        indicativePrice: price,
        endAt: m.state.endDate!,
        description: m.description ?? '',
        resolutionSource: m.resolution.source ?? '',
        active: m.state.active === true,
        closed: m.state.closed === true,
        acceptingOrders: m.state.acceptingOrders === true,
        liquidity: Number(m.metrics.liquidityNum ?? m.metrics.liquidity ?? 0),
        volume: Number(m.metrics.volume24hr ?? 0),
        observedAt: iso(),
        fee,
      },
    ];
  });
}
export class PolymarketData implements MarketData {
  constructor(readonly client: PublicClient = createPublicClient()) {}
  async scan(p: Policy): Promise<Market[]> {
    const markets: Market[] = [];
    let pages = 0;
    const results = this.client.listMarkets({
      closed: false,
      pageSize: 100,
      order: 'endDate',
      ascending: true,
      endDateMin: new Date(Date.now() + p.minMinutes * 60000),
      endDateMax: new Date(Date.now() + p.maxHours * 3600000),
      liquidityNumMin: p.minLiquidityUsd,
    });
    for await (const page of results) {
      for (const m of page.items)
        for (const o of normalizeMarket(m))
          if (
            o.active &&
            o.acceptingOrders &&
            o.indicativePrice >= p.minPrice &&
            o.indicativePrice <= p.maxPrice
          )
            markets.push(o);
      if (++pages >= 4 || markets.length >= 80) break;
    }
    return markets.slice(0, 80).sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  }
  async market(id: string, tokenId: string) {
    const m = normalizeMarket(await this.client.fetchMarket({ id })).find(
      (m) => m.tokenId === tokenId,
    );
    if (!m) throw new Error('该市场或结果已不可用');
    if (!m.venue)
      m.venue = (await fetchNegRisk(this.client, { assetId: tokenId })) ? 'neg-risk' : 'standard';
    return m;
  }
  async quote(tokenId: string): Promise<Quote> {
    const b = await this.client.fetchOrderBook({ tokenId });
    const levels = (rows: typeof b.bids) =>
      rows
        .map((x) => ({ price: Number(x.price), size: Number(x.size) }))
        .filter(
          (x) =>
            Number.isFinite(x.price) &&
            x.price > 0 &&
            x.price < 1 &&
            Number.isFinite(x.size) &&
            x.size > 0,
        );
    const tickSize = Number(b.tickSize),
      minOrderSize = Number(b.minOrderSize);
    if (
      !Number.isFinite(tickSize) ||
      tickSize <= 0 ||
      !Number.isFinite(minOrderSize) ||
      minOrderSize <= 0
    )
      throw new Error('交易所盘口缺少有效步长或最小份额');
    return {
      tokenId,
      bids: levels(b.bids)
        .sort((a, b) => b.price - a.price)
        .slice(0, 80),
      asks: levels(b.asks)
        .sort((a, b) => a.price - b.price)
        .slice(0, 80),
      tickSize,
      minOrderSize,
      observedAt: iso(),
      source: 'polymarket',
      hash: b.hash ?? '',
    };
  }
  async resolution(m: Market): Promise<Settlement> {
    const rows = await this.client.fetchResolutions({ conditionIds: [m.conditionId] });
    const row = rows.find((r) => r.conditionId === m.conditionId);
    const payout =
      row?.status === 'resolved' && row.payouts ? Number(row.payouts[m.outcomeIndex]) : NaN;
    return {
      resolved: Number.isFinite(payout) && [0, 0.5, 1].includes(payout),
      payout: Number.isFinite(payout) ? payout : null,
      observedAt: iso(),
      source: 'Polymarket resolution',
    };
  }
}
