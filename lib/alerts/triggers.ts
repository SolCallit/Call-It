import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { alertUsers, bellersOf, bellsOn, usd } from '@/lib/push/send';
import { jupMany } from '@/lib/market/sources';

const QUOTES = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

/** A new call: tell followers, and anyone with a 🔔 on the token. */
export async function onNewCall(db: SupabaseClient, me: { id: string; handle: string }, post: { id: string; kind: string; mint?: string | null; token_sym?: string | null; entry_mc?: number | null; body?: string | null }) {
  const link = `#/post/${post.id}`;
  if (post.kind !== 'meme' || !post.mint) {
    // Non-call posts only reach people who chose "All activity" on this profile's 🔔.
    const all = (await bellersOf(db, me.handle, 'all')).filter((id) => id !== me.id);
    await alertUsers(db, all, 'follows', `p:${post.id}`, { title: `@${me.handle} posted`, body: (post.body || 'Tap to see the post.').slice(0, 140), link });
    return;
  }
  const sym = post.token_sym || 'token';
  const fol = (await bellersOf(db, me.handle, 'calls')).filter((id) => id !== me.id);
  await alertUsers(db, fol, 'follows', `c:${post.id}`, { title: `📢 @${me.handle} called $${sym}`, body: `Entry at ${usd(post.entry_mc)} MC. Tap to see the call.`, link });
  const bells = (await bellsOn(db, post.mint)).filter((id) => id !== me.id && !fol.includes(id));
  await alertUsers(db, bells, 'bells', `c:${post.id}`, { title: `🔔 New call on $${sym}`, body: `@${me.handle} called it at ${usd(post.entry_mc)} MC.`, link });
}

/** A Callit user bought or sold: tell their followers. */
export async function onTrade(db: SupabaseClient, me: { id: string; handle: string }, t: { kind: string; signature: string; in_mint: string | null; out_mint: string | null; usd_value: number | null }) {
  if (t.kind !== 'buy' && t.kind !== 'sell' && t.kind !== 'swap') return;
  const mint = [t.out_mint, t.in_mint].find((m) => m && !QUOTES.has(m));
  if (!mint) return;
  const buy = t.out_mint === mint;
  const [tok] = await jupMany([mint]).catch(() => []);
  const sym = tok?.sym || 'token';
  const fol = (await bellersOf(db, me.handle, 'all')).filter((id) => id !== me.id);
  await alertUsers(db, fol, 'follows', `t:${t.signature}`, {
    title: `${buy ? '🟢' : '🔴'} @${me.handle} ${buy ? 'bought' : 'sold'} $${sym}`,
    body: [tok?.mc ? `MC ${usd(tok.mc)}` : '', t.usd_value ? `${buy ? 'Spent' : 'Got'} ${usd(t.usd_value)}` : ''].filter(Boolean).join(' · ') || 'Tap to view the token.',
    link: `#/token/${mint}`, icon: tok?.icon,
  });
}
