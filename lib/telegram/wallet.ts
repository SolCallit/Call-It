import 'server-only';
import { createCipheriv, createDecipheriv, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createKeyPairFromBytes, createKeyPairSignerFromBytes, getBase58Decoder, type KeyPairSigner } from '@solana/kit';
import { rpc } from '@/lib/solana/rpc';

/**
 * Telegram bot wallets (Trojan-style): Callit holds the key so buys are one tap.
 * Keys are AES-256-GCM encrypted with BOT_WALLET_KEY (32+ random bytes, base64 or hex) and never logged.
 * Losing or changing BOT_WALLET_KEY locks every bot wallet, so back it up and never rotate it casually.
 */
export const tradingOn = () => process.env.TG_TRADING_ON === '1' && !!master();
export const maxBuySol = () => { const n = Number(process.env.TG_MAX_BUY_SOL); return Number.isFinite(n) && n > 0 ? n : 5; };

function master(): Buffer | null {
  const raw = (process.env.BOT_WALLET_KEY || '').trim();
  if (!raw) return null;
  const b = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return b.length >= 32 ? b : null;
}
const keyFor = (addr: string) => Buffer.from(hkdfSync('sha256', master()!, Buffer.from(addr), Buffer.from('callit-tg-wallet'), 32));

function seal(addr: string, secret: Uint8Array): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyFor(addr), iv);
  c.setAAD(Buffer.from(addr));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
function open(addr: string, sealed: string): Uint8Array {
  const [v, iv, tag, ct] = sealed.split(':');
  if (v !== 'v1') throw new Error('bad_key_format');
  const d = createDecipheriv('aes-256-gcm', keyFor(addr), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(addr));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]));
}

/** A fresh Solana keypair as the usual 64 bytes: 32-byte seed + 32-byte public key. */
function newSecret(): { secret: Uint8Array; address: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const d = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
  const x = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const secret = new Uint8Array(Buffer.concat([d, x]));
  return { secret, address: getBase58Decoder().decode(x) };
}

export type BotWallet = {
  tg_user_id: number; address: string; secret_enc: string; profile_id: string | null;
  buy_amounts: number[]; slippage_bps: number | null; auto_call: boolean;
};

export async function getWallet(db: SupabaseClient, tgUserId: number): Promise<BotWallet | null> {
  const { data } = await db.from('tg_wallets').select('*').eq('tg_user_id', tgUserId).maybeSingle();
  return (data as BotWallet) || null;
}

export async function ensureWallet(db: SupabaseClient, tgUserId: number): Promise<BotWallet> {
  const have = await getWallet(db, tgUserId);
  if (have) return have;
  const { secret, address } = newSecret();
  const row = { tg_user_id: tgUserId, address, secret_enc: seal(address, secret) };
  secret.fill(0);
  const { error } = await db.from('tg_wallets').insert(row);
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  return (await getWallet(db, tgUserId))!;
}

export async function signerOf(w: BotWallet): Promise<{ signer: KeyPairSigner; pair: CryptoKeyPair }> {
  const bytes = open(w.address, w.secret_enc);
  try {
    const [signer, pair] = await Promise.all([createKeyPairSignerFromBytes(bytes), createKeyPairFromBytes(bytes)]);
    if (signer.address !== w.address) throw new Error('key_mismatch');
    return { signer, pair };
  } finally { bytes.fill(0); }
}

/** The private key in Phantom's "import private key" format (base58). Only for /export. */
export function exportKey(w: BotWallet): string {
  const bytes = open(w.address, w.secret_enc);
  try { return getBase58Decoder().decode(bytes); } finally { bytes.fill(0); }
}

export async function solBalance(addr: string): Promise<number> {
  const r = await rpc<{ value: number }>('getBalance', [addr, { commitment: 'confirmed' }]);
  return (r.value || 0) / 1e9;
}

/** Raw amount + decimals of one token the wallet holds (both SPL Token and Token-2022). */
export async function tokenBalance(owner: string, mint: string): Promise<{ raw: bigint; ui: number; decimals: number }> {
  const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; uiAmount: number | null; decimals: number } } } } } }[] }>(
    'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let raw = 0n, ui = 0, decimals = 0;
  for (const a of r.value || []) {
    const t = a.account.data.parsed.info.tokenAmount;
    raw += BigInt(t.amount); ui += Number(t.uiAmount) || 0; decimals = t.decimals;
  }
  return { raw, ui, decimals };
}

/** Every token the wallet holds with a balance, for /positions. */
export async function holdings(owner: string): Promise<{ mint: string; ui: number }[]> {
  const out: { mint: string; ui: number }[] = [];
  for (const program of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
    const r = await rpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } }[] }>(
      'getTokenAccountsByOwner', [owner, { programId: program }, { encoding: 'jsonParsed', commitment: 'confirmed' }]).catch(() => ({ value: [] }));
    for (const a of r.value || []) {
      const i = a.account.data.parsed.info;
      if ((i.tokenAmount.uiAmount || 0) > 0) out.push({ mint: i.mint, ui: Number(i.tokenAmount.uiAmount) });
    }
  }
  return out;
}
