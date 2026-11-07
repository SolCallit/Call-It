# Callit — notes for Claude

**Call it. Get Paid.** Solana social calling app: traders post calls on tokens, others buy the call in one tap, callers get paid in SOL when their call hits target. Live at https://callit.buzz (the old call-it-chi.vercel.app redirects there).

## Stack
Next.js 16 · React 19 · TypeScript · PWA · Vercel · Supabase (Postgres + Storage + Realtime) · Privy (auth + embedded wallets) · Solana mainnet via `@solana/kit` + Helius RPC · Jupiter Swap V2 (`/order` + `/execute`, referral fee) · Privacy Cash (Private Withdraw) · WebRTC calls over Supabase Realtime · Web Push.
No Python anywhere. Claude (Anthropic API) powers the SI Assistant, which is locked as "Coming soon" (`SI_OPEN` flag).

## Where things are
- `lib/legacy/engine.ts` — the whole UI engine (~600 KB, `// @ts-nocheck`, long single lines). Views are `vXxx()` functions returning HTML strings, actions live in the `data-act` map, chat actions in the `data-cx` map. Use `grep -n` to find code; edit with exact-string replacements.
- `app/globals.css` then `app/v6.css` … `app/v10.css` — later files override earlier ones. Put new styles in the newest file.
- `app/api/**/route.ts` — server routes. Auth with `requireMe` / `maybeMe` from `lib/db/me.ts`.
- `supabase/migrations/NNNN_name.sql` — numbered; next one is one higher than the last.
- `components/AuthBridge.tsx` — Privy ↔ engine bridge (`window.CallitAuth`, `window.CallitWallet`).
- `public/sw.js` — service worker (caching + push).
- `.env.example` — every env var with comments. Empty value = feature off.

## Rules
- **Commit author must be** `SolCallit <335655576+SolCallit@users.noreply.github.com>` or Vercel refuses the deploy.
- Run `npm run build` before pushing. Pushing `main` deploys to production.
- Wallet is non-custodial: Callit never holds user keys. Never log or commit secrets.
- Design: round pill buttons with hover + raised 3D effect; one toggle style (the Make-a-call "Time window" pill); navy theme matching the white-megaphone logo. No gambling/risk disclaimers in UI copy.
- Marketing/content: real Callit logo, real UI, real tokens. No Nigerian names or Nigerian-specific content.

## How Reuben wants instructions
- Supabase migrations: paste the **full SQL** in chat to copy and run, not just a file path.
- Vercel env vars: give **Key** and **Value** separately, never `KEY=VALUE`.
- Direct and short. Check before flagging something that's already fixed.
