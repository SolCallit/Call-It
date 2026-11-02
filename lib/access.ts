import 'server-only';

/** Invite-only mode is on when ACCESS_GATE=1 (set after running migration 0021). */
export const gateOn = () => process.env.ACCESS_GATE === '1';

/** API paths a signed-in user without access can still call (to unlock, sign in and look around). */
const OPEN = [/^\/api\/access/, /^\/api\/session/, /^\/api\/me$/, /^\/api\/notifications/, /^\/api\/push/, /^\/api\/bugs/, /^\/api\/wallet\/pin/];
export const openPath = (url: string) => { try { const p = new URL(url).pathname; return OPEN.some((r) => r.test(p)); } catch { return false; } };
