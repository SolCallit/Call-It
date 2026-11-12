# Callit — notes for Claude

**Call it. Get Paid.** Solana social calling app: traders post calls on tokens, others buy the call in one tap, callers get paid in SOL when their call hits target. Live at https://callit.buzz (the old `call-it-chi.vercel.app` redirects there).

Reuben builds this solo. He handles monetization, fees and launch decisions himself — give an opinion when asked, but don't change the fee or payout model on your own.

---

## Stack

Next.js 16 · React 19 · TypeScript · PWA · Vercel · Supabase (Postgres + Storage + Realtime) · Privy (auth + embedded wallets) · Solana mainnet via `@solana/kit` + Helius RPC · Jupiter Swap V2 (`/order` + `/execute`, referral fee) · Jupiter Token API v2 (market + spot lists) · Privacy Cash (Private Withdraw) · Lightweight Charts + DexScreener embed · WebRTC calls over Supabase Realtime · Web Push.

No Python anywhere. Claude (Anthropic API) powers the SI Assistant, which is locked as "Coming soon" behind the `SI_OPEN` flag.

---

## Ground rules (these cost real time when missed)

1. **Commit author must be** `SolCallit <335655576+SolCallit@users.noreply.github.com>`. Vercel refuses deploys from any other author. Use:
   `git -c user.name=SolCallit -c user.email=335655576+SolCallit@users.noreply.github.com commit …`
2. **Always `npm run build` before pushing.** Pushing `main` deploys straight to production. Run `npm run typecheck` too — the build doesn't catch everything.
3. **`git pull` before you start.** Reuben also edits from his laptop.
4. **Verify before you report.** Don't say something is broken or fixed without checking it. He has explicitly asked for this.
5. **Never log or commit secrets.** The wallet is non-custodial; Callit never holds user keys.

---

## Where things are

| What | Where |
| --- | --- |
| The whole UI engine | `lib/legacy/engine.ts` (~600 KB, `// @ts-nocheck`, very long single lines) |
| Styles | `app/globals.css`, then `app/v6.css` … `app/v10.css` — later files win. **Put new CSS in the newest file.** |
| Server routes | `app/api/**/route.ts` — auth via `requireMe` / `maybeMe` from `lib/db/me.ts` |
| Market + token data | `lib/market/sources.ts` (Jupiter, DexScreener, GeckoTerminal) |
| Migrations | `supabase/migrations/NNNN_name.sql` — next number is one higher than the last |
| Privy ↔ engine bridge | `components/AuthBridge.tsx` (`window.CallitAuth`, `window.CallitWallet`) |
| Service worker | `public/sw.js` (caching + push) |
| Public docs page | `lib/docs/content.ts` — one Markdown string, drives `#/docs` |
| Env vars, all documented | `.env.example` — empty value means that feature is off |

---

## Working in `engine.ts`

It's a ported prototype, not idiomatic React. Treat it as its own language:

- **Views** are `vXxx()` functions returning HTML strings (`vHome`, `vMarket`, `vWallet`, `vPost`, `vSpot`…). `render()` picks one by route and writes it into `#view`.
- **Actions** are `data-act="name"` on a button, handled in the big action map (search for `wcard:()=>{`). Chat uses a separate `data-cx` map.
- **State** lives in the `S` object. Chat state in `CH`. Live market data in `T` (tokens) and `LIVE` (feeds).
- **Find code with `grep -n`**, not by reading the file. Lines are thousands of characters wide.
- **Edit with exact-string replacement** (a Python script with an assert on match count is the reliable way). A sed with special characters will bite you.
- **Syntax-check without a full build** — much faster when iterating:
  ```bash
  node -e "const ts=require('typescript'),fs=require('fs');const r=ts.transpileModule(fs.readFileSync('lib/legacy/engine.ts','utf8'),{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020}});console.log(r.diagnostics.map(d=>{const p=d.file.getLineAndCharacterOfPosition(d.start);return (p.line+1)+' '+ts.flattenDiagnosticMessageText(d.messageText,'')}).join('\n')||'clean')"
  ```
- Function declarations hoist, so a `vXxx()` can call a helper defined later in the file. `const` helpers can't be called during module init, only at render time.

---

## Testing a change before pushing

Don't push UI changes unseen. The loop that works:

```bash
npm run build
PORT=3100 npm start &
```

Then drive it with Playwright (available at `/opt/npm-tools/node_modules/playwright`), stubbing the APIs you need with `ctx.route(...)` and taking screenshots. Useful init script to land signed-in without Privy:

```js
await ctx.addInitScript(() => {
  Object.defineProperty(window, '__callitRealAuth', { get: () => true, set() {} });
  window.CallitWallet = { addresses: ['x'], token: () => Promise.resolve('t'), embedded: [] };
  window.CallitAuth = { enabled: true, ready: true, authenticated: true, login(){}, logout(){}, markRead(){}, saveProfile: async () => null, refreshNotifs(){} };
  localStorage.setItem('callit.lastProfile', JSON.stringify({ id: 'x', handle: 'uluv22', display_name: '22meow', wallet_address: 'BFv4uJun' }));
  localStorage.setItem('privy:token', 'x');
});
```

Set `__callitRealAuth` to `false` instead for the signed-out/demo path. Check `page.on('pageerror')` every time.

**The container can't reach most external APIs** (Jupiter, Solana RPC, callit.buzz) — the egress proxy blocks them. Two ways around it:
- Stub the API in Playwright for local tests.
- To check a real third-party endpoint, run `fetch()` in the browser pane on Reuben's machine (the `Claude_Browser__javascript_tool`). That's how Jupiter's verified-token list was confirmed.

---

## Deploying and the database

- Push to `main` → Vercel builds → live. Don't create deployments by hand unless a change is env-only.
- **Env-var-only changes need a redeploy** to take effect.
- Migrations: write the file into `supabase/migrations/`, then **paste the full SQL into chat** for Reuben to run in the Supabase SQL editor. Don't just give a path — he has said that's confusing. Applying migrations to production directly is usually blocked anyway.
- **Write code that survives an unrun migration.** Detect the missing column and fall back, so a deploy never breaks while the SQL is pending (see `app/api/posts/replies/route.ts`).
- Database is locked down: RLS on for every table, zero policies, no grants to `anon`/`authenticated`. The browser reads nothing directly; everything goes through the server with the service role. Supabase's "RLS enabled, no policy" advisories are expected, not bugs.

---

## Design rules

- Round pill buttons, hover lift plus a raised 3D press. "To make a call you press a button."
- One toggle style everywhere: the Make-a-call "Time window" pill (`.tgl` / `vseg()`).
- Navy theme matching the white-megaphone logo.
- Phone-first, but the desktop layout matters too (tray + feed + rail + the chat dock).
- No gambling or risk disclaimers in UI copy. Meme traders know.
- **No grid lines. Anywhere.** Not in UI, charts, cards, or video/marketing backgrounds. Reuben has asked for this more than once.
- Marketing and demo content: real logo, real UI, real tokens. No Nigerian names or Nigerian-specific content.

---

## How Reuben wants to be talked to

- Direct and punchy. Short sentences. No filler.
- **Supabase migrations:** paste the full SQL in chat, ready to copy.
- **Vercel env vars:** give **Key** and **Value** on separate lines, never `KEY=VALUE`.
- Flag the real trade-off rather than agreeing. He'd rather hear "this part is risky because…" than a yes.
- Check whether something is already fixed before raising it.
