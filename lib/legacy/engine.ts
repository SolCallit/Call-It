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
import { walletBalances, swap as jupSwap, withdraw as doWithdraw, toBaseUnits, qrSvg, SOL_MINT, USDC_MINT } from '@/lib/wallet/client';

let booted = false;

export function bootCallit(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const vbadge=h=>isPrem(h)?`<span class="vb" title="Callit Premium">${ic('verified',17)}</span>`:'';
const bannerBg=h=>h===S.me&&PROF.banner?`background:#0B1B27 url(${PROF.banner}) center/cover`:`background:linear-gradient(120deg,hsl(${(hue(h)%70)+185} 55% 26%),#0B1B27 70%),#0B1B27`;
const followingOf=h=>h===S.me?[...S.following]:ranked().map(c=>c.h).filter(x=>x!==h).slice(0,(hue(h)%3)+2);
const followersOf=h=>h===S.me?[]:ranked().map(c=>c.h).filter(x=>x!==h&&(S.following.has(x)||hue(x+h)%2===0)).concat(S.following.has(h)&&S.me?[S.me]:[]);
function shrink(file,max,cb){const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);cb(c.toDataURL('image/jpeg',.82))};im.src=r.result};r.readAsDataURL(file)}
const tokav=s=>{const t=T[s],lab=t&&t.sym?t.sym:String(s);
 return t&&t.icon?`<span class="tokav img" style="background:hsl(${hue(lab)} 58% 45%)"><i>${esc(lab.slice(0,3))}</i><img src="${esc(t.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
  :`<span class="tokav" style="background:hsl(${hue(lab)} 58% 45%)">${esc(lab.slice(0,3))}</span>`};
const symOf=k=>T[k]&&T[k].sym||k;

const P={
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
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
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
const LPNAME=s=>{s=String(s||'').toLowerCase();return s.includes('pump')?'Pump':s.includes('bonk')?'Bonk':s.includes('believe')?'Believe':s.includes('moonshot')?'Moonshot':s.includes('launchlab')||s.includes('raydium')?'Launchlab':s.includes('bags')?'Bags':s.includes('jup')?'Jup Studio':null};
function regLive(x){if(!x||!x.mint)return null;const o=T[x.mint]||{},price=x.price||0,ageH=x.createdAt?Math.max(0,(Date.now()-Date.parse(x.createdAt))/36e5):null;
 Object.assign(o,{key:x.mint,sym:x.sym,name:x.name,chain:'Solana',price,supply:price&&x.mc?x.mc/price:(o.supply||0),liq:x.liq||0,vol:x.vol24||0,holders:x.holders||0,
  ageH:ageH==null?9999:ageH,age:ageH==null?'—':ageLong(ageH),chg:x.chg.h24!=null?x.chg.h24:(x.chg.h1||0),ca:x.mint,seed:o.seed||hashStr(x.mint),live:1,icon:x.icon||o.icon,
  pool:x.pool||o.pool||null,lp:LPNAME(x.launchpad)||(/pump$/.test(x.mint)?'Pump':/bonk$/.test(x.mint)?'Bonk':null),
  soc:(x.socials.x?'x':'')+(x.socials.web?'w':'')+(x.socials.tg?'c':''),L:{...(o.L||{}),...x,pool:x.pool||(o.L&&o.L.pool)||null}});
 delete o._x;T[x.mint]=o;return o}
/* Engine feeds -> live lists. almost/grad are built from the newest + trending lists. */
/* Timeframes for % change: drives Movers ranking, row % and the min-change filter. */
const TF_OK=['5m','1h','6h','24h'],TFK={'5m':'m5','1h':'h1','6h':'h6','24h':'h24'};
const chgOf=(t,tf)=>{if(!t)return null;const c=t.L&&t.L.chg,v=c?c[TFK[tf]||'h24']:null;return v!=null?v:(!t.live||tf==='24h'?t.chg:null)};
const byChg=tf=>(a,b)=>{const x=chgOf(a,tf),y=chgOf(b,tf);return (y==null?-1e9:y)-(x==null?-1e9:x)};
const lfIds=(k,f)=>{const tf=TF_OK.includes(f&&f.tf)?f.tf:'1h';
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
function loadFeed(id){if(LIVE.busy[id])return;LIVE.busy[id]=1;const [feed,iv]=id.split(':');
 (feed==='ogset'?fetchTokens(OG_MEMES):fetchFeed(feed,iv||'1h')).then(list=>{LIVE.feeds[id]=list.map(regLive).filter(Boolean).map(t=>t.key);LIVE.err[id]=0})
  .catch(()=>{LIVE.err[id]=1}).finally(()=>{LIVE.busy[id]=0;LIVE.at[id]=Date.now();if(SH&&SH.kind==='f')drawSheet();else if(currentRoute()==='market'&&!document.querySelector('.sheet.open'))render()})}
function loadLiveToken(mint,quiet){if(LIVE.tokBusy[mint])return;LIVE.tokBusy[mint]=1;
 fetchToken(mint).then(x=>{if(x){regLive(x);LIVE.tokErr[mint]=0}else LIVE.tokErr[mint]='gone'})
  .catch(()=>{LIVE.tokErr[mint]=LIVE.tokErr[mint]||'err'})
  .finally(()=>{LIVE.tokBusy[mint]=0;const [,r,p]=location.hash.split('/');if(r==='token'&&p===mint){if(quiet&&T[mint])liveTick(T[mint]);else render()}})}
const C={
 fadedpixel:{h:'fadedpixel',win:68,avg:142,calls:57,best:2140,followers:12400},
 lagosape:{h:'lagosape',win:61,avg:97,calls:83,best:1310,followers:8900},
 minnie_sol:{h:'minnie_sol',win:58,avg:88,calls:40,best:960,followers:5100},
 dr_liquidity:{h:'dr_liquidity',win:54,avg:61,calls:112,best:720,followers:15800},
 quietmoney:{h:'quietmoney',win:51,avg:44,calls:29,best:410,followers:2300},
 zerobeta:{h:'zerobeta',win:47,avg:33,calls:66,best:380,followers:1900}
};
let calls=[
 {id:1,c:'fadedpixel',t:'GLORP',entry:412e3,buy:150,thesis:'Dev locked LP, community took over the X account, and holders doubled overnight. Early for a coin this clean.',target:5e6,horizon:'7 days',ago:'2h',likes:214,reposts:41,replies:38,views:18200},
 {id:4,sponsored:true,sponsor:'Nebula',c:'lagosape',t:'NEBU',thesis:'Nebula opens its public sale on Ethereum Oct 14. Intent-based bridging with a working testnet and a 40k waitlist.',ago:'3h',likes:88,reposts:17,replies:12,views:9400},
 {id:7,c:'minnie_sol',t:'DOTB',entry:24.5e3,buy:40,thesis:'6 hours old, dev still in the chat, and the art is actually good. Tiny bag, big upside.',target:500e3,horizon:'3 days',ago:'4h',likes:52,reposts:9,replies:14,views:5100},
 {id:2,c:'lagosape',t:'KFSH',entry:9.8e6,buy:300,thesis:'Survived two dumps and still printing higher lows. Volume is real, not wash.',target:50e6,horizon:'30 days',ago:'5h',likes:131,reposts:22,replies:22,views:11800},
 {id:3,c:'minnie_sol',t:'MOTH',entry:520e3,buy:110,sold:{pct:40,ago:'2h'},thesis:'Fresh deployer wallet, top 10 holders under 20%. Small bet, fast exit if it loses $300K.',target:3e6,horizon:'3 days',ago:'8h',likes:47,reposts:5,replies:9,views:3900},
 {id:5,c:'dr_liquidity',t:'ORBIT',entry:31e6,thesis:'Base lending market with sticky TVL. Token unlock is behind us. Slow grind, not a flip.',target:80e6,horizon:'30 days',ago:'1d',likes:76,reposts:11,replies:14,views:7300},
 {id:6,c:'quietmoney',t:'GLORP',entry:1.1e6,buy:90,thesis:'Late, but the chart says there is room. Following the smart wallets in.',target:4e6,horizon:'3 days',ago:'1d',likes:19,reposts:2,replies:4,views:1600},
 {id:21,c:'dr_liquidity',kind:'perps',perp:{m:'SOL',side:'long',lev:5,rel:.972,target:null,stop:null,trel:1.12},thesis:'Funding flipped negative while spot bids keep stepping up. Shorts are paying me to wait.',horizon:'7 days',ago:'3h',likes:64,reposts:9,replies:11,views:6100},
 {id:22,c:'zerobeta',kind:'perps',perp:{m:'BTC',side:'short',lev:10,rel:1.008,target:null,stop:null,trel:.95,srel:1.03},thesis:'Third rejection at the same level on lower volume. Tight stop above the wick.',horizon:'3 days',ago:'6h',likes:38,reposts:4,replies:7,views:3300},
 {id:23,c:'lagosape',kind:'perps',perp:{m:'ETH',side:'long',lev:3,rel:.985,target:null,stop:null,trel:1.2},thesis:'ETH/BTC bottoming on the weekly. Slow swing long, low leverage, no stress.',horizon:'30 days',ago:'1d',likes:51,reposts:6,replies:9,views:4800},
 {id:31,c:'minnie_sol',kind:'random',thesis:'Reminder that the best trade this week was the one you didn’t take. Touch grass, then come back to the charts.',ago:'1h',likes:122,reposts:18,replies:24,views:9800},
 {id:32,c:'fadedpixel',kind:'random',thesis:'Hosting a Space tonight on how I size memecoin calls. Bring your worst entries, we’re reviewing them live 😂',ago:'5h',likes:87,reposts:21,replies:31,views:7400},
 {id:33,c:'quietmoney',kind:'random',thesis:'Week 3 of journaling every trade. Biggest lesson so far: I exit winners too early and hold losers too long. Fixing it one call at a time.',ago:'2d',likes:43,reposts:3,replies:8,views:2900}
];
const ADS=[
 {id:'vault',brand:'Vaultline',h:'vaultline',ic:'wallet',text:'Keep your bags cold. The pocket hardware wallet that signs Solana transactions in one tap.',title:'Vaultline Wallet',sub:'★★★★★ 2,140 reviews',cta:'Shop',g:['#1F7AE0','#0B1B27']},
 {id:'solstice',brand:'Solstice Card',h:'solsticecard',ic:'swap',text:'Spend USDC anywhere cards work. No top-ups, no waiting, 2% back in SOL.',title:'Spend crypto like cash',sub:'Solana · Visa debit',cta:'Get the card',g:['#0B9366','#0B1B27']},
 {id:'callit',brand:'Callit',h:'callit',ic:'promote',text:'Put your product in front of every trader on Callit. Ad slots and sponsored calls, always clearly labelled.',title:'Advertise on Callit',sub:'Ad board · Sponsored calls',cta:'Promote',href:'#/promote',g:['#16314A','#0B1B27']}
];
const AD_EVERY=3;
const S={connected:false,addr:'',me:'',tab:'foryou',tf:'1D',lb:'30d',following:new Set(),watch:new Set(['GLORP','ORBIT']),
 bal:{SOL:4.2,USDC:310,GLORP:120000},activity:[{k:'Received',d:'2 SOL',t:'Yesterday'}],
 swap:{from:'SOL',to:'GLORP',amt:''},pkg:'boost',queued:[],unread:true,adRot:0,board:0,tt:'movers'};
try{S.notifyOn=JSON.parse(localStorage.getItem('callit.notify')||'{}')||{}}catch(_){S.notifyOn={}}

/* ---------- persistence (Supabase via /api) ----------
 * Real sessions save everything to the user's account: posts, likes, reposts, replies,
 * follows, mutes, blocks, lists, watchlist, transactions and media. The UI updates
 * instantly; the server write happens in the background. */
Object.assign(S,{cat:(()=>{try{const v=localStorage.getItem('callit.cat');return ['meme','perps','random'].includes(v)?v:'meme'}catch(_){return 'meme'}})(),
 muted:new Set(),blocked:new Set(),lists:[],followers:null});
const PUB={},AVURL={},RLOADED={};let SYNCWARN=0;
async function API(path,o={}){const w=window.CallitWallet,tok=w&&w.token?await w.token().catch(()=>null):null,has=o.body!==undefined;
 const r=await fetch(path,{method:o.method||(has?'POST':'GET'),headers:{...(has?{'content-type':'application/json'}:{}),...(tok?{authorization:'Bearer '+tok}:{})},body:has?JSON.stringify(o.body):undefined,cache:'no-store'});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j}
function SYNC(){return realAuth()&&S.connected&&!!window.CallitWallet}
function bg(path,body,method){if(!SYNC())return Promise.resolve(null);
 return API(path,{body,method}).catch(e=>{console.warn('[callit] sync',path,e.message);if(!SYNCWARN++)toast('Couldn’t save that to your account. It’ll show until you reload');return null})}
async function upMedia(list,kind='post'){const out=[];for(const u of list||[]){if(/^https?:/.test(u)){out.push(u);continue}const r=await API('/api/media',{body:{data:u,kind}});out.push(r.url)}return out}
function liveAgo(o,at){if(!at)return o;o.at=at;Object.defineProperty(o,'ago',{configurable:true,enumerable:true,get(){const m=(Date.now()-o.at)/6e4;return m<1?'now':m<60?Math.round(m)+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d'}});return o}
function nameOf(h){return h===S.me?(PROF.name||h):(PUB[h]&&PUB[h].display_name)||h}

/* server rows -> feed items */
function fromRow(r){if(!r||!r.handle)return null;if(r.avatar_url)AVURL[r.handle]=r.avatar_url;
 if(!C[r.handle])C[r.handle]={h:r.handle,win:0,avg:0,calls:0,best:0,followers:0,real:1};
 const k={id:r.id,srv:1,c:r.handle,kind:r.kind,thesis:r.body||'',media:r.media||[],likes:r.likes||0,reposts:r.reposts||0,replies:r.replies||0,views:Math.max(1,(r.likes||0)*9+(r.replies||0)*14),liked:!!r.liked,reposted:!!r.reposted,horizon:r.horizon||null};
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
function loadPosts(){if(PBUSY)return;PBUSY=1;API('/api/posts?limit=60').then(j=>{if(mergePosts(j.posts||[])&&['home','profile','lists'].includes(currentRoute()))render()}).catch(()=>{}).finally(()=>{PBUSY=0})}
function loadMe(){if(!SYNC())return;API('/api/me').then(j=>{
  S.following=new Set(j.following||[]);S.muted=new Set(j.muted||[]);S.blocked=new Set(j.blocked||[]);S.lists=j.lists||[];S.followers=j.followers||0;
  if(j.watchlist&&j.watchlist.length)S.watch=new Set(j.watchlist);
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
const CATS=[['meme','Memes','trenches'],['perps','Perps','market'],['random','Random','smile']];
function catOf(k){return k.kind||'meme'}
function visible(k){return !S.muted.has(k.c)&&!S.blocked.has(k.c)}
function catBar(){return `<div class="cats" role="tablist" aria-label="Feed type">${CATS.map(([k,l,i])=>`<button role="tab" aria-selected="${S.cat===k}" class="${S.cat===k?'on':''}" data-act="cat" data-f="${k}">${ic(i,15)}<span>${l}</span></button>`).join('')}</div>`}
function catEmpty(){const E={meme:['No calls yet','Call a token you believe in. Your entry is stamped at the live market cap.','Make a call'],
 perps:['No perps calls yet','Call a long or short on SOL, BTC or ETH. Callit tracks the ROE live.','Call a perp'],
 random:['Nothing here yet','Not every post needs a chart. Share what you’re seeing, thinking or building.','Write a post']}[S.cat];
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
function phead(k){const r=rankOf(k.c);return `<div class="phead"><span class="pname">${esc(k.c)}</span>${vbadge(k.c)}${r&&catOf(k)==='meme'?`<span class="rk">#${r}</span>`:''}${catOf(k)==='perps'?'<span class="tag pk">Perps</span>':''}${followChip(k.c)}<time>${k.ago==='now'?'now':k.ago+' ago'}</time>${moreBtn(k)}</div>`}
function pbar(k,right=''){return `<div class="pbar"><div class="icons">
 <button class="act" data-act="reply" aria-label="Reply">${ic('reply',18)}<span class="num">${k.replies||''}</span></button>
 <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',18)}<span class="num">${k.reposts||''}</span></button>
 <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',18,k.liked)}<span class="num">${k.likes||''}</span></button>
 <span class="act views" aria-label="Views">${ic('views',18)}<span class="num">${fmtK(k.views||0)}</span></span>
 <button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',18)}</button></div>${right}</div>`}
function perpCard(k){const p=k.perp,n=perpNums(k),L=p.side==='long';
 return `<div class="ccard pcard">${perpAv(p.m)}<div class="cn"><b>${p.m}-PERP</b><span><span class="pside ${L?'long':'short'}">${L?'Long':'Short'} ${+p.lev}x</span></span></div>
 <div class="cr2 num"><div><span>Entry</span><b>${fmtPrice(p.entry)}</b></div><div><span>${n&&n.liqd?'Liquidated':'ROE'}</span><b class="${n?(n.up?'up':'down'):'muted'}" data-roe="${k.id}">${n?fmtPct(n.roe):'—'}</b></div></div></div>`}
function postPerp(k){const p=k.perp;if(!p.entry)return '';const n=perpNums(k);
 return `<article class="post${k.fresh?' fresh':''}" data-go="#/post/${k.id}" tabindex="0" aria-label="Perps call by ${esc(k.c)} on ${p.m}">
 <a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile" class="pav">${avatar(k.c,'md')}</a><div style="min-width:0">${phead(k)}
 <p class="ptext">${esc(k.thesis)}</p>${mediaGrid(k.media)}${perpCard(k)}<div class="pnote">${perpNote(k,n)}</div>
 ${pbar(k,`<span class="pright"><span class="mc num" data-ppx="${p.m}" title="${p.m} mark price">${n?fmtPrice(n.px):'—'}</span></span>`)}</div></article>`}
function postRandom(k){return `<article class="post${k.fresh?' fresh':''}" data-go="#/post/${k.id}" tabindex="0" aria-label="Post by ${esc(k.c)}">
 <a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile" class="pav">${avatar(k.c,'md')}</a><div style="min-width:0">${phead(k)}
 ${k.thesis?`<p class="ptext">${esc(k.thesis)}</p>`:''}${mediaGrid(k.media)}${pbar(k)}</div></article>`}
function perpPanel(k){if(!k.perp.entry)return '<p class="hint">Loading the live price…</p>';const p=k.perp,n=perpNums(k),L=p.side==='long',cls=n?(n.up?'up':'down'):'';
 const prog=p.target&&n?Math.min(100,Math.max(0,(n.px-p.entry)/(p.target-p.entry)*100)):null;
 return `<div class="tpanel">${perpCard(k)}<div class="tgrid num"><div><span>Entry</span><b>${fmtPrice(p.entry)}</b></div><div><span>Mark price</span><b class="${cls}" data-ppx="${p.m}">${n?fmtPrice(n.px):'—'}</b></div><div><span>Price move</span><b class="${cls}">${n?fmtPct(n.move):'—'}</b></div>
 <div><span>Side</span><b class="${L?'up':'down'}">${L?'Long':'Short'} ${+p.lev}x</b></div><div><span>Target</span><b>${p.target?fmtPrice(p.target):'None set'}</b></div><div><span>${p.lev>1?'Liq. price':'Stop'}</span><b>${p.lev>1?fmtPrice(liqOf(p)):p.stop?fmtPrice(p.stop):'—'}</b></div></div>
 ${prog!=null?`<div class="tprog"><i style="width:${Math.max(2,prog)}%"></i></div>`:''}<p class="hint" style="margin:10px 0 0">${perpNote(k,n)}. Perps trading in Callit is coming; calls are tracked against the live ${p.m} price.</p></div>`}
function perpTick(){calls.forEach(k=>{if(!k.perp)return;const n=perpNums(k);if(!n)return;const dir=k._px?Math.sign(n.px-k._px):0;k._px=n.px;
 document.querySelectorAll(`[data-roe="${k.id}"]`).forEach(el=>{flashSet(el,fmtPct(n.roe),dir);el.classList.toggle('up',n.up);el.classList.toggle('down',!n.up)})});
 Object.keys(PERPM).forEach(m=>{const px=perpPx(m);if(px)document.querySelectorAll(`[data-ppx="${m}"]`).forEach(el=>el.textContent=fmtPrice(px))})}

/* ---------- compose: one sheet, three kinds ---------- */
function kindSeg(cur){return `<div class="kseg" role="tablist" aria-label="What are you posting?">${CATS.map(([k,l,i])=>`<button type="button" role="tab" aria-selected="${cur===k}" class="${cur===k?'on':''}${k==='perps'?' klock':''}" data-ck="${k}"${k==='perps'?' aria-disabled="true"':''}>${ic(k==='perps'?'lock':i,16)}<span>${{meme:'Meme',perps:'Perps',random:'Random'}[k]}</span>${k==='perps'?'<small>Soon</small>':''}</button>`).join('')}</div>`}
function wireKind(m,cur){m.querySelectorAll('[data-ck]').forEach(b=>b.onclick=()=>{if(b.dataset.ck==='perps')return toast('Perps calls are coming soon');if(b.dataset.ck===cur)return;const d=($('#cx',m)||{}).value||'';composeModal(b.dataset.ck,{draft:d})})}
function composeModal(kind,o={}){if(kind==='perps'){toast('Perps calls are coming soon');kind='meme'}if(!S.connected)return connectModal(()=>composeModal(kind,o));if(kind==='random')return randomModal(o);return callModal(o.pre,o.draft)}
function afterPost(k,msg){calls.forEach(x=>x.fresh=false);calls.unshift(k);S.cat=catOf(k);try{localStorage.setItem('callit.cat',S.cat)}catch(_){}S.tab='foryou';closeModal();
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
function randomModal(o={}){const CD={media:[]};
 modal('New post','Not every post needs a chart. Share what’s on your mind.',`${kindSeg('random')}
 <div class="field"><div class="composer2" id="cbox"><textarea id="cx" class="input" maxlength="280" style="min-height:130px" placeholder="What’s happening?">${esc(o.draft||'')}</textarea><div id="cmedia"></div>${attachBar()}</div><span class="hint" id="cn">0 / 280</span></div>
 <div class="err" id="cerr"></div><button class="btn primary block" id="cpost" disabled>Post</button>`,
 m=>{wireKind(m,'random');const tx=$('#cx',m),go=$('#cpost',m),check=()=>{$('#cn',m).textContent=tx.value.length+' / 280';go.disabled=!(tx.value.trim()||CD.media.length)};
  wireAttach($('#cbox',m),CD,()=>{$('#cmedia',m).innerHTML=mediaGrid(CD.media,1);$('#cbox [data-attn]',m).textContent=CD.media.length?CD.media.length+'/4':'';check()});
  tx.addEventListener('input',check);check();setTimeout(()=>tx.focus(),60);
  go.onclick=()=>{const body=tx.value.trim(),local={c:S.me,kind:'random',thesis:body,media:CD.media.slice(),likes:0,reposts:0,replies:0,views:1,fresh:true};
   if(!SYNC())return afterPost({...local,id:Date.now(),ago:'now'},'Posted');
   go.disabled=true;go.textContent='Posting…';
   upMedia(CD.media).then(media=>API('/api/posts',{body:{kind:'random',body,media}}))
    .then(r=>afterPost(Object.assign(fromRow({...r.post,handle:S.me}),{fresh:true}),'Posted'))
    .catch(e=>{go.disabled=false;go.textContent='Post';$('#cerr',m).textContent=e.message})}})}

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
 const draw=(st,msg)=>{el.className='txt show '+st;el.innerHTML=`<span class="txi">${st==='ok'?ic('check',18):st==='bad'?ic('x',18):'<i class="spin"></i>'}</span><div class="grow"><b>${esc(desc)}</b><span class="hint">${msg}</span></div>${st==='ok'?`<button class="lnk" data-act="copy" data-v="${sig}">Copy tx</button>`:st==='bad'?'<button class="lnk" id="txretry">Retry</button>':''}<button class="ib" id="txx" aria-label="Dismiss">${ic('x',16)}</button>`;
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
function balRender(){const ae=document.activeElement;if(ae&&ae.dataset&&ae.dataset.swap==='amt')return;
 if($('#modal').innerHTML||document.querySelector('.sheet.open')){S.dirty=1;renderSwaps();return}
 const r=currentRoute();if(r==='wallet'||r==='profile')render();else renderSwaps()}
let BALBUSY=0;
function loadBalances(){if(!REALW()||BALBUSY)return;BALBUSY=1;const who=S.addr;
 walletBalances(who).then(r=>{if(S.addr!==who)return;const b={SOL:r.sol},raw={SOL:r.lamports},miss=[];
  r.tokens.forEach(x=>{const k=keyOfMint(x.mint);DEC[k]=x.decimals;b[k]=(b[k]||0)+x.ui;raw[k]=x.amount;if(!T[k])miss.push(x.mint)});
  const changed=JSON.stringify(b)!==JSON.stringify(S.bal);S.bal=b;for(const k in RAW)delete RAW[k];Object.assign(RAW,raw);S.balAt=Date.now();
  if(miss.length)fetchTokens(miss.slice(0,50)).then(l=>{l.forEach(regLive);balRender()}).catch(()=>{});
  if(changed)balRender()}).catch(e=>console.warn('[callit] balances',e)).finally(()=>{BALBUSY=0})}
/* Same toast as txRun, driven by a real transaction. run(step) resolves to the signature. */
function realTx(desc,run,done){const el=$('#txt');let sig='';
 const draw=(st,msg)=>{el.className='txt show '+st;el.innerHTML=`<span class="txi">${st==='ok'?ic('check',18):st==='bad'?ic('x',18):'<i class="spin"></i>'}</span><div class="grow"><b>${esc(desc)}</b><span class="hint">${esc(msg)}</span></div>${st==='ok'&&sig?`<a class="lnk" href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener noreferrer">View</a>`:st==='bad'?'<button class="lnk" id="txretry">Retry</button>':''}<button class="ib" id="txx" aria-label="Dismiss">${ic('x',16)}</button>`;
  $('#txx').onclick=()=>el.classList.remove('show');const r=$('#txretry');if(r)r.onclick=()=>realTx(desc,run,done)};
 clearTimeout(el._h);draw('wait','Preparing…');
 run(m=>draw('wait',m)).then(s=>{sig=s||'';draw('ok',sig?`Confirmed · ${sig.slice(0,4)}…${sig.slice(-4)}`:'Done');el._h=setTimeout(()=>el.classList.remove('show'),9000);done&&done(true);loadBalances();setTimeout(loadBalances,5000)})
  .catch(e=>{const m=String(e&&e.message||e);draw('bad',/reject|denied|cancel|declin|closed/i.test(m)?'You cancelled it. Nothing was sent.':m.slice(0,160));done&&done(false)})}
function realSwap(from,to,amt,desc,done,opt={}){let base;try{base=baseOf(from,amt)}catch(e){toast(e.message);done&&done(false);return}
 realTx(desc,step=>jupSwap({inputMint:mintOf(from),outputMint:mintOf(to),amount:base,taker:S.addr,slippageBps:S.slip?Math.round(S.slip*100):undefined},step).then(r=>{
  const od=decOf(to),got=r.outAmount&&od!=null?Number(r.outAmount)/10**od:null;
  const kind=from==='SOL'?'buy':to==='SOL'?'sell':'swap',pf=T[from]&&T[from].price;
  logTx({k:{buy:'Bought',sell:'Sold',swap:'Swapped'}[kind],kind,label:`${fmtAmt(amt)} ${symOf(from)} → ${got!=null?fmtAmt(got)+' ':''}${symOf(to)}`,signature:r.signature,in_mint:mintOf(from),in_amount:amt,out_mint:mintOf(to),out_amount:got,usd_value:pf?amt*pf:null,call_ref:opt.callRef!=null?String(opt.callRef):null});return r.signature}),done)}
const perf=k=>{const t=T[k.t];return !t||t.prelaunch||!k.entry?null:(mcap(t)/k.entry-1)*100};
function chart(seed,up,w=600,h=190){const r=rng(seed);let y=up?.25:.75,p=[];for(let i=0;i<72;i++){y+=(r()-.5)*.11+(up?.008:-.008);y=Math.min(.95,Math.max(.05,y));p.push(y)}
 const d=p.map((v,i)=>`${i?'L':'M'}${(i/71*w).toFixed(1)},${(h-v*h).toFixed(1)}`).join('');
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart" role="img" aria-label="Price chart"><path d="${d}L${w},${h}L0,${h}Z" class="area ${up?'up':'down'}"/><path d="${d}" class="line ${up?'up':'down'}"/></svg>`}
function qr(seed){const r=rng(seed),n=21,c=9;let o='';const f=(x,y)=>(x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const on=f(x,y)?((x%14===0||x%14===6||y%14===0||y%14===6)||(x%14>1&&x%14<5&&y%14>1&&y%14<5)):r()>.5;if(on)o+=`<rect x="${x*c}" y="${y*c}" width="${c}" height="${c}"/>`}
 return `<svg viewBox="0 0 ${n*c} ${n*c}" width="180" height="180" style="background:#fff;padding:10px;border-radius:14px" fill="#0B1B27">${o}</svg>`}
const ranked=()=>Object.values(C).filter(c=>c.calls>=10).sort((a,b)=>b.win-a.win||b.avg-a.avg);
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
  <div class="phead"><span class="pname">${esc(k.c)}</span>${vbadge(k.c)}${r&&!k.sponsored?`<span class="rk">#${r}</span>`:''}${k.sponsored?'<span class="tag">Sponsored</span>':''}${k.c!==S.me?`<button class="fchip${S.following.has(k.c)?' on':''}" data-act="follow" data-h="${k.c}" aria-label="${S.following.has(k.c)?'Following':'Follow'} ${esc(k.c)}">${S.following.has(k.c)?ic('check',12)+'<span>Following</span>':'+<span>Follow</span>'}</button>`:''}<time>${k.ago==='now'?'now':k.ago+' ago'}</time>${k.sponsored?'':moreBtn(k)}</div>
  <p class="ptext">${esc(k.thesis)}</p>${mediaGrid(k.media)}
  <a class="ccard" href="#/token/${t.key}">${tokav(t.key)}<div class="cn"><b>${esc(t.name)}</b><span>$${t.sym} <span class="chain">${t.chain}</span></span></div>${right}</a>
  ${k.sponsored?`<div class="pnote">Paid promotion by ${esc(k.sponsor)}. Not counted in rankings.</div>`:`<div class="pnote">${k.target?`Target ${fmtUsd(k.target)} within ${esc(k.horizon)} · `:''}${k.buy?`<span class="bk">${ic('check',13)} Bought in</span>`:`<span class="bk no">No buy · earns no fees</span>`}${k.sold?` · <span class="sold">${ic('repost',13)} Caller sold ${k.sold.pct}% · ${k.sold.ago} ago</span>`:''}</div>`}
  <div class="pbar"><div class="icons">
   <button class="act" data-act="reply" aria-label="Reply">${ic('reply',18)}<span class="num">${k.replies||''}</span></button>
   <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',18)}<span class="num">${k.reposts||''}</span></button>
   <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',18,k.liked)}<span class="num">${k.likes||''}</span></button>
   <span class="act views" aria-label="Views">${ic('views',18)}<span class="num">${fmtK(k.views||0)}</span></span>
   <button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',18)}</button></div>
   ${p===null?'':`<span class="pright"><a class="mc num ${nums(k).up?'up':'down'}" href="#/token/${t.key}" data-mc="${k.id}" title="Trade $${t.sym}">${fmtUsd(mcap(t))}<small>MC</small></a>${tradable(t)?`<span class="bsrow"><button class="btn primary sm buyb" data-act="qbuy" data-t="${t.key}" data-id="${k.id}">Buy</button>${S.connected&&S.bal[t.key]>0?`<button class="btn sm sellq" data-act="qsell" data-t="${t.key}" data-id="${k.id}">Sell</button>`:''}</span>`:''}</span>`}
  </div></div></article>`}

/* ---------- ads ---------- */
const adMedia=a=>`<div class="admedia" style="background:linear-gradient(135deg,${a.g[0]},${a.g[1]})"><b>${esc(a.title)}</b>${ic(a.ic,40)}</div>`;
function adPost(a){return `<article class="post">
 <span class="av md" style="background:${a.g[0]}">${esc(a.brand.slice(0,2).toUpperCase())}</span>
 <div style="min-width:0"><div class="phead"><span class="pname">${esc(a.brand)}</span><span class="hint">@${esc(a.h)}</span><span class="tag">Ad</span></div>
 <p class="ptext">${esc(a.text)}</p>
 <div class="adcard" data-act="adclick" data-id="${a.id}">${adMedia(a)}<div class="adfoot"><div><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></div><button class="btn sm primary" data-act="adclick" data-id="${a.id}">${esc(a.cta)}</button></div></div>
 <div class="pnote">Promoted. Not a call and not counted in rankings.</div></div></article>`}
function withAds(list){let out='',n=0;list.forEach((k,i)=>{out+=post(k);if((i+1)%AD_EVERY===0&&i<list.length-1)out+=adPost(ADS[(S.adRot+n++)%ADS.length])});return out}
function adBoard(){const a=ADS[S.board%ADS.length];
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
 return `${tabs}<div class="swap${side?' side-'+side:''}"><div class="box"><div class="row"><span class="hint">${side==='sell'?'You sell':'You pay'}</span><span class="balx"><span class="hint num">Balance ${fmtAmt(S.bal[w.from]||0)}</span>${quick}</span></div>
  <div class="row"><input class="amt num" inputmode="decimal" placeholder="0" value="${esc(w.amt)}" data-swap="amt" aria-label="Amount to pay">${tbtn('from',w.from)}</div>
  <div class="hint num">${a?fmtUsd(usd(w.from,a)):'$0'}</div></div>
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
const renderSwaps=()=>document.querySelectorAll('[data-swapbox]').forEach(el=>el.innerHTML=swapHTML(el.dataset.tok||null));

/* ---------- views ---------- */
function homeTabs(){return catBar()+`<div class="tabs" role="tablist">${[['foryou','For you'],['following','Following'],['community','Community'],['watchlist','Watchlist']].map(([k,l])=>`<button role="tab" aria-selected="${S.tab===k}" class="${S.tab===k?'on':''}" data-act="tab" data-f="${k}">${l}</button>`).join('')}</div>`}
function vHome(){let list=calls.filter(k=>visible(k)&&catOf(k)===S.cat),empty=catEmpty();
 if(S.cat==='perps'&&S.tab!=='community')return homeTabs()+perpsLocked();
 if(S.tab==='community')return homeTabs()+vCommunity();
 if(S.live==='wait')return homeTabs()+`<div id="feed" aria-busy="true">${Array.from({length:4},()=>`<div class="post pskel" aria-hidden="true"><span class="av md"></span><div><i></i><i></i><i></i><b></b></div></div>`).join('')}<p class="sr-only" role="status">Loading live calls</p></div>`;
 if(S.tab==='following'){list=list.filter(k=>S.following.has(k.c));
  empty=`<div class="pad"><div class="empty" style="padding:28px 12px 8px"><b class="h2">Follow callers you trust</b><p>Their calls land here the moment they post.</p></div>
  ${ranked().slice(0,4).map(c=>`<div class="sugg">${avatar(c.h,'md')}<div class="grow"><a class="pname" href="#/profile/${c.h}">${c.h}</a><div class="hint">${c.win}% win rate over ${c.calls} calls</div></div><button class="btn sm primary" data-act="follow" data-h="${c.h}">Follow</button></div>`).join('')}</div>`}
 if(S.tab==='watchlist'){list=list.filter(k=>S.watch.has(k.t));
  empty=`<div class="empty"><b class="h2">Your watchlist is empty</b><p>Tap the star on any token to add it. Every new call on it shows up here.</p><a class="btn primary" href="#/market">Browse the market</a></div>`}
 return `${homeTabs()}
 <div class="newpill" id="newpill">${S.queued.length&&S.tab==='foryou'?newPill():''}</div>
 ${S.tab==='foryou'&&S.cat==='meme'?topCalls():''}
 <div id="feed">${(S.tab==='foryou'?withAds(list):list.map(post).join(''))||empty}</div>`}
const newPill=()=>`<button data-act="shownew">${S.queued.slice(0,2).map(k=>avatar(k.c)).join('')}<span style="margin-left:${S.queued.length>1?-8:0}px"></span>New calls</button>`;

function vMarket(){const rows=Object.values(T).filter(t=>!t.base);
 return `<div class="tablewrap"><table><thead><tr><th>Token</th><th>Price</th><th>Market cap</th><th>24h</th><th>Calls</th><th></th></tr></thead><tbody>
 ${rows.map(t=>`<tr data-go="#/token/${t.key}"><td><div class="person">${tokav(t.key)}<div>${esc(t.name)}<div class="hint">$${t.sym} <span class="chain">${t.chain}</span></div></div></div></td>
 <td class="num">${t.prelaunch?'—':fmtPrice(t.price)}</td><td class="num">${t.prelaunch?'Launches '+t.prelaunch:fmtUsd(mcap(t))}</td><td class="num ${t.chg>=0?'up':'down'}">${t.prelaunch?'':fmtPct(t.chg)}</td><td class="num">${calls.filter(k=>k.t===t.sym).length}</td>
 <td><button class="ib" data-act="track" data-t="${t.key}" aria-label="Add ${t.sym} to watchlist" style="color:${S.watch.has(t.key)?'var(--hi)':'var(--muted)'}">${ic('star',20,S.watch.has(t.key))}</button></td></tr>`).join('')}</tbody></table></div>`}

const ageStr=h=>h<1/60?Math.max(1,Math.round(h*3600))+'s':h<1?Math.round(h*60)+'m':h<48?Math.round(h)+'h':Math.round(h/24)+'d';
const mcCls=m=>m>=1e5?'mb':m>=2e4?'up':'my';
function trenchStats(t){if(t.live){const L=t.L||{},a=L.audit||{},bs=(L.buys24||0)+(L.sells24||0);
  return {top:a.top10==null?null:Math.round(a.top10),dev:a.dev==null?null:Math.round(a.dev*10)/10,snip:null,ins:null,fees:null,tx:bs,buys:bs?L.buys24/bs:.5}}
 const r=rng(t.seed*97);const pct=(a,b)=>Math.round(a+r()*(b-a));
 if(!t._x)t._x={top:pct(0,t.ageH<1?9:3),dev:t.ageH<1?pct(8,38):pct(0,2),snip:pct(0,t.ageH<1?4:1),ins:pct(0,26),fees:(t.vol/1e6)*(20+r()*40),tx:Math.round(t.vol/(60+r()*40)),buys:.45+r()*.3};return t._x}
/* ---------- trenches: feeds, filters, display ---------- */
const LPS=[['Pump','#4ADE80'],['Bonk','#F59E0B'],['Believe','#22C55E'],['Moonshot','#C084FC'],['Launchlab','#38BDF8'],['Bags','#10B981'],['Jup Studio','#FB923C']];
const CHAINS=[['Solana','#9d7bff',1],['Base','#3B82F6',0],['BSC','#F0B90B',0],['Ethereum','#8EA2FF',0],['Arbitrum','#60A5FA',0]];
const FEEDS={movers:['Movers','Biggest price momentum right now','Recommended'],new:['New','Fresh launches, newest first'],called:['Called','Tokens our callers are on, most calls first','Only on Callit'],
 crowded:['Crowded','Most holders first'],almost:['Almost there','60 to 99% through the bonding curve'],grad:['Graduated','Just finished the bonding curve, newest first'],og:['OG memes','The established Solana memecoins, biggest first']};
const RISK={degen:['Degen','Show me everything',{top:100,dev:100,snip:100,ins:100}],balanced:['Balanced','Filter the obvious traps',{top:30,dev:15,snip:10,ins:30}],careful:['Careful','Only clean holder books',{top:15,dev:5,snip:3,ins:15}]};
const isLaunch=t=>!t.live||!!t.lp;
/* Bonding progress. Live tokens: approximated from market cap (pump-style curves finish near $69K). */
const bond=t=>t.live&&!t.lp?100:Math.min(100,mcap(t)/69e3*100);
const lpOf=t=>t.live?t.lp:(t.lp||(t.lp=LPS[t.seed%LPS.length][0]));
const callsOn=t=>calls.filter(k=>k.t===t.key&&!k.sponsored);
const defFil=()=>({chains:['Solana'],lps:LPS.map(l=>l[0]),inc:'',exc:'',bmin:'',bmax:'',mcMin:'',mcMax:'',volMin:'',hMin:'',ageMax:0,top:100,dev:100,snip:100,ins:100,x:0,web:0,comm:0,called:0,topc:0,bought:0,tf:'1h',chgMin:''});
const defDisp=()=>({pro:1,spark:0,heat:1,compact:0});
const defFeeds=()=>[['movers',1],['new',1],['og',1],['called',1],['crowded',0],['almost',0],['grad',0]];
const TS=(()=>{let v={};try{v=JSON.parse(localStorage.getItem('callit.trenches')||'{}')}catch(_){}
 let feeds=Array.isArray(v.feeds)?v.feeds.filter(f=>FEEDS[f[0]]):defFeeds();defFeeds().forEach(d=>{if(!feeds.some(f=>f[0]===d[0]))feeds.push(d)});
 return {disp:{...defDisp(),...(v.disp||{})},feeds,fil:v.fil||{}}})();
const saveTS=()=>{try{localStorage.setItem('callit.trenches',JSON.stringify(TS))}catch(_){}};
const filOf=k=>({...defFil(),...(TS.fil[k]||{})});
const parseAmt=v=>{v=String(v||'').trim().toUpperCase().replace(/[$,\s]/g,'');if(!v)return null;const n=parseFloat(v);if(isNaN(n))return null;return n*(v.endsWith('B')?1e9:v.endsWith('M')?1e6:v.endsWith('K')?1e3:1)};
const words=v=>String(v||'').toLowerCase().split(',').map(w=>w.trim()).filter(Boolean);
function match(t,f){const x=trenchStats(t),m=mcap(t),b=bond(t),nm=(t.name+' '+t.sym).toLowerCase(),n=parseAmt,cs=callsOn(t);
 if(!f.chains.includes(t.chain)||(lpOf(t)&&!f.lps.includes(lpOf(t))))return false;
 const inc=words(f.inc),exc=words(f.exc);if(inc.length&&!inc.some(w=>nm.includes(w)))return false;if(exc.some(w=>nm.includes(w)))return false;
 if(f.bmin!==''&&b<+f.bmin)return false;if(f.bmax!==''&&b>+f.bmax)return false;
 if(n(f.mcMin)!=null&&m<n(f.mcMin))return false;if(n(f.mcMax)!=null&&m>n(f.mcMax))return false;
 if(n(f.volMin)!=null&&t.vol<n(f.volMin))return false;if(n(f.hMin)!=null&&t.holders<n(f.hMin))return false;
 if(f.ageMax&&t.ageH>f.ageMax)return false;
 if(f.chgMin!==''&&f.chgMin!=null&&!isNaN(parseFloat(f.chgMin))){const v=chgOf(t,f.tf||'1h');if(v==null||v<parseFloat(f.chgMin))return false}
 if(x.top>f.top||x.dev>f.dev||x.snip>f.snip||x.ins>f.ins)return false;
 const soc=t.soc||'';if(f.x&&!soc.includes('x')||f.web&&!soc.includes('w')||f.comm&&!soc.includes('c'))return false;
 if(f.called&&!cs.length)return false;if(f.topc&&!cs.some(k=>(rankOf(k.c)||99)<=3))return false;if(f.bought&&!cs.some(k=>k.buy))return false;
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
function trow(t){const x=trenchStats(t),m=mcap(t),y=t.ageH<1,red=(v,lim)=>v==null?'muted':v>lim?'down':'up',pv=v=>v==null?'—':v+'%',D=TS.disp,b=bond(t),tf=S.rowTf||'1h',cv=chgOf(t,tf),fl=t._pm&&t._pm!==m?(m>t._pm?' fl-up':' fl-dn'):'';t._pm=m;
 const soc=(t.soc||'').split('').map(c=>({x:ic('xlogo',15),w:ic('globe',15),c:ic('people',15)})[c]).join('');
 return `<a class="trow${D.compact?' compact':''}${D.pro?'':' lite'}" href="#/token/${t.key}"><span class="tav ${t.chg>=0?'ok':'bad'}" style="--b:${b.toFixed(0)}%">${tokav(t.key)}<i class="chainb">${ic('solglyph',11)}</i></span>
 <div class="tmid"><div class="tname"><b>${esc(t.name)}</b>${t.hot?'<span class="hot">HOT</span>':''}</div>
 <div class="tsub"><span>${esc(t.sym)}</span><span class="${y?'my':'up'}">${ic('sprout',13)}${ageStr(t.ageH)}</span><span class="soc">${soc}</span></div>${D.heat?heat(t):''}</div>
 ${D.pro?`<div class="tst num"><span class="up" title="Holders">${ic('profile',13)}${fmtK(t.holders)}</span><span class="${red(x.top,10)}" title="Top 10 holders">${ic('target',13)}${pv(x.top)}</span><span class="${red(x.dev,10)}" title="Dev holding">${ic('stake',13)}${pv(x.dev)}</span>${x.snip==null?'':`<span class="${red(x.snip,5)}" title="Snipers">${ic('sniper',13)}${pv(x.snip)}</span>`}${x.ins==null?'':`<span class="${red(x.ins,15)}" title="Insiders">${ic('crown',13)}${pv(x.ins)}</span>`}<em class="tchg ${pcls(cv)}" title="Price change, ${tf}">${pctS(cv)}<small>${tf}</small></em></div>`:''}
 <div class="tr num">${D.spark?spark(t):''}<div>${D.pro?`<span class="k">V</span> ${fmtUsd(t.vol).replace(/\.\d+([KMB])/,'$1')} `:''}<span class="k">MC</span> <b class="${mcCls(m)}${fl}" data-tmc="${t.key}">${fmtUsd(m)}</b></div>
 ${D.pro?`<div>${x.fees==null?`<span class="k">B/S</span> ${Math.round(x.buys*100)}%`:`<span class="k">F</span> ${ic('solglyph',12)} ${x.fees.toFixed(2)}`}</div><div class="bs"><i style="flex:${x.buys}"></i><i style="flex:${1-x.buys}"></i></div><div><span class="k">TX</span> ${fmtK(x.tx)}</div>`:`<div class="${pcls(cv)}">${pctS(cv)} <small class="muted">${tf}</small></div>`}</div></a>`}
const skelRows=()=>Array.from({length:8},()=>`<div class="trow skel" aria-hidden="true"><span class="tav"><span class="tokav"></span></span><div class="tmid"><i></i><i></i></div><div class="tr"><i></i></div></div>`).join('')+'<p class="sr-only" role="status">Loading live tokens</p>';
function vTrenches(){const on=TS.feeds.filter(f=>f[1]).map(f=>f[0]);if(S.tt!=='watch'&&!on.includes(S.tt))S.tt=on[0]||'watch';
 const f=filOf(S.tt);S.rowTf=f.tf||'1h';const rows=feedRows(S.tt,f),n=activeCount(f);
 const tab=(k,l)=>`<button role="tab" aria-selected="${S.tt===k}" class="${S.tt===k?'on':''}" data-act="tt" data-f="${k}">${l}</button>`;
 return `<div class="ttabs"><div class="tscroll" role="tablist">${tab('watch',ic('star',18,S.tt==='watch'))}${on.map(k=>tab(k,FEEDS[k][0])).join('')}</div>
 <span class="ttools"><button class="ib" data-act="fsopen" aria-label="Filters${n?`, ${n} active`:''}">${ic('filter',20)}${n?`<span class="fbadge">${n}</span>`:''}</button><button class="ib" data-act="dsopen" aria-label="Display settings">${ic('gear',20)}</button></span></div>
 <div class="tfbar"><span class="tflive"><i></i>Live</span><span class="muted tflbl">${S.tt==='movers'?'Top gainers':'% change'}</span><div class="seg tfseg" role="tablist" aria-label="Timeframe">${TF_OK.map(x=>`<button role="tab" aria-selected="${S.rowTf===x}" class="${S.rowTf===x?'on':''}" data-act="ttf" data-f="${x}">${x}</button>`).join('')}</div></div>
 ${n?`<div class="fline"><span>${n} filter${n>1?'s':''} on ${S.tt==='watch'?'Watchlist':FEEDS[S.tt][0]}</span><button data-act="fsclear1">Clear</button></div>`:''}
 <div>${rows===null?((lfIds(S.tt,f)||[]).some(id=>LIVE.err[id])?`<div class="empty"><b class="h2">Live data is taking a break</b><p>We couldn't reach the market feed. It usually comes back in a few seconds.</p><button class="btn primary" data-act="lretry">Try again</button></div>`:skelRows()):rows.map(trow).join('')||`<div class="empty"><b class="h2">${S.tt==='watch'?'No watchlist tokens yet':'Nothing matches'}</b><p>${S.tt==='watch'?'Open any token and tap Watchlist to pin it here.':'Loosen the filters or try another feed.'}</p>${n?'<button class="btn primary" data-act="fsclear1">Clear filters</button>':''}</div>`}</div>
 <p class="hint pad">Degen zone. New tokens are high risk. Row icons: holders, top 10, dev, snipers, insiders. The ring around each token fills as it moves through its bonding curve.</p>`}

/* ---------- bottom sheet ---------- */
let SH=null;
function openSheet(kind){SH={kind,tab:'source',d:kind==='f'?JSON.parse(JSON.stringify(filOf(S.tt))):null};
 $('#sheet').innerHTML=`<div class="sh-scrim" data-act="shclose"></div><div class="sh" role="dialog" aria-modal="true" aria-label="${kind==='f'?'Filters':'Display settings'}"><div class="sh-grab"></div><div id="shin"></div></div>`;
 drawSheet();requestAnimationFrame(()=>$('#sheet').classList.add('open'))}
function closeSheet(){const s=$('#sheet');if(!s.innerHTML)return;s.classList.remove('open');SH=null;setTimeout(()=>{if(!SH)s.innerHTML=''},220)}
const sw=(act,on,extra='')=>`<button class="sw${on?' on':''}" role="switch" aria-checked="${!!on}" data-act="${act}" ${extra}><i></i></button>`;
function drawSheet(){const el=$('#shin');if(!el||!SH)return;const body=el.querySelector('.sh-body'),top=body?body.scrollTop:0;
 el.innerHTML=SH.kind==='f'?filterSheet():displaySheet();const nb=el.querySelector('.sh-body');if(nb)nb.scrollTop=top}
function fsCount(){const r=feedRows(S.tt,SH.d);return r?r.length:-1}
const fsBtn=n=>n<0?'Loading…':n?`Show ${n} token${n>1?'s':''}`:'No tokens match';
function filterSheet(){const d=SH.d,T2=SH.tab,feed=S.tt==='watch'?'Watchlist':FEEDS[S.tt][0];
 const tabs=[['source','Source'],['metrics','Metrics'],['safety','Safety'],['social','Social']];
 const chip=(grp,v,col,on,soon)=>`<button class="chip${on?' on':''}" style="--c:${col}" data-act="fschip" data-g="${grp}" data-v="${v}" ${soon?'disabled':''}><i></i>${v}${soon?'<small>soon</small>':''}</button>`;
 const rng2=(lbl,a,b,pa,pb,hint)=>`<div class="fgrp"><div class="fh"><b>${lbl}</b>${hint?`<span>${hint}</span>`:''}</div><div class="pair"><input class="input num" data-fk="${a}" value="${esc(d[a])}" placeholder="${pa}" inputmode="decimal"><span>to</span>${b?`<input class="input num" data-fk="${b}" value="${esc(d[b])}" placeholder="${pb}" inputmode="decimal">`:'<span class="muted">no cap</span>'}</div></div>`;
 let h='';
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
  h=`<div class="fgrp"><div class="fh"><b>Callit signal</b></div>${row('called','Has calls','At least one caller is on it','Only on Callit')}${row('topc','Called by a top 3 caller','Leaderboard top 3 only')}${row('bought','Caller bought in','A caller has real money in it')}</div>
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

function vSwap(){return `<div class="pad"><div class="card" style="max-width:460px;margin:0 auto"><h3>Swap</h3><div data-swapbox></div></div></div>`}

function soon(title,text){return `<div class="soon"><span class="mark"></span><b class="h2">${title}</b><p>${text}</p></div>`}

const pctS=v=>v==null?'—':(v>=0?'+':'')+(Math.abs(v)>=100?Math.round(v):v.toFixed(1))+'%';
const pcls=v=>v==null?'muted':v>=0?'up':'down';
function vTokenLoading(mint){const e=LIVE.tokErr[mint];
 if(e==='gone')return `<div class="empty" style="padding-top:60px"><b class="h2">Token not found</b><p>No trading pool for this address on Solana yet. Double-check the contract address.</p><a class="btn primary" href="#/market">Browse the market</a></div>`;
 if(e)return `<div class="empty" style="padding-top:60px"><b class="h2">Couldn't load this token</b><p>The market feed didn't answer. Try again in a moment.</p><button class="btn primary" data-act="ltokretry" data-t="${esc(mint)}">Try again</button></div>`;
 return `<div class="pad lskel" aria-busy="true"><div class="lsk-h"><span class="tokav"></span><div><i></i><i></i></div></div><i class="lsk-p"></i><div class="lchart"><div class="lchart-msg">Loading token…</div></div><div class="stats num">${'<div><span>&nbsp;</span><b>&nbsp;</b></div>'.repeat(5)}</div></div>`}
function liveStats(t){const L=t.L||{},c=L.chg||{},bs=(L.buys24||0)+(L.sells24||0);
 return `<div class="stats num"><div><span>Market cap</span><b>${fmtSmall(mcap(t))}</b></div><div><span>Price</span><b>${fmtSmall(t.price)}</b></div><div><span>Liquidity</span><b>${t.liq?fmtSmall(t.liq):'—'}</b></div><div><span>24h volume</span><b>${t.vol?fmtSmall(t.vol):'—'}</b></div><div><span>Holders</span><b>${t.holders?t.holders.toLocaleString():'—'}</b></div><div><span>Age</span><b>${esc(t.age)}</b></div></div>
 <div class="lchg num">${[['5m',c.m5],['1h',c.h1],['6h',c.h6],['24h',c.h24]].map(([k,v])=>`<span><i>${k}</i><b class="${pcls(v)}">${pctS(v)}</b></span>`).join('')}</div>
 ${bs?`<div class="lbs num"><b class="up">${fmtK(L.buys24||0)} buys</b><div class="bs"><i style="flex:${L.buys24||0}"></i><i style="flex:${L.sells24||0}"></i></div><b class="down">${fmtK(L.sells24||0)} sells</b>${L.traders24?`<span class="muted">· ${fmtK(L.traders24)} traders</span>`:''}</div>`:''}`}
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
function vLiveToken(t){const key=t.key,tr=S.watch.has(key),on=calls.filter(k=>k.t===key),L=t.L||{},ch=(L.chg||{}).h24;
 S.ltf=S.ltf||'15m';S.lmode=S.lmode||'mc';
 return `<div class="pad" style="padding-bottom:0"><div style="display:flex;align-items:center;gap:12px">${tokav(key)}<div style="flex:1;min-width:0"><b class="h2">${esc(t.name)}</b>${L.verified?`<span class="vbadge" title="Verified on Jupiter">${ic('check',11)}</span>`:''} <span class="muted">$${esc(t.sym)}</span>
 <div><span class="chain">Solana</span>${t.lp?` <span class="chain lpchip">${esc(t.lp)}</span>`:''} <button class="copyca" data-act="copy" data-v="${esc(t.ca)}">${short(t.ca)} ${ic('copy',13)}</button></div></div>
 <button class="btn sm ${tr?'primary':'ghost'}" data-act="track" data-t="${key}">${ic('star',15,tr)} ${tr?'On watchlist':'Watchlist'}</button></div>
 <div class="lhead"><span class="price num" id="lprice">${S.lmode==='mc'?fmtSmall(mcap(t)):fmtSmall(t.price)}</span><b class="num ${pcls(ch)}" id="lchg">${pctS(ch)} 24h</b><span class="livedot" title="Live">LIVE</span>
 <div class="seg lmode">${[['mc','MC'],['price','Price']].map(([k,l])=>`<button class="${S.lmode===k?'on':''}" data-act="lmode" data-f="${k}">${l}</button>`).join('')}</div></div>
 <div class="seg ltf" role="tablist">${['1m','5m','15m','1h','4h','1d'].map(x=>`<button class="${S.ltf===x?'on':''}" data-act="ltf" data-f="${x}">${x}</button>`).join('')}</div>
 <div class="lchart" id="lchart" data-mint="${key}"><div class="lchart-msg" id="lchartmsg">${t.pool?'Loading chart…':'No trading pool for a chart yet.'}</div></div>
 <div id="lstats">${liveStats(t)}</div>
 <div class="llinks">${liveLinks(t)}</div>
 ${(sc=>`<details class="card sfcard" data-sf ${(SFOPEN==null?sc.bad:SFOPEN)?'open':''}><summary><h3>Safety check</h3><span class="sfbadge ${!sc.n?'unk':sc.bad?(sc.ok>=sc.n-1&&!(t.L&&t.L.audit&&t.L.audit.sus)?'warn':'bad'):'ok'}">${sc.n?`${sc.ok}/${sc.n} passed`:'No data'}</span><span class="sfchev" aria-hidden="true">${ic('down',18)}</span></summary><div class="sflist">${liveSafety(t)}</div><p class="hint" style="margin:10px 0 0">From Jupiter's token audit. Not a guarantee. Always size your bets.</p></details>`)(sfScore(t))}
 <div class="card"><h3>Trade $${esc(t.sym)}</h3><div data-swapbox data-tok="${key}"></div></div>
 <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 4px"><b class="h2">Calls on $${esc(t.sym)}</b><button class="btn sm primary" data-act="newcall" data-t="${key}">Call it</button></div></div>
 <div id="feed" style="border-top:1px solid var(--line);margin-top:10px">${on.map(post).join('')||'<div class="empty"><b>No calls yet</b><p>Call it first and your entry gets stamped at the live market cap.</p></div>'}</div>`}
/* Light refresh of a live token page without touching the chart. */
function liveTick(t){const pr=$('#lprice'),cg=$('#lchg'),st=$('#lstats');if(!pr)return;const ch=((t.L||{}).chg||{}).h24;
 pr.textContent=S.lmode==='mc'?fmtSmall(mcap(t)):fmtSmall(t.price);cg.className='num '+pcls(ch);cg.textContent=pctS(ch)+' 24h';st.innerHTML=liveStats(t);renderSwaps()}
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

function vLeaders(){return `<div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted">Ranked by win rate. Minimum 10 calls. Sponsored calls don't count.</span>
 <div class="seg">${['7d','30d','All time'].map(x=>`<button class="${S.lb===x?'on':''}" data-act="lb" data-f="${x}">${x}</button>`).join('')}</div></div>
 <div class="tablewrap" style="border-top:1px solid var(--line)"><table><thead><tr><th>Rank</th><th>Caller</th><th>Win rate</th><th>Avg return</th><th>Calls</th><th>Best call</th><th></th></tr></thead><tbody>
 ${ranked().map((c,i)=>`<tr data-go="#/profile/${c.h}"><td class="rkc">${i+1}</td><td><div class="person">${avatar(c.h)}${c.h}</div></td><td class="num">${c.win}%</td><td class="num up">${fmtPct(c.avg)}</td><td class="num">${c.calls}</td><td class="num up">${fmtPct(c.best)}</td>
 <td><button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button></td></tr>`).join('')}</tbody></table></div>
 <p class="hint pad">A call wins if it hits its target, or is up at least 50% when its time window closes. Only calls backed by a buy earn caller fees.</p>`}

function vWallet(){if(!S.connected)return `<div class="empty"><b class="h2">No wallet connected</b><p>Sign in with email, Google or X and we create a wallet for you. Or connect Phantom, Solflare or Backpack. You always hold your own keys.</p><button class="btn primary" data-act="connect">Connect wallet</button></div>`;
 const rows=Object.entries(S.bal).filter(([k,a])=>a>0&&T[k]).sort((x,y)=>(usd(y[0],y[1])||0)-(usd(x[0],x[1])||0)),tot=rows.reduce((s,[k,a])=>s+(usd(k,a)||0),0);
 return `<div class="pad"><div class="muted">Total balance</div><div class="bal num">${fmtUsd(tot)}</div>${(()=>{const st=statsOf(S.me);return st.n?`<div class="wpnl num"><span class="${st.pnl>=0?'up':'down'}">${money(st.pnl)}</span> all-time PnL${st.vol?` · ${fmtUsd(st.vol)} volume`:''}</div>`:''})()}
 <button class="copyca" style="margin-top:10px" data-act="copy" data-v="${S.addr}">${short(S.addr)} ${ic('copy',13)}</button>
 <div class="acts2"><button class="btn primary" data-act="deposit">${ic('down',16)} Deposit</button><button class="btn" data-act="withdraw">${ic('up',16)} Withdraw</button></div>
 <div class="list">${(()=>{const B=pnlBook();return rows.map(([k,a])=>{const x=posPnl(k,B);return holdRow(k,a,usd(k,a)||0,x?x.pnl:null,x?x.pct:null,1)}).join('')})()}</div>
 <b class="h2" style="display:block;margin:22px 0 4px">History</b><div class="list">${S.activity.map(a=>`<div class="li"><div class="grow"><b>${esc(a.k)}</b><div class="hint">${esc(a.t)}${a.sig?` · <a class="lnk" href="https://solscan.io/tx/${a.sig}" target="_blank" rel="noopener noreferrer">View</a>`:''}</div></div><div class="r num">${esc(a.d)}</div></div>`).join('')||'<div class="empty" style="padding:18px 8px"><b>No history yet</b><p>Deposits, trades and withdrawals show up here.</p></div>'}</div></div>`}

function vProfile(h){if(!h&&S.connected)h=S.me;if(h&&!C[h]&&/^[A-Za-z0-9_]{1,30}$/.test(h)){C[h]={h,win:0,avg:0,calls:0,best:0,followers:0,real:1}}if(h&&h!==S.me&&!PUB[h])loadPub(h);const c=C[h];
 if(!c)return `<div class="empty"><b class="h2">Your profile</b><p>Connect a wallet to create your caller profile and start building a track record.</p><button class="btn primary" data-act="connect">Connect wallet</button></div>`;
 if(S.ptabFor!==h){S.ptab='calls';S.ptabFor=h}
 if(S.blocked.has(h))return blockedView(h);
 const mine=calls.filter(k=>k.c===h),me=h===S.me,r=rankOf(h),f=S.following.has(h);
 const pb=PUB[h]&&!PUB[h].pending?PUB[h]:null,P=me?PROF:pubP(h),nm=P.name||h,fg=me?S.following.size:pb?pb.following:followingOf(h).length,fr=me?(S.followers!=null?S.followers:followersOf(h).length):pb?pb.followers:c.followers+(f?1:0);
 return `<div class="banner" style="${bannerBg(h)}">${me?`<button class="bnadd" data-act="editprof" data-f="banner" aria-label="${PROF.banner?'Change':'Add a'} banner">${ic('camera',20)}<span>${PROF.banner?'Change banner':'Add a banner'}</span></button>`:''}</div>
 <div class="phero"><div class="top"><span class="avwrap">${avatar(h,'lg')}${r&&r<=3?`<span class="rkbadge">#${r}</span>`:''}</span>${me?'<span style="display:flex;gap:8px"><button class="ib" data-act="shprof" data-h="'+esc(h)+'" aria-label="Share your profile">'+ic('share',18)+'</button><button class="btn sm editp" data-act="editprof">'+ic('pen',15)+' Edit profile</button></span>':`<span style="display:flex;gap:8px"><button class="ib" data-act="shprof" data-h="${esc(h)}" aria-label="Share ${esc(h)}'s profile">${ic('share',18)}</button><button class="ib" data-act="profmenu" data-h="${h}" aria-label="More options for ${esc(h)}">${ic('more',18)}</button><button class="ib" data-act="dm" data-h="${h}" aria-label="Message ${esc(h)}">${ic('messages',18)}</button><button class="btn sm ${f?'ghost':'primary'}" data-act="follow" data-h="${h}">${f?'Following':'Follow'}</button></span>`}</div>
 <div class="pname2"><b class="h2">${esc(nm)}</b>${vbadge(h)}${r?`<span class="rk">${ic('leaderboard',13)} Rank #${r}</span>`:''}</div><div class="muted">@${esc(h)}</div>
 ${P.bio?`<p class="pbio">${esc(P.bio)}</p>`:me?`<p class="pbio muted">Add a bio so people know what you call. <button class="lnk" data-act="editprof" style="padding:0">Add bio</button></p>`:''}
 <div class="pmeta">${P.web?`<a href="${esc(/^https?:/.test(P.web)?P.web:'https://'+P.web)}" target="_blank" rel="noopener">${ic('globe',15)} ${esc(P.web.replace(/^https?:\/\//,''))}</a>`:''}${P.x?`<a href="https://x.com/${esc(P.x.replace('@',''))}" target="_blank" rel="noopener">${ic('xlogo',14)} @${esc(P.x.replace('@',''))}</a>`:''}<span>${ic('wallet',15)} ${me&&S.addr?short(S.addr):'Solana caller'}</span></div>
 <div class="pfollow"><button data-act="follows" data-h="${h}" data-f="following"><b>${fmtK(fg)}</b> Following</button><button data-act="follows" data-h="${h}" data-f="followers"><b>${fmtK(fr)}</b> Followers</button><a class="rkchip${r?' on':''}" href="#/leaderboard">${ic('leaderboard',14)}${r?`Rank <b>#${r}</b>`:'Unranked'}</a></div>
 ${r?'':`<p class="hint" style="margin:6px 0 0">Not ranked yet. 10 calls to qualify for the leaderboard.</p>`}
 <div class="pstats p6 num">${(()=>{const st=statsOf(h);return `<div><span>All-time PnL</span><b class="${st.n?(st.pnl>=0?'up':'down'):''}">${st.n?money(st.pnl):'—'}</b></div><div><span>Volume</span><b>${st.vol?fmtUsd(st.vol):'—'}</b></div>`})()}<div><span>Win rate</span><b>${c.calls?c.win+'%':'—'}</b></div><div><span>Avg return</span><b>${c.calls?fmtPct(c.avg):'—'}</b></div><div><span>Calls</span><b>${c.calls}</b></div><div><span>Best call</span><b>${c.best?fmtPct(c.best):'—'}</b></div></div></div>
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
 <p>Callers earn a share of fees when people trade through their calls, but only on calls they bought into with their own wallet. Skin in the game, visible on every call as position and profit. Projects on any chain can promote launches through top callers, always labelled as sponsored.</p>
 <p>Wallets are non-custodial. Sign in with email, Google or X, or bring Phantom, Solflare or Backpack.</p></div>`}

/* ---------- rail ---------- */
function rail(){return adBoard()+newsCard()+railRest()+`<div class="railfoot">${socials('sm')}<div class="legal" style="justify-content:flex-start"><button data-act="doc" data-f="terms">Terms</button><button data-act="doc" data-f="privacy">Privacy</button><span>© ${new Date().getFullYear()} Callit</span></div></div>`}
function railRest(){const lv=(LIVE.feeds['movers:1h']||[]).map(k=>T[k]).filter(t=>t&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase()));
 const trend=(lv.length?lv:Object.values(T).filter(t=>!t.base&&!t.prelaunch)).slice().sort((a,b)=>b.chg-a.chg).slice(0,4);
 return `<div class="card"><h3>Trending</h3><div class="list">${trend.map(t=>`<a class="li" href="#/token/${t.key}">${tokav(t.key)}<div class="grow"><b>$${t.sym}</b><div class="hint">${(n=>n+(n===1?' call':' calls'))(calls.filter(k=>k.t===t.key).length)}</div></div><div class="r num"><b>${fmtUsd(mcap(t))}</b><div class="hint ${t.chg>=0?'up':'down'}">${fmtPct(t.chg)}</div></div></a>`).join('')}</div></div>
 <div class="card"><h3>Top callers</h3><div class="list">${ranked().slice(0,4).map(c=>`<div class="li">${avatar(c.h)}<div class="grow"><a class="pname" href="#/profile/${c.h}">${c.h}</a><div class="hint">${c.win}% win rate</div></div><button class="btn sm ${S.following.has(c.h)?'ghost':'primary'}" data-act="follow" data-h="${c.h}">${S.following.has(c.h)?'Following':'Follow'}</button></div>`).join('')}</div>
 <a class="btn ghost block" style="margin-top:10px" href="#/leaderboard">See leaderboard</a></div>`}

/* ---------- chrome ---------- */
const NAV_A=[['home','Home'],['market','Market'],['notifications','Notifications'],['swap','Swap'],['stake','Stake'],['wallet','Wallet'],['profile','Profile']];
const NAV_B=[['leaderboard','Leaderboard'],['messages','Messages'],['lists','Lists'],['news','News'],['promote','Promote'],['about','About']];
const TITLES=Object.fromEntries([...NAV_A,...NAV_B,['token','Token'],['community','Community'],['post','Post'],['premium','Premium'],['messages','Messages']]);
P.lists=P.list;
const NAVH={stack:[],cur:location.hash||'#/home',back:false};
function goBack(){const prev=NAVH.stack.pop();NAVH.back=true;location.hash=prev&&prev!==location.hash?prev:'#/home'}
function chrome(route){const link=([k,l])=>`<a href="#/${k}" class="${route===k?'on':''}" title="${l}">${k==='notifications'?`<span class="nbadge">${ic('bell')}${unreadN()?`<i>${unreadN()}</i>`:''}</span>`:ic(k)}<span class="lbl">${l}</span></a>`;
 $('#navA').innerHTML=NAV_A.map(link).join('');$('#navB').innerHTML=NAV_B.map(link).join('');
 $('#acct').innerHTML=S.connected?`<button class="acct" data-act="disconnect" title="Disconnect">${avatar(S.me)}<span class="lbl" style="min-width:0"><b style="display:block">${esc(S.me)}</b><span class="hint num">${short(S.addr)}</span></span></button>`
  :`<button class="btn primary connect" data-act="connect" title="Connect wallet">${ic('wallet',20)}<span class="lbl">Connect wallet</span></button>`;
 $('#pill').innerHTML=`<button class="btn primary sm dep" data-act="deposit">${ic('down',15)}<span>Deposit</span></button>
  <button class="ib" data-act="theme" aria-label="Switch theme">${ic('sun')}</button>`;
 syncTray();
 $('#title').textContent=TITLES[route]||'Home';{const u=$('#upg'),on=isPrem(S.me);u.hidden=route!=='home';u.classList.toggle('on',!!on);u.innerHTML=`${ic('verified',18)}<span>Premium</span>`}const bk=$('#back');bk.hidden=route==='home';bk.innerHTML=ic('back',20)}

const isPhone=()=>matchMedia('(max-width:760px)').matches;
function syncTray(){const open=!document.body.classList.contains('collapsed'),b=$('#brand');b.setAttribute('aria-expanded',open);b.setAttribute('aria-label',open?'Close menu':'Open menu')}
let LCHART=null;
function mountLiveChart(){const el=$('#lchart');if(!el)return;const t=T[el.dataset.mint];if(!t||!t.pool)return;
 const msg=$('#lchartmsg');
 LCHART=mountChart(el,{pool:t.pool,mint:t.key,tf:S.ltf,factor:S.lmode==='mc'&&t.supply?t.supply:1,
  onState:st=>{if(!msg)return;msg.hidden=st==='ok';msg.textContent=st==='loading'?'Loading chart…':st==='empty'?'No trades in this timeframe yet.':'Chart is unavailable right now.'}})}
/* Keep live screens fresh. Paused when the tab is hidden. Market + open token every 6s, call tokens every 9s. */
let LTICK=0;setInterval(()=>{if(document.hidden)return;LTICK++;const [,r,p]=location.hash.split('/');
 if(r==='market'&&LTICK%2===0&&!document.querySelector('.sheet.open')){(lfIds(S.tt,filOf(S.tt))||[]).forEach(id=>loadFeed(id))}
 else if(r==='token'&&T[p]&&T[p].live&&LTICK%2===0)loadLiveToken(p,true);
 if(LTICK%3===0&&(!r||r==='home'||r==='post'||r==='profile'))refreshCallTokens();
 if(LTICK%7===0&&['wallet','token','swap','profile'].includes(r||'home'))loadBalances()},3000);
function render(){if(isPhone())document.body.classList.add('collapsed');const [,r0='home',p]=location.hash.split('/');const r=r0||'home';let html;
 if(r==='token'&&p&&!T[p]&&LIVEMAP[p]){location.replace('#/token/'+LIVEMAP[p]);return}
 if(r==='community')html=vRoom(p);
 else if(r==='post')html=vPost(p);
 else if(r==='token'){const t=T[p];if(t&&tradable(t)&&p!==S.swap.from){S.swap.from=S.swap.from===p?S.swap.from:(S.swap.from===S.swap.to||!T[S.swap.from]?'SOL':S.swap.from);S.swap.to=p}html=vToken(p)}
 else html=({market:vMarket,trenches:vMarket,swap:vSwap,wallet:vWallet,profile:()=>vProfile(p),leaderboard:vLeaders,promote:vPromote,about:vAbout,
  stake:()=>locked(`<div class="prem"><div class="phero2"><span class="pbig">${ic('stake',40)}</span><h2>Stake $CALLIT</h2><p>Opens when $CALLIT launches on mainnet.</p></div>
   <div class="pben">${[['verified','Unlock Premium','Keep Premium for as long as you stay staked.'],['wallet','Earn rewards','Get a share of protocol rewards while staked.'],['promote','Cheaper promotions','Discounts on ad slots and sponsored calls.'],['leaderboard','Your tokens stay yours','Non-custodial. Unstake after the lock ends.']].map(([i,t,d])=>`<div class="bcard"><span class="bic">${ic(i,20)}</span><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
   <div class="popt" style="margin-top:16px"><div class="pstake" style="margin:0 0 14px"><div><span>Your $CALLIT</span><b class="num">0</b></div><div><span>Staked</span><b class="num">0</b></div><div><span>Rewards</span><b class="num">0</b></div></div>
   <button class="btn primary block" data-act="stakewait">${S.stakeWait?'You\'re on the list':'Notify me at launch'}</button><a class="btn ghost block" href="#/premium" style="margin-top:8px">See Premium</a></div></div>`,'stake','$CALLIT staking is coming','Stake $CALLIT to keep Premium, earn protocol rewards and get cheaper promotions. Opens when $CALLIT launches on mainnet.',['Non-custodial: your tokens stay yours','Premium for as long as you stay staked']),
  messages:()=>vMessages(p),lists:()=>vLists(p),
  news:vNews,premium:vPremium,notifications:vNotifs}[r]||vHome)();
 if(LCHART){LCHART();LCHART=null}
 $('#view').innerHTML=html;$('#rail').innerHTML=rail();chrome(r);renderSwaps();skin($('#view'));syncLanding();mountLiveChart();
 if(r==='post'){wireAttach($('#rbox'),RDRAFT,()=>drawRMedia());if(S.focusReply){S.focusReply=false;setTimeout(()=>{const i=$('#rin');i&&i.focus()},60)}}}

/* ---------- modals ---------- */
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
const closeModal=()=>{$('#modal').innerHTML='';if(S.dirty){S.dirty=0;render()}};

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
 m=>{wireKind(m,'meme');let tok=null,sol='0.25',skip=false;const CD={media:[]};wireAttach($('#cbox',m),CD,()=>{$('#cmedia',m).innerHTML=mediaGrid(CD.media,1);$('#cbox [data-attn]',m).textContent=CD.media.length?CD.media.length+'/4':''});m.querySelectorAll('[data-hz]').forEach(b=>b.onclick=()=>{m.querySelectorAll('[data-hz]').forEach(x=>x.classList.toggle('on',x===b));$('#ch',m).dataset.v=b.dataset.hz});const inp=$('#ct',m),tx=$('#cx',m),post=$('#cpost',m);
  const canBuy=()=>tok&&tradable(tok);
  const buyOn=()=>canBuy()&&!skip;
  const drawBuy=()=>{const el=$('#cbuy',m);if(tok&&tok.prelaunch){el.innerHTML=`<div class="buybox"><b>Buying opens at launch</b><p class="hint" style="margin:4px 0 0">$${tok.sym} launches ${esc(tok.prelaunch)}. You can buy and call it then.</p></div>`;return}
   if(tok&&!canBuy()){el.innerHTML=`<div class="buybox"><b>No buy for this one</b><p class="hint" style="margin:4px 0 0">In-app buys for ${tok.chain} tokens aren't live yet. You can still call it, but it won't earn caller fees.</p></div>`;return}
   const a=parseFloat(sol)||0,usdV=a*T.SOL.price,got=tok?usdV*.995/tok.price:0;
   el.innerHTML=`<div class="buybox"><div class="top"><b>${tok?'Buy $'+tok.sym:'Buy in'}</b><span class="hint num" style="white-space:nowrap">Balance ${fmtAmt(S.bal.SOL)} SOL</span></div>
   ${skip?'':`<div class="presets">${['0.1','0.25','0.5','1'].map(v=>`<button type="button" data-sol="${v}" class="${sol===v?'on':''}">${v} SOL</button>`).join('')}</div>
   <label class="solin"><input id="csol" class="num" inputmode="decimal" value="${esc(sol)}" aria-label="SOL to spend"><button type="button" class="mx" id="cmax">Max</button><span class="muted">SOL</span></label>
   <div class="hint num" style="margin-top:8px">${!a?'Enter an amount':tok?`≈ ${fmtUsd(usdV)} · you get ~${fmtAmt(got)} $${tok.sym} · via Jupiter`:`≈ ${fmtUsd(usdV)} · add a token above to see what you get`}</div>`}
   <label class="skip"><input type="checkbox" id="cskip" ${skip?'checked':''}> Call without buying (won't earn caller fees)</label></div>`;
   const si=$('#csol',el);if(si)si.addEventListener('input',()=>{sol=si.value.replace(/[^0-9.]/g,'');const pos=si.selectionStart;drawBuy();const n=$('#csol',m);n.focus();try{n.setSelectionRange(pos,pos)}catch(_){}check()});
   el.querySelectorAll('[data-sol]').forEach(b=>b.onclick=()=>{sol=b.dataset.sol;drawBuy();check()});
   const cm=$('#cmax',el);if(cm)cm.onclick=e=>{e.preventDefault();sol=maxOf('SOL');drawBuy();check()};
   $('#cskip',el).onchange=e=>{skip=e.target.checked;drawBuy();check()}};
  const check=()=>{$('#cn',m).textContent=tx.value.length+' / 280';post.textContent=(tok?buyOn():!skip)?`Buy ${parseFloat(sol)||0} SOL & post call`:'Post call';post.disabled=!(tok&&!tok.prelaunch&&tx.value.trim().length>=10&&(!buyOn()||parseFloat(sol)>0))};
  const find=()=>{const raw=inp.value.trim().replace(/^\$/,''),v=raw.toUpperCase();tok=Object.values(T).find(t=>!t.base&&(t.ca.toUpperCase()===v))||Object.values(T).filter(t=>!t.base&&String(t.sym).toUpperCase()===v).sort((a,b)=>(b.vol||0)-(a.vol||0))[0]||null;
   if(!tok&&isMintStr(raw)&&!CAQ[raw]){CAQ[raw]=1;fetchToken(raw).then(x=>{if(x){regLive(x);if(inp.value.trim().replace(/^\$/,'')===raw)find()}}).catch(()=>{})}
   $('#cprev',m).innerHTML=tok?`<div class="preview">${tokav(tok.key)}<div style="flex:1"><b>${esc(tok.name)} $${tok.sym}</b> <span class="chain">${tok.chain}</span><div class="hint num">${tok.prelaunch?'Launches '+esc(tok.prelaunch)+'. Calls open at launch.':'Entry would be '+fmtUsd(mcap(tok))+' MC'}</div></div></div>`:(v?`<p class="hint" style="margin-top:-6px">${isMintStr(v.length>30?inp.value.trim():'')?'Looking up this contract address…':'No token found. Paste the contract address, or pick one from Search or the Market.'}</p>`:'');drawBuy();check()};
  inp.addEventListener('input',find);tx.addEventListener('input',check);find();
  post.addEventListener('click',()=>{const g=$('#cg',m).value.trim().toUpperCase(),n=parseFloat(g)*(g.endsWith('B')?1e9:g.endsWith('M')?1e6:g.endsWith('K')?1e3:1);
   if(g&&!(n>mcap(tok))){$('#cerr',m).textContent='Target must be above the current market cap of '+fmtUsd(mcap(tok))+'.';return}
   let buy=0;if(buyOn()){const a=parseFloat(sol);if(a>S.bal.SOL){$('#cerr',m).textContent=`You only have ${fmtAmt(S.bal.SOL)} SOL. Lower the amount or deposit more.`;return}
    buy=a*T.SOL.price;if(!REALW()){const got=buy*.995/tok.price;S.bal.SOL-=a;S.bal[tok.key]=(S.bal[tok.key]||0)+got;S.activity.unshift({k:'Bought',d:`${fmtAmt(got)} ${tok.sym} for ${a} SOL`,t:'Just now'})}}
   const solIn=parseFloat(sol),thesis=tx.value.trim(),hz=$('#ch',m).dataset.v,media=CD.media.slice();
   const publish=k=>{C[S.me].calls++;afterPost(k,buy?'':'Call posted');const id=k.id;
    if(buy)REALW()?realSwap('SOL',tok.key,solIn,`Buy-in for your $${tok.sym} call`,ok=>{if(ok)return;const c=calls.find(x=>x.id===id);if(c){c.buy=0;render()}toast('Buy-in didn\'t go through. Your call is posted without it')},{callRef:id}):txRun(`Buy-in for your $${tok.sym} call`,null,{instantApprove:1})};
   if(!SYNC()||!isMintStr(tok.key))return publish({id:Date.now(),c:S.me,kind:'meme',t:tok.key,entry:mcap(tok),buy,thesis,media,target:n||null,horizon:hz,ago:'now',likes:0,reposts:0,replies:0,views:1,fresh:true});
   post.disabled=true;post.textContent='Posting…';
   upMedia(media).then(urls=>API('/api/posts',{body:{kind:'meme',mint:tok.key,body:thesis,media:urls,target_mc:n||null,horizon:hz}}))
    .then(r=>publish(Object.assign(fromRow({...r.post,handle:S.me}),{buy,fresh:true})))
    .catch(e=>{post.disabled=false;check();$('#cerr',m).textContent=e.message})})})}

let SRT=0,STR=0;
function searchModal(){S.stf=TF_OK.includes(S.stf)?S.stf:'1h';
 modal('Search','',`<div class="tsearch">${ic('search',18)}<input id="sq" placeholder="Search tokens, tickers, callers or paste a CA" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div><div class="list" id="sres" style="margin-top:6px"></div>`,
 m=>{const box=$('#sres',m),inp=$('#sq',m),qv=()=>inp.value.trim().replace(/^[$@]/,'');
  const trow2=(t,tf)=>{const v=chgOf(t,tf);return `<a class="li srow" href="#/token/${t.key}" data-act="close">${tokav(t.key)}<div class="grow"><b>${esc(t.name)}</b>${t.L&&t.L.verified?`<span class="vbadge">${ic('check',10)}</span>`:''}<div class="hint num">$${esc(t.sym)} · ${fmtSmall(mcap(t))} MC${t.vol?` · V ${fmtSmall(t.vol)}`:''}</div></div><b class="num ${pcls(v)}">${pctS(v)}</b></a>`};
  const prow=c=>`<a class="li" href="#/profile/${c.h}" data-act="close">${avatar(c.h)}<div class="grow"><b>${esc(c.h)}</b><div class="hint">${c.calls} calls, ${c.win}% win rate</div></div></a>`;
  const loadTrend=force=>{const id='movers:'+S.stf;if(LIVE.busy[id]||(!force&&LIVE.feeds[id]))return;LIVE.busy[id]=1;
   fetchFeed('movers',S.stf).then(l=>{LIVE.feeds[id]=l.map(regLive).filter(Boolean).map(t=>t.key);LIVE.err[id]=0;LIVE.at[id]=Date.now()}).catch(()=>{LIVE.err[id]=1}).finally(()=>{LIVE.busy[id]=0;if(box.isConnected&&!qv())draw()})};
  const trending=()=>{const id='movers:'+S.stf,ks=LIVE.feeds[id];
   const seg=`<div class="shead"><span class="tsec" style="margin:0">Trending now</span><div class="seg tfseg" role="tablist" aria-label="Timeframe">${TF_OK.map(x=>`<button type="button" role="tab" aria-selected="${S.stf===x}" class="${S.stf===x?'on':''}" data-stf="${x}">${x}</button>`).join('')}</div></div>`;
   if(!ks){loadTrend();return seg+(LIVE.err[id]?`<p class="hint" style="padding:8px 4px">Live tokens didn't load. <button class="lnk" data-sretry>Try again</button></p>`:Array.from({length:6},()=>`<div class="li sskel" aria-hidden="true"><span class="tokav"></span><div class="grow"><i></i><i></i></div></div>`).join(''))}
   const list=ks.map(k=>T[k]).filter(t=>t&&t.price&&!NOT_MEME.has(String(t.sym).toUpperCase())).sort(byChg(S.stf)).slice(0,10);
   return seg+(list.map(t=>trow2(t,S.stf)).join('')||'<p class="hint" style="padding:8px 4px">Nothing trending in this window yet.</p>')};
  const draw=()=>{const q=qv(),ql=q.toLowerCase();clearTimeout(SRT);
   if(!q){box.innerHTML=trending()+`<div class="tsec">Top callers</div>`+ranked().slice(0,4).map(prow).join('');return}
   const local=Object.values(T).filter(t=>t.live&&t.price&&(String(t.sym).toLowerCase().startsWith(ql)||t.name.toLowerCase().includes(ql)||t.key===q)).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,5);
   const ppl=Object.values(C).filter(c=>c.h.toLowerCase().includes(ql)).slice(0,4);
   box.innerHTML=`<div id="slive">${local.length?`<div class="tsec">Tokens</div>${local.map(t=>trow2(t,'24h')).join('')}`:''}${q.length>=2?'<p class="hint" style="margin:8px 4px" id="sbusy">Searching live tokens…</p>':''}</div>`+(ppl.length?`<div class="tsec">Callers</div>${ppl.map(prow).join('')}`:'')+(q.length<2&&!local.length&&!ppl.length?'<p class="hint" style="padding:8px 4px">Keep typing: a ticker, a name or a contract address.</p>':'');
   if(q.length<2)return;
   SRT=setTimeout(()=>searchTokens(q).then(res=>{const el=$('#slive',m);if(!el||qv()!==q)return;
    const rows=res.map(regLive).filter(Boolean),seen=new Set(),all=[...rows,...local].filter(t=>!seen.has(t.key)&&seen.add(t.key)).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,10);
    el.innerHTML=all.length?`<div class="tsec">Tokens</div>${all.map(t=>trow2(t,'24h')).join('')}`:(isMintStr(q)?`<a class="li" href="#/token/${q}" data-act="close"><div class="grow"><b>Open ${short(q)}</b><div class="hint">Look up this contract address</div></div></a>`:`<p class="hint" style="padding:8px 4px">No live token matches “${esc(q)}”.</p>`)})
    .catch(()=>{const b=$('#sbusy',m);if(b)b.textContent='Live search is unavailable right now.'}),250)};
  m.addEventListener('click',e=>{const t=e.target.closest('[data-stf]');if(t){e.preventDefault();S.stf=t.dataset.stf;draw();return}
   if(e.target.closest('[data-sretry]')){LIVE.err['movers:'+S.stf]=0;draw()}});
  inp.addEventListener('input',draw);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){const f=box.querySelector('a.li');if(f){e.preventDefault();location.hash=f.getAttribute('href');closeModal()}}});
  clearInterval(STR);STR=setInterval(()=>{if(!box.isConnected)return clearInterval(STR);if(!document.hidden&&!qv())loadTrend(true)},10000);
  draw();setTimeout(()=>inp.focus(),40)})}
