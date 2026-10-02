import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Me } from '@/lib/db/me';

type Kind = 'follows' | 'likes' | 'reposts' | 'replies';

const COPY: Record<Kind, string> = {
  follows: 'followed you',
  likes: 'liked your post',
  reposts: 'reposted your post',
  replies: 'replied to your post',
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

    const { data: a } = await db.from('profiles').select('display_name').eq('id', actor.id).maybeSingle();
    const who = (a?.display_name as string) || actor.handle;
    const snippet = (opts.snippet || '').replace(/\s+/g, ' ').trim();
    const { error } = await db.from('notifications').insert({
      profile_id: profileId,
      kind,
      actor_handle: actor.handle,
      title: `${who} ${COPY[kind]}`.slice(0, 140),
      body: snippet ? (snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet) : null,
      link: opts.link || (kind === 'follows' ? `#/profile/${actor.handle}` : null),
    });
    if (error && error.code !== '23505') console.warn('[notify]', kind, error.message);
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
