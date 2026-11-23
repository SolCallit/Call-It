import type { LiveToken } from '@/lib/market/sources';

/* ---------- SI tools: specs and interfaces ----------
   What the model sees, and the Toolbox interface the agent talks to. No server-only imports, so the eval
   suite can load this and swap in fixture data. The live implementation is in tools.ts. */

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type Proposal = { id: string; side: 'buy' | 'sell'; mint: string; sym: string; sol_amount: number | null; sell_pct: number | null; reason: string; expires_at: string };
export interface Toolbox {
  run(name: string, input: Record<string, unknown>): Promise<unknown>;
  /** Tokens looked up this turn (for token cards in the app) and trades proposed (for Approve cards). */
  tokens: LiveToken[];
  proposals: Proposal[];
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_SPECS: ToolSpec[] = [
  { name: 'get_portfolio', description: "The user's live wallet: SOL, stables and every token held with value, weight, 1h/24h change, cost basis and unrealized PnL (when bought through Callit), risk flags per holding, concentration, and 30-day realized PnL.", input_schema: obj({}) },
  { name: 'get_activity', description: "The user's recent trades through Callit (newest first): side, token, USD size, time.", input_schema: obj({ days: { type: 'integer', minimum: 1, maximum: 90, description: 'Look-back window, default 14' } }) },
  { name: 'get_flags', description: 'Recent proactive flags SI raised on the user\'s holdings (dumps, pumps, liquidity pulled, authority changes, concentration).', input_schema: obj({}) },
  { name: 'save_goals', description: "Save the user's goals when they state them. Only include fields they actually told you.", input_schema: obj({
    risk: { type: 'string', enum: ['careful', 'balanced', 'degen'] },
    goal: { type: 'string', enum: ['grow', 'stack_sol', 'protect', 'runners'] },
    max_trade_pct: { type: 'number', minimum: 1, maximum: 100, description: 'Most of the portfolio to put in one trade, in %' },
    notes: { type: 'string', maxLength: 500, description: 'Anything else durable about how they trade, in their words' },
  }) },
  { name: 'lookup_token', description: 'Live market data and safety audit for one Solana token by mint (contract) address, including risk flags.', input_schema: obj({ mint: { type: 'string' } }, ['mint']) },
  { name: 'search_tokens', description: 'Find Solana tokens by ticker or name. Up to 5 matches with mint addresses so the user can confirm the exact one.', input_schema: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'market_pulse', description: 'Solana meme market right now: net buy/sell flow over 5m, 1h and 24h, flow by market-cap bucket, and the tokens with the biggest net inflow and outflow.', input_schema: obj({}) },
  { name: 'caller_record', description: "A Callit caller's public track record: number of calls, how many held 2X, target hits, best and average peak multiple.", input_schema: obj({ handle: { type: 'string' } }, ['handle']) },
  { name: 'propose_trade', description: 'Prepare ONE trade for the user to approve and sign in their wallet. Nothing executes until they tap Approve. Buys spend SOL; sells sell a % of a holding. Use only when the user asks to act or agrees.', input_schema: obj({
    side: { type: 'string', enum: ['buy', 'sell'] },
    mint: { type: 'string', description: 'Token mint address' },
    sol_amount: { type: 'number', exclusiveMinimum: 0, description: 'Buys only: SOL to spend' },
    sell_pct: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Sells only: % of the holding to sell' },
    reason: { type: 'string', maxLength: 200, description: 'One line the user sees on the Approve card' },
    over_limit_ok: { type: 'boolean', description: 'Only true if the user explicitly insisted on going above their max per trade' },
  }, ['side', 'mint', 'reason']) },
];

