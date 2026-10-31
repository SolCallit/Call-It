'use client';

/*
 * React "islands" inside the legacy string-HTML engine.
 *
 * The engine renders pages with innerHTML, so a React component would be destroyed on every render.
 * Instead each island lives in its own detached host element: the engine prints a placeholder
 * (<div data-island="caller" data-key="…" data-props="{json}">), and after every render we move the
 * existing host into the new placeholder. WebGL contexts and animations survive re-renders, and props
 * only re-render React when they actually change.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import CallerCard, { CARD_ART } from '@/components/fx/CallerCard';
import WalletCard from '@/components/fx/WalletCard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<string, ComponentType<any>> = { caller: CallerCard, wallet: WalletCard };

interface Island {
  host: HTMLDivElement;
  root: Root;
  json: string;
  seen: number;
}
const LIVE = new Map<string, Island>();

export function mountIslands(scope: ParentNode | null) {
  if (!scope) return;
  const now = Date.now();
  scope.querySelectorAll<HTMLElement>('[data-island]').forEach(ph => {
    const type = ph.dataset.island || '';
    const Comp = REGISTRY[type];
    if (!Comp) return;
    const key = `${type}:${ph.dataset.key || ''}`;
    const json = ph.dataset.props || '{}';
    let it = LIVE.get(key);
    if (!it) {
      const host = document.createElement('div');
      host.className = 'island';
      it = { host, root: createRoot(host), json: '', seen: now };
      LIVE.set(key, it);
    }
    if (it.json !== json) {
      it.json = json;
      let props = {};
      try {
        props = JSON.parse(json);
      } catch {
        props = {};
      }
      it.root.render(<Comp {...props} />);
    }
    it.seen = now;
    if (it.host.parentNode !== ph) ph.replaceChildren(it.host);
  });
  // Cards that left the page a minute ago give their GPU memory back.
  for (const [k, it] of LIVE) {
    if (!it.host.isConnected && now - it.seen > 60_000) {
      it.root.unmount();
      LIVE.delete(k);
    }
  }
}

/** Share a caller card as a picture (phone share sheet), or download it where sharing files isn't supported. */
export async function shareCard(handle: string) {
  const url = CARD_ART.get(handle);
  if (!url) return false;
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], `callit-${handle}-card.jpg`, { type: 'image/jpeg' });
  const text = `@${handle} on Callit · Call it. Get Paid.`;
  const link = `${location.origin}/#/profile/${encodeURIComponent(handle)}`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, url: link });
      return true;
    } catch {
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

if (typeof window !== 'undefined') {
  const w = window as Window & { __callitIslands?: typeof mountIslands; __callitShareCard?: typeof shareCard };
  w.__callitIslands = mountIslands;
  w.__callitShareCard = shareCard;
}
