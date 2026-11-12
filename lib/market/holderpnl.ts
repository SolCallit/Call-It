/** Per-holder trade maths for the token page's holders table. Pure, so it can be tested without the network. */
const WSOL = 'So11111111111111111111111111111111111111112';
const USD = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

type TBC = { userAccount?: string; mint?: string; rawTokenAmount?: { tokenAmount: string; decimals: number } };
export type HTx = {
  signature?: string; fee?: number; feePayer?: string; transactionError?: unknown;
  accountData?: { account: string; nativeBalanceChange?: number; tokenBalanceChanges?: TBC[] }[];
};
export type HolderPnl = {
  /** USD spent buying / received selling this token, in the history we could see. */
  bought: number; sold: number; boughtTok: number; soldTok: number;
  /** Average buy price in USD per token; null when no buy was found. */
  avg: number | null;
  /** True when the buys we found account for most of what the wallet holds (so profit is meaningful). */
  full: boolean;
};

/**
 * What `wallet` paid and received for `mint` across its recent transactions.
 * A buy is a transaction where the wallet's token balance went up and its SOL/USDC went down; a
 * sell is the reverse. Tokens that arrived by transfer (no payment) don't count as buys.
 * SOL legs are valued at `solUsd` (today's price): close enough for young tokens, and labelled as an estimate.
 */
export function holderPnl(txs: HTx[], wallet: string, mint: string, solUsd: number, heldTok: number): HolderPnl {
  let bought = 0, sold = 0, boughtTok = 0, soldTok = 0;
  for (const tx of txs) {
    if (!tx || tx.transactionError) continue;
    let tok = 0, sol = 0, usd = 0;
    for (const a of tx.accountData || []) {
      if (a.account === wallet && a.nativeBalanceChange) sol += a.nativeBalanceChange / 1e9;
      for (const c of a.tokenBalanceChanges || []) {
        if (c.userAccount !== wallet || !c.mint || !c.rawTokenAmount) continue;
        const v = Number(c.rawTokenAmount.tokenAmount) / 10 ** (c.rawTokenAmount.decimals || 0);
        if (!Number.isFinite(v)) continue;
        if (c.mint === mint) tok += v;
        else if (c.mint === WSOL) sol += v;
        else if (USD.has(c.mint)) usd += v;
      }
    }
    if (!tok) continue;
    if (tx.feePayer === wallet) sol += (tx.fee || 0) / 1e9; // the network fee isn't part of the price
    const paid = -(sol * solUsd + usd); // > 0 when money left the wallet
    if (tok > 0 && paid > 0) { bought += paid; boughtTok += tok; }
    else if (tok < 0 && paid < 0) { sold += -paid; soldTok += -tok; }
  }
  const need = heldTok + soldTok;
  return {
    bought, sold, boughtTok, soldTok,
    avg: boughtTok > 0 ? bought / boughtTok : null,
    full: boughtTok > 0 && need > 0 && boughtTok / need >= 0.8,
  };
}
