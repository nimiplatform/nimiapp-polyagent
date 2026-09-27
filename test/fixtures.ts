import type { Market, Quote } from '../src/polyagent/model.js';
export function fixture() {
  const now = new Date().toISOString();
  const market: Market = {
    id: 'm1',
    venue: 'standard',
    eventId: 'e1',
    conditionId: '0x' + '1'.repeat(64),
    outcomeIndex: 0,
    slug: 'test',
    question: 'Explicit test event',
    outcome: 'Yes',
    tokenId: '123',
    indicativePrice: 0.95,
    endAt: new Date(Date.now() + 3600000).toISOString(),
    description: 'Unit-test rules only',
    resolutionSource: 'unit-test',
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 5000,
    volume: 10000,
    observedAt: now,
    fee: { enabled: true, rate: 0.04, exponent: 1 },
  };
  const quote: Quote = {
    tokenId: '123',
    bids: [{ price: 0.94, size: 100 }],
    asks: [{ price: 0.95, size: 100 }],
    tickSize: 0.001,
    minOrderSize: 5,
    observedAt: now,
    source: 'polymarket',
    hash: 'test',
  };
  return { market, quote };
}
