/**
 * Callit docs: the single source for the in-app Docs page (#/docs) and the shared document.
 * Plain Markdown (headings, paragraphs, lists, tables, code). Keep it true to what's live.
 */
export const DOCS_MD = `# Callit Docs

**Call it. Get Paid.** Callit is a Solana app where traders post calls on tokens, everyone can follow and buy them in one tap, and callers get paid in SOL when other people buy their calls and the call hits its target. It's a social feed, a trading terminal and a group chat in one.

## Quick start

1. **Sign in** with email, Google or X (you get a Solana wallet from Privy), or connect Phantom, Solflare or Backpack.
2. **Deposit SOL**: tap **Deposit** at the top and send SOL to your wallet address.
3. **Find a token** in **Market**, or paste a contract address (CA) in **Search**.
4. **Make a call**: set a target (2X, 5X, 10X…) and say why. Your entry is stamped at the live market cap.
5. **Share it.** When other traders buy your call and it hits target, you're paid in SOL within about a minute.

## How you get paid

| Step | What happens |
|---|---|
| 1. You call | Entry market cap stamped, target and thesis saved, tracked in public. Calls are free. |
| 2. Others buy | Every buy someone else makes through your call earns you part of Callit's fee on that buy. |
| 3. Hit target | When your call holds its target on the rolling-average market cap (a wick doesn't count), your earnings are sent to your wallet in SOL, usually within a minute. No target set: it pays at 2X. |
| 4. Keep earning | Every buy after that keeps paying, automatically. |

- **Bought in and held to target:** 20% of Callit's fee on those buys, rising to 30% on bigger runs.
- **Didn't buy, or sold before target:** 5%.
- **Your own buys never pay you**, so the only way to earn is a call other traders believe in. Slop calls earn nothing.
- **No caps.** Callers are paid 24/7, as much as they earn.
- Sells never pay callers.

## Points, cashback and monthly rewards

- **Points** come only from verified on-chain activity: **10 points for every $10** traded on Callit, **+50** when your call holds 2X, **+100** when it hits your target, and milestone points as it keeps running: **+150** at 5X, **+300** at 10X, **+750** at 25X, **+1,500** at 50X, **+3,000** at 100X, **+10,000** at 500X, **+25,000** at 1,000X and **+100,000** at 10,000X (25X and up need the token to reach $250K market cap). No buys needed for call points. Likes, follows and alt accounts can't farm points.
- **Cashback:** buyers get **10% of Callit's fee** back on every buy. It unlocks at **1,000 points** (about $1,000 traded, if you only trade) and is paid with your earnings.
- **Monthly rewards:** the top of the monthly **Points** board gets paid. The monthly board resets on the 1st, so anyone who puts in the work can get in. Lifetime points keep counting for ranks and cashback.
- Points also count toward $CALLIT rewards when it launches.

## Features

### Home
Your feed: **For you**, **Following** and **Community**. Posts, calls with live entry vs now, position and profit for callers who bought in, likes, reposts, replies, quotes, bookmarks and @mentions / #tags.

### Market
Live Solana tokens with **Trenches** (new, migrating, migrated), **Heat** classes (Runner, Heating, Fresh, Second Wind, Cooling, Danger, Caller-backed), filters and **AI Auto** for people who don't want to set filters. Copycat ("vamp") tokens are flagged and the original is marked **OG**. Perps and Predictions are coming soon.

### Token pages
Chart, market cap, liquidity, holders, audit flags (mint/freeze authority, top 10, dev), what the token is paired with, socials, calls on the token, one-tap **Buy** and **Call it**.

### DeFi (Swap)
Swaps route through **Jupiter** (best price across Solana). Settings for slippage, speed (priority fee), front-running protection and tip. Limit orders. Staking is coming with $CALLIT.

### Callerboard
- **Rankings:** callers ranked by win rate, then average return. A call wins if it hits its target or is up 50%+.
- **Points:** this month and all time, with monthly rewards.
- **Latest calls:** every new call, live.

### Messages
- **DMs and private groups** are encrypted on the server. **Public groups** are guarded: drainer links, invite links, scam lines and anything shaped like a private key are blocked.
- **Voice and video calls**, device to device and end-to-end encrypted (groups up to 6).
- **Message ticks:** one grey = sent, two grey = delivered, two blue = seen.
- **Share tray:** photo, camera, **GIF**, **Token** (drops a live Buy / Call it card), file, voice note.
- **Group settings:** owners and admins edit name, photo and description, make admins, and can turn on **Only admins can send**.
- Wallpapers, replies, invite links, mute.

### Alerts
Push alerts for callers you follow, token price bells, outside-wallet tracking and call milestones (2X, 3X, 5X…).

### Private Withdraw
Send money out of Callit without the receiver seeing your Callit wallet. Built on **Privacy Cash**, a zero-knowledge shielded pool on Solana.
1. **Add funds** to your private balance (SOL, USDC or USDT). You approve it in your wallet.
2. **Send privately** to any address. A zero-knowledge proof spends your private balance and Privacy Cash's relayer pays the address, so your wallet isn't in that transaction.

Your private balance is encrypted notes only your wallet can read. Unlocking it is one free signature, and the same balance shows on privacycash.org with the same wallet, so your funds never depend on Callit staying up. For the most privacy, wait a while between adding and sending, and send a different amount.

Callit also runs a second privacy rail on **Helius Privacy Rings**, Solana's native privacy layer (SOL only for now). Same two steps, with one difference: on a private send your wallet signs nothing on-chain — it authorizes inside the zero-knowledge proof, and Callit covers the network fee. Proofs run on Helius' attested secure enclave, and your private balance is recoverable with the same wallet in any Privacy Rings app.

### You
Profile and wallet in one: balances, deposit, withdraw (standard or private), send, history, **Caller earnings** (with Claim), cashback progress, export your private key, link Telegram.

### Telegram
Add the Callit bot to a group and an admin sends **/callit**. Every contract address dropped after that becomes a tracked call on Callit. Link your Telegram in **You** so calls post as you and pay you. A Telegram **trading bot** is built and launches after the app.

### Coming soon
SI Assistant (an AI that cross-checks, trades and pays only on your command), Perps, Predictions, $CALLIT staking, Promote.

## Fees and where they go

The trading fee is **1%** on swaps made through Callit, taken in the same transaction through Jupiter's referral program. Jupiter keeps 20% of it. Callit's 80% is split:

| Bucket | Buy from a call | Other buys | Sells |
|---|---|---|---|
| Callers | 20% | – | – |
| Referrals | 10% | 10% | – |
| Trader cashback | 10% | 10% | – |
| Buyback & burn | 15% | 20% | 30% |
| Treasury & growth | 45% | 60% | 70% |

Whatever a caller doesn't take (for example a 5% caller) stays in Treasury & growth. Solana network fees go to the network, not Callit.

**Withdrawals**

| | Callit fee | Other fees |
|---|---|---|
| Standard withdraw | **Free** | Solana network fee (~0.00001 SOL) |
| Private withdraw (Privacy Cash) | **Free.** Callit takes nothing | Privacy Cash: 0.35% + a small flat fee (0.006 SOL, or ~$0.62 for USDC/USDT) when you send |
| Private withdraw (Helius Rings) | **Free.** Callit even pays the network fee on sends | None |

Every fee is shown before you approve.

The **Transparency** page shows live totals: volume, fees, what's been paid to callers and buyers, how fees were allocated, and every Callit wallet with its balance and a Solscan link.

## Security

- **Non-custodial.** Your funds stay in your own wallet. Nothing moves unless you approve it. Export your key any time from **You**.
- Trades are normal Solana transactions you can look up on Solscan, fee included.
- Calls are stamped at posting time and can't be edited.
- **Private withdrawals:** Callit never stores where private sends go. The private balance key is derived in your browser from a wallet signature and never leaves it. Proofs are generated on your device.
- Callit staff will never ask for your seed phrase or private key.
- Payouts are sent from a dedicated payout wallet that holds only payout SOL. The treasury is a separate wallet only the team signs.

## Tech stack

| Layer | What we use |
|---|---|
| Web app | Next.js 16, React 19, TypeScript, installable PWA |
| Hosting | Vercel (app, API routes, cron) |
| Auth & wallets | Privy (email, Google, X, embedded Solana wallets), Phantom / Solflare / Backpack |
| Blockchain | Solana mainnet, @solana/kit, Helius RPC |
| Swaps | Jupiter Swap V2 (Meta-Aggregator: /order + /execute) with referral fees |
| Tokens | SPL Token and **Token-2022**: balances, transfers and withdrawals for both, plus Token-2022 transfer-tax detection from on-chain mint extensions |
| Privacy | **Privacy Cash** shielded pool: Groth16 zero-knowledge proofs (snarkjs) generated in the browser, Poseidon hashing (Light Protocol WASM), relayer-paid withdrawals |
| Market data | Jupiter token data, DexScreener pairs, PumpPortal live launches |
| Database | Supabase Postgres with row level security (all reads and writes go through the server) |
| Storage | Supabase Storage (public media, private chat files with signed links) |
| Realtime | Supabase Realtime broadcast (call signalling), WebRTC (voice/video), polling (chat) |
| Push | Web Push (VAPID) |
| Bots | Telegram Bot API (webhook) |
| Encryption | AES-256-GCM per chat (HKDF keys), DTLS-SRTP for calls |
| Jobs | Per-minute alerts + instant payouts, daily payout catch-up |

## Architecture

1. The browser signs in with Privy and calls Callit's API routes with a Privy token.
2. API routes verify the token, then read and write Supabase with the server key. Browsers can't touch the database directly.
3. Swaps: the server asks Jupiter for an order, the user's wallet signs it, Jupiter executes it, and the server records the trade after checking it on-chain.
4. Every minute a job prices recent calls, updates each call's rolling-average X, credits caller earnings, cashback and points, and pays everyone whose call hit target.
5. Private withdrawals: the browser derives the private balance key from a wallet signature, builds the zero-knowledge proof itself, and talks to Privacy Cash's relayer and Solana through Callit's pass-through routes, which don't log requests.
6. Payouts are signed by the payout wallet. Each claim is reserved in the database first and its signature saved before sending, so nobody is ever paid twice.

## API

Base URL: the Callit site. Responses are JSON. **Signed-in** routes need the header \`Authorization: Bearer <Privy token>\`.

### Public

No key needed. Full machine-readable spec: \`/openapi.json\` (OpenAPI 3.1).

| Method & path | What it returns |
|---|---|
| \`GET /api/market/list\` | Live token lists (movers, new, traded, organic) |
| \`GET /api/market/search?q=\` | Token search by name, ticker or CA |
| \`GET /api/market/token/{mint}\` | One token: price, MC, liquidity, holders, audit, socials |
| \`GET /api/market/chart?mint=&tf=\` | Candles for the chart |
| \`GET /api/market/pairs/{mint}\` | Trading pairs |
| \`GET /api/market/risk/{mint}\` | Risk checks |
| \`GET /api/posts\` | Feed and calls |
| \`GET /api/leaders/callers?window=7d\\|30d\\|All time\` | Callerboard |
| \`GET /api/points?period=month\\|all\` | Points board and monthly rewards status |
| \`GET /api/transparency\` | Volume, fees, payouts, fee split, Callit wallets |
| \`GET /api/og/today\` | Today's numbers as a 1200×630 card image |
| \`GET /api/news\` | Crypto news |
| \`GET /api/calls/peak\` | Peak multiple for calls |
| \`GET /api/health\` | Service status |

### Signed in

| Method & path | What it does |
|---|---|
| \`GET /api/me\` | Your profile |
| \`POST /api/posts\` | Post or make a call |
| \`POST /api/posts/react\`, \`/api/posts/replies\` | Like, repost, reply |
| \`POST /api/social\` | Follow, mute, block |
| \`GET /api/swap/order\` · \`POST /api/swap/execute\` | Get a Jupiter order · send the signed swap |
| \`GET/POST /api/transactions\` | Your history · record a trade (verified on-chain) |
| \`GET /api/wallet/balances\` | Wallet balances |
| \`GET /api/earnings\` · \`POST /api/earnings\` | Earnings, cashback, claims · claim now |
| \`GET/POST /api/chat\` | Inbox, discover, create/join/leave groups, edit groups, roles |
| \`GET/POST /api/chat/messages\` | Read (with receipts) and send messages |
| \`POST /api/chat/call\` | Start, join, decline or end a voice/video call |
| \`POST /api/media\` | Upload a photo or chat file |
| \`GET/PUT /api/alerts\` | Alert preferences, bells, tracked wallets |
| \`POST /api/push/subscribe\` | Turn on push notifications |
| \`GET/POST /api/telegram/link\` | Link Telegram |

## Links

- Website: the Callit app
- X: Callit on X
- Telegram: coming soon
- Email: callit.app26@gmail.com
`;
