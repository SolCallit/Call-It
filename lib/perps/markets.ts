/** Perps markets callers can call (the markets Jupiter Perps lists). Priced from these Solana mints. */
export const PERP_MARKETS = {
  SOL: { mint: 'So11111111111111111111111111111111111111112', name: 'Solana' },
  BTC: { mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', name: 'Bitcoin' },
  ETH: { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', name: 'Ethereum' },
} as const;
export type PerpMarket = keyof typeof PERP_MARKETS;
export const isPerpMarket = (s: unknown): s is PerpMarket => typeof s === 'string' && s in PERP_MARKETS;
