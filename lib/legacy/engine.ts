// @ts-nocheck
/*
 * Callit app engine, ported as-is from the single-file prototype so the UI
 * behaves exactly the same. It runs only in the browser.
 *
 * Plan: as each feature gets real data (auth, calls, tokens, swaps...), its
 * screen moves out of this file into typed React components under /components
 * and its data into /lib. This file shrinks until it's gone.
 */
import { fetchFeed, fetchToken, fetchTokens, searchTokens, mountChart, fmtSmall } from '@/lib/market/client';
import { openImageEditor } from '@/lib/media/imageEditor';
import { walletBalances, swap as jupSwap, withdraw as doWithdraw, toBaseUnits, qrSvg, SOL_MINT, USDC_MINT, placeOrder, listOrders, cancelOrder, reportTxError } from '@/lib/wallet/client';
import { friendlyError, isUserCancel } from '@/lib/errors';

let booted = false;

export function bootCallit(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Post text: @mentions open profiles, #tags open the tag feed, $TICKERS open the token if we know it, links open in a new tab. */
const RICH_RE=/(https?:\/\/[^\s<>"']+)|(^|[^A-Za-z0-9_@#$&])([@#$])([A-Za-z0-9_]{1,40})/g;
function rich(txt){txt=String(txt||'');let out='',last=0;
 for(const m of txt.matchAll(RICH_RE)){const [all,url,pre='',sig,word]=m;out+=esc(txt.slice(last,m.index));last=m.index+all.length;
  if(url){const u=url.replace(/[.,!?)]+$/,''),tail=url.slice(u.length);out+=`<a class="rlink" href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u.replace(/^https?:\/\//,'').slice(0,40))}${u.replace(/^https?:\/\//,'').length>40?'…':''}</a>${esc(tail)}`;continue}
  out+=esc(pre);
  if(sig==='@'&&word.length<=30)out+=`<a class="mtn" href="#/profile/${esc(word)}">@${esc(word)}</a>`;
  else if(sig==='#'&&/[A-Za-z]/.test(word))out+=`<a class="htag" href="#/tag/${esc(word.toLowerCase())}">#${esc(word)}</a>`;
  else if(sig==='$'&&/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(word)){const up=word.toUpperCase(),t=Object.values(T).find(x=>x&&String(x.sym).toUpperCase()===up&&(x.live||x.base));out+=t?`<a class="htag" href="#/token/${esc(t.key)}">$${esc(word)}</a>`:`$${esc(word)}`}
  else out+=esc(sig+word)}
 return out+esc(txt.slice(last))}
function rng(seed){let s=(seed*2654435761)>>>0||1;return()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
const fmtUsd=n=>n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(n<1e4?1:0)+'K':'$'+n.toFixed(2);
const fmtPrice=p=>p>=1?'$'+p.toLocaleString(undefined,{maximumFractionDigits:2}):p>=0.01?'$'+p.toFixed(4):'$'+p.toPrecision(3);
const fmtPct=n=>(n>=0?'+':'−')+(Math.abs(n)>=1000?Math.round(Math.abs(n)).toLocaleString():Math.abs(n).toFixed(1))+'%';
const fmtAmt=n=>n>=1e6?(n/1e6).toFixed(2)+'M':n>=1000?Math.round(n).toLocaleString():(+n).toLocaleString(undefined,{maximumFractionDigits:4});
const fmtK=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1).replace('.0','')+'K':String(n);
const short=a=>a.slice(0,4)+'…'+a.slice(-4);
const hue=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return h};
let PROF={};try{PROF=JSON.parse(localStorage.getItem('callit.profile')||'{}')||{}}catch(_){}
const saveProf=()=>{try{localStorage.setItem('callit.profile',JSON.stringify(PROF));return true}catch(_){return false}};
const avatar=(h,cls='')=>(h===S.me&&PROF.avatar||AVURL[h])?`<span class="av ${cls}" style="background:#0B1B27 url(${h===S.me&&PROF.avatar||AVURL[h]}) center/cover" role="img" aria-label="${esc(h)}"></span>`:`<span class="av ${cls}" style="background:hsl(${(hue(h)%70)+185} 52% 42%)">${esc(h.slice(0,2).toUpperCase())}</span>`;
const isPrem=h=>h===S.me&&S.premium&&S.premium.until>Date.now();
const vbadge=h=>isPrem(h)||h==='callit'?`<span class="vb" title="Callit Premium">${ic('verified',17)}</span>`:'';
const bannerBg=h=>h===S.me&&PROF.banner?`background:#0B1B27 url(${PROF.banner}) center/cover`:`background:linear-gradient(120deg,hsl(${(hue(h)%70)+185} 55% 26%),#0B1B27 70%),#0B1B27`;
const followingOf=h=>h===S.me?[...S.following]:ranked().map(c=>c.h).filter(x=>x!==h).slice(0,(hue(h)%3)+2);
const followersOf=h=>h===S.me?[]:ranked().map(c=>c.h).filter(x=>x!==h&&(S.following.has(x)||hue(x+h)%2===0)).concat(S.following.has(h)&&S.me?[S.me]:[]);
function shrink(file,max,cb){const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);cb(c.toDataURL('image/jpeg',.82))};im.src=r.result};r.readAsDataURL(file)}
/* Token icons: a small resized copy from an image CDN loads far faster than raw IPFS. Falls back to the original, then our proxy, then initials. */
const ipfsU=u=>String(u||'').replace(/^ipfs:\/\/(ipfs\/)?/,'https://ipfs.io/ipfs/');
const cdnIcon=(u,w=64)=>{u=ipfsU(u);return /^https:\/\//.test(u)&&!/wsrv\.nl/.test(u)?`https://wsrv.nl/?url=${encodeURIComponent(u)}&w=${w}&h=${w}&fit=cover&output=webp&n=-1&maxage=7d`:u};
window.__cimg=el=>{const a=(el.dataset.alt||'').split('|').filter(Boolean);if(a.length){el.dataset.alt=a.slice(1).join('|');el.src=a[0]}else el.remove()};
const tokav=s=>{const t=T[s],lab=t&&t.sym?t.sym:String(s),ca=t&&(t.ca||t.key),mint=isMintStr(ca)?ca:(isMintStr(s)?s:''),icon=t&&t.icon;
 const prox=mint?'/api/market/icon/'+mint:'',srcs=(icon?[cdnIcon(icon),ipfsU(icon),prox]:prox?[cdnIcon(location.origin+prox),prox]:[]).filter((x,i,a)=>x&&a.indexOf(x)===i);
 return srcs.length?`<span class="tokav img" style="background:hsl(${hue(lab)} 58% 45%)"><i>${esc(lab.slice(0,3))}</i><img src="${esc(srcs[0])}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-alt="${esc(srcs.slice(1).join('|'))}" onerror="__cimg(this)"></span>`
  :`<span class="tokav" style="background:hsl(${hue(lab)} 58% 45%)">${esc(lab.slice(0,3))}</span>`};
const symOf=k=>T[k]&&T[k].sym||k;

const P={
 grip:'<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
 pin:'<path d="M9 3h6l-1 6 3 3v1H7v-1l3-3-1-6z"/><path d="M12 13v8"/>',
 cog:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
 home:'<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
 more:'<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
 link:'<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
 list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
 mute:'<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
 block:'<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
 market:'<path d="M5 20V11M12 20V5M19 20v-8"/>',
 trenches:'<path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2.7 1.6-4 2-6 1 1.2 2 2 3 2 0-2.5-.8-4 0-6z"/>',
 swap:'<path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"/>',
 stake:'<path d="M12 4l9 5-9 5-9-5 9-5zM3 14l9 5 9-5"/>',
 wallet:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2"/>',
 profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
 messages:'<path d="M4 5h16v11H9l-5 4V5z"/>',
 news:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
assistant:'<path d="M11 3.5l1.8 4.7 4.7 1.8-4.7 1.8L11 16.5l-1.8-4.7L4.5 10l4.7-1.8z"/><path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
 promote:'<path d="M3 10v4l3 .5V9.5L3 10zM6 9.5l11-5v15l-11-5M9 15l1.5 5h3l-1-4.2"/>',
 about:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
 leaderboard:'<path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8"/>',
 search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
 settings:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 bell:'<path d="M6 16v-5a6 6 0 0112 0v5l2 2H4l2-2zM10 21h4"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 chev:'<path d="M15 6l-6 6 6 6"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 reply:'<path d="M4 5h16v11H9l-5 4V5z"/>',
 repost:'<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
 heart:'<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
 views:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 share:'<path d="M12 4v11M7 9l5-5 5 5M5 20h14"/>',
 star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
 x:'<path d="M6 6l12 12M18 6L6 18"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 xlogo:'<path d="M4 4h4.2l4.3 5.8L17.6 4H20l-6.3 7.3L20.5 20h-4.2l-4.7-6.3L6 20H3.6l6.9-7.9z" fill="currentColor" stroke="none"/>',
 globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
 people:'<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c.8-3 3.2-5 6-5s5.2 2 6 5M15 15.5c2.5 0 4.5 1.5 5.5 4"/>',
 sprout:'<path d="M12 21V11M12 11c0-4-3-6-7-6 0 4 3 6 7 6zM12 13c0-3.5 2.5-5.5 7-5.5 0 3.5-2.5 5.5-7 5.5z"/>',
 target:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
 sniper:'<path d="M6 11a6 6 0 0112 0v2H6z"/><path d="M8 13v5h8v-5"/>',
 crown:'<path d="M4 18l-1-10 5 4 4-7 4 7 5-4-1 10z"/>',
 filter:'<path d="M4 6h16M7 12h10M10 18h4"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
 up:'<path d="M6 15l6-6 6 6"/>',
 back:'<path d="M19 12H5M11 18l-6-6 6-6"/>',
 discord:'<path d="M8.5 5.5c-1.8.3-3.3.9-4.5 1.8C2.6 10 2 13 2.2 16.3c1.4 1.2 3 2 4.8 2.4l1.1-1.8c-.8-.3-1.5-.7-2.1-1.2.2-.1.3-.2.5-.3 3.4 1.6 7.6 1.6 11 0l.5.3c-.6.5-1.3.9-2.1 1.2l1.1 1.8c1.8-.4 3.4-1.2 4.8-2.4.3-3.8-.6-6.8-2-9-1.2-.9-2.7-1.5-4.5-1.8l-.5 1c-1.8-.3-3.5-.3-5.4 0z" fill="currentColor" stroke="none"/><circle cx="9" cy="12.5" r="1.5" fill="var(--bg2)" stroke="none"/><circle cx="15" cy="12.5" r="1.5" fill="var(--bg2)" stroke="none"/>',
 telegram:'<path d="M21.5 4.2L2.8 11.4c-1 .4-1 1.6 0 1.9l4.6 1.5 1.8 5.4c.3.8 1.3 1 1.9.4l2.6-2.5 4.8 3.5c.7.5 1.7.1 1.9-.8L23 5.6c.2-1-.6-1.8-1.5-1.4zM9.6 14.4l8.3-6.2-6.6 7.3-.3 3.2-1.4-4.3z" fill="currentColor" stroke="none"/>',
 image:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
 smile:'<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/>',
 verified:'<path d="M12 2.5l2.4 1.8 3-.1.9 2.8 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.8-3-.1L12 21.5l-2.4-1.8-3 .1-.9-2.8-2.4-1.8 1-2.8-1-2.8 2.4-1.8.9-2.8 3 .1z" fill="currentColor" stroke="none"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.2" fill="none"/>',
 camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
 pen:'<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
 lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
 down:'<path d="M6 9l6 6 6-6"/>',
 solglyph:'<path d="M6 6h14l-2 3H4zM6 15h14l-2 3H4zM4 10.5h14l2 3H6z" fill="currentColor" stroke="none"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
 bookmark:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
 bookmarks:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
 draft:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
 rotate:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
 zoom:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'
};
const ic=(k,s=22,fill=false)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="${fill?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

/* ---------- mock data ---------- */
const T={
 SOL:{sym:'SOL',name:'Solana',chain:'Solana',price:142.3,supply:0,chg:1.2,ca:'So11111111111111111111111111111111111111112',seed:1,base:true},
 USDC:{sym:'USDC',name:'USD Coin',chain:'Solana',price:1,supply:0,chg:0,ca:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',seed:2,base:true},
 GLORP:{sym:'GLORP',name:'Glorp',chain:'Solana',price:0.00184,supply:1e9,liq:212e3,vol:3.1e6,holders:4120,age:'3 days',ageH:72,chg:38.2,ca:'7xKpQ2mZr8Hc3vLwN5aYt1BfGdE9sUoJk4XqP6G1rP',seed:3},
 MOTH:{sym:'MOTH',name:'Lampmoth',chain:'Solana',price:0.000412,supply:1e9,liq:98e3,vol:840e3,holders:1880,age:'19 hours',ageH:19,chg:-12.4,ca:'4hRtW9cVn2LkQ8sPzJ3mYbX7aE5uFdG1oK6iNtM0tH',seed:7},
 KFSH:{sym:'KFSH',name:'Kingfish',chain:'Solana',price:0.0214,supply:1e9,liq:1.2e6,vol:5.8e6,holders:15300,age:'41 days',ageH:984,chg:6.8,ca:'9KfShX2pLm4Qr7tVw1ZyN8bC3dE5gH6jK0aS9uFiSh',seed:11},
 DOTB:{sym:'DOTB',name:'dotbook',chain:'Solana',price:0.0000524,supply:1e9,liq:31e3,vol:210e3,holders:640,age:'6 hours',ageH:6,chg:112.5,ca:'5dOtBkQ7mN2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dOt',seed:13},
 ORBIT:{sym:'ORBIT',name:'Orbit Protocol',chain:'Base',price:0.37,supply:1e8,liq:2.4e6,vol:1.1e6,holders:9800,age:'120 days',ageH:2880,chg:3.1,ca:'0x4f1a9c2b7e3d8f6a5b0c1d2e3f4a5b6c7d8e9f0a',seed:5},
 NEBU:{sym:'NEBU',name:'Nebula',chain:'Ethereum',price:0,supply:0,chg:0,prelaunch:'Oct 14',ca:'0xnebula-prelaunch',seed:9},
 NIMB:{sym:'NIMB',name:'Nimbus Agent',chain:'Solana',price:0.00131,supply:1e9,liq:96e3,vol:1.9e6,holders:3600,age:'13 hours',ageH:13,chg:64.2,ca:'NimBu5AgQ7mN2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dN',seed:17,hot:1,soc:'xw'},
 BSHK:{sym:'BSHK',name:'Harbor Shark',chain:'Solana',price:0.0012,supply:1e9,liq:180e3,vol:1e6,holders:2000,age:'10 days',ageH:240,chg:22.1,ca:'HaRb0rShk2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dSk',seed:19,hot:1,soc:''},
 KOI:{sym:'KOI',name:'Neon Koi',chain:'Solana',price:0.0000581,supply:1e9,liq:22e3,vol:669e3,holders:847,age:'4 hours',ageH:4,chg:-8.4,ca:'NeonKoi7mN2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dKo',seed:23,hot:1,soc:'xw'},
 SAND:{sym:'SAND',name:'Sand Kitten',chain:'Solana',price:0.0061,supply:1e9,liq:410e3,vol:2e6,holders:2000,age:'5 days',ageH:120,chg:4.7,ca:'SaNdKit7mN2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dSd',seed:29,soc:''},
 FROG:{sym:'FROG',name:'Soggy Frog',chain:'Solana',price:0.0000304,supply:1e9,liq:14e3,vol:91e3,holders:270,age:'7 minutes',ageH:0.12,chg:31.5,ca:'SoGgyFr0g2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dFg',seed:31,soc:'xw'},
 PUP:{sym:'PUP',name:'Pixel Pup',chain:'Solana',price:0.0000142,supply:1e9,liq:9e3,vol:15e3,holders:87,age:'33 seconds',ageH:0.01,chg:12.2,ca:'PixeLPup2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dPp',seed:37,soc:'xw'},
 WORM:{sym:'WORM',name:'Wagmi Worm',chain:'Solana',price:0.0000089,supply:1e9,liq:7e3,vol:26e3,holders:63,age:'57 seconds',ageH:0.016,chg:-4.1,ca:'WaGmiW0rm2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dWm',seed:41,soc:'xw'},
 PAIN:{sym:'PAIN',name:'Paincoin',chain:'Solana',price:0.0000119,supply:1e9,liq:8e3,vol:22e3,holders:79,age:'4 minutes',ageH:0.07,chg:9.3,ca:'PaiNc0in2pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dPn',seed:43,soc:'cxw'},
 QRC:{sym:'QRC',name:'QR Cat',chain:'Solana',price:0.0000658,supply:1e9,liq:30e3,vol:851e3,holders:1200,age:'2 hours',ageH:2,chg:-15.7,ca:'QrCaTqr02pLx9vR4sW1cZ8yT3uE6gH0jK5aF2dQr',seed:47,soc:'cx'},};
const mcap=t=>t.price*t.supply;
for(const k in T)T[k].key=k;
/* ---------- live market data ---------- */
const LIVE={feeds:{},err:{},busy:{},tokErr:{},tokBusy:{},at:{}};
const LIVEMAP={};
const hashStr=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h%997+1};
const ageLong=h=>h<1/60?'just now':h<1?Math.round(h*60)+' min':h<48?Math.round(h)+(Math.round(h)===1?' hour':' hours'):Math.round(h/24)+' days';
const isMintStr=s=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s||'');
const LPNAME=s=>{s=String(s||'').toLowerCase();return s.includes('pump')?'Pump':s.includes('bonk')?'Bonk':s.includes('believe')?'Believe':s.includes('moonshot')?'Moonshot':s.includes('launchlab')||s.includes('raydium')?'Launchlab':s.includes('bags')?'Bags':s.includes('jup')?'Jup Studio':s.includes('meteora')||s.includes('dbc')||s.startsWith('met')?'Meteora':s.includes('boop')?'Boop':null};
function regLive(x){if(!x||!x.mint)return null;const o=T[x.mint]||{},price=x.price||0,ageH=x.createdAt?Math.max(0,(Date.now()-Date.parse(x.createdAt))/36e5):null;
 Object.assign(o,{key:x.mint,sym:x.sym,name:x.name,chain:'Solana',price,supply:price&&x.mc?x.mc/price:(o.supply||0),liq:x.liq||0,vol:x.vol24||0,holders:x.holders||0,
  ageH:ageH==null?9999:ageH,age:ageH==null?'—':ageLong(ageH),chg:x.chg.h24!=null?x.chg.h24:(x.chg.h1||0),ca:x.mint,seed:o.seed||hashStr(x.mint),live:1,icon:x.icon||o.icon,
  pool:x.pool||o.pool||null,lp:LPNAME(x.launchpad)||(/pump$/.test(x.mint)?'Pump':/bonk$/.test(x.mint)?'Bonk':null),
  soc:(x.socials.x?'x':'')+(x.socials.web?'w':'')+(x.socials.tg?'c':''),L:{...(o.L||{}),...x,pool:x.pool||(o.L&&o.L.pool)||null}});
 if(x.holders){const n=Date.now(),hh=(o._hh||[]).filter(p=>n-p[0]<3e5);if(!hh.length||n-hh[hh.length-1][0]>5e3)hh.push([n,x.holders]);o._hh=hh}
 if(price){const n=Date.now(),h=(o._ph||[]).filter(p=>n-p[0]<3.7e5);if(!h.length||n-h[h.length-1][0]>1500)h.push([n,price]);o._ph=h}
 if(o.icon&&!o._pre){o._pre=1;try{const im=new Image();im.decoding='async';im.src=cdnIcon(o.icon)}catch(_){}}
 delete o._x;T[x.mint]=o;return o}
/* Engine feeds -> live lists. almost/grad are built from the newest + trending lists. */
/* Timeframes for % change: drives Movers ranking, row % and the min-change filter. */
const TF_OK=['1m','5m','1h','6h','24h'],TFK={'1m':'m1','5m':'m5','1h':'h1','6h':'h6','24h':'h24'};
/* 1m change isn't in the data feeds, so it comes from the live prices we've seen in the last ~75s. */
const chg5mLive=t=>{const h=t&&t._ph;if(!h||h.length<2)return null;const z=h[h.length-1],b=h.find(p=>z[0]-p[0]<=3e5);return !b||z[0]-b[0]<2.4e5||!b[1]?null:(z[1]/b[1]-1)*100};
const chg1m=t=>{const h=t&&t._ph;if(!h||h.length<2)return null;const z=h[h.length-1],b=h.find(p=>z[0]-p[0]<=75e3);return !b||z[0]-b[0]<2e4||!b[1]?null:(z[1]/b[1]-1)*100};
const chgOf=(t,tf)=>{if(!t)return null;if(tf==='1m')return chg1m(t);const c=t.L&&t.L.chg,v=c?c[TFK[tf]||'h24']:null;return v!=null?v:(!t.live||tf==='24h'?t.chg:null)};
const byChg=tf=>(a,b)=>{const x=chgOf(a,tf),y=chgOf(b,tf);return (y==null?-1e9:y)-(x==null?-1e9:x)};
const lfIds=(k,f)=>{const tf0=TF_OK.includes(f&&f.tf)?f.tf:'1h',tf=tf0==='1m'?'5m':tf0;
 return ({movers:['movers:'+tf],new:['new'],crowded:['traded:24h'],almost:['new','movers:5m'],grad:['movers:'+tf,'new'],og:['ogset']})[k]||null};
const LF={movers:['movers:1h'],new:['new'],crowded:['traded:24h'],almost:['new','movers:5m'],grad:['movers:1h','new'],og:['ogset']};
/* OG memes: the established Solana memecoins, by mint. Anything that isn't a meme stays out. */
const OG_MEMES=['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263','EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm','7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
 '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump','2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump','ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5','ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY','CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
 '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv','6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN','63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9',
 '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3','HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4','Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump'];
const OGSET=new Set(OG_MEMES);
/* Majors, stables and staked SOL aren't memecoins: keep them out of OG memes. */
const NOT_MEME=new Set(['SOL','WSOL','USDC','USDT','USDS','PYUSD','USD1','EURC','JUP','JTO','PYTH','RAY','ORCA','JLP','JITOSOL','MSOL','BSOL','INF','JUPSOL','BNSOL','WBTC','CBBTC','ZBTC','WETH','ETH','BTC','HNT','RENDER','RNDR','W','KMNO','DRIFT','MEW_NOT']);

/* ---------- PumpPortal: pump.fun + Bonk launches and migrations, live, over ONE shared websocket ---------- */
let PP=null,PPN=0,PPR=0;const PPKEYS=[];
const ppWant=()=>currentRoute()==='market'&&!document.hidden;
function ppConnect(){if(PP||!ppWant()||typeof WebSocket==='undefined')return;let w;try{w=new WebSocket('wss://pumpportal.fun/api/data')}catch(_){return}PP=w;
 w.onopen=()=>{PPN=0;w.send(JSON.stringify({method:'subscribeNewToken'}));w.send(JSON.stringify({method:'subscribeMigration'}))};
 w.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch(_){return}if(!d||!isMintStr(d.mint))return;if(d.txType==='create')ppNew(d);else if(d.txType==='migrate'||d.txType==='migration')ppMig(d)};
 w.onclose=()=>{if(PP===w)PP=null;if(ppWant())setTimeout(ppConnect,Math.min(3e4,1e3*2**PPN++))};w.onerror=()=>{try{w.close()}catch(_){}}}
function ppClose(){const w=PP;PP=null;if(w){w.onclose=null;try{w.close()}catch(_){}}}
function ppNew(d){const sp=(T.SOL||{}).price||0;if(!sp)return;const mc=(+d.marketCapSol||0)*sp,price=mc/1e9;if(!price)return;
 const t=regLive({mint:d.mint,sym:String(d.symbol||'?').slice(0,20),name:String(d.name||d.symbol||'New token').slice(0,60),icon:null,price,mc,fdv:mc,liq:(+d.vSolInBondingCurve||0)*sp,holders:1,vol24:(+d.solAmount||0)*sp,
  chg:{m5:null,h1:null,h6:null,h24:null},buys24:d.initialBuy?1:0,sells24:0,traders24:1,createdAt:new Date().toISOString(),pool:null,dex:null,verified:false,organic:null,
  audit:{mintOff:null,freezeOff:null,top10:null,dev:null,sus:false},socials:{x:null,web:null,tg:null},launchpad:d.pool==='bonk'?'bonk':'pump.fun',decimals:6,flow:null});
 if(!t)return;t._pp=Date.now();t._fx={c:'fx-new',u:Date.now()+3500};PPKEYS.unshift(d.mint);PPKEYS.length=Math.min(PPKEYS.length,80);
 LIVE.feeds['new']=[d.mint,...(LIVE.feeds['new']||[]).filter(k=>k!==d.mint)].slice(0,150);ppPaint()}
function ppMig(d){const t=T[d.mint];if(!t)return;t._mig=Date.now();t._fx={c:'fx-grad',lab:'🎓 Migrated',u:Date.now()+5200};ppPaint()}
function ppPaint(){if(PPR)return;PPR=setTimeout(()=>{PPR=0;if(currentRoute()==='market'&&!document.querySelector('.sheet.open')&&!document.querySelector('#modal .modal')&&!(document.activeElement&&document.activeElement.matches('input,textarea')))render()},900)}
setInterval(()=>{if(ppWant())ppConnect();else if(PP)ppClose()},2500);
function loadFeed(id){if(LIVE.busy[id])return;LIVE.busy[id]=1;const [feed,iv]=id.split(':');
 (feed==='ogset'?fetchTokens(OG_MEMES):fetchFeed(feed,iv||'1h')).then(list=>{let ks=list.map(regLive).filter(Boolean).map(t=>t.key);if(id==='new'){const j=new Set(ks);ks=[...PPKEYS.filter(k=>!j.has(k)&&T[k]&&Date.now()-T[k]._pp<9e5),...ks]}LIVE.feeds[id]=ks;LIVE.err[id]=0})
  .catch(()=>{LIVE.err[id]=1}).finally(()=>{LIVE.busy[id]=0;LIVE.at[id]=Date.now();if(SH&&SH.kind==='f')drawSheet();else if(currentRoute()==='market'&&!document.querySelector('.sheet.open'))render();else if(['movers:1h','new','movers:5m'].includes(id)&&!document.querySelector('#rail .mbox')){drawRail();const el=$('#landing');if(el&&!el.hidden){const tk=el.querySelectorAll('.lxtick');if(tk[0])tk[0].outerHTML=lxTicker(lxLive(0),'');if(tk[1])tk[1].outerHTML=lxTicker(lxLive(1),' rev')}}})}
function loadLiveToken(mint,quiet){if(LIVE.tokBusy[mint])return;LIVE.tokBusy[mint]=1;
 fetchToken(mint).then(x=>{if(x){regLive(x);LIVE.tokErr[mint]=0;loadRisk(mint)}else LIVE.tokErr[mint]='gone'})
  .catch(()=>{LIVE.tokErr[mint]=LIVE.tokErr[mint]||'err'})
  .finally(()=>{LIVE.tokBusy[mint]=0;const [,r,p]=location.hash.split('/');if(r==='token'&&p===mint){if(quiet&&T[mint]){liveTick(T[mint]);if(!LCHART&&T[mint].pool&&$('#lchart')){const msg=$('#lchartmsg');if(msg){msg.hidden=false;msg.textContent='Loading chart…'}mountLiveChart()}}else render()}})}
const C={};
let calls=[];
/* Official Callit post, pinned to the top of For you so newcomers see how it works. */
const BOTPOST={id:'welcome',c:'callit',kind:'random',pinned:true,thesis:'Welcome to Callit 👋 Here\'s how it works. 1) Find a token in Market, or paste a contract address in Search. 2) Make a call: buy in with your own wallet and your entry is stamped at the live market cap. 3) Every call is tracked in public: win rate, returns and sells. Once a call holds 2X, the caller earns a share of fees on every buy it brings in, and a bigger share if they bought in. Call it. Get Paid.',ago:'1d',likes:0,reposts:0,replies:0,views:0};
const pinnedPost=()=>`<div class="pinwrap"><div class="pinlab">${ic('pin',13)} Pinned</div>${postRandom(BOTPOST)}</div>`;
const ADS=[
 {id:'vault',brand:'Vaultline',h:'vaultline',ic:'wallet',text:'Keep your bags cold. The pocket hardware wallet that signs Solana transactions in one tap.',title:'Vaultline Wallet',sub:'★★★★★ 2,140 reviews',cta:'Shop',g:['#1F7AE0','#0B1B27']},
 {id:'solstice',brand:'Solstice Card',h:'solsticecard',ic:'swap',text:'Spend USDC anywhere cards work. No top-ups, no waiting, 2% back in SOL.',title:'Spend crypto like cash',sub:'Solana · Visa debit',cta:'Get the card',g:['#0B9366','#0B1B27']},
 {id:'callit',brand:'Callit',h:'callit',ic:'promote',text:'Put your product in front of every trader on Callit. Ad slots and sponsored calls, always clearly labelled.',title:'Advertise on Callit',sub:'Ad board · Sponsored calls',cta:'Promote',href:'#/promote',g:['#16314A','#0B1B27']}
];
const AD_EVERY=3;
const S={connected:false,addr:'',me:'',tab:'foryou',tf:'1D',lb:'30d',following:new Set(),watch:new Set(['GLORP','ORBIT']),
 bal:{SOL:4.2,USDC:310,GLORP:120000},activity:[{k:'Received',d:'2 SOL',t:'Yesterday'}],
 swap:{from:'SOL',to:'GLORP',amt:''},pkg:'boost',queued:[],unread:true,adRot:0,board:0,tt:'new',dtab:'swap',ytab:(()=>{try{return localStorage.getItem('callit.ytab')==='profile'?'profile':'wallet'}catch(_){return 'wallet'}})()};
try{S.notifyOn=JSON.parse(localStorage.getItem('callit.notify')||'{}')||{}}catch(_){S.notifyOn={}}

/* ---------- persistence (Supabase via /api) ----------
 * Real sessions save everything to the user's account: posts, likes, reposts, replies,
 * follows, mutes, blocks, lists, watchlist, transactions and media. The UI updates
 * instantly; the server write happens in the background. */
Object.assign(S,{cat:(()=>{try{const v=localStorage.getItem('callit.cat');return ['all','meme','perps','random'].includes(v)?v:'all'}catch(_){return 'meme'}})(),
 muted:new Set(),blocked:new Set(),lists:[],followers:null,
 bm:(()=>{try{return new Set(JSON.parse(localStorage.getItem('callit.bm')||'[]'))}catch(_){return new Set()}})()});
const saveBm=()=>{try{localStorage.setItem('callit.bm',JSON.stringify([...S.bm]))}catch(_){}};
const PUB={},AVURL={},RLOADED={};let SYNCWARN=0;
async function API(path,o={}){const w=window.CallitWallet,tok=w&&w.token?await w.token().catch(()=>null):null,has=o.body!==undefined;
 const r=await fetch(path,{method:o.method||(has?'POST':'GET'),headers:{...(has?{'content-type':'application/json'}:{}),...(tok?{authorization:'Bearer '+tok}:{})},body:has?JSON.stringify(o.body):undefined,cache:'no-store'});
 const j=await r.json().catch(()=>({}));if(!r.ok){if(j.detail)console.error('[callit]',path,j.error,j.detail);throw new Error(apiErr(j,r.status))}return j}
/* Turn server error codes into something a person can act on (was showing raw "db_write" / "upload_failed"). */
function apiErr(j,st){const e=String(j.error||''),d=String(j.detail||'');
 {const col=/column "?([a-z_]+)"? .*does not exist|could not find the '([a-z_]+)' column/i.exec(d);if(col)return `Database is missing the “${col[1]||col[2]}” column. Run migration 0004 in Supabase.`}
 if(/relation .* does not exist|could not find the table/i.test(d))return 'Posting isn’t set up on the server yet (database tables missing).';
 if(/schema cache/i.test(d))return 'Database was just updated. Run migration 0004 in Supabase, then try again.';
 if(/bucket not found/i.test(d))return 'Image uploads aren’t set up on the server yet (media bucket missing).';
 if(/row-level security|permission denied/i.test(d))return 'The server isn’t allowed to save this (database permissions).';
 if(e==='unauthorized')return 'Your session expired. Sign in again.';
 if(e==='no_profile')return 'Finish setting up your profile, then try again.';
 if(e==='database_not_configured')return 'The database isn’t connected on the server.';
 if(e==='db_write'||e==='db_read'||e==='upload_failed')return d?`Couldn’t save: ${d}`:'Couldn’t save. Try again.';
 return e||`Request failed (${st})`}
function SYNC(){return realAuth()&&S.connected&&!!window.CallitWallet}
function bg(path,body,method){if(!SYNC())return Promise.resolve(null);
 return API(path,{body,method}).catch(e=>{console.warn('[callit] sync',path,e.message);if(!SYNCWARN++)toast('Couldn’t save that to your account. It’ll show until you reload');return null})}
async function upMedia(list,kind='post'){const out=[];for(const u of list||[]){if(/^https?:/.test(u)){out.push(u);continue}const r=await API('/api/media',{body:{data:u,kind}});out.push(r.url)}return out}
function liveAgo(o,at){if(!at)return o;o.at=at;Object.defineProperty(o,'ago',{configurable:true,enumerable:true,get(){const m=(Date.now()-o.at)/6e4;return m<1?'now':m<60?Math.round(m)+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d'}});return o}
/* Display names seen on posts/replies, so every feed shows "Name @handle" without a profile fetch each. */
const DN={};
AVURL.callit=AVURL.callit||'/icon-192.png';DN.callit=DN.callit||'Callit';
function nameOf(h){return h===S.me?(PROF.name||h):(PUB[h]&&!PUB[h].pending&&PUB[h].display_name)||DN[h]||h}
/* X-style author line: bold display name, verified badge, muted @handle. Tapping it opens the profile. */
function who(h){const n=nameOf(h);return `<a class="pwho" href="#/profile/${esc(h)}"><span class="pname">${esc(n)}</span>${vbadge(h)}${n!==h?`<span class="phandle">@${esc(h)}</span>`:''}</a>`}

/* server rows -> feed items */
function fromRow(r){if(!r||!r.handle)return null;if(r.avatar_url)AVURL[r.handle]=r.avatar_url;if(r.display_name)DN[r.handle]=r.display_name;
 if(!C[r.handle])C[r.handle]={h:r.handle,win:0,avg:0,calls:0,best:0,followers:0,real:1};
 const k={id:r.id,srv:1,c:r.handle,kind:r.kind,src:r.source||'app',srcLabel:r.source_label||'',peak:+r.peak_x||0,thesis:r.body||'',media:r.media||[],likes:r.likes||0,reposts:r.reposts||0,replies:r.replies||0,views:Math.max(1,(r.likes||0)*9+(r.replies||0)*14),liked:!!r.liked,reposted:!!r.reposted,horizon:r.horizon||null,quote:r.quote_ref||null,quotes:+r.quotes||0};
 if(r.kind==='meme'){Object.assign(k,{t:r.mint,entry:+r.entry_mc,target:r.target_mc?+r.target_mc:null,buy:+r.buy_usd||0,snap:{sym:r.token_sym,name:r.token_name}})}
 if(r.kind==='perps')k.perp={m:r.perp_market,side:r.perp_side,lev:+r.perp_leverage,entry:+r.perp_entry,target:r.perp_target?+r.perp_target:null,stop:r.perp_stop?+r.perp_stop:null};
 return liveAgo(k,Date.parse(r.created_at))}
function mergePosts(rows){const ids=new Set(calls.map(k=>String(k.id))),add=[],miss=new Set();
 rows.map(fromRow).filter(Boolean).forEach(k=>{const i=calls.findIndex(x=>String(x.id)===String(k.id));if(i>=0){const o=calls[i];['likes','reposts','replies','liked','reposted','buy'].forEach(f=>o[f]=k[f]);return}
  if(!ids.has(String(k.id))){add.push(k);if(k.t&&!T[k.t])miss.add(k.t)}});
 if(add.length){const at=k=>k.at||0;calls=[...calls,...add].sort((a,b)=>(b.at?1:0)-(a.at?1:0)||at(b)-at(a))}
 if(miss.size)fetchTokens([...miss].slice(0,50)).then(l=>{l.forEach(regLive);render()}).catch(()=>{});
 return add.length}
let PBUSY=0;
function loadPosts(){if(PBUSY)return;PBUSY=1;API('/api/posts?limit=60').then(j=>{if(mergePosts(j.posts||[])&&['home','profile','lists','callerboard'].includes(currentRoute()))render()}).catch(()=>{}).finally(()=>{PBUSY=0})}
function loadMe(){if(!SYNC())return;API('/api/me').then(j=>{
  S.following=new Set(j.following||[]);S.muted=new Set(j.muted||[]);S.blocked=new Set(j.blocked||[]);S.lists=j.lists||[];S.followers=j.followers||0;
  if(j.watchlist&&j.watchlist.length)S.watch=new Set(j.watchlist);
  if(Array.isArray(j.bookmarks)){const local=[...S.bm].filter(x=>!j.bookmarks.includes(x));S.bm=new Set([...j.bookmarks,...local]);saveBm();local.forEach(ref=>bg('/api/social',{action:'bookmark',ref,on:true}))}
  const R={};(j.reactions||[]).forEach(x=>{(R[x.post_ref]=R[x.post_ref]||{})[x.kind]=1});
  calls.forEach(k=>{const r=R[String(k.id)];if(!r)return;if(r.like&&!k.liked){k.liked=true;if(!k.srv)k.likes++}if(r.repost&&!k.reposted){k.reposted=true;if(!k.srv)k.reposts++}});
  S.ledger=j.transactions||[];S.activity=S.ledger.map(txRow);render()}).catch(e=>console.warn('[callit] /api/me',e.message))}
function txRow(t){const K={buy:'Bought',sell:'Sold',swap:'Swapped',withdraw:'Withdrew',deposit:'Received'};
 const d=Date.parse(t.created_at),m=(Date.now()-d)/6e4;
 return {k:K[t.kind]||t.kind,d:t.label||'',t:m<1?'Just now':m<60?Math.round(m)+'m ago':m<1440?Math.round(m/60)+'h ago':new Date(d).toLocaleDateString(),sig:t.signature}}
/* Records a real on-chain transaction to the user's account (and stamps a call's buy-in). */
function logTx(rec){S.activity.unshift({k:rec.k,d:rec.label,t:'Just now',sig:rec.signature});(S.ledger=S.ledger||[]).unshift({...rec,created_at:new Date().toISOString()});bg('/api/transactions',rec)}
/* ---------- PnL (average cost) from the user's own trade ledger. SOL and USDC count as cash. ---------- */
function pnlBook(){const P={},cash=new Set([SOL_MINT,USDC_MINT]);let real=0,vol=0;
 [...(S.ledger||[])].reverse().forEach(t=>{const u=+t.usd_value||0,ia=+t.in_amount||0,oa=+t.out_amount||0;
  if(t.kind==='buy'||t.kind==='sell'||t.kind==='swap'){vol+=u;
   const pi=t.in_mint&&!cash.has(t.in_mint)?P[t.in_mint]:null;
   if(pi&&pi.amt>0&&ia>0){const q=Math.min(ia,pi.amt),avg=pi.cost/pi.amt;real+=u*(q/ia)-avg*q;pi.cost-=avg*q;pi.amt-=q}
   if(t.out_mint&&!cash.has(t.out_mint)&&oa>0){const po=P[t.out_mint]=P[t.out_mint]||{amt:0,cost:0};po.amt+=oa;po.cost+=u}}
  else if(t.kind==='withdraw'&&t.in_mint&&P[t.in_mint]&&P[t.in_mint].amt>0){const pi=P[t.in_mint],q=Math.min(ia,pi.amt);pi.cost-=pi.cost/pi.amt*q;pi.amt-=q}});
 return {P,real,vol}}
function posPnl(key,book){book=book||pnlBook();const p=book.P[mintOf(key)],bal=S.bal[key]||0,t=T[key];
 if(!p||p.amt<=0||!bal||!t||!t.price)return null;const q=Math.min(bal,p.amt),cost=p.cost/p.amt*q,val=q*t.price;
 return {pnl:val-cost,pct:cost>0?(val-cost)/cost*100:null,cost,val}}
function callStats(h){const b=calls.filter(k=>k.c===h&&k.buy&&!k.sponsored&&nums(k));
 return {n:b.length,pnl:b.reduce((a,k)=>a+(nums(k).pnl||0),0),vol:b.reduce((a,k)=>a+(+k.buy||0),0)}}
function statsOf(h){if(h===S.me&&(S.ledger||[]).length){const B=pnlBook();let un=0;Object.keys(S.bal).forEach(k=>{const x=posPnl(k,B);if(x)un+=x.pnl});
  return {n:S.ledger.length,pnl:B.real+un,vol:B.vol}}return callStats(h)}
function joinedOf(h){const d=h===S.me?S.profile&&S.profile.created_at:PUB[h]&&!PUB[h].pending?PUB[h].created_at:null;
 if(d&&!isNaN(Date.parse(d)))return new Date(d).toLocaleDateString(undefined,{month:'short',year:'numeric'});
 if(C[h]&&!C[h].real&&h!==S.me){const x=hue(h+'j');return new Date(2025,x%14,1).toLocaleDateString(undefined,{month:'short',year:'numeric'})}return null}
/* Every caller gets their own card: pattern, accent and glow position come from their handle. */
function themeOf(h){let x=2166136261;for(const ch of String(h))x=Math.imul(x^ch.charCodeAt(0),16777619)>>>0;x=Math.imul(x^(x>>>15),2246822507)>>>0;
 return {pat:['lines','dots','grid','rings','waves','burst'][x%6],h:[152,200,265,330,28,45,175,290][(x>>>4)%8],o:(x>>>9)%4}}
function loadPub(h){if(PUB[h]||!SYNC()&&!realAuth())return;PUB[h]={pending:1};
 fetch('/api/profile?handle='+encodeURIComponent(h)).then(r=>r.ok?r.json():null).then(j=>{if(!j||!j.profile){delete PUB[h];return}PUB[h]=j.profile;if(j.profile.avatar_url)AVURL[h]=j.profile.avatar_url;
  if(currentRoute()==='profile'&&location.hash.split('/')[2]===h)render()}).catch(()=>{delete PUB[h]})}
function pubP(h){const p=PUB[h];return p&&!p.pending?{name:p.display_name||'',bio:p.bio||'',web:p.website||'',x:p.x_handle||''}:{}}

/* ---------- Meme / Perps / Random ---------- */
const CATS=[['all','All','home'],['meme','Memes','trenches'],['perps','Perps','market'],['random','Random','smile']];
function catOf(k){return k.kind||'meme'}
function visible(k){return !S.muted.has(k.c)&&!S.blocked.has(k.c)}
function catBar(){const i=CATS.findIndex(c=>c[0]===S.cat);return `<div class="cats tgl${S.cat==='perps'?' perps-on':''}" style="--i:${i};--n:${CATS.length}" role="tablist" aria-label="Feed type">${CATS.map(([k,l,i])=>`<button role="tab" aria-selected="${S.cat===k}" class="${S.cat===k?'on':''}" data-act="cat" data-f="${k}">${ic(i,15)}<span>${l}</span></button>`).join('')}</div>`}
function catEmpty(){const E={meme:['No calls yet','Call a token you believe in. Your entry is stamped at the live market cap.','Make a call'],
 perps:['No perps calls yet','Call a long or short on SOL, BTC or ETH. Callit tracks the ROE live.','Call a perp'],
 random:['Nothing here yet','Not every post needs a chart. Share what you’re seeing, thinking or building.','Write a post'],
 all:['Nothing here yet','Calls, perps and posts from everyone, all in one feed.','Make a call']}[S.cat];
 return `<div class="empty"><span class="eic">${ic(CATS.find(c=>c[0]===S.cat)[2],26)}</span><b class="h2">${E[0]}</b><p>${E[1]}</p><button class="btn primary" data-act="newcall" data-k="${S.cat}">${E[2]}</button></div>`}

const PERPM={SOL:{mint:'So11111111111111111111111111111111111111112',name:'Solana',c:'#9d7bff'},BTC:{mint:'3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',name:'Bitcoin',c:'#F7931A'},ETH:{mint:'7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',name:'Ethereum',c:'#8EA2FF'}};
function perpPx(m){const t=PERPM[m]&&T[PERPM[m].mint];return t&&t.price?t.price:(m==='SOL'&&T.SOL&&T.SOL.price?T.SOL.price:null)}
let PERPBUSY=0;
function loadPerps(){if(PERPBUSY)return;PERPBUSY=1;fetchTokens(Object.values(PERPM).map(x=>x.mint)).then(l=>l.forEach(x=>{const t=regLive(x);if(t)t.base=1})).catch(()=>{}).finally(()=>{PERPBUSY=0;let fresh=0;
 calls.forEach(k=>{const p=k.perp;if(!p||p.entry||!p.rel)return;const px=perpPx(p.m);if(!px)return;p.entry=px*p.rel;if(p.trel)p.target=p.entry*p.trel;if(p.srel)p.stop=p.entry*p.srel;fresh=1});
 if(fresh&&currentRoute()==='home'&&S.cat==='perps')render();else perpTick()})}
function liqOf(p){return p.side==='long'?p.entry*(1-1/p.lev):p.entry*(1+1/p.lev)}
function perpNums(k){const p=k.perp,px=perpPx(p.m);if(!px||!p.entry)return null;const L=p.side==='long',move=(px/p.entry-1)*100*(L?1:-1),liq=liqOf(p);
 const liqd=k._liqd=k._liqd||(p.lev>1&&(L?px<=liq:px>=liq)),hit=!!p.target&&(L?px>=p.target:px<=p.target),stopped=!!p.stop&&(L?px<=p.stop:px>=p.stop),roe=liqd?-100:move*p.lev;
 return {px,move,roe,up:roe>=0,liq,liqd,hit,stopped}}
function perpAv(m,big){return `<span class="tokav pmk${big?' big':''}" style="--pc:${PERPM[m].c}" aria-hidden="true">${m}</span>`}
function perpNote(k,n){const p=k.perp,b=[];if(p.target)b.push('Target '+fmtPrice(p.target));if(p.stop)b.push('Stop '+fmtPrice(p.stop));if(p.lev>1)b.push('Liq ≈ '+fmtPrice(liqOf(p)));if(k.horizon)b.push('within '+esc(k.horizon));
 const st=n&&n.liqd?'<span class="sold">Liquidated</span>':n&&n.hit?`<span class="bk">${ic('check',13)} Target hit</span>`:n&&n.stopped?'<span class="sold">Stopped out</span>':'<span class="bk no">Tracked call · no trade placed</span>';
 return b.join(' · ')+(b.length?' · ':'')+st}
function followChip(h){return h!==S.me?`<button class="fchip${S.following.has(h)?' on':''}" data-act="follow" data-h="${h}" aria-label="${S.following.has(h)?'Following':'Follow'} ${esc(h)}">${S.following.has(h)?ic('check',12)+'<span>Following</span>':'+<span>Follow</span>'}</button>`:''}
function moreBtn(k){return `<button class="ib pmore" data-act="pmenu" data-id="${k.id}" aria-label="More options">${ic('more',18)}</button>`}
function phead(k){const r=rankOf(k.c);return `<div class="phead">${who(k.c)}${r&&catOf(k)==='meme'?`<span class="rk">#${r}</span>`:''}${catOf(k)==='perps'?'<span class="tag pk">Perps</span>':''}${followChip(k.c)}<time>${k.ago==='now'?'now':k.ago+' ago'}</time>${moreBtn(k)}</div>`}
/* Watchlist star for meme + perps calls, bookmark for every post (random posts only get the bookmark). */
function watchKey(k){return k.perp?(PERPM[k.perp.m]&&PERPM[k.perp.m].mint):k.kind==='random'?null:k.t}
function xacts(k,sz=18){if(k.sponsored)return '';const wk=watchKey(k),w=wk&&S.watch.has(wk),bm=S.bm.has(String(k.id));
 return `${wk?`<button class="act wact${w?' on':''}" data-act="track" data-t="${esc(wk)}" aria-pressed="${w}" aria-label="${w?'Remove from':'Add to'} watchlist" title="Watchlist">${ic('star',sz,w)}</button>`:''}<button class="act bmact${bm?' on':''}" data-act="bmark" data-id="${esc(String(k.id))}" aria-pressed="${bm}" aria-label="${bm?'Remove bookmark':'Bookmark'}" title="Bookmark">${ic('bookmark',sz,bm)}</button>`}
function pbar(k,right=''){return `<div class="pbar"><div class="icons">
 <button class="act" data-act="reply" aria-label="Reply">${ic('reply',18)}<span class="num">${k.replies||''}</span></button>
 <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',18)}<span class="num">${(k.reposts||0)+quotesOf(k.id)||''}</span></button>
 <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',18,k.liked)}<span class="num">${k.likes||''}</span></button>
 <span class="act views" aria-label="Views">${ic('views',18)}<span class="num">${fmtK(k.views||0)}</span></span>
 ${xacts(k)}<button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',18)}</button></div>${right}</div>`}
function perpCard(k){const p=k.perp,n=perpNums(k),L=p.side==='long';
 return `<div class="ccard pcard">${perpAv(p.m)}<div class="cn"><b>${p.m}-PERP</b><span><span class="pside ${L?'long':'short'}">${L?'Long':'Short'} ${+p.lev}x</span></span></div>
 <div class="cr2 num"><div><span>Entry</span><b>${fmtPrice(p.entry)}</b></div><div><span>${n&&n.liqd?'Liquidated':'ROE'}</span><b class="${n?(n.up?'up':'down'):'muted'}" data-roe="${k.id}">${n?fmtPct(n.roe):'—'}</b></div></div></div>`}
function postPerp(k){const p=k.perp;if(!p.entry)return '';const n=perpNums(k);
 return `<article class="post${k.fresh?' fresh':''}" data-go="#/post/${k.id}" tabindex="0" aria-label="Perps call by ${esc(k.c)} on ${p.m}">
 <a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile" class="pav">${avatar(k.c,'md')}</a><div style="min-width:0">${phead(k)}
 <p class="ptext">${rich(k.thesis)}</p>${mediaGrid(k.media)}${quoteCard(k.quote)}${perpCard(k)}<div class="pnote">${perpNote(k,n)}</div>
 ${pbar(k,`<span class="pright"><span class="mc num" data-ppx="${p.m}" title="${p.m} mark price">${n?fmtPrice(n.px):'—'}</span></span>`)}</div></article>`}
function postRandom(k){return `<article class="post${k.fresh?' fresh':''}" data-go="#/post/${k.id}" tabindex="0" aria-label="Post by ${esc(k.c)}">
 <a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile" class="pav">${avatar(k.c,'md')}</a><div style="min-width:0">${phead(k)}
 ${k.thesis?`<p class="ptext">${rich(k.thesis)}</p>`:''}${mediaGrid(k.media)}${quoteCard(k.quote)}${pbar(k)}</div></article>`}
function perpPanel(k){if(!k.perp.entry)return '<p class="hint">Loading the live price…</p>';const p=k.perp,n=perpNums(k),L=p.side==='long',cls=n?(n.up?'up':'down'):'';
 const prog=p.target&&n?Math.min(100,Math.max(0,(n.px-p.entry)/(p.target-p.entry)*100)):null;
 return `<div class="tpanel">${perpCard(k)}<div class="tgrid num"><div><span>Entry</span><b>${fmtPrice(p.entry)}</b></div><div><span>Mark price</span><b class="${cls}" data-ppx="${p.m}">${n?fmtPrice(n.px):'—'}</b></div><div><span>Price move</span><b class="${cls}">${n?fmtPct(n.move):'—'}</b></div>
 <div><span>Side</span><b class="${L?'up':'down'}">${L?'Long':'Short'} ${+p.lev}x</b></div><div><span>Target</span><b>${p.target?fmtPrice(p.target):'None set'}</b></div><div><span>${p.lev>1?'Liq. price':'Stop'}</span><b>${p.lev>1?fmtPrice(liqOf(p)):p.stop?fmtPrice(p.stop):'—'}</b></div></div>
 ${prog!=null?`<div class="tprog"><i style="width:${Math.max(2,prog)}%"></i></div>`:''}<p class="hint" style="margin:10px 0 0">${perpNote(k,n)}. Perps trading in Callit is coming; calls are tracked against the live ${p.m} price.</p></div>`}
function perpTick(){calls.forEach(k=>{if(!k.perp)return;const n=perpNums(k);if(!n)return;const dir=k._px?Math.sign(n.px-k._px):0;k._px=n.px;
 document.querySelectorAll(`[data-roe="${k.id}"]`).forEach(el=>{flashSet(el,fmtPct(n.roe),dir);el.classList.toggle('up',n.up);el.classList.toggle('down',!n.up)})});
 Object.keys(PERPM).forEach(m=>{const px=perpPx(m);if(px)document.querySelectorAll(`[data-ppx="${m}"]`).forEach(el=>el.textContent=fmtPrice(px))})}

/* ---------- compose: one sheet, three kinds ---------- */
const POSTK=()=>CATS.filter(c=>c[0]!=='all');
function kindSeg(cur){return `<div class="kseg tgl" style="--i:${POSTK().findIndex(c=>c[0]===cur)};--n:3" role="tablist" aria-label="What are you posting?">${POSTK().map(([k,l,i])=>`<button type="button" role="tab" aria-selected="${cur===k}" class="${cur===k?'on':''}${k==='perps'?' klock':''}" data-ck="${k}"${k==='perps'?' aria-disabled="true"':''}>${ic(k==='perps'?'lock':i,15)}<span class="kl">${{meme:'Meme',perps:'Perps',random:'Random'}[k]}</span>${k==='perps'?'<small class="ksoon">Soon</small>':''}</button>`).join('')}</div>
 <div class="drow"><button type="button" class="lnk" data-drafts>${ic('draft',15)} Drafts${DRAFTS.length?` <span class="dcount">${DRAFTS.length}</span>`:''}</button><button type="button" class="lnk" data-dsave>Save draft</button></div>`}
function wireKind(m,cur){m.querySelectorAll('[data-ck]').forEach(b=>b.onclick=()=>{if(b.dataset.ck==='perps')return toast('Perps calls are coming soon');if(b.dataset.ck===cur)return;const d=($('#cx',m)||{}).value||'';
  const go=()=>{S.noDraft=1;composeModal(b.dataset.ck,{draft:d})};slideTo(b)?setTimeout(go,170):go()});
 const ds=$('[data-dsave]',m),dl=$('[data-drafts]',m);
 if(ds)ds.onclick=()=>{const tx=($('#cx',m)||{}).value||'',tk=($('#ct',m)||{}).value||'';if(!addDraft(cur,tx,tk))return toast('Write something first');S.noDraft=1;closeModal();toast('Saved to drafts')};
 if(dl)dl.onclick=()=>{const tx=($('#cx',m)||{}).value||'',tk=($('#ct',m)||{}).value||'';if(addDraft(cur,tx,tk))toast('Current post saved to drafts');S.noDraft=1;draftsModal()}}
function composeModal(kind,o={}){if(kind==='perps'){toast('Perps calls are coming soon');kind='meme'}if(!S.connected)return connectModal(()=>composeModal(kind,o));if(kind==='random')return randomModal(o);return callModal(o.pre,o.draft)}
function afterPost(k,msg){calls.forEach(x=>x.fresh=false);calls.unshift(k);if(S.cat!=='all')S.cat=catOf(k);try{localStorage.setItem('callit.cat',S.cat)}catch(_){}S.tab='foryou';S.noDraft=1;closeModal();
 if(location.hash!=='#/home')location.hash='#/home';else render();if(msg)toast(msg);scrollTo({top:0})}
function perpModal(o={}){let mk='SOL',side='long',lev=10,hz='7 days';const CD={media:[]};
 modal('Make a call','Call a long or short. Entry is stamped at the live price when you post.',`${kindSeg('perps')}
 <div class="field"><label>Market</label><div class="pmkts" id="pmk">${Object.keys(PERPM).map(m=>`<button type="button" data-pm="${m}" class="${m===mk?'on':''}">${perpAv(m)}<span><b>${m}-PERP</b><small class="num" data-ppx="${m}">${perpPx(m)?fmtPrice(perpPx(m)):'…'}</small></span></button>`).join('')}</div></div>
 <div class="field"><label>Direction</label><div class="pdir" id="pds"><button type="button" data-sd="long" class="on long">${ic('up',16)} Long</button><button type="button" data-sd="short" class="short">${ic('down',16)} Short</button></div></div>
 <div class="field"><label for="plev">Leverage <b class="num" id="plevv" style="float:right">${lev}x</b></label><input type="range" id="plev" min="1" max="100" step="1" value="${lev}" class="prange"><div class="presets" id="plevp">${[2,5,10,25,50].map(v=>`<button type="button" data-lv="${v}" class="${v===lev?'on':''}">${v}x</button>`).join('')}</div></div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="ptg">Target price</label><input id="ptg" class="input num" inputmode="decimal" placeholder="Optional"></div><div class="field"><label for="pst">Stop price</label><input id="pst" class="input num" inputmode="decimal" placeholder="Optional"></div></div>
 <div class="field"><label>Time window</label><div class="seg wide tw" id="ph">${[['24 hours','24h'],['3 days','3d'],['7 days','7d'],['30 days','30d']].map(([v,l])=>`<button type="button" class="${v===hz?'on':''}" data-hz="${v}">${l}</button>`).join('')}</div></div>
 <div class="pinfo" id="pinfo"></div>
 <div class="field"><label for="cx">Why this trade?</label><div class="composer2" id="cbox"><textarea id="cx" class="input" maxlength="280" placeholder="Your thesis. What’s the setup?">${esc(o.draft||'')}</textarea><div id="cmedia"></div>${attachBar()}</div><span class="hint" id="cn">0 / 280</span></div>
 <div class="err" id="cerr"></div><button class="btn primary block" id="cpost" disabled>Post perps call</button>`,
 m=>{wireKind(m,'perps');loadPerps();wireAttach($('#cbox',m),CD,()=>{$('#cmedia',m).innerHTML=mediaGrid(CD.media,1);$('#cbox [data-attn]',m).textContent=CD.media.length?CD.media.length+'/4':''});
  const tx=$('#cx',m),go=$('#cpost',m),num=id=>{const v=parseFloat(String($(id,m).value).replace(/[$,\s]/g,''));return v>0?v:null};
  const info=()=>{const px=perpPx(mk),L=side==='long',el=$('#pinfo',m);if(!px){el.innerHTML='<span class="hint">Loading the live price…</span>';return}
   const liq=lev>1?liqOf({side,lev,entry:px}):null;el.innerHTML=`<div><span>Entry now</span><b class="num">${fmtPrice(px)}</b></div><div><span>${L?'+1% move':'−1% move'}</span><b class="num up">+${lev}% ROE</b></div><div><span>Liq. price</span><b class="num down">${liq?fmtPrice(liq):'None'}</b></div>`};
  const check=()=>{$('#cn',m).textContent=tx.value.length+' / 280';go.disabled=!(perpPx(mk)&&tx.value.trim().length>=10);info()};
  m.querySelectorAll('[data-pm]').forEach(b=>b.onclick=()=>{mk=b.dataset.pm;m.querySelectorAll('[data-pm]').forEach(x=>x.classList.toggle('on',x===b));check()});
  m.querySelectorAll('[data-sd]').forEach(b=>b.onclick=()=>{side=b.dataset.sd;m.querySelectorAll('[data-sd]').forEach(x=>x.classList.toggle('on',x===b));check()});
  const setLev=v=>{lev=Math.max(1,Math.min(100,Math.round(v)));$('#plev',m).value=lev;$('#plev',m).style.setProperty('--v',(lev-1)/99*100+'%');$('#plevv',m).textContent=lev+'x';m.querySelectorAll('[data-lv]').forEach(x=>x.classList.toggle('on',+x.dataset.lv===lev));check()};
  $('#plev',m).oninput=e=>setLev(+e.target.value);m.querySelectorAll('[data-lv]').forEach(b=>b.onclick=()=>setLev(+b.dataset.lv));setLev(lev);
  m.querySelectorAll('[data-hz]').forEach(b=>b.onclick=()=>{hz=b.dataset.hz;m.querySelectorAll('[data-hz]').forEach(x=>x.classList.toggle('on',x===b))});
  tx.addEventListener('input',check);const iv=setInterval(()=>{if(!go.isConnected)return clearInterval(iv);m.querySelectorAll('[data-ppx]').forEach(el=>{const p=perpPx(el.dataset.ppx);if(p)el.textContent=fmtPrice(p)});if(go.disabled)check();else info()},2000);check();
  go.onclick=()=>{const px=perpPx(mk),L=side==='long',tg=num('#ptg'),st=num('#pst'),err=$('#cerr',m);
   if(tg&&(L?tg<=px:tg>=px))return err.textContent=`Target must be ${L?'above':'below'} the current price of ${fmtPrice(px)}.`;
   if(st&&(L?st>=px:st<=px))return err.textContent=`Stop must be ${L?'below':'above'} the current price of ${fmtPrice(px)}.`;
   const thesis=tx.value.trim(),local={c:S.me,kind:'perps',thesis,media:CD.media.slice(),perp:{m:mk,side,lev,entry:px,target:tg,stop:st},horizon:hz,likes:0,reposts:0,replies:0,views:1,fresh:true};
   if(!SYNC())return afterPost({...local,id:Date.now(),ago:'now'},'Perps call posted');
   go.disabled=true;go.textContent='Posting…';
   upMedia(CD.media).then(media=>API('/api/posts',{body:{kind:'perps',market:mk,side,leverage:lev,target:tg,stop:st,horizon:hz,body:thesis,media}}))
    .then(r=>afterPost(Object.assign(fromRow({...r.post,handle:S.me}),{fresh:true}),'Perps call posted'))
    .catch(e=>{go.disabled=false;go.textContent='Post perps call';err.textContent=e.message})}})}
function randomModal(o={}){const CD={media:[]},qid=o.quote||null;
 modal(qid?'Quote':'New post',qid?'Add your take. The original shows under your post.':'Not every post needs a chart. Share what’s on your mind.',`${qid?'':kindSeg('random')}
 <div class="field"><div class="composer2" id="cbox"><textarea id="cx" class="input" maxlength="280" style="min-height:130px" placeholder="What’s happening?">${esc(o.draft||'')}</textarea><div id="cmedia"></div>${attachBar()}</div><span class="hint" id="cn">0 / 280</span></div>
 ${qid?quoteCard(qid,1):''}<div class="err" id="cerr"></div><button class="btn primary block" id="cpost" disabled>Post</button>`,
 m=>{if(!qid)wireKind(m,'random');const tx=$('#cx',m),go=$('#cpost',m),check=()=>{$('#cn',m).textContent=tx.value.length+' / 280';go.disabled=!(tx.value.trim()||CD.media.length||qid)};
  wireAttach($('#cbox',m),CD,()=>{$('#cmedia',m).innerHTML=mediaGrid(CD.media,1);$('#cbox [data-attn]',m).textContent=CD.media.length?CD.media.length+'/4':'';check()});
  tx.addEventListener('input',check);check();setTimeout(()=>tx.focus(),60);
  go.onclick=()=>{const body=tx.value.trim(),local={c:S.me,kind:'random',thesis:body,media:CD.media.slice(),likes:0,reposts:0,replies:0,views:1,fresh:true,quote:qid};
   if(!SYNC())return afterPost({...local,id:Date.now(),ago:'now'},'Posted');
   go.disabled=true;go.textContent='Posting…';
   upMedia(CD.media).then(media=>API('/api/posts',{body:{kind:'random',body,media,quote_ref:qid?String(qid):undefined}}))
    .then(r=>{if(qid){const o=calls.find(x=>String(x.id)===String(qid));if(o)o.quotes=(o.quotes||0)+1;if(r.quoteSaved===false)setTimeout(()=>toast('Quote saved as a normal post. Run migration 0009 in Supabase so quotes stick'),2400)}afterPost(Object.assign(fromRow({...r.post,handle:S.me}),{fresh:true,quote:r.post.quote_ref||(r.quoteSaved===false?null:qid)}),qid?'Quoted':'Posted')})
    .catch(e=>{go.disabled=false;go.textContent='Post';$('#cerr',m).textContent=e.message})}})}

/* Quoted post shown inside another post (and in the Quote composer). */
const QF=new Set();
function quoteCard(id,inComposer){if(!id)return '';const q=calls.find(x=>String(x.id)===String(id))||(String(id)==='welcome'?BOTPOST:null);
 if(!q){if(SYNC()&&!QF.has(String(id))&&/^[0-9a-f-]{36}$/i.test(String(id))){QF.add(String(id));API('/api/posts?ids='+encodeURIComponent(id)).then(j=>{mergePosts(j.posts||[]);render()}).catch(()=>{})}
  return `<div class="qcard qmiss">${ic('repost',14)} Quoted post</div>`}
 const n=q.kind==='meme'&&T[q.t]?nums(q):null,sym=q.kind==='meme'?symOf(q.t):'';
 return `<div class="qcard"${inComposer?'':` data-go="#/post/${esc(q.id)}" role="link" tabindex="0"`}><div class="qhead">${avatar(q.c)}<b>${esc(nameOf(q.c))}</b><span class="hint">@${esc(q.c)}${q.ago?' · '+esc(q.ago):''}</span></div>
  ${q.kind==='meme'&&q.t?`<div class="qcall">${tokav(q.t)}<span class="grow"><b>Called $${esc(sym)}</b><span class="hint">at ${fmtUsd(q.entry)} MC</span></span>${n?`<b class="num ${n.up?'up':'down'}">${fmtPct(n.p)}</b>`:''}</div>`:''}
  ${q.thesis?`<p class="qtext">${esc(String(q.thesis).slice(0,180))}${String(q.thesis).length>180?'…':''}</p>`:''}</div>`}
function doRepost(id){const k=calls.find(x=>x.id==id)||(id==='welcome'?BOTPOST:null);if(!k)return;const b2=document.querySelector(`[data-act="repost"][data-id="${CSS.escape(String(k.id))}"]`);k.reposted=!k.reposted;bg('/api/posts/react',{ref:String(k.id),kind:'repost',on:k.reposted});k.reposts+=k.reposted?1:-1;document.querySelectorAll(`[data-act="repost"][data-id="${CSS.escape(String(k.id))}"]`).forEach(x=>{x.classList.toggle('reposted',k.reposted);const sp=x.querySelector('span');if(sp)sp.textContent=(k.reposts||0)+quotesOf(k.id)||''});void b2;toast(k.reposted?'Reposted':'Repost removed')}
/* Hold the repost button for 2s to get Repost / Quote / View quotes. A normal tap still reposts instantly. */
const quotesOf=id=>{const k=calls.find(x=>String(x.id)===String(id));const local=calls.filter(x=>String(x.quote)===String(id)).length;return Math.max(local,k&&k.quotes||0)};
let RPH=null;
document.addEventListener('pointerdown',e=>{const b=e.target.closest&&e.target.closest('[data-act="repost"]');if(!b)return;clearTimeout(RPH);b.classList.add('holding');
 RPH=setTimeout(()=>{b.classList.remove('holding');b._heldAt=Date.now();if(navigator.vibrate)try{navigator.vibrate(15)}catch(_){}if(!S.connected)return connectModal();repostSheet(b.dataset.id)},2000)});
['pointerup','pointercancel','pointerleave'].forEach(ev=>document.addEventListener(ev,e=>{const b=e.target.closest&&e.target.closest('[data-act="repost"]');clearTimeout(RPH);document.querySelectorAll('[data-act="repost"].holding').forEach(x=>x.classList.remove('holding'));void b},true));
document.addEventListener('contextmenu',e=>{if(e.target.closest&&e.target.closest('[data-act="repost"]'))e.preventDefault()});
const QQ={};
function vQuotes(id){id=decodeURIComponent(String(id||''));if(!id)return vHome();
 if(SYNC()&&!QQ[id]){QQ[id]='busy';API('/api/posts?limit=60&quote_of='+encodeURIComponent(id)).then(j=>{mergePosts(j.posts||[]);QQ[id]='ok'}).catch(()=>{QQ[id]='err'}).finally(()=>{if(currentRoute()==='quotes')render()})}
 const list=calls.filter(k=>visible(k)&&String(k.quote)===id);
 return `<div class="pad"><div class="hint" style="margin-bottom:6px">Quotes of</div>${quoteCard(id)}</div><div id="feed">${list.map(post).join('')||(QQ[id]==='busy'?'<div class="post pskel" aria-hidden="true"><span class="av md"></span><div><i></i><i></i><i></i><b></b></div></div>':'<div class="empty"><b>No quotes yet</b><p>Hold the repost button on a post for 2 seconds and pick Quote.</p></div>')}</div>`}
function repostSheet(id){const k=calls.find(x=>String(x.id)===String(id))||(String(id)==='welcome'?BOTPOST:null);if(!k)return;
 aSheet('Repost',``,`<div class="asgroup">${arow(`data-act="rpdo" data-id="${esc(k.id)}"`,'repost',k.reposted?'Undo repost':'Repost',k.reposted?'Remove it from your profile':'Share it to your followers as is')}${arow(`data-act="rpq" data-id="${esc(k.id)}"`,'pen','Quote','Add your take on top')}${quotesOf(k.id)?arow(`data-act="rpv" data-id="${esc(k.id)}"`,'messages',`View quotes (${quotesOf(k.id)})`,'See what people said about it'):''}</div>`)}
/* ---------- ⋯ menu: share profile, add to list, mute, block ---------- */
function moreSheet(h,k){const me=h===S.me,mu=S.muted.has(h),bl=S.blocked.has(h),inL=S.lists.filter(l=>l.members.includes(h)).length,c=C[h]||{},pub=PUB[h]&&!PUB[h].pending?PUB[h]:null;
 const row=(act,icn,label,sub,cls='')=>`<button class="asrow ${cls}" data-act="${act}" data-h="${esc(h)}"${k?` data-id="${k.id}"`:''}><span class="asic">${ic(icn,19)}</span><span class="grow"><b>${label}</b>${sub?`<small>${sub}</small>`:''}</span>${cls.includes('chev')?ic('chev',16):''}</button>`;
 const stats=me?`${fmtK(S.followers||0)} followers`:pub?`${fmtK(pub.followers)} followers · ${pub.posts} posts`:c.calls?`${c.win}% win rate · ${c.calls} calls`:'Caller on Callit';
 $('#modal').innerHTML=`<div class="scrim" data-act="close"><div class="asheet" role="dialog" aria-modal="true" aria-label="Options for @${esc(h)}">
  <div class="asgrab" aria-hidden="true"></div>
  <a class="ashead" href="#/profile/${esc(h)}" data-act="close">${avatar(h,'md')}<span class="grow"><b>${esc(nameOf(h))}</b>${vbadge(h)}<small>@${esc(h)} · ${stats}</small></span>${ic('chev',16)}</a>
  <div class="asgroup">${row('shprof','link',me?'Share your profile':`Share @${esc(h)}’s profile`,'Copy the link or post a card')}${k?row('cplink','copy','Copy link to post',''):''}${k?row('share','share','Share this post','Card, image or link'):''}</div>
  ${me?'':`<div class="asgroup">${row('addlist','list',inL?`In ${inL} list${inL>1?'s':''}`:'Add to list','Group callers you want to keep an eye on','chev')}${row('mute','mute',mu?`Unmute @${esc(h)}`:`Mute @${esc(h)}`,mu?'Show their posts in your feeds again':'Hide their posts. They won’t know')}${row('block','block',bl?`Unblock @${esc(h)}`:`Block @${esc(h)}`,bl?'Let them show up again':'Hide them everywhere and unfollow','danger')}</div>`}
  ${k&&me&&k.srv?`<div class="asgroup">${row('delpost','trash','Delete post','This can’t be undone','danger')}</div>`:''}
  <button class="btn ghost block ascancel" data-act="close">Cancel</button></div></div>`;
 requestAnimationFrame(()=>{const s=$('#modal .asheet');s&&s.classList.add('in')})}
function toggleRel(kind,h,on){const set=kind==='mute'?S.muted:kind==='block'?S.blocked:S.following;on?set.add(h):set.delete(h);if(kind==='block'&&on)S.following.delete(h);bg('/api/social',{action:kind,handle:h,on})}
function blockedView(h){return `<div class="banner" style="${bannerBg(h)}"></div><div class="phero"><div class="top"><span class="avwrap">${avatar(h,'lg')}</span></div><div class="pname2"><b class="h2">@${esc(h)}</b></div>
 <div class="empty" style="padding:22px 0"><b class="h2">You blocked @${esc(h)}</b><p>Their posts are hidden everywhere on Callit.</p><button class="btn primary" data-act="block" data-h="${esc(h)}">Unblock</button></div></div>`}
function listsModal(h){if(!S.connected)return connectModal(()=>listsModal(h));
 const draw=m=>{$('#lsbody',m).innerHTML=`<div class="lslist">${S.lists.length?S.lists.map(l=>{const on=l.members.includes(h);return `<label class="lsrow${on?' on':''}"><input type="checkbox" data-lid="${l.id}" ${on?'checked':''}><span class="lsic">${ic('list',18)}</span><span class="grow"><b>${esc(l.name)}</b><small>${l.members.length} caller${l.members.length===1?'':'s'}</small></span><a href="#/lists/${l.id}" class="lnk" data-act="close">View</a></label>`}).join(''):'<p class="hint" style="margin:0 0 10px">No lists yet. Make your first one below.</p>'}</div>
  <div class="lsnew"><input id="lsname" class="input" maxlength="40" placeholder="New list, e.g. Smart money"><button class="btn primary" id="lsadd">Create</button></div><div class="err" id="lserr"></div>`;
  m.querySelectorAll('[data-lid]').forEach(i=>i.onchange=()=>{const l=S.lists.find(x=>x.id===i.dataset.lid);if(!l)return;
   if(i.checked){if(!l.members.includes(h))l.members.push(h)}else l.members=l.members.filter(x=>x!==h);bg('/api/social',{action:'list_member',list:l.id,handle:h,on:i.checked});toast(i.checked?`Added to ${l.name}`:`Removed from ${l.name}`);draw(m)});
  const add=$('#lsadd',m),inp=$('#lsname',m);inp.onkeydown=e=>{if(e.key==='Enter')add.click()};
  add.onclick=()=>{const name=inp.value.trim();if(!name)return $('#lserr',m).textContent='Name your list.';if(S.lists.some(l=>l.name.toLowerCase()===name.toLowerCase()))return $('#lserr',m).textContent='You already have a list with that name.';
   const done=l=>{l.members=[h];S.lists.push(l);bg('/api/social',{action:'list_member',list:l.id,handle:h,on:true});toast(`Added to ${l.name}`);draw(m)};
   if(!SYNC())return done({id:'l'+Date.now(),name});add.disabled=true;API('/api/social',{body:{action:'list_create',name}}).then(r=>done(r.list)).catch(e=>$('#lserr',m).textContent=e.message).finally(()=>{add.disabled=false})}};
 modal(`Add @${h} to a list`,'Lists are private. Only you can see them.','<div id="lsbody"></div>',draw)}
function vLists(id){if(!S.connected)return `<div class="empty"><b class="h2">Your lists</b><p>Sign in to group callers into lists.</p><button class="btn primary" data-act="connect">Sign in</button></div>`;
 if(id){const l=S.lists.find(x=>x.id===id);if(!l)return `<div class="empty"><b class="h2">List not found</b><a class="btn primary" href="#/lists">All lists</a></div>`;
  const list=calls.filter(k=>l.members.includes(k.c)&&visible(k));
  return `<div class="pad lshero"><span class="lsic big">${ic('list',22)}</span><div class="grow"><b class="h2">${esc(l.name)}</b><div class="hint">${l.members.length} caller${l.members.length===1?'':'s'} · private</div></div></div>
  <div class="lsmembers pad">${l.members.map(h=>`<a href="#/profile/${esc(h)}" class="chip">${avatar(h)}<span>@${esc(h)}</span></a>`).join('')}</div>
  <div id="feed">${list.map(post).join('')||'<div class="empty"><b>No posts yet</b><p>Posts from callers in this list show up here.</p></div>'}</div>`}
 return `<div class="pad"><b class="h2">Your lists</b><p class="hint" style="margin:4px 0 14px">Private groups of callers. Add someone from the ⋯ menu on any post or profile.</p>
 ${S.lists.length?`<div class="list">${S.lists.map(l=>`<a class="li" href="#/lists/${l.id}"><span class="lsic">${ic('list',18)}</span><div class="grow"><b>${esc(l.name)}</b><div class="hint">${l.members.length} caller${l.members.length===1?'':'s'}</div></div>${ic('chev',16)}</a>`).join('')}</div>`:'<div class="empty"><b>No lists yet</b></div>'}</div>`}

/* ---------- share cards ---------- */
function profileURL(h){return location.href.split('#')[0]+'#/profile/'+encodeURIComponent(h)}
function cardOf(k){const n=k.perp?perpNums(k):nums(k),tag=`CALL #${String(k.id).replace(/-/g,'').slice(0,6).toUpperCase()}`,base={h:k.c,name:nameOf(k.c),tag};
 if(catOf(k)==='random')return {...base,head:`@${k.c} on Callit`,label:'',quote:k.thesis||'📷',up:null,chips:[]};
 if(k.perp){const p=k.perp,L=p.side==='long';return {...base,head:`@${k.c} called ${L?'a long':'a short'} on ${p.m}`,label:n&&n.liqd?'Liquidated':'Return on equity',n:n?n.roe:null,big:n?fmtPct(n.roe):'—',up:n?n.up:null,
  sub:`${L?'Long':'Short'} ${+p.lev}x · ${fmtPrice(p.entry)} → ${n?fmtPrice(n.px):'—'}`,chips:[p.target?'Target '+fmtPrice(p.target):'',k.horizon?esc(k.horizon):''].filter(Boolean),tok:perpAv(p.m),tokLab:p.m+'-PERP'}}
 const t=T[k.t];return {...base,head:`@${k.c} called $${esc(symOf(k.t))}`,label:'Since call',n:n?n.p:null,big:n?fmtPct(n.p):'Soon',up:n?n.up:null,
  sub:n?`${fmtUsd(k.entry)} → ${fmtUsd(n.mc)} MC`:'',chips:[k.buy?'✓ Bought in':'No buy-in',k.target?'Target '+fmtUsd(k.target):''].filter(Boolean),tok:t?tokav(t.key):'',tokLab:'$'+symOf(k.t)}}
function cardOfProfile(h){const c=C[h]||{},r=rankOf(h),st=statsOf(h),jn=joinedOf(h),mine=calls.filter(k=>k.c===h).length;
 return {h,name:nameOf(h),tag:r?`CALLER #${r}`:'CALLER',head:`@${h} on Callit`,label:'All-time PnL',big:st.n?money(st.pnl):'$0.00',up:st.n?st.pnl>=0:null,
  sub:jn?`Joined ${jn}`:'',stats:[['Volume',st.vol?fmtUsd(st.vol):'$0'],['Win rate',c.calls?c.win+'%':'—'],['Calls',String(c.calls||mine||0)],['Rank',r?'#'+r:'—']],theme:themeOf(h)}}
function xcardHTML(d){return `<div class="xstage"><div class="xhead">${d.head}</div>
 <div class="xcard ${d.up===false?'dn':d.up==null?'nt':''}${d.theme?` xp xp-${d.theme.pat} xo${d.theme.o}`:''}"${d.theme?` style="--xh:${d.theme.h}"`:''} tabindex="-1">${d.theme?'<i class="xorb"></i>':''}<i class="xgrain"></i><i class="xsheen"></i><span class="xwm mark" aria-hidden="true"></span>
  <div class="xtop"><span class="xbrand"><span class="mark"></span><b>Callit</b></span><span class="xtag">${d.tag}</span></div>
  <div class="xmid">${d.label?`<span class="xlab">${d.label}</span>`:''}${d.quote!=null?`<p class="xquote">“${esc(d.quote.length>160?d.quote.slice(0,157)+'…':d.quote)}”</p>`:`<b class="xbig num"${d.n!=null?` data-count="${d.n.toFixed(1)}"`:''}>${d.n!=null?fmtPct(0):d.big}</b>`}${d.sub?`<span class="xsub num">${d.sub}</span>`:''}
   ${d.stats?`<div class="xstats">${d.stats.map(([l,v])=>`<div><span>${l}</span><b class="num">${v}</b></div>`).join('')}</div>`:''}${d.chips&&d.chips.length?`<div class="xchips">${d.chips.map(c=>`<span>${c}</span>`).join('')}</div>`:''}</div>
  <div class="xbot"><span class="xwho">${avatar(d.h,'md')}<span><b>${esc(d.name)}</b><small>@${esc(d.h)}</small></span></span>${d.tok?`<span class="xtok">${d.tok}<b>${d.tokLab||''}</b></span>`:''}</div></div>
 <div class="xfoot"><span><span class="mark"></span>Call it. Get Paid.</span><span>${esc(location.host)}</span></div></div>`}
function shareModal(d,url,fname,text){modal('Share','',`${xcardHTML(d)}
 <div class="shlink"><span class="num">${esc(url.replace(/^https?:\/\//,''))}</span><button class="btn sm primary" data-act="copy" data-v="${esc(url)}" data-m="Link copied">${ic('copy',14)} Copy</button></div>
 <div class="shacts"><a class="btn primary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">${ic('xlogo',15)} Post on X</a>
 <button class="btn ghost" id="xsave">${ic('image',16)} Save image</button>${navigator.share?`<button class="btn ghost" id="xnative">${ic('share',16)} More…</button>`:''}</div>`,
 m=>{const el=m.querySelector('[data-count]');if(el){const to=+el.dataset.count,t0=performance.now()+250,dur=1100;
   const step=t=>{const q=Math.max(0,Math.min(1,(t-t0)/dur)),e=1-Math.pow(1-q,3);el.textContent=fmtPct(to*e);if(q<1&&el.isConnected)requestAnimationFrame(step)};
   matchMedia('(prefers-reduced-motion:reduce)').matches?el.textContent=fmtPct(to):requestAnimationFrame(step)}
  const card=m.querySelector('.xcard');card.addEventListener('pointermove',e=>{const r=card.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;card.style.setProperty('--rx',(-y*7)+'deg');card.style.setProperty('--ry',(x*9)+'deg');card.style.setProperty('--mx',(x*100+50)+'%')});
  card.addEventListener('pointerleave',()=>{card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg')});
  $('#xsave',m).onclick=()=>xcardImage(d,fname,'dl',url,text);const nv=$('#xnative',m);if(nv)nv.onclick=()=>xcardImage(d,fname,'native',url,text)})}
function shareSheet(id){const k=calls.find(x=>String(x.id)===String(id));if(!k)return;const d=cardOf(k),url=postURL(id);
 const text=k.perp?`${k.c} called ${k.perp.side} ${k.perp.m} ${+k.perp.lev}x. ${d.big} ROE so far. Tracked on Callit`:catOf(k)==='random'?`${k.c} on Callit`:d.n!=null?`${k.c} called $${symOf(k.t)} at ${fmtUsd(k.entry)} MC. It's ${fmtPct(d.n)} since. Tracked on Callit`:`${k.c} is calling $${symOf(k.t)} on Callit`;
 shareModal(d,url,`callit-${k.perp?k.perp.m:k.t||'post'}`,text)}
function shareProfile(h){const d=cardOfProfile(h);shareModal(d,profileURL(h),'callit-'+h,h===S.me?'My calls, tracked live on Callit':`Follow @${h}'s calls on Callit`);if(!PUB[h])loadPub(h)}
/* 1200x630 image of the same card, for X / Telegram / saving. */
function xcardImage(d,fname,mode,url,text){const W=1200,H=630,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d'),F='system-ui,-apple-system,Segoe UI,sans-serif';
 const col=d.up===false?'#FF6B8A':d.up==null?'#4DA8FF':'#3DDC97',PR=!!d.stats,TH=d.theme;
 const rr=(x,y,w,h,r)=>{g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()};
 const logoSrc=(getComputedStyle(document.querySelector('.mark')).backgroundImage.match(/url\("?(.*?)"?\)/)||[])[1]||'';
 const avSrc=d.h===S.me&&PROF.avatar||AVURL[d.h]||'';
 const load=s=>new Promise(res=>{if(!s)return res(null);const im=new Image();im.crossOrigin='anonymous';im.onload=()=>res(im);im.onerror=()=>res(null);im.src=s});
 Promise.all([load(logoSrc),load(avSrc)]).then(([logo,av])=>{
  g.fillStyle='#070F16';g.fillRect(0,0,W,H);
  const glow=g.createRadialGradient(600,330,40,600,330,620);glow.addColorStop(0,col+'33');glow.addColorStop(1,'#070F1600');g.fillStyle=glow;g.fillRect(0,0,W,H);
  if(logo){g.globalAlpha=.045;for(let y=-20;y<H;y+=110)for(let x=(y/110%2)*55-20;x<W;x+=110)g.drawImage(logo,x,y,46,46);g.globalAlpha=1}
  g.textAlign='center';g.fillStyle='#C9D6E2';g.font=`600 32px ${F}`;g.fillText(d.head.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&'),600,72);
  const cx=210,cy=104,cw=780,ch=440;g.save();g.shadowColor='rgba(0,0,0,.55)';g.shadowBlur=60;g.shadowOffsetY=24;rr(cx,cy,cw,ch,36);
  const cg=g.createLinearGradient(cx,cy,cx+cw,cy+ch);cg.addColorStop(0,'#1B2833');cg.addColorStop(.55,'#101A23');cg.addColorStop(1,'#0A1219');g.fillStyle=cg;g.fill();g.restore();
  g.save();rr(cx,cy,cw,ch,36);g.clip();
  if(TH){const ox=[cx+cw*.85,cx+cw*.1,cx+cw*.12,cx+cw*.9][TH.o],oy=[cy+ch*.05,cy+ch*1.05,cy+ch*.02,cy+ch*1.02][TH.o],org=g.createRadialGradient(ox,oy,10,ox,oy,cw*.6);
   org.addColorStop(0,`hsla(${TH.h},85%,55%,.42)`);org.addColorStop(1,`hsla(${TH.h},85%,55%,0)`);g.fillStyle=org;g.fillRect(cx,cy,cw,ch);
   g.strokeStyle='#fff';g.fillStyle='#fff';g.lineWidth=1;g.globalAlpha=.07;
   if(TH.pat==='dots'){g.globalAlpha=.16;for(let y=cy+10;y<cy+ch;y+=20)for(let x=cx+10;x<cx+cw;x+=20){g.beginPath();g.arc(x,y,1.6,0,7);g.fill()}}
   else if(TH.pat==='grid'){for(let x=cx;x<cx+cw;x+=32){g.beginPath();g.moveTo(x,cy);g.lineTo(x,cy+ch);g.stroke()}for(let y=cy;y<cy+ch;y+=32){g.beginPath();g.moveTo(cx,y);g.lineTo(cx+cw,y);g.stroke()}}
   else if(TH.pat==='rings'){for(let r=20;r<cw;r+=22){g.beginPath();g.arc(cx+cw*.85,cy+ch*.2,r,0,7);g.stroke()}}
   else if(TH.pat==='waves'){for(let r=16;r<cw*1.3;r+=16){g.beginPath();g.ellipse(cx+cw/2,cy+ch*1.4,r*1.6,r,0,0,7);g.stroke()}}
   else if(TH.pat==='burst'){const bx=cx+cw*.8,by=cy+ch*1.1;g.globalAlpha=.06;for(let a=0;a<360;a+=12){const r1=a*Math.PI/180,r2=(a+4)*Math.PI/180;g.beginPath();g.moveTo(bx,by);g.lineTo(bx+Math.cos(r1)*1400,by+Math.sin(r1)*1400);g.lineTo(bx+Math.cos(r2)*1400,by+Math.sin(r2)*1400);g.closePath();g.fill()}}
   else for(let i=-ch;i<cw;i+=6){g.beginPath();g.moveTo(cx+i,cy);g.lineTo(cx+i+ch,cy+ch);g.stroke()}
   g.globalAlpha=1}
  else{g.globalAlpha=.06;g.strokeStyle='#fff';g.lineWidth=1;for(let i=-ch;i<cw;i+=6){g.beginPath();g.moveTo(cx+i,cy);g.lineTo(cx+i+ch,cy+ch);g.stroke()}g.globalAlpha=1}
  const sh=g.createLinearGradient(cx,cy,cx+cw,cy+ch);sh.addColorStop(.25,'rgba(255,255,255,0)');sh.addColorStop(.42,'rgba(255,255,255,.09)');sh.addColorStop(.5,'rgba(255,255,255,0)');g.fillStyle=sh;g.fillRect(cx,cy,cw,ch);
  if(logo){g.globalAlpha=.07;g.drawImage(logo,cx+cw-330,cy+ch-330,380,380);g.globalAlpha=1}
  const ac=g.createLinearGradient(cx,0,cx+cw,0);ac.addColorStop(0,col+'00');ac.addColorStop(.5,col);ac.addColorStop(1,col+'00');g.fillStyle=ac;g.fillRect(cx,cy,cw,3);
  g.restore();g.strokeStyle='rgba(255,255,255,.14)';g.lineWidth=2;rr(cx+1,cy+1,cw-2,ch-2,35);g.stroke();
  g.textAlign='left';if(logo)g.drawImage(logo,cx+46,cy+38,52,52);g.fillStyle='#fff';g.font=`800 34px ${F}`;g.fillText('Callit',cx+112,cy+76);
  g.textAlign='right';g.fillStyle=TH?`hsl(${TH.h},90%,78%)`:'#AEBBC7';g.font=`700 20px ${F}`;g.letterSpacing='3px';g.fillText(d.tag,cx+cw-46,cy+72);g.letterSpacing='0px';
  g.textAlign='center';const mx=cx+cw/2;
  if(d.quote!=null){g.fillStyle='#EAF1F7';g.font=`600 38px ${F}`;const words=('“'+d.quote+'”').split(/\s+/),lines=[];let ln='';
   words.forEach(w=>{const t=ln?ln+' '+w:w;if(g.measureText(t).width>cw-140&&ln){lines.push(ln);ln=w}else ln=t});if(ln)lines.push(ln);
   const L=lines.slice(0,4);if(lines.length>4)L[3]=L[3].replace(/\s*\S*$/,'…');L.forEach((l,i)=>g.fillText(l,mx,cy+200+i*50-(L.length-1)*12))}
  else{if(d.label){g.fillStyle='#8FA6BA';g.font=`600 26px ${F}`;g.fillText(d.label,mx,cy+(PR?128:170))}
   g.save();g.shadowColor=col;g.shadowBlur=40;g.fillStyle=d.up==null?'#fff':col;g.font=`900 ${PR?96:116}px ${F}`;g.fillText(d.big,mx,cy+(PR?216:282));g.restore();
   if(d.sub){g.fillStyle='#9FB2C3';g.font=`600 26px ${F}`;g.fillText(d.sub.replace(/&amp;/g,'&'),mx,cy+(PR?256:328))}
   if(PR){const n=d.stats.length,cw2=(cw-120)/n;d.stats.forEach(([l,v],i)=>{const x=cx+60+cw2*i+cw2/2;g.fillStyle='#8FA6BA';g.font=`600 18px ${F}`;g.fillText(l.toUpperCase(),x,cy+298);g.fillStyle='#fff';g.font=`800 30px ${F}`;g.fillText(v,x,cy+334);
    if(i){g.fillStyle='rgba(255,255,255,.12)';g.fillRect(cx+60+cw2*i,cy+282,1,58)}})}}
  const ay=cy+ch-(PR?50:78);g.save();g.beginPath();g.arc(cx+82,ay,34,0,7);g.closePath();g.clip();
  if(av)g.drawImage(av,cx+48,ay-34,68,68);else{g.fillStyle=`hsl(${(hue(d.h)%70)+185} 52% 42%)`;g.fillRect(cx+48,ay-34,68,68);g.fillStyle='#fff';g.font=`800 24px ${F}`;g.textAlign='center';g.fillText(d.h.slice(0,2).toUpperCase(),cx+82,ay+9)}
  g.restore();g.strokeStyle='rgba(255,255,255,.25)';g.lineWidth=2;g.beginPath();g.arc(cx+82,ay,35,0,7);g.stroke();
  g.textAlign='left';g.fillStyle='#fff';g.font=`800 30px ${F}`;g.fillText(d.name.slice(0,24),cx+132,ay-4);g.fillStyle='#8FA6BA';g.font=`500 22px ${F}`;g.fillText('@'+d.h,cx+132,ay+26);
  if(d.tokLab){g.font=`800 24px ${F}`;const tw=g.measureText(d.tokLab).width+40;rr(cx+cw-46-tw,ay-24,tw,48,24);g.fillStyle='rgba(255,255,255,.08)';g.fill();g.strokeStyle='rgba(255,255,255,.16)';g.stroke();g.fillStyle='#fff';g.textAlign='center';g.fillText(d.tokLab,cx+cw-46-tw/2,ay+9)}
  g.textAlign='left';g.fillStyle='#8FA6BA';g.font=`600 22px ${F}`;g.fillText('Callit  ⇄  Call it. Get Paid.',44,H-34);g.textAlign='right';g.fillText(location.host,W-44,H-34);
  c.toBlob(bl=>{if(!bl)return toast('Couldn’t make the image');const f=new File([bl],fname+'.png',{type:'image/png'});
   if(mode==='native'&&navigator.canShare&&navigator.canShare({files:[f]}))navigator.share({files:[f],url,text}).catch(()=>{});
   else if(mode==='native'&&navigator.share)navigator.share({url,text,title:'Callit'}).catch(()=>{});
   else{const a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast('Image saved')}})})}

/* ---------- helpers ---------- */
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2200)}
function fakeSig(){const a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let s='';for(let i=0;i<88;i++)s+=a[Math.floor(Math.random()*a.length)];return s}
function txRun(desc,apply,opt={}){const el=$('#txt'),sig=fakeSig();let step=0;
 const draw=(st,msg)=>{el.className='txt show '+st;el.innerHTML=`<span class="txi">${st==='ok'?ic('check',18):st==='bad'?ic('x',18):'<i class="spin"></i>'}</span><div class="grow"><b>${esc(desc)}</b><span class="hint">${msg}</span></div>${st==='ok'?`<button class="lnk" data-act="copy" data-v="${sig}">Copy tx</button>`:st==='bad'&&!/Not enough|cancelled|isn.t connected|Sign in again/.test(msg)?'<button class="lnk" id="txretry">Retry</button>':''}<button class="ib" id="txx" aria-label="Dismiss">${ic('x',16)}</button>`;
  $('#txx').onclick=()=>el.classList.remove('show');const r=$('#txretry');if(r)r.onclick=()=>txRun(desc,apply,opt)};
 clearTimeout(el._h);draw('wait','Approve in your wallet…');
 setTimeout(()=>{if(!navigator.onLine){draw('bad','You’re offline. Nothing was sent.');return}draw('wait','Sending to Solana…');
  setTimeout(()=>{if(!navigator.onLine){draw('bad','Network dropped. Nothing was sent.');return}apply&&apply();draw('ok',`Confirmed · ${sig.slice(0,4)}…${sig.slice(-4)}`);el._h=setTimeout(()=>el.classList.remove('show'),5000)},opt.slow?1400:900)},opt.instantApprove?200:800)}
function copy(txt,msg='Copied'){navigator.clipboard?.writeText(txt).catch(()=>{});toast(msg)}
/* ---------- real wallet (Privy): live balances, Jupiter swaps, withdrawals ----------
 * When a real user is signed in, balances come from Solana and every Buy/Sell/Swap/Withdraw
 * is a real transaction the user signs in their own wallet. Demo mode keeps the old flow. */
const DEC={SOL:9,USDC:6},RAW={};
const REALW=()=>realAuth()&&S.connected&&isMintStr(S.addr)&&!!window.CallitWallet;
const mintOf=k=>k==='SOL'?SOL_MINT:k==='USDC'?USDC_MINT:(T[k]&&isMintStr(T[k].ca)?T[k].ca:k);
const keyOfMint=m=>m===SOL_MINT?'SOL':m===USDC_MINT?'USDC':m;
const decOf=k=>DEC[k]!=null?DEC[k]:(T[k]&&T[k].L&&T[k].L.decimals!=null?T[k].L.decimals:null);
/* Whole balance -> exact raw amount from chain (no rounding dust left behind). */
const baseOf=(k,a)=>{const d=decOf(k);if(d==null)throw new Error('Token details are still loading. Try again in a second.');return RAW[k]&&k!=='SOL'&&a>=(S.bal[k]||0)*(1-1e-9)?RAW[k]:toBaseUnits(a,d)};
function balRender(){const ae=document.activeElement;if(ae&&ae.matches&&ae.matches('input,textarea,select')){S.dirty=1;renderSwapsSoft();return}
 if($('#modal').innerHTML||document.querySelector('.sheet.open')){S.dirty=1;renderSwapsSoft();return}
 const r=currentRoute();if(r==='you'||r==='profile')render();else renderSwapsSoft()}
let BALBUSY=0;
function loadBalances(){if(!REALW()||BALBUSY)return;BALBUSY=1;const who=S.addr;
 walletBalances(who).then(r=>{if(S.addr!==who)return;const b={SOL:r.sol},raw={SOL:r.lamports},miss=[];
  r.tokens.forEach(x=>{const k=keyOfMint(x.mint);DEC[k]=x.decimals;b[k]=(b[k]||0)+x.ui;raw[k]=x.amount;if(!T[k])miss.push(x.mint)});
  const changed=JSON.stringify(b)!==JSON.stringify(S.bal);S.bal=b;for(const k in RAW)delete RAW[k];Object.assign(RAW,raw);S.balAt=Date.now();
  if(miss.length)fetchTokens(miss.slice(0,50)).then(l=>{l.forEach(regLive);balRender()}).catch(()=>{});
  if(changed)balRender()}).catch(e=>console.warn('[callit] balances',e)).finally(()=>{BALBUSY=0})}
/* Same toast as txRun, driven by a real transaction. run(step) resolves to the signature. */
function realTx(desc,run,done){const el=$('#txt');let sig='';
 const draw=(st,msg)=>{el.className='txt show '+st;el.innerHTML=`<span class="txi">${st==='ok'?ic('check',18):st==='bad'?ic('x',18):'<i class="spin"></i>'}</span><div class="grow"><b>${esc(desc)}</b><span class="hint">${esc(msg)}</span></div>${st==='ok'&&sig?`<a class="lnk" href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener noreferrer">View</a>`:st==='bad'&&!/Not enough|cancelled|isn.t connected|Sign in again/.test(msg)?'<button class="lnk" id="txretry">Retry</button>':''}<button class="ib" id="txx" aria-label="Dismiss">${ic('x',16)}</button>`;
  $('#txx').onclick=()=>el.classList.remove('show');const r=$('#txretry');if(r)r.onclick=()=>realTx(desc,run,done)};
 clearTimeout(el._h);draw('wait','Preparing…');
 run(m=>draw('wait',m)).then(s=>{sig=s||'';draw('ok',sig?`Confirmed · ${sig.slice(0,4)}…${sig.slice(-4)}`:'Done');el._h=setTimeout(()=>el.classList.remove('show'),9000);done&&done(true);loadBalances();setTimeout(loadBalances,5000)})
  .catch(e=>{const m=e&&e.name==='TxError'?e.message:friendlyError(e);if(!isUserCancel(e))reportTxError(/^withdraw/i.test(desc)?'withdraw':'swap',e,S.addr);draw('bad',isUserCancel(e)?'You cancelled it. Nothing was sent.':m);done&&done(false)})}
/* Swap settings, saved on this device. Speed = priority fee cap; front-running protection = Jito tip. */
const SPEED={auto:0,fast:1e5,turbo:1e6,ultra:5e6};
const SWS=(()=>{const d={slip:0,speed:'auto',mev:false,tip:'0.001'};try{return {...d,...JSON.parse(localStorage.getItem('callit.swapset')||'{}')}}catch(_){return d}})();if(SWS.slip)S.slip=SWS.slip;
const saveSWS=()=>{try{localStorage.setItem('callit.swapset',JSON.stringify(SWS))}catch(_){}};
const swFees=()=>({priorityFeeLamports:SPEED[SWS.speed]||undefined,jitoTipLamports:SWS.mev?Math.round(Math.min(.1,Math.max(0,+SWS.tip||0))*1e9)||undefined:undefined});
const swSummary=()=>[S.slip?S.slip+'%':'Auto',SWS.speed!=='auto'?SWS.speed[0].toUpperCase()+SWS.speed.slice(1):'',SWS.mev?'Protected':''].filter(Boolean).join(' · ');
function swapSettings(){const P0=[0,.5,1,3],st={slip:S.slip||0,speed:SWS.speed,mev:SWS.mev};
 const seg=(k,items,cur)=>`<div class="seg wide sset" data-k="${k}" role="radiogroup">${items.map(([v,l])=>`<button type="button" role="radio" aria-checked="${cur===v}" class="${cur===v?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
 modal('Swap settings','',`<div class="ssec"><b>Max slippage</b>${seg('slip',P0.map(v=>[String(v),v?v+'%':'Auto']),String(st.slip))}
  <label class="solin ssin"><input id="sslip" class="num" inputmode="decimal" placeholder="Custom" value="${P0.includes(st.slip)?'':st.slip}" aria-label="Custom slippage"><span class="muted">%</span></label>
  <p class="hint">How far the price can move before your swap cancels. Auto lets Jupiter set it from live conditions.</p></div>
 <div class="ssec"><b>Speed</b>${seg('speed',[['auto','Auto'],['fast','Fast'],['turbo','Turbo'],['ultra','Ultra']],st.speed)}<p class="hint">Faster adds a priority fee (up to 0.0001, 0.001 or 0.005 SOL) so swaps land when Solana is busy.</p></div>
 <div class="ssec"><b>Front-running protection</b>${seg('mev',[['1','On'],['0','Off']],st.mev?'1':'0')}<p class="hint">Sends your swap through Jito with a tip so bots can't jump ahead of your buy.</p>
  <label class="solin ssin"><span class="hint">Tip</span><input id="stip" class="num" inputmode="decimal" value="${esc(SWS.tip)}" ${st.mev?'':'disabled'} aria-label="Tip amount in SOL"><span class="muted">SOL</span></label></div>
 <div class="err" id="sserr"></div><button class="btn primary block" id="ssave">Save settings</button>`,
 m=>{m.querySelectorAll('.sset').forEach(g=>g.onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;g.querySelectorAll('button').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-checked',x===b)});const k=g.dataset.k,v=b.dataset.v;
   if(k==='slip'){st.slip=+v;$('#sslip',m).value=''}else if(k==='speed')st.speed=v;else{st.mev=v==='1';$('#stip',m).disabled=!st.mev}});
  $('#sslip',m).oninput=e=>{const v=parseFloat(e.target.value);if(v>0){st.slip=v;m.querySelectorAll('[data-k="slip"] button').forEach(x=>x.classList.remove('on'))}};
  $('#ssave',m).onclick=()=>{const tip=parseFloat($('#stip',m).value),er=$('#sserr',m);if(!(st.slip>=0&&st.slip<=50)){er.textContent='Slippage can be at most 50%.';return}if(st.mev&&!(tip>=1e-4&&tip<=.1)){er.textContent='Tip must be between 0.0001 and 0.1 SOL.';return}
   S.slip=st.slip;Object.assign(SWS,{slip:st.slip,speed:st.speed,mev:st.mev,tip:st.mev?String(tip):SWS.tip});saveSWS();closeModal();renderSwaps();toast('Swap settings saved')}})}
function realSwap(from,to,amt,desc,done,opt={}){let base;try{base=baseOf(from,amt)}catch(e){toast(e.message);done&&done(false);return}
 /* Buying a new token opens a token account (~0.002 SOL rent) plus network fees. Spending SOL right down to zero makes the swap fail on-chain. */
 if(from==='SOL'&&S.balAt){const b=S.bal.SOL||0,room=Math.max(0,b-0.004);if(+amt>room){toast(room>0?`Keep ~0.004 SOL for network fees. You can spend up to ${+room.toFixed(4)} SOL`:'Not enough SOL. Deposit a little more to cover the buy and network fees');done&&done(false);return}}
 realTx(desc,step=>jupSwap({inputMint:mintOf(from),outputMint:mintOf(to),amount:base,taker:S.addr,slippageBps:S.slip?Math.round(S.slip*100):undefined,...swFees()},step).then(r=>{
  const od=decOf(to),got=r.outAmount&&od!=null?Number(r.outAmount)/10**od:null;
  const kind=from==='SOL'?'buy':to==='SOL'?'sell':'swap',pf=T[from]&&T[from].price;
  logTx({k:{buy:'Bought',sell:'Sold',swap:'Swapped'}[kind],kind,label:`${fmtAmt(amt)} ${symOf(from)} → ${got!=null?fmtAmt(got)+' ':''}${symOf(to)}`,signature:r.signature,in_mint:mintOf(from),in_amount:amt,out_mint:mintOf(to),out_amount:got,usd_value:pf?amt*pf:null,call_ref:opt.callRef!=null?String(opt.callRef):null});if(opt.after)setTimeout(()=>{try{opt.after(r)}catch(e){console.warn(e)}},1800);return r.signature}),done)}
const perf=k=>{const t=T[k.t];return !t||t.prelaunch||!k.entry?null:(mcap(t)/k.entry-1)*100};
function chart(seed,up,w=600,h=190){const r=rng(seed);let y=up?.25:.75,p=[];for(let i=0;i<72;i++){y+=(r()-.5)*.11+(up?.008:-.008);y=Math.min(.95,Math.max(.05,y));p.push(y)}
 const d=p.map((v,i)=>`${i?'L':'M'}${(i/71*w).toFixed(1)},${(h-v*h).toFixed(1)}`).join('');
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart" role="img" aria-label="Price chart"><path d="${d}L${w},${h}L0,${h}Z" class="area ${up?'up':'down'}"/><path d="${d}" class="line ${up?'up':'down'}"/></svg>`}
function qr(seed){const r=rng(seed),n=21,c=9;let o='';const f=(x,y)=>(x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const on=f(x,y)?((x%14===0||x%14===6||y%14===0||y%14===6)||(x%14>1&&x%14<5&&y%14>1&&y%14<5)):r()>.5;if(on)o+=`<rect x="${x*c}" y="${y*c}" width="${c}" height="${c}"/>`}
 return `<svg viewBox="0 0 ${n*c} ${n*c}" width="180" height="180" style="background:#fff;padding:10px;border-radius:14px" fill="#0B1B27">${o}</svg>`}
const ranked=()=>Object.values(C).filter(c=>c.real&&c.calls>=1).sort((a,b)=>b.win-a.win||b.avg-a.avg||b.calls-a.calls);
const rankOf=h=>{const i=ranked().findIndex(c=>c.h===h);return i<0?null:i+1};
const usd=(s,a)=>T[s].price*a;
/* Real wallets can only trade real tokens (demo tokens have made-up mints). */
const tradable=t=>t.chain==='Solana'&&!t.prelaunch&&(!REALW()||!!t.base||!!t.live);

/* ---------- post (X layout + pump call card) ---------- */
const money=n=>(n>=0?'+':'−')+fmtUsd(Math.abs(n));
function nums(k){const t=T[k.t];if(!t||t.prelaunch||!k.entry)return null;const mc=mcap(t),x=mc/k.entry,o={mc,p:(x-1)*100,up:x>=1};if(k.buy){const keep=1-((k.sold&&k.sold.pct)||0)/100;o.pos=k.buy*x*keep;o.pnl=k.buy*x-k.buy}return o}
function mkt(k){const n=nums(k);
 return k.buy?`<div class="cr2 num"><div><span>Position</span><b data-pos="${k.id}">${fmtUsd(n.pos)}</b></div><div><span>Profit</span><b class="${n.pnl>=0?'up':'down'}" data-pnl="${k.id}">${money(n.pnl)}</b></div></div>`
  :`<div class="cr2 num"><div><span>Called at</span><b>${fmtUsd(k.entry)}</b></div><div><span>Since call</span><b class="${n.up?'up':'down'}" data-perf="${k.id}">${fmtPct(n.p)}</b></div></div>`}
function post(k){if(k.kind==='random')return postRandom(k);if(k.kind==='perps')return postPerp(k);const t=T[k.t];if(!t)return '';const p=perf(k),r=rankOf(k.c);
 const right=p===null?`<div class="cr"><b>Soon</b><span>Launches ${esc(t.prelaunch)}</span></div>`:mkt(k);
 return `<article class="post${k.fresh?' fresh':''}" data-go="#/post/${k.id}" tabindex="0" aria-label="Call by ${esc(k.c)} on $${t.sym}">
 <a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile" class="pav">${avatar(k.c,'md')}</a>
 <div style="min-width:0">
  <div class="phead">${who(k.c)}${r&&!k.sponsored?`<span class="rk">#${r}</span>`:''}${k.sponsored?'<span class="tag">Sponsored</span>':''}${k.src==='telegram'?tgChip(k):''}${k.c!==S.me?`<button class="fchip${S.following.has(k.c)?' on':''}" data-act="follow" data-h="${k.c}" aria-label="${S.following.has(k.c)?'Following':'Follow'} ${esc(k.c)}">${S.following.has(k.c)?ic('check',12)+'<span>Following</span>':'+<span>Follow</span>'}</button>`:''}<time>${k.ago==='now'?'now':k.ago+' ago'}</time>${k.sponsored?'':moreBtn(k)}</div>
  <p class="ptext">${rich(k.thesis)}</p>${mediaGrid(k.media)}${quoteCard(k.quote)}
  <a class="ccard" href="#/token/${t.key}">${tokav(t.key)}<div class="cn"><b>${esc(t.name)}</b><span>$${t.sym} <span class="chain">${t.chain}</span></span></div>${right}</a>
  ${k.sponsored?`<div class="pnote">Paid promotion by ${esc(k.sponsor)}. Not counted in rankings.</div>`:`<div class="pnote">${k.target?`Target ${fmtUsd(k.target)} within ${esc(k.horizon)} · `:''}${k.buy?`<span class="bk">${ic('check',13)} Bought in</span>`:`<span class="bk no">No buy · earns ${EARN_RULE.noBuy}% after ${EARN_RULE.minX}X</span>`}${k.sold?` · <span class="sold">${ic('repost',13)} Caller sold ${k.sold.pct}% · ${k.sold.ago} ago</span>`:''}</div>`}
  <div class="pbar"><div class="icons">
   <button class="act" data-act="reply" aria-label="Reply">${ic('reply',18)}<span class="num">${k.replies||''}</span></button>
   <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',18)}<span class="num">${(k.reposts||0)+quotesOf(k.id)||''}</span></button>
   <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',18,k.liked)}<span class="num">${k.likes||''}</span></button>
   <span class="act views" aria-label="Views">${ic('views',18)}<span class="num">${fmtK(k.views||0)}</span></span>
   ${xacts(k)}<button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',18)}</button></div>
   ${p===null?'':`<span class="pright"><a class="mc num ${nums(k).up?'up':'down'}" href="#/token/${t.key}" data-mc="${k.id}" title="Trade $${t.sym}">${fmtUsd(mcap(t))}<small>MC</small></a>${tradable(t)?`<span class="bsrow"><button class="btn primary sm buyb" data-act="qbuy" data-t="${t.key}" data-id="${k.id}">Buy</button>${S.connected&&S.bal[t.key]>0?`<button class="btn sm sellq" data-act="qsell" data-t="${t.key}" data-id="${k.id}">Sell</button>`:''}</span>`:''}</span>`}
  </div></div></article>`}

/* Telegram calls: posted as the group shows who dropped the CA; posted as a linked caller shows the group. */
function tgChip(k){const [grp,by]=(k.srcLabel||'Telegram').split(' · ');return `<span class="tgchip" title="Called in ${esc(grp)} on Telegram${by?' by '+esc(by):''}">${ic('telegram',12)}<span>${esc(by||grp)}</span></span>`}
/* ---------- ads ---------- */
const adMedia=a=>`<div class="admedia" style="background:linear-gradient(135deg,${a.g[0]},${a.g[1]})"><b>${esc(a.title)}</b>${ic(a.ic,40)}</div>`;
function adPost(a){return `<article class="post">
 <span class="av md" style="background:${a.g[0]}">${esc(a.brand.slice(0,2).toUpperCase())}</span>
 <div style="min-width:0"><div class="phead"><span class="pname">${esc(a.brand)}</span><span class="hint">@${esc(a.h)}</span><span class="tag">Ad</span></div>
 <p class="ptext">${esc(a.text)}</p>
 <div class="adcard" data-act="adclick" data-id="${a.id}">${adMedia(a)}<div class="adfoot"><div><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></div><button class="btn sm primary" data-act="adclick" data-id="${a.id}">${esc(a.cta)}</button></div></div>
 <div class="pnote">Promoted. Not a call and not counted in rankings.</div></div></article>`}
/* Ads are paused until real advertisers come in. The Promote page stays so people know it exists. Flip to true to bring the ad board and in-feed ads back. */
const ADS_ON=false;
function withAds(list){if(!ADS_ON)return list.map(post).join('');let out='',n=0;list.forEach((k,i)=>{out+=post(k);if((i+1)%AD_EVERY===0&&i<list.length-1)out+=adPost(ADS[(S.adRot+n++)%ADS.length])});return out}
function adBoard(){if(!ADS_ON)return '';const a=ADS[S.board%ADS.length];
 return `<div class="card adboard" id="adboard"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Ad board</h3><span class="adlbl">Promoted</span></div>
 <div class="adslide adcard" data-act="adclick" data-id="${a.id}">${adMedia(a)}<div class="adfoot"><div><b>${esc(a.brand)}</b><span>${esc(a.sub)}</span></div><button class="btn sm primary" data-act="adclick" data-id="${a.id}">${esc(a.cta)}</button></div></div>
 <div class="dots">${ADS.map((_,i)=>`<button class="${i===S.board%ADS.length?'on':''}" data-act="adgo" data-f="${i}" aria-label="Show ad ${i+1}"></button>`).join('')}</div></div>`}

/* ---------- swap widget ---------- */
const FEE_RESERVE=0.01;
const maxOf=sym=>{const b=S.bal[sym]||0;const v=sym==='SOL'?Math.max(0,b-FEE_RESERVE):b;return String(+v.toFixed(6))};
const impact=(sym,usdIn)=>{const t=T[sym];return t&&t.liq?usdIn/(t.liq/2+usdIn)*100:0};
function swapHTML(tok){const w=S.swap,side=tok?(w.from===tok?'sell':'buy'):null,f=T[w.from],t=T[w.to],a=parseFloat(w.amt)||0,out=a?usd(w.from,a)*.995/t.price:0,imp=a?impact(w.to,usd(w.from,a)):0,sl=S.slip||0;
 const opts=sel=>Object.values(T).filter(tradable).map(x=>`<option ${x.sym===sel?'selected':''}>${x.sym}</option>`).join('');
 let label='Swap',dis=false;const warn=a&&imp>5?`<div class="swarn ${imp>15?'bad':''}">${ic('bell',15)} ${imp>15?'Very high':'High'} price impact. Thin liquidity on $${t.sym}.</div>`:'';
 const held=tok?(S.bal[tok]||0):0;
 if(!S.connected)label='Connect wallet';else if(side==='sell'&&!held){label=`You don't hold $${symOf(tok)}`;dis=true}else if(!a){label='Enter an amount';dis=true}else if(a>(S.bal[w.from]||0)){label=`Not enough ${symOf(w.from)}`;dis=true}else if(side)label=`${side==='sell'?'Sell':'Buy'} $${symOf(tok)}`;
 const tabs=tok?`<div class="bstabs" role="tablist" aria-label="Buy or sell"><button role="tab" aria-selected="${side==='buy'}" class="${side==='buy'?'on buy':''}" data-act="tside" data-f="buy" data-t="${tok}">Buy</button><button role="tab" aria-selected="${side==='sell'}" class="${side==='sell'?'on sell':''}" data-act="tside" data-f="sell" data-t="${tok}">Sell${held?` <span class="num">${fmtAmt(held)}</span>`:''}</button></div>`:'';
 const quick=S.connected&&(S.bal[w.from]||0)>0?(side==='sell'?[['.25','25%'],['.5','50%'],['.75','75%'],['1','Max']]:[['.5','Half'],['1','Max']]).map(([f,l])=>`<button class="mx" data-act="swmax" data-f="${f}">${l}</button>`).join(''):'';
 if(S.swUsd&&w.amt!==w._ua){w.usdTxt=w.amt&&f.price?String(+(+w.amt*f.price).toFixed(2)):'';w._ua=w.amt}
 return `${tabs}<div class="swap${side?' side-'+side:''}"><div class="swhead"><span class="hint">${tok?'':'Swap'}</span><button type="button" class="swset" data-act="swapset" aria-label="Swap settings">${ic('cog',16)}<span>${swSummary()}</span></button></div><div class="box"><div class="row"><span class="hint">${side==='sell'?'You sell':'You pay'}</span><span class="balx"><span class="hint num">Balance ${fmtAmt(S.bal[w.from]||0)}</span>${quick}</span></div>
  <div class="row">${S.swUsd?'<span class="usdpre num">$</span>':''}<input class="amt num" inputmode="decimal" placeholder="0" value="${esc(S.swUsd?(w.usdTxt||''):w.amt)}" data-swap="amt" aria-label="Amount to pay in ${S.swUsd?'USD':esc(f.sym)}">${tbtn('from',w.from)}</div>
  <div class="hint num swalt"><span>${S.swUsd?`≈ ${a?fmtAmt(a):'0'} ${esc(f.sym)}`:(a?fmtUsd(usd(w.from,a)):'$0')}</span><button type="button" class="unitsw" data-act="swunit" title="Type the amount in ${S.swUsd?esc(f.sym):'USD'}" aria-label="Switch amount to ${S.swUsd?esc(f.sym):'USD'}">${ic('swap',12)}<span>${S.swUsd?esc(f.sym):'USD'}</span></button></div></div>
  <button class="flip" data-act="flip" aria-label="Flip tokens">${ic('swap',16)}</button>
  <div class="box"><div class="row"><span class="hint">You get</span><span class="hint num">Balance ${fmtAmt(S.bal[w.to]||0)}</span></div>
  <div class="row"><div class="amt num">${out?fmtAmt(out):'0'}</div>${tbtn('to',w.to)}</div></div>
  <div class="lines num"><div><span>Rate</span><span>1 ${f.sym} = ${fmtAmt(f.price/t.price)} ${t.sym}</span></div>${REALW()?'':'<div><span>Callit fee</span><span>0.5% (placeholder)</span></div>'}<div><span>Max slippage</span><span class="slips">${[0,.5,1,3].map(v=>`<button class="${sl===v?'on':''}" data-act="slip" data-f="${v}">${v?v+'%':'Auto'}</button>`).join('')}</span></div>
  ${a?`<div><span>Price impact</span><span class="${imp>15?'down':imp>5?'warn':'up'}">${imp<.01?'<0.01':imp.toFixed(2)}%</span></div>${sl?`<div><span>Minimum received</span><span>${fmtAmt(out*(1-sl/100))} ${t.sym}</span></div>`:''}`:''}<div><span>Route</span><span>Jupiter</span></div></div>
  ${warn}<button class="btn primary block${side==='sell'&&S.connected?' sellb':''}" data-act="${S.connected?'doswap':'connect'}" ${dis?'disabled':''}>${label}</button></div>`}
const tbtn=(k,sym)=>`<button class="tpick" data-act="tpick" data-f="${k}" aria-label="${k==='from'?'Pay':'Receive'} token, ${esc(symOf(sym))}">${tokav(sym)}<b>${esc(symOf(sym))}</b>${ic('down',16)}</button>`;
function pickToken(k){const w=S.swap,cur=w[k],all=Object.values(T).filter(tradable);let q='';
 const pop=['SOL','USDC',...['GLORP','KFSH','NIMB'].map(k=>LIVEMAP[k]||k)].filter(x=>T[x]);
 const row=t=>{const bal=S.bal[t.key]||0;return `<button class="tok${t.sym===cur?' cur':''}" data-pick="${t.key}">${tokav(t.key)}<span class="grow"><b>${esc(t.sym)}</b><span class="hint">${esc(t.name)}</span></span><span class="r num">${bal?`<b>${fmtAmt(bal)}</b><span class="hint">${fmtUsd(bal*t.price)}</span>`:`<b>${fmtPrice(t.price)}</b><span class="hint ${t.chg>=0?'up':'down'}">${fmtPct(t.chg)}</span>`}</span>${t.sym===cur?ic('check',18):''}</button>`};
 const draw=m=>{const f=all.filter(t=>!q||(t.sym+' '+t.name+' '+(t.ca||'')).toLowerCase().includes(q)),mine=f.filter(t=>S.bal[t.key]>0).sort((a,b)=>S.bal[b.sym]*b.price-S.bal[a.sym]*a.price),rest=f.filter(t=>!(S.bal[t.key]>0));
  $('#tl',m).innerHTML=(mine.length?`<div class="tsec">Your tokens</div>${mine.map(row).join('')}`:'')+(rest.length?`<div class="tsec">All tokens</div>${rest.map(row).join('')}`:'')||'<div class="empty"><b>No token found</b><p>Try a ticker, name or contract address.</p></div>'};
 modal(k==='from'?'You pay with':'You receive','',`<div class="tsearch">${ic('search',18)}<input id="tq" placeholder="Search name, ticker or paste CA" autocomplete="off"></div>
  <div class="tpop">${pop.map(x=>`<button class="chip${x===cur?' on':''}" style="--c:var(--hi)" data-pick="${x}">${tokav(x)}${esc(symOf(x))}</button>`).join('')}</div><div class="tlist" id="tl"></div>`,
 m=>{draw(m);$('#tq',m).addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();draw(m)});
  m.addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;const v=b.dataset.pick,o=k==='from'?'to':'from';if(w[o]===v)w[o]=w[k];w[k]=v;closeModal();renderSwaps()})})}
const renderSwaps=()=>document.querySelectorAll('[data-swapbox]').forEach(el=>{el._stale=0;el.innerHTML=swapHTML(el.dataset.tok||null)});
/* Background refreshes (live price ticks, balances) must never rebuild a swap box while the user is typing in it:
   replacing the input closes the phone keyboard. Mark it stale and redraw once they leave the field. */
const swapBusy=el=>{const a=document.activeElement;return !!a&&el.contains(a)&&a.matches('input,textarea,select')};
const renderSwapsSoft=()=>document.querySelectorAll('[data-swapbox]').forEach(el=>{if(swapBusy(el)){el._stale=1;return}el._stale=0;el.innerHTML=swapHTML(el.dataset.tok||null)});
document.addEventListener('focusout',e=>{const box=e.target.closest&&e.target.closest('[data-swapbox]');if(!box||!box._stale)return;
 setTimeout(()=>{if(box.isConnected&&!swapBusy(box)){box._stale=0;box.innerHTML=swapHTML(box.dataset.tok||null)}},150)});

/* ---------- views ---------- */
function homeTabs(){return catBar()+`<div class="tabs" role="tablist">${[['foryou','For you'],['following','Following'],['community','Community'],['watchlist','Watchlist']].map(([k,l])=>`<button role="tab" aria-selected="${S.tab===k}" class="${S.tab===k?'on':''}" data-act="tab" data-f="${k}">${l}</button>`).join('')}</div>`}
function vHome(){let list=calls.filter(k=>visible(k)&&(S.cat==='all'||catOf(k)===S.cat)),empty=catEmpty();
 if(S.cat==='perps'&&S.tab!=='community')return homeTabs()+perpsLocked();
 if(S.tab==='community')return homeTabs()+vCommunity();
 if(S.live==='wait')return homeTabs()+`<div id="feed" aria-busy="true">${Array.from({length:4},()=>`<div class="post pskel" aria-hidden="true"><span class="av md"></span><div><i></i><i></i><i></i><b></b></div></div>`).join('')}<p class="sr-only" role="status">Loading live calls</p></div>`;
 if(S.tab==='following'){list=list.filter(k=>S.following.has(k.c));
  empty=`<div class="pad"><div class="empty" style="padding:28px 12px 8px"><b class="h2">Follow callers you trust</b><p>Their calls land here the moment they post.</p></div>
  ${ranked().slice(0,4).map(c=>`<div class="sugg">${avatar(c.h,'md')}<div class="grow"><a class="pname" href="#/profile/${c.h}">${c.h}</a><div class="hint">${c.win}% win rate over ${c.calls} calls</div></div><button class="btn sm primary" data-act="follow" data-h="${c.h}">Follow</button></div>`).join('')}</div>`}
 if(S.tab==='watchlist')return homeTabs()+vWatch();
 return `${homeTabs()}
 <div class="newpill" id="newpill">${S.queued.length&&S.tab==='foryou'?newPill():''}</div>
 ${S.tab==='foryou'&&(S.cat==='meme'||S.cat==='all')?topTrades():''}
 ${S.tab==='foryou'?pinnedPost():''}
 <div id="feed">${(S.tab==='foryou'?withAds(list):list.map(post).join(''))||empty}</div>`}
/* Watchlist: just the token, price, volume and market cap, with Buy / Sell that open the real trade sheet. */
let WLOAD=0;
function watchFill(){const miss=[...S.watch].filter(k=>isMintStr(k)&&(!T[k]||!T[k].live));const now=Date.now();
 if(!miss.length||now-WLOAD<8000)return;WLOAD=now;fetchTokens(miss.slice(0,50)).then(l=>{l.forEach(regLive);if(S.tab==='watchlist'&&currentRoute()==='home')render()}).catch(()=>{})}
function wrow(t){const key=t.key,h=S.bal[key]||0,ch=chgOf(t,'24h'),can=tradable(t);
 return `<div class="wrow" data-go="#/token/${esc(key)}">${tokav(key)}<div class="wname"><b>${esc(t.name||t.sym)}</b><span class="hint">$${esc(t.sym)}${ch!=null?` · <span class="${pcls(ch)}">${pctS(ch)}</span>`:''}</span></div>
 <div class="wnums num"><div><span>Price</span><b data-wpx="${esc(key)}">${t.price?fmtSmall(t.price):'—'}</b></div><div><span>Vol</span><b>${t.vol?fmtSmall(t.vol):'—'}</b></div><div><span>MC</span><b data-wmc="${esc(key)}">${t.price?fmtSmall(mcap(t)):'—'}</b></div></div>
 <div class="wbtns">${can?`<button class="btn primary sm" data-act="qbuy" data-t="${esc(key)}">Buy</button><button class="btn sm sellq${h>0?'':' dim'}" data-act="${h>0?'qsell':'nosell'}" data-t="${esc(key)}">Sell</button>`:''}<button class="ib sm wrm" data-act="track" data-t="${esc(key)}" aria-label="Remove $${esc(t.sym)} from watchlist" title="Remove">${ic('star',17,true)}</button></div></div>`}
/* Watchlist has two sides: tokens you star, and outside wallets you track (same list as Alerts). */
const WB={};
function wbLoad(a){const w=WB[a];if(w&&(w.busy||Date.now()-w.at<6e4))return;WB[a]={...(w||{}),busy:1};
 walletBalances(a).then(r=>{const miss=r.tokens.map(x=>x.mint).filter(m=>!T[keyOfMint(m)]);WB[a]={r,at:Date.now()};
  return miss.length?fetchTokens(miss.slice(0,50)).then(l=>l.forEach(regLive)).catch(()=>{}):null}).catch(()=>{WB[a]={err:1,at:Date.now()}})
  .finally(()=>{if(WB[a])WB[a].busy=0;if(S.tab==='watchlist'&&S.wtab==='wallets'&&currentRoute()==='home'&&!document.querySelector('#modal .modal'))render()})}
function wbHold(a){const r=WB[a]&&WB[a].r;if(!r)return null;const rows=[['SOL',r.sol]].concat(r.tokens.map(x=>[keyOfMint(x.mint),x.ui])).map(([k,amt])=>({k,amt,usd:T[k]&&T[k].price?amt*T[k].price:0})).filter(x=>x.amt>0).sort((a,b)=>b.usd-a.usd);
 return {rows,tot:rows.reduce((s,x)=>s+x.usd,0)}}
function vWatchWallets(){if(!S.connected)return `<div class="empty"><b class="h2">Track any wallet</b><p>Sign in to follow KOLs, whales and devs and get a pop-up on every buy and sell.</p><button class="btn primary" data-act="connect">Sign in</button></div>`;
 alLoad();const L=(AL.d&&AL.d.wallets)||(!SYNC()||AL.err?[]:null);if(L&&SYNC())L.forEach(w=>wbLoad(w.address));
 return `<div class="pad wwal"><div class="alform"><input id="alw" placeholder="Paste a wallet address" autocomplete="off" spellcheck="false"><input id="all" placeholder="Name (optional)" maxlength="30"><button class="btn primary" data-act="aladd">Track</button></div>
 ${AL.err?`<p class="rdnote">${esc(AL.err)}</p>`:''}${!L?rskel(3):!L.length?`<div class="empty" style="padding:24px 8px"><b>No wallets tracked yet</b><p>Paste a KOL, whale or dev wallet. You'll see what they hold here and get a pop-up on every swap.</p></div>`
 :`<div class="list">${L.map(w=>{const h=wbHold(w.address),top=h?h.rows.filter(x=>x.k!=='SOL'&&x.k!=='USDC').slice(0,3):[];
  return `<div class="li wwrow" data-act="wbopen" data-f="${esc(w.address)}" role="button" tabindex="0"><span class="tokav alwav">${ic('wallet',16)}</span><div class="grow"><b>${esc(w.label||short(w.address))}</b><div class="hint">${short(w.address)}${top.length?' · '+top.map(x=>'$'+esc(symOf(x.k))).join(' '):''}</div></div>
  <div class="r num"><b>${h?fmtUsd(h.tot):WB[w.address]&&WB[w.address].err?'—':'…'}</b><div class="hint">${h?fmtAmt(h.rows.find(x=>x.k==='SOL')?.amt||0)+' SOL':''}</div></div></div>`}).join('')}</div>`}
 <p class="hint" style="margin-top:12px">Pop-ups for these wallets are in <a class="lnk" href="#/alerts">Alerts</a>.</p></div>`}
function walletSheet(a){const w=((AL.d&&AL.d.wallets)||[]).find(x=>x.address===a)||{address:a},h=wbHold(a);
 aSheet(esc(w.label||short(a)),`<div class="ashead"><span class="tokav alwav">${ic('wallet',16)}</span><span class="grow"><b>${esc(w.label||short(a))}</b><small class="num">${short(a)}${h?' · '+fmtUsd(h.tot):''}</small></span></div>`,
  `<div class="asgroup">${h&&h.rows.length?h.rows.slice(0,12).map(x=>`<a class="asrow" href="#/token/${esc(tokPath(x.k))}" data-act="close">${T[x.k]?tokav(x.k):''}<span class="grow"><b>${esc(T[x.k]?T[x.k].name:short(x.k))}</b><small class="num">${fmtAmt(x.amt)} ${esc(symOf(x.k))}</small></span><b class="num">${x.usd?fmtUsd(x.usd):''}</b></a>`).join(''):'<p class="hint" style="padding:12px">Loading holdings…</p>'}</div>
  <div class="asgroup">${arow(`data-act="copy" data-v="${esc(a)}"`,'copy','Copy address','')}${arow(`data-act="aldel" data-f="${esc(a)}"`,'x','Stop tracking','')}</div>
  <div class="asgroup"><a class="asrow" href="https://solscan.io/account/${esc(a)}" target="_blank" rel="noopener"><span class="asic">${ic('search',19)}</span><span class="grow"><b>Open on Solscan</b></span></a></div>`)}
function vWatch(){const wt=S.wtab==='wallets'?'wallets':'tokens';
 const seg=`<div class="pad" style="padding-bottom:0"><div class="seg wide wtog" role="tablist">${[['tokens','Tokens'],['wallets','Wallets']].map(([k,l])=>`<button role="tab" aria-selected="${wt===k}" class="${wt===k?'on':''}" data-act="wtab" data-f="${k}">${l}</button>`).join('')}</div></div>`;
 return seg+(wt==='wallets'?vWatchWallets():vWatchTokens())}
function vWatchTokens(){watchFill();const keys=[...S.watch],rows=keys.map(k=>T[k]).filter(t=>t&&!t.base),wait=keys.filter(k=>!T[k]&&isMintStr(k)).length;
 if(!keys.length)return `<div class="empty"><b class="h2">Your watchlist is empty</b><p>Tap the star on any token in the Market, Search or on a call and it shows up here with live price, volume and market cap.</p><a class="btn primary" href="#/market">Browse the market</a></div>`;
 return `<div class="wlist">${rows.map(wrow).join('')}${wait?`<div class="wrow skel" aria-hidden="true"><span class="tokav"></span><div class="wname"><i></i><i></i></div></div>`.repeat(Math.min(wait,3)):''}</div>
 <p class="hint pad">Prices update live. Buy and Sell swap through Jupiter from your own wallet.</p>`}
/* Bookmarks: posts you saved, newest saved first. Posts not in the loaded feed are fetched by id. */
let BLOAD=0;
function vBookmarks(){const ids=[...S.bm].reverse(),have=new Map(calls.map(k=>[String(k.id),k]));
 const miss=ids.filter(id=>!have.has(id)&&/^[0-9a-f-]{36}$/i.test(id));
 if(miss.length&&Date.now()-BLOAD>10000){BLOAD=Date.now();API('/api/posts?ids='+miss.slice(0,60).join(',')).then(j=>{if(mergePosts(j.posts||[])&&currentRoute()==='bookmarks')render()}).catch(()=>{})}
 const list=ids.map(id=>have.get(id)).filter(k=>k&&visible(k));
 if(!S.bm.size)return `<div class="empty"><span class="eic">${ic('bookmark',26)}</span><b class="h2">Save posts for later</b><p>Tap the bookmark on any call or post. Only you can see what you save.</p><a class="btn primary" href="#/home">Go to Home</a></div>`;
 return `<div class="pad bmhead"><span class="muted">${S.bm.size} saved</span><button class="lnk" data-act="bmclear">Clear all</button></div><div id="feed">${list.map(post).join('')}${miss.length&&list.length<ids.length?`<div class="post pskel" aria-hidden="true"><span class="av md"></span><div><i></i><i></i><i></i><b></b></div></div>`:''}</div>`}
/* #tag feed: loaded posts with the tag, plus anything older from the server. */
const TAGQ={};
function vTag(tag){tag=String(tag||'').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,40);if(!tag)return `<div class="empty"><b class="h2">No tag</b></div>`;
 const has=k=>new RegExp('(^|[^A-Za-z0-9_])#'+tag+'(?![A-Za-z0-9_])','i').test(k.thesis||'');
 const q=TAGQ[tag];if(!q&&SYNC()){TAGQ[tag]='busy';API('/api/posts?limit=60&tag='+encodeURIComponent(tag)).then(j=>{mergePosts(j.posts||[]);TAGQ[tag]='ok'}).catch(()=>{TAGQ[tag]='err'}).finally(()=>{if(currentRoute()==='tag')render()})}
 const list=calls.filter(k=>visible(k)&&has(k));
 return `<div class="pad taghead"><span class="tagic">#</span><div><b class="h2">#${esc(tag)}</b><div class="hint">${list.length} post${list.length===1?'':'s'}</div></div><button class="btn sm primary" data-act="tagpost" data-f="${esc(tag)}" style="margin-left:auto">Post with #${esc(tag)}</button></div>
 <div id="feed">${list.map(post).join('')||(TAGQ[tag]==='busy'?`<div class="post pskel" aria-hidden="true"><span class="av md"></span><div><i></i><i></i><i></i><b></b></div></div>`:`<div class="empty"><b>Nothing tagged #${esc(tag)} yet</b><p>Be the first. Add #${esc(tag)} to your next call or post.</p></div>`)}</div>`}
const newPill=()=>`<button data-act="shownew">${S.queued.slice(0,2).map(k=>avatar(k.c)).join('')}<span style="margin-left:${S.queued.length>1?-8:0}px"></span>New calls</button>`;

function vMarket(){const rows=Object.values(T).filter(t=>!t.base);
 return `<div class="tablewrap"><table><thead><tr><th>Token</th><th>Price</th><th>Market cap</th><th>24h</th><th>Calls</th><th></th></tr></thead><tbody>
 ${rows.map(t=>`<tr data-go="#/token/${t.key}"><td><div class="person">${tokav(t.key)}<div>${esc(t.name)}<div class="hint">$${t.sym} <span class="chain">${t.chain}</span></div></div></div></td>
 <td class="num">${t.prelaunch?'—':fmtPrice(t.price)}</td><td class="num">${t.prelaunch?'Launches '+t.prelaunch:fmtUsd(mcap(t))}</td><td class="num ${t.chg>=0?'up':'down'}">${t.prelaunch?'':fmtPct(t.chg)}</td><td class="num">${calls.filter(k=>k.t===t.sym).length}</td>
 <td><button class="ib" data-act="track" data-t="${t.key}" aria-label="Add ${t.sym} to watchlist" style="color:${S.watch.has(t.key)?'var(--hi)':'var(--muted)'}">${ic('star',20,S.watch.has(t.key))}</button></td></tr>`).join('')}</tbody></table></div>`}

const ageStr=h=>h<1/60?Math.max(1,Math.round(h*3600))+'s':h<1?Math.round(h*60)+'m':h<48?Math.round(h)+'h':h<24*60?Math.round(h/24)+'d':h<24*365?Math.floor(h/24/30)+'mo':Math.floor(h/24/365)+'y';
const mcCls=m=>m>=1e5?'mb':m>=2e4?'up':'my';
function trenchStats(t){if(t.live){const L=t.L||{},a=L.audit||{},bs=(L.buys24||0)+(L.sells24||0);
  return {top:a.top10==null?null:Math.round(a.top10),dev:a.dev==null?null:Math.round(a.dev*10)/10,snip:null,ins:null,fees:null,tx:bs,buys:bs?L.buys24/bs:.5}}
 const r=rng(t.seed*97);const pct=(a,b)=>Math.round(a+r()*(b-a));
 if(!t._x)t._x={top:pct(0,t.ageH<1?9:3),dev:t.ageH<1?pct(8,38):pct(0,2),snip:pct(0,t.ageH<1?4:1),ins:pct(0,26),fees:(t.vol/1e6)*(20+r()*40),tx:Math.round(t.vol/(60+r()*40)),buys:.45+r()*.3};return t._x}

/* ---------- Heat: one live class per token from momentum, buy pressure, holder growth and safety ---------- */
const HEAT={runner:['🚀','Runner','Fast market-cap velocity, heavy buy pressure, holders climbing'],heating:['🔥','Heating','Momentum is building'],fresh:['🌱','Fresh','Under 10 minutes old, still finding its feet'],
 second:['🔁','Second Wind','Dumped, then reclaimed with new buyers'],cooling:['🧊','Cooling','Momentum is fading'],danger:['☠️','Danger','Bundled, dev dumping, or top holders own too much'],steady:['〰️','Steady','No strong move either way']};
const clp=(v,a,b)=>Math.max(a,Math.min(b,v));
const holderGrowth=t=>{const h=t&&t._hh;if(!h||h.length<2)return 0;const z=h[h.length-1],b=h[0],mins=(z[0]-b[0])/6e4;return mins<.5?0:(z[1]-b[1])/mins};
const flowOf=(L,k)=>{const f=L&&L.flow&&L.flow[k];return f&&(f.bv+f.sv)>0?f:null};
function heatOf(t){if(!t||!t.live)return {k:'steady',s:0};const L=t.L||{},a=L.audit||{},c=L.chg||{},f5=flowOf(L,'m5'),f1=flowOf(L,'h1');
 const m1=chg1m(t),m5=chg5mLive(t)??c.m5,h1=c.h1,h6=c.h6,h24=c.h24,fl=f5||f1,dsx=(()=>{const P=PAIRS[t.key];if(!P||!P.d||Date.now()-P.at>3e4)return null;const x=(P.d.pairs||[])[0],tx=x&&x.txns&&x.txns.m5;return tx&&tx.buys+tx.sells>=4?tx.buys/(tx.buys+tx.sells):null})(),bp=dsx!=null?dsx:fl?fl.bv/(fl.bv+fl.sv):null,vol5=f5?f5.bv+f5.sv:null,hg=holderGrowth(t),ageM=(t.ageH||0)*60;
 const bun=t._risk&&t._risk.bundle&&t._risk.bundle.pct!=null?t._risk.bundle.pct:null;
 const danger=!!a.sus||(a.top10!=null&&a.top10>45)||(a.dev!=null&&a.dev>15)||(bun!=null&&bun>25)||(m5!=null&&m5<-35);
 const s=Math.round(clp(50+clp((m5||0)*1.2,-30,35)+clp((m1||0)*2,-15,20)+(bp!=null?(bp-.5)*60:0)+clp(hg*3,-10,15)+(vol5?Math.min(10,Math.log10(vol5+1)*2.5):0)-(danger?25:0),0,100));
 let k='steady';
 if(danger)k='danger';
 else if(((m5||0)>=25||(h1||0)>=80)&&(bp==null||bp>=.58)&&(m1==null||m1>-3)&&(vol5==null||vol5>3000))k='runner';
 else if(((h6!=null&&h6<=-35)||(h24!=null&&h24<=-45))&&(m5||0)>=8&&(bp==null||bp>=.55))k='second';
 else if(ageM<10)k='fresh';
 else if(((m5||0)>=8||(m1!=null&&m1>=4))&&(bp==null||bp>=.52))k='heating';
 else if((m5!=null&&m5<=-8)||(h1!=null&&h1<=-20&&(m5||0)<=0))k='cooling';
 return {k,s,m1,m5,bp,hg,vol5}}
/* Bought-in Callit callers on this token. Nobody else can show this: only Callit has verified calls. */
const backers=t=>new Set(calls.filter(k=>k.t===t.key&&k.buy>0&&!k.sponsored).map(k=>k.c)).size;
const heatChip=(t,h)=>{const [e,l,d]=HEAT[h.k];return h.k==='steady'?'':`<span class="heat h-${h.k}" title="${esc(l)}: ${esc(d)}. Heat ${h.s}/100">${e} ${l}</span>`};
const backChip=t=>{const n=backers(t);return n?`<span class="heat h-called" title="${n} Callit caller${n>1?'s':''} bought in">📣 ${n}</span>`:''};
/* Motion: milestone effects play once per token, the first render after the event. */
const MCSTEPS=[1e5,5e5,1e6,1e7,1e8];
function fxOf(t,h){const now=Date.now(),b=bond(t),m=mcap(t);let fx=t._fx&&t._fx.u>now?t._fx:null;
 if(t._bd!=null){if(t._bd<100&&b>=100)fx={c:'fx-grad',lab:'🎓 Graduated',u:now+5200};else if(t._bd<80&&b>=80&&b<100)fx={c:'fx-hot',lab:'Almost bonded',u:now+5200}}
 if(t._mcl!=null){const st=MCSTEPS.filter(v=>t._mcl<v&&m>=v).pop();if(st)fx={c:'fx-mc',lab:'🏅 '+fmtUsd(st).replace('.00','')+' MC',u:now+5200}}
 if(t._hk&&t._hk!==h.k&&['runner','second'].includes(h.k)&&!fx)fx={c:'fx-heat',lab:HEAT[h.k][0]+' '+HEAT[h.k][1],u:now+5200};
 t._bd=b;t._mcl=m;t._hk=h.k;t._fx=fx;
 const f1=flowOf(t.L,'h1'),f5=flowOf(t.L,'m5'),spike=f1&&f5&&(f5.bv+f5.sv)>3*((f1.bv+f1.sv)/12)&&(f5.bv+f5.sv)>5000;
 return {cls:(fx?' '+fx.c:'')+(b>=80&&b<100?' fx-near':'')+(spike?' fx-beat':''),tag:fx&&fx.lab?`<span class="fxtag">${esc(fx.lab)}</span>`:''}}
const HEATF=(()=>{try{return JSON.parse(localStorage.getItem('callit.heat')||'{}')}catch(_){return {}}})();
const saveHeat=()=>{try{localStorage.setItem('callit.heat',JSON.stringify(HEATF))}catch(_){}};
function heatBar(all){const cnt={};all.forEach(t=>{const k=heatOf(t).k;cnt[k]=(cnt[k]||0)+1;if(backers(t))cnt.called=(cnt.called||0)+1});
 const chip=(k,l)=>`<button type="button" class="hchip${HEATF.k===k?' on':''}" data-act="heatf" data-f="${k}" aria-pressed="${HEATF.k===k}">${l}${cnt[k]?` <b class="num">${cnt[k]}</b>`:''}</button>`;
 return `<div class="heatbar" role="group" aria-label="Heat classes">${chip('runner','🚀 Runners')}${chip('heating','🔥 Heating')}${chip('fresh','🌱 Fresh')}${chip('second','🔁 Second Wind')}${chip('called','📣 Caller-backed')}${chip('cooling','🧊 Cooling')}
 <button type="button" class="hchip dz${HEATF.hide?' on':''}" data-act="heatdz" aria-pressed="${!!HEATF.hide}">☠️ ${HEATF.hide?'Danger hidden':'Hide danger'}${cnt.danger?` <b class="num">${cnt.danger}</b>`:''}</button></div>`}
function heatApply(rows){if(!rows)return rows;let r=rows;if(HEATF.hide)r=r.filter(t=>heatOf(t).k!=='danger');
 if(HEATF.k==='called')r=r.filter(t=>backers(t)).sort((a,b)=>backers(b)-backers(a)||heatOf(b).s-heatOf(a).s);
 else if(HEATF.k)r=r.filter(t=>heatOf(t).k===HEATF.k).sort((a,b)=>heatOf(b).s-heatOf(a).s);return r}
/* ---------- AI Auto: one tap for people who don't want to tune filters. Ranks tokens by their odds of
   being a good entry: hard safety gates first (a rug can't be a win), then real demand, healthy
   liquidity, room to run, bought-in callers, and it marks tops so users don't buy someone's exit. ---------- */
const AIM={balanced:['🎯','Balanced','Safety and upside together. Start here.',50],safe:['🛡️','Safe plays','Clean holders, real liquidity, steady buyers. Fewer picks, fewer rugs.',58],early:['🌱','Early gems','Newer and riskier. For small bets on big upside.',45]};
const AIG={safe:{top:25,dev:8,bun:15,liq:8e3,ageMin:15,ageMax:43200},balanced:{top:35,dev:12,bun:25,liq:3e3,ageMin:3,ageMax:10080},early:{top:45,dev:15,bun:30,liq:1500,ageMin:0,ageMax:180}};
const AIW={balanced:{S:.28,D:.22,T:.15,F:.10,K:.10,R:.08,Q:.07},safe:{S:.38,D:.18,T:.10,F:.08,K:.10,R:.06,Q:.10},early:{S:.20,D:.28,T:.18,F:.12,K:.10,R:.10,Q:.02}};
const c01=v=>Math.max(0,Math.min(1,v));
const aiGrade=s=>s>=80?['strong','Strong']:s>=65?['good','Good']:s>=50?['watch','Watch']:['weak','Weak'];
function aiOf(t,mode){if(!t||!t.live||!AIM[mode])return null;
 const L=t.L||{},a=L.audit||{},c=L.chg||{},x=trenchStats(t),H=heatOf(t),m=mcap(t)||0,liq=t.liq||0,ageM=(t.ageH||0)*60,G=AIG[mode];
 const bun=t._risk&&t._risk.bundle&&t._risk.bundle.pct!=null?t._risk.bundle.pct:null,onCurve=isLaunch(t)&&bond(t)<100;
 let gate=null;
 if(H.k==='danger')gate='Flagged dangerous (bundles, dev dumping or whale-heavy)';
 else if(a.mintOff===false)gate='Dev can still mint more tokens';
 else if(a.freezeOff===false)gate='Dev can freeze your tokens';
 else if(x.top!=null&&x.top>G.top)gate=`Top 10 wallets own ${x.top}%`;
 else if(x.dev!=null&&x.dev>G.dev)gate=`Dev still holds ${x.dev}%`;
 else if(bun!=null&&bun>G.bun)gate=`${Math.round(bun)}% was bundled at launch`;
 else if(liq<G.liq)gate='Too little liquidity to sell out cleanly';
 else if(ageM<G.ageMin)gate='Too new to judge yet';
 else if(ageM>G.ageMax)gate='Outside this mode’s age window';
 else if(mode==='safe'&&(a.mintOff==null||a.freezeOff==null))gate='Safety not verified yet';
 const why=[],warn=[];
 // S: safety
 let S=.45;if(a.mintOff&&a.freezeOff){S+=.2;why.push([9,'Mint & freeze revoked'])}else if(a.mintOff==null)warn.push('Safety still checking');
 if(x.top!=null){S+=x.top<=15?.18:x.top<=25?.1:x.top>35?-.15:0;if(x.top<=20)why.push([7,`Top 10 hold ${x.top}%`])}
 if(x.dev!=null){S+=x.dev<=3?.1:x.dev>10?-.12:0;if(x.dev<=1)why.push([5,'Dev holds ~0%'])}
 if(bun!=null)S+=bun<=10?.07:bun>20?-.12:0;S=c01(S);
 // D: real demand (buy pressure, new holders, unique traders)
 const bp=H.bp,hg=H.hg||0,tr=L.traders24||0;
 const D=c01((bp!=null?c01((bp-.45)/.35)*.5:.2)+c01(hg/4)*.3+c01(Math.log10(tr+1)/3)*.2);
 if(bp!=null&&bp>=.6)why.push([8,`${Math.round(bp*100)}% buys`]);if(hg>=1)why.push([7,`+${hg.toFixed(1)} holders/min`]);
 // T: trend, and don't chase tops
 const m5=H.m5,h1=c.h1;let T=.5;
 if(m5!=null)T+=m5>=3&&m5<=40?.25:m5<-10?-.25:0;
 if(h1!=null)T+=h1>=5&&h1<=200?.2:h1<-30?-.2:0;
 if(h1!=null&&h1>250&&(m5||0)<0){T-=.45;warn.push(`Pulling back after +${Math.round(h1)}% this hour`)}
 else if(m5!=null&&m5>60){T-=.3;warn.push('Going vertical. Wait for a dip')}
 else if(H.k==='second')why.push([6,'Reclaimed with new buyers']);
 T=c01(T);
 // F: turnover (volume vs market cap)
 const turn=m?(t.vol||0)/m:0,F=turn<.1?.2:turn<.3?.5:turn<=6?1:.6;if(turn>8)warn.push('Volume looks wash-traded');
 // K: Callit callers with real money in
 const bk=calls.filter(k=>k.t===t.key&&k.buy>0&&!k.sponsored),best=Math.max(0,...bk.map(k=>(C[k.c]&&C[k.c].calls>=3?C[k.c].win:0)));
 const nB=new Set(bk.map(k=>k.c)).size,K=c01(nB*.25+(best>=60?.5:best>=40?.25:0));
 if(nB)why.push([best>=60?10:6,`${nB} caller${nB>1?'s':''} bought in${best>=60?` (best ${best}% win)`:''}`]);
 // R: room to run
 const R=m<15e3?.55:m<=1.5e6?1:m<=1e7?.65:.35;if(m>=15e3&&m<=5e5)why.push([4,'Early market cap']);
 // Q: liquidity health (bonding curves can always be sold into)
 const lr=m?liq/m:0,Q=onCurve?.8:lr>=.15?1:lr>=.06?.6:.15;if(!onCurve&&lr<.06)warn.push('Thin liquidity for its size');
 const W=AIW[mode],s=Math.round(100*(W.S*S+W.D*D+W.T*T+W.F*F+W.K*K+W.R*R+W.Q*Q));
 return {s,gate,why:why.sort((p,q)=>q[0]-p[0]).map(w=>w[1]),warn,grade:aiGrade(s)}}
const aiPass=(t,mode)=>{const A=aiOf(t,mode);return !!A&&!A.gate&&A.s>=AIM[mode][3]};
const aiSort=(rows,mode)=>rows&&mode&&AIM[mode]?[...rows].sort((p,q)=>(aiOf(q,mode)||{s:0}).s-(aiOf(p,mode)||{s:0}).s):rows;
const aiChip=(t,mode)=>{const A=mode&&aiOf(t,mode);if(!A)return '';const [g]=A.grade;
 return `<span class="aiS g-${g}" title="AI Auto ${A.s}/100. ${esc([...A.why.slice(0,3),...A.warn].join(' · '))}">🎯 ${A.s}</span>`};
const aiWhy=(t,mode)=>{const A=mode&&aiOf(t,mode);if(!A)return '';const w=A.warn[0];
 return `<div class="aiwhy">${A.why.slice(0,2).map(x=>`<span>✓ ${esc(x)}</span>`).join('')}${w?`<span class="warn">! ${esc(w)}</span>`:''}</div>`};
/* Token page: what AI Auto thinks of this token, in plain words. */
function aiCard(t){const A=aiOf(t,'balanced');if(!A)return '';const [g,gl]=A.grade;
 return `<div class="aicard g-${A.gate?'weak':g}"><div class="aihead"><b>🎯 AI Auto</b>${A.gate?`<span class="aipill">Skipped</span>`:`<span class="aipill">${gl} · ${A.s}/100</span>`}</div>
 ${A.gate?`<p class="hint">AI Auto leaves this out: ${esc(A.gate)}.</p>`:''}
 <div class="aiwhy">${A.why.slice(0,4).map(x=>`<span>✓ ${esc(x)}</span>`).join('')}${A.warn.map(x=>`<span class="warn">! ${esc(x)}</span>`).join('')}</div></div>`}
function heatCard(t){if(!t.live)return '';const h=heatOf(t),[e,l,d]=HEAT[h.k],n=backers(t),pc=v=>v==null?'—':pctS(v);
 return `<section class="card heatcard h-${h.k}" aria-label="Heat"><div class="hcrow"><span class="hcbig">${e}</span><div class="grow"><b>${l}</b><div class="hint">${d}</div></div><div class="hcs num" title="Heat score">${h.s}<small>/100</small></div></div>
 <div class="hcbar"><i style="width:${h.s}%"></i></div>
 <div class="hcgrid num"><span><small>1m</small>${pc(h.m1)}</span><span><small>5m</small>${pc(h.m5)}</span><span><small>Buy pressure</small>${h.bp==null?'—':Math.round(h.bp*100)+'%'}</span><span><small>Holders/min</small>${h.hg?(h.hg>0?'+':'')+h.hg.toFixed(1):'—'}</span></div>
 ${n?`<p class="hcback">📣 ${n} Callit caller${n>1?'s':''} bought in. <a href="#/token/${esc(t.key)}" data-act="none">See calls below</a></p>`:''}${aiCard(t)}</section>`}
/* ---------- trenches: feeds, filters, display ---------- */
const LPDOM={Pump:'pump.fun',Bonk:'bonk.fun',Believe:'believe.app',Moonshot:'moonshot.com',Launchlab:'raydium.io',Bags:'bags.fm','Jup Studio':'jup.ag',Meteora:'meteora.ag',Boop:'boop.fun'};
/* Little badge on each token: the launchpad it came from (pump.fun, Bonk, Meteora...), Solana otherwise. */
const lpBadge=t=>{const L=lpOf(t),d=L&&LPDOM[L];return d?`<i class="chainb lpb" title="Launched on ${esc(L)}"><b>${esc(L[0])}</b><img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></i>`:`<i class="chainb">${ic('solglyph',11)}</i>`};
const LPS=[['Pump','#4ADE80'],['Bonk','#F59E0B'],['Meteora','#F472B6'],['Bags','#10B981'],['Believe','#22C55E'],['Launchlab','#38BDF8'],['Jup Studio','#FB923C'],['Moonshot','#C084FC'],['Boop','#60A5FA']];
const CHAINS=[['Solana','#9d7bff',1],['Base','#3B82F6',0],['BSC','#F0B90B',0],['Ethereum','#8EA2FF',0],['Arbitrum','#60A5FA',0]];
const FEEDS={movers:['Movers','Biggest price momentum right now'],new:['New','Fresh launches, newest first'],called:['Called','Tokens our callers are on, most calls first','Only on Callit'],
 crowded:['Crowded','Most holders first'],almost:['Almost bonded','60 to 99% through the bonding curve'],grad:['Migrated','Bonded and migrated to a DEX, newest first'],og:['OG','The established Solana memecoins, biggest first']};
const RISK={degen:['Degen','Show me everything',{top:100,dev:100,snip:100,ins:100}],balanced:['Balanced','Filter the obvious traps',{top:30,dev:15,snip:10,ins:30}],careful:['Careful','Only clean holder books',{top:15,dev:5,snip:3,ins:15}]};
const isLaunch=t=>!t.live||!!t.lp;
/* Bonding progress. Live tokens: approximated from market cap (pump-style curves finish near $69K). */
const bond=t=>t.live&&!t.lp?100:Math.min(100,mcap(t)/69e3*100);
const lpOf=t=>t.live?t.lp:(t.lp||(t.lp=LPS[t.seed%LPS.length][0]));
const callsOn=t=>calls.filter(k=>k.t===t.key&&!k.sponsored);
const defFil=()=>({chains:['Solana'],lps:LPS.map(l=>l[0]),inc:'',exc:'',bmin:'',bmax:'',mcMin:'',mcMax:'',volMin:'',hMin:'',ageMax:0,top:100,dev:100,snip:100,ins:100,x:0,web:0,comm:0,called:0,topc:0,bought:0,tf:'1h',chgMin:'',ai:''});
const defDisp=()=>({pro:1,spark:0,heat:1,compact:0});
const defFeeds=()=>[['new',1],['almost',1],['grad',1],['movers',1],['called',1],['og',1],['crowded',0]];
const TS=(()=>{let v={};try{v=JSON.parse(localStorage.getItem('callit.trenches')||'{}')}catch(_){}
 let feeds=Array.isArray(v.feeds)&&v.fv===2?v.feeds.filter(f=>FEEDS[f[0]]):defFeeds();defFeeds().forEach(d=>{if(!feeds.some(f=>f[0]===d[0]))feeds.push(d)});
 return {fv:2,disp:{...defDisp(),...(v.disp||{})},feeds,fil:v.fil||{},aiLast:AIM[v.aiLast]?v.aiLast:''}})();
const saveTS=()=>{try{localStorage.setItem('callit.trenches',JSON.stringify(TS))}catch(_){}};
const filOf=k=>({...defFil(),...(TS.fil[k]||{})});
const parseAmt=v=>{v=String(v||'').trim().toUpperCase().replace(/[$,\s]/g,'');if(!v)return null;const n=parseFloat(v);if(isNaN(n))return null;return n*(v.endsWith('B')?1e9:v.endsWith('M')?1e6:v.endsWith('K')?1e3:1)};
const words=v=>String(v||'').toLowerCase().split(',').map(w=>w.trim()).filter(Boolean);
function match(t,f){const x=trenchStats(t),m=mcap(t),b=bond(t),nm=(t.name+' '+t.sym).toLowerCase(),n=parseAmt,cs=callsOn(t);
 if(!f.chains.includes(t.chain)||(lpOf(t)&&LPS.some(l=>l[0]===lpOf(t))&&!f.lps.includes(lpOf(t))))return false;
 const inc=words(f.inc),exc=words(f.exc);if(inc.length&&!inc.some(w=>nm.includes(w)))return false;if(exc.some(w=>nm.includes(w)))return false;
 if(f.bmin!==''&&b<+f.bmin)return false;if(f.bmax!==''&&b>+f.bmax)return false;
 if(n(f.mcMin)!=null&&m<n(f.mcMin))return false;if(n(f.mcMax)!=null&&m>n(f.mcMax))return false;
 if(n(f.volMin)!=null&&t.vol<n(f.volMin))return false;if(n(f.hMin)!=null&&t.holders<n(f.hMin))return false;
 if(f.ageMax&&t.ageH>f.ageMax)return false;
 if(f.chgMin!==''&&f.chgMin!=null&&!isNaN(parseFloat(f.chgMin))){const v=chgOf(t,f.tf||'1h');if(v==null||v<parseFloat(f.chgMin))return false}
 if(x.top>f.top||x.dev>f.dev||x.snip>f.snip||x.ins>f.ins)return false;
 const soc=t.soc||'';if(f.x&&!soc.includes('x')||f.web&&!soc.includes('w')||f.comm&&!soc.includes('c'))return false;
 if(f.called&&!cs.length)return false;if(f.topc&&!cs.some(k=>(rankOf(k.c)||99)<=3))return false;if(f.bought&&!cs.some(k=>k.buy))return false;
 if(f.ai&&!aiPass(t,f.ai))return false;
 return true}
function activeCount(f){const d=defFil();let c=0;for(const k in d){if(k==='tf')continue;const a=Array.isArray(d[k])?[...d[k]].sort().join():d[k],b=Array.isArray(f[k])?[...f[k]].sort().join():f[k];if(String(a)!==String(b))c++}return c}
function feedRows(k,f){
 const ids0=lfIds(k,f);if(ids0){const ids=ids0;ids.forEach(id=>{if(!LIVE.feeds[id]&&!LIVE.err[id])loadFeed(id)});
  if(ids.every(id=>!LIVE.feeds[id]))return null;
  const r=[...new Set(ids.flatMap(id=>LIVE.feeds[id]||[]))].map(x=>T[x]).filter(t=>t&&match(t,f));
  if(k==='new')return r.sort((a,b)=>a.ageH-b.ageH);
  if(k==='crowded')return r.sort((a,b)=>b.holders-a.holders);
  if(k==='almost')return r.filter(t=>isLaunch(t)&&bond(t)>=60&&bond(t)<100).sort((a,b)=>bond(b)-bond(a));
  if(k==='grad')return r.filter(t=>t.lp&&bond(t)>=100).sort((a,b)=>a.ageH-b.ageH);
  if(k==='og')return r.filter(t=>OGSET.has(t.key)||OGSET.has(t.ca)).sort((a,b)=>(mcap(b)||0)-(mcap(a)||0));
  return r.sort(byChg(f.tf||'1h'))}
 let r=Object.values(T).filter(t=>t.chain&&!t.base&&!t.prelaunch&&(t.holders||t.live)&&match(t,f));
 if(k==='watch')return r.filter(t=>S.watch.has(t.key)).sort((a,b)=>b.vol-a.vol);
 if(k==='new')return r.sort((a,b)=>a.ageH-b.ageH);
 if(k==='called')return r.filter(t=>callsOn(t).length).sort((a,b)=>callsOn(b).length-callsOn(a).length||b.vol-a.vol);
 if(k==='crowded')return r.sort((a,b)=>b.holders-a.holders);
 if(k==='almost')return r.filter(t=>bond(t)>=60&&bond(t)<100).sort((a,b)=>bond(b)-bond(a));
 if(k==='grad')return r.filter(t=>bond(t)>=100).sort((a,b)=>a.ageH-b.ageH);
 return r.sort(byChg(f.tf||'1h'))}
function spark(t){const r=rng(t.seed*13);let y=.5,p=[];for(let i=0;i<24;i++){y+=(r()-.5)*.22+(t.chg>=0?.016:-.016);y=Math.min(.95,Math.max(.05,y));p.push(y)}
 return `<svg class="spark ${t.chg>=0?'up':'down'}" viewBox="0 0 64 22" preserveAspectRatio="none" aria-hidden="true"><path d="${p.map((v,i)=>(i?'L':'M')+(i/23*64).toFixed(1)+','+(22-v*22).toFixed(1)).join('')}"/></svg>`}
function heat(t){const cs=callsOn(t);if(!cs.length)return '';const who=[...new Set(cs.map(k=>k.c))];
 return `<span class="heat" title="${who.length} caller${who.length>1?'s':''} on this">${who.slice(0,3).map(h=>avatar(h)).join('')}<b>${cs.length} call${cs.length>1?'s':''}</b></span>`}
/* Copy a token's contract address straight from a list row, without opening the token page. */
const caOf=t=>{const c=t&&(t.ca||t.mint||t.key);return c&&isMintStr(c)?c:''};
const caBtn=t=>{const c=caOf(t);return c?`<button class="cacopy" data-act="copy" data-v="${esc(c)}" data-m="$${esc(t.sym||'Token')} contract address copied" aria-label="Copy contract address" title="Copy CA · ${esc(short(c))}">${ic('copy',13)}</button>`:''};
function trow(t){const H=heatOf(t),FX=fxOf(t,H),x=trenchStats(t),m=mcap(t),y=t.ageH<1,red=(v,lim)=>v==null?'muted':v>lim?'down':'up',pv=v=>v==null?'—':v+'%',D=TS.disp,b=bond(t),tf=S.rowTf||'1h',cv=chgOf(t,tf),fl=t._pm&&t._pm!==m?(m>t._pm?' fl-up':' fl-dn'):'';t._pm=m;
 const soc=(t.soc||'').split('').map(c=>({x:ic('xlogo',15),w:ic('globe',15),c:ic('people',15)})[c]).join('');
 return `<a class="trow${D.compact?' compact':''}${D.pro?'':' lite'}${FX.cls}" href="#/token/${t.key}">${FX.tag}<span class="tav ${t.chg>=0?'ok':'bad'}" style="--b:${b.toFixed(0)}%">${tokav(t.key)}${lpBadge(t)}</span>
 <div class="tmid"><div class="tname"><b>${esc(t.name)}</b>${aiChip(t,S.aiMode)}${heatChip(t,H)}${backChip(t)}<button class="wstar${S.watch.has(t.key)?' on':''}" data-act="track" data-t="${esc(t.key)}" aria-pressed="${S.watch.has(t.key)}" aria-label="${S.watch.has(t.key)?'Remove from':'Add to'} watchlist" title="Watchlist">${ic('star',15,S.watch.has(t.key))}</button>${caBtn(t)}</div>
 <div class="tsub"><span>${esc(t.sym)}</span><span class="${y?'my':'up'}">${ic('sprout',13)}${ageStr(t.ageH)}</span><span class="soc">${soc}</span></div>${S.aiMode?aiWhy(t,S.aiMode):''}${D.heat?heat(t):''}</div>
 ${D.pro?`<div class="tst num"><span class="up" title="Holders">${ic('profile',13)}${fmtK(t.holders)}</span><span class="${red(x.top,10)}" title="Top 10 holders">${ic('target',13)}${pv(x.top)}</span><span class="${red(x.dev,10)}" title="Dev holding">${ic('stake',13)}${pv(x.dev)}</span>${x.snip==null?'':`<span class="${red(x.snip,5)}" title="Snipers">${ic('sniper',13)}${pv(x.snip)}</span>`}${x.ins==null?'':`<span class="${red(x.ins,15)}" title="Insiders">${ic('crown',13)}${pv(x.ins)}</span>`}<em class="tchg ${pcls(cv)}" title="Price change, ${tf}">${pctS(cv)}<small>${tf}</small></em></div>`:''}
 <div class="tr num">${D.spark?spark(t):''}<div>${D.pro?`<span class="k">V</span> ${fmtUsd(t.vol).replace(/\.\d+([KMB])/,'$1')} `:''}<span class="k">MC</span> <b class="${mcCls(m)}${fl}" data-tmc="${t.key}">${fmtUsd(m)}</b></div>
 ${D.pro?`<div>${x.fees==null?`<span class="k">B/S</span> ${Math.round(x.buys*100)}%`:`<span class="k">F</span> ${ic('solglyph',12)} ${x.fees.toFixed(2)}`}</div><div class="bs"><i style="flex:${x.buys}"></i><i style="flex:${1-x.buys}"></i></div><div><span class="k">TX</span> ${fmtK(x.tx)}</div>`:`<div class="${pcls(cv)}">${pctS(cv)} <small class="muted">${tf}</small></div>`}</div></a>`}
const skelRows=()=>Array.from({length:8},()=>`<div class="trow skel" aria-hidden="true"><span class="tav"><span class="tokav"></span></span><div class="tmid"><i></i><i></i></div><div class="tr"><i></i></div></div>`).join('')+'<p class="sr-only" role="status">Loading live tokens</p>';
/* AI Auto lives in the Filters sheet; the bar only shows while it's on, so people can see it and switch it off. */
/* Compact AI Auto chip in the timeframe bar: tap the name to change mode, × to switch it off. */
function aiChipBar(f){if(!f.ai)return '';const [,l]=AIM[f.ai]||AIM.balanced;
 return `<span class="aitog"><button type="button" data-act="fsopen" data-tab="auto" title="AI Auto is on: ${esc(l)}. Tap to change">🎯 <b>AI</b><span>${esc(l)}</span></button><button type="button" class="aix" data-act="aiq" aria-label="Turn AI Auto off" title="Turn off">${ic('x',12)}</button></span>`}
function aiBar(f){const on=!!f.ai,[e,l]=AIM[f.ai||'balanced'];if(!on)return '';
 return `<div class="aibar${on?' on':''}"><button type="button" class="aiq" data-act="aiq" aria-pressed="${on}"><span class="aiqi">🎯</span><span><b>AI Auto${on?` · ${l}`:''}</b><small>${on?'Showing the best entries right now, best first':'Let Callit filter for you. One tap.'}</small></span><i class="aisw"></i></button>${on?`<button type="button" class="lnk" data-act="fsopen" data-tab="auto">Change</button>`:''}</div>`}
function vTrenches(){const on=TS.feeds.filter(f=>f[1]).map(f=>f[0]);if(S.tt!=='watch'&&!on.includes(S.tt))S.tt=on[0]||'watch';
 const f=filOf(S.tt);S.rowTf=f.tf||'1h';S.aiMode=f.ai||'';const raw=feedRows(S.tt,f),rows=aiSort(heatApply(raw),f.ai),n=activeCount(f);
 const tab=(k,l)=>`<button role="tab" aria-selected="${S.tt===k}" class="${S.tt===k?'on':''}" data-act="tt" data-f="${k}">${l}</button>`;
 return `<div class="ttabs"><div class="tscroll" role="tablist">${tab('watch',ic('star',18,S.tt==='watch'))}${on.map(k=>tab(k,FEEDS[k][0])).join('')}</div>
 <span class="ttools"><button class="ib" data-act="fsopen" aria-label="Filters${n?`, ${n} active`:''}">${ic('filter',20)}${n?`<span class="fbadge">${n}</span>`:''}</button><button class="ib" data-act="dsopen" aria-label="Display settings">${ic('gear',20)}</button></span></div>
 <div class="tfbar"><span class="tflive"><i></i>Live</span><span class="muted tflbl">${S.tt==='movers'?'Top gainers':'% change'}</span>${aiChipBar(f)}<div class="seg tfseg" role="tablist" aria-label="Timeframe">${TF_OK.map(x=>`<button role="tab" aria-selected="${S.rowTf===x}" class="${S.rowTf===x?'on':''}" data-act="ttf" data-f="${x}">${x}</button>`).join('')}</div></div>
 ${raw&&raw.length?heatBar(raw):''}
 ${n-(f.ai?1:0)>0?`<div class="fline"><span>${n} filter${n>1?'s':''} on ${S.tt==='watch'?'Watchlist':FEEDS[S.tt][0]}</span><button data-act="fsclear1">Clear</button></div>`:''}
 <div class="tgridw">${rows===null?((lfIds(S.tt,f)||[]).some(id=>LIVE.err[id])?`<div class="empty"><b class="h2">Live data is taking a break</b><p>We couldn't reach the market feed. It usually comes back in a few seconds.</p><button class="btn primary" data-act="lretry">Try again</button></div>`:skelRows()):rows.map(trow).join('')||`<div class="empty"><b class="h2">${S.tt==='watch'?'No watchlist tokens yet':HEATF.k?'No '+(HEATF.k==='called'?'caller-backed':HEAT[HEATF.k][1].toLowerCase())+' tokens right now':'Nothing matches'}</b><p>${S.tt==='watch'?'Open any token and tap Watchlist to pin it here.':'Loosen the filters or try another feed.'}</p>${n?'<button class="btn primary" data-act="fsclear1">Clear filters</button>':''}</div>`}</div>
 <p class="hint pad">Degen zone. New tokens are high risk. Row icons: holders, top 10, dev, snipers, insiders. The ring around each token fills as it moves through its bonding curve.</p>`}


/* ---------- admin: users, trades and calls, live (only for handles in ADMIN_HANDLES) ---------- */
const ADM={tab:'radar',rwin:'d7',data:null,radar:null,rerr:null,err:null,busy:0};
function loadAdmin(){if(ADM.busy)return;ADM.busy=1;Promise.all([
  API('/api/admin/overview').then(j=>{ADM.data=j;ADM.err=null}).catch(e=>{ADM.err=e.message||'Not allowed'}),
  API('/api/admin/radar').then(j=>{ADM.radar=j;ADM.rerr=null}).catch(e=>{ADM.rerr=e.message||'Radar unavailable'})
 ]).finally(()=>{ADM.busy=0;if(currentRoute()==='admin'&&!document.querySelector('#modal .modal'))render()})}
/* Radar: volume, fees and where the fees go. Admins only. */
function vRadar(){const R=ADM.radar;if(ADM.rerr)return `<div class="empty"><b>Radar couldn't load</b><p>${esc(ADM.rerr)}</p></div>`;
 if(!R)return `<div class="empty"><p>Loading radar…</p></div>`;
 const c=R.config,w=R.windows[ADM.rwin]||R.windows.d7,live=c.liveBps>0,pct=b=>(b/100).toFixed(2)+'%';
 const WL={d1:'24h',d7:'7d',d30:'30d',d90:'90d'};
 const status=live?`<span class="rdpill on"><i></i>Fee live · ${pct(c.liveBps)}</span>`:`<span class="rdpill off"><i></i>Fee off</span>`;
 const big=(l,v,sub,cls='')=>`<div class="rdstat ${cls}"><span>${l}</span><b class="num">${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
 const share=w.vol?Math.round(w.viaCallVol/w.vol*100):0;
 const S30=R.series,mx=Math.max(1,...S30.map(d=>d.vol)),BW=100/S30.length;
 const bars=S30.map((d,i)=>{const h=Math.max(d.vol?2:0,d.vol/mx*100);return `<rect x="${(i*BW+BW*.18).toFixed(2)}" y="${(100-h).toFixed(2)}" width="${(BW*.64).toFixed(2)}" height="${h.toFixed(2)}" rx=".6" class="${i===S30.length-1?'today':''}"><title>${d.day}: ${fmtUsd(d.vol)} volume, ${d.trades} trades, ${fmtUsd(d.fee)} fees</title></rect>`}).join('');
 const tot=R.buckets.reduce((a,b)=>a+(live?b.earned:b.projected),0)||1;
 const seg=R.buckets.map((b,i)=>`<i class="rdb${i}" style="flex:${Math.max(.001,(live?b.earned:b.projected)/tot)}"></i>`).join('');
 const brow=R.buckets.map((b,i)=>`<div class="rdbrow"><span class="rdsw rdb${i}"></span><div class="grow"><b>${esc(b.label)}</b><span class="hint">${esc(b.note)}</span></div><div class="r num"><b>${fmtUsd(live?b.earned:b.projected)}</b><span class="hint">${b.call}% · ${b.buy}% · ${b.sell}%</span></div></div>`).join('');
 const toks=R.tokens.map(t=>{const T0=T[t.mint];return `<tr data-go="#/token/${esc(t.mint)}"><td><div class="person">${T0?tokav(t.mint):''}<b>${T0?'$'+esc(T0.sym):esc(short(t.mint))}</b></div></td><td class="num">${fmtUsd(t.vol)}</td><td class="num">${t.trades}</td></tr>`}).join('');
 const trs=R.traders.map(u=>`<tr><td><div class="person">${u.avatar_url?`<img class="av" src="${esc(u.avatar_url)}" alt="">`:''}${u.handle?`<a href="#/profile/${esc(u.handle)}">@${esc(u.handle)}</a>`:'—'}</div></td><td class="num">${fmtUsd(u.vol)}</td><td class="num">${u.trades}</td><td class="num">${fmtUsd(u.fee)}</td></tr>`).join('');
 return `<div class="rdhead">${status}<div class="seg rdwin" role="tablist" aria-label="Time window">${Object.entries(WL).map(([k,l])=>`<button class="${ADM.rwin===k?'on':''}" data-act="rdwin" data-f="${k}">${l}</button>`).join('')}</div></div>
 ${live?'':`<div class="rdnote"><b>You're not earning on swaps yet.</b> Set <code>JUPITER_REFERRAL_ACCOUNT</code> and <code>JUPITER_REFERRAL_FEE_BPS</code> in Vercel, then redeploy. Below, fees show what you'd have made at ${pct(c.standardBps)}.</div>`}
 ${c.feeCols?'':`<div class="rdnote"><b>Run migration 0006</b> in Supabase so each trade stores the fee it paid.</div>`}
 <div class="rdgrid">${big('Volume',fmtUsd(w.vol),`${WL[ADM.rwin]} through Callit`,'lead')}${big(live?'Fees earned':'Fees at '+pct(c.standardBps),fmtUsd(live?w.fee:w.potential),live?'After Jupiter’s 20%':'Projected, after Jupiter’s 20%','fee')}
 ${big('Trades',fmtK(w.trades),w.trades?`${fmtUsd(w.avg)} average`:'')}${big('Traders',fmtK(w.traders),'Unique wallets')}${big('From calls',share+'%',`${fmtUsd(w.viaCallVol)} via bought-in calls`)}</div>
 <div class="rdcard"><div class="rdct"><b>Daily volume</b><span class="hint">Last 30 days · hover a bar</span></div><svg class="rdchart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily volume, last 30 days">${bars}</svg>
  <div class="rdaxis hint"><span>${S30[0].day.slice(5)}</span><span>Today ${fmtUsd(S30[S30.length-1].vol)}</span></div></div>
 <div class="rdcard"><div class="rdct"><b>Where fees go</b><span class="hint">30 days · ${live?'earned':'projected'} · split call buy · buy · sell</span></div><div class="rdsplit">${seg}</div>${brow}</div>
 <div class="rd2"><div class="rdcard"><div class="rdct"><b>Top tokens</b><span class="hint">30d</span></div><div class="tablewrap"><table><thead><tr><th>Token</th><th>Volume</th><th>Trades</th></tr></thead><tbody>${toks||'<tr><td colspan="3" class="muted">No trades yet</td></tr>'}</tbody></table></div></div>
 <div class="rdcard"><div class="rdct"><b>Top traders</b><span class="hint">30d</span></div><div class="tablewrap"><table><thead><tr><th>Trader</th><th>Volume</th><th>Trades</th><th>Fees</th></tr></thead><tbody>${trs||'<tr><td colspan="4" class="muted">No trades yet</td></tr>'}</tbody></table></div></div></div>
 <p class="hint" style="margin-top:12px">Counts trades made inside Callit only. Check the referral account on Solscan for what actually landed on-chain${c.referral?`: <a class="lnk" href="https://solscan.io/account/${esc(c.referral)}" target="_blank" rel="noopener">${esc(short(c.referral))}</a>`:''}.</p>`}
setInterval(()=>{if(!document.hidden&&currentRoute()==='admin')loadAdmin()},15e3);
/* Payouts: the payout wallet, what callers are owed, claims, and the emergency stop. Admins only. */
const PAY={d:null,err:null,busy:0};
function loadPayouts(force){if(PAY.busy||(!force&&PAY.d))return;PAY.busy=1;API('/api/admin/payouts').then(j=>{PAY.d=j;PAY.err=null}).catch(e=>{PAY.err=e.message}).finally(()=>{PAY.busy=0;if(currentRoute()==='admin'&&ADM.tab==='payouts')render()})}
function vPayouts(){const d=PAY.d;if(PAY.err)return `<div class="empty"><b>Payouts couldn't load</b><p>${esc(PAY.err)}</p></div>`;if(!d){loadPayouts();return `<div class="empty"><p>Loading payouts…</p></div>`}
 if(!d.ready)return `<div class="rdnote"><b>${esc(d.reason)}</b></div>`;
 const st=d.issue?`<span class="rdpill off"><i></i>${esc(d.paused?'Paused':'Claims off')}</span>`:`<span class="rdpill on"><i></i>Claims open</span>`;
 const big=(l,v,sub,cls='')=>`<div class="rdstat ${cls}"><span>${l}</span><b class="num">${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
 const low=d.solUsd!=null&&d.solUsd<d.owed;
 const rows=(d.claims||[]).map(c=>`<tr><td>${agoT(c.created_at)}</td><td>${c.handle?`<a href="#/profile/${esc(c.handle)}">@${esc(c.handle)}</a>`:'—'}</td><td class="num">${fmtUsd(+c.usd)}</td><td class="num">${c.sol?(+c.sol).toFixed(4):'—'}</td><td><span class="akind ${c.status==='sent'?'buy':c.status==='failed'?'sell':''}">${esc(c.status)}</span>${c.error?` <span class="hint">${esc(c.error)}</span>`:''}</td><td>${c.signature?`<a class="muted" href="https://solscan.io/tx/${esc(c.signature)}" target="_blank" rel="noopener">${esc(c.signature.slice(0,6))}…</a>`:''}</td></tr>`).join('');
 return `<div class="rdhead">${st}${d.switchOn?`<button class="btn sm${d.paused?' primary':''}" data-act="paypause" data-f="${d.paused?'resume':'pause'}">${d.paused?'Resume claims':'Pause claims'}</button>`:''}</div>
 ${d.issue&&!d.paused?`<div class="rdnote"><b>${esc(d.issue)}</b> Set <code>PAYOUT_WALLET_SECRET</code> (a fresh wallet that only holds payout SOL) and <code>PAYOUTS_ON</code> = <code>1</code> in Vercel, then redeploy. Earnings still add up while claims are off.</div>`:''}
 ${low?`<div class="rdnote"><b>Payout wallet is lower than what callers are owed.</b> Top it up before many people claim.</div>`:''}
 <div class="rdgrid">${big('Owed to callers',fmtUsd(d.owed),'Unclaimed, all users','lead')}${big('Payout wallet',d.sol!=null?d.sol.toFixed(3)+' SOL':'Not set',d.solUsd!=null?fmtUsd(d.solUsd):'', 'fee')}${big('Earned 24h',fmtUsd(d.earned24h),'New caller earnings')}${big('Paid 24h',fmtUsd(d.paid24h),`Daily cap ${fmtUsd(d.dailyCap)}`)}</div>
 ${d.wallet?`<p class="hint">Payout wallet <a class="lnk" href="https://solscan.io/account/${esc(d.wallet)}" target="_blank" rel="noopener">${esc(short(d.wallet))}</a> <button class="btn sm ghost" data-act="copy" data-v="${esc(d.wallet)}">Copy</button> · send SOL here to fund claims. Min claim ${fmtUsd(d.minUsd)}, max ${fmtUsd(d.maxClaim)} per claim.</p>`:''}
 <div class="rdcard"><div class="rdct"><b>Recent claims</b></div><div class="tablewrap"><table><thead><tr><th>When</th><th>User</th><th>USD</th><th>SOL</th><th>Status</th><th>Tx</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="muted">No claims yet</td></tr>'}</tbody></table></div></div>`}
/* Telegram bot: connect the webhook, see groups using it. Admins only. */
const TGA={d:null,err:null,busy:0};
function loadTgAdmin(force){if(TGA.busy||(!force&&TGA.d))return;TGA.busy=1;API('/api/admin/telegram').then(j=>{TGA.d=j;TGA.err=null}).catch(e=>{TGA.err=e.message}).finally(()=>{TGA.busy=0;if(currentRoute()==='admin'&&ADM.tab==='telegram')render()})}
function vTgAdmin(){const d=TGA.d;if(TGA.err)return `<div class="empty"><b>Telegram couldn't load</b><p>${esc(TGA.err)}</p></div>`;if(!d){loadTgAdmin();return `<div class="empty"><p>Loading…</p></div>`}
 if(!d.configured)return `<div class="rdnote"><b>Add your bot.</b> Create one with <b>@BotFather</b> on Telegram, then add <code>TELEGRAM_BOT_TOKEN</code> in Vercel and redeploy. Come back here and tap Connect.</div>`;
 const groups=(d.groups||[]).map(g=>`<tr><td><b>${esc(g.title||'Group')}</b>${g.handle?`<div class="hint"><a href="#/profile/${esc(g.handle)}">@${esc(g.handle)}</a></div>`:''}</td><td>${agoT(g.created_at)}</td><td><button class="btn sm${g.enabled?'':' primary'}" data-act="tggroup" data-f="${esc(g.chat_id)}" data-on="${g.enabled?'0':'1'}">${g.enabled?'Turn off':'Turn on'}</button></td></tr>`).join('');
 return `<div class="rdhead">${d.connected?`<span class="rdpill on"><i></i>Connected · @${esc(d.bot||'bot')}</span>`:`<span class="rdpill off"><i></i>Not connected</span>`}<button class="btn sm${d.connected?'':' primary'}" data-act="tgconnect">${d.connected?'Reconnect':'Connect bot'}</button></div>
 ${d.migration?'':`<div class="rdnote"><b>Run migration 0010</b> in Supabase first.</div>`}
 ${d.lastError?`<div class="rdnote"><b>Telegram says:</b> ${esc(d.lastError)}</div>`:''}
 <div class="rdgrid">${big2('Groups',String((d.groups||[]).filter(g=>g.enabled).length),'Using the bot')}${big2('Calls from Telegram',String(d.calls7d),'Last 7 days')}</div>
 <div class="rdcard"><div class="rdct"><b>How groups turn it on</b></div><p class="hint" style="margin:0">Add <b>@${esc(d.bot||'your bot')}</b> to the group and make it an <b>admin</b> (so it can read messages). Then a group admin sends <code>/callit</code>. Every contract address dropped after that becomes a call. <code>/callit off</code> stops it.</p></div>
 <div class="rdcard"><div class="rdct"><b>Groups</b></div><div class="tablewrap"><table><thead><tr><th>Group</th><th>Added</th><th></th></tr></thead><tbody>${groups||'<tr><td colspan="3" class="muted">No groups yet</td></tr>'}</tbody></table></div></div>`}
const big2=(l,v,sub)=>`<div class="rdstat"><span>${l}</span><b class="num">${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
function adminPing(){if(S.admin!=null||!realAuth()||!S.connected)return;S.admin=false;API('/api/admin/overview?ping=1').then(()=>{S.admin=true;if(currentRoute()==='you')render()}).catch(()=>{})}
const agoT=iso=>{const m=(Date.now()-Date.parse(iso))/6e4;return m<1?'now':m<60?Math.round(m)+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d'};
function vAdmin(){if(!ADM.data&&!ADM.err)loadAdmin();
 if(ADM.err)return `<div class="empty"><b class="h2">Admins only</b><p>${esc(String(ADM.err).replace(/\.+$/,''))}. Add your username to <code>ADMIN_HANDLES</code> in Vercel (comma-separated), then reload.</p></div>`;
 if(!ADM.data)return `<div class="empty"><p>Loading admin data…</p></div>`;
 const d=ADM.data,s=d.stats||{},tab=(k,l)=>`<button role="tab" aria-selected="${ADM.tab===k}" class="${ADM.tab===k?'on':''}" data-act="admtab" data-f="${k}">${l}</button>`;
 const stat=(l,v,sub)=>`<div class="astat"><span class="muted">${l}</span><b class="num">${v}</b>${sub?`<small class="muted">${sub}</small>`:''}</div>`;
 const who=h=>h?`<a href="#/profile/${esc(h)}">@${esc(h)}</a>`:'<span class="muted">—</span>';
 const sol=sig=>sig?`<a class="muted" href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${esc(sig.slice(0,6))}…</a>`:'';
 const users=`<table><thead><tr><th>User</th><th>Wallet</th><th>Joined</th><th>Calls</th><th>Trades</th></tr></thead><tbody>${(d.users||[]).map(u=>`<tr><td><div class="person">${u.avatar_url?`<img class="av" src="${esc(u.avatar_url)}" alt="">`:''}${who(u.handle)}</div></td><td class="num muted">${u.wallet_address?esc(short(u.wallet_address)):'—'}</td><td>${agoT(u.created_at)}</td><td class="num">${u.calls||0}</td><td class="num">${u.trades||0}</td></tr>`).join('')}</tbody></table>`;
 const txs=`<table><thead><tr><th>When</th><th>User</th><th>Trade</th><th>USD</th><th>Tx</th></tr></thead><tbody>${(d.txs||[]).map(x=>`<tr><td>${agoT(x.created_at)}</td><td>${who(x.handle)}</td><td><span class="akind ${esc(x.kind)}">${esc(x.kind)}</span> ${esc(x.label||'')}</td><td class="num">${x.usd_value!=null?fmtUsd(+x.usd_value):'—'}</td><td>${sol(x.signature)}${x.verified?' ✓':''}</td></tr>`).join('')}</tbody></table>`;
 const posts=`<table><thead><tr><th>When</th><th>User</th><th>Post</th><th>Entry</th><th>Buy</th></tr></thead><tbody>${(d.posts||[]).map(p=>`<tr data-go="#/post/${esc(p.id)}"><td>${agoT(p.created_at)}</td><td>${who(p.handle)}</td><td>${p.kind==='meme'?`<b>$${esc(p.token_sym||'?')}</b> `:''}<span class="muted">${esc((p.body||'').slice(0,80))}</span></td><td class="num">${p.entry_mc?fmtUsd(+p.entry_mc):'—'}</td><td class="num">${+p.buy_usd?fmtUsd(+p.buy_usd):'—'}</td></tr>`).join('')}</tbody></table>`;
 const errs=d.errors==null?`<div class="rdnote"><b>Run migration 0007</b> in Supabase to start logging failed withdrawals and swaps.</div>`:!d.errors.length?`<div class="empty"><p>No failed transactions logged. </p></div>`:`<div class="tablewrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Step</th><th>Reason</th></tr></thead><tbody>${d.errors.map(x=>`<tr title="${esc(JSON.stringify(x.raw||{}).slice(0,1500))}\n\n${esc(x.user_agent||'')}"><td>${agoT(x.created_at)}</td><td>${who(x.handle)}${x.wallet?`<div class="hint">${esc(short(x.wallet))}</div>`:''}</td><td><span class="akind">${esc(x.action)}</span></td><td>${esc(x.stage||'')}</td><td style="max-width:420px;white-space:normal">${esc(x.message||'')}</td></tr>`).join('')}</tbody></table></div><p class="hint" style="margin-top:8px">Hover (or long-press) a row for the raw error and browser.</p>`;
 return `<div class="pad adm"><div class="ahead"><h1 class="h2">Admin</h1><span class="stlive"><i></i>Live · every 15s</span></div>
 <div class="agrid">${stat('Users',fmtK(s.users||0),`+${s.users24h||0} today · +${s.users7d||0} this week`)}${stat('Calls & posts',fmtK(s.posts||0),`+${s.posts24h||0} today`)}${stat('Trades today',fmtK(s.txs24h||0),'')}${stat('Volume today',fmtUsd(s.vol24h||0),'')}</div>
 <div class="seg wide" role="tablist" style="margin:14px 0">${tab('radar','Radar')}${tab('payouts','Payouts')}${tab('telegram','Telegram')}${tab('overview','New users')}${tab('trades','Trades')}${tab('calls','Calls & posts')}${tab('errors','Tx errors'+(d.errors&&d.errors.length?' '+d.errors.length:''))}</div>
 ${ADM.tab==='radar'?vRadar():ADM.tab==='payouts'?vPayouts():ADM.tab==='telegram'?vTgAdmin():ADM.tab==='errors'?errs:`<div class="tablewrap">${ADM.tab==='trades'?txs:ADM.tab==='calls'?posts:users}</div>`}</div>`}
/* ---------- bottom sheet ---------- */
let SH=null;
function openSheet(kind,tab){SH={kind,tab:tab||'auto',d:kind==='f'?JSON.parse(JSON.stringify(filOf(S.tt))):null};
 $('#sheet').innerHTML=`<div class="sh-scrim" data-act="shclose"></div><div class="sh" role="dialog" aria-modal="true" aria-label="${kind==='f'?'Filters':'Display settings'}"><div class="sh-grab"></div><div id="shin"></div></div>`;
 drawSheet();requestAnimationFrame(()=>$('#sheet').classList.add('open'))}
function closeSheet(){const s=$('#sheet');if(!s.innerHTML)return;s.classList.remove('open');SH=null;setTimeout(()=>{if(!SH)s.innerHTML=''},220)}
const sw=(act,on,extra='')=>`<button class="sw${on?' on':''}" role="switch" aria-checked="${!!on}" data-act="${act}" ${extra}><i></i></button>`;
function drawSheet(){const el=$('#shin');if(!el||!SH)return;const body=el.querySelector('.sh-body'),top=body?body.scrollTop:0;
 el.innerHTML=SH.kind==='f'?filterSheet():displaySheet();const nb=el.querySelector('.sh-body');if(nb)nb.scrollTop=top}
function fsCount(){const r=feedRows(S.tt,SH.d);return r?r.length:-1}
const fsBtn=n=>n<0?'Loading…':n?`Show ${n} token${n>1?'s':''}`:'No tokens match';
function filterSheet(){const d=SH.d,T2=SH.tab,feed=S.tt==='watch'?'Watchlist':FEEDS[S.tt][0];
 const tabs=[['auto','🎯 AI Auto'],['source','Source'],['metrics','Metrics'],['safety','Safety'],['social','Social']];
 const chip=(grp,v,col,on,soon)=>`<button class="chip${on?' on':''}" style="--c:${col}" data-act="fschip" data-g="${grp}" data-v="${v}" ${soon?'disabled':''}><i></i>${v}${soon?'<small>soon</small>':''}</button>`;
 const rng2=(lbl,a,b,pa,pb,hint)=>`<div class="fgrp"><div class="fh"><b>${lbl}</b>${hint?`<span>${hint}</span>`:''}</div><div class="pair"><input class="input num" data-fk="${a}" value="${esc(d[a])}" placeholder="${pa}" inputmode="decimal"><span>to</span>${b?`<input class="input num" data-fk="${b}" value="${esc(d[b])}" placeholder="${pb}" inputmode="decimal">`:'<span class="muted">no cap</span>'}</div></div>`;
 let h='';
 if(T2==='auto'){h=`<div class="fgrp"><div class="fh"><b>Let Callit filter for you</b><span>Pick a style. It overrides nothing else you set.</span></div>
  <div class="aimodes"><button class="rcard${!d.ai?' on':''}" data-act="fsai" data-v=""><b>Off</b><span>I'll set my own filters.</span></button>${Object.entries(AIM).map(([k,[e,l,sub]])=>`<button class="rcard${d.ai===k?' on':''}" data-act="fsai" data-v="${k}"><b>${e} ${l}</b><span>${sub}</span></button>`).join('')}</div></div>
  <div class="fgrp"><div class="fh"><b>What it checks</b></div><ul class="aichecks">
  <li><b>Skips rugs first.</b> Mint or freeze still on, whale-heavy top 10, dev holding a lot, bundled launches, flagged dangerous.</li>
  <li><b>Real demand.</b> Buy pressure, new holders per minute, unique traders.</li>
  <li><b>Exit room.</b> Enough liquidity to sell, and market cap with room to grow.</li>
  <li><b>Doesn't chase tops.</b> Marks tokens going vertical or pulling back after a pump so you don't buy someone's exit.</li>
  <li><b>Callers with skin in the game.</b> Boosts tokens bought by Callit callers with a strong win rate.</li></ul>
  <p class="hint">Every row gets a score out of 100 and the reasons behind it.</p></div>`}
 if(T2==='source'){const allLp=d.lps.length===LPS.length;
  h=`<div class="fgrp"><div class="fh"><b>Chains</b></div><div class="chips">${CHAINS.map(([c,col,live])=>chip('chains',c,col,d.chains.includes(c),!live)).join('')}</div></div>
  <div class="fgrp"><div class="fh"><b>Launchpads</b><button class="lnk" data-act="fslpall">${allLp?'Clear all':'Select all'}</button></div><div class="chips">${LPS.map(([l,col])=>chip('lps',l,col,d.lps.includes(l))).join('')}</div></div>
  <div class="fgrp"><div class="fh"><b>Must match</b><span>Any of these words, comma separated</span></div><input class="input" data-fk="inc" value="${esc(d.inc)}" placeholder="cat, ai, frog"></div>
  <div class="fgrp"><div class="fh"><b>Leave out</b><span>Hide names with these words</span></div><input class="input" data-fk="exc" value="${esc(d.exc)}" placeholder="inu, elon"></div>
  ${rng2('Bonding curve','bmin','bmax','0%','100%','How far along each token is')}`}
 if(T2==='metrics'){const ages=[[0,'Any'],[.1,'5m'],[1,'1h'],[24,'24h'],[168,'7d']];
  h=`<div class="fgrp"><div class="fh"><b>Timeframe</b><span>Ranks Movers and sets the % on every row</span></div><div class="seg wide">${TF_OK.map(x=>`<button class="${(d.tf||'1h')===x?'on':''}" data-act="fstf" data-v="${x}">${x}</button>`).join('')}</div></div>
  <div class="fgrp"><div class="fh"><b>Min price change</b><span>Over the last ${esc(d.tf||'1h')}. Use a minus for drops</span></div><div class="pair"><input class="input num" data-fk="chgMin" value="${esc(d.chgMin)}" placeholder="e.g. 20" inputmode="text"><span>% or more</span></div></div>
  ${rng2('Market cap','mcMin','mcMax','$10K','$5M','Type 50K, 1.2M')}
  ${rng2('24h volume','volMin','','$25K')}
  ${rng2('Holders','hMin','','100')}
  <div class="fgrp"><div class="fh"><b>Younger than</b></div><div class="seg wide">${ages.map(([v,l])=>`<button class="${d.ageMax===v?'on':''}" data-act="fsage" data-v="${v}">${l}</button>`).join('')}</div></div>`}
 if(T2==='safety'){const cur=Object.entries(RISK).find(([,[,,r]])=>['top','dev','snip','ins'].every(k=>r[k]===d[k]));
  const sl=(k,lbl,icn)=>`<div class="slide"><label for="sl-${k}">${ic(icn,15)} ${lbl}</label><input id="sl-${k}" type="range" min="0" max="100" step="1" value="${d[k]}" data-fk="${k}" style="--v:${d[k]}%"><output data-out="${k}">${d[k]>=100?'Any':'≤ '+d[k]+'%'}</output></div>`;
  h=`<div class="fgrp"><div class="fh"><b>Risk appetite</b><span>One tap sets every limit below</span></div>
  <div class="risk">${Object.entries(RISK).map(([k,[l,s]])=>`<button class="rcard${cur&&cur[0]===k?' on':''}" data-act="fsrisk" data-v="${k}"><b>${l}</b><span>${s}</span></button>`).join('')}</div></div>
  <div class="fgrp"><div class="fh"><b>Max share of supply</b></div>${sl('top','Top 10 holders','target')}${sl('dev','Dev holding','stake')}${sl('snip','Snipers','sniper')}${sl('ins','Insiders','crown')}</div>`}
 if(T2==='social'){const row=(k,l,s,badge)=>`<div class="trow2"><div><b>${l}${badge?` <span class="nb">${badge}</span>`:''}</b><span>${s}</span></div>${sw('fsflag',d[k],`data-v="${k}"`)}</div>`;
  h=`<div class="fgrp"><div class="fh"><b>Callit signal</b></div>${row('called','Has calls','At least one caller is on it','Only on Callit')}${row('topc','Called by a top 3 caller','Callerboard top 3 only')}${row('bought','Caller bought in','A caller has real money in it')}</div>
  <div class="fgrp"><div class="fh"><b>Links</b></div>${row('x','Has an X account','')}${row('web','Has a website','')}${row('comm','Has a community','')}</div>`}
 const n=fsCount();
 return `<div class="sh-head"><div><h2>Filters</h2><span class="muted">${feed} feed</span></div><button class="ib" data-act="shclose" aria-label="Close">${ic('x',18)}</button></div>
 <div class="sh-tabs">${tabs.map(([k,l])=>`<button class="${T2===k?'on':''}" data-act="fstab" data-v="${k}">${l}</button>`).join('')}</div>
 <div class="sh-body">${h}</div>
 <div class="sh-foot"><button class="btn ghost" data-act="fsclear">Reset</button><button class="btn primary" data-act="fsapply" id="fsgo" ${n>0?'':'disabled'}>${fsBtn(n)}</button></div>`}
function displaySheet(){const D=TS.disp;const on=TS.feeds.filter(f=>f[1]),off=TS.feeds.filter(f=>!f[1]);
 const opt=(k,l,s,badge)=>`<div class="trow2"><div><b>${l}${badge?` <span class="nb">${badge}</span>`:''}</b><span>${s}</span></div>${sw('dsopt',D[k],`data-v="${k}"`)}</div>`;
 const feed=([k],i,list)=>{const [l,s,badge]=FEEDS[k];const en=list===on;
  return `<div class="feedrow${en?'':' off'}">${en?`<span class="fnum">${i+1}</span>`:'<span class="fnum ghost"></span>'}<div class="grow"><b>${l}${badge?` <span class="nb">${badge}</span>`:''}</b><span>${s}</span></div>
  ${en?`<span class="mv"><button class="ib" data-act="dsmove" data-v="${k}" data-d="-1" ${i?'':'disabled'} aria-label="Move ${l} up">${ic('up',16)}</button><button class="ib" data-act="dsmove" data-v="${k}" data-d="1" ${i<on.length-1?'':'disabled'} aria-label="Move ${l} down">${ic('down',16)}</button></span>`:''}
  ${sw('dsfeed',en,`data-v="${k}" aria-label="Show ${l}"`)}</div>`};
 return `<div class="sh-head"><div><h2>Display</h2><span class="muted">Saved on this device</span></div><button class="lnk" data-act="dsreset">Reset</button><button class="ib" data-act="shclose" aria-label="Close">${ic('x',18)}</button></div>
 <div class="sh-body">${(t=>t?`<div class="preview-row">${trow(t)}</div>`:'')(Object.values(T).find(x=>x.live&&x.pool)||Object.values(T).find(x=>!x.base&&!x.prelaunch&&x.holders))}
 <div class="fgrp"><div class="fh"><b>Rows</b></div>${opt('pro','Pro data','Holders, risk, volume, fees and TX on every row')}${opt('spark','Mini charts','A small price line on each row')}${opt('heat','Caller heat','See which callers are on a token','New')}${opt('compact','Compact','Fit more tokens on screen')}</div>
 <div class="fgrp"><div class="fh"><b>Your feeds</b><span>Order sets the tabs. Keep at least one on.</span></div>${on.map((f,i)=>feed(f,i,on)).join('')}${off.length?`<div class="fsub">More feeds</div>${off.map((f,i)=>feed(f,i,off)).join('')}`:''}</div></div>`}

function vSwap(){return `<div class="pad"><div class="card" style="max-width:460px;margin:0 auto"><div data-swapbox></div></div></div>`}
function vStake(){return locked(`<div class="prem"><div class="phero2"><span class="pbig">${ic('stake',40)}</span><h2>Stake $CALLIT</h2><p>Opens when $CALLIT launches on mainnet.</p></div>
   <div class="pben">${[['verified','Unlock Premium','Keep Premium for as long as you stay staked.'],['wallet','Earn rewards','Get a share of protocol rewards while staked.'],['promote','Cheaper promotions','Discounts on ad slots and sponsored calls.'],['leaderboard','Your tokens stay yours','Non-custodial. Unstake after the lock ends.']].map(([i,t,d])=>`<div class="bcard"><span class="bic">${ic(i,20)}</span><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
   <div class="popt" style="margin-top:16px"><div class="pstake" style="margin:0 0 14px"><div><span>Your $CALLIT</span><b class="num">0</b></div><div><span>Staked</span><b class="num">0</b></div><div><span>Rewards</span><b class="num">0</b></div></div>
   <button class="btn primary block" data-act="stakewait">${S.stakeWait?'You\'re on the list':'Notify me at launch'}</button><a class="btn ghost block" href="#/premium" style="margin-top:8px">See Premium</a></div></div>`,'stake','$CALLIT staking is coming','Stake $CALLIT to keep Premium, earn protocol rewards and get cheaper promotions. Opens when $CALLIT launches on mainnet.',['Non-custodial: your tokens stay yours','Premium for as long as you stay staked'])}
/* Sliding 3D toggle used at the top of DeFi and You. */
function tglBar(act,items,cur,label){const i=Math.max(0,items.findIndex(x=>x[0]===cur));
 return `<div class="mtabs tgl" style="--i:${i};--n:${items.length}" role="tablist" aria-label="${label}">${items.map(([k,l,icn,soon])=>`<button role="tab" aria-selected="${cur===k}" class="${cur===k?'on':''}" data-act="${act}" data-f="${k}">${ic(icn,16)}<span>${l}</span>${soon?'<small>Soon</small>':''}</button>`).join('')}</div>`}
function vDefi(){const t=S.dtab==='stake'?'stake':'swap';return tglBar('dtab',[['swap','Swap','swap'],['stake','Stake','stake',1]],t,'DeFi')+(t==='stake'?vStake():vSwap())}
function vYou(){const t=S.ytab==='profile'?'profile':'wallet';return tglBar('ytab',[['wallet','Wallet','wallet'],['profile','Profile','profile']],t,'You')+(t==='wallet'?vWallet():vProfile(S.me))}

function soon(title,text){return `<div class="soon"><span class="mark"></span><b class="h2">${title}</b><p>${text}</p></div>`}

const pctS=v=>v==null?'—':(v>=0?'+':'')+(Math.abs(v)>=100?Math.round(v):v.toFixed(1))+'%';
const pcls=v=>v==null?'muted':v>=0?'up':'down';
function vTokenLoading(mint){const e=LIVE.tokErr[mint];
 if(e==='gone')return `<div class="empty" style="padding-top:60px"><b class="h2">Token not found</b><p>No trading pool for this address on Solana yet. Double-check the contract address.</p><a class="btn primary" href="#/market">Browse the market</a></div>`;
 if(e)return `<div class="empty" style="padding-top:60px"><b class="h2">Couldn't load this token</b><p>The market feed didn't answer. Try again in a moment.</p><button class="btn primary" data-act="ltokretry" data-t="${esc(mint)}">Try again</button></div>`;
 return `<div class="pad lskel" aria-busy="true"><div class="lsk-h"><span class="tokav"></span><div><i></i><i></i></div></div><i class="lsk-p"></i><div class="lchart"><div class="lchart-msg">Loading token…</div></div><div class="stats num">${'<div><span>&nbsp;</span><b>&nbsp;</b></div>'.repeat(5)}</div></div>`}
function liveStats(t){const L=t.L||{},c=L.chg||{},bs=(L.buys24||0)+(L.sells24||0);
 return `<div class="stats num"><div><span>Market cap</span><b>${fmtSmall(mcap(t))}</b></div><div><span>Price</span><b>${fmtSmall(t.price)}</b></div><div><span>Liquidity</span><b>${t.liq?fmtSmall(t.liq):'—'}</b></div><div><span>24h volume</span><b>${t.vol?fmtSmall(t.vol):'—'}</b></div><div><span>Holders</span><b>${t.holders?t.holders.toLocaleString():'—'}</b></div><div><span>Age</span><b>${esc(t.age)}</b></div></div>
 <div class="lchg num">${[['5m',c.m5,5],['1h',c.h1,60],['6h',c.h6,360],['24h',c.h24,1440]].map(([k,v,mins])=>[k,(t.ageH||0)*60<mins*.9&&k!=='5m'?null:v]).map(([k,v])=>`<span><i>${k}</i><b class="${pcls(v)}">${pctS(v)}</b></span>`).join('')}</div>
 ${bs?`<div class="lbs num"><b class="up">${fmtK(L.buys24||0)} buys</b><div class="bs"><i style="flex:${L.buys24||0}"></i><i style="flex:${L.sells24||0}"></i></div><b class="down">${fmtK(L.sells24||0)} sells</b>${L.traders24?`<span class="muted">· ${fmtK(L.traders24)} traders</span>`:''}</div>`:''}`}
/* Token-2022 transfer tax (from on-chain mint extensions) and the launchpad it came from. */
const taxRows=t=>{const x=t.L&&t.L.tax,row=(label,ok,val)=>`<div class="sf ${ok==null?'unk':ok?'ok':'bad'}"><span class="sfi">${ok==null?'?':ok?ic('check',14):'!'}</span><span class="grow">${label}</span><b>${val}</b></div>`;
 const R=t._risk,bu=R&&R.bundle;
 return row('Token tax',x?!(x.bps>0):null,x?(x.bps>0?`${+(x.bps/100).toFixed(2)}% per transfer`:'None'):'Unknown')+(t.lp?row('Launchpad',true,esc(t.lp)):'')
  +row('Dex paid',R&&R.dexPaid!=null?R.dexPaid:null,!R?'Checking…':R.dexPaid==null?'Unknown':R.dexPaid?'Paid':'Not paid')
  +row('Bundled at launch',bu&&bu.pct!=null?bu.pct<10:null,!R?'Checking…':!bu||bu.pct==null?(bu&&bu.reason==='old'?'Too old to check':'Unknown'):`${bu.pct.toFixed(1)}% · ${bu.wallets} wallet${bu.wallets===1?'':'s'}`)};
/* Holder bubbles: top holders sized by % of supply. Red = bought in the launch block (bundle), orange = creator, blue = pools. */
/* Holder bubbles: top holders sized by % of supply. Red = bought in the launch block (bundle), orange = creator, blue = pools.
   Pools / the bonding curve are left out by default so real holders are comparable; tap a bubble to see that wallet. */
const BUBX={pool:false,sel:-1};
function bubbles(t){const R=t._risk,all=R&&R.holders;if(!all||!all.length)return `<p class="hint" style="margin:8px 0">${R?'No holder data for this token yet.':'Loading holder map…'}</p>`;
 const pools=all.filter(h=>h.tag==='pool'),poolPct=pools.reduce((a,h)=>a+(h.pct||0),0);
 const hs=(BUBX.pool?all:all.filter(h=>h.tag!=='pool')).slice(0,24);
 if(!hs.length)return `<p class="hint" style="margin:8px 0">Only the pool holds this token so far.</p>`;
 const W=320,H=220,cx=W/2,cy=H/2,max=Math.max(...hs.map(h=>h.pct||0))||1,placed=[];
 hs.forEach((h,idx)=>{const r=Math.max(7,Math.sqrt((h.pct||0)/max)*44);let a=0,d=0,x=cx,y=cy;
  for(let i=0;i<1200;i++){x=cx+Math.cos(a)*d;y=cy+Math.sin(a)*d*.7;if(x-r>2&&x+r<W-2&&y-r>2&&y+r<H-2&&placed.every(p=>Math.hypot(p.x-x,p.y-y)>=p.r+r+2))break;a+=.45;d+=.6}
  placed.push({x,y,r,h,idx})});
 const sel=hs[BUBX.sel]||null,tagL={bundle:'Bundle',dev:'Creator',pool:'Pool'};
 return `<svg class="bmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Holder bubble map">${placed.map(p=>`<g class="bb ${p.h.tag||''}${p.idx===BUBX.sel?' sel':''}" data-act="bubpick" data-i="${p.idx}" tabindex="0" role="button" aria-label="Holder ${p.idx+1}, ${(p.h.pct||0).toFixed(2)}%"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}"/>${p.r>11?`<text x="${p.x.toFixed(1)}" y="${(p.y+3.5).toFixed(1)}">${p.h.pct<1?p.h.pct.toFixed(1):Math.round(p.h.pct)}%</text>`:''}<title>${esc(short(p.h.owner))} · ${(p.h.pct||0).toFixed(2)}%${p.h.tag?' · '+(tagL[p.h.tag]||p.h.tag):''}</title></g>`).join('')}</svg>
 ${sel?`<div class="bsel"><span class="bselr">#${BUBX.sel+1}</span><span class="grow"><b class="num">${esc(short(sel.owner))}</b><span class="hint">${(sel.pct||0).toFixed(2)}% of supply${sel.tag?' · '+(tagL[sel.tag]||sel.tag):''}</span></span><button class="cacopy" data-act="copy" data-v="${esc(sel.owner)}" data-m="Wallet address copied" aria-label="Copy wallet address">${ic('copy',14)}</button><a class="lnk" href="https://solscan.io/account/${esc(sel.owner)}" target="_blank" rel="noopener noreferrer">Solscan ↗</a></div>`:`<p class="hint bhint">Tap a bubble to see that wallet.</p>`}
 <div class="blegend"><span class="bundle">Bundle</span><span class="dev">Creator</span><span class="pool">Pool</span><span>Holder</span></div>
 ${pools.length?`<p class="hint bpool">${BUBX.pool?`Showing the pool (${poolPct.toFixed(1)}% of supply).`:`Pool${pools.length>1?'s':''} hold${pools.length>1?'':'s'} ${poolPct.toFixed(1)}% of supply, hidden so you can compare real holders.`} <button class="lnk" data-act="bubpool">${BUBX.pool?'Hide pool':'Show pool'}</button></p>`:''}`}
const RISKB={};
function loadRisk(mint){const t=T[mint];if(!t||!isMintStr(mint)||RISKB[mint]||(t._riskAt&&Date.now()-t._riskAt<6e4))return;RISKB[mint]=1;t._riskAt=Date.now();
 fetch('/api/market/risk/'+mint).then(r=>r.ok?r.json():null).then(j=>{if(!j)return;t._risk=j;const l=$('.sfcard .sflist');if(l&&currentRoute()==='token')l.innerHTML=liveSafety(t)+taxRows(t);const b=$('#lholders');if(b&&currentRoute()==='token')b.innerHTML=holdersPanel(t)}).catch(()=>{}).finally(()=>{RISKB[mint]=0})};
function liveSafety(t){const a=(t.L&&t.L.audit)||{},L=t.L||{};
 const row=(label,ok,val)=>`<div class="sf ${ok==null?'unk':ok?'ok':'bad'}"><span class="sfi">${ok==null?'?':ok?ic('check',14):'!'}</span><span class="grow">${label}</span><b>${val}</b></div>`;
 return `${a.sus?`<div class="sfwarn">${ic('bell',16)} Jupiter flags this token as suspicious. Be very careful.</div>`:''}
 ${row('Mint authority',a.mintOff,a.mintOff==null?'Unknown':a.mintOff?'Revoked':'Active')}
 ${row('Freeze authority',a.freezeOff,a.freezeOff==null?'Unknown':a.freezeOff?'Revoked':'Active')}
 ${row('Top 10 holders',a.top10==null?null:a.top10<30,a.top10==null?'—':a.top10.toFixed(1)+'%')}
 ${row('Dev holds',a.dev==null?null:a.dev<5,a.dev==null?'—':a.dev.toFixed(1)+'%')}
 ${row('Organic activity',L.organic==null?null:L.organic>=50,L.organic==null?'—':Math.round(L.organic)+'/100')}`}
function sfScore(t){const a=(t.L&&t.L.audit)||{},L=t.L||{};
 const ck=[a.mintOff,a.freezeOff,a.top10==null?null:a.top10<30,a.dev==null?null:a.dev<5,L.organic==null?null:L.organic>=50].filter(v=>v!=null);
 const ok=ck.filter(Boolean).length;return {ok,n:ck.length,bad:!!a.sus||ok<ck.length}}
let SFOPEN=null;try{const v=localStorage.getItem('callit.sfOpen');SFOPEN=v==null?null:v==='1'}catch(_){}
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.matches&&d.matches('[data-hold]'))S.holdOpen=d.open},true);
/* Remember open/closed so live re-renders don't snap the panel back. */
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.matches&&d.matches('[data-sf]')){SFOPEN=d.open;try{localStorage.setItem('callit.sfOpen',d.open?'1':'0')}catch(_){}}},true);
function liveLinks(t){const so=(t.L&&t.L.socials)||{},a=(u,l,i)=>u&&/^https?:\/\//.test(u)?`<a class="lk" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${ic(i,15)}${l}</a>`:'';
 return a(so.x,'X','xlogo')+a(so.web,'Website','globe')+a(so.tg,'Telegram','people')+a(`https://dexscreener.com/solana/${t.pool||t.key}`,'DexScreener','market')+a(`https://solscan.io/token/${t.key}`,'Solscan','search')+`<button class="lk" data-act="xsearch" data-k="${esc(t.key)}">${ic('xlogo',13)}Search on X</button>`}
/* What a meme is paired with. SOL is the default, so only show it when it's something else (USDC, a stock token, another meme). */
const QUOTES={'So11111111111111111111111111111111111111112':'SOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':'USDC','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':'USDT','USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB':'USD1'};
function pairChip(t){const q=t.L&&t.L.quote;if(!q||!q.mint||QUOTES[q.mint]==='SOL')return '';const sym=QUOTES[q.mint]||q.sym||'?',stock=/x$/.test(sym)&&sym.length<=6&&!QUOTES[q.mint];
 return ` <a class="chain pairchip${stock?' stock':''}" href="#/token/${esc(q.mint)}" title="Trades against ${esc(sym)}. Buys route through ${esc(sym)} automatically.">${stock?'📈 ':''}Paired · ${esc(sym)}</a>`}
function vLiveToken(t){const key=t.key,tr=S.watch.has(key),on=calls.filter(k=>k.t===key),L=t.L||{},ch=(L.chg||{}).h24;
 S.ltf=S.ltf&&S.ltfUser?S.ltf:((t.ageH||0)<.5?'1m':'15m');S.lmode=S.lmode||'mc';if(!S.ltab){try{S.ltab=localStorage.getItem('callit.ltab')||'calls'}catch(_){S.ltab='calls'}}const lt=LTABS.some(x=>x[0]===S.ltab)?S.ltab:'calls';if(!S.lsrc){try{S.lsrc=localStorage.getItem('callit.lsrc')||'dex'}catch(_){S.lsrc='dex'}}
 return `<div class="pad" style="padding-bottom:0"><div style="display:flex;align-items:center;gap:12px">${tokav(key)}<div style="flex:1;min-width:0"><b class="h2">${esc(t.name)}</b>${L.verified?`<span class="vbadge" title="Verified on Jupiter">${ic('check',11)}</span>`:''} <span class="muted">$${esc(t.sym)}</span>
 <div><span class="chain">Solana</span>${t.lp?` <span class="chain lpchip">${esc(t.lp)}</span>`:''}${pairChip(t)} <button class="copyca" data-act="copy" data-v="${esc(t.ca)}">${short(t.ca)} ${ic('copy',13)}</button></div></div>
 ${(()=>{if(S.connected&&!AL.d)alLoad();const bo=BELLS.has(key);return `<button class="ib bellb ${bo?'on':''}" data-act="bell" data-t="${key}" aria-label="${bo?'Edit':'Set'} alerts for $${esc(t.sym)}" title="Alerts">${ic('bell',18)}</button>`})()}<button class="btn sm ${tr?'primary':'ghost'}" data-act="track" data-t="${key}">${ic('star',15,tr)} ${tr?'On watchlist':'Watchlist'}</button></div>
 <div class="lhead"><span class="price num" id="lprice">${S.lmode==='mc'?fmtSmall(mcap(t)):fmtSmall(t.price)}</span><b class="num ${pcls(ch)}" id="lchg">${pctS(ch)} 24h</b><span class="livetag" title="Live"><i></i>LIVE</span>
 <div class="seg lmode">${[['mc','MC'],['price','Price']].map(([k,l])=>`<button class="${S.lmode===k?'on':''}" data-act="lmode" data-f="${k}">${l}</button>`).join('')}</div></div>
 <div class="lsrc"><button class="lnk" data-act="lsrc">${S.lsrc==='callit'?'Use DexScreener chart':'Use Callit chart'}</button></div>
 <div class="seg ltf" role="tablist">${['1m','5m','15m','1h','4h','1d'].map(x=>`<button class="${S.ltf===x?'on':''}" data-act="ltf" data-f="${x}">${x}</button>`).join('')}</div>
 <div class="lchart" id="lchart" data-mint="${key}"><div class="lchart-msg" id="lchartmsg">${t.pool?'Loading chart…':'No trading pool for a chart yet.'}</div></div>
 <div class="ltabs" role="tablist" aria-label="Token sections">${LTABS.map(([k,l,i])=>`<button role="tab" aria-selected="${lt===k}" class="${lt===k?'on':''}" data-act="ltab" data-f="${k}">${ic(i,15)}<span>${l}</span>${k==='calls'&&on.length?`<b class="num">${on.length}</b>`:''}</button>`).join('')}</div></div>
 <section class="lpanel" data-lp="calls" ${lt==='calls'?'':'hidden'}><div class="pad" style="padding-bottom:0"><div class="lpcallh"><b class="h2">Calls on $${esc(t.sym)}</b><button class="btn sm primary" data-act="newcall" data-t="${key}">Call it</button></div></div>
 <div id="feed" style="border-top:1px solid var(--line);margin-top:6px">${on.map(post).join('')||'<div class="empty"><b>No calls yet</b><p>Call it first and your entry gets stamped at the live market cap.</p></div>'}</div></section>
 <section class="lpanel pad" data-lp="holders" ${lt==='holders'?'':'hidden'}><div id="lholders">${holdersPanel(t)}</div></section>
 <section class="lpanel pad" data-lp="info" ${lt==='info'?'':'hidden'}>
 <div id="lstats">${liveStats(t)}</div>
 <div class="llinks">${liveLinks(t)}</div>
 <div id="lpair">${pairCard(t)}</div><div id="labout">${aboutCard(t)}</div>
 <div id="lheat">${heatCard(t)}</div>${(sc=>`<details class="card sfcard" data-sf ${(SFOPEN==null?sc.bad:SFOPEN)?'open':''}><summary><h3>Safety check</h3><span class="sfbadge ${!sc.n?'unk':sc.bad?(sc.ok>=sc.n-1&&!(t.L&&t.L.audit&&t.L.audit.sus)?'warn':'bad'):'ok'}">${sc.n?`${sc.ok}/${sc.n} passed`:'No data'}</span><span class="sfchev" aria-hidden="true">${ic('down',18)}</span></summary><div class="sflist">${liveSafety(t)}${taxRows(t)}</div><p class="hint" style="margin:10px 0 0">From Jupiter's token audit. Not a guarantee. Always size your bets.</p></details>`)(sfScore(t))}</section>
 <section class="lpanel pad" data-lp="swap" ${lt==='swap'?'':'hidden'}>
 ${key===SOL_MINT||key===USDC_MINT?`<div class="card"><h3>Swap</h3><div data-swapbox></div></div>`:`<div class="card"><div class="tradeh"><h3>Trade $${esc(t.sym)}</h3><span class="ordbtns"><button class="btn sm ghost" data-act="ord" data-k="${key}" data-f="limit">${ic('up',14)} Limit</button><button class="btn sm ghost" data-act="ord" data-k="${key}" data-f="tpsl">${ic('target',14)} TP / SL</button></span></div><div data-swapbox data-tok="${key}"></div><div id="tokords">${ordersList(key)}</div></div>`}</section>`}
/* Token page sections. Panels are all rendered and just shown/hidden, so the chart never reloads. */
const LTABS=[['calls','Calls','promote'],['holders','Holders','profile'],['info','Info','news'],['swap','Swap','swap']];
/* Top holders, with Callit callers named when a holder wallet belongs to one. */
const HWAL={},HWQ=new Set();
function holderCallers(ws){const miss=ws.filter(w=>!(w in HWAL)&&!HWQ.has(w));if(!miss.length)return;miss.forEach(w=>HWQ.add(w));
 fetch('/api/profile?wallets='+miss.slice(0,100).join(',')).then(r=>r.ok?r.json():{map:{}}).then(j=>{miss.forEach(w=>{HWAL[w]=(j.map||{})[w]||null;const p=HWAL[w];if(p){if(p.avatar_url)AVURL[p.handle]=p.avatar_url;if(p.display_name)DN[p.handle]=p.display_name}})})
  .catch(()=>{}).finally(()=>{const [,r,p]=location.hash.split('/');const el=$('#lholders');if(el&&r==='token'&&T[p])el.innerHTML=holdersPanel(T[p])})}
function holdersPanel(t){const R=t._risk,hs=R&&R.holders,a=(t.L&&t.L.audit)||{},mc=mcap(t)||0;
 if(!R){loadRisk(t.key);return `<div class="card">${rskel(5)}</div>`}
 const tags={pool:'Pool',dev:'Creator',bundle:'Bundle'},list=(hs||[]).slice(0,25);holderCallers(list.map(h=>h.owner));
 const sum=`<div class="hsum num"><div><span>Holders</span><b>${t.holders?fmtK(t.holders):'—'}</b></div><div><span>Top 10</span><b class="${a.top10>45?'down':''}">${a.top10!=null?a.top10.toFixed(1)+'%':'—'}</b></div><div><span>Creator</span><b class="${a.dev>15?'down':''}">${a.dev!=null?a.dev.toFixed(1)+'%':'—'}</b></div>${R.bundle&&R.bundle.pct!=null?`<div><span>Bundled</span><b class="${R.bundle.pct>25?'down':''}">${R.bundle.pct.toFixed(1)}%</b></div>`:''}</div>`;
 if(!list.length)return `<div class="card">${sum}<p class="hint" style="margin:10px 0 0">No holder list for this token yet.</p></div>`;
 const max=Math.max(...list.map(h=>h.pct));
 return `<div class="card">${sum}<div class="hlist">${list.map((h,i)=>{const p=HWAL[h.owner],me=h.owner===S.addr;
  return `<div class="hrw"><span class="hrk num">${i+1}</span>${p?`<a class="hwho" href="#/profile/${esc(p.handle)}">${avatar(p.handle)}<span><b>${esc(p.display_name||p.handle)}</b><small>@${esc(p.handle)} · Callit caller</small></span></a>`
   :`<a class="hwho" href="https://solscan.io/account/${esc(h.owner)}" target="_blank" rel="noopener"><span class="tokav alwav">${ic('wallet',14)}</span><span><b class="num">${me?'You':short(h.owner)}</b>${h.tag?`<small class="htag2 ${h.tag}">${tags[h.tag]||h.tag}</small>`:''}</span></a>`}
   <span class="hpct num"><b>${h.pct<0.01?'<0.01':h.pct.toFixed(2)}%</b><small>${mc?fmtUsd(mc*h.pct/100):''}</small><i style="width:${Math.max(3,h.pct/max*100)}%"></i></span>
   ${!p&&!me&&h.tag!=='pool'?`<button class="ib sm" data-act="htrack" data-f="${esc(h.owner)}" title="Track this wallet" aria-label="Track ${short(h.owner)}">${ic('bell',15)}</button>`:'<span aria-hidden="true"></span>'}</div>`}).join('')}</div></div>
 ${bubCard(t)}`}
/* Holder map starts closed: clusters of circles can trigger trypophobia, so people read a heads-up first and choose to open it. */
const bubOpen=()=>{try{return localStorage.getItem('callit.bubopen')==='1'}catch(_){return false}};
let BUBT=null;
function bubCard(t){if(BUBT&&BUBT.key!==t.key){BUBX.sel=-1;BUBX.pool=false}BUBT=t;const o=bubOpen();
 return `<div class="card hmcard${o?' open':''}"><button class="hmtog" data-act="bubtog" aria-expanded="${o}" aria-controls="bubbody"><span class="grow"><b>Holder map</b><small>Bubble view of the top holders</small></span><span class="hmchev">${ic('chev',18)}</span></button>
 <p class="hmwarn">Heads-up: this view shows clusters of circles, which some people find uncomfortable (trypophobia). Tap the arrow to open it, and again to close.</p>
 <div id="bubbody" class="hmbody"${o?'':' hidden'}><div id="bubwrap">${o?bubbles(t):''}</div><a class="lnk" style="padding:6px 0 0;display:inline-block" href="https://v2.bubblemaps.io/map?address=${esc(caOf(t)||t.key)}&chain=solana" target="_blank" rel="noopener">Open in Bubblemaps ↗</a></div></div>`}
/* Pair info (DexScreener-style) and the coin's lore. Loaded on their own and patched in place, never a full re-render. */
const PAIRS={};
function loadPairs(mint,force){const P=PAIRS[mint]||(PAIRS[mint]={});if(P.busy||(!force&&P.at&&Date.now()-P.at<1e4))return;P.busy=1;
 fetch('/api/market/pairs/'+mint).then(r=>r.ok?r.json():null).then(j=>{if(j){P.d=j;P.err=0}else P.err=1}).catch(()=>{P.err=1}).finally(()=>{P.busy=0;P.at=Date.now();
  const [,r,p]=location.hash.split('/');if(r!=='token'||p!==mint||!T[mint])return;const a=$('#lpair'),b=$('#labout');if(a)a.innerHTML=pairCard(T[mint]);if(b)b.innerHTML=aboutCard(T[mint])})}
const PTF=[['m5','5M'],['h1','1H'],['h6','6H'],['h24','24H']];
const agoLong=ms=>{const m=Math.max(0,(Date.now()-ms)/6e4),d=Math.floor(m/1440),h=Math.floor(m%1440/60);return d?`${d}d ${h}h ago`:h?`${h}h ${Math.floor(m%60)}m ago`:`${Math.max(1,Math.floor(m))}m ago`};
const fmtPool=v=>v==null?'—':v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?Math.round(v).toLocaleString():(+v.toPrecision(4)).toLocaleString();
function sbar(a,b){const t=a+b,x=t?a/t*100:50;return `<div class="psbar"><i class="b" style="width:${x}%"></i><i class="s" style="width:${100-x}%"></i></div>`}
function pairCard(t){const P=PAIRS[t.key];if(!P||!P.d){loadPairs(t.key);return P&&P.err?'':`<div class="card pxcard" aria-busy="true"><div class="nrow c nskel"><span class="grow"><i></i><i></i></span></div></div>`}
 const list=P.d.pairs||[];if(!list.length)return '';const i=Math.min(S.pidx|0,list.length-1),x=list[i],tf=S.ptf||'h24',tx=x.txns[tf]||{buys:0,sells:0},fl=t.L&&t.L.flow&&(tf==='m5'||tf==='h1')?t.L.flow[tf]:null;
 const baseUsd=x.liq.base!=null&&x.priceUsd?x.liq.base*x.priceUsd:null,quoteUsd=x.liq.usd!=null&&baseUsd!=null?Math.max(0,x.liq.usd-baseUsd):null;
 return `<div class="card pxcard">${P.d.header&&i===0?`<div class="pxbanner" style="background-image:url('${esc(P.d.header)}')" role="img" aria-label="${esc(t.name)} banner"></div>`:''}
 <div class="ptop"><div><b class="ppair">${esc(x.base.sym)} <span class="muted">/</span> ${esc(x.quote.sym)}</b><div class="hint">Solana › ${esc(x.dex)}${x.via?` <span class="muted">via</span> ${esc(x.via)}`:''}</div></div><a class="lnk" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">DexScreener ↗</a></div>
 ${list.length>1?`<div class="pchips" role="tablist" aria-label="Pairs">${list.map((y,j)=>`<button role="tab" aria-selected="${j===i}" class="${j===i?'on':''}" data-act="pidx" data-f="${j}">${esc(y.quote.sym)} · ${esc(y.dex)}<span class="num">${fmtUsd(y.liq.usd)}</span></button>`).join('')}</div>`:''}
 <div class="prows">${x.createdAt?`<div><span>Pair created</span><b>${agoLong(x.createdAt)}</b></div>`:''}
  <div><span>Pooled ${esc(x.base.sym)}</span><b class="num">${fmtPool(x.liq.base)}${baseUsd!=null?` <em>${fmtUsd(baseUsd)}</em>`:''}</b></div>
  <div><span>Pooled ${esc(x.quote.sym)}</span><b class="num">${fmtPool(x.liq.quote)}${quoteUsd!=null?` <em>${fmtUsd(quoteUsd)}</em>`:''}</b></div>
  <div><span>Paired with <b class="pq">${esc(x.quote.sym)}</b>${x.quote.name&&x.quote.name!==x.quote.sym?` <em class="pqn">${esc(x.quote.name)}</em>`:''}</span><button class="copyca" data-act="copy" data-v="${esc(x.address)}">${short(x.address)} ${ic('copy',13)}</button></div></div></div>`}
function aboutCard(t){const P=PAIRS[t.key],d=P&&P.d;if(!d||(!d.about&&!(d.links||[]).length))return '';
 const txt=d.about||'',long=txt.length>220;
 return `<div class="card acard"><h3>About $${esc(t.sym)}</h3>${!txt?'':long?`<details class="alore"><summary><p class="ptext asum">${rich(txt.slice(0,220))}…</p><span class="lnk amore"></span></summary><p class="ptext">${rich(txt)}</p></details>`:`<p class="ptext">${rich(txt)}</p>`}
 ${(d.links||[]).length?`<div class="alinks">${d.links.map(l=>`<a class="btn sm ghost" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.label)} ↗</a>`).join('')}</div>`:''}
 <p class="hint" style="margin:10px 0 0">Written by the token's creator, not checked by Callit.</p></div>`}
setInterval(()=>{if(document.hidden)return;const [,r,p]=location.hash.split('/');if(r==='token'&&p&&T[p]&&T[p].live)loadPairs(p)},10000);
/* Light refresh of a live token page without touching the chart. */
function liveTick(t){const pr=$('#lprice'),cg=$('#lchg'),st=$('#lstats');if(!pr)return;const ch=((t.L||{}).chg||{}).h24;
 const dir=t._lp?Math.sign(t.price-t._lp):0;t._lp=t.price;if(LCHART&&LCHART.tick&&S.lsrc==='callit')LCHART.tick(t.price);
 flashSet(pr,S.lmode==='mc'?fmtSmall(mcap(t)):fmtSmall(t.price),dir);cg.className='num '+pcls(ch);cg.textContent=pctS(ch)+' 24h';st.innerHTML=liveStats(t);const lh=$('#lheat');if(lh)lh.innerHTML=heatCard(t);renderSwapsSoft()}
function vToken(sym){const t=T[sym];if(!t)return isMintStr(sym)?(loadLiveToken(sym),vTokenLoading(sym)):vHome();if(t.live)return vLiveToken(t);const on=calls.filter(k=>k.t===sym),tr=S.watch.has(sym);
 const head=`<div class="pad" style="padding-bottom:0"><div style="display:flex;align-items:center;gap:12px">${tokav(t.key)}<div style="flex:1;min-width:0"><b class="h2">${esc(t.name)}</b> <span class="muted">$${t.sym}</span><div><span class="chain">${t.chain}</span> <button class="copyca" data-act="copy" data-v="${esc(t.ca)}">${short(t.ca)} ${ic('copy',13)}</button></div></div>
 <button class="btn sm ${tr?'primary':'ghost'}" data-act="track" data-t="${sym}">${ic('star',15,tr)} ${tr?'On watchlist':'Watchlist'}</button></div>`;
 if(t.prelaunch)return head+`<div class="card" style="margin-top:16px">Launches ${esc(t.prelaunch)}. Trading opens after launch.${t.chain!=='Solana'?` In-app trading for ${t.chain} tokens isn't available yet.`:''}</div></div><div id="feed" style="margin-top:12px;border-top:1px solid var(--line)">${on.map(post).join('')}</div>`;
 const up=t.chg>=0;
 return head+`<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:16px 0 10px"><span class="price num" data-price="${sym}">${fmtPrice(t.price)}</span><b class="num ${up?'up':'down'}">${fmtPct(t.chg)} today</b>
 <div class="seg" style="margin-left:auto">${['1H','1D','1W','1M'].map(x=>`<button class="${S.tf===x?'on':''}" data-act="tf" data-f="${x}">${x}</button>`).join('')}</div></div>
 ${chart(t.seed*7+S.tf.charCodeAt(1)*3,up)}
 <div class="stats num"><div><span>Market cap</span><b>${fmtUsd(mcap(t))}</b></div><div><span>Liquidity</span><b>${fmtUsd(t.liq)}</b></div><div><span>24h volume</span><b>${fmtUsd(t.vol)}</b></div><div><span>Holders</span><b>${t.holders.toLocaleString()}</b></div><div><span>Age</span><b>${t.age}</b></div></div>
 ${tradable(t)?`<div class="card"><h3>Trade $${t.sym}</h3><div data-swapbox data-tok="${t.key}"></div></div>`:`<div class="card">In-app trading for ${t.chain} tokens isn't available yet. You can still call it and add it to your watchlist.</div>`}
 <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 4px"><b class="h2">Calls on $${t.sym}</b><button class="btn sm primary" data-act="newcall" data-t="${sym}">Call it</button></div></div>
 <div id="feed" style="border-top:1px solid var(--line);margin-top:10px">${on.map(post).join('')||'<div class="empty"><b>No calls yet</b><p>Call it first and your entry gets stamped at today’s market cap.</p></div>'}</div>`}

let CALLERS={},CBUSY={};
function loadCallers(force){const w=S.lb||'30d';if(CBUSY[w]||(!force&&CALLERS[w]&&Date.now()-CALLERS[w].at<2e4))return;CBUSY[w]=1;
 fetch('/api/leaders/callers?window='+encodeURIComponent(w)).then(r=>r.ok?r.json():{callers:[]}).then(j=>{const list=j.callers||[],sig=JSON.stringify(list),same=CALLERS[w]&&CALLERS[w].sig===sig;CALLERS[w]={at:Date.now(),list,sig};
  list.forEach(c=>{if(c.avatar_url)AVURL[c.handle]=c.avatar_url;if(c.display_name)DN[c.handle]=c.display_name;C[c.handle]=Object.assign(C[c.handle]||{},{h:c.handle,win:c.win,avg:c.avg,calls:c.calls,best:c.best,followers:c.followers||0,pnl:c.pnl||0,real:1})});
  if(!same&&currentRoute()==='callerboard'&&!document.querySelector('#modal .modal'))render()}).catch(()=>{CALLERS[w]=CALLERS[w]||{at:Date.now(),list:[],sig:'[]',err:1}}).finally(()=>{CBUSY[w]=0})}
setInterval(()=>{if(!document.hidden&&currentRoute()==='callerboard')loadCallers(true)},2e4);
function lbActivity(n=8){const rec=calls.filter(k=>k.srv&&k.kind==='meme'&&k.t&&!k.sponsored).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,n);
 if(!rec.length)return '';return `<section class="lbfeed" aria-label="Latest calls"><div class="lbfh"><span class="stlive"><i></i>Live</span><b>Latest calls</b></div>${rec.map(k=>{const p=perf(k);return `<a class="lbfi" href="#/post/${k.id}">${avatar(k.c)}<span class="grow"><b>@${esc(k.c)}</b> called <b>$${esc(symOf(k.t))}</b> at ${fmtUsd(k.entry)}<small class="muted"> · ${esc(k.ago)}</small></span><em class="num ${p==null?'muted':p>=0?'up':'down'}">${p==null?'—':pctS(p)}</em></a>`}).join('')}</section>`}
/* Callerboard has two views. Latest calls is just a live feed: it never touches the ranking. */
function lbToggle(){const v=S.lbv==='latest'?'latest':'rank';return `<div class="pad" style="padding-bottom:0"><div class="seg wide lbtog" role="tablist">${[['rank','Rankings'],['latest','Latest calls']].map(([k,l])=>`<button role="tab" aria-selected="${v===k}" class="${v===k?'on':''}" data-act="lbv" data-f="${k}">${l}</button>`).join('')}</div></div>`}
/* Latest calls: this week's top 10 call cards plus the live list of every new call. Rankings stay on their own tab. */
function vLatestCalls(){if(SYNC()&&Date.now()-(S.lcAt||0)>2e4){S.lcAt=Date.now();loadPosts()}
 const top=topCalls(),act=lbActivity(40);
 return lbToggle()+top+(act?(top?'':'<div style="height:10px"></div>')+act:'')+(!top&&!act?'<div class="empty"><b class="h2">No calls yet</b><p>Every new call shows up here live. Be the first.</p><button class="btn primary" data-act="newcall">Make a call</button></div>':'')
 +'<p class="hint pad">Newest first, updated live. Tap a call to open it. This view doesn’t affect rankings.</p>'}
function vLeaders(){if(S.lbv==='latest')return vLatestCalls();loadCallers();const w=S.lb||'30d',L=ranked(),st=CALLERS[w],podium=L.slice(0,3),me=L.findIndex(c=>c.h===S.me);
 const pod=podium.length?`<div class="podium">${[1,0,2].filter(i=>podium[i]).map(i=>{const c=podium[i];return `<a class="pod p${i+1}" href="#/profile/${esc(c.h)}"><span class="pcrown">${['👑','🥈','🥉'][i]}</span>${avatar(c.h)}<b>${esc(nameOf(c.h))}</b><span class="muted">@${esc(c.h)}</span><span class="pwin num">${c.win}%<small>win</small></span><span class="num ${c.avg>=0?'up':'down'}">${fmtPct(c.avg)} avg</span><span class="pstep">${i+1}</span></a>`}).join('')}</div>`:'';
 const head=`<div class="pad lbhead"><span class="muted">${st?'Ranked by win rate, then average return. Updates live.':'Loading callers…'}</span><div class="seg">${['7d','30d','All time'].map(x=>`<button class="${(S.lb||'30d')===x?'on':''}" data-act="lb" data-f="${x}">${x}</button>`).join('')}</div></div>`;
 if(st&&!L.length)return lbToggle()+head+`<div class="empty"><b class="h2">The board is wide open</b><p>No calls in this window yet. Make the first one and take #1.</p><button class="btn primary" data-act="newcall">Make a call</button></div>`;
 return lbToggle()+head+pod+`<div class="tablewrap" style="border-top:1px solid var(--line)"><table><thead><tr><th>Rank</th><th>Caller</th><th>Win rate</th><th>Avg return</th><th>Calls</th><th>Best call</th><th></th></tr></thead><tbody>
 ${L.map((c,i)=>`<tr class="${c.h===S.me?'mine':''}" data-go="#/profile/${c.h}"><td class="rkc">${i+1}${rankMove('lbt',c.h,i)}</td><td><div class="person">${avatar(c.h)}${esc(c.h)}</div></td><td class="num">${c.win}%</td><td class="num ${c.avg>=0?'up':'down'}">${fmtPct(c.avg)}</td><td class="num">${c.calls}</td><td class="num ${c.best>=0?'up':'down'}">${fmtPct(c.best)}</td>
 <td>${c.h===S.me?'<span class="muted">You</span>':`<button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button>`}</td></tr>`).join('')}</tbody></table></div>${(()=>{RANKS.lbt={};L.forEach((c,i)=>RANKS.lbt[c.h]=i);return ''})()}
 ${me>=0?`<div class="myrank"><span>Your rank</span><b class="num">#${me+1}</b><span class="muted">${L[me].win}% win · ${L[me].calls} calls</span></div>`:''}
 <p class="hint pad">A call wins if it hits its target, or is up at least 50% since the call. Calls earn once they hold 2X. Bought-in calls earn the most.</p>`}
function vLeadersOld(){return topCalls()+`<div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted">Ranked by win rate. Minimum 10 calls. Sponsored calls don't count.</span>
 <div class="seg">${['7d','30d','All time'].map(x=>`<button class="${S.lb===x?'on':''}" data-act="lb" data-f="${x}">${x}</button>`).join('')}</div></div>
 <div class="tablewrap" style="border-top:1px solid var(--line)"><table><thead><tr><th>Rank</th><th>Caller</th><th>Win rate</th><th>Avg return</th><th>Calls</th><th>Best call</th><th></th></tr></thead><tbody>
 ${ranked().map((c,i)=>`<tr data-go="#/profile/${c.h}"><td class="rkc">${i+1}</td><td><div class="person">${avatar(c.h)}${c.h}</div></td><td class="num">${c.win}%</td><td class="num up">${fmtPct(c.avg)}</td><td class="num">${c.calls}</td><td class="num up">${fmtPct(c.best)}</td>
 <td><button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button></td></tr>`).join('')}</tbody></table></div>
 <p class="hint pad">A call wins if it hits its target, or is up at least 50% when its time window closes. Calls earn once they hold 2X. Bought-in calls earn the most.</p>`}

/* Live portfolio board: total that flashes on every tick, today's move, allocation bar, YTD line. */
let WPREV=null;
function pboard(rows,tot){const d24=rows.reduce((a,[k,amt])=>{const t=T[k],v=usd(k,amt)||0,c=t&&t.chg!=null&&isFinite(t.chg)?t.chg:0;return a+(v-v/(1+c/100))},0),
 base=tot-d24,p24=base>0?d24/base*100:0,up=d24>=0,fl=WPREV==null||Math.abs(tot-WPREV)<.005?'':tot>WPREV?' fl-up':' fl-dn';WPREV=tot;
 const segs=rows.map(([k,a])=>({k,v:usd(k,a)||0})).filter(x=>x.v>0),top=segs.slice(0,4),rest=segs.slice(4).reduce((a,x)=>a+x.v,0);
 const col=k=>k==='SOL'?'#9B7BFF':k==='USDC'?'#4DA8FF':`hsl(${hue(symOf(k))} 62% 52%)`;
 const st=statsOf(S.me);
 return `<div class="pboard ${up?'is-up':'is-down'}"><i class="pbglow" aria-hidden="true"></i>
 <div class="pbtop"><span class="pblab">Portfolio</span><span class="stlive"><i></i>Live</span></div>
 <div class="pbval num${fl}" aria-live="polite">${tot<1e6?'$'+tot.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):fmtUsd(tot)}</div>
 <div class="pbchg num"><span class="${up?'up':'down'}">${ic(up?'up':'down',13)} ${money(d24)} (${fmtPct(p24)})</span><span class="muted">today</span>${st.n?`<span class="pbdot"></span><span class="${st.pnl>=0?'up':'down'}">${money(st.pnl)}</span><span class="muted">all-time</span>`:''}</div>
 ${segs.length?`<div class="pbbar" role="img" aria-label="Allocation">${top.map(x=>`<i style="flex:${x.v};background:${col(x.k)}"></i>`).join('')}${rest?`<i style="flex:${rest};background:var(--muted)"></i>`:''}</div>
 <div class="pbleg">${top.map(x=>`<span><i style="background:${col(x.k)}"></i>${esc(symOf(x.k))} <b class="num">${Math.round(x.v/tot*100)}%</b></span>`).join('')}${rest?`<span><i style="background:var(--muted)"></i>Other <b class="num">${Math.round(rest/tot*100)}%</b></span>`:''}</div>`
 :`<p class="pbempty muted">Deposit SOL or USDC to start. Your holdings show up here live.</p>`}
 <div class="pbytd">${ytdCard()}</div>
 <button class="copyca pbaddr" data-act="copy" data-v="${S.addr}">${ic('wallet',13)} ${short(S.addr)} ${ic('copy',13)}</button></div>`}
function vWallet(){if(!S.connected)return `<div class="empty"><b class="h2">No wallet connected</b><p>Sign in with email, Google or X and we create a wallet for you. Or connect Phantom, Solflare or Backpack. You always hold your own keys.</p><button class="btn primary" data-act="connect">Connect wallet</button></div>`;
 const rows=Object.entries(S.bal).filter(([k,a])=>a>0&&T[k]).sort((x,y)=>(usd(y[0],y[1])||0)-(usd(x[0],x[1])||0)),tot=rows.reduce((s,[k,a])=>s+(usd(k,a)||0),0);
 return `<div class="pad">${pboard(rows,tot)}
 <div class="acts2 acts3"><button class="btn primary" data-act="deposit">${ic('down',16)} Deposit</button><button class="btn" data-act="withdraw">${ic('up',16)} Withdraw</button><a class="btn" href="#/swap">${ic('swap',16)} Swap</a></div>
 ${earnCard()}${keysCard()}
 <div class="list">${(()=>{const B=pnlBook();return rows.map(([k,a])=>{const x=posPnl(k,B);return holdRow(k,a,usd(k,a)||0,x?x.pnl:null,x?x.pct:null,1)}).join('')})()}</div>
 <div id="walords">${ordersList()}</div><b class="h2" style="display:block;margin:22px 0 4px">History</b><div class="list">${S.activity.map(a=>`<div class="li"><div class="grow"><b>${esc(a.k)}</b><div class="hint">${esc(a.t)}${a.sig?` · <a class="lnk" href="https://solscan.io/tx/${a.sig}" target="_blank" rel="noopener noreferrer">View</a>`:''}</div></div><div class="r num">${esc(a.d)}</div></div>`).join('')||'<div class="empty" style="padding:18px 8px"><b>No history yet</b><p>Deposits, trades and withdrawals show up here.</p></div>'}</div></div>`}

/* ---------- caller earnings + Claim ----------
 * Calls pay once they hold 2X on a rolling-average MC (a wick doesn't count).
 * Bought in and held: 20–30% of Callit's fee on every buy the call brings in. No buy: 5%.
 * Earnings build up here; Claim sends the SOL to this wallet. */
const EARN_RULE={minX:2,noBuy:5,lo:20,hi:30};
const EARN={d:null,busy:0,claiming:0,open:0,at:0};
function loadEarn(force){if(!SYNC()||EARN.busy||(!force&&Date.now()-EARN.at<30e3))return;EARN.busy=1;
 API('/api/earnings').then(j=>{EARN.d=j;EARN.at=Date.now();if(j.rules){EARN_RULE.minX=j.rules.minX;EARN_RULE.noBuy=j.rules.noBuy;EARN_RULE.lo=j.rules.boughtIn[0];EARN_RULE.hi=j.rules.boughtIn[1]}
  if(currentRoute()==='you'&&!document.querySelector('#modal .modal'))render()}).catch(()=>{}).finally(()=>{EARN.busy=0})}
function earnCard(){if(!SYNC())return '';loadEarn();const d=EARN.d;
 if(!d)return `<div class="earn sk"><div class="earnt"><span class="earnic">${ic('crown',18)}</span><b>Caller earnings</b></div><div class="earnamt num">—</div></div>`;
 if(!d.ready)return '';
 const can=d.claimOpen&&d.available>=d.minUsd&&!EARN.claiming;
 const sub=[d.paid>0?`${fmtUsd(d.paid)} paid`:'',d.processing>0?`${fmtUsd(d.processing)} processing`:''].filter(Boolean).join(' · ');
 const why=!d.claimOpen?'Claims open soon. Earnings keep adding up.':d.available<d.minUsd?`Claim from ${fmtUsd(d.minUsd)}`:`Paid in SOL to this wallet${d.available>d.maxUsd?` · up to ${fmtUsd(d.maxUsd)} per claim`:''}`;
 const calls=(d.calls||[]).map(c=>`<a class="earnrow" href="#/post/${esc(c.call_id)}">${c.mint&&T[c.mint]?tokav(c.mint):`<span class="earndot"></span>`}<div class="grow"><b>$${esc(c.sym||'?')}</b><span class="hint">${c.buys} buy${c.buys===1?'':'s'} · ${c.bought_in?`Bought in · ${c.share}%`:`No buy · ${c.share}%`}</span></div><b class="num up">+${fmtUsd(c.usd)}</b></a>`).join('');
 const hist=(d.claims||[]).slice(0,5).map(c=>`<div class="earnrow"><span class="earndot ${esc(c.status)}"></span><div class="grow"><b>${c.status==='sent'?'Claimed':c.status==='pending'?'Processing':'Didn’t go through'}</b><span class="hint">${agoT(c.created_at)} ago${c.sol?` · ${(+c.sol).toFixed(4)} SOL`:''}</span></div><span class="num">${fmtUsd(+c.usd)}</span>${c.signature&&c.status!=='failed'?`<a class="lnk" href="https://solscan.io/tx/${esc(c.signature)}" target="_blank" rel="noopener noreferrer">View</a>`:''}</div>`).join('');
 return `<section class="earn" aria-label="Caller earnings"><div class="earnt"><span class="earnic">${ic('crown',18)}</span><b>Caller earnings</b><button class="earnhow" data-act="earnopen" aria-expanded="${!!EARN.open}">How it works ${ic('chev',14)}</button></div>
 <div class="earnmain"><div><div class="earnamt num">${fmtUsd(d.available)}</div><div class="hint">${sub?esc(sub)+' · ':''}${esc(why)}</div></div>
 <button class="btn primary earnbtn${EARN.claiming?' busy':''}" data-act="claim" ${can?'':'disabled'}>${EARN.claiming?'Sending…':'Claim'}</button></div>
 ${EARN.open?`<div class="earnhowto"><p><b>Call it. Get paid.</b> When people buy a token from your call, you earn part of Callit’s fee on every buy. Payouts start once your call <b>holds ${EARN_RULE.minX}X</b> (a quick wick doesn’t count).</p>
  <div class="earntiers"><div><b>${EARN_RULE.lo}–${EARN_RULE.hi}%</b><span>You bought in and held to your target. Grows as the call climbs.</span></div><div><b>${EARN_RULE.noBuy}%</b><span>You didn’t buy, or sold before your target.</span></div></div>
  <p class="hint">Sells and your own buys never pay out. Calls you drop in Telegram count too once you <a class="lnk" href="#" data-act="tglink">link Telegram</a>.</p></div>`:''}
 ${calls?`<div class="earnlist"><span class="earnh">Top earning calls</span>${calls}</div>`:`<p class="hint earnempty">No earnings yet. Make a call, buy in, and share it. Every buy through it counts.</p>`}
 ${hist?`<div class="earnlist"><span class="earnh">Claims</span>${hist}</div>`:''}</section>`}
async function doClaim(){if(EARN.claiming)return;EARN.claiming=1;render();
 try{const r=await API('/api/earnings',{body:{}});toast(r.status==='sent'?`Claimed ${fmtUsd(r.usd)} · ${(+r.sol).toFixed(4)} SOL sent`:'Claim sent. It’ll confirm in a moment');setTimeout(()=>loadBalances&&loadBalances(),1500)}
 catch(e){toast(e.message||'Claim didn’t go through')}finally{EARN.claiming=0;loadEarn(1);render()}}

/* ---------- Telegram: link your account so calls you drop in groups post as you ---------- */
const TGL={d:null,busy:0};
function loadTg(){if(!SYNC()||TGL.busy)return;TGL.busy=1;API('/api/telegram/link').then(j=>{TGL.d=j;const m=document.querySelector('#tgfield');if(m)m.innerHTML=tgField()}).catch(()=>{}).finally(()=>{TGL.busy=0})}
function tgField(){const d=TGL.d;if(!SYNC())return '<p class="hint">Sign in to link Telegram.</p>';if(!d){loadTg();return '<p class="hint">Checking…</p>'}
 if(!d.available)return `<p class="hint">${esc(d.reason||'Telegram linking is coming soon.')}</p>`;
 return d.linked?`<div class="tgrow">${ic('telegram',18)}<div class="grow"><b>Linked${d.username?' · @'+esc(d.username):''}</b><span class="hint">Contract addresses you drop in Callit groups post as your calls.</span></div><button class="btn sm ghost" data-act="tgunlink">Unlink</button></div>`
  :`<button class="btn ghost block" data-act="tglink">${ic('telegram',16)} Link Telegram</button><p class="hint" style="margin-top:6px">Calls you drop in Telegram groups with the Callit bot then post as you, and earn.</p>`}
async function tgLink(){try{const r=await API('/api/telegram/link',{body:{}});const w=window.open(r.url,'_blank','noopener');if(!w)location.href=r.url;toast('Tap Start in Telegram to finish');setTimeout(()=>{TGL.d=null;loadTg()},8e3)}catch(e){toast(e.message)}}

/* Self-custody: the wallet belongs to the user. Privy-made wallets (email / Google / X sign-ins) can be exported. */
function keysCard(){if(!S.connected)return '';const W=window.CallitWallet,emb=(W&&W.embedded)||[],mine=S.addr&&emb.includes(S.addr);
 return `<div class="keyscard"><span class="keysic">${ic('lock',18)}</span><div class="grow"><b>Your wallet, your keys</b><span class="hint">${mine?'Callit never holds your funds. You can export this wallet’s private key and use it in Phantom, Solflare or Backpack any time.':'This is your own wallet. Callit can’t move anything without your approval in your wallet app.'}</span></div>${mine?`<button class="btn sm ghost" data-act="exportkey">Export key</button>`:''}</div>`}
function exportKeyModal(){const W=window.CallitWallet;if(!W||!W.exportKey)return toast('Sign in again to export your wallet');
 modal('Export your private key','Your key opens in a secure Privy window. Callit never sees it.',`<ul class="keyswarn"><li>Anyone with this key controls your funds. Never share it, screenshot it or paste it into a website.</li><li>Callit staff will <b>never</b> ask for your key or seed phrase.</li><li>Import it into Phantom, Solflare or Backpack to use the same wallet there. It keeps working in Callit too.</li></ul><button class="btn primary block" id="kgo">I understand, show my key</button>`,
  m=>{$('#kgo',m).onclick=async()=>{closeModal();try{await W.exportKey(S.addr)}catch(e){toast(e&&e.message||'Couldn’t open the export window')}}})}
let MEAT=0;
function vProfile(h){if(!h&&S.connected)h=S.me;if(h&&h===S.me&&realAuth()&&Date.now()-MEAT>15000){MEAT=Date.now();setTimeout(loadMe,0)}if(h&&!C[h]&&/^[A-Za-z0-9_]{1,30}$/.test(h)){C[h]={h,win:0,avg:0,calls:0,best:0,followers:0,real:1}}if(h&&h!==S.me&&!PUB[h])loadPub(h);const c=C[h];
 if(!c)return `<div class="empty"><b class="h2">Your profile</b><p>Connect a wallet to create your caller profile and start building a track record.</p><button class="btn primary" data-act="connect">Connect wallet</button></div>`;
 if(S.ptabFor!==h){S.ptab='calls';S.ptabFor=h}
 if(S.blocked.has(h))return blockedView(h);
 const mine=calls.filter(k=>k.c===h),me=h===S.me,r=rankOf(h),f=S.following.has(h);
 const pb=PUB[h]&&!PUB[h].pending?PUB[h]:null,P=me?PROF:pubP(h),nm=P.name||DN[h]||h,fg=me?S.following.size:pb?pb.following:c.real?0:followingOf(h).length,fr=me?(S.followers!=null?S.followers:0):pb?pb.followers:c.real?0:c.followers+(f?1:0);
 return `<div class="banner" style="${bannerBg(h)}">${me?`<button class="bnadd" data-act="editprof" data-f="banner" aria-label="${PROF.banner?'Change':'Add a'} banner">${ic('camera',20)}<span>${PROF.banner?'Change banner':'Add a banner'}</span></button>`:''}</div>
 <div class="phero"><div class="top"><button class="avwrap avbtn" data-act="viewav" data-h="${esc(h)}" aria-label="View profile photo">${avatar(h,'lg')}${r&&r<=3?`<span class="rkbadge">#${r}</span>`:''}</button>${me?'<span style="display:flex;gap:8px"><button class="ib" data-act="shprof" data-h="'+esc(h)+'" aria-label="Share your profile">'+ic('share',18)+'</button>'+(isPrem(S.me)?'<a class="btn sm premp on" href="#/premium">'+ic('verified',15)+' Premium</a>':'<a class="btn sm premp" href="#/premium">'+ic('verified',15)+' Premium</a>')+'<button class="btn sm editp" data-act="editprof">'+ic('pen',15)+' Edit profile</button></span>':`<span style="display:flex;gap:8px"><button class="ib" data-act="shprof" data-h="${esc(h)}" aria-label="Share ${esc(h)}'s profile">${ic('share',18)}</button><button class="ib" data-act="profmenu" data-h="${h}" aria-label="More options for ${esc(h)}">${ic('more',18)}</button><button class="ib" data-act="dm" data-h="${h}" aria-label="Message ${esc(h)}">${ic('messages',18)}</button>${f&&S.connected?ubellBtn(h):''}<button class="btn sm ${f?'ghost':'primary'}" data-act="follow" data-h="${h}">${f?'Following':'Follow'}</button></span>`}</div>
 <div class="pname2"><b class="h2">${esc(nm)}</b>${vbadge(h)}${r?`<span class="rk">${ic('leaderboard',13)} Rank #${r}</span>`:''}</div><div class="muted">@${esc(h)}</div>
 ${P.bio?`<p class="pbio">${esc(P.bio)}</p>`:me?`<p class="pbio muted">Add a bio so people know what you call. <button class="lnk" data-act="editprof" style="padding:0">Add bio</button></p>`:''}
 <div class="pmeta">${P.web?`<a href="${esc(/^https?:/.test(P.web)?P.web:'https://'+P.web)}" target="_blank" rel="noopener">${ic('globe',15)} ${esc(P.web.replace(/^https?:\/\//,''))}</a>`:''}${P.x?`<a href="https://x.com/${esc(P.x.replace('@',''))}" target="_blank" rel="noopener">${ic('xlogo',14)} @${esc(P.x.replace('@',''))}</a>`:''}<span>${ic('wallet',15)} ${me&&S.addr?short(S.addr):'Solana caller'}</span></div>
 <div class="pfollow"><button data-act="follows" data-h="${h}" data-f="following"><b>${fmtK(fg)}</b> Following</button><button data-act="follows" data-h="${h}" data-f="followers"><b>${fmtK(fr)}</b> Followers</button>${rankChip(h)}</div>
 <div class="pdash">${me?ytdCard():''}
 <div class="pstats p6 num">${(()=>{const st=statsOf(h);return `<div><span>All-time PnL</span><b class="${st.n?(st.pnl>=0?'up':'down'):''}">${st.n?money(st.pnl):'—'}</b></div><div><span>Volume</span><b>${st.vol?fmtUsd(st.vol):'—'}</b></div>`})()}<div><span>Win rate</span><b>${c.calls?c.win+'%':'—'}</b></div><div><span>Avg return</span><b>${c.calls?fmtPct(c.avg):'—'}</b></div><div><span>Calls</span><b>${c.calls}</b></div><div><span>Best call</span><b>${c.best?fmtPct(c.best):'—'}</b></div></div></div></div>
 <div class="tabs" style="position:static">${[['calls','Calls'],['holdings','Holdings'],['activity','Activity']].map(([k,l])=>`<button class="${(S.ptab||'calls')===k?'on':''}" data-act="ptab" data-f="${k}">${l}</button>`).join('')}</div>
 <div id="feed">${ptabBody(h,me)||mine.map(post).join('')||`<div class="empty"><b>No calls yet</b>${me?'<p>Your calls and their performance show up here.</p><button class="btn primary" data-act="newcall">Make a call</button>':''}</div>`}</div>`}

function vPromote(){const PK={ads:['Ad board','Your product card rotates through the feed ad slots and the ad board.'],boost:['Feed boost','Pinned in For you for 24 hours.'],spotlight:['Caller spotlight','One top-10 caller covers your project.'],launch:['Launch push','Three top callers cover your launch day.']};
 return `<div class="pad"><p class="muted" style="margin:0 0 16px;max-width:560px">Announce a launch or product on any chain. Promotions are labelled sponsored and never count toward a caller's ranking.</p>
 <div class="field"><label for="pn">Project name</label><input id="pn" class="input" placeholder="e.g. Nebula"></div>
 <div class="field"><label for="pc">Chain</label><select id="pc" class="input">${['Solana','Base','Ethereum','BNB Chain','Arbitrum','Other'].map(x=>`<option>${x}</option>`).join('')}</select></div>
 <div class="field"><label for="pl">Contract address or website</label><input id="pl" class="input" placeholder="Paste a CA or https://"></div>
 <div class="field"><label for="pd">Launch date (optional)</label><input id="pd" type="date" class="input"></div>
 <div class="field"><label for="pp">What should people know?</label><textarea id="pp" class="input" maxlength="400" placeholder="What it does, why now, where to follow"></textarea></div>
 <div class="field"><label>Package</label><div class="pkgs">${Object.entries(PK).map(([k,[a,b]])=>`<button class="pkg ${S.pkg===k?'on':''}" data-act="pkg" data-f="${k}" style="text-align:left"><b>${a}</b><p>${b}</p><p style="margin-top:8px">Pricing set before launch</p></button>`).join('')}</div></div>
 <div id="perr" class="err"></div><button class="btn primary" data-act="submitpromo">Send promotion request</button></div>`}

function vAbout(){return `<div class="prose"><div style="margin-bottom:18px">${socials()}</div><b class="h2" style="display:block;margin-bottom:12px">Call it. Get Paid.</b>
 <p>Callit is where crypto calls get tracked. Every call is stamped with the market cap at the moment it's posted, then followed live, so a caller's record is public and can't be edited.</p>
 <p>Callers earn a share of fees on every buy their calls bring in, once a call holds 2X. Callers who bought in with their own wallet earn the most: skin in the game, visible on every call as position and profit. Projects on any chain can promote launches through top callers, always labelled as sponsored.</p>
 <p>Wallets are non-custodial. Sign in with email, Google or X, or bring Phantom, Solflare or Backpack. Your keys stay yours, and you can export your wallet any time.</p>
 <b class="h2" style="display:block;margin:22px 0 10px">Safety &amp; trust</b>
 <div class="faq"><details><summary>Is Callit audited? Is it safe?</summary><p>Callit doesn’t hold your money. Your funds stay in your own wallet on Solana, and nothing moves unless you approve it. All trading runs through Jupiter, Solana’s most used trading aggregator, whose programs are publicly audited. Callit has no smart contract of its own holding user funds, so there is no Callit contract to audit today. If we add one later (for example $CALLIT staking), it will be reviewed before it holds any funds, and its address will be published here.</p></details><details><summary>Who controls my wallet?</summary><p>You do. Email, Google and X sign-ins get a wallet from Privy, a wallet provider used by many crypto apps. Callit never sees your private key. You can export it any time from You → Wallet and use it in Phantom, Solflare or Backpack. Phantom, Solflare and Backpack users keep using their own wallet as normal.</p></details><details><summary>Can I check what Callit does with my trades?</summary><p>Yes. Every trade is a normal Solana transaction you can look up on Solscan, including the fee. Calls are stamped with the market cap at the moment they’re posted and can’t be edited later.</p></details><details><summary>Will Callit ever ask for my seed phrase?</summary><p>Never. No one from Callit will DM you for your key, seed phrase or funds. Anyone who does is a scammer.</p></details><a class="lnk" href="#/legal/security" style="padding:8px 0 0;display:inline-block">Read Security &amp; Transparency →</a></div>
 <b class="h2" style="display:block;margin:22px 0 10px">Legal &amp; safety</b>
 <div class="doclinks">${DOC_ORDER.map(k=>`<a href="#/legal/${k}">${esc(DOCS[k][0])}<span>›</span></a>`).join('')}</div></div>`}

/* ---------- rail ---------- */
/* Right rail changes with the page: Home leads with a live Market card, Market leads with the Callerboard. */
const ageS=t=>{const h=t&&t.ageH;if(h==null||!isFinite(h))return '';const m=h*60;return m<1?'now':m<60?Math.round(m)+'m':h<24?Math.round(h)+'h':Math.round(h/24)+'d'};
const rskel=n=>Array.from({length:n},()=>'<div class="nrow c nskel" aria-hidden="true"><span class="tokav"></span><span class="grow"><i></i><i></i></span></div>').join('');
/* Home rail (desktop + tablet landscape): latest headlines from the News feed, crypto first. */
function railNews(){const N=NEWS.recent;loadNews('recent');const all=(N.d&&N.d.items)||[],cr=all.filter(x=>x.kind==='crypto'),L=(cr.length>=3?cr:all).slice(0,5);
 const row=x=>{const ext=!/^#\//.test(x.url);return `<a class="li rnews" href="${esc(x.url)}"${ext?' target="_blank" rel="noopener noreferrer nofollow"':''}>${x.sym&&T[x.sym]?tokav(x.sym):pbadge(x.platform,x.url)}<div class="grow"><b>${esc(x.title)}</b><div class="hint">${esc(x.source)} · ${agoMs(x.at)}</div></div></a>`};
 return `<div class="card"><div class="rcardh"><h3>Latest news</h3><a class="lnk" href="#/news">News</a></div><div class="list">${L.length?L.map(row).join(''):N.err&&!all.length?`<p class="hint" style="margin:6px 0">News is unavailable right now.</p>`:Array.from({length:4},()=>'<div class="nrow c nskel" aria-hidden="true"><span class="tokav"></span><span class="grow"><i></i><i></i></span></div>').join('')}</div></div>`}
function marketCard(){const k=['new','almost','grad'].includes(S.rmt)?S.rmt:'new',L={new:'New',almost:'Bonding',grad:'Migrated'};
 const rows=feedRows(k,defFil()),list=(rows||[]).filter(t=>t&&t.sym).slice(0,5);
 const sub=t=>k==='almost'?`<span class="rbond"><i style="width:${Math.round(bond(t))}%"></i></span>${Math.round(bond(t))}%`:k==='new'?`${ageS(t)||'new'} old`:`Migrated ${ageS(t)} ago`;
 return `<div class="card rmkt"><div class="rcardh"><h3>Market</h3><a class="lnk" href="#/market" data-act="rmgo" data-f="${k}">Open</a></div>
 <div class="rseg" role="tablist">${Object.entries(L).map(([x,l])=>`<button role="tab" aria-selected="${k===x}" class="${k===x?'on':''}" data-act="rmt" data-f="${x}">${l}</button>`).join('')}</div>
 <div class="list">${rows===null?rskel(4):list.length?list.map(t=>{const c=chgOf(t,'1h');return `<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${esc(t.sym)}</b><div class="hint">${sub(t)}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b>${c!=null?`<div class="hint ${c>=0?'up':'down'}">${fmtPct(c)}</div>`:''}</div></a>`}).join(''):`<p class="hint" style="margin:10px 0">Nothing ${L[k].toLowerCase()} right now.</p>`}</div></div>`}
function callerCard(){const top=ranked().slice(0,5);
 return `<div class="card"><div class="rcardh"><h3>Callerboard</h3><a class="lnk" href="#/callerboard">See all</a></div>
 <div class="list">${top.length?top.map((c,i)=>`<div class="li"><span class="rrank">${i+1}</span>${avatar(c.h)}<div class="grow"><a class="pname" href="#/profile/${c.h}">${esc(DN[c.h]||c.h)}</a><div class="hint">${c.win}% win · ${c.calls} call${c.calls===1?'':'s'}${c.avg?` · <span class="${c.avg>=0?'up':'down'}">${fmtPct(c.avg)}</span> avg`:''}</div></div>${c.h===S.me?'':`<button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button>`}</div>`).join('')
  :`<p class="hint" style="margin:10px 0">No ranked callers yet. Make a call and take #1.</p><button class="btn primary block" data-act="newcall">Make a call</button>`}</div></div>`}
/* ---------- Desktop Home board (pump.fun-style): the feed plus side-by-side panels.
   Each panel scrolls on its own and can be removed; removed panels come back from “Add panel”. ---------- */
const BP={market:['Market','market','#/market'],calls:['Hot calls','promote','#/callerboard'],callers:['Callerboard','callerboard','#/callerboard'],news:['Latest news','news','#/news'],trending:['Trending','up','#/market'],watch:['Watchlist','star','#/home']};
const BP_DEF=['market','calls','callers'];
const bpGet=()=>{try{const v=JSON.parse(localStorage.getItem('callit.board')||'null');return Array.isArray(v)?v.filter(k=>BP[k]):BP_DEF.slice()}catch(_){return BP_DEF.slice()}};
const bpSet=v=>{try{localStorage.setItem('callit.board',JSON.stringify(v))}catch(_){}};
const boardOn=()=>currentRoute()==='home'&&matchMedia('(min-width:1100px)').matches;
const bpEmpty=t=>`<p class="hint" style="margin:14px 4px">${t}</p>`;
function bpBody(k){
 if(k==='market'){const m=['new','almost','grad'].includes(S.rmt)?S.rmt:'new',L={new:'New',almost:'Bonding',grad:'Migrated'};
  const rows=feedRows(m,defFil()),list=(rows||[]).filter(t=>t&&t.sym).slice(0,40);
  const sub=t=>m==='almost'?`<span class="rbond"><i style="width:${Math.round(bond(t))}%"></i></span>${Math.round(bond(t))}%`:m==='new'?`${ageS(t)||'new'} old`:`Migrated ${ageS(t)} ago`;
  return `<div class="rseg bpseg" role="tablist">${Object.entries(L).map(([x,l])=>`<button role="tab" aria-selected="${m===x}" class="${m===x?'on':''}" data-act="rmt" data-f="${x}">${l}</button>`).join('')}</div>
  <div class="list">${rows===null?rskel(8):list.length?list.map(t=>{const c=chgOf(t,'1h');return `<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${esc(t.sym)}</b>${caBtn(t)}<div class="hint">${sub(t)}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b>${c!=null?`<div class="hint ${c>=0?'up':'down'}">${fmtPct(c)}</div>`:''}</div></a>`}).join(''):bpEmpty(`Nothing ${L[m].toLowerCase()} right now.`)}</div>`}
 if(k==='calls'){const rec=calls.filter(c=>visible(c)&&c.kind==='meme'&&c.t&&!c.sponsored).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,40);
  return rec.length?`<div class="list">${rec.map(c=>{const p=perf(c);return `<a class="li bpcall" href="#/post/${c.id}">${avatar(c.c)}<div class="grow"><div><b>@${esc(c.c)}</b> <span class="hint">called</span> <b>$${esc(symOf(c.t))}</b></div><div class="hint">at ${fmtUsd(c.entry)} · ${esc(c.ago||agoMs(c.at||Date.now()))}</div>${c.thesis?`<div class="bpthesis">${esc(String(c.thesis).slice(0,140))}</div>`:''}</div><div class="r num"><b class="${p==null?'muted':p>=0?'up':'down'}">${p==null?'—':pctS(p)}</b></div></a>`}).join('')}</div>`
   :bpEmpty('No calls yet. Make the first one.')+`<button class="btn primary block" data-act="newcall">Make a call</button>`}
 if(k==='callers'){const top=ranked().slice(0,40);
  return top.length?`<div class="list">${top.map((c,i)=>`<div class="li"><span class="rrank">${i+1}</span>${avatar(c.h)}<div class="grow"><a class="pname" href="#/profile/${c.h}">${esc(DN[c.h]||c.h)}</a><div class="hint">${c.win}% win · ${c.calls} call${c.calls===1?'':'s'}${c.avg?` · <span class="${c.avg>=0?'up':'down'}">${fmtPct(c.avg)}</span> avg`:''}</div></div>${c.h===S.me?'':`<button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button>`}</div>`).join('')}</div>`
   :bpEmpty('No ranked callers yet. Make a call and take #1.')+`<button class="btn primary block" data-act="newcall">Make a call</button>`}
 if(k==='news'){const N=NEWS.recent;loadNews('recent');const L=((N.d&&N.d.items)||[]).slice(0,30);
  return L.length?`<div class="list">${L.map(x=>{const ext=!/^#\//.test(x.url);return `<a class="li rnews" href="${esc(x.url)}"${ext?' target="_blank" rel="noopener noreferrer nofollow"':''}>${pbadge(x.platform,x.url)}<div class="grow"><b>${esc(x.title)}</b><div class="hint">${esc(x.source)} · ${agoMs(x.at)}</div></div></a>`}).join('')}</div>`:N.err?bpEmpty('News is unavailable right now.'):rskel(6)}
 if(k==='watch'){watchFill();const L=[...S.watch].map(x=>T[x]).filter(t=>t&&!t.base&&t.sym);
  return L.length?`<div class="list">${L.map(t=>{const c=chgOf(t,'1h');return `<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${esc(t.sym)}</b><div class="hint">${esc(t.name||'')}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b>${c!=null?`<div class="hint ${c>=0?'up':'down'}">${fmtPct(c)}</div>`:''}</div></a>`}).join('')}</div>`:bpEmpty('Star a token to keep an eye on it here.')}
 if(k==='trending'){const lv=(LIVE.feeds['movers:1h']||[]).map(x=>T[x]).filter(t=>t&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase()));if(!lv.length&&!LIVE.err['movers:1h'])loadFeed('movers:1h');
  const tr=lv.filter(t=>t.live).sort((a,b)=>b.chg-a.chg).slice(0,30);
  return tr.length?`<div class="list">${tr.map(t=>`<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${esc(t.sym)}</b><div class="hint">${(n=>n+(n===1?' call':' calls'))(calls.filter(c=>c.t===t.key).length)}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b><div class="hint ${t.chg>=0?'up':'down'}">${fmtPct(t.chg)}</div></div></a>`).join('')}</div>`:rskel(8)}
 return ''}
/* Column widths (feed + each panel), dragged on the divider like pump.fun. Saved per device. */
const BPW_KEY='callit.boardw';
const bpW=(()=>{try{return JSON.parse(localStorage.getItem(BPW_KEY)||'{}')||{}}catch(_){return {}}})();
const bpWSave=()=>{try{localStorage.setItem(BPW_KEY,JSON.stringify(bpW))}catch(_){}};
const BPMIN={feed:420,panel:250},BPMAX=1400;
/* The content column's width is remembered per page (Home's feed, a token page, DeFi…). */
const feedKey=()=>{const r=currentRoute();return r==='home'?'feed':'feed:'+r};
const feedDef=()=>({home:600,token:720,callerboard:680,you:660,profile:660,news:640,admin:900}[currentRoute()]||620);
function bpApplyFeed(){document.body.style.setProperty('--feedw',(bpW[feedKey()]||feedDef())+'px')}
const bpStyle=k=>bpW[k]?` style="flex:0 0 ${bpW[k]}px;max-width:none"`:'';
const bpRz=(k,l)=>`<div class="bprz" data-rz="${k}" role="separator" aria-orientation="vertical" aria-label="Resize ${l}" title="Drag to resize · double-click to reset" tabindex="0"></div>`;
/* Display size: 90% by default on computers (phones stay at 100%). */
const ZOOMS=[80,85,90,93,95,100,110];
const zoomGet=()=>{let z=null;try{z=+localStorage.getItem('callit.zoom')}catch(_){}return ZOOMS.includes(z)?z:90};
const zoomOn=()=>matchMedia('(min-width:900px) and (pointer:fine)').matches;
function zoomApply(){const z=zoomOn()?zoomGet()/100:1;document.body.style.zoom=z===1?'':String(z);document.documentElement.style.setProperty('--z',String(z))}
zoomApply();addEventListener('resize',zoomApply);
const curZoom=()=>parseFloat(document.body.style.zoom)||1;
let BPMENU=null;
const bpMenu=k=>`<div class="bpmenu" role="menu" aria-label="Change panel">${Object.keys(BP).map(x=>`<button role="menuitemradio" aria-checked="${x===k}" class="${x===k?'on':''}" data-act="bppick" data-f="${k}" data-to="${x}">${ic(BP[x][1],15)}<span>${BP[x][0]}</span>${x===k?ic('check',14):''}</button>`).join('')}</div>`;
function board(){const on=bpGet();
 return bpRz('feed','feed')+on.map(k=>{const [l,icn,href]=BP[k];return `<section class="bp" data-p="${k}" aria-label="${l}"${bpStyle(k)}><header class="bph"><button class="ib bpgrip" draggable="true" data-grip="${k}" aria-label="Drag to move ${l}" title="Drag to move">${ic('grip',16)}</button><span class="bpic">${ic(icn,17)}</span><button class="bpttl" data-act="bpmenu" data-f="${k}" aria-haspopup="menu" aria-expanded="${BPMENU===k}"><h3>${l}</h3>${ic('down',14)}</button>${BPMENU===k?bpMenu(k):''}<a class="lnk bpopen" href="${href}">Open</a><button class="ib bpdel" data-act="bpdel" data-f="${k}" aria-label="Remove ${l} panel" title="Remove panel">${ic('trash',16)}</button></header><div class="bpb" data-p="${k}">${bpBody(k)}${k===on[on.length-1]?railFoot():''}</div>${bpRz(k,l)}</section>`}).join('')
}
function bpAddModal(){const off=Object.keys(BP).filter(k=>!bpGet().includes(k));if(!off.length)return;
 modal('Add a panel','Panels sit beside your feed and scroll on their own.',`<div class="bpopts">${off.map(k=>`<button class="bpopt" data-bp="${k}"><span class="bpic">${ic(BP[k][1],18)}</span><b>${BP[k][0]}</b><span class="hint">Add</span></button>`).join('')}</div>`,
  m=>m.addEventListener('click',e=>{const o=e.target.closest('[data-bp]');if(!o)return;const v=bpGet();v.push(o.dataset.bp);bpSet(v);closeModal();drawRail()}))}
function drawRail(){const r=$('#rail');if(!r||document.body.classList.contains('bpdrag')||BPDRAG)return;const keep={};r.querySelectorAll('.bpb').forEach(b=>keep[b.dataset.p]=b.scrollTop);const sl=r.scrollLeft;
 document.body.classList.toggle('board',boardOn());bpApplyFeed();r.innerHTML=rail();r.scrollLeft=sl;r.querySelectorAll('.bpb').forEach(b=>{if(keep[b.dataset.p])b.scrollTop=keep[b.dataset.p]})}
/* Resize: drag a divider; double-click resets that column. Arrow keys work too. */
document.addEventListener('pointerdown',e=>{const h=e.target.closest&&e.target.closest('.bprz');if(!h)return;e.preventDefault();
 const k=h.dataset.rz,col=k==='feed'?$('#view'):h.closest('.bp');if(!col)return;const x0=e.clientX,w0=col.getBoundingClientRect().width/curZoom(),z=curZoom();
 document.body.classList.add('bpdrag');h.classList.add('on');
 const sk=k==='feed'?feedKey():k;const mv=ev=>{const w=Math.round(Math.min(BPMAX,Math.max(k==='feed'?BPMIN.feed:BPMIN.panel,w0+(ev.clientX-x0)/z)));bpW[sk]=w;
  if(k==='feed')bpApplyFeed();else{const c=document.querySelector(`.bp[data-p="${k}"]`);if(c){c.style.flex=`0 0 ${w}px`;c.style.maxWidth='none'}}};
 const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);document.body.classList.remove('bpdrag');h.classList.remove('on');bpWSave()};
 addEventListener('pointermove',mv);addEventListener('pointerup',up)});
document.addEventListener('dblclick',e=>{const h=e.target.closest&&e.target.closest('.bprz');if(!h)return;delete bpW[h.dataset.rz==='feed'?feedKey():h.dataset.rz];bpWSave();bpApplyFeed();drawRail()});
document.addEventListener('keydown',e=>{const h=e.target.closest&&e.target.closest('.bprz');if(!h||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();
 const k=h.dataset.rz,col=k==='feed'?$('#view'):h.closest('.bp'),w=Math.round(col.getBoundingClientRect().width/curZoom())+(e.key==='ArrowRight'?24:-24);
 bpW[k==='feed'?feedKey():k]=Math.min(BPMAX,Math.max(k==='feed'?BPMIN.feed:BPMIN.panel,w));bpWSave();bpApplyFeed();if(k!=='feed')drawRail();setTimeout(()=>{const n=document.querySelector(`.bprz[data-rz="${k}"]`);n&&n.focus()})});
/* Reorder: drag a panel by its grip onto another panel. */
/* Close the panel switcher on outside click or Escape. */
document.addEventListener('pointerdown',e=>{if(BPMENU&&!(e.target.closest&&e.target.closest('.bpmenu,.bpttl'))){BPMENU=null;drawRail()}});
document.addEventListener('keydown',e=>{if(BPMENU&&e.key==='Escape'){BPMENU=null;drawRail()}});
let BPDRAG=null;
document.addEventListener('dragstart',e=>{const g=e.target.closest&&e.target.closest('[data-grip]');if(!g)return;BPDRAG=g.dataset.grip;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',BPDRAG)}catch(_){}const p=g.closest('.bp');p&&p.classList.add('bpmoving')});
document.addEventListener('dragover',e=>{if(!BPDRAG)return;const p=e.target.closest&&e.target.closest('.bp');if(!p)return;e.preventDefault();document.querySelectorAll('.bp.bpover').forEach(x=>x!==p&&x.classList.remove('bpover'));if(p.dataset.p!==BPDRAG)p.classList.add('bpover')});
document.addEventListener('drop',e=>{if(!BPDRAG)return;const p=e.target.closest&&e.target.closest('.bp');e.preventDefault();if(p&&p.dataset.p!==BPDRAG){const v=bpGet().filter(x=>x!==BPDRAG),i=v.indexOf(p.dataset.p),r=p.getBoundingClientRect();v.splice(e.clientX>r.left+r.width/2?i+1:i,0,BPDRAG);bpSet(v)}BPDRAG=null;drawRail()});
document.addEventListener('dragend',()=>{if(!BPDRAG)return;BPDRAG=null;document.querySelectorAll('.bpmoving,.bpover').forEach(x=>x.classList.remove('bpmoving','bpover'))});
let BPW=null;addEventListener('resize',()=>{const on=boardOn();if(on!==BPW){BPW=on;drawRail()}});
function rail(){const r=currentRoute();if(boardOn())return board();return (r==='market'?callerCard()+railRest(1)+adBoard():r==='home'?adBoard()+marketCard()+railNews()+railRest():adBoard()+railRest())+railFoot()}
const railFoot=()=>`<div class="railfoot">${socials('sm')}<div class="legal" style="justify-content:flex-start"><a href="#/legal/terms">Terms</a><a href="#/legal/privacy">Privacy</a><a href="#/legal/risk">Risks</a><a href="#/legal/security">Security</a><span>© ${new Date().getFullYear()} Callit</span></div></div>`;
function railRest(noCallers){const lv=(LIVE.feeds['movers:1h']||[]).map(k=>T[k]).filter(t=>t&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase()));
 const trend=lv.filter(t=>t.live).sort((a,b)=>b.chg-a.chg).slice(0,5);if(!lv.length&&!LIVE.err['movers:1h'])loadFeed('movers:1h');
 return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Trending</h3><a class="lnk" href="#/market">Market</a></div><div class="list">${trend.length?'':Array.from({length:4},()=>'<div class="nrow c nskel" aria-hidden="true"><span class="tokav"></span><span class="grow"><i></i><i></i></span></div>').join('')}${trend.map(t=>`<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${t.sym}</b><div class="hint">${(n=>n+(n===1?' call':' calls'))(calls.filter(k=>k.t===t.key).length)}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b><div class="hint ${t.chg>=0?'up':'down'}">${fmtPct(t.chg)}</div></div></a>`).join('')}</div></div>
 ${noCallers?'':`<div class="card"><h3>Top callers</h3><div class="list">${ranked().slice(0,4).map(c=>`<div class="li">${avatar(c.h)}<div class="grow"><a class="pname" href="#/profile/${c.h}">${c.h}</a><div class="hint">${c.win}% win rate</div></div><button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button></div>`).join('')}</div>
 <a class="btn ghost block" style="margin-top:10px" href="#/callerboard">See Callerboard</a></div>`}`}

/* ---------- AI assistant ---------- */
const AST={msgs:[],busy:false,err:''};
const AST_START=['Check a token before I call it','What makes a call worth following?','Help me write a thesis for my call','How do caller fees work on Callit?'];
const astText=t=>esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');
function astLog(){if(!AST.msgs.length)return `<div class="astempty"><span class="mark astmark" aria-hidden="true"></span><b class="h2">Check it before you call it.</b>
 <p>Paste a contract address for live data and red flags, or ask how calls and caller fees work.</p>
 <div class="astarts">${AST_START.map((q,i)=>`<button class="astart" data-act="aststart" data-i="${i}">${esc(q)}</button>`).join('')}</div></div>`;
 return AST.msgs.map(m=>m.role==='user'?`<div class="astu">${astText(m.content)}</div>`
  :`<div class="asta"><span class="mark astav" aria-hidden="true"></span><div class="grow">${(m.tokens||[]).map(t=>T[t]?`<a class="ccard asttok" href="#/token/${t}">${tokav(t)}<div class="cn"><b>${esc(T[t].name||T[t].sym)}</b><span class="hint">$${esc(T[t].sym)}</span></div><b class="num">${T[t].price&&T[t].supply?fmtUsd(mcap(T[t])):''}</b></a>`:'').join('')}<div class="astmsg">${astText(m.content)}</div></div></div>`).join('')
  +(AST.busy?`<div class="asta astbusy" role="status"><span class="mark astav" aria-hidden="true"></span><span class="hint">Checking<i>.</i><i>.</i><i>.</i></span></div>`:'')}
function vAssistant(){return `<div class="ast"><div class="astlog" id="astlog" aria-live="polite">${astLog()}</div>
 <div class="astbar">${AST.err?`<p class="asterr">${esc(AST.err)}</p>`:''}<div class="astbox"><textarea class="input" id="astin" rows="1" maxlength="2000" placeholder="Paste a CA or ask anything" aria-label="Message the assistant"></textarea>
 <button class="btn primary astgo" data-act="astsend" aria-label="Send">${ic('up',18)}</button></div>
 <p class="hint astnote">Not financial advice. Always check the contract address.${AST.msgs.length?` <button class="linkbtn" data-act="astnew">New chat</button>`:''}</p></div></div>`}
function drawAst(){const l=$('#astlog');if(!l)return;l.innerHTML=astLog();const bar=$('.astbar');if(bar){const e=bar.querySelector('.asterr');if(e)e.remove();if(AST.err)bar.insertAdjacentHTML('afterbegin',`<p class="asterr">${esc(AST.err)}</p>`)}
 requestAnimationFrame(()=>{const v=l.lastElementChild;v&&v.scrollIntoView({block:'end',behavior:'smooth'})})}
async function astSend(text){const q=String(text||'').trim();if(!q||AST.busy)return;if(!S.connected)return connectModal();
 AST.err='';AST.msgs.push({role:'user',content:q});AST.busy=true;const i=$('#astin');if(i){i.value='';i.style.height=''}drawAst();
 try{const j=await API('/api/assistant',{body:{messages:AST.msgs.map(({role,content})=>({role,content}))}});
  const toks=(j.tokens||[]).map(x=>{const o=regLive(x);return o&&o.key}).filter(Boolean);
  AST.msgs.push({role:'assistant',content:j.reply,tokens:toks})}
 catch(e){AST.msgs.pop();AST.err=e.message==='assistant_not_configured'?'The assistant isn’t switched on yet.':e.message==='assistant_unavailable'?'The assistant is busy. Try again in a moment.':e.message;if(i&&!i.value)i.value=q}
 finally{AST.busy=false;drawAst();const k=$('#astin');k&&k.focus()}}

/* ---------- chrome ---------- */
const NAV_A=[['home','Home'],['market','Market'],['defi','DeFi'],['callerboard','Callerboard'],['you','You'],['assistant','Assistant']];
const NAV_B=[['messages','Messages'],['bookmarks','Bookmarks'],['lists','Lists'],['news','News'],['promote','Promote'],['about','About']];
const TITLES=Object.fromEntries([...NAV_A,...NAV_B,['notifications','Notifications'],['bookmarks','Bookmarks'],['token','Token'],['community','Community'],['post','Post'],['premium','Premium'],['messages','Messages'],['admin','Admin'],['tag','Tag'],['alerts','Alerts'],['legal','Legal'],['profile','Profile'],['quotes','Quotes']]);
P.lists=P.list;P.defi='<circle cx="12" cy="12" r="8.5"/><path d="M8 10h8l-2.5-2.5M16 14H8l2.5 2.5"/>';P.callerboard=P.leaderboard;P.you=P.profile;
const NAVH={stack:[],cur:location.hash||'#/home',back:false};
function goBack(){const prev=NAVH.stack.pop();NAVH.back=true;location.hash=prev&&prev!==location.hash?prev:'#/home'}
const NAVC=(()=>{try{return JSON.parse(localStorage.getItem('callit.navc')||'{}')}catch(_){return {}}})();
function chrome(route){const link=([k,l])=>`<a href="#/${k}" class="${route===k?'on':''}" title="${l}">${k==='notifications'?`<span class="nbadge">${ic('bell')}${unreadN()?`<i>${unreadN()}</i>`:''}</span>`:ic(k)}<span class="lbl">${l}</span></a>`;
 $('#navA').innerHTML=NAV_A.map(link).join('');$('#navB').innerHTML=NAV_B.map(link).join('');
 // Premium sits at the bottom of the tray, under Products (the tray scrolls on short screens).
 $('#navP').innerHTML=`<a href="#/premium" class="navprem${route==='premium'?' on':''}${isPrem(S.me)?' active':''}" title="Premium">${ic('verified',20)}<span class="lbl">${isPrem(S.me)?'Premium':'Get Premium'}</span></a>`;
 // Collapsible tray groups, remembered on this device.
 ['A','B'].forEach(g=>{const shut=!!NAVC[g],btn=document.querySelector(`[data-act="navgrp"][data-f="${g}"]`),nav=$('#nav'+g);
  if(nav)nav.classList.toggle('shut',shut);
  if(btn){btn.setAttribute('aria-expanded',String(!shut));if(!btn.querySelector('.gchev'))btn.insertAdjacentHTML('beforeend',`<span class="gchev" aria-hidden="true">${ic('down',15)}</span>`)}});
 $('#acct').innerHTML=S.connected?`<div class="acctrow"><a class="acct" href="#/you" title="You">${avatar(S.me)}<span class="lbl" style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nameOf(S.me))}</b><span class="hint num">@${esc(S.me)}</span></span></a><button class="ib logout" data-act="logout" aria-label="Log out" title="Log out">${ic('logout',19)}</button></div>`
  :`<button class="btn primary connect" data-act="connect" title="Connect wallet">${ic('wallet',20)}<span class="lbl">Connect wallet</span></button>`;
 $('#pill').innerHTML=`<button class="btn sm swp srch" data-act="search" aria-label="Search">${ic('search',15)}<span>Search</span></button><button class="btn primary sm dep" data-act="deposit">${ic('down',15)}<span>Deposit</span></button>
  <button class="ib hbell${route==='notifications'?' on':''}" data-act="notifs" aria-label="Notifications${unreadN()?`, ${unreadN()} new`:''}"><span class="nbadge">${ic('bell')}${unreadN()?`<i>${unreadN()}</i>`:''}</span></button><button class="ib" data-act="theme" aria-label="Switch theme">${ic('sun')}</button>`;
 syncTray();
 {let bt=$('#btabs');if(!bt){bt=document.createElement('nav');bt.id='btabs';bt.className='btabs';bt.setAttribute('aria-label','Main');document.body.appendChild(bt)}
  bt.innerHTML=[['home','Home','home'],['market','Market','market'],['defi','DeFi','defi'],['callerboard','Callerboard','leaderboard'],['you','You','profile']].map(([h,l,i])=>{const on=route===h;
   return `<a href="#/${h}" class="${on?'on':''}" aria-label="${l}">${h==='you'&&S.connected?avatar(S.me,'btav'):ic(i,23)}<span>${l}</span></a>`}).join('')}
 $('#title').textContent=TITLES[route]||'Home';{const u=$('#upg'),on=isPrem(S.me);u.hidden=true;u.classList.toggle('on',!!on);u.innerHTML=`${ic('verified',18)}<span>Premium</span>`}const bk=$('#back');bk.hidden=route==='home';bk.innerHTML=ic('back',20);
 // phones: the side tray is hidden, so the logo in the header opens it (like X's avatar menu)
 if(!$('#mmenu')){const mm=document.createElement('button');mm.id='mmenu';mm.className='mmenu';mm.dataset.act='collapse';mm.setAttribute('aria-label','Open menu');mm.innerHTML='<span class="mark" aria-hidden="true"></span>';$('.hdr').prepend(mm)}}

const isPhone=()=>matchMedia('(max-width:760px)').matches;
function syncTray(){const open=!document.body.classList.contains('collapsed'),b=$('#brand');b.setAttribute('aria-expanded',open);b.setAttribute('aria-label',open?'Close menu':'Open menu')}
let LCHART=null;
/* DexScreener's chart by default (users know it); Callit's own chart is one tap away. */
const DSIV={'1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'1D'};
function dexChartUrl(mint){const dark=document.documentElement.dataset.theme!=='light'&&!(document.documentElement.dataset.theme!=='dark'&&matchMedia('(prefers-color-scheme: light)').matches);
 return `https://dexscreener.com/solana/${encodeURIComponent(mint)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${dark?'dark':'light'}&theme=${dark?'dark':'light'}&chartStyle=1&chartType=${S.lmode==='price'?'usd':'marketCap'}&interval=${DSIV[S.ltf]||'15'}`}
function mountLiveChart(){const el=$('#lchart');if(!el)return;const t=T[el.dataset.mint];if(!t)return;
 if(S.lsrc!=='callit'&&isMintStr(t.key)){const src=dexChartUrl(t.key),f=el.querySelector('iframe.dsx');if(f&&f.dataset.src===src)return;LCHART=null;
  el.classList.add('dsx');el.innerHTML=`<iframe class="dsx" data-src="${esc(src)}" src="${esc(src)}" title="$${esc(t.sym)} chart by DexScreener" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allow="clipboard-write"></iframe>`;return}
 el.classList.remove('dsx');if(!t.pool)return;
 const msg=$('#lchartmsg');
 LCHART=mountChart(el,{pool:t.pool,mint:t.key,tf:S.ltf,factor:S.lmode==='mc'&&t.supply?t.supply:1,
  onState:st=>{if(!msg)return;msg.hidden=st==='ok';msg.textContent=st==='loading'?'Loading chart…':st==='empty'?'No trades in this timeframe yet.':'Chart is unavailable right now.'}})}
/* Keep live screens fresh. Paused when the tab is hidden. Market + open token every 6s, call tokens every 9s. */
let LTICK=0;setInterval(()=>{if(document.hidden)return;LTICK++;const [,r,p]=location.hash.split('/');
 if(r==='market'&&LTICK%2===0&&!document.querySelector('.sheet.open')){(lfIds(S.tt,filOf(S.tt))||[]).forEach(id=>loadFeed(id))}
 else if(r==='token'&&T[p]&&T[p].live&&!LIVE.tokBusy[p]&&false)loadLiveToken(p,true);
 const cr=canonRoute(r||'home',p);if(LTICK%3===0&&(cr==='home'||cr==='post'||cr==='profile'||cr==='you'))refreshCallTokens();
 if(LTICK%7===0&&['you','token','defi','profile'].includes(cr))loadBalances()},3000);
/* Live token page: price, stats and the newest candle refresh every 2 seconds. */
setInterval(()=>{if(document.hidden)return;const [,r,p]=location.hash.split('/');if(r==='token'&&p&&T[p]&&T[p].live)loadLiveToken(p,true)},2000);
/* Watchlist prices on Home: every 6 seconds, patched in place. */
setInterval(()=>{if(document.hidden||S.tab!=='watchlist'||currentRoute()!=='home')return;const ks=[...S.watch].filter(isMintStr);if(!ks.length)return;
 fetchTokens(ks.slice(0,50)).then(l=>l.forEach(x=>{const t=regLive(x);if(!t)return;const a=document.querySelector(`[data-wpx="${t.key}"]`),b=document.querySelector(`[data-wmc="${t.key}"]`);
  const dir=t._wp?Math.sign(t.price-t._wp):0;t._wp=t.price;if(a)flashSet(a,fmtSmall(t.price),dir);if(b)flashSet(b,fmtSmall(mcap(t)),dir)})).catch(()=>{})},6000);
function render(){if(isPhone())document.body.classList.add('collapsed');const [,r0='home',p]=location.hash.split('/');routeTabs(r0||'home',p);const r=canonRoute(r0||'home',p);let html;
 if(r==='token'&&p&&!T[p]&&LIVEMAP[p]){location.replace('#/token/'+LIVEMAP[p]);return}
 if(r==='community')html=vRoom(p);
 else if(r==='post')html=vPost(p);
 else if(r==='token'){const t=T[p];if(t&&tradable(t)&&p!==S.swap.from){S.swap.from=S.swap.from===p?S.swap.from:(S.swap.from===S.swap.to||!T[S.swap.from]?'SOL':S.swap.from);S.swap.to=p}html=vToken(p)}
 else html=({market:vMarket,trenches:vMarket,defi:vDefi,you:()=>{adminPing();return (S.admin?`<div class="pad" style="padding-bottom:0"><a class="btn sm primary" href="#/admin">${ic('leaderboard',15)} Admin panel</a></div>`:'')+vYou()},profile:()=>vProfile(p),callerboard:vLeaders,admin:vAdmin,promote:vPromote,about:vAbout,
  messages:()=>vMessages(p),lists:()=>vLists(p),
  news:vNews,premium:vPremium,notifications:vNotifs,assistant:vAssistant,bookmarks:vBookmarks,tag:()=>vTag(p),legal:()=>vLegal(p),alerts:vAlerts,quotes:()=>vQuotes(p)}[r]||vHome)();
 if(LCHART){LCHART();LCHART=null}
 $('#view').innerHTML=html;document.body.classList.toggle('mwide',r!=='home');document.body.dataset.route=r;drawRail();chrome(r);renderSwaps();skin($('#view'));syncLanding();mountLiveChart();
 if(r==='post'){wireAttach($('#rbox'),RDRAFT,()=>drawRMedia());if(S.focusReply){S.focusReply=false;setTimeout(()=>{const i=$('#rin');i&&i.focus()},60)}}}

/* ---------- modals ---------- */
/* Keyboard: iOS Safari and in-app browsers ignore interactive-widget, so track the visual viewport
   and lift bottom sheets above the keyboard (--kb) with a height that fits what's left (--vvh). */
(()=>{if(typeof window==='undefined'||!window.visualViewport)return;const vv=window.visualViewport,de=document.documentElement;
 const set=()=>{const kb=Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop));de.style.setProperty('--kb',(kb>60?kb:0)+'px');de.style.setProperty('--vvh',Math.round(vv.height)+'px');de.classList.toggle('kb-open',kb>60)};
 vv.addEventListener('resize',set);vv.addEventListener('scroll',set);set();
 // Keep whatever you're typing in view inside a sheet.
 document.addEventListener('focusin',e=>{const el=e.target;if(!el||!el.matches||!el.matches('textarea,input:not([type=range]):not([type=checkbox])')||!el.closest('.modal,.sh'))return;
  setTimeout(()=>{try{el.scrollIntoView({block:'center',behavior:'smooth'})}catch(_){}},280)})})();
function modal(title,sub,body,onMount){$('#modal').innerHTML=`<div class="scrim" data-act="close"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mhead"><div><h2>${title}</h2>${sub?`<p class="sub">${sub}</p>`:''}</div><button class="ib" data-act="close" aria-label="Close">${ic('x',18)}</button></div>${body}</div></div>`;
 onMount&&onMount($('#modal .modal'));skin($('#modal'));const f=$('#modal input,#modal textarea');f&&f.focus()}
function skin(root){(root||document).querySelectorAll('select.input:not([data-skinned])').forEach(sel=>{sel.dataset.skinned=1;sel.hidden=true;
 const b=document.createElement('button');b.type='button';b.className='input cselect';b.setAttribute('aria-haspopup','listbox');
 const lab=()=>{b.innerHTML=`<span>${esc(sel.options[sel.selectedIndex]?.text||'')}</span>${ic('down',16)}`};lab();sel.after(b);
 b.onclick=e=>{e.stopPropagation();const open=document.querySelector('.cmenu');if(open){open.remove();if(open._for===sel)return}
  const m=document.createElement('div');m.className='cmenu';m.setAttribute('role','listbox');m._for=sel;
  m.innerHTML=[...sel.options].map((o,i)=>`<button type="button" role="option" aria-selected="${i===sel.selectedIndex}" class="${i===sel.selectedIndex?'on':''}" data-i="${i}">${esc(o.text)}${i===sel.selectedIndex?ic('check',16):''}</button>`).join('');
  b.after(m);m.onclick=ev=>{const x=ev.target.closest('[data-i]');if(!x)return;ev.stopPropagation();sel.selectedIndex=+x.dataset.i;sel.dispatchEvent(new Event('change',{bubbles:true}));lab();m.remove()}}})}
document.addEventListener('click',e=>{const m=document.querySelector('.cmenu');if(m&&!e.target.closest('.cmenu'))m.remove()},true);
const closeModal=()=>{const m=$('#modal');
 if(!S.noDraft&&m.querySelector('[data-dsave]')){const tx=($('#cx',m)||{}).value||'',tk=($('#ct',m)||{}).value||'',k=(m.querySelector('[data-ck].on')||{dataset:{}}).dataset.ck||'meme';if(tx.trim()&&addDraft(k,tx,tk))setTimeout(()=>toast('Saved to drafts'),0)}
 S.noDraft=0;m.innerHTML='';if(S.dirty){S.dirty=0;render()}};

const realAuth=()=>!!window.__callitRealAuth;
let pendingNext=null;
function realLogin(via,opts,next){pendingNext=next||null;closeModal();if(window.CallitAuth&&window.CallitAuth.login)window.CallitAuth.login(via,opts);else toast('Sign-in is loading, try again in a second')}
function connectModal(next,mode){modal(mode==='up'?'Create your Callit account':mode==='in'?'Welcome back':'Sign in to Callit',mode==='up'?'Pick a way in. We create a Solana wallet for you, and you own the keys.':mode==='in'?'Sign in the same way you signed up.':'New here? We create a Solana wallet for you. You own the keys.',
 `${['Email','Google','X'].map(l=>`<button class="opt" data-connect="${l}"><span class="tokav" style="background:var(--hi)">${l[0]}</span>Continue with ${l}</button>`).join('')}
 <div class="divider">or use your own wallet</div>${['Phantom','Solflare','Backpack'].map(w=>`<button class="opt" data-connect="${w}">${tokav(w)}${w}</button>`).join('')}`,
 m=>m.addEventListener('click',e=>{const b=e.target.closest('[data-connect]');if(!b)return;signIn(b.dataset.connect,next)}))}
function signIn(via,next,opts){if(realAuth())return realLogin(via,opts,next);S.connected=true;S.addr='CaLL'+Math.random().toString(36).slice(2,10)+'x9Qp2HkWm4Tz7VbN1sRdE3';S.me='caller_'+S.addr.slice(4,8);
  C[S.me]={h:S.me,win:0,avg:0,calls:0,best:0,followers:0};closeModal();try{localStorage.setItem('callit.session',JSON.stringify({addr:S.addr,me:S.me}))}catch(_){}
  toast(['Phantom','Solflare','Backpack'].includes(via)?`${via} connected`:'Signed in. Your wallet is ready');render();next?next():maybeOnboard()}

const CAQ={};
function callModal(pre,draft){if(!S.connected)return connectModal(()=>callModal(pre,draft));
 modal('Make a call','Buy in and call it. Your entry is stamped at the live market cap when you post.',
 `${kindSeg('meme')}<div class="field"><label for="ct">Token</label><input id="ct" class="input" placeholder="Paste a contract address or ticker" value="${pre?'$'+pre:''}"></div><div id="cprev"></div><div id="cbuy"></div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="cg">Target market cap</label><input id="cg" class="input num" inputmode="decimal" placeholder="e.g. 5M"></div>
 <div class="field"><label>Time window</label><div class="seg wide tw" id="ch" data-v="7 days">${[['24 hours','24h'],['3 days','3d'],['7 days','7d'],['30 days','30d']].map(([v,l])=>`<button type="button" class="${v==='7 days'?'on':''}" data-hz="${v}">${l}</button>`).join('')}</div></div></div>
 <div class="field"><label for="cx">Why this token?</label><div class="composer2" id="cbox"><textarea id="cx" class="input" maxlength="280" placeholder="Your thesis. What do you see that others don't?">${esc(draft||'')}</textarea><div id="cmedia"></div>${attachBar()}</div><span class="hint" id="cn">0 / 280</span></div>
 <div class="err" id="cerr"></div><button class="btn primary block" id="cpost" disabled>Post call</button>`,
 m=>{wireKind(m,'meme');let tok=null,sol='0.25',skip=false,asell=false,aslp=0;const CD={media:[]};wireAttach($('#cbox',m),CD,()=>{$('#cmedia',m).innerHTML=mediaGrid(CD.media,1);$('#cbox [data-attn]',m).textContent=CD.media.length?CD.media.length+'/4':''});m.querySelectorAll('[data-hz]').forEach(b=>b.onclick=()=>{m.querySelectorAll('[data-hz]').forEach(x=>x.classList.toggle('on',x===b));$('#ch',m).dataset.v=b.dataset.hz});const inp=$('#ct',m),tx=$('#cx',m),post=$('#cpost',m);
  const canBuy=()=>tok&&tradable(tok);
  const buyOn=()=>canBuy()&&!skip;
  const drawBuy=()=>{const el=$('#cbuy',m);if(tok&&tok.prelaunch){el.innerHTML=`<div class="buybox"><b>Buying opens at launch</b><p class="hint" style="margin:4px 0 0">$${tok.sym} launches ${esc(tok.prelaunch)}. You can buy and call it then.</p></div>`;return}
   if(tok&&!canBuy()){el.innerHTML=`<div class="buybox"><b>No buy for this one</b><p class="hint" style="margin:4px 0 0">In-app buys for ${tok.chain} tokens aren't live yet. You can still call it. Without a buy it earns the smaller caller share.</p></div>`;return}
   const a=parseFloat(sol)||0,usdV=a*T.SOL.price,got=tok?usdV*.995/tok.price:0;
   el.innerHTML=`<div class="buybox"><div class="top"><b>${tok?'Buy $'+tok.sym:'Buy in'}</b><span class="hint num" style="white-space:nowrap">Balance ${fmtAmt(S.bal.SOL)} SOL</span></div>
   ${skip?'':`<div class="presets">${['0.1','0.25','0.5','1'].map(v=>`<button type="button" data-sol="${v}" class="${sol===v?'on':''}">${v} SOL</button>`).join('')}</div>
   <label class="solin"><input id="csol" class="num" inputmode="decimal" value="${esc(sol)}" aria-label="SOL to spend"><button type="button" class="mx" id="cmax">Max</button><span class="muted">SOL</span></label>
   <div class="hint num" style="margin-top:8px">${!a?'Enter an amount':tok?`≈ ${fmtUsd(usdV)} · you get ~${fmtAmt(got)} $${tok.sym} · via Jupiter`:`≈ ${fmtUsd(usdV)} · add a token above to see what you get`}</div>`}
   ${skip?'':`<div class="asell"><label class="skip"><input type="checkbox" id="casell" ${asell?'checked':''}> Auto-sell at my target market cap</label>
   ${asell?`<div class="aslrow"><span class="hint">Stop loss</span><div class="seg" id="caslp">${[[0,'Off'],[30,'-30%'],[50,'-50%']].map(([v,l])=>`<button type="button" data-aslp="${v}" class="${v===aslp?'on':''}">${l}</button>`).join('')}</div></div><p class="hint" style="margin:6px 0 0">Sells on Jupiter even with Callit closed. Needs a buy of $10+ and a target above.</p>`:''}</div>`}
   <label class="skip"><input type="checkbox" id="cskip" ${skip?'checked':''}> Call without buying (smaller fee share)</label></div>`;
   const ca=$('#casell',el);if(ca)ca.onchange=e=>{asell=e.target.checked;drawBuy()};el.querySelectorAll('[data-aslp]').forEach(b=>b.onclick=()=>{aslp=+b.dataset.aslp;drawBuy()});
   const si=$('#csol',el);if(si)si.addEventListener('input',()=>{sol=si.value.replace(/[^0-9.]/g,'');const pos=si.selectionStart;drawBuy();const n=$('#csol',m);n.focus();try{n.setSelectionRange(pos,pos)}catch(_){}check()});
   el.querySelectorAll('[data-sol]').forEach(b=>b.onclick=()=>{sol=b.dataset.sol;drawBuy();check()});
   const cm=$('#cmax',el);if(cm)cm.onclick=e=>{e.preventDefault();sol=maxOf('SOL');drawBuy();check()};
   $('#cskip',el).onchange=e=>{skip=e.target.checked;drawBuy();check()}};
  const check=()=>{$('#cn',m).textContent=tx.value.length+' / 280';post.textContent=(tok?buyOn():!skip)?`Buy ${parseFloat(sol)||0} SOL & post call`:'Post call';post.disabled=!(tok&&!tok.prelaunch&&tx.value.trim().length>=10&&(!buyOn()||parseFloat(sol)>0))};
  const find=()=>{const raw=inp.value.trim().replace(/^\$/,''),v=raw.toUpperCase();tok=Object.values(T).find(t=>!t.base&&(t.ca.toUpperCase()===v))||Object.values(T).filter(t=>!t.base&&String(t.sym).toUpperCase()===v).sort((a,b)=>(b.vol||0)-(a.vol||0))[0]||null;
   if(!tok&&isMintStr(raw)&&!CAQ[raw]){CAQ[raw]=1;fetchToken(raw).then(x=>{if(x){regLive(x);if(inp.value.trim().replace(/^\$/,'')===raw)find()}}).catch(()=>{})}
   $('#cprev',m).innerHTML=tok?`<div class="preview">${tokav(tok.key)}<div style="flex:1"><b>${esc(tok.name)} $${tok.sym}</b> <span class="chain">${tok.chain}</span><div class="hint num">${tok.prelaunch?'Launches '+esc(tok.prelaunch)+'. Calls open at launch.':'Entry would be <b id="cent" class="num">'+fmtUsd(mcap(tok))+'</b> MC <span class="livedot" title="Updates live"></span>'}</div></div></div>`:(v?`<p class="hint" style="margin-top:-6px">${isMintStr(v.length>30?inp.value.trim():'')?'Looking up this contract address…':'No token found. Paste the contract address, or pick one from Search or the Market.'}</p>`:'');drawBuy();check()};
  let CTB=0;const refreshTok=()=>{if(CTB||!tok||!tok.live||!isMintStr(tok.key)||!m.isConnected)return;CTB=1;const k=tok.key;
   fetchToken(k).then(x=>{if(!x||!m.isConnected||!tok||tok.key!==k)return;const prev=mcap(tok);regLive(x);const e=$('#cent',m);if(e)flashSet(e,fmtUsd(mcap(tok)),Math.sign(mcap(tok)-prev))}).catch(()=>{}).finally(()=>{CTB=0})};
  const CTK=setInterval(()=>{if(!m.isConnected)return clearInterval(CTK);if(!document.hidden)refreshTok()},2500);
  inp.addEventListener('input',()=>{find();refreshTok()});tx.addEventListener('input',check);find();refreshTok();
  post.addEventListener('click',()=>{const g=$('#cg',m).value.trim().toUpperCase(),n=parseFloat(g)*(g.endsWith('B')?1e9:g.endsWith('M')?1e6:g.endsWith('K')?1e3:1);
   if(g&&!(n>mcap(tok))){$('#cerr',m).textContent='Target must be above the current market cap of '+fmtUsd(mcap(tok))+'.';return}
   if(buyOn()&&asell&&!g){$('#cerr',m).textContent='Set a target market cap for auto-sell, or untick it.';return}
   let buy=0;if(buyOn()){const a=parseFloat(sol);if(a>S.bal.SOL){$('#cerr',m).textContent=`You only have ${fmtAmt(S.bal.SOL)} SOL. Lower the amount or deposit more.`;return}
    buy=a*T.SOL.price;if(!REALW()){const got=buy*.995/tok.price;S.bal.SOL-=a;S.bal[tok.key]=(S.bal[tok.key]||0)+got;S.activity.unshift({k:'Bought',d:`${fmtAmt(got)} ${tok.sym} for ${a} SOL`,t:'Just now'})}}
   const solIn=parseFloat(sol),thesis=tx.value.trim(),hz=$('#ch',m).dataset.v,media=CD.media.slice();
   const publish=k=>{C[S.me].calls++;afterPost(k,buy?'':'Call posted');const id=k.id;
    if(buy)REALW()?realSwap('SOL',tok.key,solIn,`Buy-in for your $${tok.sym} call`,ok=>{if(ok)return;const c=calls.find(x=>x.id===id);if(c){c.buy=0;render()}toast('Buy-in didn\'t go through. Your call is posted without it')},{callRef:id,after:asell&&n>0?r=>autoSellAtTarget(tok.key,r.outAmount,n,aslp):null}):txRun(`Buy-in for your $${tok.sym} call`,null,{instantApprove:1})};
   if(!SYNC()||!isMintStr(tok.key))return publish({id:Date.now(),c:S.me,kind:'meme',t:tok.key,entry:mcap(tok),buy,thesis,media,target:n||null,horizon:hz,ago:'now',likes:0,reposts:0,replies:0,views:1,fresh:true});
   post.disabled=true;post.textContent='Posting…';
   upMedia(media).then(urls=>API('/api/posts',{body:{kind:'meme',mint:tok.key,body:thesis,media:urls,target_mc:n||null,horizon:hz}}))
    .then(r=>publish(Object.assign(fromRow({...r.post,handle:S.me}),{buy,fresh:true})))
    .catch(e=>{post.disabled=false;check();$('#cerr',m).textContent=e.message})})})}

let SRT=0,STR=0,SUT=0;
/* Copycat tickers ("vamps"): within each ticker, the first one ever launched is the OG.
   If any copy is verified (or a known OG meme), the OG is the oldest of those, so an older scam can't steal the tag. */
const tickOf=t=>String(t.sym||'').toUpperCase().replace(/^\$/,'').trim();
const bornOf=t=>{const d=t&&t.L&&t.L.createdAt;const v=d?Date.parse(d):NaN;return isNaN(v)?null:v};
const legit=t=>!!(t.L&&t.L.verified)||OGSET.has(t.key);
/* Clusters: same ticker OR same name (ignoring case, spaces, symbols) are one narrative, so
   "SpaceXSI $SPCX", "SpaceXSI $SXSI" and "spacexsi" get ONE OG between them, not one each. */
const normK=v=>String(v||'').toLowerCase().replace(/^\$/,'').replace(/[^a-z0-9]/g,'');
function clusters(list){const par={},f=x=>par[x]===x?x:(par[x]=f(par[x])),u=(a,b)=>{par[a]=par[a]||a;par[b]=par[b]||b;par[f(a)]=f(b)};
 list.forEach(t=>{const a=normK(t.sym),b=normK(t.name);if(a)u(a,a);if(b)u(b,b);if(a&&b)u(a,b)});
 const g={};list.forEach(t=>{const k=normK(t.sym)||normK(t.name);if(!k)return;const r=f(k);(g[r]=g[r]||[]).push(t)});return Object.values(g)}
function ogKeys(list){const og=new Set(),run=new Set();og.run=run;og.of={};
 clusters(list).forEach(a=>{a.forEach(t=>{og.of[t.key]=a});
  // OG: a known OG meme wins; else the oldest legit (verified) copy; else the oldest copy.
  const known=a.filter(t=>OGSET.has(t.key));
  if(known.length)known.forEach(t=>og.add(t.key));
  else if(a.length>=2){const dated=a.filter(t=>bornOf(t)!=null);if(dated.length){const pool=dated.some(legit)?dated.filter(legit):dated;og.add(pool.sort((x,y)=>bornOf(x)-bornOf(y))[0].key)}}
  // Runner: the copy with the biggest market cap, if it's actually running.
  if(a.length>=2){const top=[...a].sort((x,y)=>(mcap(y)||0)-(mcap(x)||0))[0];if(top&&(mcap(top)||0)>=2e4)run.add(top.key)}});
 return og}
const ageTag=t=>{const b=bornOf(t);return b==null?'':`<span class="sage" title="Launched ${new Date(b).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}">${ageStr(Math.max(0,(Date.now()-b)/36e5))}</span>`};
/* ---------- Push alerts: wallets, token bells, callers you follow, call milestones ---------- */
const AL={d:null,err:null,busy:0,sub:null};
function pushState(){if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return /iPhone|iPad/.test(navigator.userAgent)&&!matchMedia('(display-mode: standalone)').matches?'ios':'no';
 if(Notification.permission==='denied')return 'denied';return AL.sub?'on':'off'}
function alSync(){if(!('serviceWorker' in navigator)||!('PushManager' in window))return Promise.resolve();return navigator.serviceWorker.ready.then(r=>r.pushManager.getSubscription()).then(s=>{AL.sub=s;pushHeal()}).catch(()=>{})}
alSync();setTimeout(()=>pushHeal(),6000);setTimeout(()=>pushHeal(),25000);
/* Self-heal once per visit: if this device is subscribed under an old server key, re-subscribe; then (re)save it
   to the account, so a failed first save or a sign-in on another account never leaves the phone silent. */
const keyB64=buf=>{if(!buf)return '';const b=new Uint8Array(buf);let x='';b.forEach(c=>x+=String.fromCharCode(c));return btoa(x).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
let HEALED='';
async function pushHeal(force){try{if(!SYNC()||!('Notification' in window)||Notification.permission!=='granted')return;
 const who=S.me||'';if(!force&&HEALED===who)return;HEALED=who;
 const j=await fetch('/api/push/subscribe').then(r=>r.json()).catch(()=>({}));if(!j.key)return;
 const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
 if(sub&&keyB64(sub.options&&sub.options.applicationServerKey)&&keyB64(sub.options.applicationServerKey)!==j.key.replace(/=+$/,'')){await sub.unsubscribe().catch(()=>{});sub=null}
 if(!sub){if(!force&&!AL.sub)return;sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(j.key)})}
 await API('/api/push/subscribe',{body:sub.toJSON()});AL.sub=sub}catch(e){console.warn('[push] heal',e&&e.message);if(force)throw e}}
async function pushTest(btn){if(btn){btn.disabled=true;btn.textContent='Sending…'}
 try{await pushHeal(1);const r=await API('/api/push/test',{body:{}});
  const why=r.ok?null:r.reason==='server'?`The server isn’t set up for push: ${r.detail}`:r.reason==='no_device'?'This device isn’t saved to your account. Tap “Turn on” above and allow notifications.':r.reason==='db'?`Database error: ${r.detail}. Make sure the alerts migration has been run.`
   :(r.errors||[]).some(e=>e.status===403)?'This device was subscribed with an old key. It’s been reset: tap “Turn on” again.':`Sending failed${r.errors&&r.errors[0]?` (${r.errors[0].status||'network'} from ${r.errors[0].host})`:''}.`;
  modal(r.ok?'Test sent':'Test didn’t go through',r.ok?`Sent to ${r.sent} device${r.sent>1?'s':''}.`:'',r.ok?`<p class="hint">You should see “🔔 Callit test” within a few seconds. Nothing showing?</p><ul class="hint" style="padding-left:18px;line-height:1.6;margin:8px 0 0"><li>Android: Settings → Apps → Chrome → Notifications → make sure they’re on, and long-press the Callit notification channel to allow pop-ups.</li><li>Turn off Battery saver / Do Not Disturb, and don’t restrict Chrome’s background battery use.</li><li>Brave: Settings → Privacy → turn on “Use Google services for push messaging”.</li><li>iPhone: alerts only work from the Home Screen app (Share → Add to Home Screen).</li></ul>`:`<p class="hint">${esc(why)}</p>`)}
 catch(e){toast(e.message||'Couldn’t send a test')}finally{if(btn){btn.disabled=false;btn.textContent='Send test notification'}if(currentRoute()==='alerts'&&!document.querySelector('#modal .modal'))render()}}
const b64u=s=>{const p='='.repeat((4-s.length%4)%4),b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...b].map(c=>c.charCodeAt(0)))};
async function pushOn(){if(!S.connected)return connectModal(()=>pushOn());const st=pushState();
 if(st==='ios')return toast('On iPhone: tap Share → Add to Home Screen, then open Callit from there');if(st==='no')return toast('This browser can’t show alerts');
 if(st==='denied')return toast('Alerts are blocked. Allow notifications for this site in your browser settings');
 const perm=await Notification.requestPermission();if(perm!=='granted')return toast('Alerts not allowed');
 try{const j=await fetch('/api/push/subscribe').then(r=>r.json());if(!j.key)return toast('Alerts aren’t set up on the server yet');
  AL.sub=AL.sub||{};await pushHeal(1);if(!AL.sub||!AL.sub.endpoint)throw new Error('Couldn’t register this device');toast('Alerts on for this device');alLoad(1)}catch(e){if(AL.sub&&!AL.sub.endpoint)AL.sub=null;toast(e.message||'Couldn’t turn on alerts')}if(currentRoute()==='alerts')render()}
async function pushOff(){try{const s=AL.sub;if(s){await API('/api/push/subscribe',{method:'DELETE',body:{endpoint:s.endpoint}}).catch(()=>{});await s.unsubscribe()}AL.sub=null;toast('Alerts off for this device')}catch(_){}if(currentRoute()==='alerts')render()}
function alLoad(force){if(!SYNC()||AL.busy||(!force&&AL.d))return;AL.busy=1;API('/api/alerts').then(j=>{AL.d=j;AL.err=null;BELLS=new Set((j.bells||[]).map(b=>b.mint))}).catch(e=>{AL.err=e.message}).finally(()=>{AL.busy=0;if(['alerts','token'].includes(currentRoute())||(currentRoute()==='home'&&S.tab==='watchlist'))if(!document.querySelector('#modal .modal'))render()})}
let BELLS=new Set();
/* X-style 🔔 on a profile: following alone sends no pop-ups; ringing the bell does. */
const UB={};
function ubellBtn(h){if(UB[h]===undefined&&SYNC()){UB[h]=null;API('/api/alerts/user?handle='+encodeURIComponent(h)).then(j=>{UB[h]=j.level||null}).catch(()=>{}).finally(()=>{const el=document.querySelector(`[data-act="ubell"][data-h="${CSS.escape(h)}"]`);if(el)el.outerHTML=ubellBtn(h)})}
 const on=!!UB[h];return `<button class="ib bellb ${on?'on':''}" data-act="ubell" data-h="${esc(h)}" aria-label="${on?'Notifications on':'Turn on notifications'} for @${esc(h)}" title="${on?(UB[h]==='calls'?'Calls only':'All activity'):'Notify me'}">${ic('bell',18)}${on?'<i class="bdot"></i>':''}</button>`}
function ubellModal(h){if(!S.connected)return connectModal();const cur=UB[h]||'off';
 const opt=(k,l,d)=>`<button class="ubopt ${cur===k?'on':''}" data-ub="${k}"><span class="grow"><b>${l}</b><span class="hint">${d}</span></span><span class="ubrad" aria-hidden="true"></span></button>`;
 modal(`Notifications from @${esc(h)}`,'Pop-ups on your phone, even when Callit is closed.',`<div class="ubopts">${opt('all','All activity','Every call, buy, sell and post')}${opt('calls','Calls only','New calls and when their calls hit 2x, 5x, 10x')}${opt('off','Off','Nothing, but you still follow them')}</div>`,
  m=>m.addEventListener('click',e=>{const o=e.target.closest('[data-ub]');if(!o)return;const lv=o.dataset.ub;m.querySelectorAll('[data-ub]').forEach(x=>x.disabled=true);
   API('/api/alerts/user',{body:{handle:h,level:lv}}).then(j=>{UB[h]=j.level||null;closeModal();
    toast(lv==='off'?`Notifications off for @${h}`:lv==='calls'?`🔔 You’ll get @${h}’s calls`:`🔔 You’ll get everything from @${h}`);
    if(lv!=='off'&&pushState()==='off')setTimeout(()=>pushOn(),400);const el=document.querySelector(`[data-act="ubell"][data-h="${CSS.escape(h)}"]`);if(el)el.outerHTML=ubellBtn(h)})
   .catch(er=>{m.querySelectorAll('[data-ub]').forEach(x=>x.disabled=false);toast(er.message)})}))}
function vAlerts(){pushHeal();if(!S.connected)return `<div class="empty"><b class="h2">Sign in for alerts</b><p>Track wallets, bell tokens and get pinged when callers you follow move.</p><button class="btn primary" data-act="connect">Sign in</button></div>`;
 alLoad();const st=pushState(),d=AL.d||(SYNC()?null:{prefs:null,bells:[],wallets:[]}),P=(d&&d.prefs)||{follows:true,bells:true,wallets:true,milestones:true,quiet:false};
 const dev={on:['Alerts are on for this device','You’ll get pop-ups even when Callit is closed.','Turn off','pushoff'],off:['Turn on alerts','Pop-ups on this device, even when Callit is closed.','Turn on','pushon'],
  denied:['Alerts are blocked','Allow notifications for this site in your browser settings, then come back.','',''],ios:['Add Callit to your Home Screen','On iPhone, alerts work once Callit is installed: tap Share → Add to Home Screen, then open it from there.','',''],
  no:['This browser can’t show alerts','Try Chrome, Edge or Brave, or the installed app.','','']}[st];
 const tg=(k,l,h)=>`<label class="altg"><span class="grow"><b>${l}</b><span class="hint">${h}</span></span><input type="checkbox" class="alsw" data-alp="${k}" ${P[k]?'checked':''}></label>`;
 return `<div class="pad">
 <div class="alhero ${st==='on'?'on':''}"><span class="albell">${ic('bell',22)}</span><div class="grow"><b>${dev[0]}</b><p class="hint">${dev[1]}</p></div>${dev[2]?`<button class="btn ${st==='on'?'ghost':'primary'}" data-act="${dev[3]}">${dev[2]}</button>`:''}</div>
 ${st==='on'?`<button class="btn ghost sm" style="margin-top:10px" data-act="pushtest">Send test notification</button>`:''}
 ${d&&d.push===false?`<p class="rdnote" style="margin-top:10px"><b>Push isn’t configured on the server yet.</b> ${esc(d.pushIssue||'')} Redeploy after fixing. Alerts still land in Notifications meanwhile.</p>`:''}
 ${AL.err?`<p class="rdnote" style="margin-top:10px">${esc(AL.err)}</p>`:''}
 <h3 class="alh">What to alert me about</h3><div class="card altgs">
 ${tg('follows','Profiles you 🔔','Calls, buys, sells and posts from profiles where you rang the bell')}
 ${tg('wallets','Tracked wallets','Any Solana wallet you add below, every buy and sell')}
 ${tg('bells','Token bells','Price moves and new calls on tokens you 🔔')}
 ${tg('milestones','Call milestones','When your calls, or calls by profiles you 🔔, hit 2x, 5x, 10x…')}
 ${tg('quiet','Quiet mode','Pause every alert')}</div>
 <h3 class="alh">Tracked wallets <span class="hint">${d?d.wallets.length:0}/30</span></h3>
 <div class="card"><div class="alform"><input id="alw" placeholder="Wallet address" autocomplete="off" spellcheck="false"><input id="all" placeholder="Name (optional)" maxlength="30"><button class="btn primary" data-act="aladd">Track</button></div>
 <div class="list">${d?d.wallets.map(w=>`<div class="li"><span class="tokav alwav">${ic('wallet',16)}</span><div class="grow"><b>${esc(w.label||short(w.address))}</b><div class="hint">${short(w.address)} · <a class="lnk" href="https://solscan.io/account/${esc(w.address)}" target="_blank" rel="noopener">Solscan</a></div></div><button class="btn sm ghost" data-act="aldel" data-f="${esc(w.address)}">Remove</button></div>`).join('')||'<p class="hint" style="margin:10px 0 0">Paste any wallet: a KOL, a whale, a dev. You’ll get a pop-up on every buy and sell.</p>':rskel(2)}</div></div>
 <h3 class="alh">Token bells <span class="hint">${d?d.bells.length:0}/50</span></h3>
 <div class="card"><div class="list">${d?d.bells.map(b=>`<div class="li"><a class="grow" href="#/token/${esc(b.mint)}" style="display:flex;align-items:center;gap:10px">${T[b.mint]?tokav(b.mint):''}<span><b>$${esc(b.sym||short(b.mint))}</b><div class="hint">Alert at ±${+b.pct}% · new calls</div></span></a><button class="btn sm ghost" data-act="belldel" data-f="${esc(b.mint)}">Remove</button></div>`).join('')||'<p class="hint" style="margin:0">Open any token and tap 🔔 to get alerts on it.</p>':rskel(2)}</div></div>
 </div>`}
function bellModal(mint){const t=T[mint];if(!t)return;if(!S.connected)return connectModal(()=>bellModal(mint));const on=BELLS.has(mint);
 modal(`🔔 $${esc(t.sym)} alerts`,'Get a pop-up when the price moves this much, plus every new call on it.',`<div class="bellopts">${[10,20,50,100].map(p=>`<button class="btn ${p===20?'primary':'ghost'}" data-bellpct="${p}">±${p}%</button>`).join('')}</div>
  ${on?`<button class="btn ghost block" style="margin-top:12px" data-bellpct="0">Turn off alerts for $${esc(t.sym)}</button>`:''}${pushState()!=='on'?`<p class="hint" style="margin-top:12px">Pop-ups are off on this device. <a class="lnk" href="#/alerts" data-act="close">Turn them on</a></p>`:''}`,
  m=>m.addEventListener('click',e=>{const b=e.target.closest('[data-bellpct]');if(!b)return;const pct=+b.dataset.bellpct;b.disabled=true;
   (pct?API('/api/alerts/bell',{body:{mint,sym:t.sym,pct,price:t.price}}):API('/api/alerts/bell?mint='+encodeURIComponent(mint),{method:'DELETE'}))
    .then(()=>{pct?BELLS.add(mint):BELLS.delete(mint);closeModal();toast(pct?`🔔 On: $${t.sym} at ±${pct}%`:`Alerts off for $${t.sym}`);if(pct&&pushState()==='off')setTimeout(()=>pushOn(),400);AL.d=null;render()})
    .catch(er=>{b.disabled=false;toast(er.message)})}))}
document.addEventListener('change',e=>{const k=e.target&&e.target.dataset&&e.target.dataset.alp;if(!k)return;const v=e.target.checked;
 API('/api/alerts',{method:'PUT',body:{[k]:v}}).then(()=>{if(AL.d)AL.d.prefs[k]=v}).catch(er=>{e.target.checked=!v;toast(er.message)})});
navigator.serviceWorker&&navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.go)location.hash=e.data.go});
/* ---------- Orders: limit buys, take-profit / stop-loss, trailing stops (Jupiter Trigger v2) ----------
   They live on Jupiter's keepers, so they fire with Callit closed. Min $10 per order (Jupiter's rule). */
const tokPath=k=>k==='SOL'?SOL_MINT:k==='USDC'?USDC_MINT:k;
const ORD={list:null,busy:0,at:0};
function loadOrders(force){if(!REALW()||!S.addr||ORD.busy||(!force&&Date.now()-ORD.at<15e3))return;ORD.busy=1;
 listOrders(S.addr,'active').then(l=>{ORD.list=l}).catch(()=>{ORD.list=ORD.list||[]}).finally(()=>{ORD.busy=0;ORD.at=Date.now();
  const tk=$('#tokords');if(tk){const [,,p]=location.hash.split('/');tk.innerHTML=ordersList(p)}const wo=$('#walords');if(wo)wo.innerHTML=ordersList()})}
const parseMc=v=>{const g=String(v||'').trim().toUpperCase().replace(/[$,\s]/g,'');const n=parseFloat(g);return isFinite(n)&&n>0?n*(g.endsWith('B')?1e9:g.endsWith('M')?1e6:g.endsWith('K')?1e3:1):0};
const mcOfPrice=(mint,p)=>{const t=T[mint];return t&&t.price&&p?mcap(t)*p/t.price:0};
function ordLabel(o){const cash=m=>m===SOL_MINT||m===USDC_MINT,buy=cash(o.inputMint),tok=buy?o.outputMint:o.inputMint;
 if(o.orderType==='oco')return ['TP / SL',`TP ${fmtUsd(mcOfPrice(tok,o.tpPriceUsd))} · SL ${fmtUsd(mcOfPrice(tok,o.slPriceUsd))} MC`,tok];
 if(o.trailingBps)return ['Trailing stop',`Sells ${(o.trailingBps/100).toFixed(0)}% below the peak`,tok];
 const at=`at ${fmtUsd(mcOfPrice(tok,o.triggerPriceUsd))} MC`;
 return [buy?'Limit buy':o.triggerCondition==='below'?'Stop loss':'Take profit',at,tok]}
function ordersList(mint){const l=(ORD.list||[]).filter(o=>!mint||o.inputMint===mint||o.outputMint===mint);if(!ORD.list)loadOrders();if(!l.length)return '';
 return `<div class="ordlist"><div class="ordh">Open orders <span class="hint">run on Jupiter, even with Callit closed</span></div>${l.map(o=>{const [k,d,tok]=ordLabel(o),dec=decOf(o.inputMint==='So11111111111111111111111111111111111111112'?'SOL':o.inputMint),amt=o.remainingInputAmount||o.initialInputAmount,a=amt&&dec!=null?Number(amt)/10**dec:null;
  return `<div class="ordrow"><a class="grow" href="#/token/${esc(tok)}">${T[tok]?tokav(tok):''}<span><b>${esc(k)}${T[tok]?' · $'+esc(T[tok].sym):''}</b><span class="hint">${esc(d)}${a!=null?` · ${fmtAmt(a)} ${esc(symOf(keyOfMint(o.inputMint)))}`:''}</span></span></a><button class="btn sm ghost" data-act="ordcancel" data-f="${esc(o.id)}">Cancel</button></div>`}).join('')}</div>`}
function orderModal(key,mode){if(!S.connected)return connectModal(()=>orderModal(key,mode));if(!REALW()&&!window.__ordTest)return toast('Orders need a real wallet. Sign in first');
 const t=T[key];if(!t||!t.price)return toast('Price not loaded yet. Try again in a second');
 const mc=mcap(t),held=S.bal[key]||0,sy=esc(t.sym),SP=T.SOL.price||0;let m0=mode,pct=100,exp=7;
 const tabs=[['limit','Limit buy'],['tpsl','TP / SL'],['trail','Trailing stop']];
 modal(`Orders · $${sy}`,`Now ${fmtUsd(mc)} MC. Orders run on Jupiter, so they fire even when Callit is closed.`,`<div class="seg wide" id="omode">${tabs.map(([k,l])=>`<button type="button" data-om="${k}" class="${k===m0?'on':''}">${l}</button>`).join('')}</div><div id="obody"></div>
  <div class="field"><label>Expires in</label><div class="seg wide" id="oexp">${[[1,'1 day'],[7,'7 days'],[30,'30 days']].map(([d,l])=>`<button type="button" data-oexp="${d}" class="${d===exp?'on':''}">${l}</button>`).join('')}</div></div>
  <div class="err" id="oerr"></div><button class="btn primary block" id="ogo">Place order</button><p class="hint" style="margin-top:8px">Jupiter needs at least $10 per order. Cancel any time to get your funds back.</p>`,
 m=>{const body=$('#obody',m),err=$('#oerr',m),go=$('#ogo',m);
  const pctRow=()=>`<div class="field"><label>Amount to sell <span class="hint">· you hold ${fmtAmt(held)} $${sy}</span></label><div class="seg wide" id="opct">${[25,50,100].map(v=>`<button type="button" data-opct="${v}" class="${v===pct?'on':''}">${v}%</button>`).join('')}</div></div>`;
  const draw=()=>{err.textContent='';
   body.innerHTML=m0==='limit'?`<div class="field"><label for="oamt">Spend (SOL)</label><input id="oamt" class="input num" inputmode="decimal" placeholder="e.g. 0.1"></div>
    <div class="field"><label for="omc">Buy when market cap hits</label><input id="omc" class="input num" inputmode="decimal" placeholder="e.g. ${fmtUsd(mc*.7).replace('$','')}"><span class="hint">Below now = buy the dip. Above now = buy the breakout.</span></div>`
   :m0==='tpsl'?pctRow()+`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="otp">Take profit at MC</label><input id="otp" class="input num" inputmode="decimal" placeholder="e.g. ${fmtUsd(mc*2).replace('$','')}"></div><div class="field"><label for="osl">Stop loss at MC</label><input id="osl" class="input num" inputmode="decimal" placeholder="e.g. ${fmtUsd(mc*.5).replace('$','')}"></div></div><span class="hint">Fill one or both. With both, whichever hits first sells and cancels the other.</span>`
   :pctRow()+`<div class="field"><label>Sell if it drops this much from its peak</label><div class="seg wide" id="otr">${[10,20,30,50].map(v=>`<button type="button" data-otr="${v}" class="${v===20?'on':''}">${v}%</button>`).join('')}</div></div>`;
   body.querySelectorAll('[data-opct]').forEach(b=>b.onclick=()=>{pct=+b.dataset.opct;body.querySelectorAll('[data-opct]').forEach(x=>x.classList.toggle('on',x===b))});
   body.querySelectorAll('[data-otr]').forEach(b=>b.onclick=()=>body.querySelectorAll('[data-otr]').forEach(x=>x.classList.toggle('on',x===b)));
   go.textContent=m0==='limit'?'Place limit buy':m0==='tpsl'?'Set TP / SL':'Set trailing stop'};
  m.querySelectorAll('[data-om]').forEach(b=>b.onclick=()=>{m0=b.dataset.om;m.querySelectorAll('[data-om]').forEach(x=>x.classList.toggle('on',x===b));draw()});
  m.querySelectorAll('[data-oexp]').forEach(b=>b.onclick=()=>{exp=+b.dataset.oexp;m.querySelectorAll('[data-oexp]').forEach(x=>x.classList.toggle('on',x===b))});
  draw();
  go.onclick=()=>{err.textContent='';const expiresAt=Date.now()+exp*864e5,pFor=v=>t.price*v/mc;let o,desc;
   try{
    if(m0==='limit'){const a=parseFloat($('#oamt',m).value),tg=parseMc($('#omc',m).value);
     if(!(a>0))throw Error('Enter how much SOL to spend.');if(!tg)throw Error('Enter the market cap to buy at.');
     if(a*SP<10)throw Error(`That’s ${fmtUsd(a*SP)}. Jupiter needs at least $10 (about ${(10/SP).toFixed(3)} SOL).`);
     if(a>Math.max(0,(S.bal.SOL||0)-.004))throw Error('Not enough SOL (keep ~0.004 for fees).');
     o={inputMint:SOL_MINT,outputMint:key,inputAmount:toBaseUnits(String(a),9),triggerMint:key,kind:'single',triggerCondition:tg<mc?'below':'above',triggerPriceUsd:pFor(tg)};
     desc=`Limit buy $${t.sym} at ${fmtUsd(tg)} MC`}
    else{const dec=decOf(key);if(dec==null)throw Error('Token details still loading. Try again.');const amt=held*pct/100;
     if(!(amt>0))throw Error(`You don’t hold any $${t.sym} yet.`);if(amt*t.price<10)throw Error(`That’s ${fmtUsd(amt*t.price)}. Jupiter needs at least $10 per order.`);
     const base=toBaseUnits(amt.toFixed(Math.min(dec,9)),dec);
     if(m0==='tpsl'){const tp=parseMc($('#otp',m).value),sl=parseMc($('#osl',m).value);if(!tp&&!sl)throw Error('Set a take-profit or stop-loss market cap.');
      if(tp&&tp<=mc)throw Error('Take profit must be above the current market cap.');if(sl&&sl>=mc)throw Error('Stop loss must be below the current market cap.');
      o=tp&&sl?{kind:'oco',tpPriceUsd:pFor(tp),slPriceUsd:pFor(sl)}:{kind:'single',triggerCondition:tp?'above':'below',triggerPriceUsd:pFor(tp||sl)};
      desc=tp&&sl?`TP ${fmtUsd(tp)} / SL ${fmtUsd(sl)} on $${t.sym}`:tp?`Take profit $${t.sym} at ${fmtUsd(tp)}`:`Stop loss $${t.sym} at ${fmtUsd(sl)}`}
     else{const tr=+(m.querySelector('[data-otr].on')||{dataset:{otr:20}}).dataset.otr;o={kind:'single',triggerCondition:'below',trailingBps:tr*100};desc=`Trailing stop ${tr}% on $${t.sym}`}
     Object.assign(o,{inputMint:key,outputMint:SOL_MINT,inputAmount:base,triggerMint:key})}
   }catch(e){err.textContent=e.message;return}
   closeModal();realTx(desc,step=>placeOrder({...o,owner:S.addr,expiresAt},step).then(r=>r.signature),ok=>{if(ok){toast('Order placed');loadOrders(1)}})}})}
/* Auto-sell at the call's target (ticked in the composer). Runs right after the buy-in lands. */
function autoSellAtTarget(key,outBase,targetMc,slPct){const t=T[key],dec=decOf(key);if(!t||!t.price||!outBase||dec==null)return;
 const mc=mcap(t),usdV=Number(outBase)/10**dec*t.price;if(usdV<10)return toast(`Auto-sell skipped: Jupiter needs a buy of at least $10 (yours was ${fmtUsd(usdV)})`);
 const tp=t.price*targetMc/mc,sl=slPct?t.price*(1-slPct/100):null;
 realTx(`Auto-sell $${t.sym} at ${fmtUsd(targetMc)} MC`,step=>placeOrder({owner:S.addr,inputMint:key,outputMint:SOL_MINT,inputAmount:String(outBase),triggerMint:key,
  ...(sl?{kind:'oco',tpPriceUsd:tp,slPriceUsd:sl}:{kind:'single',triggerCondition:'above',triggerPriceUsd:tp}),expiresAt:Date.now()+30*864e5},step).then(r=>r.signature),ok=>{if(ok){toast('Auto-sell set at your target');loadOrders(1)}})}
setInterval(()=>{if(document.hidden)return;const r=currentRoute();if(r==='token'||r==='you')loadOrders()},15000);
/* Recent searches: tokens and callers you opened from Search, newest first, kept on this device. */
function recentGet(){try{const v=JSON.parse(localStorage.getItem('callit.recent')||'[]');return Array.isArray(v)?v:[]}catch(_){return []}}
function recentAdd(x){const id=y=>y.t==='tok'?'t:'+y.k:'u:'+y.h,l=[x,...recentGet().filter(y=>id(y)!==id(x))].slice(0,12);try{localStorage.setItem('callit.recent',JSON.stringify(l))}catch(_){}}
function recentClear(kind){try{localStorage.setItem('callit.recent',JSON.stringify(recentGet().filter(y=>y.t!==kind)))}catch(_){}}
const SK=[['tokens','Coins','market'],['callers','Callers','profile'],['calls','Calls','promote'],['trends','Trends','news']];
function searchModal(){S.stf=TF_OK.includes(S.stf)?S.stf:'1h';S.sk=SK.some(x=>x[0]===S.sk)?S.sk:'tokens';
 const ph=()=>({callers:'@handle, name or wallet address',calls:'A ticker, token name or words in a call',trends:'Search what’s trending: solana, ETF…',tokens:'Search a token, ticker or paste a CA'})[S.sk];
 const kbar=()=>`<div class="kseg tgl skind" style="--i:${SK.findIndex(x=>x[0]===S.sk)};--n:4;grid-template-columns:repeat(4,1fr)" role="tablist" aria-label="What are you searching for?">${SK.map(([k,l,i])=>`<button type="button" role="tab" aria-selected="${S.sk===k}" class="${S.sk===k?'on':''}" data-sk="${k}">${ic(i,15)}<span>${l}</span></button>`).join('')}</div>`;
 modal('Search','',`${kbar()}<div class="tsearch">${ic('search',18)}<input id="sq" placeholder="${ph()}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div><div class="list" id="sres" style="margin-top:6px"></div>`,
 m=>{const box=$('#sres',m),inp=$('#sq',m),qv=()=>inp.value.trim().replace(/^[$@]/,'');
  const trow2=(t,tf,og)=>{const v=chgOf(t,tf),isOg=og&&og.has(t.key);return `<a class="li srow${isOg?' isog':''}${og&&og.run&&og.run.has(t.key)?' isrun':''}" href="#/token/${t.key}" data-act="close">${tokav(t.key)}<div class="grow"><b>${esc(t.name)}</b>${t.L&&t.L.verified?`<span class="vbadge" title="Verified on Jupiter">${ic('check',10)}</span>`:''}${isOg?'<span class="ogtag" title="The first token launched with this name or ticker">OG</span>':''}${og&&og.run&&og.run.has(t.key)?'<span class="runtag" title="Biggest market cap of every token with this name"><i class="rkt" aria-hidden="true">🚀</i>Runner</span>':''}<div class="hint num">$${esc(t.sym)}${ageTag(t)} · ${fmtSmall(mcap(t))} MC${t.vol?` · V ${fmtSmall(t.vol)}`:''}</div></div><b class="num ${pcls(v)}">${pctS(v)}</b><button class="wstar${S.watch.has(t.key)?' on':''}" data-act="track" data-t="${esc(t.key)}" aria-pressed="${S.watch.has(t.key)}" aria-label="Watchlist" title="Watchlist">${ic('star',17,S.watch.has(t.key))}</button></a>`};
  const prow=c=>`<a class="li" href="#/profile/${c.h}" data-act="close">${avatar(c.h)}<div class="grow"><b>${esc(nameOf(c.h))}</b><div class="hint">@${esc(c.h)}${c.calls?` · ${c.calls} calls, ${c.win}% win rate`:''}</div></div>${rankOf(c.h)?`<span class="rk">#${rankOf(c.h)}</span>`:''}</a>`;
  /* Legit and OG first, then by volume. */
  /* Runner first, then OG, then legit, then biggest market cap. */
  const rank=(list,og)=>list.sort((a,b)=>((og.run&&og.run.has(b.key)?4:0)+(og.has(b.key)?2:0)+(legit(b)?1:0))-((og.run&&og.run.has(a.key)?4:0)+(og.has(a.key)?2:0)+(legit(a)?1:0))||(mcap(b)||0)-(mcap(a)||0));
  const loadTrend=force=>{const id='movers:'+S.stf;if(LIVE.busy[id]||(!force&&LIVE.feeds[id]))return;LIVE.busy[id]=1;
   fetchFeed('movers',S.stf).then(l=>{LIVE.feeds[id]=l.map(regLive).filter(Boolean).map(t=>t.key);LIVE.err[id]=0;LIVE.at[id]=Date.now()}).catch(()=>{LIVE.err[id]=1}).finally(()=>{LIVE.busy[id]=0;if(box.isConnected&&!qv()&&S.sk==='tokens')draw()})};
  const trending=()=>{const id='movers:'+S.stf,ks=LIVE.feeds[id];
   const seg=`<div class="shead"><span class="tsec" style="margin:0">Trending now</span><div class="seg tfseg" role="tablist" aria-label="Timeframe">${TF_OK.filter(x=>x!=='1m').map(x=>`<button type="button" role="tab" aria-selected="${S.stf===x}" class="${S.stf===x?'on':''}" data-stf="${x}">${x}</button>`).join('')}</div></div>`;
   if(!ks){loadTrend();return seg+(LIVE.err[id]?`<p class="hint" style="padding:8px 4px">Live tokens didn't load. <button class="lnk" data-sretry>Try again</button></p>`:Array.from({length:6},()=>`<div class="li sskel" aria-hidden="true"><span class="tokav"></span><div class="grow"><i></i><i></i></div></div>`).join(''))}
   const list=ks.map(k=>T[k]).filter(t=>t&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase())).sort(byChg(S.stf)).slice(0,10);
   return seg+(list.map(t=>trow2(t,S.stf)).join('')||'<p class="hint" style="padding:8px 4px">Nothing trending in this window yet.</p>')};
  const drawCallers=q=>{const ql=q.toLowerCase();clearTimeout(SUT);
   if(!q){box.innerHTML=`<div class="tsec">Top callers</div>`+ranked().slice(0,8).map(prow).join('');return}
   const local=Object.values(C).filter(c=>!S.blocked.has(c.h)&&(c.h.toLowerCase().includes(ql)||nameOf(c.h).toLowerCase().includes(ql))).slice(0,8);
   box.innerHTML=`<div id="sppl">${local.map(prow).join('')}</div>${q.length>=2?'<p class="hint" style="margin:8px 4px" id="sbusy">Searching callers…</p>':''}`+(q.length<2&&!local.length?'<p class="hint" style="padding:8px 4px">Keep typing a username or display name.</p>':'');
   if(q.length<2)return;
   SUT=setTimeout(()=>fetch('/api/profile?q='+encodeURIComponent(q)).then(r=>r.ok?r.json():{profiles:[]}).then(j=>{if(qv()!==q||S.sk!=='callers')return;const el=$('#sppl',m),bz=$('#sbusy',m);if(!el)return;
    (j.profiles||[]).forEach(p=>{if(!C[p.handle])C[p.handle]={h:p.handle,win:0,avg:0,calls:0,best:0,followers:0,real:1};if(p.avatar_url)AVURL[p.handle]=p.avatar_url;if(p.display_name)DN[p.handle]=p.display_name});
    const seen=new Set(),all=[...local.map(c=>c.h),...(j.profiles||[]).map(p=>p.handle)].filter(h=>!S.blocked.has(h)&&!seen.has(h)&&seen.add(h)).slice(0,12);
    el.innerHTML=all.map(h=>prow(C[h])).join('');if(bz)bz.remove();if(!all.length)el.innerHTML=`<p class="hint" style="padding:8px 4px">No caller matches “${esc(q)}”.</p>`})
    .catch(()=>{const bz=$('#sbusy',m);if(bz)bz.textContent='Caller search is unavailable right now.'}),250)};
  const recent=kind=>{const R=recentGet().filter(x=>x.t===kind).slice(0,6);if(!R.length)return '';
   return `<div class="shead"><span class="tsec" style="margin:0">Recent</span><button type="button" class="lnk" data-sclear="${kind}">Clear</button></div>`+R.map(x=>kind==='tok'
    ?`<a class="li srow" href="#/token/${esc(x.k)}" data-act="close">${T[x.k]?tokav(x.k):`<span class="tokav">${esc(String(x.sym||'?').slice(0,3))}</span>`}<div class="grow"><b>${esc(x.name||x.sym)}</b><div class="hint">$${esc(x.sym)}${T[x.k]&&T[x.k].price?` · ${fmtUsd(mcap(T[x.k]))} MC`:''}</div></div><span class="srec" aria-hidden="true">${ic('search',14)}</span></a>`
    :`<a class="li" href="#/profile/${esc(x.h)}" data-act="close">${avatar(x.h)}<div class="grow"><b>${esc(nameOf(x.h))}</b><div class="hint">@${esc(x.h)}</div></div><span class="srec" aria-hidden="true">${ic('search',14)}</span></a>`).join('')};
  const crow=k=>{const n=k.kind==='meme'&&T[k.t]?nums(k):null;return `<a class="li srow" href="#/post/${esc(k.id)}" data-act="close">${k.kind==='meme'&&k.t?tokav(k.t):avatar(k.c)}<div class="grow"><b>${k.kind==='meme'?`$${esc(symOf(k.t))} · `:''}@${esc(k.c)}</b><div class="hint">${k.kind==='meme'?`Called at ${fmtUsd(k.entry)} MC · `:''}${esc(String(k.thesis||'').slice(0,70))}</div></div>${n?`<b class="num ${n.up?'up':'down'}">${fmtPct(n.p)}</b>`:`<span class="hint">${k.ago||''}</span>`}</a>`};
  const drawCalls=q=>{const ql=q.toLowerCase().replace(/^[$#]/,'');clearTimeout(SUT);
   const local=calls.filter(k=>visible(k)&&k.kind!=='random'&&(!ql||(symOf(k.t||'')+' '+((T[k.t]||{}).name||'')+' '+k.thesis+' '+k.c).toLowerCase().includes(ql)));
   box.innerHTML=`<div class="tsec">${q?'Calls':'Latest calls'}</div><div id="scl">${local.slice(0,15).map(crow).join('')||(q.length>=2&&SYNC()?'':`<p class="hint" style="padding:8px 4px">${q?`No calls match “${esc(q)}”.`:'No calls yet.'}</p>`)}</div>${q.length>=2&&SYNC()?'<p class="hint" style="margin:8px 4px" id="sbusy">Searching all calls…</p>':''}`;
   if(q.length<2||!SYNC())return;
   SUT=setTimeout(()=>API('/api/posts?limit=30&calls=1&q='+encodeURIComponent(q)).then(j=>{if(qv()!==q||S.sk!=='calls')return;mergePosts(j.posts||[]);const ids=new Set((j.posts||[]).map(p=>String(p.id)));
    const all=calls.filter(k=>visible(k)&&k.kind!=='random'&&(ids.has(String(k.id))||local.includes(k))).slice(0,25),el=$('#scl',m),bz=$('#sbusy',m);if(bz)bz.remove();
    if(el)el.innerHTML=all.map(crow).join('')||`<p class="hint" style="padding:8px 4px">No calls match “${esc(q)}”.</p>`}).catch(()=>{const bz=$('#sbusy',m);if(bz)bz.textContent='Call search is unavailable right now.'}),250)};
  const drawTrends=q=>{loadNews('trending');loadNews('recent');const t=q.replace(/^#/,'');
   const L=newsList('trending',q).concat(q?newsList('recent',q):[]).slice(0,25);
   box.innerHTML=(t&&/^[A-Za-z0-9_]{2,40}$/.test(t)?`<a class="li srow" href="#/tag/${esc(t.toLowerCase())}" data-act="close"><span class="tagic sm">#</span><div class="grow"><b>#${esc(t)}</b><div class="hint">Posts on Callit with this tag</div></div></a>`:'')
    +`<div class="tsec">${q?'Trending and news':'Trending now'}</div>`+(!NEWS.trending.d?rskel(4):L.length?L.map(x=>nItem(x).replace('class="nitem"','class="nitem sm"')).join(''):`<p class="hint" style="padding:8px 4px">Nothing trending matches “${esc(q)}”.</p>`)
    +`<a class="lnk" href="#/news" data-act="close" style="display:block;padding:10px 4px">Open News</a>`};
  box.addEventListener('newsready',()=>{if(S.sk==='trends')draw()});
  const draw=()=>{const q=qv(),ql=q.toLowerCase();clearTimeout(SRT);
   if(S.sk==='callers'){if(!q){box.innerHTML=recent('usr')+`<div class="tsec">Top callers</div>`+ranked().slice(0,8).map(prow).join('');return}return drawCallers(q)}
   if(S.sk==='calls')return drawCalls(q);if(S.sk==='trends')return drawTrends(q);
   if(!q){box.innerHTML=recent('tok')+trending();return}
   const local=Object.values(T).filter(t=>t.live&&t.price&&(String(t.sym).toLowerCase().startsWith(ql)||t.name.toLowerCase().includes(ql)||t.key===q)).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,5);
   const og0=ogKeys(local);
   box.innerHTML=`<div id="slive">${local.length?`<div class="tsec">Tokens</div>${rank(local,og0).map(t=>trow2(t,'24h',og0)).join('')}`:''}${q.length>=2?'<p class="hint" style="margin:8px 4px" id="sbusy">Searching live tokens…</p>':''}</div>`+(q.length<2&&!local.length?'<p class="hint" style="padding:8px 4px">Keep typing: a ticker, a name or a contract address.</p>':'');
   if(q.length<2)return;
   if(isMintStr(q))fetch('/api/profile?q='+encodeURIComponent(q)).then(r=>r.ok?r.json():{profiles:[]}).then(j=>{const p=(j.profiles||[])[0];if(!p||qv()!==q||S.sk!=='tokens')return;if(p.avatar_url)AVURL[p.handle]=p.avatar_url;if(p.display_name)DN[p.handle]=p.display_name;if(!C[p.handle])C[p.handle]={h:p.handle,win:0,avg:0,calls:0,best:0,followers:0,real:1};
    box.insertAdjacentHTML('afterbegin',`<div class="tsec">Wallet belongs to</div>${prow(C[p.handle])}`)}).catch(()=>{});
   SRT=setTimeout(()=>searchTokens(q).then(res=>{const el=$('#slive',m);if(!el||qv()!==q||S.sk!=='tokens')return;
    const rows=res.map(regLive).filter(Boolean),seen=new Set(),all=[...rows,...local].filter(t=>!seen.has(t.key)&&seen.add(t.key));
    const og=ogKeys(all),top=rank(all,og).slice(0,12),copies=top.filter(t=>!og.has(t.key)&&(og.of[t.key]||[]).some(x=>og.has(x.key))).length;
    el.innerHTML=top.length?`<div class="tsec">Tokens</div>${copies?`<p class="hint sognote">${ic('target',13)} ${copies} cop${copies>1?'ies':'y'} of an OG in here. Check the contract before you buy.</p>`:''}${top.map(t=>trow2(t,'24h',og)).join('')}`:(isMintStr(q)?`<a class="li" href="#/token/${q}" data-act="close"><div class="grow"><b>Open ${short(q)}</b><div class="hint">Look up this contract address</div></div></a>`:`<p class="hint" style="padding:8px 4px">No live token matches “${esc(q)}”.</p>`)})
    .catch(()=>{const b=$('#sbusy',m);if(b)b.textContent='Live search is unavailable right now.'}),250)};
  m.addEventListener('click',e=>{const cl=e.target.closest('[data-sclear]');if(cl){e.preventDefault();recentClear(cl.dataset.sclear);draw();return}
   const hit=e.target.closest('#sres a.li[href]');if(hit){const h=hit.getAttribute('href');let mm;
    if((mm=h.match(/^#\/token\/(.+)$/))){const t=T[decodeURIComponent(mm[1])];if(t)recentAdd({t:'tok',k:t.key,sym:t.sym,name:t.name})}
    else if((mm=h.match(/^#\/profile\/(.+)$/)))recentAdd({t:'usr',h:decodeURIComponent(mm[1])})}
   const k=e.target.closest('[data-sk]');if(k){e.preventDefault();if(S.sk===k.dataset.sk)return;slideTo(k);S.sk=k.dataset.sk;inp.placeholder=ph();draw();inp.focus();return}
   const t=e.target.closest('[data-stf]');if(t){e.preventDefault();S.stf=t.dataset.stf;draw();return}
   if(e.target.closest('[data-sretry]')){LIVE.err['movers:'+S.stf]=0;draw()}});
  inp.addEventListener('input',draw);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){const f=box.querySelector('#slive a.li')||box.querySelector('a.li');if(f){e.preventDefault();const h=f.getAttribute('href');if(h.startsWith('#/token/')){const t=T[decodeURIComponent(h.slice(8))];if(t)recentAdd({t:'tok',k:t.key,sym:t.sym,name:t.name})}location.hash=h;closeModal()}}});
  clearInterval(STR);STR=setInterval(()=>{if(!box.isConnected)return clearInterval(STR);if(!document.hidden&&!qv()&&S.sk==='tokens')loadTrend(true)},10000);
  draw();setTimeout(()=>inp.focus(),40)})}
const NOTIFS=[];
const MOCK_NOTIFS=NOTIFS.slice();
/* Real notifications from the backend replace the demo ones for signed-in users. */
window.callitSetNotifs=list=>{const now=Date.now();
 const before=NOTIFS.map(n=>n.id+':'+n.unread).join();
 NOTIFS.splice(0,NOTIFS.length,...(list?list.map(n=>({id:n.id,real:1,k:NKIND[n.kind]?n.kind:'system',h:n.actor_handle||null,t:n.title,body:n.body||'',go:n.link||'#/notifications',m:Math.max(0,Math.round((now-Date.parse(n.created_at))/6e4)),unread:n.read_at?0:1})):MOCK_NOTIFS.map(n=>({...n}))));
 if(NOTIFS.map(n=>n.id+':'+n.unread).join()===before)return;
 // Only redraw the page when it's the notifications page; elsewhere just the badges (don't wipe a half-typed reply).
 if(currentRoute()==='notifications')render();else chrome(currentRoute())};
const NKIND={welcome:['Callit','promote'],system:['Callit','bell'],calls:['Call','promote'],earn:['Earnings','wallet'],mentions:['Mention','reply'],alerts:['Alert','bell'],follows:['Follow','profile'],likes:['Like','heart'],reposts:['Repost','repost'],replies:['Reply','reply']};
const SOCIALK=new Set(['follows','likes','reposts','replies','mentions']);
const unreadN=()=>NOTIFS.filter(n=>n.unread).length;
const nAgo=m=>m<60?m+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d';
function nrow(n){const [lab,icn]=NKIND[n.k];
 return `<a class="notif${n.unread?' unread':''}" href="${n.go}" data-act="nread" data-f="${n.id}"><span class="nic ${n.k}">${ic(icn,16)}</span>
 ${n.real&&!n.h?'<span class="mark nmark" aria-hidden="true"></span>':n.h?avatar(n.h):tokav(n.sym||'SOL')}<span class="grow"><span class="nl">${n.real?(n.body?`<b>${esc(n.t)}</b><span class="nbody">${esc(n.body)}</span>`:`<b>${esc(n.t)}</b>`):`${n.h?`<b>${esc(n.h)}</b> `:''}${n.body?`<b>${esc(n.t)}</b> ${esc(n.body)}`:esc(n.t)}`}</span><span class="hint">${lab} · ${nAgo(n.m)} ago</span></span>${n.unread?'<i class="ndot"></i>':''}</a>`}
function notifsModal(){modal('Notifications',unreadN()?`${unreadN()} new`:'You\'re all caught up',`<div class="nlist">${NOTIFS.slice(0,5).map(nrow).join('')}</div>
 <a class="btn primary block" href="#/notifications" style="margin-top:14px">View all notifications</a>`)}
function vNotifs(){const f=S.nt||'all',list=NOTIFS.filter(n=>f==='all'||(f==='social'?SOCIALK.has(n.k):n.k===f));
 return `<a class="alertcta" href="#/alerts">${ic('bell',18)}<span class="grow"><b>${pushState()==='on'?'Alerts are on':'Get alerts when the app is closed'}</b><span class="hint">${pushState()==='on'?'Wallet tracking, token bells, caller moves':'Track wallets, bell tokens, follow callers'}</span></span>${ic('back',16)}</a><div class="tabs" role="tablist">${[['all','All'],['social','Social'],['calls','Calls'],['earn','Earnings'],['alerts','Alerts']].map(([k,l])=>`<button class="${f===k?'on':''}" data-act="nt" data-f="${k}">${l}${k==='all'&&unreadN()?` <span class="ncount">${unreadN()}</span>`:''}</button>`).join('')}</div>
 ${unreadN()?`<div class="fline"><span>${unreadN()} unread</span><button data-act="nall">Mark all as read</button></div>`:''}
 <div class="nlist full">${list.map(nrow).join('')||'<div class="empty"><b>Nothing here yet</b></div>'}</div>`}
function settingsModal(){const th=document.documentElement.dataset.theme||'system',col=document.body.classList.contains('collapsed');
 modal('Settings','',`<div class="field"><label>Theme</label><div class="seg">${[['system','System'],['dark','Navy'],['light','White']].map(([k,l])=>`<button class="${th===k?'on':''}" data-act="settheme" data-f="${k}">${l}</button>`).join('')}</div></div>
 <div class="field"><label>App</label><button class="btn ghost block" data-act="install">${ic('down',16)} Install Callit on this device</button></div>
 ${zoomOn()?`<div class="field"><label>Display size</label><div class="seg">${ZOOMS.map(z=>`<button class="${zoomGet()===z?'on':''}" data-act="setzoom" data-f="${z}">${z}%</button>`).join('')}</div></div>`:''}
 ${SYNC()?`<div class="field"><label>Telegram</label><div id="tgfield">${tgField()}</div></div>`:''}
 <div class="field"><label>Legal &amp; safety</label><a class="btn ghost block" href="#/legal/terms" data-act="close">Terms, privacy, risks &amp; security</a></div>
 ${zoomOn()?`<div class="field"><label>Home panels</label><button class="btn ghost block" data-act="bpreset">Reset panels to default</button></div>`:''}
 <div class="field"><label>Sidebar</label><div class="seg"><button class="${col?'':'on'}" data-act="setside" data-f="open">Expanded</button><button class="${col?'on':''}" data-act="setside" data-f="closed">Icons only</button></div></div>`)}
function withdrawModal(){if(!S.connected)return connectModal(()=>withdrawModal());const real=REALW();
 const held=Object.keys(S.bal).filter(k=>S.bal[k]>0&&T[k]).sort((a,b)=>usd(b,S.bal[b])-usd(a,S.bal[a]));
 if(!held.length)return modal('Withdraw','',`<div class="empty" style="padding:18px 8px"><b>Nothing to withdraw yet</b><p>Deposit SOL or a Solana token first.</p><button class="btn primary" data-act="deposit">Deposit</button></div>`);
 modal('Withdraw','Send from your Callit wallet to any Solana address, like Phantom or an exchange.',
 `<div class="field"><label for="st">Token</label><select id="st" class="input">${held.map(k=>`<option value="${esc(k)}">${esc(symOf(k))} (${fmtAmt(S.bal[k])})</option>`).join('')}</select></div>
 <div class="field"><label for="sa">To address</label><input id="sa" class="input" placeholder="Solana address" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
 <div class="field"><label for="sv">Amount</label><div style="display:flex;gap:8px"><input id="sv" class="input num" inputmode="decimal" placeholder="0"><button class="mx lg" id="smax">Max</button></div></div>
 <p class="hint" style="margin:-4px 0 10px">Only send to a Solana address. If it's an exchange, make sure it accepts this token on Solana. Transfers can't be reversed.</p>
 <div class="err" id="serr"></div><button class="btn primary block" id="sgo">Withdraw</button>`,
 m=>{$('#smax',m).onclick=()=>{$('#sv',m).value=maxOf($('#st',m).value)};
  $('#sgo',m).onclick=()=>{const k=$('#st',m).value,to=$('#sa',m).value.trim(),a=parseFloat($('#sv',m).value),e=$('#serr',m),sy=symOf(k);
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to))return e.textContent='That isn’t a valid Solana address. Check it and try again.';
   if(to===S.addr)return e.textContent='That’s your own Callit wallet. Paste a different address.';
   if(!(a>0))return e.textContent='Enter an amount above zero.';
   if(a>(S.bal[k]||0)+1e-12)return e.textContent=`You only have ${fmtAmt(S.bal[k]||0)} ${sy}.`;
   if(k==='SOL'&&a>+maxOf('SOL'))return e.textContent=`Keep ${FEE_RESERVE} SOL for network fees. You can send up to ${maxOf('SOL')} SOL.`;
   if(k!=='SOL'&&(S.bal.SOL||0)<0.003)return e.textContent='You need a little SOL (about 0.003) to pay the network fee.';
   const desc=`Withdraw ${fmtAmt(a)} ${sy} to ${short(to)}`;closeModal();
   if(!real)return txRun(desc,()=>{S.bal[k]-=a;S.activity.unshift({k:'Withdrew',d:`${fmtAmt(a)} ${sy} to ${short(to)}`,t:'Just now'});render()});
   let base;try{base=baseOf(k,a)}catch(err){return toast(err.message)}
   realTx(desc,step=>doWithdraw({from:S.addr,to,mint:k==='SOL'?'SOL':mintOf(k),amount:base},step).then(r=>{
    logTx({k:'Withdrew',kind:'withdraw',label:`${fmtAmt(a)} ${sy} to ${short(to)}`,signature:r.signature,in_mint:k==='SOL'?SOL_MINT:mintOf(k),in_amount:a,to_address:to,usd_value:T[k]&&T[k].price?a*T[k].price:null});if(r.pending)toast('Sent. Confirmation is taking longer than usual');return r.signature}))}})}
function depositModal(){if(!S.connected)return connectModal(()=>depositModal());const ok=isMintStr(S.addr);
 modal('Deposit','Send SOL, USDC or any Solana token to your Callit wallet. Only use the Solana network.',ok?`<div style="text-align:center">${qrSvg(S.addr)}<p class="num" style="overflow-wrap:anywhere;font-size:13px;margin:12px 0">${esc(S.addr)}</p><button class="btn primary block" data-act="copy" data-v="${esc(S.addr)}">Copy address</button><p class="hint" style="margin:12px 0 0">Funds show up here automatically within a few seconds of landing.</p></div>`
  :`<div class="empty" style="padding:18px 8px"><b>Your wallet is still being set up</b><p>Give it a few seconds, then try again.</p></div>`)}

/* ---------- quick buy from a call ---------- */
function quickBuy(sym,cid,startSide){if(!S.connected)return connectModal();const t=T[sym],k=calls.find(x=>x.id==cid),SY=t.sym;let side=startSide==='sell'?'sell':'buy',sol='0.25',pct='',amt='';
 const held=()=>S.bal[sym]||0;
 const draw=m=>{const h=held();
  const head=`<div class="qhead">${tokav(sym)}<div class="grow"><b>${esc(t.name)}</b><div class="hint num">$${esc(SY)} · ${fmtUsd(mcap(t))} MC · <span class="${t.chg>=0?'up':'down'}">${fmtPct(t.chg)}</span></div></div></div>
  <div class="bstabs" role="tablist" style="margin-top:14px"><button role="tab" data-side="buy" aria-selected="${side==='buy'}" class="${side==='buy'?'on buy':''}">Buy</button><button role="tab" data-side="sell" aria-selected="${side==='sell'}" class="${side==='sell'?'on sell':''}">Sell${h?` <span class="num">${fmtAmt(h)}</span>`:''}</button></div>`;
  let body;
  if(side==='buy'){const a=parseFloat(sol)||0,usdV=a*T.SOL.price,got=usdV*.995/t.price;
   body=`<div class="buybox"><div class="top"><b>Amount</b><span class="hint num" style="white-space:nowrap">Balance ${fmtAmt(S.bal.SOL)} SOL</span></div>
   <div class="presets">${['0.1','0.25','0.5','1'].map(v=>`<button type="button" data-sol="${v}" class="${sol===v?'on':''}">${v} SOL</button>`).join('')}</div>
   <label class="solin"><input id="qin" class="num" inputmode="decimal" value="${esc(sol)}" aria-label="SOL to spend"><button type="button" class="mx" id="qmax">Max</button><span class="muted">SOL</span></label>
   <div class="hint num" style="margin-top:8px">${a?`≈ ${fmtUsd(usdV)} · you get ~${fmtAmt(got)} $${esc(SY)} · via Jupiter`:'Enter an amount'}</div></div>
   ${k?`<p class="hint" style="margin:0 0 14px">${k.buy?`Buying from <b style="color:var(--text)">${esc(k.c)}</b>'s call. They bought in, so they earn a bigger share of the fee.`:`${esc(k.c)} didn't buy in, so they earn a small share once the call holds 2X.`}</p>`:''}
   <div id="qerr" class="err"></div><button class="btn primary block" id="qgo" ${a>0?'':'disabled'}>Buy ${a||0} SOL of $${esc(SY)}</button>`;
  }else if(!h){
   body=`<div class="empty" style="padding:22px 8px"><b>You don't hold $${esc(SY)}</b><p>Buy some first, then you can sell it here any time.</p><button class="btn primary" data-side="buy">Buy $${esc(SY)}</button></div>`;
  }else{const a=Math.min(parseFloat(amt)||0,h),usdV=a*t.price,got=usdV*.995/T.SOL.price;
   body=`<div class="buybox"><div class="top"><b>Sell</b><span class="hint num" style="white-space:nowrap">You hold ${fmtAmt(h)} $${esc(SY)} · ${fmtUsd(h*t.price)}</span></div>
   <div class="presets">${['25','50','75','100'].map(v=>`<button type="button" data-pct="${v}" class="${pct===v?'on':''}">${v==='100'?'All':v+'%'}</button>`).join('')}</div>
   <label class="solin"><input id="qin" class="num" inputmode="decimal" value="${esc(amt)}" placeholder="0" aria-label="Amount of $${esc(SY)} to sell"><button type="button" class="mx" id="qmax">Max</button><span class="muted">$${esc(SY)}</span></label>
   <div class="hint num" style="margin-top:8px">${a?`≈ ${fmtUsd(usdV)} · you get ~${fmtAmt(got)} SOL · via Jupiter`:'Pick a % or enter an amount'}</div></div>
   <div id="qerr" class="err"></div><button class="btn block sellb" id="qgo" ${a>0?'':'disabled'}>${pct==='100'?`Sell all $${esc(SY)}`:`Sell ${a?fmtAmt(a):0} $${esc(SY)}`}</button>`}
  $('#qb',m).innerHTML=head+body;
  m.querySelectorAll('[data-side]').forEach(x=>x.onclick=()=>{side=x.dataset.side;draw(m)});
  const si=$('#qin',m);if(si)si.addEventListener('input',()=>{const v=si.value.replace(/[^0-9.]/g,'');if(side==='buy')sol=v;else{amt=v;pct=''}const pos=si.selectionStart;draw(m);const n=$('#qin',m);n.focus();try{n.setSelectionRange(pos,pos)}catch(_){}});
  m.querySelectorAll('[data-sol]').forEach(x=>x.onclick=()=>{sol=x.dataset.sol;draw(m)});
  m.querySelectorAll('[data-pct]').forEach(x=>x.onclick=()=>{pct=x.dataset.pct;amt=pct==='100'?String(h):String(+(h*pct/100).toFixed(6));draw(m)});
  const mx=$('#qmax',m);if(mx)mx.onclick=e=>{e.preventDefault();if(side==='buy')sol=maxOf('SOL');else{pct='100';amt=String(h)}draw(m)};
  const go=$('#qgo',m);if(!go)return;
  go.onclick=()=>{if(side==='buy'){const a=parseFloat(sol)||0,got=a*T.SOL.price*.995/t.price;
    if(a>(S.bal.SOL||0)){$('#qerr',m).textContent=`You only have ${fmtAmt(S.bal.SOL||0)} SOL.`;return}
    if(REALW()){closeModal();return realSwap('SOL',sym,a,`Buy $${SY} with ${fmtAmt(a)} SOL`,null,{callRef:k&&k.c!==S.me?k.id:null})}
    closeModal();txRun(`Buy ${fmtAmt(got)} $${esc(SY)}`,()=>{S.bal.SOL-=a;S.bal[sym]=(S.bal[sym]||0)+got;S.activity.unshift({k:'Bought',d:`${fmtAmt(got)} ${SY} for ${a} SOL${k?` from ${k.c}'s call`:''}`,t:'Just now'});render()})}
   else{const a=pct==='100'?h:Math.min(parseFloat(amt)||0,h),got=a*t.price*.995/T.SOL.price;
    if(!a)return;closeModal();if(REALW())return realSwap(sym,'SOL',a,`Sell ${fmtAmt(a)} $${SY}`);txRun(`Sell ${fmtAmt(a)} $${esc(SY)}`,()=>{S.bal[sym]=Math.max(0,(S.bal[sym]||0)-a);if(S.bal[sym]<1e-9)delete S.bal[sym];S.bal.SOL+=got;S.activity.unshift({k:'Sold',d:`${fmtAmt(a)} ${SY} for ${fmtAmt(got)} SOL`,t:'Just now'});render()})}}};
 modal(side==='sell'?'Quick sell':'Quick trade','',`<div id="qb"></div>`,m=>draw(m))}

/* ---------- community ---------- */
const COMMS=[
 {id:'lounge',name:'Callit Lounge',desc:'Everyone. Share alpha, ask questions, roast bad calls.',members:18400,online:612},
 {id:'glorp',name:'Glorp Holders',sym:'GLORP',desc:'Holders-only room for $GLORP.',members:2210,online:143,gate:1},
 {id:'kfsh',name:'Kingfish Pond',sym:'KFSH',desc:'Charts, whales and higher lows.',members:5130,online:288},
 {id:'dotb',name:'dotbook Club',sym:'DOTB',desc:'Holders-only. Art, memes, early bags.',members:640,online:57,gate:1},
 {id:'nimb',name:'Nimbus Agents',sym:'NIMB',desc:'AI agent tokens and the people aping them.',members:3600,online:201},
 {id:'moth',name:'Lampmoth Light',sym:'MOTH',desc:'Holders-only. Small bags, fast exits.',members:1900,online:66,gate:1}];
const MSG={};
S.joined=new Set(['lounge']);
const commAv=c=>c.sym?tokav(c.sym):'<span class="mark" style="width:44px;height:44px;border-radius:12px"></span>';
function vCommunity(){return `<div>${COMMS.map(c=>{const last=(MSG[c.id]||[]).slice(-1)[0],j=S.joined.has(c.id);
 return `<div class="comm" data-go="#/community/${c.id}">${commAv(c)}<div class="grow"><div class="cn1"><b>${esc(c.name)}</b>${c.gate?`<span class="gate">${ic('lock',11)} Holders</span>`:''}</div>
 <div class="hint num">${fmtK(c.members)} members · <span class="odot"></span>${fmtK(c.online)} online</div>
 ${last?`<p class="lastm"><b>${esc(last[0])}:</b> ${esc(last[1])}</p>`:''}</div>
 <button class="btn sm ${j?'ghost':'primary'}" data-act="join" data-f="${c.id}">${j?'Joined':'Join'}</button></div>`}).join('')}</div>
 <p class="hint pad">Holders-only rooms check your wallet. Hold the token to chat, anyone can read.</p>`}
function vRoom(id){const c=COMMS.find(x=>x.id===id);if(!c)return vHome();const held=!c.gate||(S.connected&&(S.bal[c.sym]||0)>0),t=c.sym&&T[c.sym];
 const on=calls.filter(k=>c.sym&&k.t===c.sym);
 return `<div class="rhead">${commAv(c)}<div class="grow"><b>${esc(c.name)}</b><div class="hint num">${fmtK(c.members)} members · <span class="odot"></span>${fmtK(c.online)} online</div></div>
 ${t?`<a class="btn sm ghost" href="#/token/${c.sym}">$${c.sym}</a>`:''}<button class="btn sm ${S.joined.has(id)?'ghost':'primary'}" data-act="join" data-f="${id}">${S.joined.has(id)?'Joined':'Join'}</button></div>
 ${on.length?`<div class="pinned">${ic('promote',14)} ${on.length} call${on.length>1?'s':''} on $${c.sym} · <a href="#/token/${c.sym}">see them</a></div>`:''}
 <div class="msgs" id="msgs">${(MSG[id]||[]).map(([h,tx,ago])=>`<div class="msg${h===S.me?' me':''}">${avatar(h)}<div><div class="mh"><b>${esc(h)}</b><span class="hint">${ago}</span></div><p>${esc(tx)}</p></div></div>`).join('')}</div>
 <div class="composer">${held?`<input class="input" id="msgin" maxlength="280" placeholder="${S.connected?'Say something':'Connect a wallet to chat'}" ${S.connected?'':'disabled'}><button class="btn primary" data-act="${S.connected?'msend':'connect'}" data-f="${id}">${S.connected?'Send':'Connect'}</button>`
  :`<div class="grow"><b>Holders only</b><div class="hint">Hold any amount of $${c.sym} to chat here.</div></div>${S.connected?`<button class="btn primary" data-act="qbuy" data-t="${c.sym}">Buy $${c.sym}</button>`:`<button class="btn primary" data-act="connect">Connect</button>`}`}</div>`}

/* ---------- profile tabs ---------- */
function holdingsOf(h){if(h===S.me){const B=pnlBook();return Object.entries(S.bal).filter(([k,v])=>v>0&&T[k]).map(([k,v])=>{const x=posPnl(k,B);return {t:T[k],val:v*T[k].price,amt:v,pnl:x?x.pnl:null,pct:x?x.pct:null,mine:1}})}
 return calls.filter(k=>k.c===h&&k.buy).map(k=>{const n=nums(k);return {t:T[k.t],val:n.pos,pnl:n.pnl}})}
function holdRow(key,amt,val,pnl,pct,mine){const t=T[key];
 return `<div class="li hrow"><a class="hlink" href="#/token/${esc(tokPath(key))}">${tokav(key)}<div class="grow"><b>${esc(t.name)}</b><div class="hint num">${amt!=null?fmtAmt(amt)+' '+esc(symOf(key)):'$'+esc(t.sym)}</div></div>
  <div class="r num"><b>${fmtUsd(val)}</b><div class="hint ${pnl!=null?(pnl>=0?'up':'down'):(t.chg>=0?'up':'down')}">${pnl!=null?money(pnl)+(pct!=null?` (${fmtPct(pct)})`:''):fmtPct(t.chg)}</div></div></a>
  ${mine?`<button class="ib sm hmore" data-act="hmenu" data-k="${esc(key)}" aria-label="Options for ${esc(t.name)}">${ic('more',18)}</button>`:''}</div>`}
function holdCard(key){const t=T[key],amt=S.bal[key]||0,val=usd(key,amt)||0,x=posPnl(key),sy=symOf(key);
 return x?{h:S.me,name:nameOf(S.me),tag:'POSITION',head:`@${S.me}'s $${esc(sy)}`,label:'Unrealized PnL',big:money(x.pnl),up:x.pnl>=0,sub:`${fmtUsd(x.cost)} → ${fmtUsd(x.val)}`,chips:[x.pct!=null?fmtPct(x.pct):'',fmtAmt(amt)+' '+esc(sy)].filter(Boolean),tok:tokav(key),tokLab:'$'+sy}
  :{h:S.me,name:nameOf(S.me),tag:'POSITION',head:`@${S.me}'s $${esc(sy)}`,label:'Position value',big:fmtUsd(val),up:null,sub:`${fmtAmt(amt)} ${esc(sy)}`,chips:[t&&t.chg!=null?'24h '+fmtPct(t.chg):''].filter(Boolean),tok:tokav(key),tokLab:'$'+sy}}
function aSheet(label,head,groups){$('#modal').innerHTML=`<div class="scrim" data-act="close"><div class="asheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="asgrab" aria-hidden="true"></div>${head}${groups}<button class="btn ghost block ascancel" data-act="close">Cancel</button></div></div>`;
 requestAnimationFrame(()=>{const x=$('#modal .asheet');x&&x.classList.add('in')})}
const arow=(attrs,icn,label,sub,cls='')=>`<button class="asrow ${cls}" ${attrs}><span class="asic">${ic(icn,19)}</span><span class="grow"><b>${label}</b>${sub?`<small>${sub}</small>`:''}</span></button>`;
function holdSheet(key){const t=T[key];if(!t)return;const amt=S.bal[key]||0,x=posPnl(key),sy=esc(symOf(key)),cash=key==='SOL'||key==='USDC';
 aSheet(`Options for ${t.name}`,`<div class="ashead">${tokav(key)}<span class="grow"><b>${esc(t.name)}</b><small class="num">${fmtAmt(amt)} ${sy} · ${fmtUsd(usd(key,amt)||0)}${x?` · <span class="${x.pnl>=0?'up':'down'}">${money(x.pnl)}</span>`:''}</small></span></div>`,
  `<div class="asgroup">${arow(`data-act="hshare" data-k="${esc(key)}"`,'image','Share PnL card','Download or post your position card')}</div>
  <div class="asgroup">${cash?'':arow(`data-act="hgo" data-k="${esc(key)}" data-f="buy"`,'up','Buy more',`Add to your $${sy}`)+arow(`data-act="hgo" data-k="${esc(key)}" data-f="sell"`,'down','Sell',`Swap $${sy} back to SOL`)}${arow('data-act="withdraw"','share','Withdraw','Send to another wallet')}</div>
  ${cash?'':`<div class="asgroup">${arow(`data-act="ord" data-k="${esc(key)}" data-f="tpsl"`,'target','Take profit / Stop loss','Auto-sell when it hits your price, even with the app closed')}${arow(`data-act="ord" data-k="${esc(key)}" data-f="trail"`,'down','Trailing stop','Sell if it drops a set % from its peak')}${arow(`data-act="ord" data-k="${esc(key)}" data-f="limit"`,'up','Limit buy more','Buy automatically at a lower market cap')}`}${arow(`data-act="hgo" data-k="${esc(key)}" data-f="view"`,'market','View token','Chart, safety check and calls')}</div>`)}
function xSearchSheet(key){const t=T[key];if(!t)return;const ca=t.ca||key,sy=String(t.sym||'').replace(/^\$/,'');
 aSheet('Search on X',`<div class="ashead">${tokav(key)}<span class="grow"><b>Search $${esc(sy)} on X</b><small>See what people are posting right now</small></span></div>`,
  `<div class="asgroup">${isMintStr(ca)?arow(`data-act="xgo" data-v="${esc(ca)}"`,'copy','Contract address (CA)',`<span class="num">${esc(short(ca))}</span> · only this exact token`):''}${arow(`data-act="xgo" data-v="$${esc(sy)}"`,'search','$'+esc(sy),'Every post with the cashtag')}</div>`)}
function activityOf(h){if(h===S.me)return S.activity.map(a=>[a.k,a.d,a.t]);
 return calls.filter(k=>k.c===h&&!k.sponsored&&k.entry).flatMap(k=>{const out=[['Called',`$${symOf(k.t)} at ${fmtUsd(k.entry)} MC`,k.ago||'']];if(k.buy)out.unshift(['Bought',`${fmtUsd(k.buy)} of $${symOf(k.t)}`,k.ago||'']);return out})}
function ptabBody(h,me){const tab=S.ptab||'calls';
 if(tab==='holdings'){const hs=holdingsOf(h).sort((a,b)=>b.val-a.val),tot=hs.reduce((a,x)=>a+x.val,0);
  if(!hs.length)return `<div class="empty"><b>No holdings yet</b><p>${me?'Buy into a call and it shows up here.':'This caller has no bought-in positions.'}</p></div>`;
  const pt=hs.reduce((a,x)=>a+(x.pnl||0),0),anyP=hs.some(x=>x.pnl!=null);
  return `<details class="hold" ${S.holdOpen===false?'':'open'} data-hold><summary><div><div class="hint">${me?'Wallet value':'Open positions'}</div><b class="h2 num">${fmtUsd(tot)}</b>${anyP?` <span class="num ${pt>=0?'up':'down'}" style="font-weight:800">${money(pt)}</span>`:''}</div><span class="holdchev">${ic('chev',18)}</span></summary>
  <div class="list pad">${hs.map(x=>holdRow(x.t.key,x.amt,x.val,x.pnl,x.pct,x.mine)).join('')}</div></details>`}
 if(tab==='activity'){const a=activityOf(h);if(!a.length)return `<div class="empty"><b>No activity yet</b></div>`;
  return `<div class="list pad">${a.map(([k,d,t])=>`<div class="li"><span class="tokav act-${k.toLowerCase()}" style="background:var(--bg2);color:var(--text)">${ic(k==='Bought'||k==='Sold'?'swap':k==='Called'?'promote':k==='Sent'?'share':'wallet',18)}</span><div class="grow"><b>${esc(k)}</b><div class="hint">${esc(d)}</div></div><span class="hint">${esc(t)}</span></div>`).join('')}</div>`}
 return null}

/* ---------- market ---------- */
function vMarket(){const t=S.mt||'trenches',M=[['trenches','Trenches','flame'],['perps','Perps'],['predict','Predictions']];
 const bar=`<div class="mtabs tgl${t==='perps'?' perps-on':''}" style="--i:${M.findIndex(x=>x[0]===t)};--n:${M.length}" role="tablist">${M.map(([k,l])=>`<button role="tab" aria-selected="${t===k}" class="${t===k?'on':''}" data-act="mt" data-f="${k}">${l}${k==='trenches'?'<span class="live"></span>':'<small>Soon</small>'}</button>`).join('')}</div>`;
 if(t==='perps')return bar+locked(mockPerps(),'perps','Perps are coming','Long or short the tokens you call, with leverage and your caller track record on the line.',['Long and short from any call','Position shows on your call card','Same fee share for bought-in callers']);
 if(0)return bar+soonCard('Perps are coming','Long or short the tokens you call, with leverage and your caller track record on the line. Built on Solana perp venues.',['Long and short from any call','Position shows on your call card','Same fee share for bought-in callers']);
 if(t==='predict')return bar+locked(mockPredict(),'predict','Predictions are coming','Back your read on outcomes: will it hit the target, will it graduate, who tops the Callerboard this week.',['Markets on live calls','Settle on-chain','Callers can seed their own markets']);
 if(0)return bar+soonCard('Predictions are coming','Back your read on outcomes: will it hit the target, will it graduate, who tops the Callerboard this week.',['Markets on live calls','Settle on-chain','Callers can seed their own markets']);
 return bar+`<div class="inmkt">${vTrenches()}</div>`}
/* Coming soon: a real preview of the feature fades out under a lock. Nothing in the preview is clickable. */
const SOONF={perps:'Perps',predict:'Predictions',stake:'$CALLIT staking'};
function notifyBtn(f){const on=S.notifyOn&&S.notifyOn[f];return `<button class="btn ${on?'ghost':'primary'}" data-act="notify" data-f="${f}">${ic(on?'check':'bell',16)} ${on?'You\'re on the list':'Notify me at launch'}</button>`}
function locked(preview,f,title,text,items){return `<div class="lockwrap"><div class="lockprev" aria-hidden="true" inert>${preview}</div>
 <div class="lockcov"><div class="lockcard"><span class="lockic">${ic('lock',26)}</span><span class="lkick">Coming soon</span><b class="h2">${title}</b><p>${text}</p>
 ${items&&items.length?`<ul>${items.map(x=>`<li>${ic('check',15)} ${x}</li>`).join('')}</ul>`:''}${notifyBtn(f)}</div></div></div>`}
function mockPerps(){const R=[['SOL','Solana','#9d7bff','$142.30','+3.8%','12.4x'],['BTC','Bitcoin','#F7931A','$64,210','+1.2%','8.1x'],['ETH','Ethereum','#8EA2FF','$3,120','-0.6%','10.7x']];
 return `<div class="pad">${R.map(([k,n,c,px,ch,oi])=>`<div class="mockrow"><span class="tokav" style="background:${c}">${k}</span><div class="grow"><b>${k}-PERP</b><span class="hint">${n} · up to 50x</span></div><div class="mocknum"><b class="num">${px}</b><span class="${ch[0]==='-'?'dn':'up'}">${ch}</span></div><div class="mockbtns"><span class="mlong">Long</span><span class="mshort">Short</span></div></div>`).join('')}</div>`}
function mockPredict(){const R=[['Will $BONK hit a $3B market cap by Friday?',64],['Will a brand-new caller top the Callerboard this week?',41],['Will this week’s #1 call graduate before Sunday?',72]];
 return `<div class="pad">${R.map(([q,y])=>`<div class="mockq"><b>${q}</b><div class="mockbar"><i style="width:${y}%"></i></div><div class="mockyn"><span class="up">Yes ${y}%</span><span class="dn">No ${100-y}%</span></div></div>`).join('')}</div>`}
function perpsLocked(){const demo=calls.filter(k=>k.kind==='perps').slice(0,2).map(post).join('');
 return locked(demo||mockPerps(),'perps','Perps calls are coming','Call longs and shorts on SOL, BTC and ETH with leverage. Your ROE and liquidation price are tracked live on your profile.',['Long or short with up to 50x','Live ROE on every call','Counts toward your caller rank'])}
function soonCard(h,p,items){return `<div class="soonx"><div class="sxmark"><span class="mark"></span></div><span class="lkick" style="margin:0 0 12px">Coming soon</span><b class="h2">${h}</b><p>${p}</p><ul>${items.map(x=>`<li>${ic('check',16)} ${x}</li>`).join('')}</ul><button class="btn primary" data-act="mt" data-f="trenches">Open Trenches</button></div>`}

/* ---------- attachments ---------- */
const EMOJI=['🚀','🔥','💎','🙌','📈','📉','🐸','🐳','👀','🤝','💰','⚡','🎯','🧠','😂','🥲','😤','🫡','✅','❌','🟢','🔴','🌕','🐂'];
function mediaGrid(m,edit){if(!m||!m.length)return '';return `<div class="media n${Math.min(m.length,4)}">${m.map((u,i)=>`<div class="mcell"><img src="${u}" alt="Attached image ${i+1}" loading="lazy">${/^data:image\/gif|\.gif(\?|$)|tenor\.com|giphy\.com/.test(u)?'<span class="gifb">GIF</span>':''}${edit?`<button type="button" class="mrm" data-rmm="${i}" aria-label="Remove image ${i+1}">${ic('x',14)}</button>${/^data:image\/(?!gif)/.test(u)?`<button type="button" class="medit" data-edm="${i}" aria-label="Edit image ${i+1}">${ic('pen',13)}<span>Edit</span></button>`:''}`:''}</div>`).join('')}</div>`}
function attachBar(){return `<div class="attbar"><label class="att" title="Photos" aria-label="Add photos">${ic('image',19)}<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-att="img" hidden></label>
 <button type="button" class="att" data-att="gifs" title="GIF" aria-label="Add a GIF"><span class="gift">GIF</span></button><input type="file" accept="image/gif" data-att="gif" hidden>
 <button type="button" class="att" data-att="emoji" title="Emoji" aria-label="Add emoji">${ic('smile',19)}</button><span class="attn hint" data-attn></span></div>`}
function wireAttach(root,st,onChange){if(!root)return;const txt=root.querySelector('textarea,input.rin');
 const add=u=>{if(st.media.length>=4){toast('Up to 4 images per post');return}st.media.push(u);onChange()};
 root.querySelectorAll('[data-att="img"]').forEach(i=>i.onchange=()=>{[...i.files].slice(0,4-st.media.length).forEach(f=>shrink(f,1400,add));i.value=''});
 root.querySelectorAll('[data-att="gif"]').forEach(i=>i.onchange=()=>{const f=i.files[0];i.value='';if(!f)return;if(f.type!=='image/gif'){shrink(f,1400,add);return}if(f.size>3e6){toast('GIFs can be up to 3 MB. Try a smaller one, or search GIFs instead');return}const r=new FileReader();r.onload=()=>add(r.result);r.readAsDataURL(f)});
 root.querySelectorAll('[data-att="gifs"]').forEach(bt=>bt.onclick=e=>{e.stopPropagation();const old=root.querySelector('.gifp');if(old){old.remove();return}const em=root.querySelector('.emo');if(em)em.remove();
  const pop=document.createElement('div');pop.className='gifp';pop.innerHTML=`<div class="tsearch">${ic('search',16)}<input placeholder="Search GIFs" autocomplete="off" enterkeyhint="search"></div><div class="gifg" aria-live="polite"></div><button type="button" class="lnk gifup">Upload a GIF from your device</button>`;bt.closest('.attbar').after(pop);
  const g=pop.querySelector('.gifg'),q=pop.querySelector('input');let gt=0;
  const load=()=>{const v=q.value.trim();g.innerHTML='<p class="hint">Loading GIFs…</p>';fetch('/api/gifs?q='+encodeURIComponent(v)).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{if(!pop.isConnected)return;
   if(!ok||j.configured===false){g.innerHTML='<p class="hint">GIF search isn\'t switched on yet. Upload a GIF instead.</p>';return}
   g.innerHTML=(j.gifs||[]).map(x=>`<button type="button" data-gif="${esc(x.url)}" aria-label="${esc(x.title||'GIF')}"><img src="${esc(x.preview)}" alt="" loading="lazy"></button>`).join('')||'<p class="hint">No GIFs match. Try another word.</p>'}).catch(()=>{if(pop.isConnected)g.innerHTML='<p class="hint">GIFs didn\'t load. Check your connection.</p>'})};
  q.oninput=()=>{clearTimeout(gt);gt=setTimeout(load,300)};load();setTimeout(()=>q.focus(),30);
  pop.onclick=ev=>{ev.stopPropagation();const x=ev.target.closest('[data-gif]');if(x){add(x.dataset.gif);pop.remove();return}if(ev.target.closest('.gifup')){root.querySelector('[data-att="gif"]').click();pop.remove()}}});
 root.querySelectorAll('[data-att="emoji"]').forEach(bt=>bt.onclick=e=>{e.stopPropagation();const old=root.querySelector('.emo');if(old){old.remove();return}
  const pop=document.createElement('div');pop.className='emo';pop.innerHTML=EMOJI.map(x=>`<button type="button">${x}</button>`).join('');bt.closest('.attbar').after(pop);
  pop.onclick=ev=>{const x=ev.target.closest('button');if(!x||!txt)return;const a=txt.selectionStart??txt.value.length,z=txt.selectionEnd??a;txt.value=txt.value.slice(0,a)+x.textContent+txt.value.slice(z);txt.focus();const c=a+x.textContent.length;txt.setSelectionRange(c,c);txt.dispatchEvent(new Event('input',{bubbles:true}))}});
 root.addEventListener('click',e=>{const x=e.target.closest('[data-rmm]');if(x){st.media.splice(+x.dataset.rmm,1);onChange();return}
  /* Tap Edit (or the photo itself) to crop, draw, write, blur or add emoji. */
  const ed=e.target.closest('[data-edm]')||(e.target.matches&&e.target.matches('.mcell img')&&e.target.parentElement.querySelector('[data-edm]'));
  if(ed){e.preventDefault();const i=+ed.dataset.edm;openImageEditor(st.media[i]).then(out=>{if(out){st.media[i]=out;onChange()}}).catch(er=>toast(er.message||'Couldn’t open the editor'))}})}
document.addEventListener('click',e=>{const p=document.querySelector('.emo');if(p&&!e.target.closest('.emo,[data-att="emoji"]'))p.remove();const g=document.querySelector('.gifp');if(g&&!e.target.closest('.gifp,[data-att="gifs"]'))g.remove()});
/* Tap any post image to view it full screen. Swipe or use the arrows for the others in the same post. */
function openViewer(list,at){let i=at;const ov=document.createElement('div');ov.className='lbox';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Image viewer');
 ov.innerHTML=`<button class="ib lbx" data-l="x" aria-label="Close">${ic('x',22)}</button>${list.length>1?`<button class="ib lbp" data-l="-1" aria-label="Previous image">${ic('back',22)}</button><button class="ib lbn" data-l="1" aria-label="Next image">${ic('back',22).replace('<svg','<svg style="transform:scaleX(-1)"')}</button><span class="lbc num"></span>`:''}<img alt="">`;
 const im=ov.querySelector('img'),show=()=>{im.src=list[i];const c=ov.querySelector('.lbc');if(c)c.textContent=`${i+1} / ${list.length}`},go=d=>{i=(i+d+list.length)%list.length;show()};
 const close=()=>{ov.remove();removeEventListener('keydown',key)},key=e=>{if(e.key==='Escape')close();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1)};
 ov.onclick=e=>{const b=e.target.closest('[data-l]');if(b){e.stopPropagation();b.dataset.l==='x'?close():go(+b.dataset.l);return}if(e.target!==im)close()};
 let sx=null;ov.addEventListener('touchstart',e=>{if(e.touches.length===1)sx=e.touches[0].clientX},{passive:true});ov.addEventListener('touchend',e=>{if(sx==null||list.length<2)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>50)go(dx<0?1:-1)});
 addEventListener('keydown',key);document.body.appendChild(ov);show();ov.querySelector('.lbx').focus()}
document.addEventListener('click',e=>{const img=e.target.closest('.media .mcell img');if(!img||img.closest('.mcell').querySelector('.mrm'))return;e.preventDefault();e.stopPropagation();const all=[...img.closest('.media').querySelectorAll('.mcell img')];openViewer(all.map(x=>x.src),all.indexOf(img))},true);

/* ---------- top strips ---------- */
const medal=i=>i<3?`<span class="medal m${i}">${i+1}</span>`:`<span class="medal">${i+1}</span>`;
/* Top-10 strips loop endlessly (a second, hidden copy makes the seam invisible). Ranks are live: anyone can take a spot. */
const WEEK=7*864e5,RANKS={};
const twin=cards=>cards.join('')+cards.map(c=>c.replace('<a ','<a aria-hidden="true" tabindex="-1" ')).join('');
function rankMove(id,key,i){const p=RANKS[id]&&RANKS[id][key];return p!=null&&p!==i?`<span class="rmv ${p>i?'up':'dn'}" title="${p>i?'Up':'Down'} ${Math.abs(p-i)}">${p>i?'▲':'▼'}${Math.abs(p-i)}</span>`:''}
function strip(id,title,sub,cards,loop){const run=loop&&cards.length>2;
 return `<section class="strip${run?' looping':''}" aria-label="${title}"><div class="sthead"><span class="stic">${ic('leaderboard',16)}</span><div><b>${title}</b><span>${sub}</span></div>
 ${run?'<span class="stlive"><i></i>Live</span>':`<span class="starr"><button class="ib" data-act="stscroll" data-f="${id}" data-d="-1" aria-label="Scroll left">${ic('back',16)}</button><button class="ib" data-act="stscroll" data-f="${id}" data-d="1" aria-label="Scroll right">${ic('back',16).replace('<svg','<svg style="transform:scaleX(-1)"')}</button></span>`}</div>
 <div class="strack${run?' loop':''}" id="${id}">${run?`<div class="lptrack" data-ord="${esc(cards.ord||'')}" style="--dur:${cards.length*4.5}s">${twin(cards)}</div>`:cards.join('')}</div></section>`}
function refreshStrip(id,cards){const tr=document.querySelector('#'+id+' .lptrack');if(!tr||cards.length<3||tr.dataset.ord===cards.ord)return;tr.dataset.ord=cards.ord;tr.style.setProperty('--dur',cards.length*4.5+'s');tr.innerHTML=twin(cards)}
const topCallsList=()=>calls.filter(k=>k.buy&&!k.sponsored&&(!k.at||Date.now()-k.at<WEEK)&&nums(k)).map(k=>({k,n:nums(k)})).sort((a,b)=>b.n.pnl-a.n.pnl).slice(0,10);
function topCallCards(){const list=topCallsList(),out=list.map(({k,n},i)=>`<a class="scard" href="#/post/${k.id}"><div class="sctop">${avatar(k.c)}<b>${esc(k.c)}</b>${rankMove('stc',k.id,i)}${medal(i)}</div>
 <div class="scbody">${tokav(k.t)}<div class="grow"><b class="num ${n.pnl>=0?'up':'down'}" data-tcp="${k.id}">${money(n.pnl)}</b><span class="num">$${esc(symOf(k.t))} · <em class="${n.up?'up':'down'}">${fmtPct(n.p)}</em></span></div></div></a>`);
 out.ord=list.map(x=>x.k.id).join();RANKS.stc={};list.forEach((x,i)=>RANKS.stc[x.k.id]=i);return out}
function topCalls(){const c=topCallCards();return c.length?strip('stc','Top 10 calls this week','Biggest caller profits, bought in with their own wallet. Live ranks.',c,1):''}
/* Real traders' realized wins from the last 7 days (server), topped up with demo traders until the app has volume. */
let TOPT=[],TOPTAT=0;
function loadTopTrades(){if(Date.now()-TOPTAT<6e4)return;TOPTAT=Date.now();
 fetch('/api/leaders/trades').then(r=>r.ok?r.json():{trades:[]}).then(j=>{TOPT=(j.trades||[]).filter(x=>x&&x.handle&&isMintStr(x.mint));const miss=[];
  TOPT.forEach(x=>{if(x.avatar_url)AVURL[x.handle]=x.avatar_url;if(x.display_name)DN[x.handle]=x.display_name;if(!T[x.mint])miss.push(x.mint)});
  const go=()=>refreshStrip('stt',topTradeCards());miss.length?fetchTokens(miss.slice(0,50)).then(l=>{l.forEach(regLive);go()}).catch(go):go()}).catch(()=>{})}
function topTradeList(){const who=ranked().map(c=>c.h),toks=Object.values(T).filter(t=>t.chain==='Solana'&&!t.base&&!t.prelaunch&&t.holders),r=rng(4242+Math.floor(Date.now()/WEEK));
 const real=TOPT.filter(x=>T[x.mint]).map(x=>({h:x.handle,t:T[x.mint],pnl:+x.pnl||0,x:+x.x||1}));
 const seen=new Set();return real.filter(x=>x.pnl>0).sort((a,b)=>b.pnl-a.pnl).filter(x=>{const id=x.h+'|'+x.t.key;return !seen.has(id)&&seen.add(id)}).slice(0,10)}
function topTradeCards(){const list=topTradeList(),key=x=>x.h+'|'+x.t.key,out=list.map((x,i)=>`<a class="scard" href="#/token/${x.t.key}"><div class="sctop">${avatar(x.h)}<b>${esc(x.h)}</b>${rankMove('stt',key(x),i)}${medal(i)}</div>
 <div class="scbody">${tokav(x.t.key)}<div class="grow"><b class="num up">+${fmtUsd(x.pnl)}</b><span class="num">$${esc(x.t.sym)} · <em class="up">${x.x.toFixed(1)}x</em></span></div></div></a>`);
 out.ord=list.map(key).join();RANKS.stt={};list.forEach((x,i)=>RANKS.stt[key(x)]=i);return out}
function topTrades(){loadTopTrades();const c=topTradeCards();return c.length?strip('stt','Top 10 traders this week','Largest realized wins in the trenches. Live ranks.',c,1):''}
/* Re-rank both strips every 15s while they're on screen. */
setInterval(()=>{if(document.hidden)return;if(document.getElementById('stc'))refreshStrip('stc',topCallCards());if(document.getElementById('stt')){loadTopTrades();refreshStrip('stt',topTradeCards())}},15000);
document.addEventListener('pointerdown',e=>{const t=e.target.closest('.strack.loop');if(!t)return;t.classList.add('held');const up=()=>{setTimeout(()=>t.classList.remove('held'),1800);removeEventListener('pointerup',up);removeEventListener('pointercancel',up)};addEventListener('pointerup',up);addEventListener('pointercancel',up)});

/* ---------- news ---------- */
const WIRE=[['Solana memecoin launches hit a new weekly high as launchpad competition heats up','Callit Wire',38],['Creator fee splits become the new battleground for token launchpads','Callit Wire',95],['Stablecoin balances on Solana keep climbing as traders park profits','Callit Wire',160],['Perp DEX volume climbs as traders chase leverage on majors','Callit Wire',240],['Why bundled supply is the first thing smart money checks now','Callit Wire',410]];
function newsItems(){const out=[],lv=(LIVE.feeds['movers:1h']||[]).map(k=>T[k]),
 tk=lv.filter(t=>t&&t.live&&t.chain==='Solana'&&!t.base&&!t.prelaunch&&t.holders&&!NOT_MEME.has(String(t.sym).toUpperCase()));
 tk.slice(0,8).forEach((t,i)=>out.push({kind:'chain',sym:t.key,min:3+i*7,src:t.live?'Live market':'On-chain',
  title:i%2===0?`$${t.sym} ${t.chg>=0?'up':'down'} ${Math.abs(t.chg).toFixed(1)}% in 24h as volume hits ${fmtUsd(t.vol)}`:`$${t.sym} passes ${fmtK(t.holders)} holders with ${fmtUsd(t.liq||0)} in liquidity`}));
 calls.filter(k=>k.buy&&nums(k)&&nums(k).p>50).slice(0,3).forEach((k,i)=>out.push({kind:'chain',sym:k.t,min:20+i*55,title:`${k.c}'s $${symOf(k.t)} call is up ${fmtPct(nums(k).p)}`,src:'Callit calls',post:k.id}));
 WIRE.forEach(([title,src,min])=>out.push({kind:'crypto',title,src,min}));
 return out.sort((a,b)=>a.min-b.min)}
const ago2=m=>m<60?m+'m':Math.round(m/60)+'h';
function newsRow(n,compact){const go=n.post?`#/post/${n.post}`:n.sym?`#/token/${n.sym}`:'';
 return `<${go?`a href="${go}"`:'button data-act="newsx"'} class="nrow${compact?' c':''}">${n.sym?tokav(n.sym):`<span class="tokav nwire">${ic('news',18)}</span>`}<span class="grow"><span class="ntag ${n.kind}">${n.kind==='chain'?'On-chain':'Crypto'}</span><b>${esc(n.title)}</b><span class="hint">${esc(n.src)} · ${ago2(n.min)}</span></span></${go?'a':'button'}>`}
function newsCard(){const live=newsItems().filter(n=>n.kind==='chain').slice(0,5);if(!LIVE.feeds['movers:1h']&&!LIVE.err['movers:1h'])loadFeed('movers:1h');
 return `<div class="card newscard"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">Trending now</h3><a class="lnk" href="#/news">See all</a></div>${live.length?live.map(n=>newsRow(n,1)).join(''):Array.from({length:4},()=>'<div class="nrow c nskel" aria-hidden="true"><span class="tokav"></span><span class="grow"><i></i><i></i></span></div>').join('')+'<p class="sr-only" role="status">Loading market moves</p>'}</div>`}
/* ---------- News: Recent (headlines by category), Trending (social platforms + Callit), Calendar (economic events) and Trending (social platforms + Callit) ---------- */
const NEWS={recent:{},trending:{},calendar:{}};
const NPLAT={x:['X','#E7E9EA'],reddit:['Reddit','#FF4500'],youtube:['YouTube','#FF0033'],bluesky:['Bluesky','#1185FE'],hackernews:['Hacker News','#FF6600'],coingecko:['CoinGecko','#8DC63F'],google:['Google','#4285F4'],callit:['Callit','#4DA8FF'],news:['News','#8FA6BA']};
function loadNews(tab,force){const N=NEWS[tab];if(N.busy||(!force&&N.at&&Date.now()-N.at<3e5))return;N.busy=1;
 fetch('/api/news?tab='+tab).then(r=>r.json()).then(j=>{N.d=j;N.err=j.error||null}).catch(()=>{N.err='News is unavailable right now.'}).finally(()=>{N.busy=0;N.at=Date.now();if(currentRoute()==='news'&&!document.querySelector('#modal .modal'))render();else if(tab==='recent'&&currentRoute()==='home'){drawRail()}const sr=$('#sres');if(sr&&S.sk==='trends')sr.dispatchEvent(new Event('newsready'))})}
/* Callit's own trending: most-called tokens and the most engaged posts in the last day. */
function callitTrends(){const now=Date.now(),out=[],day=calls.filter(k=>visible(k)&&k.at&&now-k.at<864e5);
 const by={};day.filter(k=>k.kind==='meme'&&k.t).forEach(k=>{(by[k.t]=by[k.t]||[]).push(k)});
 Object.entries(by).sort((a,b)=>b[1].length-a[1].length).slice(0,5).forEach(([t,ks])=>{const n=nums(ks[0]);out.push({id:'cl:t:'+t,title:`$${symOf(t)} has ${ks.length} call${ks.length>1?'s':''} on Callit today${n?` · ${fmtPct(n.p)} since the first`:''}`,url:'#/token/'+t,source:'Callit',platform:'callit',kind:'social',at:Math.max(...ks.map(k=>k.at)),score:ks.length*25,sym:t})});
 day.map(k=>({k,e:(k.likes||0)+(k.reposts||0)*2+(k.replies||0)*2+(k.quotes||0)*3})).filter(x=>x.e>0).sort((a,b)=>b.e-a.e).slice(0,6).forEach(({k,e})=>out.push({id:'cl:p:'+k.id,title:(k.kind==='meme'?`@${k.c} called $${symOf(k.t)}: `:`@${k.c}: `)+String(k.thesis||'').slice(0,140),url:'#/post/'+k.id,source:'@'+k.c,platform:'callit',kind:'social',at:k.at,score:e,sym:k.kind==='meme'?k.t:null}));
 return out}
const nsrcGet=()=>{try{const v=JSON.parse(localStorage.getItem('callit.nsrc')||'null');return Array.isArray(v)?new Set(v):null}catch(_){return null}};
const nsrcSet=v=>{try{localStorage.setItem('callit.nsrc',JSON.stringify(v?[...v]:null))}catch(_){}};
const NCATS=[['crypto','Crypto'],['economy','Economy'],['global','World'],['tech','Tech'],['sports','Sports'],['entertainment','Entertainment']];
const lsSet=k=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return Array.isArray(v)&&v.length?new Set(v):null}catch(_){return null}};
const lsPut=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v&&v.size?[...v]:null))}catch(_){}};
/* Economic calendar (ForexFactory weekly export). Times are shown in the viewer's own timezone. */
const cimpGet=()=>{if(!S.cimp){try{S.cimp=localStorage.getItem('callit.cimp')}catch(_){}}return ['h','hm','all'].includes(S.cimp)?S.cimp:'hm'};
const CIMP={High:['High','#FF4D5E'],Medium:['Medium','#FF9F43'],Low:['Low','#F5C542'],Holiday:['Holiday','#8FA6BA']};
const calIn=at=>{const d=at-Date.now(),a=Math.abs(d),m=Math.round(a/6e4),h=Math.floor(m/60),t=h>=24?Math.round(h/24)+'d':h?`${h}h${m%60?` ${m%60}m`:''}`:m+'m';return a<6e4?'now':d>0?'in '+t:t+' ago'};
const calTime=at=>new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function calRow(e,compact){const [il,c]=CIMP[e.impact]||CIMP.Low,past=e.at<Date.now()-6e4,soon=!past&&e.at-Date.now()<36e5;
 return `<div class="cevt${past?' past':''}${soon?' cvsoon':''}${compact?' c':''}"><span class="ctime">${e.impact==='Holiday'?'All day':calTime(e.at)}<small>${calIn(e.at)}</small></span>
 <span class="cimp" style="--ic:${c}" title="${il} impact" aria-label="${il} impact"></span><span class="ccur">${esc(e.country)}</span>
 <span class="grow"><b>${esc(e.title)}</b>${!compact&&(e.forecast||e.previous)?`<span class="hint">${e.forecast?`Forecast <em>${esc(e.forecast)}</em>`:''}${e.forecast&&e.previous?' · ':''}${e.previous?`Previous <em>${esc(e.previous)}</em>`:''}</span>`:''}</span></div>`}
/* Trader shorthand → words used in event titles */
const CALIAS={nfp:'non-farm',payrolls:'non-farm',jobs:'employment',fed:'fomc',rates:'rate',inflation:'cpi',boe:'boe',ecb:'ecb',retail:'retail',unemployment:'unemployment',pmi:'pmi'};
function calList(q){const ev=((NEWS.calendar.d&&NEWS.calendar.d.events)||[]).slice().sort((a,b)=>a.at-b.at),imp=cimpGet(),cur=lsSet('callit.ccur');
 let L=ev.filter(e=>imp==='all'||e.impact==='High'||(imp==='hm'&&e.impact==='Medium')||e.impact==='Holiday'&&imp!=='h');
 if(cur)L=L.filter(e=>cur.has(e.country));
 if(q){const ws=q.toLowerCase().split(/\s+/).filter(Boolean).map(w=>CALIAS[w]||w);L=L.filter(e=>{const h=(e.title+' '+e.country).toLowerCase();return ws.every(w=>h.includes(w))})}
 return L}
function vCalendar(q){const N=NEWS.calendar;loadNews('calendar');const ev=(N.d&&N.d.events)||[],cur=lsSet('callit.ccur'),imp=cimpGet();
 const curs=[...new Set(ev.map(e=>e.country))].sort((a,b)=>(a==='USD'?-1:b==='USD'?1:a.localeCompare(b)));
 const L=calList(q),days={};L.forEach(e=>{const k=new Date(e.at).toDateString();(days[k]=days[k]||[]).push(e)});
 const today=new Date().toDateString(),tmr=new Date(Date.now()+864e5).toDateString();
 const next=L.find(e=>e.at>Date.now()-6e4&&e.impact!=='Holiday');
 const body=!N.d?rskel(6):N.d.error&&!ev.length?`<div class="empty"><b>Calendar unavailable</b><p>${esc(N.d.error)} Try again in a few minutes.</p></div>`
  :!L.length?`<div class="empty"><b>No events match</b><p>Try showing more impact levels or currencies.</p></div>`
  :Object.entries(days).map(([d,es])=>`<div class="cday${d===today?' today':''}"><div class="cdayh">${d===today?'Today':d===tmr?'Tomorrow':new Date(es[0].at).toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'})}<small>${es.length} event${es.length>1?'s':''}</small></div>${es.map(e=>calRow(e)).join('')}</div>`).join('');
 return `<div class="pad nhead"><div class="tsearch">${ic('search',16)}<input id="nq" value="${esc(q)}" placeholder="Search events: CPI, NFP, FOMC, USD…" autocomplete="off" enterkeyhint="search"></div>
 <div class="nchips">${[['h','High only'],['hm','High + Medium'],['all','All impact']].map(([k,l])=>`<button class="nchip${imp===k?' on':''}" data-act="cimp" data-f="${k}">${k!=='all'?`<span class="cimp" style="--ic:${CIMP.High[1]}"></span>`:''}${k==='hm'?`<span class="cimp" style="--ic:${CIMP.Medium[1]}"></span>`:''}${l}</button>`).join('')}</div>
 ${curs.length?`<div class="nchips">${curs.map(c=>`<button class="nchip${!cur||cur.has(c)?' on':''}" data-act="ccur" data-f="${c}">${esc(c)}</button>`).join('')}${cur?`<button class="lnk" data-act="ccur" data-f="*">All currencies</button>`:''}</div>`:''}</div>
 ${next&&!q?`<div class="card cnext"><span class="hint">Next up</span>${calRow(next,1)}</div>`:''}
 <div class="nlist">${body}</div>
 <p class="hint pad">This week’s economic events from ForexFactory, in your local time. Red = high impact, the ones that usually move crypto and FX. Actual results land at release time on <a class="lnk" style="padding:0" href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer">forexfactory.com</a>.${N.d&&N.d.at?` Updated ${agoMs(N.d.at)==='now'?'just now':agoMs(N.d.at)+' ago'}.`:''}</p>`}
/* Compact upcoming high-impact events, shown above Recent when Economy is in view. */
function calNextCard(){loadNews('calendar');const ev=((NEWS.calendar.d&&NEWS.calendar.d.events)||[]).slice().sort((a,b)=>a.at-b.at).filter(e=>e.impact==='High'&&e.at>Date.now()-6e4).slice(0,3);
 if(!ev.length)return '';
 return `<div class="card cnext"><div style="display:flex;justify-content:space-between;align-items:center"><span class="hint">High-impact events coming up</span><button class="lnk" data-act="ntab" data-f="calendar">Calendar</button></div>${ev.map(e=>calRow(e,1)).join('')}</div>`}
function newsList(tab,q){const N=NEWS[tab];let L=((N.d&&N.d.items)||[]).slice();
 if(tab==='trending'){L=callitTrends().concat(L);const on=nsrcGet();if(on)L=L.filter(x=>on.has(x.platform))}
 else{const on=lsSet('callit.ncat');if(on)L=L.filter(x=>on.has(x.kind))}
 if(q){const t=q.toLowerCase().replace(/^[#$@]/,'');L=L.filter(x=>(x.title+' '+x.source+' '+(x.summary||'')).toLowerCase().includes(t))}
 return L}
const favi=u=>{try{const h=new URL(u).hostname.replace(/^www\./,'');return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64`}catch(_){return ''}};
const pbadge=(p,u)=>{const [l,c]=NPLAT[p]||NPLAT.news;if(p==='news'&&u&&favi(u))return `<span class="pbadge fav" style="--pc:${c}"><img src="${esc(favi(u))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><i>${esc(l[0])}</i></span>`;return p==='x'?`<span class="pbadge" style="--pc:${c}">${ic('xlogo',13)}</span>`:`<span class="pbadge" style="--pc:${c}">${esc(l[0])}</span>`};
const agoMs=at=>{const m=Math.max(0,(Date.now()-at)/6e4);return m<1?'now':m<60?Math.round(m)+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d'};
function nItem(x){const ext=!/^#\//.test(x.url),pl=(NPLAT[x.platform]||NPLAT.news)[0];
 return `<a class="nitem" href="${esc(x.url)}"${ext?' target="_blank" rel="noopener noreferrer nofollow"':''}>${x.sym&&T[x.sym]?tokav(x.sym):pbadge(x.platform,x.url)}
 <span class="grow"><b>${esc(x.title)}</b><span class="hint">${esc(x.source)}${x.platform!=='news'&&x.source!==pl?` · ${esc(pl)}`:''} · ${agoMs(x.at)}${x.score?` · ${fmtK(x.score)} ${x.platform==='hackernews'?'pts':x.platform==='callit'?'heat':'likes'}`:''}${x.comments?` · ${fmtK(x.comments)} comments`:''}</span>
 ${ext?`<span class="nopen">Open on ${esc(x.platform==='news'?x.source:pl)} ↗</span>`:''}</span>${x.image&&/^https:/.test(x.image)?`<img class="nthumb" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:''}</a>`}
const NTAB=()=>['trending','calendar'].includes(S.ntab)?S.ntab:'recent';
function vNews(){const tab=NTAB(),N=NEWS[tab],q=S.nq||'';
 const tabs=`<div class="tabs" role="tablist">${[['recent','Recent'],['trending','Trending'],['calendar','Calendar']].map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" class="${tab===k?'on':''}" data-act="ntab" data-f="${k}">${l}</button>`).join('')}</div>`;
 if(tab==='calendar')return tabs+vCalendar(q);
 loadNews(tab);const L=newsList(tab,q);
 const srcs=(N.d&&N.d.sources)||[],on=nsrcGet(),cats=lsSet('callit.ncat');
 const plats=['callit','x','reddit','youtube','bluesky','hackernews','coingecko','google'];
 const okP=new Set(srcs.filter(x=>x.ok).map(x=>x.platform).concat(['callit']));
 const chips=tab==='trending'?`<div class="nchips">${plats.map(p=>{const sel=!on||on.has(p),dead=N.d&&!okP.has(p);return `<button class="nchip${sel?' on':''}${dead?' dead':''}" data-act="nsrc" data-f="${p}" title="${dead?'Not connected yet':''}">${pbadge(p)}${esc(NPLAT[p][0])}${dead?'<small>off</small>':''}</button>`}).join('')}${on?`<button class="lnk" data-act="nsrc" data-f="*">Show all</button>`:''}</div>`
  :`<div class="nchips"><button class="nchip${!cats?' on':''}" data-act="ncat" data-f="*">All</button>${NCATS.map(([k,l])=>`<button class="nchip${cats&&cats.has(k)?' on':''}" data-act="ncat" data-f="${k}">${l}</button>`).join('')}</div>`;
 const econ=tab==='recent'&&!q&&(!cats||cats.has('economy'));
 return `${tabs}
 <div class="pad nhead"><div class="tsearch">${ic('search',16)}<input id="nq" value="${esc(q)}" placeholder="Search ${tab==='trending'?'trends':'news'}: solana, ETF, a ticker…" autocomplete="off" enterkeyhint="search"></div>${chips}</div>
 ${econ?calNextCard():''}
 <div class="nlist">${!N.d?rskel(6):L.length?L.slice(0,80).map(nItem).join(''):`<div class="empty"><b>${q?`Nothing matches “${esc(q)}”`:'Nothing here right now'}</b><p>${q?'Try another word.':'Check back in a few minutes.'}</p></div>`}</div>
 <p class="hint pad">${tab==='trending'?'What people are talking about across social platforms, plus what’s hot on Callit. Tap any item to open the original post.':'Latest headlines across crypto, the economy, world news, tech, sports and entertainment. Pick one or more categories above. Tap a headline to read it at the source.'}${N.d&&N.d.at?` Updated ${agoMs(N.d.at)==='now'?'just now':agoMs(N.d.at)+' ago'}.`:''}</p>`}
setInterval(()=>{if(document.hidden||currentRoute()!=='news')return;const t=NTAB();if(t==='calendar'){if(!document.querySelector('#modal .modal')&&document.activeElement?.id!=='nq')render();loadNews('calendar')}else loadNews(t)},6e4);
document.addEventListener('input',e=>{if(e.target.id!=='nq')return;S.nq=e.target.value;clearTimeout(e.target._t);e.target._t=setTimeout(()=>{const el=$('.nlist');if(el){const tab=NTAB();if(tab==='calendar'){const L=calList(S.nq),cl=document.querySelector('.cnext');cl&&cl.remove();el.innerHTML=L.length?L.slice(0,80).map(e=>calRow(e)).join(''):`<div class="empty"><b>Nothing matches “${esc(S.nq)}”</b><p>Try another word.</p></div>`;return}const L=newsList(tab,S.nq);el.innerHTML=L.length?L.slice(0,80).map(nItem).join(''):`<div class="empty"><b>Nothing matches “${esc(S.nq)}”</b><p>Try another word.</p></div>`}},150)});

/* ---------- premium ---------- */
const PLANS={monthly:{usd:8,label:'Monthly',per:'/month',days:30},yearly:{usd:80,label:'Yearly',per:'/year',days:365,save:'2 months free'}};
const STAKE_AMT=50000;
function vPremium(){const pl=S.plan||'yearly',P=PLANS[pl],via=S.payvia||'SOL',on=isPrem(S.me),amt=via==='SOL'?P.usd/T.SOL.price:P.usd;
 const ben=[['verified','Verified checkmark','A blue check on your profile, calls and replies.'],['promote','Boosted reach','Your calls get priority in For you and Community.'],['swap','Lower swap fees','Pay less on every buy and sell you make on Callit.'],['wallet','Bigger caller share','Earn a larger cut of fees on calls you bought into.'],['filter','Pro Trenches','Saved filter presets and alerts when new tokens match.'],['market','Early access','First in line for Perps and Predictions.']];
 return `<div class="prem"><div class="phero2"><span class="pbig">${ic('verified',44)}</span><h2>Callit Premium</h2><p>Get verified. Get seen. Get paid more.</p>
 ${on?`<div class="pactive">${ic('check',16)} Premium active until ${new Date(S.premium.until).toLocaleDateString()}</div>`:''}</div>
 <div class="pben">${ben.map(([i,t,d])=>`<div class="bcard"><span class="bic">${ic(i,20)}</span><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
 <h3 class="psec">Choose how to get it</h3>
 <div class="seg wide pplan">${Object.entries(PLANS).map(([k,v])=>`<button class="${pl===k?'on':''}" data-act="plan" data-f="${k}">${v.label}${v.save?` <small>${v.save}</small>`:''}</button>`).join('')}</div>
 <div class="popts">
  <div class="popt on"><div class="poh"><span class="pradio"></span><div class="grow"><b>Pay from your Callit wallet</b><span class="hint">Renews ${pl==='yearly'?'yearly':'monthly'}. Cancel anytime.</span></div><div class="pprice num"><b>$${P.usd}</b><span>${P.per}</span></div></div>
   <div class="pvia">${['SOL','USDC'].map(x=>`<button class="chip${via===x?' on':''}" style="--c:var(--hi)" data-act="payvia" data-f="${x}">${tokav(x)}${x}</button>`).join('')}<span class="hint num">${via==='SOL'?`≈ ${amt.toFixed(3)} SOL`:`${amt} USDC`} · Balance ${fmtAmt(S.bal[via]||0)} ${via}</span></div>
   <button class="btn primary block" data-act="buyprem">${on?'Extend Premium':'Upgrade now'}</button></div>
  <div class="popt"><div class="poh"><span class="pradio off"></span><div class="grow"><b>Stake $CALLIT</b><span class="hint">Stake ${fmtK(STAKE_AMT)} $CALLIT and keep Premium for as long as it stays staked. Your tokens stay yours.</span></div><span class="soonb">At launch</span></div>
   <div class="pstake"><div><span>Stake</span><b class="num">${fmtK(STAKE_AMT)} $CALLIT</b></div><div><span>Minimum lock</span><b>30 days</b></div><div><span>Bonus</span><b>Staking rewards</b></div></div>
   <button class="btn ghost block" data-act="stakewait">${S.stakeWait?'You\'re on the list':'Notify me at $CALLIT launch'}</button></div>
 </div>
 <p class="hint" style="text-align:center;margin:18px 0 0">Payments are signed from your own wallet. Premium never affects how call performance is measured.</p></div>`}

/* ---------- full post ---------- */
const REPLIES={};const RDRAFT={media:[]};
const RLINES=['Aped a small bag. Chart looks clean.','What is the dev wallet holding right now?','Target feels conservative ngl','In since 1M, not selling here','Liquidity is thin, careful with size','Good call. Following for the next one','Bundled supply worries me a bit','This is the one 🚀'];
function repliesOf(k){if(!RLOADED[k.id]&&realAuth()){RLOADED[k.id]=1;fetch('/api/posts/replies?ref='+encodeURIComponent(k.id)).then(r=>r.ok?r.json():null).then(j=>{if(!j||!j.replies.length)return;j.replies.forEach(x=>{if(x.avatar_url)AVURL[x.handle]=x.avatar_url;if(x.display_name)DN[x.handle]=x.display_name});const real=j.replies.map(x=>liveAgo({h:x.handle,t:x.body,likes:0,rts:0,reps:0,media:x.media,id:x.id},Date.parse(x.created_at)));REPLIES[k.id]=[...real,...(REPLIES[k.id]||[]).filter(x=>!x.mine)];k.replies=Math.max(k.replies||0,REPLIES[k.id].length);if(currentRoute()==='post')render()}).catch(()=>{})}
 if(k.srv&&!REPLIES[k.id])REPLIES[k.id]=[];
 if(!REPLIES[k.id]){const r=rng(k.id*7+3),who=ranked().map(c=>c.h).filter(h=>h!==k.c),n=Math.min(k.replies||0,3+Math.floor(r()*3));
 const lines=[...RLINES].sort(()=>r()-.5);REPLIES[k.id]=Array.from({length:Math.min(n,lines.length)},(_,i)=>({h:who[Math.floor(r()*who.length)],t:lines[i],ago:(i+1)*(7+Math.floor(r()*20))+'m',likes:Math.floor(r()*40),rts:Math.floor(r()*9),reps:Math.floor(r()*5)})).sort((a,b)=>parseInt(b.ago)-parseInt(a.ago))}return REPLIES[k.id]}
function drawRMedia(){const el=$('#rmedia');if(el)el.innerHTML=mediaGrid(RDRAFT.media,1);const n=$('#rbox [data-attn]');if(n)n.textContent=RDRAFT.media.length?RDRAFT.media.length+'/4':'';const g=$('#rgo'),i=$('#rin');if(g&&i)g.disabled=!(i.value.trim()||RDRAFT.media.length)}
function sendReply(id){if(!S.connected)return connectModal();const k=calls.find(x=>x.id==id),i=$('#rin'),v=i.value.trim();if(!v&&!RDRAFT.media.length)return;
 const md=RDRAFT.media.slice();repliesOf(k).unshift({h:S.me,t:v,ago:'now',likes:0,rts:0,reps:0,media:md,mine:1});if(SYNC())upMedia(md).then(media=>bg('/api/posts/replies',{ref:String(k.id),body:v,media})).catch(()=>toast('Your reply couldn’t be saved'));k.replies=(k.replies||0)+1;RDRAFT.media=[];render();toast('Reply posted')}
function vPost(id){const k=calls.find(x=>String(x.id)===String(id));if(!k)return `<div class="empty"><b class="h2">This post is gone</b><p>It may have been removed.</p><a class="btn primary" href="#/home">Back to Home</a></div>`;
 if(k.t&&!T[k.t]){loadLiveToken(k.t,1);return `<div class="empty"><b>Loading this call…</b></div>`}
 const t=T[k.t],n=nums(k),r=rankOf(k.c),reps=repliesOf(k);
 const trade=k.kind==='random'?'':k.perp?perpPanel(k):n?`<div class="tpanel"><a class="ccard" href="#/token/${t.key}">${tokav(t.key)}<div class="cn"><b>${esc(t.name)}</b><span>$${t.sym} <span class="chain">${t.chain}</span></span></div>${mkt(k)}</a>
  <div class="tgrid num"><div><span>Called at</span><b>${fmtUsd(k.entry)}</b></div><div><span>Market cap now</span><b class="${n.up?'up':'down'}">${fmtUsd(n.mc)}</b></div><div><span>Since call</span><b class="${n.up?'up':'down'}">${fmtPct(n.p)}</b></div>
  <div><span>Target</span><b>${k.target?fmtUsd(k.target):'None set'}</b></div><div><span>Window</span><b>${esc(k.horizon||'Open')}</b></div><div><span>To target</span><b>${k.target?Math.min(100,Math.max(0,Math.round((n.mc-k.entry)/(k.target-k.entry)*100)))+'%':'—'}</b></div></div>
  ${k.target?`<div class="tprog"><i style="width:${Math.min(100,Math.max(2,(n.mc-k.entry)/(k.target-k.entry)*100))}%"></i></div>`:''}
  <div class="tact"><span class="${k.buy?'bk':'bk no'}">${k.buy?ic('check',14)+' Caller bought in · earns more':'Caller didn\'t buy · earns '+EARN_RULE.noBuy+'% after '+EARN_RULE.minX+'X'}</span>${tradable(t)?`<button class="btn primary" data-act="qbuy" data-t="${t.key}" data-id="${k.id}">Buy $${t.sym}</button>`:''}<a class="btn ghost" href="#/token/${t.key}">Chart</a></div></div>`
  :t?`<a class="ccard" href="#/token/${t.key}">${tokav(t.key)}<div class="cn"><b>${esc(t.name)}</b><span>$${t.sym} <span class="chain">${t.chain}</span></span></div><div class="cr"><b>Soon</b><span>Launches ${esc(t.prelaunch)}</span></div></a>`:'';
 return `<article class="fpost"><div class="fhead"><a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile">${avatar(k.c,'md')}</a><div class="grow"><div class="phead" style="margin:0"><span class="pname">${esc(nameOf(k.c))}</span>${vbadge(k.c)}${r&&!k.sponsored?`<span class="rk">#${r}</span>`:''}${k.sponsored?'<span class="tag">Sponsored</span>':''}</div><div class="hint">@${esc(k.c)}</div></div>
  ${k.c===S.me?'':`<button class="btn sm ${S.following.has(k.c)?'ghost':'primary'}" data-act="follow" data-h="${k.c}">${S.following.has(k.c)?'Following':'Follow'}</button>`}${k.sponsored?'':moreBtn(k)}</div>
  <p class="ftext">${rich(k.thesis)}</p>${mediaGrid(k.media)}${quoteCard(k.quote)}${trade}
  ${k.sponsored?`<div class="pnote">Paid promotion by ${esc(k.sponsor)}. Not counted in rankings.</div>`:''}
  <div class="fmeta hint">${k.ago==='now'?'Just now':k.ago+' ago'} · <b>${fmtK(k.views||0)}</b> views</div>
  <div class="fstats"><span><b>${k.replies||0}</b> replies</span><span><b>${k.reposts||0}</b> reposts</span><span><b>${k.likes||0}</b> likes</span></div>
  <div class="pbar fbar"><div class="icons">
   <button class="act" data-act="reply" aria-label="Reply">${ic('reply',20)}</button>
   <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',20)}</button>
   <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',20,k.liked)}</button>
   ${xacts(k,20)}<button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',20)}</button></div></div>
  <div class="rbox" id="rbox">${S.connected?avatar(S.me):'<span class="av" style="background:var(--bg2)"></span>'}<div class="grow"><textarea id="rin" class="rin" maxlength="280" rows="1" placeholder="${S.connected?'Post your reply':'Sign in to reply'}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';window.drawRMedia&&window.drawRMedia()" ${S.connected?'':'disabled'}></textarea><div id="rmedia"></div>
   <div class="rfoot">${S.connected?attachBar():''}<button class="btn primary sm" id="rgo" data-act="${S.connected?'rsend':'connect'}" data-id="${k.id}" ${S.connected?'disabled':''}>${S.connected?'Reply':'Sign in'}</button></div></div></div></article>
 <div class="replies">${reps.map((x,ri)=>`<div class="rep"><a href="#/profile/${x.h}" aria-label="Open @${esc(x.h)}'s profile">${avatar(x.h)}</a><div class="grow"><div class="phead" style="margin:0"><span class="pname">${esc(nameOf(x.h))}</span><span class="hint">@${esc(x.h)}</span><time>${x.ago==='now'?'now':x.ago}</time></div>
  <div class="hint" style="font-size:13px">Replying to <span style="color:var(--hi)">@${esc(k.c)}</span></div>${x.t?`<p class="ptext" style="margin:4px 0 0">${rich(x.t)}</p>`:''}${mediaGrid(x.media)}
  <div class="rbar"><button class="act" data-act="rrep" data-h="${esc(x.h)}" aria-label="Reply to @${esc(x.h)}">${ic('reply',17)}<span class="num">${x.reps||''}</span></button>
  <button class="act${x.rted?' reposted':''}" data-act="rrt" data-p="${k.id}" data-i="${ri}" aria-label="Repost">${ic('repost',17)}<span class="num">${x.rts||''}</span></button>
  <button class="act${x.liked?' liked':''}" data-act="rlike" data-p="${k.id}" data-i="${ri}" aria-label="Like">${ic('heart',17,x.liked)}<span class="num">${x.likes||''}</span></button>
  <button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',17)}</button></div></div></div>`).join('')||'<div class="empty"><b>No replies yet</b><p>Be the first to reply.</p></div>'}</div>`}

/* ---------- share ---------- */
const postURL=id=>location.href.split('#')[0]+'#/post/'+id;
/* ---------- onboarding ---------- */
const INTERESTS=['Memecoins','AI agents','New launches','DeFi','Gaming','Blue chips','Low caps','Narratives'];
function onboard(step=1){const st=S.ob||(S.ob={i:new Set()});
 const dots=`<div class="obdots">${[1,2,3].map(i=>`<i class="${i===step?'on':''}"></i>`).join('')}</div>`;
 if(step===1)return modal('What do you trade?','Pick a few. We use this to fill your For you feed.',`${dots}<div class="chips" style="margin:6px 0 18px">${INTERESTS.map(x=>`<button class="chip${st.i.has(x)?' on':''}" style="--c:var(--hi)" data-ob="${x}"><i></i>${x}</button>`).join('')}</div><button class="btn primary block" id="obn">Continue</button><button class="lnk" id="obs" style="display:block;margin:10px auto 0">Skip for now</button>`,
  m=>{m.querySelectorAll('[data-ob]').forEach(b=>b.onclick=()=>{const x=b.dataset.ob;st.i.has(x)?st.i.delete(x):st.i.add(x);b.classList.toggle('on')});$('#obn',m).onclick=()=>onboard(2);$('#obs',m).onclick=obDone});
 if(step===2)return modal('Follow a few callers','Their calls land in your Following feed the moment they post.',`${dots}<div class="list">${ranked().slice(0,5).map(c=>`<div class="li">${avatar(c.h)}<div class="grow"><b>${c.h}</b><div class="hint">${c.win}% win rate · ${c.calls} calls</div></div><button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-obf="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button></div>`).join('')}</div><button class="btn primary block" id="obn" style="margin-top:14px">Continue</button>`,
  m=>{m.querySelectorAll('[data-obf]').forEach(b=>b.onclick=()=>{const h=b.dataset.obf;S.following.has(h)?S.following.delete(h):S.following.add(h);const f=S.following.has(h);b.textContent=f?'Following':'Follow';b.className='btn sm '+(f?'ghost':'primary')});$('#obn',m).onclick=()=>onboard(3)});
 modal('How Callit works','',`${dots}<div class="obsteps">${[['promote','Make a call','Pick a token, set a target and say why. Your entry is stamped at the live market cap.'],['wallet','Buy in','Back it with your own wallet to earn the biggest share. Calls earn once they hold 2X.'],['market','Get tracked','Every call is followed in public. Win rate, returns and sells, all on your profile.']].map(([i,t,d],n)=>`<div class="obs"><span class="obi">${ic(i,20)}</span><div><b>${n+1}. ${t}</b><span>${d}</span></div></div>`).join('')}</div><button class="btn primary block" id="obn" style="margin-top:16px">Start exploring</button>`,m=>$('#obn',m).onclick=obDone)}
function obDone(){try{localStorage.setItem('callit.onboarded','1')}catch(_){}closeModal();render();toast('You’re all set')}
function maybeOnboard(){let d=false;try{d=localStorage.getItem('callit.onboarded')==='1'}catch(_){}if(!d)setTimeout(()=>onboard(1),400)}

/* ---------- messages ---------- */
const DMS={};
function vMessages(h){if(h&&DMS[h]!==undefined||h&&C[h]){DMS[h]=DMS[h]||[];const ms=DMS[h];
  return `<div class="rhead"><a href="#/profile/${h}">${avatar(h)}</a><div class="grow"><b>${esc(h)}</b><div class="hint">@${esc(h)}${C[h]&&C[h].win?` · ${C[h].win}% win rate`:''}</div></div><a class="btn sm ghost" href="#/profile/${h}">Profile</a></div>
  <div class="msgs" id="msgs">${ms.length?ms.map(([w,tx,ago])=>{const me=w==='me';return `<div class="msg${me?' me':''}">${avatar(me?S.me:w)}<div><div class="mh"><b>${esc(me?(PROF.name||S.me):w)}</b><span class="hint">${ago}</span></div><p>${esc(tx)}</p></div></div>`}).join(''):`<div class="empty"><b>Say hi to ${esc(h)}</b><p>Messages are private between you two.</p></div>`}</div>
  <div class="composer">${S.connected?`<input class="input" id="msgin" maxlength="500" placeholder="Write a message"><button class="btn primary" data-act="dmsend" data-f="${h}">Send</button>`:`<div class="grow"><b>Sign in to message</b></div><button class="btn primary" data-act="connect">Sign in</button>`}</div>`}
 const th=Object.entries(DMS).filter(([,m])=>m.length);
 return `<div class="pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px"><span class="hint">Direct messages</span><button class="btn sm primary" data-act="dmnew">${ic('promote',15)} New message</button></div>
 <div>${th.map(([h,m])=>{const l=m[m.length-1];return `<a class="comm" href="#/messages/${h}">${avatar(h,'md')}<div class="grow"><div class="cn1"><b>${esc(h)}</b><span class="hint">· ${l[2]}</span></div><p class="lastm">${l[0]==='me'?'You: ':''}${esc(l[1])}</p></div></a>`}).join('')||'<div class="empty"><b>No messages yet</b><p>Start a conversation with a caller you follow.</p></div>'}</div>`}

/* ---------- edit profile ---------- */
function editProfile(focus){const D={...PROF,handle:S.me};let hOk=true,hT=0;
 const draw=m=>{$('#ep',m).innerHTML=`<div class="epban" style="${D.banner?`background:#0B1B27 url(${D.banner}) center/cover`:bannerBg('x'+S.me)}">
  <label class="epbtn" title="Upload banner">${ic('camera',20)}<input type="file" accept="image/*" data-up="banner" hidden></label>${D.banner?`<button class="epbtn" data-rm="banner" title="Remove banner">${ic('x',18)}</button>`:''}</div>
  <div class="epav"><span class="av lg" style="${D.avatar?`background:#0B1B27 url(${D.avatar}) center/cover`:`background:hsl(${(hue(S.me)%70)+185} 52% 42%)`}">${D.avatar?'':esc(S.me.slice(0,2).toUpperCase())}</span><label class="epbtn sm" title="Upload photo">${ic('camera',16)}<input type="file" accept="image/*" data-up="avatar" hidden></label></div>
  <div class="field"><label for="epn">Display name <span class="hint" style="float:right">Shown on your posts</span></label><input id="epn" class="input" maxlength="40" value="${esc(D.name||'')}" placeholder="e.g. 22meow"></div>
  <div class="field"><label for="eph">Username <span class="hint" id="ephs" style="float:right"></span></label><div class="atin"><span>@</span><input id="eph" class="input" maxlength="20" value="${esc(D.handle||'')}" autocapitalize="off" autocomplete="off" spellcheck="false"></div><span class="hint">3–20 letters, numbers or _. Your profile link and @mentions use it.</span></div>
  <div class="field"><label for="epb">Bio <span class="hint" id="epbc" style="float:right">${(D.bio||'').length}/160</span></label><textarea id="epb" class="input" maxlength="160" placeholder="What do you call? Memes, AI, early launches...">${esc(D.bio||'')}</textarea></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="epw">Website</label><input id="epw" class="input" maxlength="80" value="${esc(D.web||'')}" placeholder="yoursite.xyz"></div>
  <div class="field"><label for="epx">X handle</label><input id="epx" class="input" maxlength="30" value="${esc(D.x||'')}" placeholder="@handle"></div></div>
  <div id="eperr" class="err"></div><button class="btn primary block" id="epsave">Save profile</button>`;
  const keep=()=>{D.name=$('#epn',m).value.trim();D.bio=$('#epb',m).value.trim();D.web=$('#epw',m).value.trim();D.x=$('#epx',m).value.trim();D.handle=$('#eph',m).value.trim().toLowerCase()};
  const hs=$('#ephs',m),hi=$('#eph',m);
  hi.oninput=()=>{const v=hi.value.toLowerCase().replace(/[^a-z0-9_]/g,'');if(v!==hi.value)hi.value=v;clearTimeout(hT);
   if(v===S.me){hOk=true;hs.textContent='';hs.className='hint';return}
   if(!/^[a-z0-9_]{3,20}$/.test(v)){hOk=false;hs.textContent='3–20 characters';hs.className='hint down';return}
   hOk=false;hs.textContent='Checking…';hs.className='hint';
   hT=setTimeout(()=>fetch('/api/profile?check='+encodeURIComponent(v)).then(r=>r.json()).then(j=>{if(hi.value!==v)return;hOk=!!j.available;hs.textContent=j.available?'✓ Available':(j.reason||'Taken');hs.className='hint '+(j.available?'up':'down')}).catch(()=>{hOk=true;hs.textContent=''}),350)};
  $('#epb',m).oninput=e=>$('#epbc',m).textContent=e.target.value.length+'/160';
  m.querySelectorAll('[data-up]').forEach(i=>i.onchange=()=>{const f=i.files[0];i.value='';if(!f)return;if(!/^image\//.test(f.type)){$('#eperr',m).textContent='Pick an image file.';return}keep();const bn=i.dataset.up==='banner';
   shrink(f,2000,url=>cropImage(url,bn?3:1,bn?1500:480,out=>{D[i.dataset.up]=out;draw(m)}))});
  m.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{keep();delete D[b.dataset.rm];draw(m)});
  $('#epsave',m).onclick=()=>{keep();const err=$('#eperr',m),btn=$('#epsave',m),nh=D.handle;
   if(nh!==S.me&&!/^[a-z0-9_]{3,20}$/.test(nh))return err.textContent='Usernames are 3–20 characters: letters, numbers and _.';
   if(nh!==S.me&&!hOk)return err.textContent=hs.textContent==='Checking…'?'Still checking that username…':'That username isn’t available.';
   const commit=()=>{const {handle,...rest}=D;const old=PROF;PROF=rest;if(!saveProf()){PROF=old;err.textContent='That image is too large to save. Try a smaller one.';return false}return true};
   if(!(realAuth()&&window.CallitAuth)){if(!commit())return;if(nh!==S.me)renameMe(S.me,nh);closeModal();toast('Profile updated');return render()}
   btn.disabled=true;btn.textContent='Saving…';err.textContent='';
   const up=(u,kind)=>u&&/^data:/.test(u)?upMedia([u],kind).then(a=>a[0]):Promise.resolve(u||null);
   Promise.all([up(D.avatar,'avatar'),up(D.banner,'banner')]).then(([av,bn])=>{D.avatar=av||undefined;D.banner=bn||undefined;
    return window.CallitAuth.saveProfile({display_name:D.name||null,bio:D.bio||null,website:D.web||null,x_handle:D.x||null,avatar_url:av,banner_url:bn,...(nh!==S.me?{handle:nh}:{})})})
    .then(p=>{commit();if(p&&p.handle&&p.handle!==S.me)renameMe(S.me,p.handle);if(p)S.profile={...S.profile,...p};closeModal();toast(nh!==(p&&p.handle||S.me)?'Profile updated':'Profile updated');
     render()})
    .catch(e=>{btn.disabled=false;btn.textContent='Save profile';err.textContent=e.message||'Couldn’t save. Try again.'})};
  hi.dispatchEvent(new Event('input'));
  if(focus==='banner')m.querySelector('[data-up="banner"]').click();if(focus==='avatar')m.querySelector('[data-up="avatar"]').click()};
 modal('Edit profile','',`<div id="ep"></div>`,draw)}
function followsModal(h,tab){const isReal=realAuth()&&(h===S.me||(C[h]&&C[h].real)||(PUB[h]&&!PUB[h].pending));
 const draw=m=>{const key=tab+':'+h;
  if(isReal&&!FL[key]){$('#fl',m).innerHTML=`<div class="sh-tabs" style="padding:0 0 12px;margin-bottom:6px">${[['followers','Followers'],['following','Following']].map(([k,l])=>`<button class="${tab===k?'on':''}" data-t="${k}">${l}</button>`).join('')}</div><div class="list">${'<div class="li sskel" aria-hidden="true"><span class="tokav"></span><div class="grow"><i></i><i></i></div></div>'.repeat(3)}</div>`;
   m.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;draw(m)});
   loadFollows(h,tab,l=>{if(!l)FL[key]=tab==='following'&&h===S.me?[...S.following]:[];if(m.isConnected)draw(m)});return}
  const list=isReal?(FL[key]||[]):tab==='following'?followingOf(h):followersOf(h);
  $('#fl',m).innerHTML=`<div class="sh-tabs" style="padding:0 0 12px;margin-bottom:6px">${[['followers','Followers'],['following','Following']].map(([k,l])=>`<button class="${tab===k?'on':''}" data-t="${k}">${l}</button>`).join('')}</div>
  ${list.length?`<div class="list">${list.map(x=>{const c=C[x]||{},fx=S.following.has(x);return `<div class="li">${avatar(x)}<div class="grow"><a class="pname" href="#/profile/${x}" data-act="close">${esc(nameOf(x))}</a><div class="hint">@${esc(x)}${c.calls&&!c.real?` · ${c.win}% win rate`:''}</div></div>${x===S.me?'':`<button class="btn sm ${fx?'ghost':'primary'}" data-fl="${x}">${fx?'Following':'Follow'}</button>`}</div>`}).join('')}</div>`
   :`<div class="empty" style="padding:28px 8px"><b>${tab==='following'?'Not following anyone yet':'No followers yet'}</b><p>${tab==='following'?'Follow callers you trust and their calls land in your Following feed.':'Make good calls and people will follow.'}</p>${tab==='following'?'<a class="btn primary" href="#/callerboard">Find callers</a>':''}</div>`}`;
  m.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;draw(m)});
  m.querySelectorAll('[data-fl]').forEach(b=>b.onclick=()=>{if(!S.connected)return connectModal();const x=b.dataset.fl,on=!S.following.has(x);toggleRel('follow',x,on);if(PUB[x]&&!PUB[x].pending)PUB[x].followers=Math.max(0,(PUB[x].followers||0)+(on?1:-1));delete FL['following:'+S.me];S.dirty=1;draw(m)})};
 modal(esc(nameOf(h)),'@'+esc(h),`<div id="fl"></div>`,draw)}


/* ---------- caller ranks: the 2go star ladder ----------
   Points come from what a caller does in public: posting, calling, buying in, getting likes,
   reposts, replies and followers. Shown everywhere a rank shows; hover/tap for progress. */
const TIERS=[['Novice',0],['Amateur',100],['Senior',300],['Enthusiast',700],['Professional',1500],['Expert',3000],['Leader',6000],['Veteran',12000],['Master',25000],['Ultimate',50000]];
function xpOf(h){const mine=calls.filter(k=>k.c===h&&!k.sponsored),c=C[h]||{},pb=PUB[h]&&!PUB[h].pending?PUB[h]:null;
 const followers=h===S.me?(S.followers||0):pb?pb.followers||0:(c.followers||0);
 let xp=mine.reduce((a,k)=>a+5+(k.kind==='random'?0:10)+(k.buy?15:0)+(k.likes||0)+2*(k.reposts||0)+2*(k.replies||0),0)+5*Math.min(followers,1000)+Math.max(0,followers-1000);
 if(!c.real&&c.calls)xp+=Math.round(c.calls*25+(c.win||0)*c.calls/100*40);// demo callers carry their history
 return xp}
function tierOf(h){const xp=xpOf(h);let i=0;TIERS.forEach((t,j)=>{if(xp>=t[1])i=j});const nx=TIERS[i+1];
 return {i,name:TIERS[i][0],xp,next:nx?nx[0]:null,need:nx?nx[1]-xp:0,pct:nx?Math.round((xp-TIERS[i][1])/(nx[1]-TIERS[i][1])*100):100}}
function rankChip(h){const t=tierOf(h),r=rankOf(h);
 return `<button class="rkchip tier t${t.i}" data-act="ranks" data-h="${esc(h)}" aria-label="${t.name} rank. ${t.next?t.need+' points to '+t.next:'Top rank'}">${ic('star',14,true)}<span>${t.name}</span>
 <span class="rkpop" role="tooltip"><b>${ic('star',13,true)} ${t.name}${r?` · Leaderboard #${r}`:''}</b><span class="rkbar"><i style="width:${Math.max(4,t.pct)}%"></i></span><small>${t.next?`${t.xp.toLocaleString()} pts · ${t.need.toLocaleString()} to <b>${t.next}</b>`:`${t.xp.toLocaleString()} pts · top of the ladder`}</small>${r?'':'<small>10 calls to join the leaderboard</small>'}</span></button>`}
function ranksModal(h){const t=tierOf(h);
 modal('Caller ranks',`${h===S.me?'You are':'@'+esc(h)+' is'} <b>${t.name}</b> with ${t.xp.toLocaleString()} points`,`<div class="ladder">${TIERS.map(([n,p],i)=>`<div class="lrow${i===t.i?' on':i<t.i?' done':''}"><span class="lstar t${i}">${ic('star',16,i<=t.i)}</span><b>${n}</b><span class="hint num">${p.toLocaleString()} pts</span>${i===t.i&&t.next?`<span class="rkbar sm"><i style="width:${Math.max(4,t.pct)}%"></i></span>`:''}</div>`).join('')}</div>
 <p class="hint" style="margin:14px 0 0;line-height:1.5">Earn points by posting (5), making calls (+10), buying into your calls (+15), likes (1), reposts and replies (2) and followers (5). The Callerboard is separate: it ranks callers with 10+ calls by win rate.</p>`)}

/* ---------- PnL year to date + wallet balance (own profile and wallet) ---------- */
function ytdSeries(){const now=new Date(),y0=new Date(now.getFullYear(),0,1).getTime(),cash=new Set([SOL_MINT,USDC_MINT]),P={};let realY=0,cost=0;const pts=[[y0,0]];
 [...(S.ledger||[])].reverse().forEach(t=>{const at=Date.parse(t.created_at)||Date.now(),u=+t.usd_value||0,ia=+t.in_amount||0,oa=+t.out_amount||0;let d=0;
  if(t.kind==='buy'||t.kind==='sell'||t.kind==='swap'){const pi=t.in_mint&&!cash.has(t.in_mint)?P[t.in_mint]:null;
   if(pi&&pi.amt>0&&ia>0){const q=Math.min(ia,pi.amt),avg=pi.cost/pi.amt;d=u*(q/ia)-avg*q;pi.cost-=avg*q;pi.amt-=q}
   if(t.out_mint&&!cash.has(t.out_mint)&&oa>0){const po=P[t.out_mint]=P[t.out_mint]||{amt:0,cost:0};po.amt+=oa;po.cost+=u;if(at>=y0)cost+=u}}
  else if(t.kind==='withdraw'&&t.in_mint&&P[t.in_mint]&&P[t.in_mint].amt>0){const pi=P[t.in_mint],q=Math.min(ia,pi.amt);pi.cost-=pi.cost/pi.amt*q;pi.amt-=q}
  if(at>=y0&&d){realY+=d;pts.push([at,realY])}});
 const B=pnlBook();let un=0;Object.keys(S.bal).forEach(k=>{const x=posPnl(k,B);if(x)un+=x.pnl});
 const pnl=realY+un;pts.push([Date.now(),pnl]);return {pts,pnl,pct:cost>0?pnl/cost*100:null,y0}}
function walletTotal(){return Object.entries(S.bal).reduce((a,[k,v])=>a+(v>0&&T[k]&&T[k].price?v*T[k].price:0),0)}
function ytdCard(){if(!S.connected)return '';const Y=ytdSeries(),up=Y.pnl>=0,W=320,H=64,now=Date.now();
 const vs=Y.pts.map(p=>p[1]),lo=Math.min(0,...vs),hi=Math.max(0,...vs),span=hi-lo||1,X=t=>((t-Y.y0)/Math.max(1,now-Y.y0))*W,Yv=v=>H-4-((v-lo)/span)*(H-8);
 const d=Y.pts.map((p,i)=>`${i?'L':'M'}${X(p[0]).toFixed(1)},${Yv(p[1]).toFixed(1)}`).join(''),z=Yv(0).toFixed(1),ex=X(now).toFixed(1),ey=Yv(Y.pnl).toFixed(1);
 const fmtD=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
 return `<div class="ytd ${up?'is-up':'is-down'}"><div class="ytdtop"><div><span class="hint">Wallet balance</span><b class="num">${fmtUsd(walletTotal())}</b></div>
 <div class="ytdr"><span class="hint">PnL · YTD</span><b class="num ${up?'up':'down'}">${up?'+':'−'}${fmtUsd(Math.abs(Y.pnl))}${Y.pct!=null?` <small>(${up?'+':'−'}${Math.abs(Y.pct).toFixed(1)}%)</small>`:''}</b></div></div>
 <div class="ytdwrap"><svg class="ytdline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="PnL year to date ${up?'up':'down'} ${fmtUsd(Math.abs(Y.pnl))}"><line x1="0" x2="${W}" y1="${z}" y2="${z}" class="zl"/><path d="${d}L${ex},${H}L0,${H}Z" class="ar"/><path d="${d}" class="ln" pathLength="1"/></svg><i class="ytddot" style="left:${(ex/W*100).toFixed(2)}%;top:${(ey/H*100).toFixed(2)}%"></i></div>
 <div class="ytdfoot hint"><span>${fmtD(Y.y0)}</span><span>YTD ${new Date().getFullYear()}</span><span>${fmtD(now)}</span></div></div>`}

/* ---------- full-size profile photo ---------- */
function viewPhoto(h){const u=(h===S.me&&PROF.avatar)||AVURL[h];
 $('#modal').innerHTML=`<div class="scrim lbox" data-act="close" role="dialog" aria-modal="true" aria-label="Profile photo of @${esc(h)}"><button class="ib lbx" data-act="close" aria-label="Close">${ic('x',20)}</button>
 ${u?`<img src="${esc(u)}" alt="Profile photo of @${esc(h)}" class="lbimg">`:`<span class="av lbimg lbinit" style="background:hsl(${(hue(h)%70)+185} 52% 42%)">${esc(h.slice(0,2).toUpperCase())}</span>`}
 <div class="lbcap"><b>${esc(nameOf(h))}</b><span>@${esc(h)}</span>${h===S.me?`<button class="btn sm" data-act="editprof" data-f="avatar">${ic('camera',15)} Change photo</button>`:''}</div></div>`}

/* ---------- photo cropper: drag to position, pinch / slider / wheel to zoom, rotate ---------- */
function cropImage(src,aspect,outW,cb){const ov=document.createElement('div');ov.className='cropov';
 ov.innerHTML=`<div class="cropbox" role="dialog" aria-modal="true" aria-label="Adjust photo"><div class="mhead"><div><h2>Adjust photo</h2><p class="sub">Drag to position. Pinch or slide to zoom.</p></div><button class="ib" data-c="x" aria-label="Cancel">${ic('x',18)}</button></div>
 <div class="cropstage${aspect===1?' round':''}" style="aspect-ratio:${aspect}"><img alt="" draggable="false"><i class="cropgrid" aria-hidden="true"></i></div>
 <div class="cropctl"><span class="muted">${ic('image',15)}</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom" class="prange"><span class="muted">${ic('image',21)}</span><button type="button" class="ib" data-c="rot" aria-label="Rotate 90°" title="Rotate">${ic('rotate',18)}</button></div>
 <div class="cropbtns"><button type="button" class="btn ghost" data-c="x">Cancel</button><button type="button" class="btn primary" data-c="ok">Apply</button></div></div>`;
 document.body.appendChild(ov);requestAnimationFrame(()=>ov.classList.add('in'));
 const img=ov.querySelector('img'),st=ov.querySelector('.cropstage'),rg=ov.querySelector('input');let z=1,rot=0,x=0,y=0,iw=1,ih=1;const im=new Image();
 const dims=()=>{const W=st.clientWidth,H=st.clientHeight,rw=rot%180?ih:iw,rh=rot%180?iw:ih,base=Math.max(W/rw,H/rh);return {W,H,rw,rh,sc:base*z}};
 const lay=()=>{const D=dims(),mx=Math.max(0,(D.rw*D.sc-D.W)/2),my=Math.max(0,(D.rh*D.sc-D.H)/2);x=Math.max(-mx,Math.min(mx,x));y=Math.max(-my,Math.min(my,y));
  img.style.width=iw+'px';img.style.height=ih+'px';img.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px) rotate(${rot}deg) scale(${D.sc})`;rg.value=z;rg.style.setProperty('--v',((z-1)/3*100)+'%')};
 im.onload=()=>{iw=im.naturalWidth;ih=im.naturalHeight;img.src=src;lay()};im.src=src;
 const ptr=new Map();let pinch=0,pz=1;
 st.addEventListener('pointerdown',e=>{st.setPointerCapture(e.pointerId);ptr.set(e.pointerId,[e.clientX,e.clientY]);if(ptr.size===2){const [a,b]=[...ptr.values()];pinch=Math.hypot(a[0]-b[0],a[1]-b[1]);pz=z}});
 st.addEventListener('pointermove',e=>{if(!ptr.has(e.pointerId))return;const p=ptr.get(e.pointerId);
  if(ptr.size===2){ptr.set(e.pointerId,[e.clientX,e.clientY]);const [a,b]=[...ptr.values()];z=Math.max(1,Math.min(4,pz*Math.hypot(a[0]-b[0],a[1]-b[1])/(pinch||1)));lay();return}
  x+=e.clientX-p[0];y+=e.clientY-p[1];ptr.set(e.pointerId,[e.clientX,e.clientY]);lay()});
 const up=e=>{ptr.delete(e.pointerId);if(ptr.size<2)pinch=0};st.addEventListener('pointerup',up);st.addEventListener('pointercancel',up);
 st.addEventListener('wheel',e=>{e.preventDefault();z=Math.max(1,Math.min(4,z*(e.deltaY<0?1.08:1/1.08)));lay()},{passive:false});
 rg.oninput=()=>{z=+rg.value;lay()};
 const done=out=>{ov.classList.remove('in');setTimeout(()=>ov.remove(),180);document.removeEventListener('keydown',kd,true);if(out)cb(out)};
 const kd=e=>{if(e.key==='Escape'){e.stopPropagation();done(null)}};document.addEventListener('keydown',kd,true);
 ov.addEventListener('click',e=>{const c=e.target.closest('[data-c]');if(!c)return;
  if(c.dataset.c==='x')return done(null);
  if(c.dataset.c==='rot'){rot=(rot+90)%360;x=0;y=0;return lay()}
  const D=dims(),cw=outW,ch=Math.round(outW/aspect),k=cw/D.W,cv=document.createElement('canvas');cv.width=cw;cv.height=ch;const g=cv.getContext('2d');
  g.fillStyle='#0B1B27';g.fillRect(0,0,cw,ch);g.translate(cw/2+x*k,ch/2+y*k);g.rotate(rot*Math.PI/180);g.scale(D.sc*k,D.sc*k);g.imageSmoothingQuality='high';g.drawImage(im,-iw/2,-ih/2);
  done(cv.toDataURL('image/jpeg',.9))})}

/* ---------- followers / following: real lists from the server ---------- */
const FL={};
function loadFollows(h,tab,cb){const key=tab+':'+h;if(!realAuth())return cb(null);
 fetch(`/api/social?${tab}=${encodeURIComponent(h)}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(!j)return cb(null);
  (j.people||[]).forEach(p=>{if(p.avatar_url)AVURL[p.handle]=p.avatar_url;if(p.display_name)DN[p.handle]=p.display_name});FL[key]=(j.people||[]).map(p=>p.handle);cb(FL[key])}).catch(()=>cb(null))}

/* ---------- rename yourself everywhere in the open app after a username change ---------- */
function renameMe(o,n){if(!o||o===n)return;S.me=n;if(C[o]){C[n]={...C[o],h:n};delete C[o]}if(AVURL[o]){AVURL[n]=AVURL[o];delete AVURL[o]}
 calls.forEach(k=>{if(k.c===o)k.c=n});Object.values(REPLIES).forEach(l=>l.forEach(x=>{if(x.h===o)x.h=n}));if(S.profile)S.profile.handle=n}

/* ---------- drafts (this device) ---------- */
const DRAFTS=(()=>{try{return JSON.parse(localStorage.getItem('callit.drafts')||'[]')||[]}catch(_){return []}})();
const saveDrafts=()=>{try{localStorage.setItem('callit.drafts',JSON.stringify(DRAFTS.slice(0,30)))}catch(_){}};
function addDraft(kind,text,tok){text=(text||'').trim();tok=(tok||'').trim();if(!text&&!tok)return false;
 const dup=DRAFTS.findIndex(d=>d.text===text&&d.kind===kind&&(d.tok||'')===tok);if(dup>=0)DRAFTS.splice(dup,1);
 DRAFTS.unshift({id:Date.now()+''+Math.floor(Math.random()*99),kind,text,tok,at:Date.now()});saveDrafts();return true}
function draftsModal(){const ago=t=>{const m=(Date.now()-t)/6e4;return m<1?'just now':m<60?Math.round(m)+'m ago':m<1440?Math.round(m/60)+'h ago':Math.round(m/1440)+'d ago'};
 modal('Drafts',DRAFTS.length?`${DRAFTS.length} saved on this device`:'',DRAFTS.length?`<div class="list drafts">${DRAFTS.map(d=>`<div class="li draft"><button type="button" class="grow dopen" data-dopen="${d.id}"><span class="tag${d.kind==='perps'?' pk':''}">${{meme:'Meme call',perps:'Perps',random:'Post'}[d.kind]||'Post'}</span>${d.tok?` <b>${esc(d.tok)}</b>`:''}<span class="dtext">${esc(d.text||'(no text yet)')}</span><span class="hint">${ago(d.at)}</span></button><button type="button" class="ib" data-ddel="${d.id}" aria-label="Delete draft">${ic('trash',17)}</button></div>`).join('')}</div>`
  :`<div class="empty" style="padding:26px 8px"><span class="eic">${ic('draft',24)}</span><b>No drafts</b><p>Tap Save draft while writing, or just close the composer: whatever you wrote is kept here.</p></div>`,
  m=>{m.addEventListener('click',e=>{const o=e.target.closest('[data-dopen]'),x=e.target.closest('[data-ddel]');
   if(x){const i=DRAFTS.findIndex(d=>d.id===x.dataset.ddel);if(i>=0)DRAFTS.splice(i,1);saveDrafts();draftsModal();return}
   if(o){const i=DRAFTS.findIndex(d=>d.id===o.dataset.dopen);if(i<0)return;const d=DRAFTS.splice(i,1)[0];saveDrafts();S.noDraft=1;closeModal();
    composeModal(d.kind==='perps'?'meme':d.kind,{draft:d.text,pre:d.tok?d.tok.replace(/^\$/,''):undefined})}})})}

/* ---------- socials + legal ---------- */
const LINKS={x:'',discord:'',telegram:''}; // paste Callit's real URLs here
const socials=(cls='')=>`<div class="soc ${cls}">${[['x','X','xlogo'],['discord','Discord','discord'],['telegram','Telegram','telegram']].map(([k,l,i])=>`<a href="${LINKS[k]||'#'}" ${LINKS[k]?'target="_blank" rel="noopener"':`data-act="soclink" data-f="${l}"`} aria-label="Callit on ${l}" title="${l}">${ic(i,cls?17:20)}</a>`).join('')}</div>`;
/* ---------- Legal & trust pages ----------
   Fill these in once the company is set up. Empty values fall back to neutral wording. */
const LEGAL={entity:'Callit',email:'',law:'',updated:'6 October 2026'};
const LC=()=>LEGAL.email?`email ${LEGAL.email}`:'use the support options listed in the app';
const DOCS={
terms:['Terms of Service',[
 ['1. Agreement',[`These Terms are an agreement between you and ${LEGAL.entity} ("Callit", "we", "us"). By creating an account, connecting a wallet or using any part of Callit, you agree to them. If you don't agree, don't use Callit.`,'We may update these Terms. When we make material changes we will show a notice in the app. Using Callit after the change means you accept the updated Terms.']],
 ['2. What Callit is, and is not',['Callit is a software interface. It lets people post and track crypto "calls", view market data, chat, and trade through third-party protocols.','Callit is not a broker, exchange, bank, investment adviser, custodian or fiduciary. We do not hold your funds, execute trades on your behalf, or give personal financial, legal or tax advice.','Calls, comments, rankings, AI Auto scores, heat labels, news and any other content are information and opinion only. They are not a recommendation to buy, sell or hold anything.']],
 ['3. Eligibility',['You must be at least 18 years old, or the age of majority where you live, and legally able to enter this agreement.','You may not use Callit if you are located in, or a resident of, a country or region subject to comprehensive sanctions, or if you are on a sanctions list. You are responsible for making sure your use of Callit is legal where you are.']],
 ['4. Your wallet and keys',['Callit is non-custodial. Your wallet is either your own (Phantom, Solflare, Backpack and similar) or an embedded wallet created for you by our wallet provider, Privy, when you sign in with email, Google or X.','You control your wallet. Every transaction is approved by you. You can export an embedded wallet’s private key at any time from You → Wallet and use it in another wallet app.','Callit never sees or stores your private key or seed phrase and will never ask for it. Anyone who asks for it is not Callit.','You are solely responsible for keeping your devices, sign-in methods and keys secure. Blockchain transactions are final: we cannot reverse, cancel, refund or recover them, including transfers sent to a wrong address.']],
 ['5. Trading through third parties',['Swaps, limit orders and similar features are executed by independent third-party protocols, mainly Jupiter, on the Solana blockchain. Market data comes from providers such as DexScreener, GeckoTerminal, Jupiter and Helius. News and trends come from public sources.','We don’t control these services. Prices, quotes and data can be delayed, incomplete or wrong. Orders can fail, fill at a different price, or be affected by slippage, network congestion, front-running or outages.','Before you confirm a transaction, check the token, the amount and the details shown in your wallet. Your confirmation is final.']],
 ['6. Fees',['Callit may charge a fee on trades made through the app. The current rate is shown before you confirm and is described on the Fees & Rewards page. Solana network fees are separate and paid to the network.','Fee rates, shares and rewards may change. Changes apply to trades made after the change.']],
 ['7. Caller rewards, points and $CALLIT',['Caller fee shares, referral rewards, cashback and points are promotional programs. Eligibility rules (for example, a call holding 2X before it pays, a bigger share for calls the caller bought into, anti-farming checks) are set by us and may change.','We may withhold, reverse or cancel rewards or points that we reasonably believe were earned through manipulation, wash trading, self-referral, multiple accounts, bots, exploits or other abuse.','Points have no cash value and are not a promise of any token, airdrop or payment. Any future $CALLIT token, staking or airdrop will have its own terms. Nothing in Callit today is an offer or sale of $CALLIT.']],
 ['8. Your content',['You are responsible for what you post, including calls, comments, images and messages. You confirm you have the right to post it and that it is not false, misleading, defamatory or unlawful.','You keep ownership of your content. You give Callit a worldwide, royalty-free licence to host, display, distribute and promote it in connection with running and marketing Callit.','Calls are permanent records: once posted, the entry price and time cannot be edited, so call history stays honest. We may remove content that breaks these Terms or the Community Rules.']],
 ['9. Prohibited conduct',['You agree not to: coordinate pump-and-dumps or other market manipulation; post fake, misleading or undisclosed paid calls; impersonate people, projects or Callit staff; farm rewards with multiple accounts, bots or wash trades; promote scams, phishing links or drainers; harass or threaten others; scrape, overload, reverse-engineer or attack the service; exploit bugs instead of reporting them; or use Callit for money laundering, sanctions evasion or any illegal purpose.','Knowingly making false public accusations about Callit, its team or its users, or submitting false reports, is also a breach of these Terms.']],
 ['10. Suspension and termination',['We may restrict, suspend or close accounts, remove content or withhold rewards if we reasonably believe these Terms were broken, to protect users, or if required by law. Because Callit is non-custodial, closing an account never takes your wallet or your funds: they remain in your wallet.','You can stop using Callit at any time.']],
 ['11. Risks you accept',['Crypto assets are highly volatile. New and meme tokens are especially risky and can lose all their value in minutes, be abandoned, or be scams ("rugs"). Smart contracts, blockchains, wallets and third-party services can fail or be exploited.','You use Callit at your own risk and are solely responsible for your trading decisions. See the Risk Disclosure for more.']],
 ['12. Disclaimers',['Callit is provided "as is" and "as available", without warranties of any kind, including accuracy, availability, merchantability, fitness for a particular purpose or non-infringement, to the fullest extent allowed by law.','We don’t guarantee that Callit will be uninterrupted, error-free or secure, or that any data, ranking or score is accurate.']],
 ['13. Limitation of liability',['To the fullest extent allowed by law, Callit and its team will not be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, lost tokens, trading losses or lost data, arising from your use of Callit, third-party services, blockchains or other users.','Our total liability for any claim is limited to the greater of (a) the fees you paid to Callit in the 3 months before the claim, or (b) USD 100.','Some places don’t allow these limits, so parts may not apply to you.']],
 ['14. Indemnity',['You agree to cover Callit and its team for claims, losses and costs (including reasonable legal fees) that come from your content, your breach of these Terms, or your misuse of Callit.']],
 ['15. Disputes',['Before making any claim, contact us and give us 30 days to try to resolve it informally. Most issues can be settled this way.',`${LEGAL.law?`These Terms are governed by the laws of ${LEGAL.law}. `:''}To the extent allowed by law, disputes will be resolved individually by binding arbitration or in the courts of the place where ${LEGAL.entity} is established, and not as part of a class or group action.`,'Any claim must be brought within one year after it arose, or it is permanently barred, where the law allows.']],
 ['16. Contact',[`For questions about these Terms, ${LC()}.`]]]],
privacy:['Privacy Policy',[
 ['What we collect',['Sign-in details from your chosen method (for example your email, or your Google or X account name and handle), handled through our wallet and sign-in provider, Privy.','Your public wallet address and on-chain activity linked to it.','What you create on Callit: profile, calls, posts, comments, messages, follows, watchlists, alert settings.','Basic technical data: device and browser type, approximate region, pages used, errors, and push notification tokens if you turn alerts on.']],
 ['What we never collect',['Your private key or seed phrase. Embedded wallet keys are managed by Privy’s security infrastructure and are never visible to Callit.']],
 ['How we use it',['To run Callit: sign-in, profiles, feeds, alerts, rankings and caller rewards.','To keep it safe: preventing fraud, farming, spam and abuse, and enforcing our Terms.','To improve the product and fix problems. We don’t sell your personal data.']],
 ['What is public',['Blockchains are public. Your wallet address, trades and balances can be seen by anyone on-chain.','Calls, profiles, caller stats and positions on calls are shown publicly on Callit by design.']],
 ['Who we share with',['Service providers that help run Callit, such as Privy (sign-in and wallets), Supabase (database), Vercel (hosting), Helius (blockchain data and alerts) and Jupiter (trading). They process data only to provide their service.','Authorities when the law requires it, or to protect users and Callit from fraud or harm.']],
 ['Your choices',['Edit your profile at any time. Turn alerts off in Alerts or your browser settings.',`Ask us to export or delete your account data: ${LC()}. Data already recorded on a blockchain can’t be deleted by anyone.`]],
 ['Storage and security',['We keep data only as long as needed to run Callit and meet legal duties, and we use reasonable security measures. No system is perfectly secure.']],
 ['Children',['Callit is not for anyone under 18. We delete accounts we learn belong to minors.']]]],
risk:['Risk Disclosure',[
 ['Read this before you trade',['Trading crypto, especially new and meme tokens, is extremely risky. Only use money you can afford to lose completely.']],
 ['Main risks',['Volatility: prices can move 90% or more in minutes.','Rugs and scams: creators or insiders can dump, drain liquidity or abandon a token. Copycat tokens imitate real ones.','Liquidity: you may not be able to sell, or only at a much worse price.','Execution: slippage, failed transactions, front-running (MEV) and network congestion can change your result.','Technology: wallets, smart contracts, Solana and third-party services can fail, be hacked or go offline.','Information: calls, rankings, AI Auto scores, heat labels and data can be wrong, late or manipulated. Past performance of a caller does not predict future results.','Regulation: rules for crypto vary by country and can change, which may affect your ability to use Callit or certain tokens.']],
 ['Your responsibility',['Do your own research, check contract addresses, and never trade on a call alone. Taxes on your trades are your responsibility.']]]],
fees:['Fees & Rewards',[
 ['Trading fee',['Callit charges a small fee on swaps made through the app, taken by Jupiter’s referral system in the same transaction. The current standard rate is 1%, shown before you confirm. Premium members and, after launch, $CALLIT stakers get a lower rate.','Solana network fees (a fraction of a cent) and any priority tip you choose go to the network, not Callit.']],
 ['Where the fee goes',['Jupiter keeps 20% of the referral fee. Callit’s share is split between: callers (on buys from their calls once a call holds 2X), referrals, trader cashback, $CALLIT buyback and burn (after launch), and the treasury that pays for the team, infrastructure and growth.','Sell fees never go to callers, referrers or cashback.']],
 ['Caller rewards',['Calls start paying once they hold 2X on a rolling-average market cap (a quick wick doesn’t count). Callers who bought in and held earn 20%, growing with higher multiples up to 30%. Callers who didn’t buy, or sold before their target, earn 5%. Your own buys never pay you. Earnings are claimed in SOL to your wallet. Farming or manipulation reduces or cancels rewards.','Reward rules may change, and rewards earned through abuse can be withheld.']]]],
rules:['Community Rules',[
 ['Keep it honest',['Disclose paid promotions. Sponsored content is always labelled and never counts toward rankings.','No fake calls, fake screenshots or misleading claims about tokens or people.']],
 ['Keep it safe',['No scams, phishing links, wallet drainers or "send me your seed phrase" requests. Callit staff will never DM you for keys or funds.','No harassment, threats, hate or doxxing.']],
 ['Keep it fair',['No coordinated pump-and-dumps, wash trading, multiple accounts or bot farming.','Report bugs instead of exploiting them. Responsible reports may be rewarded.']],
 ['Enforcement',['We may remove content, limit features, withhold rewards or suspend accounts that break these rules.']]]],
security:['Security & Transparency',[
 ['Your funds stay with you',['Callit is non-custodial. Your tokens live in your wallet on Solana, not in a Callit account. Nothing moves unless you approve it.','Email, Google and X sign-ins get an embedded wallet from Privy, a wallet provider used by many crypto apps. Keys are secured by Privy’s infrastructure and are never visible to Callit. You can export your key from You → Wallet and take your wallet anywhere.']],
 ['Built on audited infrastructure',['Swaps and limit orders run through Jupiter, Solana’s most used trading aggregator, whose programs are publicly audited. Callit does not run its own smart contracts for trading today, so there is no Callit contract holding user funds.','Any Callit smart contract added later (for example $CALLIT staking) will be reviewed before it holds user funds, and its address will be published here.']],
 ['Everything is verifiable',['Every trade made through Callit is a normal Solana transaction you can look up on Solscan. Fees land in a public referral account. Calls are timestamped at the market cap when posted and can’t be edited later.']],
 ['Report a problem',[`Found a bug or a security issue? Please ${LC()} instead of sharing it publicly, so we can fix it first. Responsible reports may be rewarded.`,'Callit will never ask for your seed phrase, private key or for you to send funds to "verify" your wallet.']]]]};
const DOC_ORDER=['terms','privacy','risk','fees','rules','security'];
const docHTML=k=>{const [,secs]=DOCS[k];return secs.map(([h,ps])=>`<h3 class="dh">${esc(h)}</h3>${ps.map(p=>`<p>${esc(p)}</p>`).join('')}`).join('')};
function docModal(k){if(!DOCS[k])k='terms';const [t]=DOCS[k];modal(t,`Last updated ${LEGAL.updated}`,`<div class="prose docx" style="padding:0;max-height:62vh;overflow-y:auto">${docHTML(k)}</div><a class="btn ghost block" href="#/legal/${k}" data-act="close" style="margin-top:12px">Open full page</a>`)}
function vLegal(p){const k=DOCS[p]?p:'terms';
 return `<div class="ltabs2" role="tablist">${DOC_ORDER.map(x=>`<a role="tab" aria-selected="${x===k}" class="${x===k?'on':''}" href="#/legal/${x}">${esc(DOCS[x][0])}</a>`).join('')}</div>
 <article class="prose docx"><b class="h2" style="display:block">${esc(DOCS[k][0])}</b><p class="hint">Last updated ${LEGAL.updated}</p>${docHTML(k)}</article>`}

/* ---------- landing ---------- */
const G_ICON='<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const MEGA='<svg class="lmega" viewBox="0 0 240 200" aria-hidden="true"><g fill="none" stroke-linejoin="round" stroke-linecap="round"><path class="o" d="M44 78h30v48H44a12 12 0 01-12-12V90a12 12 0 0112-12zM74 80c36-6 66-20 92-44v132c-26-24-56-38-92-44zM88 126l14 50h24l-10-47"/><ellipse class="o" cx="170" cy="102" rx="22" ry="68"/><path class="o" d="M166 78c10 2 14 12 14 24s-4 22-14 24"/><path class="i" d="M44 78h30v48H44a12 12 0 01-12-12V90a12 12 0 0112-12zM74 80c36-6 66-20 92-44v132c-26-24-56-38-92-44zM88 126l14 50h24l-10-47"/><ellipse class="i" cx="170" cy="102" rx="22" ry="68"/><path class="i" d="M166 78c10 2 14 12 14 24s-4 22-14 24"/></g></svg>';
/* Live-calls ticker on the landing page: the thing X doesn't have. */
const LX_TICK_A=[['c','fadedpixel','GLORP','+$519.90'],['g','GLORP','+346.6%'],['m','KFSH','$1.84M MC'],['c','lagosape','KFSH','+$355.10'],['f','+0.42 SOL','caller fees'],['g','DOTB','+113.9%'],['c','quietmoney','GLORP','+$60.55'],['g','NIMB','+64.2%']];
const LX_TICK_B=[['n','minnie_sol','DOTB','3m'],['g','KFSH','+118.4%'],['m','GLORP','$21.4M MC'],['c','minnie_sol','DOTB','+$45.55'],['n','dr_liquidity','NIMB','8m'],['g','MOTH','+213%'],['f','+1.8 SOL','paid to callers today'],['m','NIMB','$412K MC']];
function lxChip(x){const [k,a,b,v]=x;
 if(k==='g')return `<span class="tk">${tokav(a)}<b>$${esc(symOf(a))}</b><em class="up">${ic('up',12)}${esc(b)}</em></span>`;
 if(k==='m')return `<span class="tk">${tokav(a)}<b>$${esc(symOf(a))}</b><i>${esc(b)}</i></span>`;
 if(k==='c')return `<span class="tk">${avatar(a)}<b>@${esc(a)}</b><i>called $${esc(symOf(b))}</i><em class="${String(v).startsWith('−')?'down':'up'}">${esc(v)}</em></span>`;
 if(k==='n')return `<span class="tk"><span class="tklive"></span>${avatar(a)}<b>@${esc(a)}</b><i>called $${esc(symOf(b))} · ${v==='now'?'just now':esc(v)+' ago'}</i></span>`;
 return `<span class="tk tkfee"><em class="up">${esc(a)}</em><i>${esc(b)}</i></span>`}
/* Landing ticker: live movers and real calls only. Until data arrives it shows what Callit does, never made-up trades. */
function lxLive(row){const mv=(LIVE.feeds['movers:1h']||[]).map(k=>T[k]).filter(t=>t&&t.live&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase())),out=[];
 const rc=calls.filter(k=>k.kind==='meme'&&T[k.t]&&nums(k)).slice(0,6);
 mv.slice(row*6,row*6+6).forEach((t,i)=>{out.push(i%2?['m',t.key,fmtUsd(mcap(t))+' MC']:['g',t.key,fmtPct(t.chg)])});
 rc.slice(row*3,row*3+3).forEach((k,i)=>out.splice(i*2+1,0,['n',k.c,k.t,k.ago==='now'?'now':k.ago]));
 if(out.length<4)return row?[['f','Call it','get paid at 2X'],['f','Every call','tracked in public'],['f','Win rate','on the Callerboard'],['f','Non-custodial','your keys, your coins']]
  :[['f','Call it.','Get Paid.'],['f','Entry stamped','at live market cap'],['f','Swap in-app','routed by Jupiter'],['f','Follow callers','you trust']];
 return out}
function lxTicker(items,cls){const row=items.map(lxChip).join('');
 return `<div class="lxtick${cls}" aria-hidden="true"><div class="lxtrack">${row}${row}</div></div>`}
function landingHTML(){const yr=new Date().getFullYear();
 return `<div class="lx-top">${lxTicker(lxLive(0),'')}<button class="ib ltheme" data-act="theme" aria-label="Switch light or dark">${ic('sun',18)}</button></div>
 <div class="lfx" aria-hidden="true">${[['+347%','p a'],['$1.84M MC','m b'],['+118%','p c'],['$21.4M MC','m d'],['+64%','p e'],['$412K MC','m f'],['+213%','p g']].map(([t,c])=>`<span class="fx ${c}">${c[0]==='p'?ic('up',14):''}${t}</span>`).join('')}</div>
 <main class="lx"><div class="lxlogo"><span class="fx lxs l">${ic('up',13)}+347%</span><span class="fx lxs l2 fee">+0.42 SOL</span><span class="mark lxmark" role="img" aria-label="Callit"></span><span class="fx m lxs r">$1.84M MC</span><span class="fx lxs r2">${ic('up',13)}+118%</span></div>
  <h1>Call it.<br>Get Paid.</h1>
  <p class="lx-sub">Crypto calls, tracked in public. Join today.</p>
  <div class="lx-auth">
   <button class="lxb" data-act="lsign" data-f="Google">${G_ICON}<span>Continue with Google</span></button>
   <button class="lxb" data-act="lsign" data-f="X">${ic('xlogo',18)}<span>Continue with X</span></button>
   <button class="lxb" data-act="lwallet">${ic('wallet',19)}<span>Connect a Solana wallet</span></button>
   <div class="lx-or"><span>or</span></div>
   <input class="lx-in" id="lxemail" type="email" autocomplete="email" placeholder="Email address" aria-label="Email address">
   <div class="err" id="lxerr"></div>
   <button class="lxb primary" id="lxgo" data-act="lemail">Continue</button>
   <p class="lx-terms">By continuing, you agree to our <button data-act="doc" data-f="terms">Terms of Service</button> and <button data-act="doc" data-f="privacy">Privacy Policy</button>.</p>
   <button class="lx-look" data-act="explore">Just looking? Explore Callit first</button>
  </div>
 </main>
 ${lxTicker(lxLive(1),' rev')}
 <footer class="lx-foot">${socials('sm')}<nav><button data-act="lexplore" data-f="about">About</button><span>·</span><button data-act="lexplore" data-f="callerboard">Callerboard</button><span>·</span><button data-act="doc" data-f="terms">Terms</button><span>·</span><button data-act="doc" data-f="privacy">Privacy</button><span>·</span><span>© ${yr} Callit</span></nav></footer>`}
/* Boot splash: covers the page until we know whether to show the landing or the app,
   so a reload or a return from Google/X never flashes the wrong screen. */
const BOOT_AT=Date.now(),BOOT_MAX=7000;
function authPending(){if(!realAuth())return false;if(Date.now()-BOOT_AT>BOOT_MAX)return false;
 const A=window.CallitAuth;if(!A||!A.ready)return true;
 if(A.authenticated&&!S.connected)return true;
 return /[?&]privy_oauth_/.test(location.search)&&!A.authenticated}
function hideBoot(){const b=$('#boot');if(!b||b.classList.contains('out'))return;b.classList.add('out');setTimeout(()=>b.remove(),300)}
setTimeout(()=>syncLanding(),BOOT_MAX+50);
function syncLanding(){const el=$('#landing');let exp=false;try{exp=sessionStorage.getItem('callit.explore')==='1'}catch(_){}
 if(authPending())return;
 const A=window.CallitAuth,restoring=realAuth()&&A&&A.ready&&A.authenticated&&!S.connected;
 const show=!S.connected&&!exp&&!restoring;if(show&&el.hidden){el.innerHTML=landingHTML();el.hidden=false}else if(!show&&!el.hidden){el.hidden=true;el.innerHTML=''}
 document.body.classList.toggle('lock',show);hideBoot()}
try{S.premium=JSON.parse(localStorage.getItem('callit.premium')||'null')}catch(_){}
if(!realAuth())try{const v=JSON.parse(localStorage.getItem('callit.session')||'null');if(v&&v.me){S.connected=true;S.addr=v.addr;S.me=v.me;C[S.me]=C[S.me]||{h:S.me,win:0,avg:0,calls:0,best:0,followers:0}}}catch(_){}

/* ---------- offline + install ---------- */
const syncNet=()=>{const o=$('#offline');if(o)o.hidden=navigator.onLine};addEventListener('online',()=>{syncNet();toast('Back online')});addEventListener('offline',syncNet);
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
/* install as an app (PWA) */
let deferredInstall=null;
const isStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const installDismissed=()=>{try{return localStorage.getItem('callit.installDismissed')==='1'}catch(_){return false}};
function showInstallBar(){if(isStandalone()||installDismissed()||$('#instbar'))return;const b=document.createElement('div');b.id='instbar';b.className='instbar';
 b.innerHTML=`<span class="mark"></span><div class="grow"><b>Install Callit</b><span class="hint">Add it to your home screen. Opens full-screen like an app.</span></div><button class="btn primary sm" data-act="install">Install</button><button class="ib" data-act="instclose" aria-label="Not now">${ic('x',16)}</button>`;
 document.body.appendChild(b);requestAnimationFrame(()=>b.classList.add('show'))}
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;if(S.connected)setTimeout(showInstallBar,1500)});
addEventListener('appinstalled',()=>{deferredInstall=null;const b=$('#instbar');b&&b.remove();toast('Callit installed')});
function installApp(){if(deferredInstall){deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;const b=$('#instbar');b&&b.remove()});return}
 if(isStandalone())return toast('Callit is already installed');
 modal('Install Callit','',isIOS()?`<div class="obsteps"><div class="obs"><span class="obi">${ic('share',20)}</span><div><b>1. Tap Share</b><span>The square with an arrow at the bottom of Safari.</span></div></div><div class="obs"><span class="obi">${ic('wallet',20)}</span><div><b>2. Add to Home Screen</b><span>Scroll the share menu and tap it.</span></div></div><div class="obs"><span class="obi">${ic('check',20)}</span><div><b>3. Open Callit</b><span>It opens full-screen from your home screen, like an app.</span></div></div></div>`
  :`<div class="obsteps"><div class="obs"><span class="obi">${ic('settings',20)}</span><div><b>1. Open your browser menu</b><span>The ⋮ button in Chrome, Edge or Brave.</span></div></div><div class="obs"><span class="obi">${ic('down',20)}</span><div><b>2. Tap Install app</b><span>Or Add to Home screen.</span></div></div><div class="obs"><span class="obi">${ic('check',20)}</span><div><b>3. Open Callit</b><span>It opens full-screen like an app.</span></div></div></div>`)}
if(isIOS()&&!isStandalone())setTimeout(()=>{if(S.connected)showInstallBar()},4000);

/* ---------- real sign-in (Privy) ---------- */
window.callitApplySession=(p,o={})=>{
 if(!p){if(S.connected){S.connected=false;S.addr='';S.me='';S.profile=null;toast('Signed out')}render();return}
 const first=!S.connected,prevAddr=S.addr;S.connected=true;S.profile=p;S.me=p.handle;S.addr=p.wallet_address||'';
 if(realAuth()&&S.addr!==prevAddr){S.bal={SOL:0};S.activity=[];S.balAt=0;for(const k in RAW)delete RAW[k];S.swap.amt=''}
 C[S.me]=C[S.me]||{h:S.me,win:0,avg:0,calls:0,best:0,followers:0};
 PROF={...PROF,name:p.display_name??PROF.name??'',bio:p.bio??PROF.bio??'',web:p.website??PROF.web??'',x:p.x_handle??PROF.x??'',avatar:p.avatar_url||PROF.avatar,banner:p.banner_url||PROF.banner};saveProf();
 // Only close the sign-in sheet. Session re-syncs (token refresh, embedded wallet arriving a moment
 // after load) used to close whatever was open, which is why the Buy sheet kept snapping shut.
 const om=document.querySelector('#modal .modal'),lab=om&&om.getAttribute('aria-label')||'';
 if(om&&/^(Sign in to Callit|Welcome back|Create your Callit account)$/.test(lab))closeModal();
 render();loadBalances();if(realAuth()){loadMe();loadPosts()}
 if(first){toast(o.isNew?'Welcome to Callit. Your wallet is ready':'Signed in');const n=pendingNext;pendingNext=null;if(n)n();else if(o.isNew)maybeOnboard()}};
window.callitAuthChanged=()=>syncLanding();
window.callitWalletChanged=()=>{if(REALW())loadBalances()};
if(window.__callitPendingSession){const q=window.__callitPendingSession;delete window.__callitPendingSession;window.callitApplySession(q.p,q.opts)}

/* ---------- events ---------- */
/* Moves a toggle's thumb to the tapped option before the screen redraws, so it visibly slides. */
function slideTo(b){const g=b.closest('.tgl');if(!g||matchMedia('(prefers-reduced-motion:reduce)').matches)return false;const i=[...g.children].indexOf(b);g.style.setProperty('--i',i);
 g.classList.toggle('perps-on',b.dataset.f==='perps'||b.dataset.ck==='perps');g.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));return true}
const act2={disconnect:()=>{if(realAuth()){try{sessionStorage.removeItem('callit.explore')}catch(_){}window.CallitAuth&&window.CallitAuth.logout();return}S.connected=false;try{localStorage.removeItem('callit.session');sessionStorage.removeItem('callit.explore')}catch(_){}toast('Signed out');render()}};
/* Swap+Stake live in DeFi, Wallet+your own Profile live in You, Leaderboard is now Callerboard. Old links still land in the right place. */
function canonRoute(r,p){if(r==='swap'||r==='stake')return 'defi';if(r==='wallet')return 'you';
 if(r==='profile'&&(!p||p===S.me))return 'you';if(r==='leaderboard')return 'callerboard';return r}
/* The first render of a new link picks the tab it points at; after that the toggles own it. */
function routeTabs(r,p){const h=location.hash;if(S.tabHash===h)return;S.tabHash=h;
 if(r==='swap'||r==='stake'||r==='defi')S.dtab=r==='stake'?'stake':'swap';else if(r==='wallet')S.ytab='wallet';else if(r==='profile'&&(!p||p===S.me))S.ytab='profile'}
const currentRoute=()=>{const [,r='home',p]=location.hash.split('/');return canonRoute(r||'home',p)};
document.addEventListener('click',e=>{
 const nl=e.target.closest('.nav a');if(nl&&nl.getAttribute('href')===('#/'+currentRoute())&&!location.hash.split('/')[2]){e.preventDefault();scrollTo({top:0,behavior:'smooth'});return}
 const row=e.target.closest('[data-go]');if(row&&!e.target.closest('button,a,input,textarea,label,.media')){location.hash=row.dataset.go;return}
 const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
 if(b.tagName==='BUTTON'&&b.closest('a'))e.preventDefault();
 if(a==='close'){if(e.target.closest('.wstar')){const w=e.target.closest('.wstar');e.preventDefault();const t=w.dataset.t,on=!S.watch.has(t);on?S.watch.add(t):S.watch.delete(t);bg('/api/social',{action:'watch',key:t,on});w.classList.toggle('on',on);w.innerHTML=ic('star',17,on);toast(on?`$${symOf(t)} added to your watchlist`:`$${symOf(t)} removed from your watchlist`);return}
  if(e.target===b||b.tagName!=='DIV'){closeModal()}return}
 const act={
  rmt:()=>{S.rmt=b.dataset.f;drawRail()},rmgo:()=>{S.mt='trenches';S.tt=b.dataset.f},
  ubell:()=>ubellModal(b.dataset.h),pushon:()=>pushOn(),pushoff:()=>pushOff(),bell:()=>bellModal(b.dataset.t),
  aladd:()=>{const a=$('#alw'),l=$('#all');const v=(a.value||'').trim();if(!isMintStr(v))return toast('Paste a valid Solana wallet address');b.disabled=true;
   API('/api/alerts/wallets',{body:{address:v,label:l.value}}).then(j=>{toast(j.live?'Tracking. You’ll get a pop-up on every swap':'Saved. Live tracking starts once Helius is set up');if(pushState()==='off')setTimeout(()=>pushOn(),400);AL.d=null;alLoad(1)}).catch(e=>toast(e.message)).finally(()=>{b.disabled=false})},
  aldel:()=>(closeModal(),API('/api/alerts/wallets?address='+encodeURIComponent(b.dataset.f),{method:'DELETE'}).then(()=>{AL.d=null;alLoad(1)}).catch(e=>toast(e.message))),
  belldel:()=>API('/api/alerts/bell?mint='+encodeURIComponent(b.dataset.f),{method:'DELETE'}).then(()=>{BELLS.delete(b.dataset.f);AL.d=null;alLoad(1)}).catch(e=>toast(e.message)),
  wtab:()=>{S.wtab=b.dataset.f;render()},wbopen:()=>walletSheet(b.dataset.f),
  lbv:()=>{S.lbv=b.dataset.f;render();scrollTo({top:0})},
  ltab:()=>{S.ltab=b.dataset.f;try{localStorage.setItem('callit.ltab',S.ltab)}catch(_){}document.querySelectorAll('.ltabs [data-act="ltab"]').forEach(x=>{const on=x.dataset.f===S.ltab;x.classList.toggle('on',on);x.setAttribute('aria-selected',on)});document.querySelectorAll('.lpanel').forEach(p=>p.hidden=p.dataset.lp!==S.ltab);const [,,p]=location.hash.split('/');if(S.ltab==='holders'&&T[p]){const el=$('#lholders');if(el)el.innerHTML=holdersPanel(T[p])}},
  htrack:()=>{if(!S.connected)return connectModal();const a=b.dataset.f;API('/api/alerts/wallets',{body:{address:a,label:''}}).then(j=>{toast(j.live?'Tracking. You’ll get a pop-up on every swap':'Wallet saved to your tracker');AL.d=null}).catch(e=>toast(e.message))},
  ord:()=>{const k=tokPath(b.dataset.k);closeModal();setTimeout(()=>orderModal(k,b.dataset.f||'tpsl'),60)},
  ordcancel:()=>{const id=b.dataset.f;realTx('Cancel order',step=>cancelOrder(S.addr,id,step),ok=>{if(ok){toast('Order cancelled. Funds are back in your wallet');ORD.list=(ORD.list||[]).filter(o=>o.id!==id);loadOrders(1)}})},
  pidx:()=>{S.pidx=+b.dataset.f;const [,,p]=location.hash.split('/'),el=$('#lpair');if(el&&T[p])el.innerHTML=pairCard(T[p])},ptf:()=>{S.ptf=b.dataset.f;const [,,p]=location.hash.split('/'),el=$('#lpair');if(el&&T[p])el.innerHTML=pairCard(T[p])},
  tagpost:()=>{const tg=b.dataset.f;composeModal(S.cat==='perps'?'meme':S.cat);setTimeout(()=>{const ta=$('#modal textarea');if(!ta)return;ta.value=(ta.value?ta.value.trimEnd()+' ':'')+'#'+tg+' ';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()},80)},
  newcall:()=>composeModal(b.dataset.t?'meme':(b.dataset.k||(currentRoute()==='home'?S.cat:'meme')),{pre:b.dataset.t}),
  navgrp:()=>{const g=b.dataset.f;NAVC[g]=!NAVC[g];try{localStorage.setItem('callit.navc',JSON.stringify(NAVC))}catch(_){}chrome(currentRoute())},
  install:()=>installApp(),instclose:()=>{try{localStorage.setItem('callit.installDismissed','1')}catch(_){}const x=$('#instbar');x&&x.remove()},
  dmsend:()=>{const i=$('#msgin'),v=i&&i.value.trim();if(!v)return;DMS[b.dataset.f].push(['me',v,'now']);render();const m=$('#msgs');m&&m.lastElementChild&&m.lastElementChild.scrollIntoView({block:'end'});setTimeout(()=>{const n=$('#msgin');n&&n.focus()},50)},
  dmnew:()=>{if(!S.connected)return connectModal();modal('New message','Pick a caller',`<div class="list">${ranked().map(c=>`<a class="li" href="#/messages/${c.h}" data-act="close">${avatar(c.h)}<div class="grow"><b>${c.h}</b><div class="hint">${c.win}% win rate</div></div></a>`).join('')}</div>`)},
  dm:()=>{location.hash='#/messages/'+b.dataset.h},
  nread:()=>{const n=NOTIFS.find(x=>x.id==b.dataset.f);if(n){if(n.real&&n.unread&&window.CallitAuth&&window.CallitAuth.markRead)window.CallitAuth.markRead([n.id]);n.unread=0}closeModal();chrome(currentRoute())},
  nall:()=>{if(NOTIFS.some(n=>n.real&&n.unread)&&window.CallitAuth&&window.CallitAuth.markRead)window.CallitAuth.markRead('all');NOTIFS.forEach(n=>n.unread=0);toast('All caught up');render()},nt:()=>{S.nt=b.dataset.f;render()},
  gopremium:()=>{location.hash='#/premium'},plan:()=>{S.plan=b.dataset.f;render()},payvia:()=>{S.payvia=b.dataset.f;render()},
  notify:()=>{const f=b.dataset.f;if(!S.connected)return connectModal();S.notifyOn=S.notifyOn||{};S.notifyOn[f]=1;if(f==='stake')S.stakeWait=true;try{localStorage.setItem('callit.notify',JSON.stringify(S.notifyOn))}catch(_){}toast(`We'll let you know when ${SOONF[f]||'it'} opens`);render()},
  astsend:()=>astSend(($('#astin')||{}).value),
  astnew:()=>{AST.msgs=[];AST.err='';render()},
  aststart:()=>{const q=AST_START[+b.dataset.i];if(+b.dataset.i===0){const i=$('#astin');if(i){i.value='CA: ';i.focus()}}else astSend(q)},
  stakewait:()=>{if(!S.connected)return connectModal();S.stakeWait=true;toast('We\'ll let you know when $CALLIT staking opens');render()},
  buyprem:()=>{if(!S.connected)return connectModal(()=>{location.hash='#/premium'});if(REALW())return toast('Premium payments open soon. Nothing was charged');const P=PLANS[S.plan||'yearly'],via=S.payvia||'SOL',amt=via==='SOL'?P.usd/T.SOL.price:P.usd;
   if((S.bal[via]||0)<amt)return toast(`Not enough ${via}. You need ${via==='SOL'?amt.toFixed(3):amt} ${via}`);
   modal('Confirm upgrade','',`<div class="list"><div class="li"><span class="grow">Plan</span><b>${P.label}</b></div><div class="li"><span class="grow">You pay</span><b class="num">${via==='SOL'?amt.toFixed(3):amt} ${via}</b></div><div class="li"><span class="grow">Renews</span><b>${new Date(Date.now()+P.days*864e5).toLocaleDateString()}</b></div></div><button class="btn primary block" id="pgo" style="margin-top:14px">Confirm and pay</button>`,
    m=>$('#pgo',m).onclick=()=>{closeModal();txRun(`Callit Premium · ${P.label}`,()=>{S.bal[via]-=amt;const base=isPrem(S.me)?S.premium.until:Date.now();S.premium={plan:S.plan||'yearly',until:base+P.days*864e5};try{localStorage.setItem('callit.premium',JSON.stringify(S.premium))}catch(_){}
     S.activity.unshift({k:'Sent',d:`${via==='SOL'?amt.toFixed(3):amt} ${via} for Callit Premium`,t:'Just now'});render();toast('Welcome to Premium ✓')})})},
  nf:()=>{S.nf=b.dataset.f;render()},newsx:()=>{location.hash='#/news'},
  ntab:()=>{S.ntab=b.dataset.f;render()},
  exportkey:()=>exportKeyModal(),
  bubpick:()=>{const i=+b.dataset.i;BUBX.sel=BUBX.sel===i?-1:i;const w=$('#bubwrap');if(w&&BUBT)w.innerHTML=bubbles(BUBT)},bubpool:()=>{BUBX.pool=!BUBX.pool;BUBX.sel=-1;const w=$('#bubwrap');if(w&&BUBT)w.innerHTML=bubbles(BUBT)},
  setzoom:()=>{try{localStorage.setItem('callit.zoom',b.dataset.f)}catch(_){}zoomApply();closeModal();settingsModal()},
  bpdel:()=>{const k=b.dataset.f;bpSet(bpGet().filter(x=>x!==k));BPMENU=null;drawRail();toast(`${BP[k][0]} removed. Bring panels back in Settings`)},
  bpmenu:()=>{BPMENU=BPMENU===b.dataset.f?null:b.dataset.f;drawRail()},
  bppick:()=>{const from=b.dataset.f,to=b.dataset.to,v=bpGet(),i=v.indexOf(from),j=v.indexOf(to);if(i<0||from===to){BPMENU=null;return drawRail()}
   if(j>=0){v[j]=from}v[i]=to;const w=bpW[from];if(w!=null){bpW[to]=w;delete bpW[from];bpWSave()}bpSet(v);BPMENU=null;drawRail()},
  bpreset:()=>{bpSet(BP_DEF.slice());Object.keys(bpW).forEach(k=>delete bpW[k]);bpWSave();bpApplyFeed();closeModal();drawRail();toast('Panels reset')},
  pushtest:()=>pushTest(b),
  bubtog:()=>{const c=b.closest('.hmcard'),o=!c.classList.contains('open');c.classList.toggle('open',o);b.setAttribute('aria-expanded',o);const bd=c.querySelector('.hmbody');bd.hidden=!o;try{localStorage.setItem('callit.bubopen',o?'1':'0')}catch(_){}if(o){const w=c.querySelector('#bubwrap');if(w&&BUBT)w.innerHTML=bubbles(BUBT)}},
  ncat:()=>{const f=b.dataset.f;if(f==='*'){lsPut('callit.ncat',null);return render()}const cur=lsSet('callit.ncat')||new Set();cur.has(f)?cur.delete(f):cur.add(f);lsPut('callit.ncat',cur.size===NCATS.length?null:cur);render()},
  cimp:()=>{S.cimp=b.dataset.f;try{localStorage.setItem('callit.cimp',S.cimp)}catch(_){}render()},
  ccur:()=>{const f=b.dataset.f;if(f==='*'){lsPut('callit.ccur',null);return render()}const all=[...new Set(((NEWS.calendar.d&&NEWS.calendar.d.events)||[]).map(e=>e.country))];const cur=lsSet('callit.ccur')||new Set(all);cur.has(f)?cur.delete(f):cur.add(f);lsPut('callit.ccur',cur.size===all.length||!cur.size?null:cur);render()},
  nsrc:()=>{const f=b.dataset.f;if(f==='*'){nsrcSet(null);return render()}const all=['callit','x','reddit','youtube','bluesky','hackernews','coingecko','google'];const cur=nsrcGet()||new Set(all);cur.has(f)?cur.delete(f):cur.add(f);nsrcSet(cur.size===all.length||!cur.size?null:cur);render()},stscroll:()=>{const t=$('#'+b.dataset.f);t&&t.scrollBy({left:+b.dataset.d*t.clientWidth*.8,behavior:'smooth'})},
  lsign:()=>signIn(b.dataset.f),lwallet:()=>realAuth()?realLogin('wallet',undefined,null):connectModal(null,'in'),
  lemail:()=>{const v=($('#lxemail')||{}).value||'';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())){$('#lxerr').textContent='Enter a valid email address.';$('#lxemail').focus();return}signIn('Email',null,{email:v.trim()})},
  lexplore:()=>{try{sessionStorage.setItem('callit.explore','1')}catch(_){}location.hash='#/'+b.dataset.f;syncLanding()},
  doc:()=>docModal(b.dataset.f),soclink:()=>{e.preventDefault();toast(`Callit on ${b.dataset.f} is coming soon`)},editprof:()=>editProfile(b.dataset.f),follows:()=>followsModal(b.dataset.h,b.dataset.f),dtab:()=>{if(S.dtab===b.dataset.f)return;if(slideTo(b)&&!b.dataset.slid){b.dataset.slid=1;return setTimeout(()=>b.isConnected?b.click():null,170)}S.dtab=b.dataset.f;render()},
  ytab:()=>{if(S.ytab===b.dataset.f)return;if(slideTo(b)&&!b.dataset.slid){b.dataset.slid=1;return setTimeout(()=>b.isConnected?b.click():null,170)}S.ytab=b.dataset.f;try{localStorage.setItem('callit.ytab',S.ytab)}catch(_){}render()},
  mt:()=>{if(S.mt===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});if(slideTo(b)&&!b.dataset.slid){b.dataset.slid=1;return setTimeout(()=>b.isConnected?b.click():null,170)}S.mt=b.dataset.f;render()},tpick:()=>pickToken(b.dataset.f),
  signup:()=>connectModal(null,'up'),signin:()=>connectModal(null,'in'),explore:()=>{try{sessionStorage.setItem('callit.explore','1')}catch(_){}syncLanding()},qbuy:()=>quickBuy(b.dataset.t,b.dataset.id),qsell:()=>quickBuy(b.dataset.t,b.dataset.id,'sell'),
  back:()=>goBack(),totop:()=>scrollTo({top:0,behavior:'smooth'}),
  join:()=>{const f=b.dataset.f;S.joined.has(f)?S.joined.delete(f):S.joined.add(f);toast(S.joined.has(f)?'Joined':'Left the community');render()},
  msend:()=>{const i=$('#msgin'),v=i&&i.value.trim();if(!v)return;(MSG[b.dataset.f]=MSG[b.dataset.f]||[]).push([S.me,v,'now']);render();const m=$('#msgs');m&&m.lastElementChild&&m.lastElementChild.scrollIntoView({block:'end',behavior:'smooth'});setTimeout(()=>{const n=$('#msgin');n&&n.focus()},50)},
  ptab:()=>{S.ptab=b.dataset.f;render()},connect:()=>connectModal(),search:()=>searchModal(),notifs:()=>notifsModal(),settings:()=>settingsModal(),
  disconnect:()=>act2.disconnect(),
  me:()=>S.connected?location.hash='#/you':connectModal(),
  logout:()=>modal('Log out of Callit?','Your wallet and everything you saved stay on your account. Sign back in any time.',`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="logo">Log out</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,m=>$('#logo',m).onclick=()=>{closeModal();act2.disconnect()}),
  bmark:()=>{if(!S.connected)return connectModal();const id=b.dataset.id,on=!S.bm.has(id);on?S.bm.add(id):S.bm.delete(id);saveBm();bg('/api/social',{action:'bookmark',ref:id,on});
   document.querySelectorAll(`[data-act="bmark"][data-id="${CSS.escape(id)}"]`).forEach(x=>{x.classList.toggle('on',on);x.setAttribute('aria-pressed',on);x.innerHTML=ic('bookmark',x.closest('.fbar')?20:18,on)});
   toast(on?'Saved to Bookmarks':'Removed from Bookmarks');if(currentRoute()==='bookmarks')render()},
  bmclear:()=>modal('Clear all bookmarks?','This removes every saved post. It can’t be undone.',`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="bmgo">Clear all</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,m=>$('#bmgo',m).onclick=()=>{[...S.bm].forEach(ref=>bg('/api/social',{action:'bookmark',ref,on:false}));S.bm.clear();saveBm();closeModal();toast('Bookmarks cleared');render()}),
  nosell:()=>toast(`You don’t hold any $${symOf(b.dataset.t)} yet`),
  viewav:()=>viewPhoto(b.dataset.h),
  collapse:()=>{document.body.classList.toggle('collapsed');syncTray()},
  tt:()=>{if(S.tt===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});S.tt=b.dataset.f;render();scrollTo({top:0})},
  fsopen:()=>openSheet('f',b.dataset.tab),dsopen:()=>openSheet('d'),shclose:()=>closeSheet(),
  fstab:()=>{SH.tab=b.dataset.v;drawSheet()},
  fschip:()=>{const a=SH.d[b.dataset.g],v=b.dataset.v,i=a.indexOf(v);i<0?a.push(v):a.splice(i,1);drawSheet()},
  fslpall:()=>{SH.d.lps=SH.d.lps.length===LPS.length?[]:LPS.map(l=>l[0]);drawSheet()},
  fsage:()=>{SH.d.ageMax=+b.dataset.v;drawSheet()},
  fstf:()=>{SH.d.tf=b.dataset.v;drawSheet()},
  ttf:()=>{TS.fil[S.tt]={...filOf(S.tt),tf:b.dataset.f};saveTS();render()},
  fsrisk:()=>{Object.assign(SH.d,RISK[b.dataset.v][2]);drawSheet()},
  fsai:()=>{SH.d.ai=b.dataset.v;drawSheet()},
  aiq:()=>{const k=S.tt,cur=filOf(k);TS.fil[k]={...(TS.fil[k]||{}),ai:cur.ai?'':(TS.aiLast||'balanced')};if(cur.ai)TS.aiLast=cur.ai;saveTS();render()},
  fsflag:()=>{const k=b.dataset.v;SH.d[k]=SH.d[k]?0:1;drawSheet()},
  fsclear:()=>{SH.d=defFil();drawSheet()},
  fsapply:()=>{TS.fil[S.tt]=SH.d;if(SH.d.ai)TS.aiLast=SH.d.ai;saveTS();closeSheet();render()},
  fsclear1:()=>{delete TS.fil[S.tt];saveTS();render()},
  dsopt:()=>{const k=b.dataset.v;TS.disp[k]=TS.disp[k]?0:1;saveTS();drawSheet();render()},
  dsfeed:()=>{const f=TS.feeds.find(x=>x[0]===b.dataset.v);if(f[1]&&TS.feeds.filter(x=>x[1]).length===1)return toast('Keep at least one feed on');f[1]=f[1]?0:1;
   const onL=TS.feeds.filter(x=>x[1]),offL=TS.feeds.filter(x=>!x[1]);TS.feeds=[...onL,...offL];saveTS();drawSheet();render()},
  dsmove:()=>{const i=TS.feeds.findIndex(x=>x[0]===b.dataset.v),j=i+ +b.dataset.d;if(j<0||j>=TS.feeds.length||!TS.feeds[j][1])return;[TS.feeds[i],TS.feeds[j]]=[TS.feeds[j],TS.feeds[i]];saveTS();drawSheet();render()},
  dsreset:()=>{TS.disp=defDisp();TS.feeds=defFeeds();saveTS();drawSheet();render()},
  adclick:()=>{const a=ADS.find(x=>x.id===b.dataset.id);if(a.href)location.hash=a.href;else toast(`Opens ${a.brand} in a new tab once ads go live`)},
  adgo:()=>{S.board=+b.dataset.f;const el=$('#adboard');if(el)el.outerHTML=adBoard()},
  tab:()=>{if(S.tab===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});S.tab=b.dataset.f;render();scrollTo({top:0})},tf:()=>{S.tf=b.dataset.f;render()},lb:()=>{S.lb=b.dataset.f;render()},
  pkg:()=>{S.pkg=b.dataset.f;document.querySelectorAll('.pkg').forEach(p=>p.classList.toggle('on',p===b))},
  like:()=>{if(!S.connected)return connectModal();const k=calls.find(x=>x.id==b.dataset.id);k.liked=!k.liked;bg('/api/posts/react',{ref:String(k.id),kind:'like',on:k.liked});k.likes+=k.liked?1:-1;b.classList.toggle('liked',k.liked);b.innerHTML=ic('heart',18,k.liked)+`<span class="num">${k.likes||''}</span>`},
  repost:()=>{if(Date.now()-(b._heldAt||0)<1500)return;if(!S.connected)return connectModal();doRepost(b.dataset.id)},
  rpv:()=>{closeModal();location.hash='#/quotes/'+encodeURIComponent(b.dataset.id)},
  rpq:()=>{const id=b.dataset.id;closeModal();setTimeout(()=>randomModal({quote:id}),60)},
  rpdo:()=>{closeModal();doRepost(b.dataset.id)},
  reply:()=>{const a=b.closest('[data-go]');if(a&&a.dataset.go.startsWith('#/post/')){S.focusReply=true;location.hash=a.dataset.go}else{const i=$('#rin');i&&i.focus()}},
  rsend:()=>sendReply(b.dataset.id),
  rlike:()=>{if(!S.connected)return connectModal();const x=REPLIES[b.dataset.p][+b.dataset.i];x.liked=!x.liked;x.likes+=x.liked?1:-1;b.classList.toggle('liked',x.liked);b.innerHTML=`${ic('heart',17,x.liked)}<span class="num">${x.likes||''}</span>`},
  rrt:()=>{if(!S.connected)return connectModal();const x=REPLIES[b.dataset.p][+b.dataset.i];x.rted=!x.rted;x.rts+=x.rted?1:-1;b.classList.toggle('reposted',x.rted);b.querySelector('.num').textContent=x.rts||'';toast(x.rted?'Reposted':'Repost removed')},
  rrep:()=>{if(!S.connected)return connectModal();const i=$('#rin');if(!i)return;const tag='@'+b.dataset.h+' ';if(!i.value.startsWith(tag))i.value=tag+i.value;i.focus();i.setSelectionRange(i.value.length,i.value.length);i.dispatchEvent(new Event('input'));$('#rbox').scrollIntoView({block:'center',behavior:'smooth'})},
  share:()=>shareSheet(b.dataset.id),
  cat:()=>{if(S.cat===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});if(slideTo(b)&&!b.dataset.slid){b.dataset.slid=1;return setTimeout(()=>b.isConnected?b.click():null,170)}S.cat=b.dataset.f;try{localStorage.setItem('callit.cat',S.cat)}catch(_){}if(S.cat==='perps')loadPerps();render();scrollTo({top:0})},
  pmenu:()=>{const k=calls.find(x=>String(x.id)===String(b.dataset.id));if(k)moreSheet(k.c,k)},
  profmenu:()=>moreSheet(b.dataset.h),
  xsearch:()=>xSearchSheet(b.dataset.k),
  xgo:()=>{window.open('https://x.com/search?q='+encodeURIComponent(b.dataset.v)+'&f=live','_blank','noopener');closeModal()},
  hmenu:()=>holdSheet(b.dataset.k),
  hshare:()=>{const k=b.dataset.k;closeModal();shareModal(holdCard(k),location.href.split('#')[0]+'#/token/'+encodeURIComponent(k),'callit-pnl-'+symOf(k),`My $${symOf(k)} position on Callit`)},
  hgo:()=>{const k=b.dataset.k,f=b.dataset.f;closeModal();if(f!=='view'){S.ltab='swap';const w=S.swap;if(f==='sell'){w.from=k;w.to='SOL'}else{w.from='SOL';w.to=k}w.amt=''}location.hash='#/token/'+tokPath(k)},
  shprof:()=>{closeModal();shareProfile(b.dataset.h)},
  cplink:()=>{closeModal();copy(postURL(b.dataset.id),'Link copied')},
  addlist:()=>listsModal(b.dataset.h),
  mute:()=>{if(!S.connected)return connectModal();const h=b.dataset.h,on=!S.muted.has(h);toggleRel('mute',h,on);closeModal();toast(on?`Muted @${h}. You won’t see their posts`:`Unmuted @${h}`);render()},
  block:()=>{if(!S.connected)return connectModal();const h=b.dataset.h;if(S.blocked.has(h)){toggleRel('block',h,false);closeModal();toast(`Unblocked @${h}`);return render()}
   modal(`Block @${h}?`,'They’ll be hidden from your feeds, search and replies, and you’ll unfollow them. They won’t be notified.',`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="blgo">Block @${esc(h)}</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,
    m=>$('#blgo',m).onclick=()=>{toggleRel('block',h,true);closeModal();toast(`Blocked @${h}`);render()})},
  delpost:()=>{const id=b.dataset.id;modal('Delete post?','It’s removed from your profile and every feed.',`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="dlgo">Delete</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,
    m=>$('#dlgo',m).onclick=()=>{API('/api/posts?id='+encodeURIComponent(id),{method:'DELETE'}).then(()=>{calls=calls.filter(x=>String(x.id)!==String(id));closeModal();toast('Post deleted');if(currentRoute()==='post')location.hash='#/home';else render()}).catch(e=>toast(e.message))})},
  copy:()=>{copy(b.dataset.v,b.dataset.m||'Address copied');if(b.closest('#modal')&&!b.dataset.busy){const o=b.innerHTML;b.dataset.busy=1;b.classList.add('done');b.innerHTML=`${ic('check',15)} Copied`;setTimeout(()=>{if(b.isConnected){b.innerHTML=o;b.classList.remove('done')}delete b.dataset.busy},1600)}},
  follow:()=>{if(!S.connected)return connectModal();const h=b.dataset.h,on=!S.following.has(h);if(!on)UB[h]=null;else if(pushState()!=='denied')setTimeout(()=>{if(S.following.has(h)&&!UB[h])toast(`Tap 🔔 on @${h}’s profile to get their calls as pop-ups`)},600);toggleRel('follow',h,on);if(PUB[h]&&!PUB[h].pending)PUB[h].followers=Math.max(0,(PUB[h].followers||0)+(on?1:-1));delete FL['followers:'+h];delete FL['following:'+S.me];render()},
  ranks:()=>ranksModal(b.dataset.h),
  track:()=>{if(!S.connected&&realAuth())return connectModal();const t=b.dataset.t,on=!S.watch.has(t);on?S.watch.add(t):S.watch.delete(t);bg('/api/social',{action:'watch',key:t,on});
   toast(on?`$${symOf(t)} added to your watchlist`:`$${symOf(t)} removed from your watchlist`);
   if(b.closest('#modal')||b.closest('.pbar')||b.closest('.trow')){document.querySelectorAll(`[data-act="track"][data-t="${CSS.escape(t)}"]`).forEach(x=>{if(x.classList.contains('wrm'))return;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on);const sv=x.querySelector('svg');if(sv)sv.setAttribute('fill',on?'currentColor':'none')});return}
   render()},
  withdraw:()=>withdrawModal(),send:()=>withdrawModal(),receive:()=>depositModal(),deposit:()=>depositModal(),
  ltf:()=>{S.ltf=b.dataset.f;S.ltfUser=1;render()},lsrc:()=>{S.lsrc=S.lsrc==='callit'?'dex':'callit';try{localStorage.setItem('callit.lsrc',S.lsrc)}catch(_){}render()},lmode:()=>{S.lmode=b.dataset.f;render()},lretry:()=>{(lfIds(S.tt,filOf(S.tt))||[]).forEach(id=>{LIVE.err[id]=0;loadFeed(id)});render()},ltokretry:()=>{LIVE.tokErr[b.dataset.t]=0;render()},
  tside:()=>{const w=S.swap,t=b.dataset.t;if(b.dataset.f==='sell'){w.from=t;w.to='SOL'}else{w.from='SOL';w.to=t}w.amt='';renderSwaps()},
  flip:()=>{const w=S.swap;[w.from,w.to]=[w.to,w.from];w.amt='';renderSwaps()},
  doswap:()=>{const w=S.swap,x=parseFloat(w.amt),out=usd(w.from,x)*.995/T[w.to].price,imp=impact(w.to,usd(w.from,x));
   const go=()=>{const f=w.from,t=w.to;w.amt='';renderSwaps();if(REALW())return realSwap(f,t,x,f==='SOL'?`Buy $${symOf(t)} with ${fmtAmt(x)} SOL`:t==='SOL'?`Sell ${fmtAmt(x)} $${symOf(f)}`:`Swap ${fmtAmt(x)} ${symOf(f)} → ${symOf(t)}`);txRun(`Swap ${fmtAmt(x)} ${symOf(f)} → ${fmtAmt(out)} ${symOf(t)}`,()=>{S.bal[f]-=x;S.bal[t]=(S.bal[t]||0)+out;S.activity.unshift({k:'Swapped',d:`${fmtAmt(x)} ${symOf(f)} for ${fmtAmt(out)} ${symOf(t)}`,t:'Just now'});render()})};
   if(imp>15)return modal('High price impact',`This swap moves the price about ${imp.toFixed(1)}%. You may get much less than shown.`,`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="impgo">Swap anyway</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,m=>$('#impgo',m).onclick=()=>{closeModal();go()});
   go()},
  swmax:()=>{const w=S.swap,f=+b.dataset.f;w.amt=f===1?maxOf(w.from):String(+(+maxOf(w.from)*f).toFixed(6));renderSwaps();if(f===1&&w.from==='SOL')toast(`Kept ${FEE_RESERVE} SOL for network fees`)},
  slip:()=>{S.slip=+b.dataset.f;SWS.slip=S.slip;saveSWS();renderSwaps()},swapset:()=>swapSettings(),heatf:()=>{HEATF.k=HEATF.k===b.dataset.f?'':b.dataset.f;saveHeat();render()},heatdz:()=>{HEATF.hide=!HEATF.hide;saveHeat();render()},admtab:()=>{ADM.tab=b.dataset.f;if(b.dataset.f==='payouts')loadPayouts(1);if(b.dataset.f==='telegram')loadTgAdmin(1);render()},
  claim:()=>doClaim(),earnopen:()=>{EARN.open=!EARN.open;render()},tglink:()=>{tgLink()},tgunlink:()=>{API('/api/telegram/link',{method:'DELETE'}).then(()=>{TGL.d=null;loadTg();toast('Telegram unlinked')}).catch(e=>toast(e.message))},
  paypause:()=>{API('/api/admin/payouts',{body:{action:b.dataset.f}}).then(()=>{toast(b.dataset.f==='pause'?'Claims paused':'Claims resumed');loadPayouts(1)}).catch(e=>toast(e.message))},
  tgconnect:()=>{API('/api/admin/telegram',{body:{action:'connect'}}).then(()=>{toast('Bot connected');loadTgAdmin(1)}).catch(e=>toast(e.message))},
  tggroup:()=>{API('/api/admin/telegram',{body:{action:'group',chat_id:b.dataset.f,enabled:b.dataset.on==='1'}}).then(()=>loadTgAdmin(1)).catch(e=>toast(e.message))},rdwin:()=>{ADM.rwin=b.dataset.f;render()},none:()=>{},
  swunit:()=>{const w=S.swap,p=(T[w.from]||{}).price;S.swUsd=!S.swUsd;w.usdTxt=w.amt&&p?String(+(+w.amt*p).toFixed(2)):'';w._ua=w.amt;renderSwaps();const i=document.querySelector('[data-swap="amt"]');if(i&&!isPhone())i.focus()},
  shownew:()=>{calls.forEach(k=>k.fresh=false);S.queued.forEach(k=>k.fresh=true);calls=[...S.queued,...calls];S.queued=[];render();scrollTo({top:0})},
  submitpromo:()=>{const n=$('#pn').value.trim(),l=$('#pl').value.trim(),p=$('#pp').value.trim();
   if(!n||!l||p.length<20)return $('#perr').textContent='Add a project name, a CA or website, and at least 20 characters about the project.';
   if(!S.connected)return connectModal();toast('Promotion request sent');location.hash='#/home'},
  theme:()=>{const r=document.documentElement,d=r.dataset.theme&&r.dataset.theme!=='system'?r.dataset.theme:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');r.dataset.theme=d==='dark'?'light':'dark'},
  settheme:()=>{const f=b.dataset.f;if(f==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=f;settingsModal()},
  setside:()=>{document.body.classList.toggle('collapsed',b.dataset.f==='closed');syncTray();settingsModal()}
 }[a];act&&act()});
document.addEventListener('input',e=>{if(e.target.dataset.swap!=='amt')return;{const v=e.target.value.replace(/[^0-9.]/g,''),w=S.swap;if(S.swUsd){const p=(T[w.from]||{}).price;w.usdTxt=v;w.amt=p&&+v?String(+(+v/p).toPrecision(9)):'';w._ua=w.amt}else w.amt=v}
 const all=[...document.querySelectorAll('[data-swap="amt"]')],idx=all.indexOf(e.target),pos=e.target.selectionStart;renderSwaps();
 const i=document.querySelectorAll('[data-swap="amt"]')[idx];if(i){i.focus();try{i.setSelectionRange(pos,pos)}catch(_){}}});
document.addEventListener('change',e=>{const k=e.target.dataset.swap;if(k!=='from'&&k!=='to')return;const w=S.swap,v=e.target.value,o=k==='from'?'to':'from';if(w[o]===v)w[o]=w[k];w[k]=v;renderSwaps()});
document.addEventListener('input',e=>{const k=e.target.dataset.fk;if(!k||!SH||SH.kind!=='f')return;
 let v=e.target.value;if(e.target.type==='range'){v=+v;e.target.style.setProperty('--v',v+'%');const o=$(`[data-out="${k}"]`);if(o)o.textContent=v>=100?'Any':'≤ '+v+'%';
  document.querySelectorAll('.rcard').forEach(c=>c.classList.remove('on'))}
 SH.d[k]=v;const n=fsCount(),g=$('#fsgo');if(g){g.disabled=n<=0;g.textContent=fsBtn(n)}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('article.post[data-go]')){location.hash=e.target.dataset.go;return}if(e.key==='Enter'&&e.target.id==='lxemail'){e.preventDefault();$('#lxgo').click();return}if(e.key==='Enter'&&e.target.id==='msgin'){e.preventDefault();const s=$('[data-act="msend"]')||$('[data-act="dmsend"]');s&&s.click();return}if(e.key==='Escape'){closeModal();closeSheet();if(isPhone()){document.body.classList.add('collapsed');syncTray()}}});

/* live price ticks: patch numbers in place, flash green/red when a value moves */
const flashSet=(el,txt,dir)=>{if(el.textContent===txt)return;el.textContent=txt;if(!dir)return;el.classList.remove('fl-up','fl-dn');void el.offsetWidth;el.classList.add(dir>0?'fl-up':'fl-dn')};
setInterval(()=>{const r=rng(Date.now()%1e6);Object.values(T).forEach(t=>{if(!t.base&&!t.prelaunch&&!t.live)t.price*=1+(r()-.48)*.012});
 calls.forEach(k=>{const n=nums(k);if(!n)return;const q=a=>document.querySelector(`[data-${a}="${k.id}"]`),dir=k._mc?Math.sign(n.mc-k._mc):0;k._mc=n.mc;
  let el=q('perf');if(el){flashSet(el,fmtPct(n.p),dir);el.classList.toggle('up',n.up);el.classList.toggle('down',!n.up)}
  el=q('pos');if(el)flashSet(el,fmtUsd(n.pos),dir);
  el=q('pnl');if(el){flashSet(el,money(n.pnl),dir);el.classList.toggle('up',n.pnl>=0);el.classList.toggle('down',n.pnl<0)}
  el=q('mc');if(el){const h=`${fmtUsd(n.mc)}<small>MC</small>`;if(el.innerHTML!==h){el.innerHTML=h;if(dir){el.classList.remove('fl-up','fl-dn');void el.offsetWidth;el.classList.add(dir>0?'fl-up':'fl-dn')}}el.classList.toggle('up',n.up);el.classList.toggle('down',!n.up)}});
 document.querySelectorAll('[data-tmc]').forEach(el=>{const t=T[el.dataset.tmc];if(!t)return;const m=mcap(t);if(el.textContent!==fmtUsd(m)){el.textContent=fmtUsd(m);el.className=mcCls(m)}});
 document.querySelectorAll('[data-price]').forEach(el=>{const t=T[el.dataset.price];if(t)el.textContent=fmtPrice(t.price)});
 document.querySelectorAll('[data-tcp]').forEach(el=>{const k=calls.find(x=>String(x.id)===el.dataset.tcp),n=k&&nums(k);if(n){flashSet(el,money(n.pnl),0);el.classList.toggle('up',n.pnl>=0);el.classList.toggle('down',n.pnl<0)}})},3000);

setInterval(()=>{if(document.hidden)return;perpTick()},3000);
setInterval(()=>{if(document.hidden)return;if(calls.some(k=>k.perp)||S.cat==='perps')loadPerps();if(currentRoute()==='home')loadPosts()},20000);
loadPerps();if(realAuth())loadPosts();
/* simulated realtime: new calls arrive and wait behind the pill */
let QUEUED=false;
function queueDemoCalls(){/* demo calls retired: real calls only */if(true||QUEUED)return;QUEUED=true;setTimeout(()=>{const a=T[LIVEMAP.BSHK||'KFSH'],b=T[LIVEMAP.KOI||'DOTB'];if(!a||!b)return;
 S.queued.push({id:901,c:'zerobeta',t:a.key,entry:mcap(a)*.98,buy:220,thesis:'Smart wallets that caught the last run are loading this now. Same pattern.',target:mcap(a)*4,horizon:'7 days',ago:'now',likes:3,reposts:0,replies:0,views:120},
 {id:902,c:'dr_liquidity',t:b.key,entry:mcap(b)*.95,buy:35,thesis:'Liquidity keeps climbing here. Taking a small position.',target:mcap(b)*3,horizon:'3 days',ago:'now',likes:1,reposts:0,replies:0,views:44});
 const np=$('#newpill');if(np&&S.tab==='foryou'&&currentRoute()==='home')np.innerHTML=newPill()},12000)}

/* static icons */
$('#setIcon').innerHTML=ic('settings',20);$('#fab').innerHTML=ic('plus',28);$('#searchBtn').innerHTML=ic('search',18)+'<span class="lbl">Search</span>';
if(innerWidth<1100)document.body.classList.add('collapsed');
addEventListener('hashchange',()=>{if(NAVH.back)NAVH.back=false;else if(NAVH.cur!==location.hash)NAVH.stack.push(NAVH.cur);NAVH.stack=NAVH.stack.slice(-30);NAVH.cur=location.hash;closeModal();closeSheet();if(currentRoute()==='home')S.adRot++;render();scrollTo({top:0})});
/* ad board rotates on its own */
setInterval(()=>{const el=$('#adboard');if(!el||el.matches(':hover'))return;S.board++;el.outerHTML=adBoard()},6000);

/* ---------- live boot ----------
 * The prototype shipped with made-up tokens (GLORP, KFSH, ...). On boot we pull real
 * Solana tokens from the live feeds and swap every demo token for one of them, everywhere:
 * calls, watchlist, balances, communities, notifications, the landing ticker. Calls keep
 * their shape (same multiple since entry) but every number after that is live. */
const DEMO_KEYS=['GLORP','KFSH','DOTB','MOTH','ORBIT','NIMB','BSHK','KOI','SAND','FROG','PUP','WORM','PAIN','QRC'];
function pickLive(){const seen=new Set(),out=[];
 ['traded:24h','movers:1h','organic:24h'].forEach(id=>(LIVE.feeds[id]||[]).forEach(k=>{const t=T[k];if(!t||seen.has(k))return;seen.add(k);
  if(NOT_MEME.has(String(t.sym).toUpperCase())||!t.price||!t.pool||(t.L&&t.L.audit&&t.L.audit.sus))return;
  if(mcap(t)<250e3||(t.liq||0)<50e3)return;out.push(t)}));
 return out}
function remapDemo(cands){const map={};DEMO_KEYS.forEach((k,i)=>{if(cands[i]&&T[k])map[k]=cands[i].key});Object.assign(LIVEMAP,map);
 const sw=txt=>String(txt).replace(/(\$?)\b([A-Z]{3,6})\b/g,(m,d,x)=>map[x]?d+T[map[x]].sym:m);
 calls=calls.filter(k=>!DEMO_KEYS.includes(k.t)||map[k.t]);
 calls.forEach(k=>{const o=T[k.t],n=map[k.t]&&T[map[k.t]];if(!o||!n)return;const mult=k.entry?mcap(o)/k.entry:1,tr=k.target&&k.entry?k.target/k.entry:0;
  k.t=n.key;if(k.entry){k.entry=mcap(n)/mult;if(tr)k.target=k.entry*tr}k.thesis=sw(k.thesis).replace(/Base lending market with sticky TVL\. Token unlock is behind us\./,'Sticky liquidity and the unlocks are behind it.')});
 S.watch=new Set([...S.watch].map(k=>map[k]||k).filter(k=>T[k]));
 for(const k of Object.keys(S.bal)){if(map[k]){const o=T[k],n=T[map[k]];S.bal[n.key]=(S.bal[n.key]||0)+(S.bal[k]*o.price/n.price);delete S.bal[k]}}
 for(const f of ['from','to'])if(map[S.swap[f]])S.swap[f]=map[S.swap[f]];
 COMMS.forEach(c=>{if(c.sym&&map[c.sym]){const o=T[c.sym],n=T[map[c.sym]];c.name=c.name.replace(o.name.split(' ')[0],n.name.length>18?n.sym:n.name);c.desc=sw(c.desc);c.sym=n.key}});
 for(const id in MSG)MSG[id].forEach(m=>m[1]=sw(m[1]));for(const h in DMS)DMS[h].forEach(m=>m[1]=sw(m[1]));
 NOTIFS.forEach(n=>{if(n.real)return;n.t=sw(n.t).replace(/\. It's up \S+ since/,'');if(n.sym&&map[n.sym]){n.sym=map[n.sym];const t=T[n.sym];n.t=n.id===5?`$${t.sym} is ${pctS(chgOf(t,'24h'))} in 24h. It's on your watchlist`:`$${t.sym} is trading at ${fmtSmall(mcap(t))} market cap`}const g=(n.go||'').split('/');if(g[1]==='token'&&map[g[2]])n.go='#/token/'+map[g[2]]});
 const live24=k=>{const t=T[k];return t?pctS(chgOf(t,'24h')):''};
 [LX_TICK_A,LX_TICK_B].forEach(L=>L.forEach(x=>{if(x[0]==='g'&&map[x[1]]){x[1]=map[x[1]];x[2]=live24(x[1])}else if(x[0]==='m'&&map[x[1]]){x[1]=map[x[1]];x[2]=fmtSmall(mcap(T[x[1]]))+' MC'}
  else if((x[0]==='c'||x[0]==='n')&&map[x[2]]){x[2]=map[x[2]];if(x[0]==='c'){const k=calls.find(c=>c.c===x[1]&&c.t===x[2]&&c.buy),n=k&&nums(k);if(n)x[3]=money(n.pnl)}}}));
 for(const L of [LX_TICK_A,LX_TICK_B])for(let i=L.length-1;i>=0;i--)if(L[i][0]==='g'&&!String(L[i][2]).startsWith('+'))L.splice(i,1);
 DEMO_KEYS.forEach(k=>{delete T[k]});['MOTH','ORBIT'].forEach(k=>S.watch.delete(k))}
function refreshLandingTicks(){const el=$('#landing');if(!el||el.hidden)return;const ts=el.querySelectorAll('.lxtick');if(ts[0])ts[0].outerHTML=lxTicker(LX_TICK_A,'');if(ts[1])ts[1].outerHTML=lxTicker(LX_TICK_B,' rev')}
/* Batch-refresh every token that has a call on it so feed numbers stay live. */
let CTBUSY=0;
function refreshCallTokens(){if(CTBUSY)return;const ms=[...new Set([...calls,...S.queued].map(k=>k.t))].filter(k=>T[k]&&T[k].live);if(!ms.length)return;CTBUSY=1;
 fetchTokens(ms).then(list=>list.forEach(regLive)).catch(()=>{}).finally(()=>{CTBUSY=0})}
let BOOT_TRIES=0;
function liveBoot(){BOOT_TRIES++;const ids=['traded:24h','movers:1h','organic:24h'];
 fetchToken('So11111111111111111111111111111111111111112').then(x=>{if(x&&x.price){T.SOL.price=x.price;if(x.chg&&x.chg.h24!=null)T.SOL.chg=x.chg.h24;renderSwapsSoft()}}).catch(()=>{});
 Promise.allSettled(ids.map(id=>{const [f,iv]=id.split(':');return fetchFeed(f,iv).then(l=>{LIVE.feeds[id]=l.map(regLive).filter(Boolean).map(t=>t.key);LIVE.err[id]=0;LIVE.at[id]=Date.now()})})).then(()=>{
  const c=pickLive();
  if(c.length>=8&&DEMO_KEYS.some(k=>T[k])){remapDemo(c);S.live='ok';queueDemoCalls();refreshLandingTicks();if(!document.querySelector('.sheet.open')&&!$('#modal').innerHTML)render();else S.dirty=1}
  else if(S.live!=='ok'){if(S.live==='wait'){S.live='demo';queueDemoCalls();render()}if(BOOT_TRIES<4)setTimeout(liveBoot,15000)}})}
/* @mention autocomplete in every composer and reply box. */
const MAC={el:null,list:[],i:0,q:'',t:0};
function macClose(){const b=$('#mbox');if(b)b.remove();MAC.el=null;MAC.list=[]}
function macWord(ta){const v=ta.value.slice(0,ta.selectionStart),m=v.match(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{0,30})$/);return m?{q:m[2],at:ta.selectionStart-m[2].length-1}:null}
function macDraw(){const ta=MAC.el;if(!ta||!MAC.list.length){const b=$('#mbox');if(b)b.remove();return}
 let b=$('#mbox');if(!b){b=document.createElement('div');b.id='mbox';b.className='mbox';b.setAttribute('role','listbox');document.body.appendChild(b)}
 const r=ta.getBoundingClientRect();b.style.left=Math.max(8,r.left)+'px';b.style.width=Math.min(320,r.width)+'px';
 const below=innerHeight-r.bottom>230;b.style.top=below?(r.bottom+6)+'px':'';b.style.bottom=below?'':(innerHeight-r.top+6)+'px';
 b.innerHTML=MAC.list.map((p,i)=>`<button type="button" role="option" aria-selected="${i===MAC.i}" class="${i===MAC.i?'on':''}" data-mi="${i}">${p.avatar_url?`<span class="av" style="background:#0B1B27 url(${esc(p.avatar_url)}) center/cover"></span>`:avatar(p.handle)}<span class="grow"><b>${esc(p.display_name||p.handle)}</b><span class="hint">@${esc(p.handle)}</span></span></button>`).join('')}
function macPick(i){const ta=MAC.el,p=MAC.list[i];if(!ta||!p)return;const w=macWord(ta);if(!w)return macClose();
 const v=ta.value,ins='@'+p.handle+' ';ta.value=v.slice(0,w.at)+ins+v.slice(ta.selectionStart);const c=w.at+ins.length;ta.setSelectionRange(c,c);if(p.avatar_url)AVURL[p.handle]=p.avatar_url;
 macClose();ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()}
document.addEventListener('input',e=>{const ta=e.target;if(!(ta instanceof HTMLTextAreaElement)||!ta.closest('#modal,#rbox')||ta.id==='epb')return;
 const w=macWord(ta);if(!w){if(MAC.el===ta)macClose();return}MAC.el=ta;MAC.q=w.q;MAC.i=0;
 const ql=w.q.toLowerCase(),local=[...new Set([...S.following,...Object.keys(C)])].filter(h=>h&&h!==S.me&&C[h]&&(C[h].real||S.following.has(h))&&h.toLowerCase().startsWith(ql)).slice(0,5).map(h=>({handle:h,display_name:DN[h]||null,avatar_url:AVURL[h]||null}));
 MAC.list=local;macDraw();clearTimeout(MAC.t);if(w.q.length<2)return;
 MAC.t=setTimeout(()=>fetch('/api/profile?q='+encodeURIComponent(w.q)).then(r=>r.ok?r.json():{profiles:[]}).then(j=>{if(MAC.el!==ta||MAC.q!==w.q)return;
  const seen=new Set(),all=[...local,...(j.profiles||[])].filter(p=>p.handle!==S.me&&!seen.has(p.handle)&&seen.add(p.handle));MAC.list=all.slice(0,6);MAC.i=0;macDraw()}).catch(()=>{}),180)});
document.addEventListener('keydown',e=>{if(!MAC.el||!MAC.list.length||e.target!==MAC.el)return;
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();MAC.i=(MAC.i+(e.key==='ArrowDown'?1:-1)+MAC.list.length)%MAC.list.length;macDraw()}
 else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopPropagation();macPick(MAC.i)}else if(e.key==='Escape'){e.stopPropagation();macClose()}},true);
document.addEventListener('mousedown',e=>{const o=e.target.closest&&e.target.closest('#mbox [data-mi]');if(o){e.preventDefault();macPick(+o.dataset.mi)}else if(!e.target.closest||!e.target.closest('#mbox'))macClose()});
addEventListener('hashchange',()=>{macClose();S.pidx=0});
S.live='wait';
setTimeout(()=>{if(S.live==='wait'){S.live='demo';queueDemoCalls();render()}},6000);
liveBoot();
render();

document.addEventListener('keydown',e=>{if(e.target.id==='astin'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();astSend(e.target.value)}});
document.addEventListener('input',e=>{if(e.target.id!=='astin')return;const t=e.target;t.style.height='auto';t.style.height=Math.min(t.scrollHeight,160)+'px'});
/* ---------- motion helpers ---------- */
(()=>{const RIP='.btn,.lxb,.buyb,.upg,.fab,.chip,.tpick,.mtabs button';
 const HOV='.btn,.lxb,.buyb,.upg,.fab,.chip,.tpick,.mtabs button,.pfollow button,.soc a,.bnadd,.ib,.tabs button,.tscroll>button,.scard,.rcard,.act,.notif,.comm,.cats button,.ccard,.astart';
 let hovEl=null;const setHov=el=>{if(hovEl===el)return;hovEl&&hovEl.classList.remove('hov');hovEl=el;el&&el.classList.add('hov')};
 document.addEventListener('pointerover',e=>{if(e.pointerType==='mouse')return;setHov(e.target.closest(HOV))},{passive:true});
 document.addEventListener('pointerout',e=>{if(e.pointerType==='mouse')return;if(hovEl&&!hovEl.contains(e.relatedTarget))setHov(null)},{passive:true});
 document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')setHov(e.target.closest(HOV))},{passive:true});
 ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,e=>{if(e.pointerType==='touch'){const el=hovEl;setTimeout(()=>{if(hovEl===el)setHov(null)},260)}},{passive:true}));const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
 document.addEventListener('pointerdown',e=>{const b=e.target.closest(RIP);if(!b||b.disabled)return;
  if(navigator.vibrate&&e.pointerType==='touch')try{navigator.vibrate(8)}catch(_){}
  if(reduce)return;const r=b.getBoundingClientRect(),d=Math.max(r.width,r.height)*2.2,s=document.createElement('span');s.className='rip';
  s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left}px;top:${e.clientY-r.top}px`;b.appendChild(s);setTimeout(()=>s.remove(),650)},{passive:true});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-act="like"],[data-act="rlike"],[data-act="repost"],[data-act="rrt"]');if(!b||!b.isConnected)return;if(Date.now()-(b._heldAt||0)<1500)return;
  const cls=/like/.test(b.dataset.act)?'pop':'spin';b.classList.remove(cls);void b.offsetWidth;b.classList.add(cls);
  const sv=b.querySelector('svg');if(sv)b.style.setProperty('--bx',(sv.offsetLeft+sv.offsetWidth/2)+'px');setTimeout(()=>b.classList.remove(cls),600)});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-act="follow"]');if(!b)return;const h=b.dataset.h;
  requestAnimationFrame(()=>document.querySelectorAll(`[data-act="follow"][data-h="${CSS.escape(h)}"]`).forEach(x=>{x.classList.add('bump');setTimeout(()=>x.classList.remove('bump'),500)}))});
})();

  // used by an inline handler in the reply box
  (window as any).drawRMedia = drawRMedia;
}
