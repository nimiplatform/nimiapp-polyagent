import type { Signer } from '@polymarket/client';
import { z } from 'zod';
const authentication = z
  .object({
    domain: z
      .object({
        name: z.literal('ClobAuthDomain'),
        version: z.literal('1'),
        chainId: z.literal(137),
      })
      .strict(),
    primaryType: z.literal('ClobAuth'),
    types: z
      .object({
        EIP712Domain: z.tuple([
          z.object({ name: z.literal('name'), type: z.literal('string') }).strict(),
          z.object({ name: z.literal('version'), type: z.literal('string') }).strict(),
          z.object({ name: z.literal('chainId'), type: z.literal('uint256') }).strict(),
        ]),
        ClobAuth: z.tuple([
          z.object({ name: z.literal('address'), type: z.literal('address') }).strict(),
          z.object({ name: z.literal('timestamp'), type: z.literal('string') }).strict(),
          z.object({ name: z.literal('nonce'), type: z.literal('uint256') }).strict(),
          z.object({ name: z.literal('message'), type: z.literal('string') }).strict(),
        ]),
      })
      .strict(),
    message: z
      .object({
        address: z.string(),
        timestamp: z.string().regex(/^\d+$/),
        nonce: z.union([
          z.number().int().nonnegative(),
          z.bigint().nonnegative(),
          z.string().regex(/^\d+$/),
        ]),
        message: z.literal('This message attests that I control the given wallet'),
      })
      .strict(),
  })
  .strict();

/** Observation permits CLOB login only, even if a downstream SDK attempts another signing workflow. */
export function authenticationOnlySigner(signer: Signer): Signer {
  const denied = async (): Promise<never> => {
    throw new Error('OBSERVATION_SIGNING_DENIED');
  };
  return {
    getAddress: () => signer.getAddress(),
    signMessage: denied,
    sendTransaction: denied,
    signTypedData: async (payload) => {
      const parsed = authentication.safeParse(payload);
      if (!parsed.success) throw new Error('OBSERVATION_SIGNING_DENIED');
      if (parsed.data.message.address.toLowerCase() !== (await signer.getAddress()).toLowerCase())
        throw new Error('AUTHENTICATION_ADDRESS_MISMATCH');
      const age = Date.now() / 1000 - Number(parsed.data.message.timestamp);
      if (age < -30 || age > 120) throw new Error('AUTHENTICATION_EXPIRED');
      return signer.signTypedData(payload);
    },
  };
}
