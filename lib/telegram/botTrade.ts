import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tg, h, siteUrl, findMints } from '@/lib/telegram/bot';
import { tradingOn, ensureWallet, getWallet, solBalance, tokenBalance, holdings, exportKey, maxBuySol, type BotWallet } from '@/lib/telegram/wallet';
import { buy, sell, withdraw, fmtN, fmtUsd } from '@/lib/telegram/trade';
import { jupMany } from '@/lib/market/sources';

type User = { id: number; is_bot?: boolean; username?: string; first_name?: string };
type Msg = { message_id: number; chat: { id: number; type: string }; from?: User; text?: string; reply_to_message?: { text?: string } };
export type CallbackQuery = { id: string; from: User; message?: { message_id: number; chat: { id: number } }; data?: string };
type Btn = { text: string; callback_data?: string; url?: string };

const send = (chat_id: number, text: string, kb?: Btn[][], extra: Record<string, unknown> = {}) =>
  tg<{ message_id: number }>('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}), ...extra });
const edit = (chat_id: number, message_id: number, text: string, kb?: Btn[][]) =>
  tg('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);

/** Records a money-moving action once. Returns false when Telegram is re-sending the same tap. */
async function once(db: SupabaseClient, id: string, u: number, action: string, mint?: string, amount?: number): Promise<boolean> {
  const { error } = await db.from('tg_actions').insert({ id, tg_user_id: u, action, mint: mint ?? null, amount: amount ?? null });
  return !error;
}
const finish = (db: SupabaseClient, id: string, ok: boolean, sig?: string, err?: string) =>
  db.from('tg_actions').update({ status: ok ? 'done' : 'failed', signature: sig ?? null, error: err?.slice(0, 300) ?? null }).eq('id', id);

/* ───────────── screens ───────────── */
async function home(db: SupabaseClient, chat: number, w: BotWallet) {
  const bal = await solBalance(w.address).catch(() => 0);
  await send(chat, `⚡ <b>Callit Trading Bot</b>\n\nYour wallet:\n<code>${w.address}</code>\nBalance: <b>${bal.toFixed(4)} SOL</b>\n\n`
    + `Paste any contract address to trade it. Every buy also posts a call on Callit, so when others buy your call, <b>you get paid</b>.\n\n`
    + `Send SOL to the address above to start.`, [
    [{ text: '💰 Wallet', callback_data: 'w' }, { text: '📊 Positions', callback_data: 'p' }],
    [{ text: '⚙️ Settings', callback_data: 'set' }, { text: '🌐 Open Callit', url: siteUrl() }],
  ]);
}

async function tokenCard(chat: number, w: BotWallet, mint: string, msgId?: number) {
  const [[t], held] = await Promise.all([jupMany([mint]).catch(() => []), tokenBalance(w.address, mint).catch(() => ({ ui: 0, raw: 0n, decimals: 0 }))]);
  if (!t) return send(chat, 'Couldn’t find that token. Check the contract address.');
  const c = t.chg?.h24, amts = (w.buy_amounts?.length ? w.buy_amounts : [0.1, 0.5, 1]).slice(0, 3);
  const text = `<b>$${h(t.sym || '?')}</b> · ${h(t.name || '')}\n<code>${mint}</code>\n\n`
    + `MC <b>${fmtUsd(t.mc)}</b> · Liq ${fmtUsd(t.liq)}${c != null ? ` · 24h ${c >= 0 ? '🟢 +' : '🔴 '}${c.toFixed(1)}%` : ''}\n`
    + `${t.holders ? `Holders ${fmtN(t.holders)} · ` : ''}${t.audit?.mintOff === false ? '⚠️ Mint on · ' : ''}${t.audit?.freezeOff === false ? '⚠️ Freeze on · ' : ''}${t.launchpad ? h(t.launchpad) : 'Solana'}\n`
    + (held.ui > 0 ? `\nYou hold <b>${fmtN(held.ui)}</b> ($${(held.ui * (t.price || 0)).toFixed(2)})` : '')
    + `\n<a href="${siteUrl()}/#/token/${mint}">Chart on Callit</a>`;
  const kb: Btn[][] = [
    amts.map((a) => ({ text: `Buy ${a} SOL`, callback_data: `b|${a}|${mint}` })),
    [{ text: '✏️ Buy X SOL', callback_data: `bx|${mint}` }],
    ...(held.raw > 0n ? [[{ text: 'Sell 25%', callback_data: `s|25|${mint}` }, { text: 'Sell 50%', callback_data: `s|50|${mint}` }, { text: 'Sell 100%', callback_data: `s|100|${mint}` }]] : []),
    [{ text: '🔄 Refresh', callback_data: `r|${mint}` }, { text: '💰 Wallet', callback_data: 'w' }],
  ];
  return msgId ? edit(chat, msgId, text, kb) : send(chat, text, kb);
}

async function walletScreen(chat: number, w: BotWallet, msgId?: number) {
  const bal = await solBalance(w.address).catch(() => 0);
  const text = `💰 <b>Your bot wallet</b>\n<code>${w.address}</code>\n\nBalance: <b>${bal.toFixed(4)} SOL</b>\n\n`
    + `Deposit: send SOL to the address above.\nWithdraw: <code>/withdraw ADDRESS AMOUNT</code> (or <code>all</code>).`;
  const kb: Btn[][] = [[{ text: '🔄 Refresh', callback_data: 'w' }, { text: '📊 Positions', callback_data: 'p' }], [{ text: '🔑 Export private key', callback_data: 'x' }]];
  return msgId ? edit(chat, msgId, text, kb) : send(chat, text, kb);
}

async function positions(chat: number, w: BotWallet) {
  const hs = await holdings(w.address).catch(() => []);
  if (!hs.length) return send(chat, 'No tokens yet. Paste a contract address to buy one.');
  const toks = await jupMany(hs.map((x) => x.mint).slice(0, 25)).catch(() => []);
  const by = new Map(toks.map((t) => [t.mint, t]));
  const rows = hs.map((x) => ({ x, t: by.get(x.mint), v: x.ui * (by.get(x.mint)?.price || 0) })).sort((a, b) => b.v - a.v).slice(0, 12);
  await send(chat, `📊 <b>Positions</b>\n\n${rows.map((r) => `<b>$${h(r.t?.sym || short(r.x.mint))}</b> · ${fmtN(r.x.ui)} · <b>$${r.v.toFixed(2)}</b>`).join('\n')}`,
    rows.map((r) => [{ text: `$${r.t?.sym || short(r.x.mint)}`, callback_data: `r|${r.x.mint}` }]));
}

async function settings(chat: number, w: BotWallet, msgId?: number) {
  const text = `⚙️ <b>Settings</b>\n\nQuick buys: <b>${(w.buy_amounts || []).join(' / ')} SOL</b>\nSlippage: <b>${w.slippage_bps ? w.slippage_bps / 100 + '%' : 'Auto'}</b>\nAuto-post calls on Callit: <b>${w.auto_call ? 'On' : 'Off'}</b>\n\n`
    + `Change quick buys: <code>/setbuy 0.1 0.5 1</code>\nChange slippage: <code>/slippage 15</code> (or <code>auto</code>)`;
  const kb: Btn[][] = [[{ text: w.auto_call ? '📣 Auto-call: On' : '📣 Auto-call: Off', callback_data: 'ac' }]];
  return msgId ? edit(chat, msgId, text, kb) : send(chat, text, kb);
}

/* ───────────── trades (run after the webhook has answered) ───────────── */
async function doBuy(db: SupabaseClient, chat: number, u: User, w: BotWallet, mint: string, sol: number, actionId: string) {
  if (!(await once(db, actionId, u.id, 'buy', mint, sol))) return;
  const m = await send(chat, `⏳ Buying ${sol} SOL of <code>${short(mint)}</code>…`);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { data: ref } = await db.from('tg_actions').select('signature').eq('tg_user_id', u.id).eq('action', 'ref').eq('mint', mint).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
  const r = await buy(db, w, u, mint, sol, (ref?.[0]?.signature as string) || null);
  await finish(db, actionId, r.ok, r.ok ? r.signature : undefined, r.ok ? undefined : r.error);
  const text = r.ok ? `✅ ${h(r.text)}\n<a href="${solscan(r.signature)}">View on Solscan</a>${r.callId ? ` · <a href="${siteUrl()}/#/post/${r.callId}">Your call on Callit</a>` : ''}` : `❌ ${h(r.error)}`;
  if (m) await edit(chat, m.message_id, text, [[{ text: '🔄 Token', callback_data: `r|${mint}` }, { text: '💰 Wallet', callback_data: 'w' }]]);
}
async function doSell(db: SupabaseClient, chat: number, u: User, w: BotWallet, mint: string, pct: number, actionId: string) {
  if (!(await once(db, actionId, u.id, 'sell', mint, pct))) return;
  const m = await send(chat, `⏳ Selling ${pct}% of <code>${short(mint)}</code>…`);
  const r = await sell(db, w, u, mint, pct);
  await finish(db, actionId, r.ok, r.ok ? r.signature : undefined, r.ok ? undefined : r.error);
  const text = r.ok ? `✅ ${h(r.text)}\n<a href="${solscan(r.signature)}">View on Solscan</a>` : `❌ ${h(r.error)}`;
  if (m) await edit(chat, m.message_id, text, [[{ text: '🔄 Token', callback_data: `r|${mint}` }, { text: '💰 Wallet', callback_data: 'w' }]]);
}

const OFF = '⚡ <b>Trading in Telegram is coming soon.</b>\nFor now, trade on Callit: ' + siteUrl();

/** Direct messages to the bot (everything except /start <link code>, which the webhook handles). Returns true if handled. */
export async function handleTradeDM(db: SupabaseClient, m: Msg, run: (p: Promise<unknown>) => void): Promise<boolean> {
  const chat = m.chat.id, u = m.from!, text = (m.text || '').trim();
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const name = cmd?.[1].toLowerCase(), arg = (cmd?.[2] || '').trim();
  const mints = findMints(text);
  const tradeCmd = ['start', 'wallet', 'buy', 'sell', 'positions', 'withdraw', 'export', 'settings', 'setbuy', 'slippage', 'help'];
  if (!tradingOn()) {
    if ((name && tradeCmd.includes(name) && name !== 'start') || (!name && mints.length)) { await send(chat, OFF); return true; }
    return false;
  }
  const w = await ensureWallet(db, u.id);

  // Deep links from group call cards: /start c_<call id> or b_<mint>
  if (name === 'start' && /^(c|b)_/.test(arg)) {
    let mint = arg.slice(2), callId: string | null = null;
    if (arg.startsWith('c_')) {
      const { data: p } = await db.from('posts').select('id, mint').eq('id', arg.slice(2)).maybeSingle();
      if (!p?.mint) { await home(db, chat, w); return true; }
      mint = p.mint as string; callId = p.id as string;
    }
    if (callId) await db.from('tg_actions').insert({ id: `ref:${u.id}:${callId}:${Date.now()}`, tg_user_id: u.id, action: 'ref', mint, signature: callId, status: 'done' });
    await tokenCard(chat, w, mint);
    return true;
  }
  if (name === 'start' && !arg) { await home(db, chat, w); return true; }
  if (name === 'help') {
    await send(chat, '<b>Commands</b>\nPaste a CA → trade it\n/buy CA SOL\n/sell CA PERCENT\n/wallet · /positions · /settings\n/withdraw ADDRESS AMOUNT|all\n/export (private key)');
    return true;
  }
  if (name === 'wallet') { await walletScreen(chat, w); return true; }
  if (name === 'positions') { await positions(chat, w); return true; }
  if (name === 'settings') { await settings(chat, w); return true; }
  if (name === 'export') { await exportPrompt(chat); return true; }
  if (name === 'setbuy') {
    const a = arg.split(/[\s,]+/).map(Number).filter((n) => n > 0 && n <= maxBuySol()).slice(0, 3);
    if (!a.length) { await send(chat, `Usage: <code>/setbuy 0.1 0.5 1</code> (up to ${maxBuySol()} SOL each)`); return true; }
    await db.from('tg_wallets').update({ buy_amounts: a }).eq('tg_user_id', u.id);
    await send(chat, `✅ Quick buys set to ${a.join(' / ')} SOL`); return true;
  }
  if (name === 'slippage') {
    const v = /^auto$/i.test(arg) ? null : Math.round(Number(arg) * 100);
    if (v !== null && !(v >= 10 && v <= 5000)) { await send(chat, 'Usage: <code>/slippage 15</code> (0.1–50%) or <code>/slippage auto</code>'); return true; }
    await db.from('tg_wallets').update({ slippage_bps: v }).eq('tg_user_id', u.id);
    await send(chat, `✅ Slippage ${v ? v / 100 + '%' : 'auto'}`); return true;
  }
  if (name === 'withdraw') {
    const [to, amt] = arg.split(/\s+/);
    if (!to || !amt) { await send(chat, 'Usage: <code>/withdraw ADDRESS AMOUNT</code> or <code>/withdraw ADDRESS all</code>'); return true; }
    const sol = /^all$/i.test(amt) ? 'all' as const : Number(amt);
    if (sol !== 'all' && !(sol > 0)) { await send(chat, 'Amount must be a number of SOL, or all.'); return true; }
    const id = `m:${chat}:${m.message_id}`;
    run((async () => {
      if (!(await once(db, id, u.id, 'withdraw', undefined, sol === 'all' ? -1 : sol))) return;
      const r = await withdraw(w, to, sol);
      await finish(db, id, r.ok, r.ok ? r.signature : undefined, r.ok ? undefined : r.error);
      await send(chat, r.ok ? `✅ ${h(r.text)}\n<a href="${solscan(r.signature)}">View on Solscan</a>` : `❌ ${h(r.error)}`);
    })());
    return true;
  }
  if (name === 'buy' || name === 'sell') {
    const [ca, n] = arg.split(/\s+/);
    const v = Number(n);
    if (!ca || !findMints(ca).length || !(v > 0)) { await send(chat, name === 'buy' ? 'Usage: <code>/buy CA 0.5</code>' : 'Usage: <code>/sell CA 50</code>'); return true; }
    const id = `m:${chat}:${m.message_id}`;
    run(name === 'buy' ? doBuy(db, chat, u, w, ca, v, id) : doSell(db, chat, u, w, ca, Math.min(100, v), id));
    return true;
  }
  // "Buy X SOL": the reply to our prompt carries the mint in the prompt text.
  const replyMint = m.reply_to_message?.text && /Reply with the SOL amount/.test(m.reply_to_message.text) ? findMints(m.reply_to_message.text)[0] : null;
  if (replyMint) {
    const v = Number(text.replace(',', '.'));
    if (!(v > 0)) { await send(chat, 'Send just a number, like 0.25'); return true; }
    run(doBuy(db, chat, u, w, replyMint, v, `m:${chat}:${m.message_id}`));
    return true;
  }
  if (mints.length) { await tokenCard(chat, w, mints[0]); return true; }
  if (!name) { await send(chat, 'Paste a contract address to trade it, or send /help.'); return true; }
  return false;
}

async function exportPrompt(chat: number) {
  await send(chat, '🔑 <b>Export private key</b>\n\nAnyone with this key controls the wallet and everything in it. Never share it, never paste it into a website you don’t trust. Callit will never ask you for it.',
    [[{ text: 'Show my key', callback_data: 'xx' }, { text: 'Cancel', callback_data: 'w' }]]);
}

/** Button taps. Answers Telegram right away; trades run after the webhook returns. */
export async function handleTradeCallback(db: SupabaseClient, q: CallbackQuery, run: (p: Promise<unknown>) => void) {
  const data = q.data || '', chat = q.message?.chat.id, msgId = q.message?.message_id, u = q.from;
  const answer = (text?: string, alert = false) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text, show_alert: alert } : {}) });
  if (!chat) return answer();
  if (!tradingOn()) return answer('Trading in Telegram is coming soon', true);
  const w = (await getWallet(db, u.id)) || (await ensureWallet(db, u.id));
  const [k, a, b] = data.split('|');
  switch (k) {
    case 'b': await answer(`Buying ${a} SOL…`); run(doBuy(db, chat, u, w, b, Number(a), 'cb:' + q.id)); return;
    case 's': await answer(`Selling ${a}%…`); run(doSell(db, chat, u, w, b, Number(a), 'cb:' + q.id)); return;
    case 'bx': await answer(); await send(chat, `Reply with the SOL amount to buy\n<code>${a}</code>`, undefined, { reply_markup: { force_reply: true, input_field_placeholder: '0.25' } }); return;
    case 'r': await answer('Refreshed'); await tokenCard(chat, w, a, msgId); return;
    case 'w': await answer(); await walletScreen(chat, w, msgId); return;
    case 'p': await answer(); await positions(chat, w); return;
    case 'set': await answer(); await settings(chat, w); return;
    case 'ac': await db.from('tg_wallets').update({ auto_call: !w.auto_call }).eq('tg_user_id', u.id); await answer(w.auto_call ? 'Auto-call off' : 'Auto-call on'); await settings(chat, { ...w, auto_call: !w.auto_call }, msgId); return;
    case 'x': await answer(); await exportPrompt(chat); return;
    case 'xx': {
      await answer();
      await db.from('tg_wallets').update({ exported_at: new Date().toISOString() }).eq('tg_user_id', u.id);
      // Spoiler-hidden and deleted after a minute, so it doesn't sit in the chat.
      const sent = await send(chat, `<tg-spoiler>${exportKey(w)}</tg-spoiler>\n\nImport into Phantom or Solflare as a private key. This message deletes itself in about 40 seconds.`);
      if (sent) run(new Promise((r) => setTimeout(r, 40_000)).then(() => tg('deleteMessage', { chat_id: chat, message_id: sent.message_id })));
      return;
    }
    default: return answer();
  }
}

/** Button under a call posted in a group: opens the bot on that call, so buys pay the caller. */
export async function buyButton(callId: string): Promise<Btn[][] | undefined> {
  if (!tradingOn()) return undefined;
  const { botUsername } = await import('@/lib/telegram/bot');
  const bot = await botUsername();
  return bot ? [[{ text: '⚡ Buy with Callit bot', url: `https://t.me/${bot}?start=c_${callId}` }]] : undefined;
}