const NOTIFS=[
 {id:1,k:'calls',h:'fadedpixel',t:'posted a new call on $GLORP',go:'#/post/1',m:12,unread:1},
 {id:2,k:'earn',h:'quietmoney',t:'bought $GLORP from a call you follow',go:'#/post/1',m:35,unread:1},
 {id:3,k:'calls',h:'minnie_sol',t:'called $DOTB. It\'s up +113% since',go:'#/token/DOTB',m:70,unread:1},
 {id:4,k:'mentions',h:'lagosape',t:'mentioned you: "who else is watching KFSH?"',go:'#/token/KFSH',m:130},
 {id:5,k:'alerts',sym:'NIMB',t:'$NIMB is up 64% in 24h. It\'s on your watchlist',go:'#/token/NIMB',m:180},
 {id:6,k:'follows',h:'dr_liquidity',t:'followed you',go:'#/profile/dr_liquidity',m:300},
 {id:7,k:'mentions',h:'zerobeta',t:'replied to your call: "target feels low"',go:'#/post/1',m:420},
 {id:8,k:'alerts',sym:'GLORP',t:'$GLORP crossed $1.8M market cap',go:'#/token/GLORP',m:600},
 {id:9,k:'follows',h:'minnie_sol',t:'and 3 others followed you',go:'#/profile/minnie_sol',m:1440},
 {id:10,k:'earn',t:'Caller fees paid: +0.042 SOL for last week',go:'#/wallet',m:2880}];
