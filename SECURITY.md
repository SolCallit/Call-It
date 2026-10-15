# Security

## Reporting a vulnerability

Email **callit.app26@gmail.com** with "Security" in the subject. Include steps to reproduce and the impact. Please don't open a public issue or test against other users' funds or accounts.

We aim to reply within 48 hours. Responsible reports that lead to a fix may be rewarded.

## How Callit protects users

- **Non-custodial.** Funds stay in the user's own wallet (Privy embedded wallet or Phantom / Solflare / Backpack). Users can export their key at any time.
- **No direct database access from browsers.** Row level security is on with no browser policies; every read and write goes through server routes that verify the user's Privy token.
- **Trades are verified on-chain** before they count toward fees, earnings or points.
- **Encrypted chats.** DMs and private groups are AES-256-GCM encrypted at rest with a per-chat key. Voice and video calls are end-to-end encrypted (WebRTC, DTLS-SRTP).
- **Payouts** come from a dedicated hot wallet that holds only payout SOL. Each payout is reserved and its signature stored before sending, so it can never be paid twice. An admin switch pauses all payouts at once.
- **Treasury** is a separate wallet that only the team signs. Its address is public on the Transparency page.
- **No Callit smart contract holds user funds today.** Swaps run through Jupiter's audited programs.

Callit staff will never ask for your seed phrase or private key.
