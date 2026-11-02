import { NextResponse } from 'next/server';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const hashOf = async (pw: string, salt: string) => (await scrypt(pw, Buffer.from(salt, 'hex'), 32)).toString('hex');
const RESET_HOURS = 24;
const valid = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= 6 && pw.length <= 64;

type Lock = { hash: string; salt: string; fails: number; locked_until: string | null; reset_at: string | null };

/**
 * Wallet password, asked before exporting a private key.
 * GET  → { set, locked_until, reset_at }
 * POST { action: 'set', password, current? }  create it (or change it with the current one)
 * POST { action: 'verify', password }          check it; 5 misses lock it for 15 min, then longer
 * POST { action: 'reset' }                     forgot it: clears after 24 hours (a verify cancels it)
 */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const l = await read(a.db, a.me.id);
  if (l === 'missing') return json({ set: false, migration: false });
  if (!l) return json({ set: false });
  return json({ set: true, locked_until: l.locked_until, reset_at: l.reset_at });
}

async function read(db: import('@supabase/supabase-js').SupabaseClient, id: string): Promise<Lock | null | 'missing'> {
  const { data, error } = await db.from('wallet_locks').select('hash, salt, fails, locked_until, reset_at').eq('profile_id', id).maybeSingle();
  if (error) return error.code === '42P01' ? 'missing' : null;
  if (data?.reset_at && Date.parse(data.reset_at) <= Date.now()) {
    await db.from('wallet_locks').delete().eq('profile_id', id);
    return null;
  }
  return data as Lock | null;
}

export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const { db, me } = a;
  const b = (await req.json().catch(() => ({}))) as { action?: string; password?: unknown; current?: unknown };
  const l = await read(db, me.id);
  if (l === 'missing') return json({ error: 'Wallet passwords aren’t set up yet.' }, 503);

  const check = async (lock: Lock, pw: unknown) => {
    if (lock.locked_until && Date.parse(lock.locked_until) > Date.now()) {
      const m = Math.ceil((Date.parse(lock.locked_until) - Date.now()) / 60000);
      return { ok: false as const, res: json({ error: `Too many wrong tries. Try again in ${m} min.`, locked: true }, 429) };
    }
    const good = typeof pw === 'string' && timingSafeEqual(Buffer.from(await hashOf(pw, lock.salt), 'hex'), Buffer.from(lock.hash, 'hex'));
    if (good) {
      await db.from('wallet_locks').update({ fails: 0, locked_until: null, reset_at: null, updated_at: new Date().toISOString() }).eq('profile_id', me.id);
      return { ok: true as const };
    }
    const fails = lock.fails + 1, mins = fails >= 5 ? 15 * 2 ** Math.min(4, Math.floor((fails - 5) / 5)) : 0;
    await db.from('wallet_locks').update({ fails, locked_until: mins ? new Date(Date.now() + mins * 60000).toISOString() : null }).eq('profile_id', me.id);
    const left = Math.max(0, 5 - (fails % 5 || 5));
    return { ok: false as const, res: json({ error: mins ? `Wrong password. Locked for ${mins} min.` : `Wrong password.${left ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before it locks.` : ''}` }, 400) };
  };

  if (b.action === 'set') {
    if (!valid(b.password)) return json({ error: 'Use 6 to 64 characters.' }, 400);
    if (l) { const c = await check(l, b.current); if (!c.ok) return c.res; }
    const salt = randomBytes(16).toString('hex');
    const { error } = await db.from('wallet_locks').upsert({ profile_id: me.id, salt, hash: await hashOf(b.password, salt), fails: 0, locked_until: null, reset_at: null, updated_at: new Date().toISOString() });
    if (error) return json({ error: 'Couldn’t save it. Try again.' }, 500);
    return json({ ok: true });
  }
  if (b.action === 'verify') {
    if (!l) return json({ error: 'Set a wallet password first.', needSet: true }, 400);
    const c = await check(l, b.password);
    return c.ok ? json({ ok: true }) : c.res;
  }
  if (b.action === 'reset') {
    if (!l) return json({ ok: true });
    if (l.reset_at) return json({ ok: true, reset_at: l.reset_at });
    const at = new Date(Date.now() + RESET_HOURS * 3600_000).toISOString();
    await db.from('wallet_locks').update({ reset_at: at }).eq('profile_id', me.id);
    await db.from('notifications').insert({
      profile_id: me.id, kind: 'system', title: 'Wallet password reset requested',
      body: `Your wallet password clears in ${RESET_HOURS} hours. If this wasn’t you, enter your password once to cancel it.`, link: '#/you',
    });
    return json({ ok: true, reset_at: at });
  }
  return json({ error: 'unknown_action' }, 400);
}
