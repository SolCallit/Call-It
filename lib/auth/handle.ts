/** Turns a username/email/wallet into a valid Callit handle: 3–20 chars, a–z 0–9 _ */
export function toHandle(seed: string | null | undefined, wallet?: string | null): string {
  let h = (seed || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  if (h.length < 3) h = 'caller_' + (wallet ? wallet.slice(0, 4).toLowerCase().replace(/[^a-z0-9]/g, '') : Math.random().toString(36).slice(2, 6));
  return h.slice(0, 20);
}
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
