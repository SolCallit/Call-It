import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Me } from '@/lib/db/me';
import { pushTo } from '@/lib/push/send';

type Kind = 'follows' | 'likes' | 'reposts' | 'replies' | 'mentions' | 'quotes';

const COPY: Record<Kind, string> = {
  follows: 'followed you',
  likes: 'liked your post',
  reposts: 'reposted your post',
  replies: 'replied to your post',
  mentions: 'mentioned you',
  quotes: 'quoted your post',
};

/**
 * Tells someone about a follow / like / repost / reply.
 * Never throws: a failed notification must not fail the action that caused it.
 * Duplicate follow/like/repost notifications are blocked by a unique index (migration 0005).
 */
export async function notifySocial(
  db: SupabaseClient,
  actor: Me,
  kind: Kind,
  target: { profileId?: string | null; handle?: string | null },
  opts: { link?: string; snippet?: string } = {},
): Promise<void> {
  try {
    let profileId = target.profileId || null;
    if (!profileId && target.handle) {
      const { data } = await db.from('profiles').select('id').eq('handle', target.handle).maybeSingle();
      profileId = (data?.id as string) || null;
    }
    if (!profileId || profileId === actor.id) return;

    const { data: a } = await db.from('profiles').select('display_name, avatar_url').eq('id', actor.id).maybeSingle();
    const who = (a?.display_name as string) || actor.handle;
    const snippet = (opts.snippet || '').replace(/\s+/g, ' ').trim();
    const { error } = await db.from('notifications').insert({
      profile_id: profileId,
      kind: kind === 'quotes' ? 'mentions' : kind, // stored with mentions (same notification bucket)
      actor_handle: actor.handle,
      title: `${who} ${COPY[kind]}`.slice(0, 140),
      body: snippet ? (snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet) : null,
      link: opts.link || (kind === 'follows' ? `#/profile/${actor.handle}` : null),
    });
    if (error) { if (error.code !== '23505') console.warn('[notify]', kind, error.message); return; }

    // Phone pop-up too, unless they switched on quiet mode. Likes/reposts on the same post replace each other.
    const { data: pref } = await db.from('alert_prefs').select('quiet').eq('profile_id', profileId).maybeSingle();
    if (pref?.quiet) return;
    const link = opts.link || (kind === 'follows' ? `#/profile/${actor.handle}` : '#/notifications');
    await pushTo(db, [profileId], {
      title: `${who} ${COPY[kind]}`.slice(0, 140),
      body: snippet ? (snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet) : kind === 'follows' ? `@${actor.handle}` : '',
      link,
      tag: kind === 'likes' || kind === 'reposts' ? `${kind}:${link}` : undefined,
      icon: (a?.avatar_url as string) || null, // the person's photo, like X; the Callit badge shows in the status bar
    }, `${kind}:${actor.handle}:${Date.now()}`);
  } catch (e) {
    console.warn('[notify] failed', kind, (e as Error).message);
  }
}

/** The owner of a real post (uuid ref) and a short snippet of it. Demo posts return null. */
export async function postOwner(db: SupabaseClient, ref: string): Promise<{ profileId: string; body: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return null;
  const { data } = await db.from('posts').select('profile_id, body').eq('id', ref).maybeSingle();
  return data ? { profileId: data.profile_id as string, body: (data.body as string) || '' } : null;
}

/** @handles in a post or reply (unique, max 5, the author excluded). */
export function mentionsIn(text: string, self: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{1,30})/g)) {
    const h = m[2].toLowerCase();
    if (h !== self.toLowerCase()) out.add(m[2]);
    if (out.size >= 5) break;
  }
  return [...out];
}

/** Notifies everyone @mentioned. Never throws. */
export async function notifyMentions(db: SupabaseClient, actor: Me, text: string, link: string, skip: string[] = []): Promise<void> {
  const hs = mentionsIn(text, actor.handle);
  if (!hs.length) return;
  try {
    const { data } = await db.from('profiles').select('id, handle').in('handle', hs);
    await Promise.all((data || []).filter((p) => !skip.includes(p.id as string))
      .map((p) => notifySocial(db, actor, 'mentions', { profileId: p.id as string }, { link, snippet: text })));
  } catch (e) {
    console.warn('[notify] mentions failed', (e as Error).message);
  }
}
