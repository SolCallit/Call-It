'use client';
/**
 * Voice and video calls for Callit chats.
 *
 * Signalling (who's here, offers, answers, network candidates) goes over Supabase Realtime
 * broadcast on a per-call channel. Audio and video go straight between devices over WebRTC,
 * encrypted end to end, so Callit's servers never carry or see the media.
 *
 * Groups use a small mesh (everyone connects to everyone), capped at 6 people on the server.
 * The peer with the smaller id always makes the offer, so two people joining at once never collide.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Kind = 'audio' | 'video';
type Api = (path: string, o?: { body?: unknown }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type CallDeps = {
  api: Api;
  me: () => string;
  toast: (m: string) => void;
  avatar: (handle: string, cls?: string) => string;
  esc: (s: string) => string;
  chatLabel: (chatId: string) => string | null;
  chatFace: (chatId: string) => string;            // avatar / group sigil HTML
  isGroup: (chatId: string) => boolean;
  onChange?: () => void; // repaint "Join call" banners
};
type Ring = { call: string; chat: string; kind: Kind; from: string; name: string | null; avatar: string | null; title: string | null; group: boolean };
type Peer = { pc: RTCPeerConnection; handle: string; stream: MediaStream | null; queue: RTCIceCandidateInit[]; mic: boolean; cam: boolean; up: boolean };

const SVG = (d: string, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const CALL_ICONS = {
  phone: '<path d="M5 4h3.5l1.8 4.6-2.3 1.5a11 11 0 005.9 5.9l1.5-2.3L20 15.5V19a1.5 1.5 0 01-1.6 1.5A16.5 16.5 0 013.5 5.6 1.5 1.5 0 015 4z"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  end: '<path d="M3.2 14.6c-.8-.8-.7-2 .2-2.7C5.9 10 8.9 9 12 9s6.1 1 8.6 2.9c.9.7 1 1.9.2 2.7l-1.6 1.6c-.6.6-1.6.7-2.3.2l-1.9-1.4a1.5 1.5 0 01-.6-1.3v-1.6a12 12 0 00-4.8 0v1.6c0 .5-.2 1-.6 1.3l-1.9 1.4c-.7.5-1.7.4-2.3-.2z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  micOff: '<path d="M15 10.5V6a3 3 0 00-5.6-1.5M9 9v2a3 3 0 004.5 2.6M5.5 11a6.5 6.5 0 0010.4 5.2M18.5 11a6.4 6.4 0 01-.5 2.5M12 17.5V21M3 3l18 18"/>',
  camOff: '<path d="M15.5 10.5l6-3.5v10l-3-1.7M3 3l18 18M8 6h4.5a3 3 0 013 3v4.5M15.5 16a3 3 0 01-3 2H5.5a3 3 0 01-3-3V9a3 3 0 012.1-2.9"/>',
  flip: '<path d="M4 8.5A8.5 8.5 0 0119 6.4M20 15.5A8.5 8.5 0 015 17.6"/><path d="M19.5 3v3.6H16M4.5 21v-3.6H8"/>',
  min: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
  fill: '<path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>',
  fit: '<rect x="3" y="6" width="18" height="12" rx="2"/>',
};

let D: CallDeps | null = null;
let ringCh: RealtimeChannel | null = null, ringName = '';
let incoming: Ring | null = null, ringTone: { stop: () => void } | null = null, ringTimer = 0;

const S = {
  id: '', chat: '', kind: 'audio' as Kind, pid: '', ch: null as RealtimeChannel | null, ice: [] as RTCIceServer[],
  local: null as MediaStream | null, peers: new Map<string, Peer>(), mic: true, cam: true, facing: 'user' as 'user' | 'environment',
  t0: 0, tick: 0, ping: 0, noAnswer: 0, ending: false, caller: false, mini: false, title: '', group: false,
  // One-to-one video: the other person fills the screen and you sit in a small tile. Tap the small tile to swap.
  swap: false,
  // Picture depth: false = fill the screen (crops the edges), true = fit the whole picture (may show bars).
  fit: (() => { try { return localStorage.getItem('callit.callfit') === '1'; } catch { return false; } })(),
};
export const activeCallId = () => S.id;

/* ---------------- setup ---------------- */
export function initCalls(deps: CallDeps) {
  D = deps;
  window.addEventListener('beforeunload', () => { if (S.id) hangUp(); });
}