const MOCK_NOTIFS=NOTIFS.slice();
/* Real notifications from the backend replace the demo ones for signed-in users. */
window.callitSetNotifs=list=>{const now=Date.now();
 NOTIFS.splice(0,NOTIFS.length,...(list?list.map(n=>({id:n.id,real:1,k:NKIND[n.kind]?n.kind:'system',t:n.title,body:n.body||'',go:n.link||'#/notifications',m:Math.max(0,Math.round((now-Date.parse(n.created_at))/6e4)),unread:n.read_at?0:1})):MOCK_NOTIFS.map(n=>({...n}))));
 render()};
const NKIND={welcome:['Callit','promote'],system:['Callit','bell'],calls:['Call','promote'],earn:['Earnings','wallet'],mentions:['Mention','reply'],alerts:['Alert','bell'],follows:['Follow','profile']};
const unreadN=()=>NOTIFS.filter(n=>n.unread).length;
const nAgo=m=>m<60?m+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d';
function nrow(n){const [lab,icn]=NKIND[n.k];
 return `<a class="notif${n.unread?' unread':''}" href="${n.go}" data-act="nread" data-f="${n.id}"><span class="nic ${n.k}">${ic(icn,16)}</span>
 ${n.real&&!n.h?'<span class="mark nmark" aria-hidden="true"></span>':n.h?avatar(n.h):tokav(n.sym||'SOL')}<span class="grow"><span class="nl">${n.h?`<b>${esc(n.h)}</b> `:''}${n.body?`<b>${esc(n.t)}</b> ${esc(n.body)}`:esc(n.t)}</span><span class="hint">${lab} · ${nAgo(n.m)} ago</span></span>${n.unread?'<i class="ndot"></i>':''}</a>`}
