# Callit

Crypto discovery and social calling on Solana. **Call it. Get Paid.**

## Stack
Next.js (App Router) · TypeScript · React · Vercel. Backend next: Supabase, Privy, Jupiter, Helius.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in keys when the backend phase starts
npm run dev                  # http://localhost:3000
```

## Structure
```
app/               routes, layout, metadata, manifest, API routes (app/api/*)
components/        React components
lib/legacy/        the prototype engine and shell, moved over unchanged
public/            icons, share image, service worker
```

The UI currently runs from `lib/legacy/engine.ts` exactly as the prototype did.
Each screen moves into typed React components as it gets wired to real data,
and the legacy engine shrinks until it can be deleted.

## Install as an app (PWA)
- Android / Chrome: open the site → menu → **Install app** (or the install prompt).
- iPhone / Safari: Share → **Add to Home Screen**.

## Deploy
Vercel → Project → Settings → Build & Deployment → Framework Preset: **Next.js**.

## Auth + database (phase 1)
- **Privy** handles sign-in (email, Google, X, Solana wallets) and creates an embedded Solana wallet for new users.
- After sign-in the browser calls `POST /api/session` with the Privy token. The server verifies it, reads the user's linked accounts from Privy, and creates or loads their row in Supabase `profiles`.
- `PATCH /api/profile` saves name, bio, website and X handle.
- Database schema lives in `supabase/migrations/`. Run each file once in Supabase → SQL Editor.

## Chat (migration 0011)
- **Private**: DMs and invite-only groups. Message bodies are encrypted at rest (AES-256-GCM, one key per chat derived from `CHAT_KEY`). Server-side encryption, not end-to-end.
- **Public**: anyone can find, read and join. On send, links outside trusted sites, chat invite links, wallet-drain lines and private-key-shaped strings are blocked; slow mode is 5 messages / 15s.
- Live updates by polling (2.5s in an open chat), so no socket server is needed.
- Env: `CHAT_KEY` = 64 hex characters (32 random bytes). Set it once and never change it, or old private messages can't be opened.
- API: `app/api/chat` (inbox, discover, invites, group actions) and `app/api/chat/messages` (read, poll, send).
