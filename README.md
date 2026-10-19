# Callit

**Call it. Get Paid.** A Solana app where traders post calls on tokens, anyone can buy a call in one tap, and callers are paid in SOL when other people buy their call and it hits its target. Social feed, trading terminal and group chat in one.

[Live app](https://call-it-chi.vercel.app) · [Docs](https://call-it-chi.vercel.app/#/docs) · [Transparency](https://call-it-chi.vercel.app/#/transparency) · [X](https://x.com/CallitApp_Sol)

## Features

- **Calls:** entry market cap stamped at posting, target and thesis, tracked in public; caller position and profit shown on every call
- **Payouts:** callers earn a share of the fee on other people's buys and are paid automatically about a minute after the call hits target
- **Points, cashback, monthly rewards:** points from verified on-chain activity only; buyer cashback; a monthly board that resets on the 1st
- **Market:** live Solana tokens, Trenches, Heat classes, AI Auto filters, OG flags on copycat tokens
- **Swaps:** Jupiter Swap V2 with slippage, speed, MEV protection and limit orders
- **Messages:** encrypted DMs and private groups, guarded public groups, voice and video calls, read receipts, GIFs and token drops
- **Alerts:** push alerts for callers, tokens, wallets and call milestones
- **Telegram:** contract addresses dropped in groups become tracked calls; trading bot built and off by default
- **Private Withdraw:** add funds to a private balance, then send to any address without your Callit wallet showing up (Privacy Cash zero-knowledge pool)
- **Transparency:** public page with volume, fees, payouts, fee split and Callit wallets

## Stack

| Layer | Tech |
| --- | --- |
| App | Next.js 16, React 19, TypeScript, PWA |
| Hosting | Vercel |
| Auth & wallets | Privy (email, Google, X, embedded wallets), Phantom, Solflare, Backpack |
| Chain | Solana mainnet, `@solana/kit`, Helius RPC |
| Swaps | Jupiter Swap V2 (`/order` + `/execute`) with referral fees |
| Tokens | SPL Token + Token-2022 (balances, transfers, transfer-tax detection) |
| Privacy | Privacy Cash shielded pool (browser-side Groth16 ZK proofs) for Private Withdraw |
| Data | Supabase Postgres (RLS on, server-only access), Storage, Realtime |
| Calls | WebRTC, signalled over Supabase Realtime broadcast |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in what you need; empty values just turn features off
npm run dev                  # http://localhost:3000
npm run typecheck
```

Database: run each file in `supabase/migrations/` once, in order, in Supabase → SQL Editor. Every migration is safe to re-run.

## Repository layout

```
app/                 Next.js routes, layout, styles
  api/               server routes (one folder per area: chat, earnings, market, swap, telegram, …)
components/          React providers and auth bridge
lib/
  legacy/            the app UI engine (being moved into typed React components screen by screen)
  chat/              chat storage, encryption, public-group guard, voice/video calls
  earnings/ payouts/ fees/   caller earnings, cashback, points, payout signing, fee model
  telegram/          group-call bot and trading bot
  market/ solana/ wallet/    market data, RPC, wallet client
  docs/              in-app docs content
supabase/migrations/ database schema, in order
public/              icons, service worker, share image
```

## How money moves

1. A user signs a swap in their own wallet; Jupiter executes it and takes Callit's 1% referral fee.
2. The server verifies the transaction on-chain before recording it.
3. Every minute a job prices calls, updates each call's rolling-average multiple, credits earnings, cashback and points, and pays everyone whose call hit target from the payout wallet.
4. Each payout is reserved in the database and its signature saved before sending, so no one is paid twice.

Full fee split and live totals: [Transparency](https://call-it-chi.vercel.app/#/transparency).

## License

[Business Source License 1.1](LICENSE): read, audit and build on the code; personal and research use allowed; no competing commercial copies until **2029-10-15**, when it becomes MIT. The live site shows the commit it was built from in its footer.

## Security

Non-custodial: user funds stay in user wallets. See [SECURITY.md](SECURITY.md) to report a vulnerability.
