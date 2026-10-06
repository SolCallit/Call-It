import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { heliusKey } from '@/lib/solana/rpc';

/**
 * Keeps ONE Helius webhook watching every tracked wallet. Called whenever someone adds/removes a wallet.
 * Needs HELIUS_API_KEY and HELIUS_WEBHOOK_SECRET. The webhook id is remembered in app_kv.
 */
export async function syncHeliusWebhook(db: SupabaseClient, origin: string): Promise<{ ok: boolean; detail?: string }> {
  const key = heliusKey(), secret = (process.env.HELIUS_WEBHOOK_SECRET || '').trim();
  if (!key || !secret) return { ok: false, detail: 'HELIUS_API_KEY / HELIUS_WEBHOOK_SECRET not set' };
  const { data: rows } = await db.from('tracked_wallets').select('address').limit(100_000);
  const addrs = [...new Set((rows || []).map((r) => r.address as string))];
  const { data: kv } = await db.from('app_kv').select('v').eq('k', 'helius_webhook_id').maybeSingle();
  const id = (kv?.v as string) || process.env.HELIUS_WEBHOOK_ID || null;
  const body = {
    webhookURL: `${process.env.PUBLIC_SITE_URL || origin}/api/hooks/helius`,
    transactionTypes: ['SWAP'], accountAddresses: addrs.length ? addrs : ['11111111111111111111111111111111'],
    webhookType: 'enhanced', authHeader: secret,
  };
  const base = 'https://api.helius.xyz/v0/webhooks';
  try {
    const r = await fetch(id ? `${base}/${id}?api-key=${key}` : `${base}?api-key=${key}`, {
      method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json().catch(() => ({}))) as { webhookID?: string; error?: string };
    if (!r.ok) {
      // Webhook was deleted on Helius' side: forget it so the next sync creates a fresh one.
      if (id && r.status === 404) await db.from('app_kv').delete().eq('k', 'helius_webhook_id');
      return { ok: false, detail: j.error || `Helius ${r.status}` };
    }
    if (!id && j.webhookID) await db.from('app_kv').upsert({ k: 'helius_webhook_id', v: j.webhookID, updated_at: new Date().toISOString() });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
