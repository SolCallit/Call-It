import type { CallitProfile } from '@/lib/auth/types';

declare global {
  interface Window {
    /** Auth bridge used by the legacy UI engine. */
    CallitAuth?: {
      enabled: boolean;
      ready: boolean;
      authenticated: boolean;
      login: (via?: string, opts?: { email?: string }) => void;
      logout: () => Promise<void>;
      saveProfile: (patch: Partial<Pick<CallitProfile, 'display_name' | 'bio' | 'website' | 'x_handle'>>) => Promise<CallitProfile | null>;
    };
    /** Set by the engine; receives the signed-in profile or null on sign-out. */
    callitApplySession?: (p: CallitProfile | null, opts?: { isNew?: boolean }) => void;
    __callitPendingSession?: { p: CallitProfile | null; opts?: { isNew?: boolean } };
    drawRMedia?: () => void;
    callitAuthChanged?: () => void;
    __callitRealAuth?: boolean;
  }
}
export {};