/** Listen for incoming calls on this person's private ring channel (name comes from the server). */
export function listenForCalls(topic: string | null | undefined) {
  const sb = supabaseBrowser();
  if (!topic || !sb || topic === ringName) return;
  if (ringCh) sb.removeChannel(ringCh);
  ringName = topic;
  ringCh = sb.channel(topic)
    .on('broadcast', { event: 'ring' }, ({ payload }) => onRing(payload as Ring))
    .on('broadcast', { event: 'cancel' }, ({ payload }) => { if (incoming && incoming.call === (payload as { call: string }).call) dismissIncoming(true); })
    .subscribe();
}

/* ---------------- start / join ---------------- */
export async function startCall(chatId: string, kind: Kind) {
  if (!D) return;
  if (S.id) return showUI();
  if (!canCall()) return;
  const stream = await getMedia(kind);
  if (!stream) return;
  try {
    const j = await D.api('/api/chat/call', { body: { action: 'start', chat: chatId, kind } });
    await enter(j.call, j.ice, stream, !j.call.joined);
  } catch (e) { stopStream(stream); D.toast(errText(e)); }
}

export async function joinCall(callId: string, kindHint?: Kind) {
  if (!D) return;
  if (S.id === callId) return showUI();
  if (S.id) return D.toast('You’re already on a call');
  if (!canCall()) return;
  const stream = await getMedia(kindHint || 'audio');
  if (!stream) return;
  try {
    const j = await D.api('/api/chat/call', { body: { action: 'join', call: callId } });
    if (!kindHint && j.call.kind === 'video') { // joined a video call with audio only: add the camera now
      const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints('user') }).catch(() => null);
      v?.getVideoTracks().forEach((t) => stream.addTrack(t));
    }
    await enter(j.call, j.ice, stream, false);
  } catch (e) { stopStream(stream); D.toast(errText(e)); }
}

function canCall() {
  if (!supabaseBrowser()) { D!.toast('Calls need Supabase Realtime (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)'); return false; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { D!.toast('This browser can’t make calls'); return false; }
  return true;
}
const videoConstraints = (facing: string): MediaTrackConstraints => ({ facingMode: facing, width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } });
async function getMedia(kind: Kind): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: kind === 'video' ? videoConstraints('user') : false,
    });
  } catch (e) {
    const n = (e as Error).name;
    D!.toast(n === 'NotAllowedError' ? `Allow the ${kind === 'video' ? 'camera and microphone' : 'microphone'} to call` : n === 'NotFoundError' ? `No ${kind === 'video' ? 'camera' : 'microphone'} found` : 'Couldn’t start your microphone');
    return null;
  }
}
function errText(e: unknown) {
  const m = String((e as Error)?.message || e || '');
  return ({ call_full: 'This call is full (6 people max)', call_ended: 'That call has ended', call_not_found: 'That call has ended', calls_not_ready: 'Calls aren’t switched on yet (run migration 0014 in Supabase)', not_member: 'You’re not in this chat' } as Record<string, string>)[m] || m || 'Couldn’t connect the call';
}

async function enter(call: { id: string; chat: string; kind: Kind; topic: string }, ice: RTCIceServer[], stream: MediaStream, caller: boolean) {
  const sb = supabaseBrowser()!;
  Object.assign(S, { id: call.id, chat: call.chat, kind: call.kind, ice, local: stream, caller, mic: true, cam: call.kind === 'video', facing: 'user', t0: 0, ending: false, mini: false });
  S.pid = D!.me() + '~' + Math.random().toString(36).slice(2, 8);
  S.title = D!.chatLabel(call.chat) || 'Call';
  S.group = D!.isGroup(call.chat);
  dismissIncoming(false);
  showUI();
  S.ch = sb.channel(call.topic, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as Sig))
    .subscribe((st) => {
      if (st === 'SUBSCRIBED') send({ t: 'hello', from: S.pid, handle: D!.me() });
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { D!.toast('Couldn’t reach the call server. Check Supabase Realtime is on.'); hangUp(); }
    });
  S.ping = window.setInterval(() => { D!.api('/api/chat/call', { body: { action: 'ping', call: S.id } }).catch(() => {}); }, 20000);
  S.tick = window.setInterval(paintStatus, 1000);
  // Nobody picks up in 45s: it's a missed call.
  S.noAnswer = window.setTimeout(() => { if (!connected()) { D!.toast(caller ? 'No answer' : 'Nobody else is on this call'); hangUp(); } }, 45000);
  D!.onChange?.();
}

