import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { getChat, isUuid, liveCall, memberOf, systemMsg } from '@/lib/chat/store';
import { broadcast, callTopic, iceServers, ringTopic } from '@/lib/chat/ring';
import { pushTo } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ON_CALL = 6; // mesh calls: every device streams to every other one, so keep rooms small
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * POST /api/chat/call
 *  { action:'start',   chat, kind:'audio'|'video' } → { call, ice }   (joins the live call if one is already running)
 *  { action:'join',    call }                      → { call, ice }
 *  { action:'ping',    call }                      keeps the call listed while anyone is on it
 *  { action:'decline', call }                      tells the caller you won't pick up
 *  { action:'end',     call, secs, last }          you hung up; last=true closes the call and logs it
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const a = b.action;

  if (a === 'start') {
    if (!isUuid(b.chat)) return json({ error: 'invalid' }, 400);
    const kind = b.kind === 'video' ? 'video' : 'audio';
    const c = await getChat(db, b.chat);
    if (!c) return json({ error: 'not_found' }, 404);
    const mem = await memberOf(db, c.id, me.id);
    if (!mem || mem.role === 'banned') return json({ error: 'not_member' }, 403);

    const live = await liveCall(db, c.id);
    if (live) return json({ call: { ...live, chat: c.id, topic: callTopic(live.id), joined: true }, ice: iceServers() });

    const ins = await db.from('chat_calls').insert({ chat_id: c.id, started_by: me.id, kind }).select('id, kind, started_at').single();
    if (ins.error) {
      const notReady = /chat_calls/.test(ins.error.message); // migration 0014 not run yet
      return json({ error: notReady ? 'calls_not_ready' : 'db_write', detail: ins.error.message }, notReady ? 503 : 500);
    }
    const id = ins.data.id as string;
    const label = kind === 'video' ? 'video call' : 'voice call';
    await systemMsg(db, c.id, `[[call:${id}|${kind}]] @${me.handle} started a ${label}`);

    // Ring everyone in DMs and private groups. Public groups just show "Join call" in the chat.
    if (c.kind !== 'public') {
      const { data: ms } = await db.from('chat_members').select('profile_id, muted').eq('chat_id', c.id).neq('role', 'banned').neq('profile_id', me.id).limit(50);
      const ids = (ms || []).map((m) => m.profile_id as string);
      const { data: who } = await db.from('profiles').select('display_name, avatar_url').eq('id', me.id).maybeSingle();
      const payload = {
        call: id, chat: c.id, kind, from: me.handle, name: (who?.display_name as string) || null, avatar: (who?.avatar_url as string) || null,
        title: c.kind === 'dm' ? null : c.title, group: c.kind !== 'dm',
      };
      await Promise.all([
        broadcast(ids.map(ringTopic).filter((t): t is string => !!t), 'ring', payload),
        pushTo(db, (ms || []).filter((m) => !m.muted).map((m) => m.profile_id as string), {
          title: `📞 Incoming ${label}`,
          body: c.kind === 'dm' ? `@${me.handle} is calling you` : `@${me.handle} in ${c.title || 'your group'}`,
          link: `#/messages/c-${c.id}`, tag: 'call-' + id, icon: (who?.avatar_url as string) || null,
        }).catch(() => null),
      ]);
    }
    return json({ call: { id, kind, at: ins.data.started_at, by: me.handle, chat: c.id, topic: callTopic(id), joined: false }, ice: iceServers() });
  }

  if (!isUuid(b.call)) return json({ error: 'invalid' }, 400);
  const { data: call } = await db.from('chat_calls').select('id, chat_id, kind, started_at, answered, ended_at, started_by').eq('id', b.call).maybeSingle();
  if (!call) return json({ error: 'call_not_found' }, 404);
  const mem = await memberOf(db, call.chat_id as string, me.id);
  if (!mem || mem.role === 'banned') return json({ error: 'not_member' }, 403);

  if (a === 'join') {
    if (call.ended_at) return json({ error: 'call_ended' }, 410);
    const n = Number(b.peers);
    if (Number.isFinite(n) && n >= MAX_ON_CALL) return json({ error: 'call_full' }, 409);
    await db.from('chat_calls').update({ answered: true, alive_at: new Date().toISOString() }).eq('id', call.id);
    return json({ call: { id: call.id, kind: call.kind, at: call.started_at, chat: call.chat_id, topic: callTopic(call.id as string), joined: true }, ice: iceServers() });
  }

  if (a === 'ping') {
    if (!call.ended_at) await db.from('chat_calls').update({ alive_at: new Date().toISOString() }).eq('id', call.id);
    return json({ ok: true, ended: !!call.ended_at });
  }

  if (a === 'decline') {
    await broadcast([callTopic(call.id as string)], 'signal', { t: 'decline', from: me.handle });
    return json({ ok: true });
  }

  if (a === 'end') {
    if (b.last && !call.ended_at) {
      const done = await db.from('chat_calls').update({ ended_at: new Date().toISOString() }).eq('id', call.id).is('ended_at', null).select('id');
      if (done.data?.length) {
        const label = call.kind === 'video' ? 'video call' : 'voice call';
        const secs = Math.max(0, Math.min(86400, Number(b.secs) || 0));
        const answered = call.answered || secs > 0;
        await systemMsg(db, call.chat_id as string, answered ? `[[callend:${call.kind}]] ${label[0].toUpperCase() + label.slice(1)} · ${fmt(secs)}` : `[[callmiss:${call.kind}]] Missed ${label}`);
        // Stop the phones that are still ringing.
        const { data: ms } = await db.from('chat_members').select('profile_id').eq('chat_id', call.chat_id).neq('profile_id', me.id).limit(50);
        await broadcast((ms || []).map((m) => ringTopic(m.profile_id as string)).filter((t): t is string => !!t), 'cancel', { call: call.id });
      }
    }
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
