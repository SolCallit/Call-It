import type { Metadata } from 'next';
import GoTransparency from './go';

export const dynamic = 'force-dynamic';

/**
 * /today: the link Callit posts on X. X reads this page's card (live numbers image),
 * and people who tap it land on the Transparency page in the app.
 */
export async function generateMetadata(): Promise<Metadata> {
  // A new image URL every hour, so X fetches fresh numbers instead of a cached card.
  const v = new Date().toISOString().slice(0, 13);
  const img = `/api/og/today?v=${v}`;
  const title = 'Callit today: callers paid, cashback, volume';
  const description = 'Live numbers, verified on-chain. Call it. Get Paid.';
  return {
    title, description,
    openGraph: { title, description, images: [{ url: img, width: 1200, height: 630 }], type: 'website' },
    twitter: { card: 'summary_large_image', title, description, images: [img] },
  };
}

export default function Today() {
  return <GoTransparency />;
}
