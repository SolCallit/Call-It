import { supabaseAdmin } from '@/lib/supabase/admin';
import { json } from '@/lib/db/me';
import { alertUsers, usd } from '@/lib/push/send';
import { jupMany } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE: Record<string, string> = { [WSOL]: 'SOL', EPjFWJ5gWW2DnzSp1pThfP1QZBrpdKvR1MzVg1uu5ihx: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT' };

type Tx = {
  signature: string; type?: string; source?: string; feePayer?: string;
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
};

/** What a wallet did in one swap: bought or sold which token, for how much SOL/USDC. */
function readSwap(tx: Tx, w: string) {
  const tt = tx.tokenTransfers || [];
  const got = tt.filter((t) => t.toUserAccount === w && t.mint && !QUOTE[t.mint]);
  const gave = tt.filter((t) => t.fromUserAccount === w && t.mint && !QUOTE[t.mint]);
  const side = got.length ? 'buy' : gave.length ? 'sell' : null;
  if (!side) return null;
  const leg = (side === 'buy' ? got : gave).sort((a, b) => (b.tokenAmount || 0) - (a.tokenAmount || 0))[0];
  let sol = 0;
  for (const n of tx.nativeTransfers || []) { if (n.fromUserAccount === w) sol -= (n.amount || 0) / 1e9; if (n.toUserAccount === w) sol += (n.amount || 0) / 1e9; }
  let stable = 0, stableSym = '';
  for (const t of tt) {
    if (!t.mint || !QUOTE[t.mint]) continue;
    const v = (t.toUserAccount === w ? 1 : t.fromUserAccount === w ? -1 : 0) * (t.tokenAmount || 0);
    if (t.mint === WSOL) sol += v; else { stable += v; stableSym = QUOTE[t.mint]; }
  }
  const quote = Math.abs(stable) > 0.01 ? `${Math.abs(stable).toFixed(2)} ${stableSym}` : Math.abs(sol) > 0.0001 ? `${Math.abs(sol).toFixed(Math.abs(sol) < 1 ? 3 : 2)} SOL` : '';
  return { side, mint: leg.mint as string, amount: leg.tokenAmount || 0, quote };
}

/** POST from Helius (enhanced SWAP webhook): turn tracked wallets' swaps into push alerts. */
export async function POST(req: Request) {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!secret || req.headers.get('authorization') !== secret) return json({ error: 'unauthorized' }, 401);
  const db = supabaseAdmin();
  if (!db) return json({ ok: false });
  const txs = ((await req.json().catch(() => [])) as Tx[]).filter((t) => t && t.signature).slice(0, 100);
  if (!txs.length) return json({ ok: true });

  const cand = new Set<string>();
  txs.forEach((t) => { if (t.feePayer) cand.add(t.feePayer); (t.tokenTransfers || []).forEach((x) => { if (x.fromUserAccount) cand.add(x.fromUserAccount); if (x.toUserAccount) cand.add(x.toUserAccount); }); });
  const { data: rows } = await db.from('tracked_wallets').select('profile_id, address, label').in('address', [...cand].slice(0, 1000));
  if (!rows?.length) return json({ ok: true });
  const byAddr = new Map<string, { profile_id: string; label: string | null }[]>();
  rows.forEach((r) => { const l = byAddr.get(r.address as string) || []; l.push({ profile_id: r.profile_id as string, label: (r.label as string) || null }); byAddr.set(r.address as string, l); });

  const events: { w: string; sig: string; side: string; mint: string; quote: string }[] = [];
  for (const tx of txs) for (const w of byAddr.keys()) { const s = readSwap(tx, w); if (s) events.push({ w, sig: tx.signature, ...s }); }
  if (!events.length) return json({ ok: true });
  const toks = new Map((await jupMany([...new Set(events.map((e) => e.mint))]).catch(() => [])).map((t) => [t.mint, t]));

  let sent = 0;
  for (const e of events) {
    const t = toks.get(e.mint), sym = t?.sym || e.mint.slice(0, 4), short = `${e.w.slice(0, 4)}…${e.w.slice(-4)}`;
    // Each tracker sees the wallet under their own label.
    const groups = new Map<string, string[]>();
    for (const r of byAddr.get(e.w) || []) { const name = r.label || short; groups.set(name, [...(groups.get(name) || []), r.profile_id]); }
    for (const [name, ids] of groups) {
      sent += await alertUsers(db, ids, 'wallets', `w:${e.sig}:${e.w}`, {
        title: `${e.side === 'buy' ? '🟢' : '🔴'} ${name} ${e.side === 'buy' ? 'bought' : 'sold'} $${sym}`,
        body: [t?.mc ? `MC ${usd(t.mc)}` : '', e.quote ? `${e.side === 'buy' ? 'Spent' : 'Got'} ${e.quote}` : ''].filter(Boolean).join(' · ') || 'Tap to view the token.',
        link: `#/token/${e.mint}`, icon: t?.icon,
      });
    }
  }
  return json({ ok: true, sent });
}
