import { NextResponse } from 'next/server';

/** Simple uptime check. Backend routes live under /app/api. */
export function GET() {
  return NextResponse.json({ ok: true, service: 'callit-web', time: new Date().toISOString() });
}
