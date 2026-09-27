import test from 'node:test';
import assert from 'node:assert/strict';
import type { TradingApprovalsState } from '@polymarket/client';
import { approvedPredictionVenues, PREDICTION_CONTRACTS as c } from '../src-executor/approvals.js';
const empty = (): TradingApprovalsState => ({
  isFullyApproved: true,
  missing: { erc20: [], erc1155: [] },
});
test('missing perps approval cannot block prediction trading', () => {
  const state = empty();
  state.isFullyApproved = false;
  state.missing.erc20.push({
    amount: 2n ** 256n - 1n,
    tokenAddress: c.collateralToken as never,
    spenderAddress: '0xDCa4af75705dbB50f62437045afF9921947917d2' as never,
  });
  assert.deepEqual(approvedPredictionVenues(state), ['standard', 'neg-risk', 'v2']);
});
test('missing exchange or token-operator approval closes only the affected venue', () => {
  const state = empty();
  state.isFullyApproved = false;
  state.missing.erc20.push({
    amount: 2n ** 256n - 1n,
    tokenAddress: c.collateralToken as never,
    spenderAddress: c.standardExchange as never,
  });
  state.missing.erc1155.push({
    tokenAddress: c.positionManager as never,
    operatorAddress: c.exchangeV3 as never,
  });
  assert.deepEqual(approvedPredictionVenues(state), ['neg-risk']);
});
test('finite collateral allowance is judged against the chosen spend ceiling', () => {
  const state = empty();
  state.isFullyApproved = false;
  state.missing.erc20.push({
    amount: 2n ** 256n - 1n,
    tokenAddress: c.collateralToken as never,
    spenderAddress: c.standardExchange as never,
  });
  assert.ok(
    approvedPredictionVenues(state, { [c.standardExchange.toLowerCase()]: 5_000_000n }, 5).includes(
      'standard',
    ),
  );
  assert.ok(
    !approvedPredictionVenues(state, { [c.standardExchange]: 4_999_999n }, 5).includes('standard'),
  );
});
