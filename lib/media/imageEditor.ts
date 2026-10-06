'use client';

/**
 * Full-screen image editor for post attachments: crop, draw, text, blur and emoji.
 * Works on a local copy of the image (data: URLs only, so the canvas is never tainted)
 * and resolves with an edited JPEG/PNG data URL, or null if the user cancels.
 */

type Tool = 'crop' | 'draw' | 'text' | 'blur' | 'emoji';
type Sticker = { kind: 'text' | 'emoji'; value: string; x: number; y: number; size: number; color: string };
type Rect = { x: number; y: number; w: number; h: number };

const MAX = 1800;
const COLORS = ['#FFFFFF', '#111111', '#FF4D5E', '#FFB020', '#3DDC97', '#4DA8FF', '#9B7BFF'];
const EMOJIS = ['🚀', '🔥', '💎', '🙌', '📈', '📉', '🐸', '🐳', '👀', '💰', '⚡', '🎯', '😂', '🥲', '😤', '🫡', '✅', '❌', '🟢', '🔴', '🌕', '🐂', '🐻', '💀'];
const ASPECTS: [string, number | null][] = [['Free', null], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];

const icon = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  crop: icon('<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>'),
  draw: icon('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  text: icon('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  blur: icon('<circle cx="6" cy="6" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="18" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="12" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>'),
  emoji: icon('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  undo: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>'),
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not open this image')); im.src = src; });
}