/* ---------------- signalling ---------------- */
type Sig = { t: string; from: string; to?: string; handle?: string; sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit; mic?: boolean; cam?: boolean };
const send = (p: Sig) => S.ch?.send({ type: 'broadcast', event: 'signal', payload: p });
const early = new Map<string, RTCIceCandidateInit[]>(); // candidates that beat the offer here
const connected = () => [...S.peers.values()].some((p) => p.up);

async function onSignal(m: Sig) {
  if (!S.id || m.from === S.pid || (m.to && m.to !== S.pid)) return;
  if (m.t === 'decline') { if (!connected() && !m.to) { D!.toast(`@${m.from} declined`); if (!isGroup()) hangUp(); } return; }
  if (m.t === 'hello') {
    if (S.peers.has(m.from)) return;
    if (S.pid < m.from) await makeOffer(m.from, m.handle || handleOf(m.from));
    else if (!m.to) send({ t: 'hello', from: S.pid, to: m.from, handle: D!.me() }); // let the smaller id offer
    return;
  }
  if (m.t === 'offer' && m.sdp) {
    const p = S.peers.get(m.from) || peer(m.from, m.handle || handleOf(m.from));
    await p.pc.setRemoteDescription(m.sdp);
    flush(p);
    const ans = await p.pc.createAnswer();
    await p.pc.setLocalDescription(ans);
    send({ t: 'answer', from: S.pid, to: m.from, sdp: p.pc.localDescription!.toJSON() });
    sendState(m.from);
    return;
  }
  const p = S.peers.get(m.from);
  if (!p) { if (m.t === 'ice' && m.c) (early.get(m.from) || early.set(m.from, []).get(m.from)!).push(m.c); return; }
  if (m.t === 'answer' && m.sdp) { await p.pc.setRemoteDescription(m.sdp).catch(() => {}); flush(p); sendState(m.from); }
  else if (m.t === 'ice' && m.c) { if (p.pc.remoteDescription) p.pc.addIceCandidate(m.c).catch(() => {}); else p.queue.push(m.c); }
  else if (m.t === 'state') { p.mic = m.mic !== false; p.cam = m.cam !== false; paintTiles(); }
  else if (m.t === 'bye') { dropPeer(m.from); if (!S.peers.size && !isGroup() && S.t0) hangUp(); }
}
const handleOf = (pid: string) => pid.split('~')[0];
const isGroup = () => S.group;
function flush(p: Peer) { p.queue.splice(0).forEach((c) => p.pc.addIceCandidate(c).catch(() => {})); }
function sendState(to?: string) { send({ t: 'state', from: S.pid, to, mic: S.mic, cam: S.cam }); }

function peer(pid: string, handle: string): Peer {
  const pc = new RTCPeerConnection({ iceServers: S.ice, bundlePolicy: 'max-bundle' });
  const p: Peer = { pc, handle, stream: null, queue: early.get(pid) || [], mic: true, cam: true, up: false };
  early.delete(pid);
  S.peers.set(pid, p);
  S.local?.getTracks().forEach((t) => pc.addTrack(t, S.local!));
  if (S.kind === 'video' && !S.local?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'ice', from: S.pid, to: pid, c: e.candidate.toJSON() }); };
  pc.ontrack = (e) => { p.stream = e.streams[0] || new MediaStream([e.track]); paintTiles(); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') { p.up = true; if (!S.t0) { S.t0 = Date.now(); clearTimeout(S.noAnswer); stopTone(); } }
    if (st === 'failed') { pc.restartIce?.(); if (!p.up) D!.toast('Can’t connect on this network. A TURN relay fixes this on mobile data.'); }
    if (st === 'closed') dropPeer(pid);
    paintTiles(); paintStatus();
  };
  paintTiles();
  return p;
}
async function makeOffer(pid: string, handle: string) {
  const p = peer(pid, handle);
  const off = await p.pc.createOffer();
  await p.pc.setLocalDescription(off);
  send({ t: 'offer', from: S.pid, to: pid, handle: D!.me(), sdp: p.pc.localDescription!.toJSON() });
}
function dropPeer(pid: string) {
  const p = S.peers.get(pid);
  if (!p) return;
  try { p.pc.close(); } catch { /* already closed */ }
  S.peers.delete(pid);
  paintTiles(); paintStatus();
}