function notifsModal(){modal('Notifications',unreadN()?`${unreadN()} new`:'You\'re all caught up',`<div class="nlist">${NOTIFS.slice(0,5).map(nrow).join('')}</div>
 <a class="btn primary block" href="#/notifications" style="margin-top:14px">View all notifications</a>`)}
function vNotifs(){const f=S.nt||'all',list=NOTIFS.filter(n=>f==='all'||n.k===f);
 return `<div class="tabs" role="tablist">${[['all','All'],['calls','Calls'],['mentions','Mentions'],['earn','Earnings'],['alerts','Alerts']].map(([k,l])=>`<button class="${f===k?'on':''}" data-act="nt" data-f="${k}">${l}${k==='all'&&unreadN()?` <span class="ncount">${unreadN()}</span>`:''}</button>`).join('')}</div>
 ${unreadN()?`<div class="fline"><span>${unreadN()} unread</span><button data-act="nall">Mark all as read</button></div>`:''}
 <div class="nlist full">${list.map(nrow).join('')||'<div class="empty"><b>Nothing here yet</b></div>'}</div>`}
function settingsModal(){const th=document.documentElement.dataset.theme||'system',col=document.body.classList.contains('collapsed');
 modal('Settings','',`<div class="field"><label>Theme</label><div class="seg">${[['system','System'],['dark','Navy'],['light','White']].map(([k,l])=>`<button class="${th===k?'on':''}" data-act="settheme" data-f="${k}">${l}</button>`).join('')}</div></div>
 <div class="field"><label>App</label><button class="btn ghost block" data-act="install">${ic('down',16)} Install Callit on this device</button></div>
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
   ${k?`<p class="hint" style="margin:0 0 14px">${k.buy?`Buying from <b style="color:var(--text)">${esc(k.c)}</b>'s call. They bought in, so they earn a share of the fee.`:`${esc(k.c)} didn't buy in, so this call earns them no fee.`}</p>`:''}
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
const MSG={lounge:[['fadedpixel','GLORP dev just locked another 5% of supply. Still early imo','4m'],['quietmoney','anyone watching NIMB? volume is silly for 13h old','3m'],['lagosape','KFSH higher low confirmed. not selling','1m']],
 glorp:[['fadedpixel','Holders doubled again overnight 👀','12m'],['quietmoney','Added more at 1.7M. Target unchanged','6m']],
 kfsh:[['lagosape','Two dumps survived. Volume is real','20m'],['zerobeta','Whales from GLORP are rotating in','9m']],
 dotb:[['minnie_sol','Dev is still in the chat. Art keeps getting better','30m']],nimb:[['dr_liquidity','Watching this one, not in yet','15m']],moth:[['minnie_sol','Stop at 300K. Rules are rules','1h']]};
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
 return `<div class="li hrow"><a class="hlink" href="#/token/${esc(key)}">${tokav(key)}<div class="grow"><b>${esc(t.name)}</b><div class="hint num">${amt!=null?fmtAmt(amt)+' '+esc(symOf(key)):'$'+esc(t.sym)}</div></div>
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
  <div class="asgroup">${cash?'':arow(`data-act="hgo" data-k="${esc(key)}" data-f="buy"`,'up','Buy more',`Add to your $${sy}`)+arow(`data-act="hgo" data-k="${esc(key)}" data-f="sell"`,'down','Sell',`Swap $${sy} back to SOL`)}${arow('data-act="withdraw"','share','Withdraw','Send to another wallet')}${arow(`data-act="hgo" data-k="${esc(key)}" data-f="view"`,'market','View token','Chart, safety check and calls')}</div>`)}
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
 const bar=`<div class="mtabs" role="tablist">${M.map(([k,l])=>`<button role="tab" aria-selected="${t===k}" class="${t===k?'on':''}" data-act="mt" data-f="${k}">${l}${k==='trenches'?'<span class="live"></span>':'<small>Soon</small>'}</button>`).join('')}</div>`;
 if(t==='perps')return bar+locked(mockPerps(),'perps','Perps are coming','Long or short the tokens you call, with leverage and your caller track record on the line.',['Long and short from any call','Position shows on your call card','Same fee share for bought-in callers']);
 if(0)return bar+soonCard('Perps are coming','Long or short the tokens you call, with leverage and your caller track record on the line. Built on Solana perp venues.',['Long and short from any call','Position shows on your call card','Same fee share for bought-in callers']);
 if(t==='predict')return bar+locked(mockPredict(),'predict','Predictions are coming','Back your read on outcomes: will it hit the target, will it graduate, who tops the leaderboard this week.',['Markets on live calls','Settle on-chain','Callers can seed their own markets']);
 if(0)return bar+soonCard('Predictions are coming','Back your read on outcomes: will it hit the target, will it graduate, who tops the leaderboard this week.',['Markets on live calls','Settle on-chain','Callers can seed their own markets']);
 return bar+topTrades()+`<div class="inmkt">${vTrenches()}</div>`}
/* Coming soon: a real preview of the feature fades out under a lock. Nothing in the preview is clickable. */
const SOONF={perps:'Perps',predict:'Predictions',stake:'$CALLIT staking'};
function notifyBtn(f){const on=S.notifyOn&&S.notifyOn[f];return `<button class="btn ${on?'ghost':'primary'}" data-act="notify" data-f="${f}">${ic(on?'check':'bell',16)} ${on?'You\'re on the list':'Notify me at launch'}</button>`}
function locked(preview,f,title,text,items){return `<div class="lockwrap"><div class="lockprev" aria-hidden="true" inert>${preview}</div>
 <div class="lockcov"><div class="lockcard"><span class="lockic">${ic('lock',26)}</span><span class="lkick">Coming soon</span><b class="h2">${title}</b><p>${text}</p>
 ${items&&items.length?`<ul>${items.map(x=>`<li>${ic('check',15)} ${x}</li>`).join('')}</ul>`:''}${notifyBtn(f)}</div></div></div>`}
function mockPerps(){const R=[['SOL','Solana','#9d7bff','$142.30','+3.8%','12.4x'],['BTC','Bitcoin','#F7931A','$64,210','+1.2%','8.1x'],['ETH','Ethereum','#8EA2FF','$3,120','-0.6%','10.7x']];
 return `<div class="pad">${R.map(([k,n,c,px,ch,oi])=>`<div class="mockrow"><span class="tokav" style="background:${c}">${k}</span><div class="grow"><b>${k}-PERP</b><span class="hint">${n} · up to 50x</span></div><div class="mocknum"><b class="num">${px}</b><span class="${ch[0]==='-'?'dn':'up'}">${ch}</span></div><div class="mockbtns"><span class="mlong">Long</span><span class="mshort">Short</span></div></div>`).join('')}</div>`}
function mockPredict(){const R=[['Will $BONK hit a $3B market cap by Friday?',64],['Will @fadedpixel top the leaderboard this week?',41],['Will this week’s #1 call graduate before Sunday?',72]];
 return `<div class="pad">${R.map(([q,y])=>`<div class="mockq"><b>${q}</b><div class="mockbar"><i style="width:${y}%"></i></div><div class="mockyn"><span class="up">Yes ${y}%</span><span class="dn">No ${100-y}%</span></div></div>`).join('')}</div>`}
function perpsLocked(){const demo=calls.filter(k=>k.kind==='perps').slice(0,2).map(post).join('');
 return locked(demo||mockPerps(),'perps','Perps calls are coming','Call longs and shorts on SOL, BTC and ETH with leverage. Your ROE and liquidation price are tracked live on your profile.',['Long or short with up to 50x','Live ROE on every call','Counts toward your caller rank'])}
function soonCard(h,p,items){return `<div class="soonx"><div class="sxmark"><span class="mark"></span></div><span class="lkick" style="margin:0 0 12px">Coming soon</span><b class="h2">${h}</b><p>${p}</p><ul>${items.map(x=>`<li>${ic('check',16)} ${x}</li>`).join('')}</ul><button class="btn primary" data-act="mt" data-f="trenches">Open Trenches</button></div>`}

/* ---------- attachments ---------- */
const EMOJI=['🚀','🔥','💎','🙌','📈','📉','🐸','🐳','👀','🤝','💰','⚡','🎯','🧠','😂','🥲','😤','🫡','✅','❌','🟢','🔴','🌕','🐂'];
function mediaGrid(m,edit){if(!m||!m.length)return '';return `<div class="media n${Math.min(m.length,4)}">${m.map((u,i)=>`<div class="mcell"><img src="${u}" alt="Attached image ${i+1}" loading="lazy">${/^data:image\/gif/.test(u)?'<span class="gifb">GIF</span>':''}${edit?`<button type="button" class="mrm" data-rmm="${i}" aria-label="Remove image ${i+1}">${ic('x',14)}</button>`:''}</div>`).join('')}</div>`}
function attachBar(){return `<div class="attbar"><label class="att" title="Photos" aria-label="Add photos">${ic('image',19)}<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-att="img" hidden></label>
 <label class="att" title="GIF" aria-label="Add a GIF"><span class="gift">GIF</span><input type="file" accept="image/gif" data-att="gif" hidden></label>
 <button type="button" class="att" data-att="emoji" title="Emoji" aria-label="Add emoji">${ic('smile',19)}</button><span class="attn hint" data-attn></span></div>`}
function wireAttach(root,st,onChange){if(!root)return;const txt=root.querySelector('textarea,input.rin');
 const add=u=>{if(st.media.length>=4){toast('Up to 4 images per post');return}st.media.push(u);onChange()};
 root.querySelectorAll('[data-att="img"]').forEach(i=>i.onchange=()=>{[...i.files].slice(0,4-st.media.length).forEach(f=>shrink(f,1400,add));i.value=''});
 root.querySelectorAll('[data-att="gif"]').forEach(i=>i.onchange=()=>{const f=i.files[0];i.value='';if(!f)return;if(f.size>5e6){toast('GIFs up to 5 MB');return}const r=new FileReader();r.onload=()=>add(r.result);r.readAsDataURL(f)});
 root.querySelectorAll('[data-att="emoji"]').forEach(bt=>bt.onclick=e=>{e.stopPropagation();const old=root.querySelector('.emo');if(old){old.remove();return}
  const pop=document.createElement('div');pop.className='emo';pop.innerHTML=EMOJI.map(x=>`<button type="button">${x}</button>`).join('');bt.closest('.attbar').after(pop);
  pop.onclick=ev=>{const x=ev.target.closest('button');if(!x||!txt)return;const a=txt.selectionStart??txt.value.length,z=txt.selectionEnd??a;txt.value=txt.value.slice(0,a)+x.textContent+txt.value.slice(z);txt.focus();const c=a+x.textContent.length;txt.setSelectionRange(c,c);txt.dispatchEvent(new Event('input',{bubbles:true}))}});
 root.addEventListener('click',e=>{const x=e.target.closest('[data-rmm]');if(x){st.media.splice(+x.dataset.rmm,1);onChange()}})}
document.addEventListener('click',e=>{const p=document.querySelector('.emo');if(p&&!e.target.closest('.emo,[data-att="emoji"]'))p.remove()});

/* ---------- top strips ---------- */
const medal=i=>i<3?`<span class="medal m${i}">${i+1}</span>`:`<span class="medal">${i+1}</span>`;
function strip(id,title,sub,cards){return `<section class="strip" aria-label="${title}"><div class="sthead"><span class="stic">${ic('leaderboard',16)}</span><div><b>${title}</b><span>${sub}</span></div>
 <span class="starr"><button class="ib" data-act="stscroll" data-f="${id}" data-d="-1" aria-label="Scroll left">${ic('back',16)}</button><button class="ib" data-act="stscroll" data-f="${id}" data-d="1" aria-label="Scroll right">${ic('back',16).replace('<svg','<svg style="transform:scaleX(-1)"')}</button></span></div>
 <div class="strack" id="${id}">${cards}</div></section>`}
function topCalls(){const list=calls.filter(k=>k.buy&&!k.sponsored&&nums(k)).map(k=>({k,n:nums(k)})).sort((a,b)=>b.n.pnl-a.n.pnl).slice(0,8);if(!list.length)return '';
 return strip('stc','Top calls this week','Biggest caller profits, bought in with their own wallet',list.map(({k,n},i)=>`<a class="scard" href="#/post/${k.id}"><div class="sctop">${avatar(k.c)}<b>${esc(k.c)}</b>${medal(i)}</div>
 <div class="scbody">${tokav(k.t)}<div class="grow"><b class="num ${n.pnl>=0?'up':'down'}">${money(n.pnl)}</b><span class="num">$${symOf(k.t)} · <em class="${n.up?'up':'down'}">${fmtPct(n.p)}</em></span></div></div></a>`).join(''))}
function topTrades(){const who=ranked().map(c=>c.h),toks=Object.values(T).filter(t=>t.chain==='Solana'&&!t.base&&!t.prelaunch&&t.holders),r=rng(4242);
 const trades=who.flatMap(h=>toks.slice(0,6).map(t=>({h,t,pnl:Math.round((r()*r())*t.vol*.06*100)/100,x:1+r()*r()*14}))).sort((a,b)=>b.pnl-a.pnl).filter((x,i,a)=>a.findIndex(y=>y.h===x.h)===i).slice(0,8);
 return strip('stt','Weekly top trades','Largest realized wins in the trenches',trades.map((x,i)=>`<a class="scard" href="#/token/${x.t.key}"><div class="sctop">${avatar(x.h)}<b>${esc(x.h)}</b>${medal(i)}</div>
 <div class="scbody">${tokav(x.t.key)}<div class="grow"><b class="num up">+${fmtUsd(x.pnl).replace('$','$')}</b><span class="num">$${x.t.sym} · <em class="up">${x.x.toFixed(1)}x</em></span></div></div></a>`).join(''))}

/* ---------- news ---------- */
const WIRE=[['Solana memecoin launches hit a new weekly high as launchpad competition heats up','Callit Wire',38],['Creator fee splits become the new battleground for token launchpads','Callit Wire',95],['Stablecoin balances on Solana keep climbing as traders park profits','Callit Wire',160],['Perp DEX volume climbs as traders chase leverage on majors','Callit Wire',240],['Why bundled supply is the first thing smart money checks now','Callit Wire',410]];
function newsItems(){const out=[],lv=(LIVE.feeds['movers:1h']||[]).map(k=>T[k]),
 tk=(lv.length?lv:Object.values(T)).filter(t=>t&&t.chain==='Solana'&&!t.base&&!t.prelaunch&&t.holders&&!NOT_MEME.has(String(t.sym).toUpperCase()));
 tk.slice(0,8).forEach((t,i)=>out.push({kind:'chain',sym:t.key,min:3+i*7,src:t.live?'Live market':'On-chain',
  title:i%2===0?`$${t.sym} ${t.chg>=0?'up':'down'} ${Math.abs(t.chg).toFixed(1)}% in 24h as volume hits ${fmtUsd(t.vol)}`:`$${t.sym} passes ${fmtK(t.holders)} holders with ${fmtUsd(t.liq||0)} in liquidity`}));
 calls.filter(k=>k.buy&&nums(k)&&nums(k).p>50).slice(0,3).forEach((k,i)=>out.push({kind:'chain',sym:k.t,min:20+i*55,title:`${k.c}'s $${symOf(k.t)} call is up ${fmtPct(nums(k).p)}`,src:'Callit calls',post:k.id}));
 WIRE.forEach(([title,src,min])=>out.push({kind:'crypto',title,src,min}));
 return out.sort((a,b)=>a.min-b.min)}
const ago2=m=>m<60?m+'m':Math.round(m/60)+'h';
function newsRow(n,compact){const go=n.post?`#/post/${n.post}`:n.sym?`#/token/${n.sym}`:'';
 return `<${go?`a href="${go}"`:'button data-act="newsx"'} class="nrow${compact?' c':''}">${n.sym?tokav(n.sym):`<span class="tokav nwire">${ic('news',18)}</span>`}<span class="grow"><span class="ntag ${n.kind}">${n.kind==='chain'?'On-chain':'Crypto'}</span><b>${esc(n.title)}</b><span class="hint">${esc(n.src)} · ${ago2(n.min)}</span></span></${go?'a':'button'}>`}
function newsCard(){return `<div class="card newscard"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">Trending news</h3><a class="lnk" href="#/news">See all</a></div>${newsItems().slice(0,5).map(n=>newsRow(n,1)).join('')}</div>`}
function vNews(){const f=S.nf||'all',list=newsItems().filter(n=>f==='all'||n.kind===f);
 return `<div class="tabs" role="tablist">${[['all','All'],['chain','On-chain'],['crypto','Crypto']].map(([k,l])=>`<button class="${f===k?'on':''}" data-act="nf" data-f="${k}">${l}</button>`).join('')}</div>
 <div>${list.map(n=>newsRow(n)).join('')}</div><p class="hint pad">On-chain items come from token and call activity. Crypto headlines are samples until the news feed is connected.</p>`}

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
function repliesOf(k){if(!RLOADED[k.id]&&realAuth()){RLOADED[k.id]=1;fetch('/api/posts/replies?ref='+encodeURIComponent(k.id)).then(r=>r.ok?r.json():null).then(j=>{if(!j||!j.replies.length)return;j.replies.forEach(x=>{if(x.avatar_url)AVURL[x.handle]=x.avatar_url});const real=j.replies.map(x=>liveAgo({h:x.handle,t:x.body,likes:0,rts:0,reps:0,media:x.media,id:x.id},Date.parse(x.created_at)));REPLIES[k.id]=[...real,...(REPLIES[k.id]||[]).filter(x=>!x.mine)];k.replies=Math.max(k.replies||0,REPLIES[k.id].length);if(currentRoute()==='post')render()}).catch(()=>{})}
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
  <div class="tact"><span class="${k.buy?'bk':'bk no'}">${k.buy?ic('check',14)+' Caller bought in · earns fees':'Caller didn\'t buy · earns no fees'}</span>${tradable(t)?`<button class="btn primary" data-act="qbuy" data-t="${t.key}" data-id="${k.id}">Buy $${t.sym}</button>`:''}<a class="btn ghost" href="#/token/${t.key}">Chart</a></div></div>`
  :t?`<a class="ccard" href="#/token/${t.key}">${tokav(t.key)}<div class="cn"><b>${esc(t.name)}</b><span>$${t.sym} <span class="chain">${t.chain}</span></span></div><div class="cr"><b>Soon</b><span>Launches ${esc(t.prelaunch)}</span></div></a>`:'';
 return `<article class="fpost"><div class="fhead"><a href="#/profile/${k.c}" aria-label="Open @${esc(k.c)}'s profile">${avatar(k.c,'md')}</a><div class="grow"><div class="phead" style="margin:0"><span class="pname">${esc(k.c)}</span>${vbadge(k.c)}${r&&!k.sponsored?`<span class="rk">#${r}</span>`:''}${k.sponsored?'<span class="tag">Sponsored</span>':''}</div><div class="hint">@${esc(k.c)}</div></div>
  ${k.c===S.me?'':`<button class="btn sm ${S.following.has(k.c)?'ghost':'primary'}" data-act="follow" data-h="${k.c}">${S.following.has(k.c)?'Following':'Follow'}</button>`}${k.sponsored?'':moreBtn(k)}</div>
  <p class="ftext">${esc(k.thesis)}</p>${mediaGrid(k.media)}${trade}
  ${k.sponsored?`<div class="pnote">Paid promotion by ${esc(k.sponsor)}. Not counted in rankings.</div>`:''}
  <div class="fmeta hint">${k.ago==='now'?'Just now':k.ago+' ago'} · <b>${fmtK(k.views||0)}</b> views</div>
  <div class="fstats"><span><b>${k.replies||0}</b> replies</span><span><b>${k.reposts||0}</b> reposts</span><span><b>${k.likes||0}</b> likes</span></div>
  <div class="pbar fbar"><div class="icons">
   <button class="act" data-act="reply" aria-label="Reply">${ic('reply',20)}</button>
   <button class="act${k.reposted?' reposted':''}" data-act="repost" data-id="${k.id}" aria-label="Repost">${ic('repost',20)}</button>
   <button class="act${k.liked?' liked':''}" data-act="like" data-id="${k.id}" aria-label="Like">${ic('heart',20,k.liked)}</button>
   <button class="act" data-act="share" data-id="${k.id}" aria-label="Share">${ic('share',20)}</button></div></div>
  <div class="rbox" id="rbox">${S.connected?avatar(S.me):'<span class="av" style="background:var(--bg2)"></span>'}<div class="grow"><textarea id="rin" class="rin" maxlength="280" rows="1" placeholder="${S.connected?'Post your reply':'Sign in to reply'}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';window.drawRMedia&&window.drawRMedia()" ${S.connected?'':'disabled'}></textarea><div id="rmedia"></div>
   <div class="rfoot">${S.connected?attachBar():''}<button class="btn primary sm" id="rgo" data-act="${S.connected?'rsend':'connect'}" data-id="${k.id}" ${S.connected?'disabled':''}>${S.connected?'Reply':'Sign in'}</button></div></div></div></article>
 <div class="replies">${reps.map((x,ri)=>`<div class="rep"><a href="#/profile/${x.h}" aria-label="Open @${esc(x.h)}'s profile">${avatar(x.h)}</a><div class="grow"><div class="phead" style="margin:0"><span class="pname">${esc(x.h===S.me&&PROF.name||x.h)}</span><span class="hint">@${esc(x.h)}</span><time>${x.ago==='now'?'now':x.ago}</time></div>
  <div class="hint" style="font-size:13px">Replying to <span style="color:var(--hi)">@${esc(k.c)}</span></div>${x.t?`<p class="ptext" style="margin:4px 0 0">${esc(x.t)}</p>`:''}${mediaGrid(x.media)}
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
 modal('How Callit works','',`${dots}<div class="obsteps">${[['promote','Make a call','Pick a token, set a target and say why. Your entry is stamped at the live market cap.'],['wallet','Buy in','Back it with your own wallet. Only bought-in calls earn caller fees.'],['market','Get tracked','Every call is followed in public. Win rate, returns and sells, all on your profile.']].map(([i,t,d],n)=>`<div class="obs"><span class="obi">${ic(i,20)}</span><div><b>${n+1}. ${t}</b><span>${d}</span></div></div>`).join('')}</div><button class="btn primary block" id="obn" style="margin-top:16px">Start exploring</button>`,m=>$('#obn',m).onclick=obDone)}
function obDone(){try{localStorage.setItem('callit.onboarded','1')}catch(_){}closeModal();render();toast('You’re all set')}
function maybeOnboard(){let d=false;try{d=localStorage.getItem('callit.onboarded')==='1'}catch(_){}if(!d)setTimeout(()=>onboard(1),400)}

/* ---------- messages ---------- */
const DMS={fadedpixel:[['fadedpixel','Saw your profile. What are you watching this week?','2h'],['me','Mostly AI agents and a couple of fresh launches','1h']],lagosape:[['lagosape','KFSH chart still looks healthy to me','5h']],minnie_sol:[['minnie_sol','Thanks for the follow 🙏','1d']]};
function vMessages(h){if(h&&DMS[h]!==undefined||h&&C[h]){DMS[h]=DMS[h]||[];const ms=DMS[h];
  return `<div class="rhead"><a href="#/profile/${h}">${avatar(h)}</a><div class="grow"><b>${esc(h)}</b><div class="hint">@${esc(h)}${C[h]&&C[h].win?` · ${C[h].win}% win rate`:''}</div></div><a class="btn sm ghost" href="#/profile/${h}">Profile</a></div>
  <div class="msgs" id="msgs">${ms.length?ms.map(([w,tx,ago])=>{const me=w==='me';return `<div class="msg${me?' me':''}">${avatar(me?S.me:w)}<div><div class="mh"><b>${esc(me?(PROF.name||S.me):w)}</b><span class="hint">${ago}</span></div><p>${esc(tx)}</p></div></div>`}).join(''):`<div class="empty"><b>Say hi to ${esc(h)}</b><p>Messages are private between you two.</p></div>`}</div>
  <div class="composer">${S.connected?`<input class="input" id="msgin" maxlength="500" placeholder="Write a message"><button class="btn primary" data-act="dmsend" data-f="${h}">Send</button>`:`<div class="grow"><b>Sign in to message</b></div><button class="btn primary" data-act="connect">Sign in</button>`}</div>`}
 const th=Object.entries(DMS).filter(([,m])=>m.length);
 return `<div class="pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px"><span class="hint">Direct messages</span><button class="btn sm primary" data-act="dmnew">${ic('promote',15)} New message</button></div>
 <div>${th.map(([h,m])=>{const l=m[m.length-1];return `<a class="comm" href="#/messages/${h}">${avatar(h,'md')}<div class="grow"><div class="cn1"><b>${esc(h)}</b><span class="hint">· ${l[2]}</span></div><p class="lastm">${l[0]==='me'?'You: ':''}${esc(l[1])}</p></div></a>`}).join('')||'<div class="empty"><b>No messages yet</b><p>Start a conversation with a caller you follow.</p></div>'}</div>`}

/* ---------- edit profile ---------- */
function editProfile(focus){const D={...PROF};
 const draw=m=>{$('#ep',m).innerHTML=`<div class="epban" style="${D.banner?`background:#0B1B27 url(${D.banner}) center/cover`:bannerBg('x'+S.me)}">
  <label class="epbtn" title="Upload banner">${ic('camera',20)}<input type="file" accept="image/*" data-up="banner" hidden></label>${D.banner?`<button class="epbtn" data-rm="banner" title="Remove banner">${ic('x',18)}</button>`:''}</div>
  <div class="epav"><span class="av lg" style="${D.avatar?`background:#0B1B27 url(${D.avatar}) center/cover`:`background:hsl(${(hue(S.me)%70)+185} 52% 42%)`}">${D.avatar?'':esc(S.me.slice(0,2).toUpperCase())}</span><label class="epbtn sm" title="Upload photo">${ic('camera',16)}<input type="file" accept="image/*" data-up="avatar" hidden></label></div>
  <div class="field"><label for="epn">Display name</label><input id="epn" class="input" maxlength="40" value="${esc(D.name||'')}" placeholder="${esc(S.me)}"></div>
  <div class="field"><label for="epb">Bio <span class="hint" id="epbc" style="float:right">${(D.bio||'').length}/160</span></label><textarea id="epb" class="input" maxlength="160" placeholder="What do you call? Memes, AI, early launches...">${esc(D.bio||'')}</textarea></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="epw">Website</label><input id="epw" class="input" maxlength="80" value="${esc(D.web||'')}" placeholder="yoursite.xyz"></div>
  <div class="field"><label for="epx">X handle</label><input id="epx" class="input" maxlength="30" value="${esc(D.x||'')}" placeholder="@handle"></div></div>
  <div id="eperr" class="err"></div><button class="btn primary block" id="epsave">Save profile</button>`;
  const keep=()=>{D.name=$('#epn',m).value.trim();D.bio=$('#epb',m).value.trim();D.web=$('#epw',m).value.trim();D.x=$('#epx',m).value.trim()};
  $('#epb',m).oninput=e=>$('#epbc',m).textContent=e.target.value.length+'/160';
  m.querySelectorAll('[data-up]').forEach(i=>i.onchange=()=>{const f=i.files[0];if(!f)return;if(!/^image\//.test(f.type)){$('#eperr',m).textContent='Pick an image file.';return}keep();shrink(f,i.dataset.up==='banner'?1400:400,url=>{D[i.dataset.up]=url;draw(m)})});
  m.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{keep();delete D[b.dataset.rm];draw(m)});
  $('#epsave',m).onclick=()=>{keep();const old=PROF;PROF=D;if(!saveProf()){PROF=old;$('#eperr',m).textContent='That image is too large to save. Try a smaller one.';return}
   if(realAuth()&&window.CallitAuth){const up=(u,kind)=>u&&/^data:/.test(u)?upMedia([u],kind).then(a=>a[0]):Promise.resolve(u||null);
    Promise.all([up(D.avatar,'avatar'),up(D.banner,'banner')]).then(([av,bn])=>{if(av)PROF.avatar=av;if(bn)PROF.banner=bn;saveProf();
     return window.CallitAuth.saveProfile({display_name:D.name||null,bio:D.bio||null,website:D.web||null,x_handle:D.x||null,avatar_url:av,banner_url:bn})}).then(p=>{if(!p)toast('Saved on this device. Couldn’t sync to your account yet')}).catch(()=>toast('Photo couldn’t upload. Saved on this device only'))}
   closeModal();toast('Profile updated');render()};
  if(focus==='banner')m.querySelector('[data-up="banner"]').click()};
 modal('Edit profile','',`<div id="ep"></div>`,draw)}
function followsModal(h,tab){const draw=m=>{const list=tab==='following'?followingOf(h):followersOf(h);
  $('#fl',m).innerHTML=`<div class="sh-tabs" style="padding:0 0 12px;margin-bottom:6px">${[['followers','Followers'],['following','Following']].map(([k,l])=>`<button class="${tab===k?'on':''}" data-t="${k}">${l}</button>`).join('')}</div>
  ${list.length?`<div class="list">${list.map(x=>{const c=C[x]||{},fx=S.following.has(x);return `<div class="li">${avatar(x)}<div class="grow"><a class="pname" href="#/profile/${x}">${esc(x===S.me&&PROF.name||x)}</a><div class="hint">${c.calls?`${c.win}% win rate · ${c.calls} calls`:'@'+esc(x)}</div></div>${x===S.me?'':`<button class="btn sm ${fx?'ghost':'primary'}" data-fl="${x}">${fx?'Following':'Follow'}</button>`}</div>`}).join('')}</div>`
   :`<div class="empty" style="padding:28px 8px"><b>${tab==='following'?'Not following anyone yet':'No followers yet'}</b><p>${tab==='following'?'Follow callers you trust and their calls land in your Following feed.':'Make good calls and people will follow.'}</p>${tab==='following'?'<a class="btn primary" href="#/leaderboard">Find callers</a>':''}</div>`}`;
  m.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;draw(m)});
  m.querySelectorAll('[data-fl]').forEach(b=>b.onclick=()=>{if(!S.connected)return connectModal();const x=b.dataset.fl;S.following.has(x)?S.following.delete(x):S.following.add(x);draw(m);render()})};
 modal(esc((h===S.me&&PROF.name)||h),'@'+esc(h),`<div id="fl"></div>`,draw)}

/* ---------- socials + legal ---------- */
const LINKS={x:'',discord:'',telegram:''}; // paste Callit's real URLs here
const socials=(cls='')=>`<div class="soc ${cls}">${[['x','X','xlogo'],['discord','Discord','discord'],['telegram','Telegram','telegram']].map(([k,l,i])=>`<a href="${LINKS[k]||'#'}" ${LINKS[k]?'target="_blank" rel="noopener"':`data-act="soclink" data-f="${l}"`} aria-label="Callit on ${l}" title="${l}">${ic(i,cls?17:20)}</a>`).join('')}</div>`;
const DOCS={terms:['Terms of Service',['Callit is a social platform for sharing and tracking crypto calls. Nothing on Callit is financial advice. Calls are opinions from users, and you trade at your own risk.','Wallets are non-custodial. You control your keys and sign every transaction yourself. Callit cannot reverse or recover transactions.','Crypto assets are volatile and new tokens are especially risky. You can lose everything you put in.','Sponsored content is always labelled and never counts toward caller rankings. Caller fee sharing applies only to calls the caller bought into.','You must be of legal age and allowed to use these services where you live.']],
 privacy:['Privacy Policy',['We collect what you give us: your sign-in method, public wallet address, profile details and the calls, comments and messages you post.','On-chain activity is public by nature. Your calls, positions and caller stats are shown publicly on your profile.','We use this data to run Callit, rank callers, prevent abuse and improve the product. We do not sell your personal data.','You can edit your profile at any time and ask us to delete your account data, except what is already recorded on-chain.']]};
function docModal(k){const [t,ps]=DOCS[k];modal(t,'Draft, pending legal review',`<div class="prose" style="padding:0;max-height:60vh;overflow-y:auto">${ps.map(p=>`<p>${esc(p)}</p>`).join('')}</div>`)}

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
 if(k==='n')return `<span class="tk"><span class="tklive"></span>${avatar(a)}<b>@${esc(a)}</b><i>called $${esc(symOf(b))} · ${esc(v)} ago</i></span>`;
 return `<span class="tk tkfee"><em class="up">${esc(a)}</em><i>${esc(b)}</i></span>`}
function lxTicker(items,cls){const row=items.map(lxChip).join('');
 return `<div class="lxtick${cls}" aria-hidden="true"><div class="lxtrack">${row}${row}</div></div>`}
function landingHTML(){const yr=new Date().getFullYear();
 return `<div class="lx-top">${lxTicker(LX_TICK_A,'')}<button class="ib ltheme" data-act="theme" aria-label="Switch light or dark">${ic('sun',18)}</button></div>
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
 ${lxTicker(LX_TICK_B,' rev')}
 <footer class="lx-foot">${socials('sm')}<nav><button data-act="lexplore" data-f="about">About</button><span>·</span><button data-act="lexplore" data-f="leaderboard">Leaderboard</button><span>·</span><button data-act="doc" data-f="terms">Terms</button><span>·</span><button data-act="doc" data-f="privacy">Privacy</button><span>·</span><span>© ${yr} Callit</span></nav></footer>`}
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
 closeModal();render();loadBalances();if(realAuth()){loadMe();loadPosts()}
 if(first){toast(o.isNew?'Welcome to Callit. Your wallet is ready':'Signed in');const n=pendingNext;pendingNext=null;if(n)n();else if(o.isNew)maybeOnboard()}};
window.callitAuthChanged=()=>syncLanding();
window.callitWalletChanged=()=>{if(REALW())loadBalances()};
if(window.__callitPendingSession){const q=window.__callitPendingSession;delete window.__callitPendingSession;window.callitApplySession(q.p,q.opts)}

/* ---------- events ---------- */
const currentRoute=()=>(location.hash.split('/')[1]||'home');
document.addEventListener('click',e=>{
 const nl=e.target.closest('.nav a');if(nl&&nl.getAttribute('href')===('#/'+currentRoute())&&!location.hash.split('/')[2]){e.preventDefault();scrollTo({top:0,behavior:'smooth'});return}
 const row=e.target.closest('[data-go]');if(row&&!e.target.closest('button,a,input,textarea,label,.media')){location.hash=row.dataset.go;return}
 const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
 if(a==='close'){if(e.target===b||b.tagName!=='DIV'){closeModal()}return}
 const act={
  newcall:()=>composeModal(b.dataset.t?'meme':(b.dataset.k||(currentRoute()==='home'?S.cat:'meme')),{pre:b.dataset.t}),
  install:()=>installApp(),instclose:()=>{try{localStorage.setItem('callit.installDismissed','1')}catch(_){}const x=$('#instbar');x&&x.remove()},
  dmsend:()=>{const i=$('#msgin'),v=i&&i.value.trim();if(!v)return;DMS[b.dataset.f].push(['me',v,'now']);render();const m=$('#msgs');m&&m.lastElementChild&&m.lastElementChild.scrollIntoView({block:'end'});setTimeout(()=>{const n=$('#msgin');n&&n.focus()},50)},
  dmnew:()=>{if(!S.connected)return connectModal();modal('New message','Pick a caller',`<div class="list">${ranked().map(c=>`<a class="li" href="#/messages/${c.h}" data-act="close">${avatar(c.h)}<div class="grow"><b>${c.h}</b><div class="hint">${c.win}% win rate</div></div></a>`).join('')}</div>`)},
  dm:()=>{location.hash='#/messages/'+b.dataset.h},
  nread:()=>{const n=NOTIFS.find(x=>x.id==b.dataset.f);if(n){if(n.real&&n.unread&&window.CallitAuth&&window.CallitAuth.markRead)window.CallitAuth.markRead([n.id]);n.unread=0}closeModal();chrome(currentRoute())},
  nall:()=>{if(NOTIFS.some(n=>n.real&&n.unread)&&window.CallitAuth&&window.CallitAuth.markRead)window.CallitAuth.markRead('all');NOTIFS.forEach(n=>n.unread=0);toast('All caught up');render()},nt:()=>{S.nt=b.dataset.f;render()},
  gopremium:()=>{location.hash='#/premium'},plan:()=>{S.plan=b.dataset.f;render()},payvia:()=>{S.payvia=b.dataset.f;render()},
  notify:()=>{const f=b.dataset.f;if(!S.connected)return connectModal();S.notifyOn=S.notifyOn||{};S.notifyOn[f]=1;if(f==='stake')S.stakeWait=true;try{localStorage.setItem('callit.notify',JSON.stringify(S.notifyOn))}catch(_){}toast(`We'll let you know when ${SOONF[f]||'it'} opens`);render()},
  stakewait:()=>{if(!S.connected)return connectModal();S.stakeWait=true;toast('We\'ll let you know when $CALLIT staking opens');render()},
  buyprem:()=>{if(!S.connected)return connectModal(()=>{location.hash='#/premium'});if(REALW())return toast('Premium payments open soon. Nothing was charged');const P=PLANS[S.plan||'yearly'],via=S.payvia||'SOL',amt=via==='SOL'?P.usd/T.SOL.price:P.usd;
   if((S.bal[via]||0)<amt)return toast(`Not enough ${via}. You need ${via==='SOL'?amt.toFixed(3):amt} ${via}`);
   modal('Confirm upgrade','',`<div class="list"><div class="li"><span class="grow">Plan</span><b>${P.label}</b></div><div class="li"><span class="grow">You pay</span><b class="num">${via==='SOL'?amt.toFixed(3):amt} ${via}</b></div><div class="li"><span class="grow">Renews</span><b>${new Date(Date.now()+P.days*864e5).toLocaleDateString()}</b></div></div><button class="btn primary block" id="pgo" style="margin-top:14px">Confirm and pay</button>`,
    m=>$('#pgo',m).onclick=()=>{closeModal();txRun(`Callit Premium · ${P.label}`,()=>{S.bal[via]-=amt;const base=isPrem(S.me)?S.premium.until:Date.now();S.premium={plan:S.plan||'yearly',until:base+P.days*864e5};try{localStorage.setItem('callit.premium',JSON.stringify(S.premium))}catch(_){}
     S.activity.unshift({k:'Sent',d:`${via==='SOL'?amt.toFixed(3):amt} ${via} for Callit Premium`,t:'Just now'});render();toast('Welcome to Premium ✓')})})},
  nf:()=>{S.nf=b.dataset.f;render()},newsx:()=>toast('Full articles open once the news feed is connected'),stscroll:()=>{const t=$('#'+b.dataset.f);t&&t.scrollBy({left:+b.dataset.d*t.clientWidth*.8,behavior:'smooth'})},
  lsign:()=>signIn(b.dataset.f),lwallet:()=>realAuth()?realLogin('wallet',undefined,null):connectModal(null,'in'),
  lemail:()=>{const v=($('#lxemail')||{}).value||'';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())){$('#lxerr').textContent='Enter a valid email address.';$('#lxemail').focus();return}signIn('Email',null,{email:v.trim()})},
  lexplore:()=>{try{sessionStorage.setItem('callit.explore','1')}catch(_){}location.hash='#/'+b.dataset.f;syncLanding()},
  doc:()=>docModal(b.dataset.f),soclink:()=>{e.preventDefault();toast(`Callit on ${b.dataset.f} is coming soon`)},editprof:()=>editProfile(b.dataset.f),follows:()=>followsModal(b.dataset.h,b.dataset.f),mt:()=>{if(S.mt===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});S.mt=b.dataset.f;render()},tpick:()=>pickToken(b.dataset.f),
  signup:()=>connectModal(null,'up'),signin:()=>connectModal(null,'in'),explore:()=>{try{sessionStorage.setItem('callit.explore','1')}catch(_){}syncLanding()},qbuy:()=>quickBuy(b.dataset.t,b.dataset.id),qsell:()=>quickBuy(b.dataset.t,b.dataset.id,'sell'),
  back:()=>goBack(),totop:()=>scrollTo({top:0,behavior:'smooth'}),
  join:()=>{const f=b.dataset.f;S.joined.has(f)?S.joined.delete(f):S.joined.add(f);toast(S.joined.has(f)?'Joined':'Left the community');render()},
  msend:()=>{const i=$('#msgin'),v=i&&i.value.trim();if(!v)return;(MSG[b.dataset.f]=MSG[b.dataset.f]||[]).push([S.me,v,'now']);render();const m=$('#msgs');m&&m.lastElementChild&&m.lastElementChild.scrollIntoView({block:'end',behavior:'smooth'});setTimeout(()=>{const n=$('#msgin');n&&n.focus()},50)},
  ptab:()=>{S.ptab=b.dataset.f;render()},connect:()=>connectModal(),search:()=>searchModal(),notifs:()=>notifsModal(),settings:()=>settingsModal(),
  disconnect:()=>{if(realAuth()){try{sessionStorage.removeItem('callit.explore')}catch(_){}window.CallitAuth&&window.CallitAuth.logout();return}S.connected=false;try{localStorage.removeItem('callit.session');sessionStorage.removeItem('callit.explore')}catch(_){}toast('Signed out');render()},
  me:()=>S.connected?location.hash='#/profile/'+S.me:connectModal(),
  collapse:()=>{document.body.classList.toggle('collapsed');syncTray()},
  tt:()=>{if(S.tt===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});S.tt=b.dataset.f;render();scrollTo({top:0})},
  fsopen:()=>openSheet('f'),dsopen:()=>openSheet('d'),shclose:()=>closeSheet(),
  fstab:()=>{SH.tab=b.dataset.v;drawSheet()},
  fschip:()=>{const a=SH.d[b.dataset.g],v=b.dataset.v,i=a.indexOf(v);i<0?a.push(v):a.splice(i,1);drawSheet()},
  fslpall:()=>{SH.d.lps=SH.d.lps.length===LPS.length?[]:LPS.map(l=>l[0]);drawSheet()},
  fsage:()=>{SH.d.ageMax=+b.dataset.v;drawSheet()},
  fstf:()=>{SH.d.tf=b.dataset.v;drawSheet()},
  ttf:()=>{TS.fil[S.tt]={...filOf(S.tt),tf:b.dataset.f};saveTS();render()},
  fsrisk:()=>{Object.assign(SH.d,RISK[b.dataset.v][2]);drawSheet()},
  fsflag:()=>{const k=b.dataset.v;SH.d[k]=SH.d[k]?0:1;drawSheet()},
  fsclear:()=>{SH.d=defFil();drawSheet()},
  fsapply:()=>{TS.fil[S.tt]=SH.d;saveTS();closeSheet();render()},
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
  repost:()=>{if(!S.connected)return connectModal();const k=calls.find(x=>x.id==b.dataset.id);k.reposted=!k.reposted;bg('/api/posts/react',{ref:String(k.id),kind:'repost',on:k.reposted});k.reposts+=k.reposted?1:-1;b.classList.toggle('reposted',k.reposted);b.querySelector('span').textContent=k.reposts||'';toast(k.reposted?'Reposted':'Repost removed')},
  reply:()=>{const a=b.closest('[data-go]');if(a&&a.dataset.go.startsWith('#/post/')){S.focusReply=true;location.hash=a.dataset.go}else{const i=$('#rin');i&&i.focus()}},
  rsend:()=>sendReply(b.dataset.id),
  rlike:()=>{if(!S.connected)return connectModal();const x=REPLIES[b.dataset.p][+b.dataset.i];x.liked=!x.liked;x.likes+=x.liked?1:-1;b.classList.toggle('liked',x.liked);b.innerHTML=`${ic('heart',17,x.liked)}<span class="num">${x.likes||''}</span>`},
  rrt:()=>{if(!S.connected)return connectModal();const x=REPLIES[b.dataset.p][+b.dataset.i];x.rted=!x.rted;x.rts+=x.rted?1:-1;b.classList.toggle('reposted',x.rted);b.querySelector('.num').textContent=x.rts||'';toast(x.rted?'Reposted':'Repost removed')},
  rrep:()=>{if(!S.connected)return connectModal();const i=$('#rin');if(!i)return;const tag='@'+b.dataset.h+' ';if(!i.value.startsWith(tag))i.value=tag+i.value;i.focus();i.setSelectionRange(i.value.length,i.value.length);i.dispatchEvent(new Event('input'));$('#rbox').scrollIntoView({block:'center',behavior:'smooth'})},
  share:()=>shareSheet(b.dataset.id),
  cat:()=>{if(S.cat===b.dataset.f)return scrollTo({top:0,behavior:'smooth'});S.cat=b.dataset.f;try{localStorage.setItem('callit.cat',S.cat)}catch(_){}if(S.cat==='perps')loadPerps();render();scrollTo({top:0})},
  pmenu:()=>{const k=calls.find(x=>String(x.id)===String(b.dataset.id));if(k)moreSheet(k.c,k)},
  profmenu:()=>moreSheet(b.dataset.h),
  xsearch:()=>xSearchSheet(b.dataset.k),
  xgo:()=>{window.open('https://x.com/search?q='+encodeURIComponent(b.dataset.v)+'&f=live','_blank','noopener');closeModal()},
  hmenu:()=>holdSheet(b.dataset.k),
  hshare:()=>{const k=b.dataset.k;closeModal();shareModal(holdCard(k),location.href.split('#')[0]+'#/token/'+encodeURIComponent(k),'callit-pnl-'+symOf(k),`My $${symOf(k)} position on Callit`)},
  hgo:()=>{const k=b.dataset.k,f=b.dataset.f;closeModal();if(f!=='view'){const w=S.swap;if(f==='sell'){w.from=k;w.to='SOL'}else{w.from='SOL';w.to=k}w.amt=''}location.hash='#/token/'+k},
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
  follow:()=>{if(!S.connected)return connectModal();const h=b.dataset.h,on=!S.following.has(h);toggleRel('follow',h,on);if(PUB[h]&&!PUB[h].pending)PUB[h].followers=Math.max(0,PUB[h].followers+(on?1:-1));render()},
  track:()=>{const t=b.dataset.t;S.watch.has(t)?S.watch.delete(t):S.watch.add(t);bg('/api/social',{action:'watch',key:t,on:S.watch.has(t)});toast(S.watch.has(t)?`$${symOf(t)} added to watchlist`:`$${symOf(t)} removed from watchlist`);render()},
  withdraw:()=>withdrawModal(),send:()=>withdrawModal(),receive:()=>depositModal(),deposit:()=>depositModal(),
  ltf:()=>{S.ltf=b.dataset.f;render()},lmode:()=>{S.lmode=b.dataset.f;render()},lretry:()=>{(lfIds(S.tt,filOf(S.tt))||[]).forEach(id=>{LIVE.err[id]=0;loadFeed(id)});render()},ltokretry:()=>{LIVE.tokErr[b.dataset.t]=0;render()},
  tside:()=>{const w=S.swap,t=b.dataset.t;if(b.dataset.f==='sell'){w.from=t;w.to='SOL'}else{w.from='SOL';w.to=t}w.amt='';renderSwaps()},
  flip:()=>{const w=S.swap;[w.from,w.to]=[w.to,w.from];w.amt='';renderSwaps()},
  doswap:()=>{const w=S.swap,x=parseFloat(w.amt),out=usd(w.from,x)*.995/T[w.to].price,imp=impact(w.to,usd(w.from,x));
   const go=()=>{const f=w.from,t=w.to;w.amt='';renderSwaps();if(REALW())return realSwap(f,t,x,f==='SOL'?`Buy $${symOf(t)} with ${fmtAmt(x)} SOL`:t==='SOL'?`Sell ${fmtAmt(x)} $${symOf(f)}`:`Swap ${fmtAmt(x)} ${symOf(f)} → ${symOf(t)}`);txRun(`Swap ${fmtAmt(x)} ${symOf(f)} → ${fmtAmt(out)} ${symOf(t)}`,()=>{S.bal[f]-=x;S.bal[t]=(S.bal[t]||0)+out;S.activity.unshift({k:'Swapped',d:`${fmtAmt(x)} ${symOf(f)} for ${fmtAmt(out)} ${symOf(t)}`,t:'Just now'});render()})};
   if(imp>15)return modal('High price impact',`This swap moves the price about ${imp.toFixed(1)}%. You may get much less than shown.`,`<button class="btn block" style="background:var(--down);color:#fff;border-color:var(--down)" id="impgo">Swap anyway</button><button class="btn ghost block" data-act="close" style="margin-top:8px">Cancel</button>`,m=>$('#impgo',m).onclick=()=>{closeModal();go()});
   go()},
  swmax:()=>{const w=S.swap,f=+b.dataset.f;w.amt=f===1?maxOf(w.from):String(+(+maxOf(w.from)*f).toFixed(6));renderSwaps();if(f===1&&w.from==='SOL')toast(`Kept ${FEE_RESERVE} SOL for network fees`)},
  slip:()=>{S.slip=+b.dataset.f;renderSwaps()},
  shownew:()=>{calls.forEach(k=>k.fresh=false);S.queued.forEach(k=>k.fresh=true);calls=[...S.queued,...calls];S.queued=[];render();scrollTo({top:0})},
  submitpromo:()=>{const n=$('#pn').value.trim(),l=$('#pl').value.trim(),p=$('#pp').value.trim();
   if(!n||!l||p.length<20)return $('#perr').textContent='Add a project name, a CA or website, and at least 20 characters about the project.';
   if(!S.connected)return connectModal();toast('Promotion request sent');location.hash='#/home'},
  theme:()=>{const r=document.documentElement,d=r.dataset.theme&&r.dataset.theme!=='system'?r.dataset.theme:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');r.dataset.theme=d==='dark'?'light':'dark'},
  settheme:()=>{const f=b.dataset.f;if(f==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=f;settingsModal()},
  setside:()=>{document.body.classList.toggle('collapsed',b.dataset.f==='closed');syncTray();settingsModal()}
 }[a];act&&act()});
