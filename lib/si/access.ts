import 'server-only';
import { adminHandles } from '@/lib/db/admin';

/** SI is open to everyone when SI_ASSISTANT=1; before that, only admins can use it (to test before launch). */
export function siAllowed(me: { handle: string; wallet_address: string | null }): boolean {
  if (process.env.SI_ASSISTANT === '1') return true;
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return wallets.length ? !!me.wallet_address && wallets.includes(me.wallet_address) : adminHandles().includes(me.handle.toLowerCase());
}