/* ---------------- controls ---------------- */
export function hangUp() {
  if (!S.id || S.ending) return;
  S.ending = true;
  const secs = S.t0 ? Math.round((Date.now() - S.t0) / 1000) : 0;
  const last = !connected();
  send({ t: 'bye', from: S.pid });
  D?.api('/api/chat/call', { body: { action: 'end', call: S.id, secs, last } }).catch(() => {});
  S.peers.forEach((_, pid) => dropPeer(pid));
  stopStream(S.local);
  if (S.ch) supabaseBrowser()?.removeChannel(S.ch);
  [S.tick, S.ping].forEach(clearInterval); clearTimeout(S.noAnswer);
  stopTone();
  Object.assign(S, { id: '', chat: '', ch: null, local: null, t0: 0 });
  early.clear();
  const el = document.getElementById('callui');
  if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 220); }
  D?.onChange?.();
}
function toggleMic() { S.mic = !S.mic; S.local?.getAudioTracks().forEach((t) => (t.enabled = S.mic)); sendState(); paintControls(); paintTiles(); }
function toggleCam() {
  if (S.kind !== 'video') return;
  S.cam = !S.cam; S.local?.getVideoTracks().forEach((t) => (t.enabled = S.cam)); sendState(); paintControls(); paintTiles();
}
async function flipCam() {
  if (S.kind !== 'video' || !S.local) return;
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(S.facing) }).catch(() => null);
  const nt = v?.getVideoTracks()[0];
  if (!nt) return D!.toast('Only one camera on this device');
  const old = S.local.getVideoTracks()[0];
  S.peers.forEach((p) => p.pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(nt));
  if (old) { S.local.removeTrack(old); old.stop(); }
  S.local.addTrack(nt); nt.enabled = S.cam;
  paintTiles();
}
const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/* ---------------- incoming ---------------- */
function onRing(r: Ring) {
  if (!D) return;
  if (S.id) { D.toast(`@${r.from} is calling you`); return; }
  incoming = r;
  const el = document.createElement('div');
  el.id = 'callring';
  el.className = 'callring';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', `Incoming ${r.kind === 'video' ? 'video' : 'voice'} call from @${r.from}`);
  const av = r.avatar ? `<span class="av xl" style="background:#0B1B27 url(${D.esc(r.avatar)}) center/cover"></span>` : D.avatar(r.from, 'xl');
  el.innerHTML = `<div class="crcard"><div class="crav"><i></i><i></i>${av}</div>
   <div class="crwho"><span class="crkind">${SVG(r.kind === 'video' ? CALL_ICONS.video : CALL_ICONS.phone, 14)} Incoming ${r.kind === 'video' ? 'video' : 'voice'} call</span>
   <b>${D.esc(r.name || '@' + r.from)}</b><em>${r.group ? 'in ' + D.esc(r.title || 'your group') : '@' + D.esc(r.from)}</em></div>
   <div class="crbtns"><button class="cbtn red" data-cring="no" aria-label="Decline">${SVG(CALL_ICONS.end, 26)}<span>Decline</span></button>
   <button class="cbtn green" data-cring="yes" aria-label="Accept">${SVG(r.kind === 'video' ? CALL_ICONS.video : CALL_ICONS.phone, 26)}<span>Accept</span></button></div></div>`;
  document.getElementById('callring')?.remove();
  document.body.appendChild(el);
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('[data-cring]') as HTMLElement | null;
    if (!b || !incoming) return;
    const ring = incoming;
    if (b.dataset.cring === 'yes') joinCall(ring.call, ring.kind);
    else { D!.api('/api/chat/call', { body: { action: 'decline', call: ring.call } }).catch(() => {}); dismissIncoming(true); }
  };
  ringTone = tone('in');
  try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* not supported */ }
  clearTimeout(ringTimer);
  ringTimer = window.setTimeout(() => dismissIncoming(true), 45000);
}
function dismissIncoming(missed: boolean) {
  clearTimeout(ringTimer);
  stopTone();
  const el = document.getElementById('callring');
  if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 200); }
  if (missed && incoming) D?.toast(`Missed call from @${incoming.from}`);
  incoming = null;
}

