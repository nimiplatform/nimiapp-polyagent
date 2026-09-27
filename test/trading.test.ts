import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, paperPolicy, type Market, type Quote } from '../src/polyagent/model.js';
import { entryAssessment, tradingFee } from '../src/polyagent/strategy.js';
import {
  executePaper,
  prepareOrder,
  applyCumulativeFill,
  settlePosition,
} from '../src/polyagent/paper.js';

import { fixture } from './fixtures.js';

test('fee calculation matches the documented 100-share 95-cent example', () =>
  assert.equal(tradingFee(100, 0.95, { enabled: true, rate: 0.04, exponent: 1 }), 0.19));
test('a candidate requires actual fresh book, fees, time window and capital', () => {
  const { market, quote } = fixture();
  const l = emptyLedger();
  assert.equal(entryAssessment(market, quote, paperPolicy, l).eligible, true);
  for (const [m, q, p] of [
    [{ ...market, fee: null }, quote, paperPolicy],
    [market, { ...quote, observedAt: '2020-01-01' }, paperPolicy],
    [{ ...market, closed: true }, quote, paperPolicy],
    [market, quote, { ...paperPolicy, maxExposureUsd: 1 }],
  ] as const)
    assert.equal(entryAssessment(m, q, p, l).eligible, false);
});
test('uncertain orders reserve the workflow and prevent a second buy', () => {
  const { market, quote } = fixture(),
    l = emptyLedger();
  const o = prepareOrder(market, quote, 'buy', 5, 0.95, 'test', 'live');
  o.status = 'unconfirmed';
  l.orders.push(o);
  assert.ok(
    entryAssessment(market, quote, paperPolicy, l).reasons.some((r) => r.includes('待核对')),
  );
});
test('paper buy then sell consumes real depth, fees and average cost exactly once', () => {
  const { market, quote } = fixture(),
    l = emptyLedger();
  quote.asks = [
    { price: 0.94, size: 3 },
    { price: 0.95, size: 8 },
  ];
  const buy = prepareOrder(market, quote, 'buy', 10, 0.95, 'test', 'paper');
  l.orders.push(buy);
  executePaper(l, buy);
  assert.equal(buy.notionalUsd, 9.47);
  assert.equal(buy.feeUsd, 0.02007);
  assert.equal(l.cashUsd, 90.50993);
  assert.equal(l.positions[0].shares, 10);
  assert.throws(() => executePaper(l, buy), /状态/);
  applyCumulativeFill(l, buy, { filledShares: 10, notionalUsd: 9.47, feeUsd: 0.02007 });
  assert.equal(l.cashUsd, 90.50993);
  const sell = prepareOrder(
    market,
    { ...quote, bids: [{ price: 0.96, size: 100 }] },
    'sell',
    10,
    0.95,
    'test',
    'paper',
  );
  l.orders.push(sell);
  executePaper(l, sell);
  assert.equal(l.positions[0].shares, 0);
  assert.equal(l.cashUsd, 100.09457);
  assert.equal(l.realizedPnlUsd, 0.09457);
});
test('paper FAK fills only available depth and cancels the rest', () => {
  const { market, quote } = fixture(),
    l = emptyLedger();
  quote.asks = [
    { price: 0.95, size: 6 },
    { price: 0.97, size: 100 },
  ];
  const o = prepareOrder(market, quote, 'buy', 10, 0.95, 'test', 'paper');
  l.orders.push(o);
  executePaper(l, o);
  assert.equal(o.status, 'partially-filled');
  assert.equal(o.filledShares, 6);
  assert.equal(l.positions[0].shares, 6);
});
test('unfillable paper order changes no balance or positions', () => {
  const { market, quote } = fixture(),
    l = emptyLedger();
  const o = prepareOrder(market, quote, 'buy', 10, 0.93, 'test', 'paper');
  executePaper(l, o);
  assert.equal(o.status, 'canceled');
  assert.equal(l.cashUsd, 100);
  assert.equal(l.positions.length, 0);
});
test('paper settlement uses final payouts, including zero and half, only once', () => {
  for (const payout of [0, 0.5, 1]) {
    const { market, quote } = fixture(),
      l = emptyLedger();
    const o = prepareOrder(market, quote, 'buy', 10, 0.95, 'test', 'paper');
    executePaper(l, o);
    const before = l.cashUsd;
    settlePosition(l, '123', payout);
    assert.ok(Math.abs(l.cashUsd - (before + 10 * payout)) < 1e-6);
    const after = l.cashUsd;
    settlePosition(l, '123', payout);
    assert.equal(l.cashUsd, after);
    assert.equal(l.positions[0].settled, true);
  }
});
test('overselling and off-tick prices fail before any simulated fill', () => {
  const { market, quote } = fixture(),
    l = emptyLedger();
  assert.throws(
    () => executePaper(l, prepareOrder(market, quote, 'sell', 10, 0.94, 'test', 'paper')),
    /持有/,
  );
  assert.throws(
    () => executePaper(l, prepareOrder(market, quote, 'buy', 10, 0.9501, 'test', 'paper')),
    /步长/,
  );
  assert.equal(l.cashUsd, 100);
});
