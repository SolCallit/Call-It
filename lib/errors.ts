/**
 * Turns anything thrown or returned as an error (Error, Privy error, wallet-standard
 * error, RPC error object, Jupiter response, plain string) into readable text.
 * Never returns "[object Object]".
 */
export function errText(e: unknown, depth = 0): string {
  if (depth > 5 || e == null) return '';
  if (typeof e === 'string') return e === '[object Object]' ? '' : e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (typeof e !== 'object') return '';
  const o = e as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['message', 'error', 'errorMessage', 'reason', 'details', 'msg', 'description', 'cause', 'data', 'InstructionError']) {
    const v = errText(o[k], depth + 1);
    if (v && !parts.includes(v)) { parts.push(v); break; }
  }
  const logs = (o.logs || o.transactionLogs) as unknown;
  if (Array.isArray(logs) && logs.length) parts.push(logs.slice(-2).join(' | '));
  const code = o.code ?? o.errorCode;
  if (parts.length) return code != null && !parts[0].includes(String(code)) ? `${parts.join(' — ')} (code ${code})` : parts.join(' — ');
  try {
    const s = JSON.stringify(o);
    return s && s !== '{}' ? s.slice(0, 240) : '';
  } catch {
    return 'Unknown error';
  }
}

const CANCEL = /user (rejected|denied|cancel)|rejected the request|declin|closed|cancel/i;
// Privy reports "the user closed our window" as "Failed to connect to wallet" with this as the
// cause. Kept narrow on purpose: a cause like "connection closed" is a real failure, not a cancel.
const CANCEL_CAUSE = /user (rejected|denied|cancel)|rejected the request|exited the modal/i;
const causeText = (e: unknown) => (e && typeof e === 'object' ? errText((e as { cause?: unknown }).cause) : '');

export const isUserCancel = (e: unknown) => CANCEL.test(errText(e)) || CANCEL_CAUSE.test(causeText(e));

const RULES: [RegExp, string][] = [
  [CANCEL, 'You cancelled it. Nothing was sent.'],
  [/insufficient (funds|lamports|sol)|attempt to debit|custom program error: 0x1\b|not enough balance/i, 'Not enough SOL to cover this and the network fee.'],
  [/blockhash not found|block height exceeded|expired/i, 'The network took too long and it expired. Nothing was sent. Try again.'],
  [/429|too many requests|rate.?limit/i, 'Solana is busy right now. Try again in a few seconds.'],
  [/slippage|0x1771|exceeds desired slippage/i, 'Price moved past your slippage. Raise slippage in swap settings or retry.'],
  [/origin|not allowed|allowed domain|iframe/i, 'Your wallet couldn’t open on this page. Refresh, or open Callit in your main browser.'],
  [/mfa|recovery|passcode|password/i, 'Your wallet needs to be unlocked first. Open it and try again.'],
  [/no wallet|wallet not ready|not connected/i, 'Wallet not connected. Sign in again.'],
  [/code"?:? ?-100\d|code -100\d/i, 'The swap didn’t land in time. Nothing was spent. Try again.'],
  [/timed? ?out|timeout/i, 'It timed out. Check History before retrying so you don’t send twice.'],
];

/** Readable message for a toast. Raw details stay in `errText` for logs. */
export function friendlyError(e: unknown): string {
  if (isUserCancel(e)) return 'You cancelled it. Nothing was sent.';
  const t = errText(e) || 'Something went wrong. Nothing was sent.';
  for (const [re, msg] of RULES) if (re.test(t)) return msg;
  return t.length > 160 ? t.slice(0, 157) + '…' : t;
}