export async function openImageEditor(src: string): Promise<string | null> {
  if (!/^data:image\//.test(src) || /^data:image\/gif/.test(src)) return null;
  const img = await loadImage(src);
  const keepPng = /^data:image\/png/.test(src);
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));

  // The working raster. Every edit is baked into it; undo keeps snapshots.
  let work = document.createElement('canvas');
  work.width = Math.round(img.naturalWidth * scale);
  work.height = Math.round(img.naturalHeight * scale);
  work.getContext('2d')!.drawImage(img, 0, 0, work.width, work.height);
  const undo: HTMLCanvasElement[] = [];
  const snapshot = () => {
    const c = document.createElement('canvas'); c.width = work.width; c.height = work.height;
    c.getContext('2d')!.drawImage(work, 0, 0); undo.push(c); if (undo.length > 10) undo.shift(); syncUndo();
  };

  let tool: Tool = 'draw', color = COLORS[2], size = 8, aspect: number | null = null;
  let stickers: Sticker[] = [], active = -1;
  let crop: Rect | null = null;

  const root = document.createElement('div');
  root.className = 'ied';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Edit image');
  root.innerHTML = `
    <div class="ied-top"><button type="button" class="ied-btn" data-x="cancel">Cancel</button>
      <button type="button" class="ied-ic" data-x="undo" aria-label="Undo">${I.undo}</button>
      <button type="button" class="ied-btn ied-done" data-x="done">Done</button></div>
    <div class="ied-stage"><canvas class="ied-cv"></canvas></div>
    <div class="ied-opts"></div>
    <div class="ied-tools" role="toolbar">${(['crop', 'draw', 'text', 'blur', 'emoji'] as Tool[]).map((t) => `<button type="button" data-t="${t}" aria-label="${t}">${I[t]}<span>${t[0].toUpperCase() + t.slice(1)}</span></button>`).join('')}</div>`;
  document.body.appendChild(root);
  document.body.classList.add('lock');
  const cv = root.querySelector<HTMLCanvasElement>('.ied-cv')!;
  const ctx = cv.getContext('2d')!;
  const opts = root.querySelector<HTMLDivElement>('.ied-opts')!;
  const syncUndo = () => { root.querySelector<HTMLButtonElement>('[data-x="undo"]')!.disabled = !undo.length; };
  syncUndo();

  // ---------- rendering ----------
  const fitCanvas = () => { cv.width = work.width; cv.height = work.height; };
  const font = (s: Sticker) => `${s.kind === 'emoji' ? '' : '800 '}${s.size}px ${s.kind === 'emoji' ? 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif' : 'Inter, system-ui, sans-serif'}`;
  const paintSticker = (c: CanvasRenderingContext2D, s: Sticker) => {
    c.save(); c.font = font(s); c.textAlign = 'center'; c.textBaseline = 'middle';
    if (s.kind === 'text') { c.lineJoin = 'round'; c.lineWidth = Math.max(3, s.size / 7); c.strokeStyle = s.color === '#111111' ? '#FFFFFF' : 'rgba(0,0,0,.75)'; c.strokeText(s.value, s.x, s.y); c.fillStyle = s.color; }
    c.fillText(s.value, s.x, s.y); c.restore();
  };
  const bbox = (s: Sticker): Rect => { ctx.font = font(s); const w = ctx.measureText(s.value).width; return { x: s.x - w / 2 - 8, y: s.y - s.size * 0.6 - 8, w: w + 16, h: s.size * 1.2 + 16 }; };
  const render = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(work, 0, 0);
    stickers.forEach((s, i) => {
      paintSticker(ctx, s);
      if (i === active) { const b = bbox(s); ctx.save(); ctx.setLineDash([10, 8]); ctx.lineWidth = Math.max(2, cv.width / 400); ctx.strokeStyle = '#fff'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore(); }
    });
    if (tool === 'crop' && crop) {
      const lw = Math.max(2, cv.width / 400), hs = Math.max(14, cv.width / 40);
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(crop.x, crop.y, crop.w, crop.h); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.globalAlpha = .45; ctx.beginPath();
      for (let k = 1; k < 3; k++) { ctx.moveTo(crop.x + crop.w * k / 3, crop.y); ctx.lineTo(crop.x + crop.w * k / 3, crop.y + crop.h); ctx.moveTo(crop.x, crop.y + crop.h * k / 3); ctx.lineTo(crop.x + crop.w, crop.y + crop.h * k / 3); }
      ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      for (const [hx, hy] of corners(crop)) ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.restore();
    }
  };
  const corners = (r: Rect): [number, number][] => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];

  // ---------- helpers ----------
  const pt = (e: PointerEvent) => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (cv.width / b.width), y: (e.clientY - b.top) * (cv.height / b.height) }; };
  const flatten = () => {
    if (!stickers.length) return;
    snapshot(); const c = work.getContext('2d')!; stickers.forEach((s) => paintSticker(c, s)); stickers = []; active = -1;
  };
  const defaultCrop = (): Rect => {
    const W = work.width, H = work.height;
    if (!aspect) return { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 };
    let w = W * 0.9, h = w / aspect; if (h > H * 0.9) { h = H * 0.9; w = h * aspect; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };
  const blurred = () => {
    // Pixelate-blur: shrink then smooth back up. Works in every browser (no ctx.filter needed).
    const f = Math.max(18, Math.round(Math.max(work.width, work.height) / 28));
    const sm = document.createElement('canvas'); sm.width = Math.max(1, Math.round(work.width / f)); sm.height = Math.max(1, Math.round(work.height / f));
    const s = sm.getContext('2d')!; s.imageSmoothingEnabled = true; s.drawImage(work, 0, 0, sm.width, sm.height);
    const out = document.createElement('canvas'); out.width = work.width; out.height = work.height;
    const o = out.getContext('2d')!; o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high'; o.drawImage(sm, 0, 0, out.width, out.height);
    return out;
  };

  // ---------- options row per tool ----------
  const drawOpts = () => {
    const colorRow = `<div class="ied-row">${COLORS.map((c) => `<button type="button" class="ied-sw${c === color ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>`;
    const sizeRow = (lab: string, min: number, max: number) => `<label class="ied-size"><span>${lab}</span><input type="range" min="${min}" max="${max}" value="${size}" data-size></label>`;
    if (tool === 'crop') opts.innerHTML = `<div class="ied-row">${ASPECTS.map(([l, v]) => `<button type="button" class="ied-chip${v === aspect ? ' on' : ''}" data-a="${l}">${l}</button>`).join('')}<button type="button" class="ied-chip ied-apply" data-x="crop">Apply crop</button></div>`;
    else if (tool === 'draw') opts.innerHTML = colorRow + sizeRow('Brush', 2, 40);
    else if (tool === 'blur') opts.innerHTML = sizeRow('Blur brush', 10, 90) + `<p class="ied-hint">Rub over anything you want to hide.</p>`;
    else if (tool === 'text') opts.innerHTML = `<div class="ied-row"><input class="ied-in" maxlength="60" placeholder="Type, then Add" enterkeyhint="done"><button type="button" class="ied-chip ied-apply" data-x="addtext">Add</button></div>${colorRow}<p class="ied-hint">Drag text to move it. Tap it, then use the slider to resize.</p>${sizeRow('Size', 20, 200)}`;
    else opts.innerHTML = `<div class="ied-row ied-emo">${EMOJIS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>${sizeRow('Size', 30, 300)}<p class="ied-hint">Drag to place.</p>`;
  };
  const setTool = (t: Tool) => {
    if (tool === 'crop' && t !== 'crop') crop = null;
    if ((tool === 'text' || tool === 'emoji') && t !== 'text' && t !== 'emoji') flatten();
    tool = t;
    if (t === 'draw') size = Math.min(size, 40) || 8;
    if (t === 'blur') size = Math.max(30, Math.min(size, 90));
    if (t === 'text') size = 64;
    if (t === 'emoji') size = 120;
    if (t === 'crop') crop = defaultCrop();
    root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    drawOpts(); render();
  };

  // ---------- pointer interaction ----------
  let drag: { mode: string; x: number; y: number; start?: Rect; dx?: number; dy?: number; corner?: number; blur?: HTMLCanvasElement } | null = null;
  const hitSticker = (p: { x: number; y: number }) => {
    for (let i = stickers.length - 1; i >= 0; i--) { const b = bbox(stickers[i]); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i; }
    return -1;
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); const p = pt(e);
    if (tool === 'crop' && crop) {
      const hs = Math.max(28, cv.width / 20), c = corners(crop).findIndex(([x, y]) => Math.abs(p.x - x) < hs && Math.abs(p.y - y) < hs);
      if (c >= 0) drag = { mode: 'corner', corner: c, x: p.x, y: p.y, start: { ...crop } };
      else if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) drag = { mode: 'move', x: p.x, y: p.y, start: { ...crop } };
      return;
    }
    if (tool === 'text' || tool === 'emoji') {
      const i = hitSticker(p); active = i;
      if (i >= 0) { drag = { mode: 'sticker', x: p.x, y: p.y, dx: p.x - stickers[i].x, dy: p.y - stickers[i].y }; size = Math.round(stickers[i].size * 900 / work.width); drawOpts(); }
      render(); return;
    }
    snapshot();
    const c = work.getContext('2d')!;
    if (tool === 'draw') { c.strokeStyle = color; c.lineWidth = size * (work.width / 900); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.01, p.y); c.stroke(); drag = { mode: 'draw', x: p.x, y: p.y }; }
    else { drag = { mode: 'blur', x: p.x, y: p.y, blur: blurred() }; dab(p.x, p.y, p.x, p.y); }
    render();
  });
  const dab = (x0: number, y0: number, x1: number, y1: number) => {
    if (!drag?.blur) return; const c = work.getContext('2d')!, r = size * (work.width / 900);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 3)));
    c.save(); c.beginPath();
    for (let k = 0; k <= steps; k++) { const x = x0 + (x1 - x0) * k / steps, y = y0 + (y1 - y0) * k / steps; c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
    c.clip(); c.drawImage(drag.blur, 0, 0); c.restore();
  };
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = pt(e);
    if (drag.mode === 'draw') { const c = work.getContext('2d')!; c.lineTo(p.x, p.y); c.stroke(); }
    else if (drag.mode === 'blur') dab(drag.x, drag.y, p.x, p.y);
    else if (drag.mode === 'sticker' && active >= 0) { stickers[active].x = p.x - (drag.dx || 0); stickers[active].y = p.y - (drag.dy || 0); }
    else if (crop && drag.start) {
      const s = drag.start, W = work.width, H = work.height, min = Math.max(40, W / 15);
      if (drag.mode === 'move') { crop.x = Math.min(Math.max(0, s.x + p.x - drag.x), W - s.w); crop.y = Math.min(Math.max(0, s.y + p.y - drag.y), H - s.h); }
      else {
        const left = drag.corner === 0 || drag.corner === 2, top = drag.corner === 0 || drag.corner === 1;
        const ax = left ? s.x + s.w : s.x, ay = top ? s.y + s.h : s.y; // fixed opposite corner
        let w = Math.max(min, Math.abs(Math.min(Math.max(0, p.x), W) - ax)), h = Math.max(min, Math.abs(Math.min(Math.max(0, p.y), H) - ay));
        if (aspect) { if (w / h > aspect) w = h * aspect; else h = w / aspect; }
        w = Math.min(w, left ? ax : W - ax); h = Math.min(h, top ? ay : H - ay);
        if (aspect) { if (w / h > aspect) w = h * aspect; else h = w / aspect; }
        crop = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
      }
    }
    drag.x = p.x; drag.y = p.y; render();
  });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  // ---------- buttons ----------
  return new Promise<string | null>((resolve) => {
    const close = (out: string | null) => { root.remove(); document.body.classList.remove('lock'); resolve(out); };
    const applyCrop = () => {
      if (!crop) return; snapshot();
      const c = document.createElement('canvas'); c.width = Math.round(crop.w); c.height = Math.round(crop.h);
      c.getContext('2d')!.drawImage(work, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      work = c; fitCanvas(); crop = defaultCrop(); render();
    };
    const addText = () => {
      const inp = opts.querySelector<HTMLInputElement>('.ied-in'); const v = (inp?.value || '').trim(); if (!v) { inp?.focus(); return; }
      stickers.push({ kind: 'text', value: v, x: work.width / 2, y: work.height / 2, size: Math.round(64 * work.width / 900), color }); active = stickers.length - 1; if (inp) inp.value = ''; render();
    };
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tb = t.closest<HTMLButtonElement>('[data-t]'); if (tb) { setTool(tb.dataset.t as Tool); return; }
      const x = t.closest<HTMLButtonElement>('[data-x]')?.dataset.x;
      if (x === 'cancel') return close(null);
      if (x === 'undo') { const u = undo.pop(); if (u) { work = u; stickers = []; active = -1; fitCanvas(); if (tool === 'crop') crop = defaultCrop(); render(); } syncUndo(); return; }
      if (x === 'done') { flatten(); return close(work.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.92)); }
      if (x === 'crop') return applyCrop();
      if (x === 'addtext') return addText();
      const sw = t.closest<HTMLButtonElement>('[data-c]');
      if (sw) { color = sw.dataset.c!; if (active >= 0 && stickers[active].kind === 'text') stickers[active].color = color; drawOpts(); render(); return; }
      const a = t.closest<HTMLButtonElement>('[data-a]');
      if (a) { aspect = (ASPECTS.find(([l]) => l === a.dataset.a) || ['', null])[1]; crop = defaultCrop(); drawOpts(); render(); return; }
      const em = t.closest<HTMLButtonElement>('[data-e]');
      if (em) { stickers.push({ kind: 'emoji', value: em.dataset.e!, x: work.width / 2, y: work.height / 2, size: Math.round(120 * work.width / 900), color: '#fff' }); active = stickers.length - 1; render(); }
    });
    root.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement; if (!r.matches('[data-size]')) return;
      size = +r.value; if (active >= 0 && (tool === 'text' || tool === 'emoji')) { stickers[active].size = Math.round(size * work.width / 900); render(); }
    });
    root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).matches('.ied-in') && e.key === 'Enter') { e.preventDefault(); addText(); }
      if (e.key === 'Escape') close(null);
    });
    fitCanvas(); setTool('crop');
  });
}
