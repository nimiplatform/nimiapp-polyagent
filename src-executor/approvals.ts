import type { TradingApprovalsState } from '@polymarket/client';
import { Decimal } from 'decimal.js';
export type PredictionVenue = 'standard' | 'neg-risk' | 'v2';
// Polygon production contracts published at https://docs.polymarket.com/resources/contracts
// for the pinned Polymarket SDK 0.11.0; no SDK private environment surface is consumed.
export const PREDICTION_CONTRACTS = {
  collateralToken: '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB',
  standardExchange: '0xE111180000d2663C0091e4f400237545B87B996B',
  negRiskExchange: '0xe2222d279d744050d28e00520010520000310F59',
  conditionalTokens: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  exchangeV3: '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa',
  positionManager: '0x006F54F7f9A22e0000CC2AB60031000000ae9fEF',
} as const;

/** Inspect only the exchange/token pair actually used by each supported CLOB venue. */
export function approvedPredictionVenues(
  state: TradingApprovalsState,
  allowances?: Record<string, bigint>,
  spendUsd = 0,
): PredictionVenue[] {
  const contracts = PREDICTION_CONTRACTS;
  const required = BigInt(new Decimal(spendUsd).mul(1e6).ceil().toFixed(0));
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const venues: Array<[PredictionVenue, string, string]> = [
    ['standard', contracts.standardExchange, contracts.conditionalTokens],
    ['neg-risk', contracts.negRiskExchange, contracts.conditionalTokens],
    ['v2', contracts.exchangeV3, contracts.positionManager],
  ];
  return venues
    .filter(([, exchange, token]) => {
      const missingSpend = state.missing.erc20.some(
        (a) => same(a.tokenAddress, contracts.collateralToken) && same(a.spenderAddress, exchange),
      );
      const amount = Object.entries(allowances ?? {}).find(([address]) =>
        same(address, exchange),
      )?.[1];
      // A finite allowance may be enough for the chosen ceiling even though the
      // SDK's all-product helper asks for maxUint256. Never require extra rights.
      const canSpend = amount !== undefined ? amount >= required && amount > 0n : !missingSpend;
      const canSell = !state.missing.erc1155.some(
        (a) => same(a.tokenAddress, token) && same(a.operatorAddress, exchange),
      );
      return canSpend && canSell;
    })
    .map(([venue]) => venue);
}
