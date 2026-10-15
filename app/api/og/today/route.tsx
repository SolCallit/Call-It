import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type T = {
  ready?: boolean;
  volume?: { all: number; d24: number; trades24?: number; traders24?: number };
  fees?: { d24?: number };
  paid?: { callerPaid: number; cashbackPaid: number; callerPaid24?: number; cashbackPaid24?: number };
};

const usd = (n: number | undefined) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
};

/**
 * GET /api/og/today: a 1200×630 card with today's live numbers, for X posts.
 * Read from /api/transparency on the same site, so it's always the real data.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const d: T = await fetch(`${origin}/api/transparency`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
  const logo = `${origin}/mega-white.png`;
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const stats: [string, string, string][] = [
    ['Paid to callers', usd(d.paid?.callerPaid24), `${usd(d.paid?.callerPaid)} all time`],
    ['Cashback to buyers', usd(d.paid?.cashbackPaid24), `${usd(d.paid?.cashbackPaid)} all time`],
    ['Volume', usd(d.volume?.d24), `${d.volume?.trades24 ?? 0} trades · ${d.volume?.traders24 ?? 0} traders`],
  ];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '56px 64px', color: '#fff',
        background: 'radial-gradient(120% 120% at 100% 0%, #1A4C7A 0%, #0B1B27 55%, #050D14 100%)', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={logo} width={64} height={64} alt="" />
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>Callit</div>
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: '#9DB6CC' }}>Last 24 hours · {day}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>Call it. Get Paid.</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 'auto' }}>
          {stats.map(([label, big, small], i) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '26px 28px', borderRadius: 28,
              background: i === 0 ? 'rgba(61,220,151,0.14)' : 'rgba(255,255,255,0.06)', border: `2px solid ${i === 0 ? 'rgba(61,220,151,0.55)' : 'rgba(255,255,255,0.10)'}` }}>
              <div style={{ display: 'flex', fontSize: 26, color: '#9DB6CC' }}>{label}</div>
              <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, marginTop: 6, color: i === 0 ? '#3DDC97' : '#fff' }}>{big}</div>
              <div style={{ display: 'flex', fontSize: 22, color: '#8FA6BA', marginTop: 4 }}>{small}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 22, color: '#8FA6BA' }}>Live, verified on-chain · callers paid in SOL the minute a call hits target</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=900' } },
  );
}
