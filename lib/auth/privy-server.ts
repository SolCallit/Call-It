import 'server-only';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PRIVY_APP_ID } from '@/lib/config';

const JWKS = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`));

/** Verifies a Privy access token from the Authorization header. Returns the Privy user id (did:privy:...). */
export async function verifyPrivyToken(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: 'privy.io', audience: PRIVY_APP_ID });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

type LinkedAccount = {
  type: string;
  address?: string;
  email?: string;
  username?: string;
  name?: string;
  chain_type?: string;
  wallet_client_type?: string;
};

export type PrivyUserSummary = { solanaWallet: string | null; xUsername: string | null; emailLocal: string | null; name: string | null };

/** Reads the user's linked accounts from Privy (needs PRIVY_APP_SECRET on the server). */
export async function getPrivyUser(userId: string): Promise<PrivyUserSummary> {
  const secret = process.env.PRIVY_APP_SECRET;
  const empty = { solanaWallet: null, xUsername: null, emailLocal: null, name: null };
  if (!secret) return empty;
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PRIVY_APP_ID}:${secret}`).toString('base64'),
      'privy-app-id': PRIVY_APP_ID,
    },
    cache: 'no-store',
  });
  if (!res.ok) return empty;
  const u = (await res.json()) as { linked_accounts?: LinkedAccount[] };
  const acc = u.linked_accounts || [];
  const sol = acc.filter((a) => a.type === 'wallet' && a.chain_type === 'solana');
  const wallet = (sol.find((a) => a.wallet_client_type === 'privy') || sol[0])?.address || null;
  const x = acc.find((a) => a.type === 'twitter_oauth');
  const email = acc.find((a) => a.type === 'email')?.address || acc.find((a) => a.type === 'google_oauth')?.email || null;
  const google = acc.find((a) => a.type === 'google_oauth');
  return {
    solanaWallet: wallet,
    xUsername: x?.username || null,
    emailLocal: email ? email.split('@')[0] : null,
    name: x?.name || google?.name || null,
  };
}