document.addEventListener('input',e=>{if(e.target.dataset.swap!=='amt')return;S.swap.amt=e.target.value.replace(/[^0-9.]/g,'');
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
 document.querySelectorAll('[data-price]').forEach(el=>{const t=T[el.dataset.price];if(t)el.textContent=fmtPrice(t.price)})},3000);

setInterval(()=>{if(document.hidden)return;perpTick()},3000);
setInterval(()=>{if(document.hidden)return;if(calls.some(k=>k.perp)||S.cat==='perps')loadPerps();if(currentRoute()==='home')loadPosts()},20000);
loadPerps();if(realAuth())loadPosts();
/* simulated realtime: new calls arrive and wait behind the pill */
let QUEUED=false;
function queueDemoCalls(){if(QUEUED)return;QUEUED=true;setTimeout(()=>{const a=T[LIVEMAP.BSHK||'KFSH'],b=T[LIVEMAP.KOI||'DOTB'];if(!a||!b)return;
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
 fetchToken('So11111111111111111111111111111111111111112').then(x=>{if(x&&x.price){T.SOL.price=x.price;if(x.chg&&x.chg.h24!=null)T.SOL.chg=x.chg.h24;renderSwaps()}}).catch(()=>{});
 Promise.allSettled(ids.map(id=>{const [f,iv]=id.split(':');return fetchFeed(f,iv).then(l=>{LIVE.feeds[id]=l.map(regLive).filter(Boolean).map(t=>t.key);LIVE.err[id]=0;LIVE.at[id]=Date.now()})})).then(()=>{
  const c=pickLive();
  if(c.length>=8&&DEMO_KEYS.some(k=>T[k])){remapDemo(c);S.live='ok';queueDemoCalls();refreshLandingTicks();if(!document.querySelector('.sheet.open')&&!$('#modal').innerHTML)render();else S.dirty=1}
  else if(S.live!=='ok'){if(S.live==='wait'){S.live='demo';queueDemoCalls();render()}if(BOOT_TRIES<4)setTimeout(liveBoot,15000)}})}
S.live='wait';
setTimeout(()=>{if(S.live==='wait'){S.live='demo';queueDemoCalls();render()}},6000);
liveBoot();
render();

/* ---------- motion helpers ---------- */
(()=>{const RIP='.btn,.lxb,.buyb,.upg,.fab,.chip,.tpick,.mtabs button';
 const HOV='.btn,.lxb,.buyb,.upg,.fab,.chip,.tpick,.mtabs button,.pfollow button,.soc a,.bnadd,.ib,.tabs button,.tscroll>button,.scard,.rcard,.act,.notif,.comm';
 let hovEl=null;const setHov=el=>{if(hovEl===el)return;hovEl&&hovEl.classList.remove('hov');hovEl=el;el&&el.classList.add('hov')};
 document.addEventListener('pointerover',e=>{if(e.pointerType==='mouse')return;setHov(e.target.closest(HOV))},{passive:true});
 document.addEventListener('pointerout',e=>{if(e.pointerType==='mouse')return;if(hovEl&&!hovEl.contains(e.relatedTarget))setHov(null)},{passive:true});
 document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')setHov(e.target.closest(HOV))},{passive:true});
 ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,e=>{if(e.pointerType==='touch'){const el=hovEl;setTimeout(()=>{if(hovEl===el)setHov(null)},260)}},{passive:true}));const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
 document.addEventListener('pointerdown',e=>{const b=e.target.closest(RIP);if(!b||b.disabled)return;
  if(navigator.vibrate&&e.pointerType==='touch')try{navigator.vibrate(8)}catch(_){}
  if(reduce)return;const r=b.getBoundingClientRect(),d=Math.max(r.width,r.height)*2.2,s=document.createElement('span');s.className='rip';
  s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left}px;top:${e.clientY-r.top}px`;b.appendChild(s);setTimeout(()=>s.remove(),650)},{passive:true});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-act="like"],[data-act="rlike"],[data-act="repost"],[data-act="rrt"]');if(!b||!b.isConnected)return;
  const cls=/like/.test(b.dataset.act)?'pop':'spin';b.classList.remove(cls);void b.offsetWidth;b.classList.add(cls);
  const sv=b.querySelector('svg');if(sv)b.style.setProperty('--bx',(sv.offsetLeft+sv.offsetWidth/2)+'px');setTimeout(()=>b.classList.remove(cls),600)});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-act="follow"]');if(!b)return;const h=b.dataset.h;
  requestAnimationFrame(()=>document.querySelectorAll(`[data-act="follow"][data-h="${CSS.escape(h)}"]`).forEach(x=>{x.classList.add('bump');setTimeout(()=>x.classList.remove('bump'),500)}))});
})();

  // used by an inline handler in the reply box
  (window as any).drawRMedia = drawRMedia;
}
