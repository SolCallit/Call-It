import type { CallitProfile, CallitNotification } from '@/lib/auth/types';

declare global {
  interface Window {
    /** Auth bridge used by the legacy UI engine. */
    CallitAuth?: {
      enabled: boolean;
      ready: boolean;
      authenticated: boolean;
      login: (via?: string, opts?: { email?: string }) => void;
      logout: () => Promise<void>;
      markRead?: (ids: string[] | 'all') => Promise<void>;
      saveProfile: (patch: Partial<Pick<CallitProfile, 'display_name' | 'bio' | 'website' | 'x_handle'>>) => Promise<CallitProfile | null>;
    };
    /** Set by the engine; receives the signed-in profile or null on sign-out. */
    callitApplySession?: (p: CallitProfile | null, opts?: { isNew?: boolean }) => void;
    __callitPendingSession?: { p: CallitProfile | null; opts?: { isNew?: boolean } };
    drawRMedia?: () => void;
    callitAuthChanged?: () => void;
    /** Set by the engine; replaces the notification list (null restores the demo list). */
    callitSetNotifs?: (list: CallitNotification[] | null) => void;
    __callitRealAuth?: boolean;
    /** Wallet bridge: the signed-in user's Solana wallet(s). Signing happens in the wallet; keys never leave it. */
    CallitWallet?: {
      addresses: string[];
      token: () => Promise<string | null>;
      signTx: (base64Tx: string, owner?: string) => Promise<string>;
    };
    callitWalletChanged?: () => void;
  }
}
export {};
