import { NextResponse } from 'next/server';
import { isMint } from '@/lib/market/sources';
import { rpc, rpcUrl } from '@/lib/solana/rpc';

export const runtime = 'nodejs';

const SYSTEM = '11111111111111111111111111111111';
type Holder = { owner: string; pct: number; tag?: 'pool' | 'dev' | 'bundle' };
type Risk = { dexPaid: boolean | null; bundle: { pct: number | null; wallets: number; dev: string | null; reason?: string } | null; holders: Holder[] };
const CACHE = new Map<string, { v: Risk; at: number }>();

/** DexScreener "Dex paid": an approved, paid token profile order for this token. */
async function dexPaid(mint: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    const list = (Array.isArray(j) ? j : (j as { orders?: unknown[] })?.orders || []) as { type?: string; status?: string }[];
    return list.some((o) => o && o.status === 'approved' && (!o.type || /profile/i.test(o.type)));
  } catch { return null; }
}

type Bal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };
type Tx = { transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } }; meta: { preTokenBalances?: Bal[]; postTokenBalances?: Bal[] } | null } | null;

/** Wallets that received tokens in the launch slot (+1 for Jito bundles). Only for young tokens (< 1000 txs). */
async function bundleOf(mint: string, supply: number) {
  const sigs = await rpc<{ signature: string; slot: number; err: unknown }[]>('getSignaturesForAddress', [mint, { limit: 1000 }]);
  if (!sigs.length) return { pct: null, wallets: 0, dev: null, reason: 'none' };
  if (sigs.length >= 1000) return { pct: null, wallets: 0, dev: null, reason: 'old' };
  const first = Math.min(...sigs.map((s) => s.slot));
  const launch = sigs.filter((s) => !s.err && s.slot <= first + 1).sort((a, b) => a.slot - b.slot).slice(0, 16);
  const txs = await Promise.all(launch.map((s) => rpc<Tx>('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]).catch(() => null)));
  let dev: string | null = null;
  const got = new Map<string, number>();
  txs.forEach((tx, i) => {
    if (!tx || !tx.meta) return;
    const k0 = tx.transaction.message.accountKeys[0];
    const payer = typeof k0 === 'string' ? k0 : k0?.pubkey;
    if (i === 0 && payer) dev = payer;
    const pre = new Map((tx.meta.preTokenBalances || []).filter((b) => b.mint === mint).map((b) => [b.accountIndex, b.uiTokenAmount.uiAmount || 0]));
    for (const b of tx.meta.postTokenBalances || []) {
      if (b.mint !== mint || !b.owner) continue;
      const d = (b.uiTokenAmount.uiAmount || 0) - (pre.get(b.accountIndex) || 0);
      if (d > 0) got.set(b.owner, (got.get(b.owner) || 0) + d);
    }
  });
  // The bonding curve / pool receives most of the supply at creation: not a buyer.
  const buyers = [...got.entries()].filter(([, v]) => v < supply * 0.5);
  const total = buyers.reduce((a, [, v]) => a + v, 0);
  return { pct: supply ? (total / supply) * 100 : null, wallets: buyers.length, dev, buyers: new Set(buyers.map(([o]) => o)) };
}

/**
 * Top 100 holders from a full scan of the token's accounts (Helius DAS). Only possible when the token
 * has at most 5,000 accounts: past that the scan isn't complete, so we can't rank and keep the RPC top 20.
 */
async function dasTop(mint: string, decimals: number): Promise<{ owner: string; ui: number }[] | null> {
  const url = rpcUrl();
  if (!/helius/.test(url)) return null;
  const all = new Map<string, number>();
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'h', method: 'getTokenAccounts', params: { mint, limit: 1000, page } }),
      signal: AbortSignal.timeout(6000),
    }).then((x) => x.json()).catch(() => null) as { result?: { token_accounts?: { owner?: string; amount?: number | string }[] } } | null;
    const list = r?.result?.token_accounts;
    if (!Array.isArray(list)) return null;
    for (const a of list) if (a?.owner) all.set(a.owner, (all.get(a.owner) || 0) + Number(a.amount || 0));
    if (list.length < 1000) {
      return [...all.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([owner, raw]) => ({ owner, ui: raw / 10 ** decimals }));
    }
  }
  return null;
}

/** GET /api/market/risk/<mint>: Dex paid, launch bundle %, and top holders for the bubble map. Cached 5 min. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  const hit = CACHE.get(mint);
  const headers = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=900' };
  if (hit && Date.now() - hit.at < 300_000) return NextResponse.json(hit.v, { headers });
  const onHelius = /helius/.test(rpcUrl());
  const paid = dexPaid(mint);
  let holders: Holder[] = [];
  let bundle: Risk['bundle'] = null;
  try {
    const sup = await rpc<{ value: { uiAmount: number | null; decimals?: number } }>('getTokenSupply', [mint]);
    const supply = sup.value.uiAmount || 0;
    const [largest, b] = await Promise.all([
      rpc<{ value: { address: string; uiAmount: number | null }[] }>('getTokenLargestAccounts', [mint]),
      onHelius ? bundleOf(mint, supply).catch(() => null) : Promise.resolve(null),
    ]);
    let accs: { address: string; uiAmount: number | null }[] = largest.value.slice(0, 20);
    let owners: string[];
    const full = onHelius && accs.length >= 20 ? await dasTop(mint, sup.value.decimals ?? 0).catch(() => null) : null;
    if (full && full.length > accs.length) {
      owners = full.map((x) => x.owner);
      accs = full.map((x) => ({ address: x.owner, uiAmount: x.ui }));
    } else {
      const info = await rpc<{ value: ({ data: { parsed?: { info?: { owner?: string } } } } | null)[] }>('getMultipleAccounts', [accs.map((a) => a.address), { encoding: 'jsonParsed' }]);
      owners = accs.map((_, i) => info.value[i]?.data?.parsed?.info?.owner || accs[i].address);
    }
    const ownerAcc = await rpc<{ value: ({ owner: string } | null)[] }>('getMultipleAccounts', [owners, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    holders = accs.map((a, i) => {
      const o = owners[i];
      const prog = ownerAcc.value[i]?.owner;
      const tag: Holder['tag'] = prog && prog !== SYSTEM ? 'pool' : b && 'dev' in b && b.dev === o ? 'dev' : b && 'buyers' in b && b.buyers?.has(o) ? 'bundle' : undefined;
      return { owner: o, pct: supply ? ((a.uiAmount || 0) / supply) * 100 : 0, ...(tag ? { tag } : {}) };
    }).filter((h) => h.pct > 0);
    if (b) bundle = { pct: b.pct, wallets: b.wallets, dev: b.dev, ...('reason' in b && b.reason ? { reason: b.reason } : {}) };
  } catch { /* partial data is fine */ }
  const v: Risk = { dexPaid: await paid, bundle, holders };
  CACHE.set(mint, { v, at: Date.now() });
  return NextResponse.json(v, { headers });
}