/* Ringtones from the Web Audio API: no files to download. */
function tone(kind: 'in' | 'out') {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    let alive = true;
    const beep = () => {
      if (!alive) return;
      const g = ac.createGain(); g.connect(ac.destination);
      const freqs = kind === 'in' ? [880, 1046] : [440];
      freqs.forEach((f, i) => {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g);
        const t = ac.currentTime + i * 0.18; o.start(t); o.stop(t + 0.16);
      });
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(kind === 'in' ? 0.18 : 0.08, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (kind === 'in' ? 0.36 : 0.9));
    };
    beep();
    const iv = window.setInterval(beep, kind === 'in' ? 1400 : 3000);
    return { stop: () => { alive = false; clearInterval(iv); ac.close().catch(() => {}); } };
  } catch { return null; }
}
function stopTone() { ringTone?.stop(); ringTone = null; }

/* ---------------- call screen ---------------- */
function showUI() {
  let el = document.getElementById('callui');
  if (el) { el.classList.remove('mini'); S.mini = false; return; }
  el = document.createElement('div');
  el.id = 'callui';
  el.className = 'callui' + (S.kind === 'video' ? ' vid' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Call');
  el.innerHTML = `<div class="cuhead"><button class="cuib" data-cu="min" aria-label="Minimize call">${SVG(CALL_ICONS.min, 18)}</button>
   <div class="cutitle"><b>${D!.esc(S.title)}</b><span id="custat">${S.caller ? 'Ringing…' : 'Connecting…'}</span></div>${S.kind === 'video' ? '<button class="cuib cufit" id="cufit" data-cu="fit"></button>' : ''}<span class="cuenc" title="Encrypted device to device">${SVG('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>', 12)} E2E</span></div>
   <div class="cutiles" id="cutiles"></div>
   <video class="cuself" id="cuself" data-cu="swap" autoplay playsinline muted></video>
   <div class="cuctl" id="cuctl"></div>`;
  document.body.appendChild(el);
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('[data-cu]') as HTMLElement | null;
    if (!b) {
      if (S.mini) { showUI(); return; }
      // Swapped view: the other person is the small tile now, so tapping them puts them back full screen.
      if (S.swap && (e.target as HTMLElement).closest('.cutile')) { S.swap = false; paintTiles(); }
      return;
    }
    e.stopPropagation();
    ({
      min: () => { S.mini = true; el!.classList.add('mini'); }, mic: toggleMic, cam: toggleCam, flip: flipCam, end: hangUp,
      swap: () => { if (el!.classList.contains('solo')) { S.swap = !S.swap; paintTiles(); } },
      fit: () => { S.fit = !S.fit; try { localStorage.setItem('callit.callfit', S.fit ? '1' : '0'); } catch { /* storage blocked */ } paintTiles(); },
    } as Record<string, () => void>)[b.dataset.cu!]?.();
  };
  if (S.caller) ringTone = tone('out');
  paintControls(); paintTiles(); paintStatus();
}
function paintControls() {
  const el = document.getElementById('cuctl');
  if (!el) return;
  const vid = S.kind === 'video';
  el.innerHTML = `<button class="cbtn${S.mic ? '' : ' off'}" data-cu="mic" aria-pressed="${!S.mic}" aria-label="${S.mic ? 'Mute' : 'Unmute'}">${SVG(S.mic ? CALL_ICONS.mic : CALL_ICONS.micOff, 24)}<span>${S.mic ? 'Mute' : 'Muted'}</span></button>
   ${vid ? `<button class="cbtn${S.cam ? '' : ' off'}" data-cu="cam" aria-pressed="${!S.cam}" aria-label="${S.cam ? 'Turn camera off' : 'Turn camera on'}">${SVG(S.cam ? CALL_ICONS.video : CALL_ICONS.camOff, 24)}<span>${S.cam ? 'Camera' : 'Cam off'}</span></button>
   <button class="cbtn" data-cu="flip" aria-label="Switch camera">${SVG(CALL_ICONS.flip, 24)}<span>Flip</span></button>` : ''}
   <button class="cbtn red" data-cu="end" aria-label="End call">${SVG(CALL_ICONS.end, 24)}<span>End</span></button>`;
}
function paintStatus() {
  const el = document.getElementById('custat');
  if (!el) return;
  if (S.t0) {
    const s = Math.round((Date.now() - S.t0) / 1000), n = [...S.peers.values()].filter((p) => p.up).length;
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${n > 1 ? ` · ${n + 1} on call` : ''}`;
  } else el.textContent = S.peers.size ? 'Connecting…' : S.caller ? 'Ringing…' : 'Waiting for others…';
}
function paintTiles() {
  const box = document.getElementById('cutiles'), self = document.getElementById('cuself') as HTMLVideoElement | null;
  if (!box || !D) return;
  if (self) {
    if (self.srcObject !== S.local) self.srcObject = S.local;
    self.hidden = S.kind !== 'video' || !S.cam;
    self.classList.toggle('mirror', S.facing === 'user');
  }
  const peers = [...S.peers.entries()];
  box.dataset.n = String(Math.max(1, peers.length));
  // Layout: a one-to-one video call is full screen and upright; group calls keep the grid.
  const ui = document.getElementById('callui');
  if (ui) {
    const solo = S.kind === 'video' && peers.length <= 1;
    if (!solo || !S.cam || !peers.length) S.swap = false;
    ui.classList.toggle('solo', solo);
    ui.classList.toggle('swap', solo && S.swap);
    ui.classList.toggle('fit', S.fit);
    const fb = document.getElementById('cufit');
    if (fb) {
      fb.innerHTML = SVG(S.fit ? CALL_ICONS.fill : CALL_ICONS.fit, 18);
      fb.setAttribute('aria-label', S.fit ? 'Fill the screen' : 'Fit the whole picture');
      fb.title = S.fit ? 'Fill the screen' : 'Fit the whole picture';
    }
  }
  // Keep live <video> elements (re-creating them makes the picture flicker): add/remove tiles by peer id.
  const seen = new Set<string>();
  for (const [pid, p] of peers) {
    seen.add(pid);
    let t = box.querySelector(`[data-pid="${CSS.escape(pid)}"]`) as HTMLElement | null;
    if (!t) {
      t = document.createElement('div');
      t.className = 'cutile';
      t.dataset.pid = pid;
      t.innerHTML = `<video autoplay playsinline></video><div class="cuav"><i></i>${D.avatar(p.handle, 'xl')}</div><span class="cuname"></span>`;
      box.appendChild(t);
    }
    const v = t.querySelector('video') as HTMLVideoElement;
    if (p.stream && v.srcObject !== p.stream) { v.srcObject = p.stream; v.play().catch(() => {}); }
    const hasVid = S.kind === 'video' && p.cam && !!p.stream?.getVideoTracks().some((x) => x.readyState === 'live');
    t.classList.toggle('vidon', hasVid);
    t.classList.toggle('up', p.up);
    (t.querySelector('.cuname') as HTMLElement).innerHTML = `${p.mic ? '' : SVG(CALL_ICONS.micOff, 13)}@${D.esc(p.handle)}`;
  }
  box.querySelectorAll('.cutile').forEach((t) => { if (!seen.has((t as HTMLElement).dataset.pid!)) t.remove(); });
  let wait = box.querySelector('.cuwait') as HTMLElement | null;
  if (!peers.length) {
    if (!wait) { wait = document.createElement('div'); wait.className = 'cuwait'; box.appendChild(wait); }
    wait.innerHTML = `<div class="cuav ring"><i></i><i></i>${D.chatFace(S.chat)}</div>`;
  } else wait?.remove();
}

