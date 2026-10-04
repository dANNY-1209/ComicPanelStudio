'use strict';
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function applyStatic(){
  document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => el.innerHTML = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
  $('#bLang').textContent = LANG === 'zh' ? 'EN' : '中';
}
function setLang(l){
  LANG = l; try { localStorage.setItem('cps-lang', l); } catch {}
  tplThumbCache = null; applyStatic(); renderAll();
}

/* ================= 狀態 ================= */
let doc = null;
const assets = new Map();            // id -> {id, blob, url, w, h, name, t}
const ui = { page:0, layer:0, sel:null, selK:'p', selV:null, imgEdit:false, tool:'select', zoom:1, dimOther:false, tab:'layout', slant:0 };
const file = { dir:null, dirName:'', dirty:false };
const PAD = 80;

function defaultSettings(){ return { w:1600, h:2259, margin:80, gutter:28, stroke:6, strokeColor:'#111111', bg:'#ffffff' }; }
function newLayer(){ return { visible:true, opacity:1, locked:false, panels:[], items:[] }; }
function newPage(){ return { id:uid(), kind:'page', ov:{}, layers:[newLayer(), newLayer(), newLayer()] }; }
const TEXT_LAYER = 2;   // 文字層：文字、對話框、標題 Logo 只能放這裡
const TEXT_KINDS = new Set(['text', 'bubble', 'titlelogo']);
const isTextKind = k => TEXT_KINDS.has(k);
const curPage  = () => doc.pages[ui.page];
const curLayer = () => curPage().layers[ui.layer];
const isCoverFmt = (pg = curPage()) => pg.kind === 'cover' || pg.kind === 'back' || pg.kind === 'insert';
// 封面格式時，第 0 層叫「底圖」，第 1 層（上層）不使用
const layerName = (li, pg = curPage()) => li === 0 && isCoverFmt(pg) ? t('layerBase') : t('layer' + li);
const visibleLayers = (pg = curPage()) => isCoverFmt(pg) ? [0, TEXT_LAYER] : [0, 1, TEXT_LAYER];
// 把頁面整理成封面格式：上層的格子併到底圖、所有圖案與文字都移到文字層
function toCoverFormat(pg){
  const [L0, L1, LT] = pg.layers;
  L0.panels.push(...L1.panels); L1.panels = [];
  const moved = [...L0.items, ...L1.items]; L0.items = []; L1.items = [];
  LT.items = [...moved, ...LT.items];
  LT.panels.forEach(p => L0.panels.push(p)); LT.panels = [];
}
// 封面格式時：格子相關操作一律在底圖、圖案文字一律在文字層
function fixLayer(){ if (doc && isCoverFmt() && ui.layer === 1) ui.layer = TEXT_LAYER; }
function ensurePanelLayer(){ if (isCoverFmt() && ui.layer !== 0){ ui.layer = 0; deselect(); toast(t('toBaseLayer')); } }
// 此頁實際使用的設定（全域預設 + 此頁自訂）
const PS = (pg = curPage()) => ({ ...doc.settings, ...(pg.ov || {}) });
const selPanel = () => ui.sel && ui.selK === 'p' ? curLayer().panels.find(p => p.id === ui.sel) || null : null;
const selItem  = () => ui.sel && ui.selK === 'i' ? curLayer().items.find(p => p.id === ui.sel) || null : null;
function makePanel(pts, opt = {}, pg){
  const S = PS(pg);
  return { id:uid(), pts, img:null, sw:S.stroke, sc:S.strokeColor, fill:'none', ...opt };
}
function clonePanel(p){ const c = JSON.parse(JSON.stringify(p)); c.id = uid(); return c; }
const safeName = s => (String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'comic').slice(0, 80);
function normalizeDoc(d){
  d.settings = { ...defaultSettings(), ...d.settings };
  d.pages.forEach(pg => { pg.kind = pg.kind || 'page'; pg.ov = pg.ov || {};
    pg.layers.forEach(L => { delete L.name; L.items = L.items || []; L.panels = L.panels || [];
      L.items = L.items.map(migrateItem).filter(it => STK[it.k]);   // 已不存在的貼圖（例如臉紅）直接移除
      L.items.forEach(it => { if (it.k === 'text') it.p = { ...FX_DEFAULTS, ...it.p }; }); });
    while (pg.layers.length < 3) pg.layers.push(newLayer());
    if (isCoverFmt(pg)) toCoverFormat(pg);
    for (let li = 0; li < TEXT_LAYER; li++){
      const L = pg.layers[li], moving = L.items.filter(it => isTextKind(it.k));
      if (moving.length){ L.items = L.items.filter(it => !isTextKind(it.k)); pg.layers[TEXT_LAYER].items.push(...moving); }
    } });
  return d;
}

/* ================= 幾何 ================= */
const ptsStr = pts => pts.map(p => (+p[0]).toFixed(1) + ',' + (+p[1]).toFixed(1)).join(' ');
function bbox(pts){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts){ if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x:x0, y:y0, x1, y1, w:x1 - x0, h:y1 - y0 };
}
function area(pts){ let a = 0; for (let i = 0; i < pts.length; i++){ const p = pts[i], q = pts[(i+1) % pts.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; }
function centroid(pts){
  const A = area(pts);
  if (Math.abs(A) < 1e-6){ const b = bbox(pts); return [b.x + b.w/2, b.y + b.h/2]; }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++){ const p = pts[i], q = pts[(i+1) % pts.length], f = p[0]*q[1] - q[0]*p[1]; cx += (p[0]+q[0])*f; cy += (p[1]+q[1])*f; }
  return [cx / (6*A), cy / (6*A)];
}
function clipHalf(pts, P, Q, sign, off){
  const dx = Q[0]-P[0], dy = Q[1]-P[1], len = Math.hypot(dx, dy) || 1;
  const f = pt => sign * ((dx*(pt[1]-P[1]) - dy*(pt[0]-P[0])) / len) - off;
  const out = [];
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i+1) % pts.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)){ const tt = fa / (fa - fb); out.push([a[0] + (b[0]-a[0])*tt, a[1] + (b[1]-a[1])*tt]); }
  }
  return out;
}
function cleanPoly(pts){
  const out = [];
  for (const p of pts){ const q = out[out.length-1]; if (!q || Math.hypot(p[0]-q[0], p[1]-q[1]) > 0.5) out.push([Math.round(p[0]*10)/10, Math.round(p[1]*10)/10]); }
  if (out.length > 1){ const a = out[0], b = out[out.length-1]; if (Math.hypot(a[0]-b[0], a[1]-b[1]) <= 0.5) out.pop(); }
  return Math.abs(area(out)) < 4 ? [] : out;
}
function pointInPoly(pt, pts){
  let inside = false;
  for (let i = 0, j = pts.length-1; i < pts.length; j = i++){
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi) + xi) inside = !inside;
  }
  return inside;
}
function segInter(a, b, c, d){
  const r = [b[0]-a[0], b[1]-a[1]], s = [d[0]-c[0], d[1]-c[1]], den = r[0]*s[1] - r[1]*s[0];
  if (Math.abs(den) < 1e-9) return false;
  const tt = ((c[0]-a[0])*s[1] - (c[1]-a[1])*s[0]) / den, u = ((c[0]-a[0])*r[1] - (c[1]-a[1])*r[0]) / den;
  return tt >= 0 && tt <= 1 && u >= 0 && u <= 1;
}
function segHitsPoly(A, B, pts){
  if (pointInPoly(A, pts) || pointInPoly(B, pts)) return true;
  for (let i = 0; i < pts.length; i++) if (segInter(A, B, pts[i], pts[(i+1) % pts.length])) return true;
  return false;
}
// 物件座標轉換
const rotP = (x, y, deg) => { const a = deg * Math.PI/180, c = Math.cos(a), s = Math.sin(a); return [c*x - s*y, s*x + c*y]; };
const toWorld = (it, lx, ly) => { const [x, y] = rotP(lx, ly, it.r || 0); return [it.x + x, it.y + y]; };
const toLocal = (it, pt) => rotP(pt[0] - it.x, pt[1] - it.y, -(it.r || 0));

/* ================= 分格模板 ================= */
function layoutPolys(node, poly, g){
  if (!node) return [poly];
  const b = bbox(poly), n = node.z.length, tot = node.z.reduce((a, c) => a + c, 0);
  const cuts = []; let acc = 0;
  for (let i = 0; i < n-1; i++){
    acc += node.z[i]; const tt = acc / tot, k = (node.k && node.k[i]) || 0;
    if (node.d === 'h') cuts.push([[b.x, b.y + (tt - k/2)*b.h], [b.x1, b.y + (tt + k/2)*b.h]]);
    else                cuts.push([[b.x + (tt + k/2)*b.w, b.y], [b.x + (tt - k/2)*b.w, b.y1]]);
  }
  const after = node.d === 'h' ? 1 : -1, res = [];
  for (let i = 0; i < n; i++){
    let p = poly;
    if (i > 0)   p = clipHalf(p, cuts[i-1][0], cuts[i-1][1],  after, g/2);
    if (i < n-1) p = clipHalf(p, cuts[i][0],   cuts[i][1],   -after, g/2);
    p = cleanPoly(p);
    if (p.length >= 3) res.push(...layoutPolys(node.c && node.c[i], p, g));
  }
  return res;
}
const V2 = { d:'v', z:[1,1] };
const TEMPLATES = [
  { name:['單格','Single'],         n:null },
  { name:['上下二格','2 Rows'],     n:{ d:'h', z:[1,1] } },
  { name:['三段','3 Rows'],         n:{ d:'h', z:[1,1,1] } },
  { name:['四格','4-Koma'],         n:{ d:'h', z:[1,1,1,1] } },
  { name:['田字','2×2 Grid'],       n:{ d:'h', z:[1,1], c:[V2,V2] } },
  { name:['六格','6 Grid'],         n:{ d:'h', z:[1,1,1], c:[V2,V2,V2] } },
  { name:['大上二下','Big Top'],    n:{ d:'h', z:[2,1], c:[null,V2] } },
  { name:['二上大下','Big Bottom'], n:{ d:'h', z:[1,2], c:[V2,null] } },
  { name:['左大右三','Big Left'],   n:{ d:'v', z:[3,2], c:[null,{ d:'h', z:[1,1,1] }] } },
  { name:['經典五格','Classic 5'],  n:{ d:'h', z:[1,1.3,1], c:[{ d:'v', z:[1.4,1] }, null, { d:'v', z:[1,1.5] }] } },
  { name:['七格','7 Panels'],       n:{ d:'h', z:[1,1,1], c:[{ d:'v', z:[1,2] }, { d:'v', z:[1,1,1] }, { d:'v', z:[2,1] }] } },
  { name:['左長條','Tall Left'],    n:{ d:'v', z:[1,2.2], c:[null,{ d:'h', z:[1,1,1] }] } },
  { name:['斜切三段','Slant 3'],    n:{ d:'h', z:[1,1,1], k:[0.08,-0.08] } },
  { name:['對角二格','Diagonal'],   n:{ d:'h', z:[1,1], k:[0.5] } },
  { name:['斜中段','Slant Mid'],    n:{ d:'h', z:[1,1.4,1], c:[V2,{ d:'v', z:[1,1], k:[0.2] },V2] } },
  { name:['動作頁','Action'],       n:{ d:'h', z:[1,1.6,1], k:[0.06,-0.1], c:[{ d:'v', z:[2,1], k:[0.12] }, null, { d:'v', z:[1,1,1], k:[-0.12,0.12] }] } },
  { name:['斜直三','Slant Cols'],   n:{ d:'v', z:[1,1,1], k:[0.15,0.15] } },
  { name:['斜七格','Slant 7'],      n:{ d:'h', z:[1,1,1], k:[0.05,-0.05], c:[{ d:'v', z:[1,2], k:[0.1] }, { d:'v', z:[1,1,1], k:[0.1,-0.1] }, { d:'v', z:[2,1], k:[-0.1] }] } },
  { name:['爆炸斜切','Burst'],      n:{ d:'h', z:[1,1], k:[-0.25], c:[{ d:'v', z:[1,1], k:[0.3] }, { d:'v', z:[1,1], k:[-0.3] }] } },
  { name:['斜四格','Slant 4'],      n:{ d:'h', z:[1,1,1,1], k:[0.06,-0.06,0.06] } },
];
const SHAPES = [
  { name:['矩形','Rect'],             pts:[[0,0],[1,0],[1,1],[0,1]] },
  { name:['左斜','Left Slant'],       pts:[[.18,0],[1,0],[1,1],[0,1]] },
  { name:['右斜','Right Slant'],      pts:[[0,0],[.82,0],[1,1],[0,1]] },
  { name:['上斜','Top Slant'],        pts:[[0,.25],[1,0],[1,1],[0,1]] },
  { name:['下斜','Bottom Slant'],     pts:[[0,0],[1,0],[1,.75],[0,1]] },
  { name:['平行四邊','Parallelogram'],pts:[[.18,0],[1,0],[.82,1],[0,1]] },
  { name:['梯形','Trapezoid'],        pts:[[.15,0],[.85,0],[1,1],[0,1]] },
  { name:['三角','Triangle'],         pts:[[.5,0],[1,1],[0,1]] },
  { name:['切角','Cut Corner'],       pts:[[0,0],[1,0],[1,.65],[.65,1],[0,1]] },
  { name:['菱形','Diamond'],          pts:[[.5,0],[1,.5],[.5,1],[0,.5]] },
  { name:['內框滿版','Full (Margin)'],full:'inner' },
  { name:['出血滿版','Full Bleed'],   full:'bleed' },
];

/* ================= 圖片 ================= */
function imgTf(im, a){ return `translate(${im.cx} ${im.cy}) rotate(${im.r||0}) scale(${im.s*(im.fx?-1:1)} ${im.s}) translate(${-a.w/2} ${-a.h/2})`; }
function fitImg(p, a, mode){
  const b = bbox(p.pts);
  const s = mode === 'contain' ? Math.min(b.w/a.w, b.h/a.h) : Math.max(b.w/a.w, b.h/a.h);
  return { cx:b.x + b.w/2, cy:b.y + b.h/2, s };
}
const coverScale = (p, a) => { const b = bbox(p.pts); return Math.max(b.w/a.w, b.h/a.h); };
function setPanelImage(p, a){ p.img = { a:a.id, r:0, fx:false, ...fitImg(p, a, 'cover') }; }
function imgCorners(im, a){
  const rad = (im.r||0) * Math.PI/180, c = Math.cos(rad), s = Math.sin(rad), sx = im.s*(im.fx?-1:1), sy = im.s;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => { const x = u*a.w/2*sx, y = v*a.h/2*sy; return [im.cx + c*x - s*y, im.cy + s*x + c*y]; });
}

/* ================= 歷史紀錄 ================= */
let undoStack = [], redoStack = [], lastGesture = { k:null, t:0 };
const snapshot = () => JSON.stringify({ name:doc.name, settings:doc.settings, pages:doc.pages });
function pushHistory(){ undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack = []; lastGesture.k = null; }
function gesture(k){ const now = Date.now(); if (lastGesture.k !== k || now - lastGesture.t > 1000) { pushHistory(); lastGesture.k = k; } lastGesture.t = now; }
function restore(str){
  const o = JSON.parse(str); doc.settings = o.settings; doc.pages = o.pages;
  ui.page = clamp(ui.page, 0, doc.pages.length-1);
  if (!selPanel() && !selItem()) { ui.sel = null; ui.imgEdit = false; }
  ui.selV = null; commit(); renderAll();
}
function undo(){ if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); toast(t('undoT')); }
function redo(){ if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); toast(t('redoT')); }

/* ================= 瀏覽器暫存 (IndexedDB) ================= */
let db;
function openDB(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('comic-panel-studio', 2);
    r.onupgradeneeded = () => { const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath:'id' });
      if (!d.objectStoreNames.contains('fonts')) d.createObjectStore('fonts', { keyPath:'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn){
  return new Promise((res, rej) => {
    if (!db) return res(undefined);
    const tr = db.transaction(store, mode), req = fn(tr.objectStore(store));
    tr.oncomplete = () => res(req && req.result); tr.onerror = () => rej(tr.error);
  });
}
let cacheTimer = null;
function scheduleCache(){
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(async () => {
    try {
      await tx('kv', 'readwrite', s => s.put(JSON.parse(snapshot()), 'doc'));
      await tx('kv', 'readwrite', s => s.put({ dir:file.dir, dirName:file.dirName, dirty:file.dirty }, 'file'));
    } catch (e) { console.error(e); }
  }, 400);
}
async function addAsset(blob, name, id){
  const bmp = await createImageBitmap(blob);
  const a = { id:id || uid(), blob, name:name || 'image', w:bmp.width, h:bmp.height, t:Date.now() + assets.size };
  bmp.close();
  await tx('assets', 'readwrite', s => s.put(a));
  a.url = URL.createObjectURL(blob);
  assets.set(a.id, a);
  return a;
}
async function removeAsset(id){
  const a = assets.get(id); if (!a) return;
  await tx('assets', 'readwrite', s => s.delete(id));
  URL.revokeObjectURL(a.url); assets.delete(id); bmpCache.delete(id);
}
async function clearAssets(){ for (const id of [...assets.keys()]) await removeAsset(id); }
function commit(){ file.dirty = true; updateFileState(); scheduleCache(); refreshThumb(); }

/* ================= 字體 ================= */
function loadWebFonts(){
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = fontsURL(); document.head.appendChild(l);
  let tm = null;
  document.fonts.addEventListener('loadingdone', () => {
    clearTimeout(tm);
    tm = setTimeout(() => { if (drag) return; renderStage(); renderPages(); if (ui.tab === 'stickers' || ui.tab === 'layout') renderSide(); }, 250);
  });
}
async function registerFont(f){
  const face = new FontFace('cps_' + f.id, await f.blob.arrayBuffer());
  await face.load(); document.fonts.add(face); f.face = face; customFonts.set(f.id, f);
}
async function addFontFile(blob, name, id, tt){
  const ext = (/\.(ttf|otf|woff2?)$/i.exec(name) || ['', 'ttf'])[1].toLowerCase();
  const f = { id:id || uid(), name:name.replace(/\.(ttf|otf|woff2?)$/i, ''), blob, ext, t:tt || Date.now() };
  await registerFont(f);
  await tx('fonts', 'readwrite', s => s.put({ id:f.id, name:f.name, blob:f.blob, ext:f.ext, t:f.t }));
  return f;
}
async function removeFont(id){
  const f = customFonts.get(id); if (!f) return;
  if (f.face) document.fonts.delete(f.face);
  customFonts.delete(id); await tx('fonts', 'readwrite', s => s.delete(id));
}
async function clearFonts(){ for (const id of [...customFonts.keys()]) await removeFont(id); }

/* ================= 渲染：工作區 ================= */
const svg = $('#stage'), work = $('#work');
function panelSVG(p){
  const pts = ptsStr(p.pts), a = p.img && assets.get(p.img.a);
  let s = '';
  if (p.fill && p.fill !== 'none') s += `<polygon id="fill-${p.id}" points="${pts}" fill="${p.fill}"/>`;
  if (a) s += `<g clip-path="url(#clip-${p.id})"><image id="img-${p.id}" href="${a.url}" width="${a.w}" height="${a.h}" preserveAspectRatio="none" transform="${imgTf(p.img, a)}"/></g>`;
  else {
    const b = bbox(p.pts), c = centroid(p.pts), fs = clamp(Math.min(b.w, b.h) * 0.09, 14, 44);
    if (!p.fill || p.fill === 'none') s += `<polygon id="ph-${p.id}" points="${pts}" fill="#e8ecf2" pointer-events="none"/>`;
    s += `<text id="pht-${p.id}" x="${c[0]}" y="${c[1]}" font-size="${fs}" fill="#a3abb9" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${t('dropImg')}</text>`;
  }
  const stroke = p.sw > 0 ? `stroke="${p.sc}" stroke-width="${p.sw}"` : 'stroke="none"';
  s += `<polygon id="poly-${p.id}" class="hit${p.id === ui.sel ? ' sel' : ''}" data-pid="${p.id}" points="${pts}" fill="transparent" ${stroke} stroke-linejoin="miter" stroke-miterlimit="10"/>`;
  return s;
}
function renderStage(){
  const S = doc.settings, pg = curPage(), PSx = PS(pg);
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${S.w + 2*PAD} ${S.h + 2*PAD}`);
  sizeStage();
  let defs = `<clipPath id="pageclip"><rect x="0" y="0" width="${S.w}" height="${S.h}"/></clipPath>`
           + `<filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-opacity=".5"/></filter>`;
  let body = `<rect x="0" y="0" width="${S.w}" height="${S.h}" fill="${PSx.bg}" filter="url(#shadow)"/>`;
  body += `<g clip-path="url(#pageclip)">`;
  pg.layers.forEach((L, li) => {
    if (!L.visible) return;
    const active = li === ui.layer;
    const op = L.opacity * (!active && ui.dimOther ? 0.3 : 1);
    body += `<g class="layer ${active ? 'active' : 'inactive'}${L.locked ? ' locked' : ''}" opacity="${op}">`;
    for (const p of L.panels){
      defs += `<clipPath id="clip-${p.id}"><polygon id="cpoly-${p.id}" points="${ptsStr(p.pts)}"/></clipPath>`;
      body += panelSVG(p);
    }
    for (const it of L.items) body += itemSVG(it, true);
    body += '</g>';
  });
  body += '</g>';
  const m = PSx.margin;
  body += `<rect id="marginGuide" x="${m}" y="${m}" width="${S.w - 2*m}" height="${S.h - 2*m}" fill="none" stroke="#4f8cff" stroke-opacity=".35" stroke-width="${1/ui.zoom}" stroke-dasharray="${8/ui.zoom} ${6/ui.zoom}" pointer-events="none"/>`;
  body += `<g id="overlay"><image id="ghost" opacity=".35" preserveAspectRatio="none" pointer-events="none" style="display:none"/>`
        + `<g id="guides" pointer-events="none"></g><g id="handles"></g><line id="knife" stroke="#ff3b3b" stroke-dasharray="10 6" pointer-events="none" style="display:none"/></g>`;
  svg.innerHTML = `<defs>${defs}</defs>` + body;
  svg.classList.toggle('knife', ui.tool === 'knife');
  svg.classList.toggle('imgedit', ui.imgEdit);
  renderOverlay();
  updateHint();
}
function sizeStage(){
  const S = doc.settings;
  svg.style.width  = ((S.w + 2*PAD) * ui.zoom) + 'px';
  svg.style.height = ((S.h + 2*PAD) * ui.zoom) + 'px';
  $('#zoomLbl').textContent = Math.round(ui.zoom * 100) + '%';
  const mg = $('#marginGuide');
  if (mg){ mg.setAttribute('stroke-width', 1/ui.zoom); mg.setAttribute('stroke-dasharray', `${8/ui.zoom} ${6/ui.zoom}`); }
}
function renderOverlay(){
  const hg = $('#handles'); if (!hg) return;
  const z = ui.zoom, p = selPanel(), it = selItem(), gh = $('#ghost'), a = p && p.img && assets.get(p.img.a);
  if (ui.imgEdit && a){
    gh.setAttribute('href', a.url); gh.setAttribute('width', a.w); gh.setAttribute('height', a.h);
    gh.setAttribute('transform', imgTf(p.img, a)); gh.style.display = '';
  } else gh.style.display = 'none';
  let h = '';
  if (p){
    h += `<polygon points="${ptsStr(p.pts)}" fill="none" stroke="#4f8cff" stroke-width="${2/z}" stroke-dasharray="${6/z} ${4/z}" pointer-events="none"/>`;
    if (ui.imgEdit && a){
      const cs = imgCorners(p.img, a), r = 6/z;
      h += `<polygon points="${ptsStr(cs)}" fill="none" stroke="#ff8a3d" stroke-width="${1.5/z}" pointer-events="none"/>`;
      cs.forEach(c => h += `<rect data-h="is" x="${c[0]-r}" y="${c[1]-r}" width="${2*r}" height="${2*r}" fill="#ff8a3d" stroke="#fff" stroke-width="${1.5/z}" style="cursor:nwse-resize"/>`);
    } else if (ui.tool === 'select'){
      p.pts.forEach((q, i) => h += `<circle data-h="v" data-i="${i}" cx="${q[0]}" cy="${q[1]}" r="${7/z}" fill="${i === ui.selV ? '#4f8cff' : '#fff'}" stroke="#4f8cff" stroke-width="${2/z}" style="cursor:move"/>`);
    }
  }
  if (it){
    const b = itemBox(it), cs = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u, v]) => toWorld(it, u*b.w/2, v*b.h/2)), r = 6/z;
    h += `<polygon points="${ptsStr(cs)}" fill="none" stroke="#4f8cff" stroke-width="${1.5/z}" stroke-dasharray="${6/z} ${4/z}" pointer-events="none"/>`;
    cs.forEach((c, i) => h += `<rect data-h="isc" data-c="${i}" x="${c[0]-r}" y="${c[1]-r}" width="${2*r}" height="${2*r}" fill="#fff" stroke="#4f8cff" stroke-width="${1.5/z}" style="cursor:nwse-resize"/>`);
    const top = toWorld(it, 0, -b.h/2), rh = toWorld(it, 0, -b.h/2 - 34/z);
    h += `<line x1="${top[0]}" y1="${top[1]}" x2="${rh[0]}" y2="${rh[1]}" stroke="#4f8cff" stroke-width="${1.5/z}" pointer-events="none"/>`
       + `<circle data-h="irot" cx="${rh[0]}" cy="${rh[1]}" r="${7/z}" fill="#4f8cff" stroke="#fff" stroke-width="${1.5/z}" style="cursor:grab"/>`;
    (it.p.tails || []).forEach((tl, ti) => {
      const g = tailGeom(it, tl), tp = toWorld(it, tl.tx, tl.ty), cp = toWorld(it, g.cx, g.cy), ep = toWorld(it, g.ex, g.ey), d = 7/z;
      h += `<polyline points="${ep[0]},${ep[1]} ${cp[0]},${cp[1]} ${tp[0]},${tp[1]}" fill="none" stroke="#ffc83d" stroke-width="${1.2/z}" stroke-dasharray="${4/z} ${3/z}" pointer-events="none"/>`
         + `<rect data-h="tailc" data-t="${ti}" x="${cp[0]-d}" y="${cp[1]-d}" width="${2*d}" height="${2*d}" transform="rotate(45 ${cp[0]} ${cp[1]})" fill="#ffc83d" stroke="#fff" stroke-width="${1.5/z}" style="cursor:move"/>`
         + `<circle data-h="tail" data-t="${ti}" cx="${tp[0]}" cy="${tp[1]}" r="${8/z}" fill="#ff8a3d" stroke="#fff" stroke-width="${2/z}" style="cursor:move"/>`;
    });
  }
  hg.innerHTML = h;
}
function updatePanelDOM(p){
  const s = ptsStr(p.pts);
  for (const pre of ['cpoly','fill','ph','poly']){ const el = document.getElementById(pre + '-' + p.id); if (el) el.setAttribute('points', s); }
  const tEl = document.getElementById('pht-' + p.id);
  if (tEl){ const c = centroid(p.pts); tEl.setAttribute('x', c[0]); tEl.setAttribute('y', c[1]); }
  const im = document.getElementById('img-' + p.id), a = p.img && assets.get(p.img.a);
  if (im && a) im.setAttribute('transform', imgTf(p.img, a));
  renderOverlay();
}
function updateItemDOM(it){
  const el = document.getElementById('it-' + it.id);
  if (el) el.outerHTML = itemSVG(it, true);
  renderOverlay();
}
function updateHint(){
  const h = $('#hint'); let s = '';
  if (ui.tool === 'knife') s = t('hintKnife');
  else if (ui.imgEdit) s = t('hintImg');
  else if (!curLayer().panels.length && !curLayer().items.length) s = t('hintEmpty');
  h.textContent = s; h.style.display = s ? 'block' : 'none';
  $('#layerBadge').textContent = t('editing', layerName(ui.layer));
  $('#tSelect').classList.toggle('on', ui.tool === 'select');
  $('#tKnife').classList.toggle('on', ui.tool === 'knife');
  $('#bUndo').disabled = !undoStack.length; $('#bRedo').disabled = !redoStack.length;
}
function updateFileState(){
  if (!doc) return;
  $('#projName').textContent = doc.name || t('untitled');
  $('#projName').title = t('rename') + (file.dirName ? ' — ' + t('fileInfoDir', file.dirName) : '');
  const st = $('#saveState');
  st.className = file.dirty ? 'dirty' : 'clean';
  st.textContent = file.dirty ? (file.dir ? t('unsaved') : t('notSavedYet')) : t('savedTo');
  document.title = (file.dirty ? '● ' : '') + (doc.name || t('untitled')) + ' — ' + t('appName');
}

/* ================= 渲染：頁面列表 ================= */
function pageThumbSVG(pg){
  const S = doc.settings; let defs = '', body = `<rect width="${S.w}" height="${S.h}" fill="${PS(pg).bg}"/>`;
  for (const L of pg.layers){
    if (!L.visible) continue;
    body += `<g opacity="${L.opacity}">`;
    for (const p of L.panels){
      const pts = ptsStr(p.pts), a = p.img && assets.get(p.img.a), cid = `tc-${pg.id}-${p.id}`;
      if (p.fill && p.fill !== 'none') body += `<polygon points="${pts}" fill="${p.fill}"/>`;
      if (a){ defs += `<clipPath id="${cid}"><polygon points="${pts}"/></clipPath>`;
              body += `<g clip-path="url(#${cid})"><image href="${a.url}" width="${a.w}" height="${a.h}" preserveAspectRatio="none" transform="${imgTf(p.img, a)}"/></g>`; }
      else if (!p.fill || p.fill === 'none') body += `<polygon points="${pts}" fill="#e8ecf2"/>`;
      if (p.sw > 0) body += `<polygon points="${pts}" fill="none" stroke="${p.sc}" stroke-width="${Math.max(p.sw, 8)}"/>`;
    }
    for (const it of L.items || []) body += itemSVG(it, false);
    body += '</g>';
  }
  return `<svg viewBox="0 0 ${S.w} ${S.h}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;
}
function renderPages(){
  $('#pages').innerHTML = doc.pages.map((pg, i) => `
    <div class="pg${i === ui.page ? ' on' : ''}" draggable="true" data-i="${i}">
      <div class="thumb">${pageThumbSVG(pg)}</div>
      <div class="bar"><span>${t('pageN', i+1)}${pg.kind !== 'page' ? `<span class="kind ${pg.kind}">${t('kind_' + pg.kind)}</span>` : ''}</span><span class="acts">
        <button data-pa="up" title="${t('moveUp')}">↑</button><button data-pa="down" title="${t('moveDown')}">↓</button><button data-pa="del" class="danger" title="${t('del')}">✕</button>
      </span></div>
    </div>`).join('');
}
let thumbTimer = null;
function refreshThumb(){
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const el = document.querySelector(`.pg[data-i="${ui.page}"] .thumb`);
    if (el) el.innerHTML = pageThumbSVG(curPage());
  }, 250);
}

/* ================= 渲染：右側工具列 ================= */
function rng(label, f, val, min, max, step = 1){
  return `<label class="row"><span>${label}</span><input type="range" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}"><input type="number" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
}
function layersHTML(){
  const pg = curPage();
  let h = `<div class="ttl"><span>${t('layers')}</span><label class="chk"><input type="checkbox" data-f="dim" ${ui.dimOther ? 'checked' : ''}>${t('dimOther')}</label></div>`;
  if (isCoverFmt(pg)) h += `<p class="note" style="margin:0 0 6px">${t('coverFmtNote')}</p>`;
  for (const li of visibleLayers(pg).reverse()){
    const L = pg.layers[li];
    h += `<div class="lyr${li === ui.layer ? ' on' : ''}" data-act="layer" data-l="${li}">
      <button class="ic${L.visible ? '' : ' off'}" data-act="lvis" data-l="${li}" title="${t('toggleVis')}">👁</button>
      <button class="ic${L.locked ? '' : ' off'}" data-act="llock" data-l="${li}" title="${t('toggleLock')}">🔒</button>
      <span class="nm">${layerName(li)} <span class="muted">(${L.panels.length + L.items.length})</span></span>
      <input type="range" min="0" max="1" step="0.05" value="${L.opacity}" data-f="lop" data-l="${li}" title="${t('opacity')}">
    </div>`;
  }
  return h;
}
function miniPoly(pts, w = 40, h = 40){
  return `<svg viewBox="-2 -2 ${w+4} ${h+4}"><polygon points="${ptsStr(pts.map(p => [p[0]*w, p[1]*h]))}" fill="#e8ecf2" stroke="#111" stroke-width="1.5"/></svg>`;
}
// 封面模板預覽：建立暫時頁面再畫縮圖
function coverPage(tp){
  const S = doc.settings, r = tp.make(S.w, S.h);
  return { id:'cv', kind:tp.kind, ov:r.ov || {}, layers:[
    { visible:true, opacity:1, panels:r.panels.map(o => ({ id:uid(), pts:o.pts.map(q => q.slice()), img:null, sw:o.sw ?? 0, sc:'#111111', fill:'none' })), items:[] },
    { visible:true, opacity:1, panels:[], items:[] },
    { visible:true, opacity:1, panels:[], items:r.items.map(o => newItem(o.k, o)) } ] };
}
let tplThumbCache = null;
function layoutTab(){
  // 模板縮圖會反映此頁目前的版面樣式（留白、格距、外框）
  const PSx = PS(), thumbKey = [PSx.margin, PSx.gutter, PSx.stroke, PSx.strokeColor, doc.settings.w, doc.settings.h].join();
  if (!tplThumbCache || tplThumbCache.key !== thumbKey){
    const S = doc.settings, W = 100, H = 100 * S.h / S.w, sc = W / S.w, m = PSx.margin * sc;
    const shades = ['#c9d3e1', '#dfe5ee'];
    tplThumbCache = TEMPLATES.map(tp => {
      const polys = layoutPolys(tp.n, [[m,m],[W-m,m],[W-m,H-m],[m,H-m]], PSx.gutter * sc);
      const stroke = PSx.stroke > 0 ? `stroke="${PSx.strokeColor}" stroke-width="${Math.max(0.8, PSx.stroke * sc * 1.5)}"` : `stroke="#ffffff" stroke-width="0.3"`;
      return `<svg viewBox="0 0 ${W} ${f1(H)}"><rect width="${W}" height="${f1(H)}" fill="#fff"/>${polys.map((p, i) => `<polygon points="${ptsStr(p)}" fill="${shades[i % 2]}" ${stroke}/>`).join('')}</svg>`;
    });
    tplThumbCache.key = thumbKey;
  }
  const kind = curPage().kind, curStyle = layoutStyleOf(curPage());
  const styleSec = `<div class="sec"><h4>${t('ls_title')}</h4>
      <div class="lstyles">${LAYOUT_STYLES.map(s => `<div class="tpl${curStyle === s.k ? ' on' : ''}" data-act="lstyle" data-k="${s.k}">${styleThumb(s.k)}${t('ls_' + s.k)}</div>`).join('')}</div>
      <div class="btns" style="margin-top:8px"><button data-act="lstyleall">${t('ls_all', t('ls_' + (curStyle === 'custom' ? 'normal' : curStyle)))}</button></div>
      <p class="note">${t('ls_note')}</p></div>`;
  const coverSec = k => `<div class="sec"><h4>${t(k === 'cover' ? 'coverTpl' : 'backTpl')}</h4>
      <div class="covers">${COVERS.map((c, i) => c.kind === k ? `<div class="tpl" data-act="cover" data-i="${i}">${pageThumbSVG(coverPage(c))}${tn(c.name)}</div>` : '').join('')}</div>
      <p class="note">${t('coverNote')}</p></div>`;
  const panelSec = `<div class="sec"><h4>${t('tplTitle', layerName(isCoverFmt() ? 0 : ui.layer))}</h4>
      <div class="tpls">${TEMPLATES.map((tp, i) => `<div class="tpl" data-act="tpl" data-i="${i}">${tplThumbCache[i]}${tn(tp.name)}</div>`).join('')}</div></div>
    <div class="sec"><h4>${t('addShape')}</h4>
      <div class="shapes">${SHAPES.map((s, i) => `<div class="tpl" data-act="shape" data-i="${i}">${s.pts ? miniPoly(s.pts) : miniPoly(s.full === 'inner' ? [[.1,.1],[.9,.1],[.9,.9],[.1,.9]] : [[0,0],[1,0],[1,1],[0,1]])}${tn(s.name)}</div>`).join('')}</div></div>`;
  const order = kind === 'cover' ? [coverSec('cover'), coverSec('back'), styleSec, panelSec]
              : kind === 'back' ? [coverSec('back'), coverSec('cover'), styleSec, panelSec]
              : [styleSec, panelSec, coverSec('cover'), coverSec('back')];
  return order.join('') + `<div class="tip">${t('tips')}</div>`;
}
function panelProps(p){
  const a = p.img && assets.get(p.img.a);
  let h = `<div class="sec"><h4>${t('border')}</h4>
      ${rng(t('width'), 'sw', p.sw, 0, 40)}
      <label class="row"><span>${t('color')}</span><input type="color" data-f="sc" value="${p.sc}"></label>
      <label class="row"><span>${t('fill')}</span><input type="checkbox" data-f="fillOn" ${p.fill !== 'none' ? 'checked' : ''}>
        <input type="color" data-f="fillc" value="${p.fill !== 'none' ? p.fill : '#ffffff'}"></label>
    </div>
    <div class="sec"><h4>${t('image')}</h4>`;
  if (a){
    const pct = Math.round(p.img.s / coverScale(p, a) * 100);
    h += `<div class="imgprev"><div style="background-image:url('${a.url}')"></div><span class="muted">${esc(a.name)}<br>${a.w}×${a.h}</span></div>
      <div class="btns" style="margin-bottom:8px"><button data-act="imgedit" class="${ui.imgEdit ? 'on' : ''}">${t('adjust')}</button></div>
      ${rng(t('scalePct'), 'iscale', pct, 10, 400)}
      ${rng(t('rotate'), 'irot', p.img.r || 0, -180, 180)}
      <div class="btns"><button data-act="icover">${t('cover')}</button><button data-act="icontain">${t('contain')}</button><button data-act="iflip">${t('flip')}</button><button data-act="irm" class="danger">${t('rmImg')}</button></div>`;
  } else h += `<div class="tip">${t('noImgTip')}</div>`;
  h += `</div>
    <div class="sec"><h4>${t('splitTitle', PS().gutter)}</h4>
      ${rng(t('slant'), 'slant', ui.slant, -0.6, 0.6, 0.02)}
      <div class="btns"><button data-act="splith">${t('splitH')}</button><button data-act="splitv">${t('splitV')}</button></div>
    </div>` + arrangeHTML(p.pts.length);
  return h;
}
function arrangeHTML(nPts, textOnly){
  if (isCoverFmt()) textOnly = 'cover';
  return `<div class="sec"><h4>${t('arrange')}</h4>
      <div class="btns">
        <button data-act="pdup">${t('dupP')}</button><button data-act="pdel" class="danger">${t('delP')}</button>
        <button data-act="copyto">${t('copyToPages')}</button>
        <button data-act="pfwd">${t('fwd')}</button><button data-act="pback">${t('back')}</button>
        ${textOnly ? '' : [0, 1, 2].filter(li => li !== ui.layer).map(li => `<button data-act="pmove" data-l="${li}">${t('moveTo', layerName(li))}</button>`).join('')}
        ${nPts ? `<button data-act="vdel" ${ui.selV == null || nPts <= 3 ? 'disabled' : ''}>${t('delV')}</button>` : ''}
      </div><p class="note">${t('clipTip')}</p>${textOnly ? `<p class="note">${t(textOnly === 'cover' ? 'coverFmtNote' : 'textOnly')}</p>` : ''}</div>`;
}
function fieldHTML(it, spec){
  const [key, type, min, max, step] = spec.split(':'), v = it.p[key], lbl = t('f_' + key), f = 'ip:' + key;
  switch (type){
    case 'area':   return `<label class="row col"><span>${lbl}</span><textarea data-f="${f}" rows="3">${esc(v ?? '')}</textarea></label>`;
    case 'text':   return `<label class="row"><span>${lbl}</span><input type="text" data-f="${f}" value="${esc(v ?? '')}"></label>`;
    case 'color':  return `<label class="row"><span>${lbl}</span><input type="color" data-f="${f}" value="${v}"></label>`;
    case 'colorn': return `<label class="row"><span>${lbl}</span><input type="checkbox" data-f="ipn:${key}" ${v !== 'none' ? 'checked' : ''}><input type="color" data-f="${f}" value="${v !== 'none' ? v : '#ffffff'}"></label>`;
    case 'num':    return rng(lbl, f, v, +min, +max, step ? +step : 1);
    case 'bool':   return `<label class="row"><span>${lbl}</span><input type="checkbox" data-f="${f}" ${v ? 'checked' : ''}></label>`;
    case 'font':   return `<div class="row"><span>${lbl}</span><button class="fbtn" data-act="fpick" data-key="${key}" style="font-family:${fontStack(v)}"><span>${esc(fontLabel(v))}</span><span>▾</span></button></div>`;
    case 'weight': return `<label class="row"><span>${lbl}</span><select data-f="${f}">${[400,700,900].map(w => `<option value="${w}" ${+v === w ? 'selected' : ''}>${t('w_' + w)}</option>`).join('')}</select></label>`;
    case 'align':  return `<label class="row"><span>${lbl}</span><select data-f="${f}">${['left','center','right'].map(a => `<option value="${a}" ${v === a ? 'selected' : ''}>${t('a_' + a)}</option>`).join('')}</select></label>`;
    case 'select': return `<label class="row"><span>${lbl}</span><select data-f="${f}">${min.split('|').map(o => `<option value="${o}" ${v === o ? 'selected' : ''}>${t('o_' + o)}</option>`).join('')}</select></label>`;
  }
  return '';
}
function itemProps(it){
  const def = STK[it.k];
  return `<div class="sec"><h4>${t('itemTitle')}：${tn(def.name)}</h4>
      ${(def.fieldsFor ? def.fieldsFor(it) : def.fields).map(s => fieldHTML(it, s)).join('')}
      ${it.k === 'bubble' ? `<div class="btns"><button data-act="bfit">${t('bfit')}</button></div>` : ''}
      ${it.p.seed != null ? `<div class="btns"><button data-act="reseed">🎲 ${t('reseed')}</button></div>` : ''}
    </div>
    ${it.k === 'frame' ? pageBgHTML() : ''}
    ${it.k === 'text' ? fxHTML(it) : ''}
    ${def.tails ? tailsHTML(it) : ''}
    <div class="sec">${rng(t('f_rot'), 'ic:r', Math.round(it.r || 0), -180, 180)}${rng(t('f_op'), 'ic:op', it.op ?? 1, 0, 1, 0.05)}</div>`
    + arrangeHTML(0, isTextKind(it.k) || isCoverFmt());
}
// 尾巴清單：每個尾巴可以改樣式、根部寬度、拉直、刪除
function tailsHTML(it){
  const tails = it.p.tails || [];
  return `<div class="sec"><h4>${t('tl_title')}</h4>
    ${tails.length ? tails.map((tl, i) => `<div class="tailbox"><div class="tlh"><b>${t('tl_n', i + 1)}</b>
        <span><button data-act="tstraight" data-t="${i}">${t('tl_straight')}</button><button class="danger" data-act="tdel" data-t="${i}">✕</button></span></div>
        <label class="row"><span>${t('tl_style')}</span><select data-f="tl:${i}:style">${['tri','dots'].map(s => `<option value="${s}" ${tl.style === s ? 'selected' : ''}>${t('tl_' + s)}</option>`).join('')}</select></label>
        ${rng(t('tl_bw'), 'tl:' + i + ':bw', tl.bw ?? 0.12, 0.03, 0.4, 0.01)}</div>`).join('') : `<p class="note">${t('tl_none')}</p>`}
    <div class="btns"><button data-act="tadd">${t('tl_add')}</button></div>
    <p class="note">${t('tl_tip')}</p></div>`;
}
// 文字特效面板：上方一鍵樣式（用自己的文字預覽），下方可展開的細項
ui.fxOpen = new Set(['fx_presets', 'fx_fill']);
// 頁面底色（例如典雅邊框的米色底），在屬性分頁就能直接改
function pageBgHTML(){
  return `<div class="sec"><h4>${t('pageBgQuick', ui.page + 1)}</h4>
    <label class="row"><span>${t('pBg')}</span><input type="color" data-f="pbg" value="${PS().bg}"></label>
    <p class="note">${t('pageBgNote')}</p></div>`;
}
function fxHTML(it){
  const sample = String(it.p.text || '').split('\n')[0].slice(0, 4) || 'Aa';
  const presets = TEXT_FX.map((fx, i) => {
    const tmp = { ...it, r:0, p:applyFx({ ...it.p, text:sample, size:100 }, fx) };
    return `<div class="tpl" data-act="fx" data-i="${i}">${itemPreviewSVG(tmp)}${tn(fx.name)}</div>`;
  }).join('');
  return `<details class="fxg" data-g="fx_presets" ${ui.fxOpen.has('fx_presets') ? 'open' : ''}><summary>${t('fx_title')}</summary><div class="fxp" style="margin-bottom:8px">${presets}</div></details>`
    + FX_GROUPS.map(([g, specs]) => `<details class="fxg" data-g="${g}" ${ui.fxOpen.has(g) ? 'open' : ''}><summary>${t(g)}</summary>${specs.map(s => fieldHTML(it, s)).join('')}</details>`).join('');
}
function propsTab(){
  const p = selPanel(), it = selItem();
  if (p) return panelProps(p);
  if (it) return itemProps(it);
  return `<div class="tip">${t('noSel')}<br><br>${t('curLayer')}：<b>${layerName(ui.layer)}</b></div>` + pageBgHTML();
}
function stickersTab(){
  let h = `<p class="note" style="margin:0 0 10px">${t('stTip')}</p>`;
  h += `<div class="sec"><h4>${t('st_text')}</h4><div class="stk">${TEXT_PRESETS.map((tp, i) => {
    const it = newItem('text', { p:tp.p(), r:tp.r }); return `<div class="tpl" data-act="tpreset" data-i="${i}">${itemPreviewSVG(it)}${tn(tp.name)}</div>`; }).join('')}</div></div>`;
  h += `<div class="sec"><h4>${t('st_bubble')}</h4><div class="stk">${BUBBLE_PRESETS.map((bp, i) =>
    `<div class="tpl" data-act="bpreset" data-i="${i}">${itemPreviewSVG(bubbleFromPreset(bp))}${tn(bp.name)}</div>`).join('')}</div><p class="note">${t('bub_note')}</p></div>`;
  for (const cat of STK_CATS.slice(2)){
    h += `<div class="sec"><h4>${t('st_' + cat)}</h4><div class="stk">${Object.entries(STK).filter(([, d]) => d.cat === cat).sort((a, b) => (b[1].clip ? 1 : 0) - (a[1].clip ? 1 : 0)).map(([k, d]) =>
      `<div class="tpl" data-act="sticker" data-k="${k}">${itemPreviewSVG(newItem(k))}${tn(d.name)}</div>`).join('')}</div>
      ${cat === 'age' ? `<p class="note">${t('ageNote')}</p>` : ''}</div>`;
  }
  return h;
}
function assetsTab(){
  const used = new Set();
  doc.pages.forEach(pg => pg.layers.forEach(L => L.panels.forEach(p => p.img && used.add(p.img.a))));
  const list = [...assets.values()].sort((a, b) => a.t - b.t);
  return `<div class="sec"><div class="btns"><button data-act="aimport">${t('importImg')}</button><button data-act="afill">${t('fillEmpty')}</button></div>
    <p class="muted">${t('assetsTip')}</p></div>
    <div class="assets">${list.map(a => `<div class="asset" draggable="true" data-act="ause" data-id="${a.id}" title="${esc(a.name)}" style="background-image:url('${a.url}')">
      ${used.has(a.id) ? `<span class="used">${t('inUse')}</span>` : `<button class="x danger" data-act="adel" data-id="${a.id}">✕</button>`}</div>`).join('')}</div>
    ${list.length ? '' : `<p class="muted">${t('assetsEmpty')}</p>`}`;
}
function pageTab(){
  const pg = curPage(), S = PS(pg), ov = pg.ov || {}, mark = k => ov[k] != null ? ` <span class="ov">● ${t('custom')}</span>` : '';
  return `<div class="sec"><h4>${t('thisPage', ui.page + 1)}</h4>
      <label class="row"><span>${t('pageKind')}</span><select data-f="pkind">${['page','cover','insert','back'].map(k => `<option value="${k}" ${pg.kind === k ? 'selected' : ''}>${t('kind_' + k)}</option>`).join('')}</select></label>
    </div>
    <div class="sec"><h4>${t('pMargin')}${mark('margin')}</h4>${rng(t('pMargin'), 'pmargin', S.margin, 0, 400)}<p class="note">${t('pMarginTip')}</p></div>
    <div class="sec"><h4>${t('pGutter')}${mark('gutter')}</h4>${rng(t('pGutter'), 'pgutter', S.gutter, 0, 150)}</div>
    <div class="sec"><h4>${t('pBg')}${mark('bg')}</h4><label class="row"><span>${t('pBg')}</span><input type="color" data-f="pbg" value="${S.bg}"></label></div>
    <div class="sec"><h4>${t('pBorder')}${mark('stroke')}</h4>
      ${rng(t('width'), 'pstroke', S.stroke, 0, 40)}
      <label class="row"><span>${t('color')}</span><input type="color" data-f="pstrokec" value="${S.strokeColor}"></label>
      <p class="note">${t('pBorderTip')}</p>
      <div class="btns"><button data-act="pborderall">${t('applyBorderAll')}</button></div>
    </div>
    <div class="btns"><button data-act="presetov">${t('resetOv')}</button></div>`;
}
const PRESETS = [[1600, 2259], [1600, 2263], [1600, 2475], [2000, 2000], [2263, 1600], [1080, 1920]];
function settingsTab(){
  const S = doc.settings, names = t('presets');
  return `<div class="sec"><h4>${t('language')}</h4>
      <div class="btns"><button data-act="lang" data-l="zh" class="${LANG === 'zh' ? 'on' : ''}">繁體中文</button><button data-act="lang" data-l="en" class="${LANG === 'en' ? 'on' : ''}">English</button></div>
    </div>
    <div class="sec"><h4>${t('fileInfo')}</h4>
      <div class="tip"><b>${esc(doc.name || t('untitled'))}</b><br>${file.dirName ? t('fileInfoDir', esc(file.dirName)) : t('fileInfoNone')}</div>
    </div>
    <div class="sec"><h4>${t('fontsTitle')}</h4>
      <div class="tip">${t('fontsInfo', FONTS.length)}</div>
      <div class="btns" style="margin-top:8px"><button data-act="fimport">${t('fontImport')}</button></div>
      <div class="fontlist">${customFonts.size ? [...customFonts.values()].map(f => `<div><span style="font-family:${fontStack('cf:' + f.id)}">${esc(f.name)}</span><button class="danger" data-act="fdel" data-id="${f.id}">✕</button></div>`).join('') : `<span class="muted">${t('fontNone')}</span>`}</div>
      <p class="note">${t('fontImportNote')}</p>
    </div>
    <div class="sec"><h4>${t('pageSize')}</h4>
      <div class="row"><select id="presetSel" style="flex:1"><option value="">${t('choosePreset')}</option>${PRESETS.map((p, i) => `<option value="${i}">${names[i]} (${p[0]}×${p[1]})</option>`).join('')}</select></div>
      <div class="row"><span>${t('wh')}</span><input type="number" id="pw" value="${S.w}" style="width:70px">×<input type="number" id="ph" value="${S.h}" style="width:70px"><button data-act="setsize">${t('apply')}</button></div>
    </div>
    <div class="sec"><h4>${t('defaults')}</h4>
      ${rng(t('margin'), 'margin', S.margin, 0, 300)}
      ${rng(t('gutter'), 'gutter', S.gutter, 0, 120)}
      ${rng(t('strokeDef'), 'stroke', S.stroke, 0, 40)}
      <label class="row"><span>${t('strokeColor')}</span><input type="color" data-f="strokeColor" value="${S.strokeColor}"></label>
      <label class="row"><span>${t('pageBg')}</span><input type="color" data-f="bg" value="${S.bg}"></label>
    </div>`;
}
function renderSide(){
  const body = $('#tabBody'), sc = body.scrollTop;
  $('#layers').innerHTML = layersHTML();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  body.innerHTML = ({ layout:layoutTab, props:propsTab, stickers:stickersTab, assets:assetsTab, page:pageTab, settings:settingsTab })[ui.tab]();
  body.scrollTop = sc;
}
function renderAll(){ fixLayer(); renderPages(); renderStage(); renderSide(); updateFileState(); }

/* ================= 對話框 ================= */
let modalResolve = null;
function modal({ title, body = '', buttons = [] }){
  const m = $('#modal');
  $('h3', m).textContent = title || '';
  $('.mbody', m).innerHTML = body;
  $('.mbtns', m).innerHTML = buttons.map((b, i) => `<button data-mi="${i}" class="${b.cls || ''}">${b.label}</button>`).join('');
  m.classList.add('open');
  setTimeout(() => { const f = $('.mbody input[type=text]', m) || $('.mbtns button.primary', m); f && f.focus(); f && f.select && f.select(); }, 30);
  return new Promise(res => {
    modalResolve = v => {
      const form = {};
      m.querySelectorAll('.mbody [name]').forEach(el => { if (el.type === 'radio'){ if (el.checked) form[el.name] = el.value; } else if (el.type === 'checkbox'){ form[el.name] = form[el.name] || []; if (el.checked) form[el.name].push(el.value); } else form[el.name] = el.value; });
      m.classList.remove('open'); modalResolve = null; res({ value:v, form });
    };
    $('.mbtns', m).onclick = e => { const b = e.target.closest('[data-mi]'); if (b) modalResolve(buttons[+b.dataset.mi].value); };
  });
}
function closeModal(v = null){ if (modalResolve) modalResolve(v); else $('#modal').classList.remove('open'); }
function busy(title, text, pct){
  const m = $('#modal');
  if (!m.classList.contains('open') || !$('.prog', m)){
    $('h3', m).textContent = title; $('.mbtns', m).innerHTML = '';
    $('.mbody', m).innerHTML = `<div class="btxt"></div><div class="prog"><div></div></div>`;
    m.classList.add('open');
  }
  $('.btxt', m).textContent = text || '';
  $('.prog div', m).style.width = (pct == null ? 0 : pct) + '%';
}
const isModalOpen = () => $('#modal').classList.contains('open');
$('#modal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input[type=text]')){ const b = $('#modal .mbtns button.primary'); b && b.click(); }
});

/* ================= 操作 ================= */
function select(id, kind = 'p'){
  if (ui.sel !== id){ ui.imgEdit = false; ui.selV = null; }
  ui.sel = id; ui.selK = kind;
  if (id && (ui.tab === 'layout' || ui.tab === 'stickers')) ui.tab = 'props';
}
function deselect(){ ui.sel = null; ui.selV = null; ui.imgEdit = false; }
function setTool(tl){ ui.tool = tl; ui.imgEdit = false; renderStage(); }
function setLayer(li){ if (isCoverFmt() && li === 1) li = TEXT_LAYER; if (ui.layer === li) return; ui.layer = li; deselect(); renderStage(); renderSide(); }
function gotoPage(i){ if (i < 0 || i >= doc.pages.length) return; ui.page = i; deselect(); renderAll();
  document.querySelector(`.pg[data-i="${i}"]`)?.scrollIntoView({ block:'nearest' }); }
function innerRect(pg = curPage()){ const S = PS(pg), m = S.margin; return [[m,m],[S.w-m,m],[S.w-m,S.h-m],[m,S.h-m]]; }

function applyTemplate(tp){
  ensurePanelLayer();
  const L = curLayer(); if (L.locked) return toast(t('locked'));
  pushHistory();
  const imgs = L.panels.filter(p => p.img && assets.get(p.img.a)).map(p => assets.get(p.img.a));
  L.panels = layoutPolys(tp.n, innerRect(), PS().gutter).map((pts, i) => {
    const p = makePanel(pts); if (imgs[i]) setPanelImage(p, imgs[i]); return p;
  });
  L.tpl = { i:TEMPLATES.indexOf(tp), sig:panelSig(L) };
  deselect(); commit(); renderAll();
  toast(t('applied', tn(tp.name)));
}

/* ================= 版面樣式（一般 / 滿版細縫 / 滿版無縫 / 滿版分隔線） ================= */
const LAYOUT_STYLES = [
  { k:'normal',   ov:null },
  { k:'bleedgap', ov:{ margin:0, gutter:12, stroke:0 } },
  { k:'seamless', ov:{ margin:0, gutter:0, stroke:0 } },
  { k:'lines',    ov:{ margin:0, gutter:0, stroke:8, strokeColor:'#ffffff' } },
];
const STYLE_KEYS = ['margin', 'gutter', 'stroke', 'strokeColor'];
// 用來判斷格子是不是「套用模板後沒被手動改過」
const panelSig = L => JSON.stringify(L.panels.map(p => p.pts));
function layoutStyleOf(pg){
  const ov = pg.ov || {};
  if (STYLE_KEYS.every(k => ov[k] == null)) return 'normal';
  const st = LAYOUT_STYLES.find(s => s.ov && STYLE_KEYS.every(k => (s.ov[k] ?? null) === (ov[k] ?? null)));
  return st ? st.k : 'custom';
}
// 換了格子形狀後，讓圖片保持原本的裁切比例與相對位置
function carryImg(o, p){
  const a = assets.get(o.img.a), bo = bbox(o.pts), bn = bbox(p.pts);
  const im = { ...o.img, s:o.img.s / coverScale(o, a) * coverScale(p, a),
    cx:bn.x + bn.w/2 + (o.img.cx - (bo.x + bo.w/2)) / (bo.w || 1) * bn.w,
    cy:bn.y + bn.h/2 + (o.img.cy - (bo.y + bo.h/2)) / (bo.h || 1) * bn.h };
  // 原本圖片有蓋滿格子的話，換形狀後也要保持蓋滿（不讓邊緣露白）
  if (!(o.img.r) && covers(o.img, a, bo)){
    im.s = Math.max(im.s, coverScale(p, a));
    const hw = a.w*im.s/2, hh = a.h*im.s/2;
    im.cx = clamp(im.cx, bn.x1 - hw, bn.x + hw); im.cy = clamp(im.cy, bn.y1 - hh, bn.y + hh);
  }
  return im;
}
function covers(im, a, b){
  const hw = a.w*im.s/2, hh = a.h*im.s/2;
  return im.cx - hw <= b.x + 0.5 && im.cx + hw >= b.x1 - 0.5 && im.cy - hh <= b.y + 0.5 && im.cy + hh >= b.y1 - 0.5;
}
function relayoutLayer(pg, L){
  const tp = TEMPLATES[L.tpl.i], old = L.panels;
  L.panels = layoutPolys(tp.n, innerRect(pg), PS(pg).gutter).map((pts, i) => {
    const p = makePanel(pts, {}, pg), o = old[i];
    if (o){ p.fill = o.fill; if (o.img && assets.get(o.img.a)) p.img = carryImg(o, p); }
    return p;
  });
  L.tpl.sig = panelSig(L);
}
/* ================= 自適應版面：手動改過的格子也能切換樣式 =================
   逐條邊判斷：
   1. 貼著紙邊或舊留白線的邊 → 移到新的留白位置
   2. 和其他格子相對、中間只隔一條縫的邊 → 依新格距，兩邊各移一半
   3. 其他邊（例如刻意留白的底部、插入格的內側）→ 不動
   再把相鄰兩條邊的新直線求交點，得到新的角。 */
function panelEdges(p, pi){
  const pts = p.pts, n = pts.length, c = centroid(pts), out = [];
  for (let i = 0; i < n; i++){
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.5){ out.push(null); continue; }
    let nx = dy/len, ny = -dx/len;
    const mx = (a[0] + b[0])/2, my = (a[1] + b[1])/2;
    if ((mx - c[0])*nx + (my - c[1])*ny < 0){ nx = -nx; ny = -ny; }     // 法向量朝外
    out.push({ pi, i, a, b, nx, ny, c:nx*a[0] + ny*a[1], len });
  }
  return out;
}
function adaptLayer(pg, L, oldS, newS){
  const W = doc.settings.w, H = doc.settings.h, tolM = Math.max(6, W*0.008);
  const m0 = oldS.margin, m1 = newS.margin, g1 = newS.gutter, gMax = Math.max(oldS.gutter*1.6, oldS.gutter + 14, 10);
  const all = L.panels.map(panelEdges), flat = all.flat().filter(Boolean);
  const near = (v, t) => Math.abs(v - t) < tolM;
  const touched = new Set();
  // 之前判定為「不動」的邊會記在 p.keep，之後切換樣式時繼續保持不動（避免刻意留白剛好等於留白寬度時被誤判）
  const keepOf = pi => { const p = L.panels[pi], k = p.keep; return Array.isArray(k) && k.length === p.pts.length ? k : null; };
  const kind = all.map(es => es.map(() => 'free'));
  const offs = all.map((es, pi) => es.map((e, i) => {
    if (!e) return 0;
    const kp = keepOf(pi); if (kp && kp[i]) return 0;
    const { a, b, nx, ny } = e;
    const mark = (k, v) => { kind[pi][i] = k; touched.add(pi); return v; };
    // 1) 外框：貼在紙邊（0／W）或舊留白線上
    if (nx < -0.97 && (near(a[0], 0) || near(a[0], m0)) && (near(b[0], 0) || near(b[0], m0)))return mark('m', (a[0] + b[0])/2 - m1);
    if (nx >  0.97 && (near(a[0], W) || near(a[0], W - m0)) && (near(b[0], W) || near(b[0], W - m0)))return mark('m', (W - m1) - (a[0] + b[0])/2);
    if (ny < -0.97 && (near(a[1], 0) || near(a[1], m0)) && (near(b[1], 0) || near(b[1], m0)))return mark('m', (a[1] + b[1])/2 - m1);
    if (ny >  0.97 && (near(a[1], H) || near(a[1], H - m0)) && (near(b[1], H) || near(b[1], H - m0)))return mark('m', (H - m1) - (a[1] + b[1])/2);
    // 2) 格縫：找方向相反、平行、投影有重疊、距離在格距附近的另一條邊
    const tx = -ny, ty = nx, e0 = tx*a[0] + ty*a[1], e1 = tx*b[0] + ty*b[1], lo = Math.min(e0, e1), hi = Math.max(e0, e1);
    let gap = null;
    for (const f of flat){
      if (f.pi === e.pi || nx*f.nx + ny*f.ny > -0.985) continue;
      const d = nx*f.a[0] + ny*f.a[1] - e.c;                       // f 在 e 外側多遠
      if (d < -1.5 || d > gMax) continue;
      const f0 = tx*f.a[0] + ty*f.a[1], f1 = tx*f.b[0] + ty*f.b[1];
      const ov = Math.min(hi, Math.max(f0, f1)) - Math.max(lo, Math.min(f0, f1));
      if (ov < Math.min(20, e.len*0.3)) continue;
      if (gap === null || d < gap) gap = d;
    }
    if (gap !== null) return mark('g', (gap - g1)/2);
    return 0;                                                        // 3) 其他邊不動
  }));
  L.panels.forEach((p, pi) => {
    const es = all[pi], n = p.pts.length;
    // 記下這個格子哪些邊是「不動的邊」
    const kp = keepOf(pi);
    p.keep = kind[pi].map((k, i) => !!(kp && kp[i]) || k === 'free');
    if (!offs[pi].some(v => Math.abs(v) > 0.05) && !touched.has(pi)) return;
    const old = JSON.parse(JSON.stringify(p));
    p.pts = p.pts.map((v, i) => {
      const e1 = es[(i - 1 + n) % n], e2 = es[i];
      if (!e1 || !e2) return v;
      const c1 = e1.c + offs[pi][(i - 1 + n) % n], c2 = e2.c + offs[pi][i];
      const det = e1.nx*e2.ny - e1.ny*e2.nx;
      if (Math.abs(det) < 1e-6){ const d = offs[pi][i]; return [v[0] + e2.nx*d, v[1] + e2.ny*d]; }
      return [Math.round((c1*e2.ny - e1.ny*c2)/det*10)/10, Math.round((e1.nx*c2 - c1*e2.nx)/det*10)/10];
    });
    if (touched.has(pi)){ p.sw = newS.stroke; p.sc = newS.strokeColor; }
    if (old.img && assets.get(old.img.a)) p.img = carryImg(old, p);
  });
}
function applyLayoutStyle(k, allPages){
  const st = LAYOUT_STYLES.find(s => s.k === k);
  const pages = allPages ? doc.pages.filter(p => p.kind === 'page') : [curPage()];
  pushHistory();
  let re = 0;
  for (const pg of pages){
    const oldS = PS(pg);
    pg.ov = { ...(pg.ov || {}) };
    STYLE_KEYS.forEach(key => delete pg.ov[key]);
    if (st.ov) Object.assign(pg.ov, st.ov);
    for (const L of pg.layers){
      if (!L.panels.length) continue;
      // 沒改過的模板：照模板重新排版（最精準）；改過的：逐邊自適應
      if (L.tpl && TEMPLATES[L.tpl.i] && L.tpl.sig === panelSig(L)) relayoutLayer(pg, L);
      else { adaptLayer(pg, L, oldS, PS(pg)); if (L.tpl) L.tpl.sig = panelSig(L) + '#edited'; }
      re++;
    }
  }
  deselect(); tplThumbCache = null; commit(); renderAll();
  toast(t('ls_done', t('ls_' + k), re));
}
function styleThumb(k){
  const st = LAYOUT_STYLES.find(s => s.k === k), S = doc.settings, o = { ...S, ...(st.ov || {}) };
  const W = 60, H = 60 * S.h / S.w, sc = W / S.w, m = o.margin * sc;
  const polys = layoutPolys(TEMPLATES[9].n, [[m,m],[W-m,m],[W-m,H-m],[m,H-m]], o.gutter * sc);
  const shades = ['#9fb3cc', '#c4d1e2', '#b2c3d8', '#d3dde9', '#a9bbd2'];
  return `<svg viewBox="0 0 ${W} ${f1(H)}"><rect width="${W}" height="${f1(H)}" fill="#fff"/>${polys.map((p, i) =>
    `<polygon points="${ptsStr(p)}" fill="${shades[i % 5]}"${o.stroke > 0 ? ` stroke="${o.strokeColor === '#ffffff' ? '#fff' : '#222'}" stroke-width="${Math.max(0.8, o.stroke*sc*2)}"` : ''}/>`).join('')}</svg>`;
}
function applyCover(tp){
  const pg = curPage(); if (pg.layers.some(L => L.locked)) return toast(t('locked'));
  pushHistory();
  const S = doc.settings, r = tp.make(S.w, S.h);
  const imgs = [];
  pg.layers.forEach(L => L.panels.forEach(p => { const a = p.img && assets.get(p.img.a); if (a) imgs.push(a); }));
  pg.kind = tp.kind;
  pg.ov = { ...(r.ov || {}) };
  pg.layers[0].panels = r.panels.map((o, i) => { const p = makePanel(o.pts.map(q => q.slice()), { sw:o.sw ?? 0 }); if (imgs[i]) setPanelImage(p, imgs[i]); return p; });
  pg.layers[0].items = [];
  pg.layers[1].panels = [];
  pg.layers[1].items = [];
  pg.layers[TEXT_LAYER].panels = [];
  pg.layers[TEXT_LAYER].items = r.items.map(o => newItem(o.k, o));
  pg.layers[TEXT_LAYER].visible = true;
  ui.layer = TEXT_LAYER; deselect(); commit(); renderAll();
  toast(t('applied', tn(tp.name)));
}
function addShape(sh){
  ensurePanelLayer();
  const L = curLayer(); if (L.locked) return toast(t('locked'));
  const S = PS(); let pts, opt = {};
  if (sh.full === 'inner') pts = innerRect();
  else if (sh.full === 'bleed'){ pts = [[0,0],[S.w,0],[S.w,S.h],[0,S.h]]; opt.sw = 0; }
  else {
    const w = (S.w - 2*S.margin) * 0.5, h = (S.h - 2*S.margin) * 0.3, n = L.panels.length % 6;
    const x = (S.w - w)/2 + n*30, y = (S.h - h)/2 + n*30;
    pts = sh.pts.map(p => [Math.round(x + p[0]*w), Math.round(y + p[1]*h)]);
  }
  pushHistory();
  const p = makePanel(pts, opt); L.panels.push(p); select(p.id, 'p');
  commit(); renderAll();
}
function addItem(k, o = {}, made){
  if (isTextKind(k) || isCoverFmt()){
    const TL = curPage().layers[TEXT_LAYER];
    if (ui.layer !== TEXT_LAYER){ ui.layer = TEXT_LAYER; toast(t('toTextLayer')); }
    if (!TL.visible){ TL.visible = true; toast(t('textLayerShown')); }
  }
  const L = curLayer(); if (L.locked) return toast(t('locked'));
  pushHistory();
  const it = made || newItem(k, o), n = L.items.length % 6;
  if (o.x == null && it.w < doc.settings.w * 0.95){ it.x += n*30; it.y += n*30; }
  L.items.push(it); select(it.id, 'i'); commit(); renderAll();
}
function cutPanels(A, B, onlyId){
  const L = curLayer(), g = PS().gutter, out = []; let n = 0;
  for (const p of L.panels){
    if ((onlyId && p.id !== onlyId) || (!onlyId && !segHitsPoly(A, B, p.pts))){ out.push(p); continue; }
    const p1 = cleanPoly(clipHalf(p.pts, A, B, 1, g/2)), p2 = cleanPoly(clipHalf(p.pts, A, B, -1, g/2));
    if (p1.length < 3 || p2.length < 3){ out.push(p); continue; }
    const n1 = clonePanel(p), n2 = clonePanel(p); n1.pts = p1; n2.pts = p2;
    if (Math.abs(area(p1)) >= Math.abs(area(p2))) n2.img = null; else n1.img = null;
    out.push(n1, n2); n++;
  }
  if (!n) return 0;
  pushHistory(); L.panels = out; deselect();
  commit(); renderAll(); return n;
}
function splitSel(dir){
  const p = selPanel(); if (!p) return;
  const b = bbox(p.pts), c = centroid(p.pts), k = ui.slant;
  const A = dir === 'h' ? [b.x - 1, c[1] - k*b.h/2] : [c[0] + k*b.w/2, b.y - 1];
  const B = dir === 'h' ? [b.x1 + 1, c[1] + k*b.h/2] : [c[0] - k*b.w/2, b.y1 + 1];
  if (!cutPanels(A, B, p.id)) toast(t('cantSplit'));
}
// 目前選取的東西（格子或物件）所在的陣列
function selList(){ return ui.selK === 'i' ? curLayer().items : curLayer().panels; }
function selObj(){ return selPanel() || selItem(); }
function deleteSel(){
  const o = selObj(); if (!o) return;
  pushHistory();
  if (ui.selK === 'i') curLayer().items = curLayer().items.filter(q => q !== o);
  else curLayer().panels = curLayer().panels.filter(q => q !== o);
  deselect(); commit(); renderAll();
}
function dupSel(){
  const o = selObj(); if (!o) return;
  pushHistory(); const c = JSON.parse(JSON.stringify(o)); c.id = uid(); const d = 40;
  if (ui.selK === 'i'){ c.x += d; c.y += d; curLayer().items.push(c); }
  else { c.pts = c.pts.map(q => [q[0]+d, q[1]+d]); if (c.img){ c.img.cx += d; c.img.cy += d; } curLayer().panels.push(c); }
  select(c.id, ui.selK); commit(); renderAll();
}
function reorderSel(dir){
  const list = selList(), o = selObj(), i = list.indexOf(o), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  pushHistory(); [list[i], list[j]] = [list[j], list[i]]; commit(); renderStage();
}
function moveSelToLayer(to){
  const o = selObj(); if (!o || to === ui.layer) return;
  if (isCoverFmt()) return toast(t('coverFmtNote'));
  if (ui.selK === 'i' && isTextKind(o.k) && to !== TEXT_LAYER) return toast(t('textOnly'));
  pushHistory(); const key = ui.selK === 'i' ? 'items' : 'panels';
  curLayer()[key] = curLayer()[key].filter(q => q !== o); curPage().layers[to][key].push(o);
  ui.layer = to; ui.sel = o.id; commit(); renderAll();
}
function deleteVertex(){
  const p = selPanel(); if (!p || ui.selV == null || p.pts.length <= 3) return;
  pushHistory(); p.pts.splice(ui.selV, 1); ui.selV = null; commit(); renderStage(); renderSide();
}
function insertVertex(p, pt){
  let best = null;
  for (let i = 0; i < p.pts.length; i++){
    const a = p.pts[i], b = p.pts[(i+1) % p.pts.length], dx = b[0]-a[0], dy = b[1]-a[1];
    const tt = clamp(((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / (dx*dx + dy*dy || 1), 0, 1);
    const q = [a[0] + dx*tt, a[1] + dy*tt], d = Math.hypot(q[0]-pt[0], q[1]-pt[1]);
    if (!best || d < best.d) best = { d, i, q };
  }
  pushHistory(); p.pts.splice(best.i + 1, 0, best.q.map(v => Math.round(v*10)/10)); ui.selV = best.i + 1;
  commit(); renderStage(); renderSide();
}
function toggleImgEdit(force){
  const p = selPanel();
  ui.imgEdit = force !== undefined ? force : !ui.imgEdit;
  if (!p || !p.img) ui.imgEdit = false;
  renderStage(); renderSide();
}
// 調整此頁留白：把格子從舊內框等比映射到新內框（貼齊頁緣的點不動）
function rescaleMargin(pg, m0, m1){
  const S = doc.settings, kx = (S.w - 2*m1) / Math.max(1, S.w - 2*m0), ky = (S.h - 2*m1) / Math.max(1, S.h - 2*m0);
  const mx = x => (x <= 0.5 || x >= S.w - 0.5) ? x : m1 + (x - m0)*kx;
  const my = y => (y <= 0.5 || y >= S.h - 0.5) ? y : m1 + (y - m0)*ky;
  pg.layers.forEach(L => L.panels.forEach(p => {
    let moved = false;
    p.pts = p.pts.map(([x, y]) => { const q = [Math.round(mx(x)*10)/10, Math.round(my(y)*10)/10]; if (q[0] !== x || q[1] !== y) moved = true; return q; });
    if (moved && p.img){ p.img.cx = m1 + (p.img.cx - m0)*kx; p.img.cy = m1 + (p.img.cy - m0)*ky; p.img.s *= (kx + ky)/2; }
  }));
}

/* ================= 對齊吸附 =================
   拖曳時，把物件的「左、中、右」「上、中、下」對齊到其他物件或頁面的邊緣與中心。
   只在很接近時（約 7 個螢幕像素）吸過去；繼續拖就會離開，不會鎖死。按住 Alt 暫時關閉。
   目標值 {v:位置, a,b:另一軸的範圍（畫參考線用）, gut:格距吸附} */
let snapOn = true;
try { snapOn = localStorage.getItem('cps-snap') !== '0'; } catch {}
function itemWorldBox(it, dx = 0, dy = 0){
  const b = itemBox(it), cs = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u, v]) => toWorld(it, u*b.w/2, v*b.h/2));
  return { x0:Math.min(...cs.map(q => q[0])) + dx, x1:Math.max(...cs.map(q => q[0])) + dx, y0:Math.min(...cs.map(q => q[1])) + dy, y1:Math.max(...cs.map(q => q[1])) + dy };
}
const boxOfPts = pts => { const b = bbox(pts); return { x0:b.x, y0:b.y, x1:b.x1, y1:b.y1 }; };
// 一個方框的 3 條直線、3 條橫線
const boxXs = b => [b.x0, (b.x0 + b.x1)/2, b.x1];
const boxYs = b => [b.y0, (b.y0 + b.y1)/2, b.y1];
function snapTargets(ignoreId){
  const S = PS(), g = S.gutter, xs = [], ys = [];
  const addBox = bx => { boxXs(bx).forEach(v => xs.push({ v, a:bx.y0, b:bx.y1 })); boxYs(bx).forEach(v => ys.push({ v, a:bx.x0, b:bx.x1 })); };
  addBox({ x0:0, y0:0, x1:S.w, y1:S.h });
  if (S.margin > 0) addBox({ x0:S.margin, y0:S.margin, x1:S.w - S.margin, y1:S.h - S.margin });
  curPage().layers.forEach(L => {
    if (!L.visible) return;
    for (const p of L.panels){
      if (p.id === ignoreId) continue;
      addBox(boxOfPts(p.pts));
      for (const [x, y] of p.pts){
        xs.push({ v:x, a:y, b:y });  ys.push({ v:y, a:x, b:x });
        if (g > 0){ xs.push({ v:x - g, a:y, b:y, gut:1 }, { v:x + g, a:y, b:y, gut:1 }); ys.push({ v:y - g, a:x, b:x, gut:1 }, { v:y + g, a:x, b:x, gut:1 }); }
      }
    }
    for (const it of L.items) if (it.id !== ignoreId) addBox(itemWorldBox(it));
  });
  return { xs, ys };
}
// fx, fy：拖曳中物件的特徵線；回傳要補的位移與對到的目標
function snapFind(fx, fy, T, e){
  const none = { dx:0, dy:0, tx:null, ty:null };
  if (!snapOn || (e && e.altKey) || !T) return none;
  const thr = 9 / ui.zoom; let bx = null, by = null;
  for (const f of fx) for (const tg of T.xs){ const d = tg.v - f; if (Math.abs(d) < thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, tg }; }
  for (const f of fy) for (const tg of T.ys){ const d = tg.v - f; if (Math.abs(d) < thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, tg }; }
  return { dx:bx ? bx.d : 0, dy:by ? by.d : 0, tx:bx && bx.tg, ty:by && by.tg };
}
// 畫參考線：把所有對在同一條線上的目標連起來
function showGuides(T, s, box){
  const g = $('#guides'); if (!g) return;
  const z = ui.zoom, ext = 14/z; let h = '';
  const line = (x1, y1, x2, y2, gut) => h += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${gut ? '#22d3ee' : '#ff3bd4'}" stroke-width="${1.2/z}"${gut ? ` stroke-dasharray="${5/z} ${3/z}"` : ''}/>`;
  // 吸附後，物件的左／中／右、上／中／下只要剛好對上別的物件，每一條都畫參考線
  const drawAxis = (feats, targets, vertical) => {
    const done = new Set();
    for (const f of feats){
      const same = targets.filter(q => Math.abs(q.v - f) < 0.6); if (!same.length) continue;
      const v = same[0].v, key = Math.round(v); if (done.has(key)) continue; done.add(key);
      const gut = same.every(q => q.gut);
      if (vertical) line(v, Math.min(box.y0, ...same.map(q => q.a)) - ext, v, Math.max(box.y1, ...same.map(q => q.b)) + ext, gut);
      else line(Math.min(box.x0, ...same.map(q => q.a)) - ext, v, Math.max(box.x1, ...same.map(q => q.b)) + ext, v, gut);
    }
  };
  if (s && s.tx) drawAxis(boxXs(box), T.xs, true);
  if (s && s.ty) drawAxis(boxYs(box), T.ys, false);
  g.innerHTML = h;
}
const clearGuides = () => { const g = $('#guides'); if (g) g.innerHTML = ''; };
/* ---------- 格子內圖片的對齊吸附 ----------
   圖片的左／右／上／下邊與中心，靠近格子外框的邊與中心時貼齊，避免差一點點露出白邊。
   圖片有旋轉時只對齊中心。回傳要畫的參考線 { xs:[…], ys:[…] } */
function imgEdges(p){
  const a = assets.get(p.img.a), hw = a.w*p.img.s/2, hh = a.h*p.img.s/2;
  return { a, hw, hh, L:p.img.cx - hw, R:p.img.cx + hw, T:p.img.cy - hh, B:p.img.cy + hh };
}
function imgSnapMove(p, e){
  const none = { xs:[], ys:[] };
  if (!snapOn || (e && e.altKey)) return none;
  const b = bbox(p.pts), thr = 9 / ui.zoom, E = imgEdges(p), rotated = (p.img.r || 0) % 360 !== 0;
  const best = cands => cands.filter(c => Math.abs(c.d) < thr).sort((u, v) => Math.abs(u.d) - Math.abs(v.d))[0];
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const bx = best([{ d:cx - p.img.cx, v:cx }, ...(rotated ? [] : [{ d:b.x - E.L, v:b.x }, { d:b.x1 - E.R, v:b.x1 }])]);
  const by = best([{ d:cy - p.img.cy, v:cy }, ...(rotated ? [] : [{ d:b.y - E.T, v:b.y }, { d:b.y1 - E.B, v:b.y1 }])]);
  if (bx) p.img.cx += bx.d;
  if (by) p.img.cy += by.d;
  return { xs:bx ? [bx.v] : [], ys:by ? [by.v] : [] };
}
function imgSnapScale(p, e){
  const none = { xs:[], ys:[] };
  if (!snapOn || (e && e.altKey) || (p.img.r || 0) % 360 !== 0) return none;
  const b = bbox(p.pts), a = assets.get(p.img.a), { cx, cy, s } = p.img, thr = 9 / ui.zoom;
  // 每個候選：讓某一邊剛好碰到格子邊所需要的縮放值；比較的是「邊緣差幾個像素」
  const cands = [
    { s:2*(cx - b.x)/a.w, x:b.x }, { s:2*(b.x1 - cx)/a.w, x:b.x1 },
    { s:2*(cy - b.y)/a.h, y:b.y }, { s:2*(b.y1 - cy)/a.h, y:b.y1 },
  ].filter(c => c.s > 0).map(c => ({ ...c, dist:Math.abs(c.s - s) * (c.x != null ? a.w : a.h) / 2 }));
  const hit = cands.filter(c => c.dist < thr).sort((u, v) => u.dist - v.dist)[0];
  if (!hit) return none;
  p.img.s = hit.s;
  return { xs:hit.x != null ? [hit.x] : [], ys:hit.y != null ? [hit.y] : [] };
}
function showImgGuides(p, g){
  const el = $('#guides'); if (!el) return;
  const b = bbox(p.pts), z = ui.zoom, ext = 24/z;
  el.innerHTML = g.xs.map(x => `<line x1="${f1(x)}" y1="${f1(b.y - ext)}" x2="${f1(x)}" y2="${f1(b.y1 + ext)}" stroke="#ff3bd4" stroke-width="${1.5/z}"/>`).join('')
               + g.ys.map(y => `<line x1="${f1(b.x - ext)}" y1="${f1(y)}" x2="${f1(b.x1 + ext)}" y2="${f1(y)}" stroke="#ff3bd4" stroke-width="${1.5/z}"/>`).join('');
}
// 旋轉提示：在旋轉把手旁顯示目前角度；吸到 90° 倍數時變成粉紅色，並畫出水平／垂直參考線
function showRotHint(it, snapped){
  const g = $('#guides'); if (!g) return;
  const z = ui.zoom, b = itemBox(it), deg = Math.round(it.r || 0), shown = ((deg % 360) + 360) % 360;
  const [hx, hy] = toWorld(it, 0, -b.h/2 - 70/z);
  const label = shown + '°', fs = 13/z, w = (label.length * 8 + 14)/z, h = 22/z;
  let s = '';
  if (snapped){
    // 通過物件中心、對齊物件本身方向的兩條參考線
    const L = Math.max(b.w, b.h)*0.75 + 40/z;
    for (const a of [0, 90]){ const [x1, y1] = toWorld(it, ...rotP(-L, 0, a)), [x2, y2] = toWorld(it, ...rotP(L, 0, a));
      s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#ff3bd4" stroke-width="${1.2/z}" stroke-dasharray="${6/z} ${4/z}"/>`; }
  }
  s += `<rect x="${f1(hx - w/2)}" y="${f1(hy - h/2)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(h/2)}" fill="${snapped ? '#ff3bd4' : '#1d2026'}" opacity=".92"/>`
     + `<text x="${f1(hx)}" y="${f1(hy)}" font-size="${f1(fs)}" font-family="Segoe UI, sans-serif" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central">${label}</text>`;
  g.innerHTML = s;
}
function setSnap(on){
  snapOn = on; try { localStorage.setItem('cps-snap', on ? '1' : '0'); } catch {}
  $('#bSnap').classList.toggle('on', on); toast(t(on ? 'snapOnT' : 'snapOffT'));
}

/* ================= 滑鼠互動 ================= */
function toPage(cx, cy){ const p = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; }
function toClient(x, y){ const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }
let drag = null, spaceDown = false;

work.addEventListener('pointerdown', e => {
  if (e.button === 1 || (e.button === 0 && spaceDown)){
    e.preventDefault(); e.stopPropagation();
    drag = { type:'pan', x:e.clientX, y:e.clientY, sl:work.scrollLeft, st:work.scrollTop };
    work.classList.add('panning'); work.setPointerCapture(e.pointerId);
  }
}, true);
work.addEventListener('pointermove', e => {
  if (drag && drag.type === 'pan'){ work.scrollLeft = drag.sl - (e.clientX - drag.x); work.scrollTop = drag.st - (e.clientY - drag.y); }
});
work.addEventListener('pointerup', () => { if (drag && drag.type === 'pan'){ drag = null; work.classList.remove('panning'); } });

svg.addEventListener('pointerdown', e => {
  if (e.button !== 0 || drag) return;
  const pt = toPage(e.clientX, e.clientY), tg = e.target, h = tg.dataset && tg.dataset.h, L = curLayer();
  svg.setPointerCapture(e.pointerId);
  if (ui.tool === 'knife'){
    if (isCoverFmt() && ui.layer !== 0){ ensurePanelLayer(); renderStage(); renderSide(); }
    if (curLayer().locked) return toast(t('locked'));
    drag = { type:'knife', a:pt, b:pt }; return;
  }
  const p = selPanel(), it = selItem();
  // 物件的控制點
  if (it && h === 'isc'){ const lp = toLocal(it, pt); drag = { type:'isc', it, lp0:lp, w0:it.w, h0:it.h, s0:it.p.size, T:snapTargets(it.id) }; return; }
  if (it && h === 'irot'){ drag = { type:'irot', it }; return; }
  if (it && (h === 'tail' || h === 'tailc')){ drag = { type:h, it, ti:+tg.dataset.t }; return; }
  // 格子的控制點
  if (h === 'v' && p){
    ui.selV = +tg.dataset.i; renderOverlay();
    drag = { type:'vertex', p, i:ui.selV, start:pt, orig:p.pts[ui.selV].slice(), T:snapTargets(p.id) }; return;
  }
  if (h === 'is' && p && p.img){
    drag = { type:'iscale', p, s0:p.img.s, d0:Math.hypot(pt[0]-p.img.cx, pt[1]-p.img.cy) || 1 }; return;
  }
  const pid = tg.dataset && tg.dataset.pid, iid = tg.dataset && tg.dataset.iid;
  if (ui.imgEdit && p && p.img){
    const a = assets.get(p.img.a);
    if (pid === p.id || pointInPoly(pt, imgCorners(p.img, a))){
      drag = { type:'img', p, start:pt, orig:[p.img.cx, p.img.cy] }; return;
    }
  }
  if (iid){
    const q = L.items.find(x => x.id === iid); if (!q) return;
    // Alt + 從對話框拖出 → 新增一個尾巴並直接拖它的尖端
    if (e.altKey && STK[q.k] && STK[q.k].tails && !L.locked){
      pushHistory(); select(iid, 'i');
      const lp = toLocal(q, pt); q.p.tails = [...(q.p.tails || []), { tx:Math.round(lp[0]), ty:Math.round(lp[1]), cx:null, cy:null, bw:0.12, style:'tri' }];
      drag = { type:'tail', it:q, ti:q.p.tails.length - 1, moved:true }; renderStage(); renderSide(); return;
    }
    const changed = ui.sel !== iid;
    select(iid, 'i');
    drag = { type:'imove', it:q, start:pt, orig:[q.x, q.y], T:snapTargets(q.id), box0:itemWorldBox(q) };
    if (changed){ renderStage(); renderSide(); } else renderOverlay();
    return;
  }
  if (pid){
    const q = L.panels.find(x => x.id === pid); if (!q) return;
    if (e.altKey && ui.sel === pid){ insertVertex(q, pt); return; }
    const changed = ui.sel !== pid;
    select(pid, 'p'); ui.selV = null;
    drag = { type:'move', p:q, start:pt, orig:q.pts.map(v => v.slice()), oimg:q.img ? [q.img.cx, q.img.cy] : null, T:snapTargets(q.id) };
    if (changed){ renderStage(); renderSide(); } else renderOverlay();
    return;
  }
  if (ui.sel){ deselect(); renderStage(); renderSide(); }
});
svg.addEventListener('pointermove', e => {
  if (!drag || drag.type === 'pan') return;
  const pt = toPage(e.clientX, e.clientY);
  if (drag.type === 'knife'){
    let b = pt;
    if (e.shiftKey){
      const dx = pt[0]-drag.a[0], dy = pt[1]-drag.a[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI/4)) * (Math.PI/4), r = Math.hypot(dx, dy);
      b = [drag.a[0] + Math.cos(ang)*r, drag.a[1] + Math.sin(ang)*r];
    }
    drag.b = b;
    const k = $('#knife'); k.style.display = '';
    k.setAttribute('x1', drag.a[0]); k.setAttribute('y1', drag.a[1]); k.setAttribute('x2', b[0]); k.setAttribute('y2', b[1]);
    k.setAttribute('stroke-width', 2/ui.zoom);
    return;
  }
  const dx = pt[0] - (drag.start ? drag.start[0] : 0), dy = pt[1] - (drag.start ? drag.start[1] : 0);
  if (!drag.moved){
    if (drag.start && Math.hypot(dx, dy) < 3/ui.zoom) return;
    if (curLayer().locked) return;
    pushHistory(); drag.moved = true;
  }
  const p = drag.p, it = drag.it;
  switch (drag.type){
    case 'move': {
      const moved = drag.orig.map(v => [v[0]+dx, v[1]+dy]), mb = boxOfPts(moved);
      // 格子用外框的邊與中心，加上每個頂點來對齊
      const s = snapFind([...boxXs(mb), ...moved.map(v => v[0])], [...boxYs(mb), ...moved.map(v => v[1])], drag.T, e);
      const sx = s.dx, sy = s.dy;
      p.pts = moved.map(v => [Math.round((v[0]+sx)*10)/10, Math.round((v[1]+sy)*10)/10]);
      if (drag.oimg){ p.img.cx = drag.oimg[0] + dx + sx; p.img.cy = drag.oimg[1] + dy + sy; }
      updatePanelDOM(p); showGuides(drag.T, s, boxOfPts(p.pts)); break;
    }
    case 'vertex': {
      const v = [drag.orig[0]+dx, drag.orig[1]+dy];
      const s = snapFind([v[0]], [v[1]], drag.T, e);
      p.pts[drag.i] = [Math.round((v[0]+s.dx)*10)/10, Math.round((v[1]+s.dy)*10)/10];
      updatePanelDOM(p); showGuides(drag.T, s, { x0:p.pts[drag.i][0], x1:p.pts[drag.i][0], y0:p.pts[drag.i][1], y1:p.pts[drag.i][1] }); break;
    }
    case 'img': {
      p.img.cx = drag.orig[0] + dx; p.img.cy = drag.orig[1] + dy;
      const g = imgSnapMove(p, e); updatePanelDOM(p); showImgGuides(p, g); break;
    }
    case 'iscale': {
      p.img.s = Math.max(0.01, drag.s0 * Math.hypot(pt[0]-p.img.cx, pt[1]-p.img.cy) / drag.d0);
      const g = imgSnapScale(p, e); updatePanelDOM(p); showImgGuides(p, g); break;
    }
    case 'imove': {
      // 物件用「實際外框」的左中右、上中下來對齊
      const mb = { x0:drag.box0.x0 + dx, x1:drag.box0.x1 + dx, y0:drag.box0.y0 + dy, y1:drag.box0.y1 + dy };
      const s = snapFind(boxXs(mb), boxYs(mb), drag.T, e);
      it.x = drag.orig[0] + dx + s.dx; it.y = drag.orig[1] + dy + s.dy; updateItemDOM(it);
      showGuides(drag.T, s, { x0:mb.x0 + s.dx, x1:mb.x1 + s.dx, y0:mb.y0 + s.dy, y1:mb.y1 + s.dy }); break;
    }
    case 'isc': {
      const lp = toLocal(it, pt), def = STK[it.k];
      if (it.k === 'text'){ const f = Math.hypot(...lp) / (Math.hypot(...drag.lp0) || 1); it.p.size = Math.max(4, Math.round(drag.s0 * f * 10)/10); }
      else if (def.uniform || e.shiftKey){ const f = Math.hypot(...lp) / (Math.hypot(...drag.lp0) || 1); it.w = Math.max(10, drag.w0*f); it.h = Math.max(10, drag.h0*f); }
      else { it.w = Math.max(20, Math.abs(lp[0])*2); it.h = Math.max(20, Math.abs(lp[1])*2); }
      if (it.k !== 'text' && !((it.r || 0) % 360)){
        // 對稱縮放：左右（上下）兩邊任一邊靠近其他物件的線就吸過去
        const s = snapFind([it.x - it.w/2, it.x + it.w/2], [it.y - it.h/2, it.y + it.h/2], drag.T, e);
        if (s.tx) it.w = Math.max(20, 2*Math.abs(s.tx.v - it.x));
        if (s.ty) it.h = Math.max(20, 2*Math.abs(s.ty.v - it.y));
        if ((def.uniform || e.shiftKey) && (s.tx || s.ty)){ const f = s.tx ? it.w/drag.w0 : it.h/drag.h0; it.w = drag.w0*f; it.h = drag.h0*f; }
        updateItemDOM(it); showGuides(drag.T, s, { x0:it.x - it.w/2, x1:it.x + it.w/2, y0:it.y - it.h/2, y1:it.y + it.h/2 }); break;
      }
      updateItemDOM(it); break;
    }
    case 'irot': {
      let r = Math.atan2(pt[1] - it.y, pt[0] - it.x) * 180/Math.PI + 90;
      if (r > 180) r -= 360;
      let snapped = false;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      else if (snapOn && !e.altKey){
        // 接近 0°／90°／180°／270° 時輕輕吸過去（±5°），繼續轉就會離開
        const n = Math.round(r / 90) * 90;
        if (Math.abs(r - n) < 5){ r = n; snapped = true; }
      }
      if (r <= -180) r += 360;
      it.r = Math.round(r * 10)/10; updateItemDOM(it); syncField('ic:r', Math.round(it.r));
      showRotHint(it, snapped); break;
    }
    case 'tail': case 'tailc': {
      const lp = toLocal(it, pt), tl = it.p.tails[drag.ti]; if (!tl) break;
      if (drag.type === 'tail'){ tl.tx = Math.round(lp[0]); tl.ty = Math.round(lp[1]); } else { tl.cx = Math.round(lp[0]); tl.cy = Math.round(lp[1]); }
      updateItemDOM(it); break;
    }
  }
});
svg.addEventListener('pointerup', () => {
  if (!drag || drag.type === 'pan') return;
  const d = drag; drag = null; clearGuides();
  if (d.type === 'knife'){
    $('#knife').style.display = 'none';
    if (Math.hypot(d.b[0]-d.a[0], d.b[1]-d.a[1]) > 10/ui.zoom){
      const n = cutPanels(d.a, d.b);
      toast(n ? t('cutN', n) : t('noCut'));
    }
    return;
  }
  if (d.moved){ commit(); renderSide(); }
});
svg.addEventListener('dblclick', e => {
  if (ui.tool !== 'select') return;
  const el = document.elementFromPoint(e.clientX, e.clientY), iid = el && el.dataset && el.dataset.iid;
  if (iid){
    select(iid, 'i'); ui.tab = 'props'; renderSide(); renderOverlay();
    const ta = $('#tabBody textarea, #tabBody input[type=text]'); if (ta){ ta.focus(); ta.select(); }
    return;
  }
  const q = panelAt(e.clientX, e.clientY), pid = q && q.id;
  if (!pid) return;
  select(pid, 'p');
  const p = selPanel();
  if (p && p.img) toggleImgEdit(true); else toast(t('noImgYet'));
});
work.addEventListener('wheel', e => {
  if (e.ctrlKey){ e.preventDefault(); setZoom(ui.zoom * (e.deltaY < 0 ? 1.12 : 1/1.12), e.clientX, e.clientY); return; }
  const p = selPanel();
  if (ui.imgEdit && p && p.img){
    e.preventDefault(); gesture('wheel-' + p.id);
    const pt = toPage(e.clientX, e.clientY), f = e.deltaY < 0 ? 1.06 : 1/1.06;
    p.img.s *= f; p.img.cx = pt[0] + (p.img.cx - pt[0]) * f; p.img.cy = pt[1] + (p.img.cy - pt[1]) * f;
    updatePanelDOM(p); commit(); syncField('iscale', Math.round(p.img.s / coverScale(p, assets.get(p.img.a)) * 100));
  }
}, { passive:false });

function setZoom(nz, cx, cy){
  nz = clamp(nz, 0.05, 4);
  const r = work.getBoundingClientRect();
  if (cx == null){ cx = r.left + r.width/2; cy = r.top + r.height/2; }
  const before = toPage(cx, cy);
  ui.zoom = nz; sizeStage(); renderOverlay();
  const [ax, ay] = toClient(before[0], before[1]);
  work.scrollLeft += ax - cx; work.scrollTop += ay - cy;
}
function fitZoom(){
  const S = doc.settings;
  ui.zoom = clamp(Math.min((work.clientWidth - 30) / (S.w + 2*PAD), (work.clientHeight - 30) / (S.h + 2*PAD)), 0.05, 4);
  sizeStage(); renderOverlay();
}

/* ================= 拖放圖片 ================= */
let dropTgt = null;
function panelAt(cx, cy){
  const el = document.elementFromPoint(cx, cy), pid = el && el.dataset && el.dataset.pid;
  return pid ? curLayer().panels.find(p => p.id === pid) : null;
}
function markDrop(p){
  if (dropTgt === (p && p.id)) return;
  if (dropTgt) document.getElementById('poly-' + dropTgt)?.classList.remove('droptgt');
  dropTgt = p ? p.id : null;
  if (dropTgt) document.getElementById('poly-' + dropTgt)?.classList.add('droptgt');
}
// 拖放目標：目前圖層的格子；封面格式時就算停在文字層，也能找到底圖的格子
function dropTargetAt(cx, cy){
  const hit = panelAt(cx, cy); if (hit) return hit;
  if (!isCoverFmt()) return null;
  const pt = toPage(cx, cy);
  return [...curPage().layers[0].panels].reverse().find(p => pointInPoly(pt, p.pts)) || null;
}
work.addEventListener('dragover', e => { e.preventDefault(); markDrop(curLayer().locked ? null : dropTargetAt(e.clientX, e.clientY)); });
work.addEventListener('dragleave', e => { if (!work.contains(e.relatedTarget)) markDrop(null); });
work.addEventListener('drop', async e => {
  e.preventDefault(); markDrop(null);
  const L = curLayer(); if (L.locked) return toast(t('locked'));
  const pt = toPage(e.clientX, e.clientY);
  const target = dropTargetAt(e.clientX, e.clientY);
  if (isCoverFmt() && ui.layer !== 0){ ui.layer = 0; deselect(); }
  let list = [];
  const aid = e.dataTransfer.getData('application/x-comic-asset');
  if (aid && assets.get(aid)) list = [assets.get(aid)];
  else {
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    toast(t('importing', files.length));
    for (const f of files) list.push(await addAsset(f, f.name));
  }
  if (!list.length) return;
  placeImages(list, target, pt);
});
function placeImages(list, target, pt){
  const L = target ? curPage().layers.find(Ly => Ly.panels.includes(target)) : curLayer(); pushHistory();
  if (target){
    setPanelImage(target, list[0]);
    const rest = list.slice(1), idx = L.panels.indexOf(target);
    const empties = [...L.panels.slice(idx + 1), ...L.panels.slice(0, idx)].filter(p => !p.img);
    rest.forEach((a, i) => { if (empties[i]) setPanelImage(empties[i], a); });
    select(target.id, 'p');
    if (rest.length > empties.length) toast(t('noRoom', rest.length - empties.length));
  } else {
    const S = PS();
    list.forEach((a, i) => {
      const sc = Math.min((S.w - 2*S.margin) * 0.45 / a.w, (S.h - 2*S.margin) * 0.45 / a.h);
      const w = a.w*sc, h = a.h*sc, cx = (pt ? pt[0] : S.w/2) + i*40, cy = (pt ? pt[1] : S.h/2) + i*40;
      const p = makePanel([[cx-w/2, cy-h/2],[cx+w/2, cy-h/2],[cx+w/2, cy+h/2],[cx-w/2, cy+h/2]].map(v => v.map(n => Math.round(n))));
      setPanelImage(p, a); L.panels.push(p); select(p.id, 'p');
    });
  }
  commit(); renderAll();
}
/* ================= 跨頁複製／貼上 =================
   Ctrl+C／Ctrl+X 會把選取的物件或格子寫進系統剪貼簿（文字標記 CPS-OBJECT:），
   所以切換頁面、甚至開另一個專案視窗都能用 Ctrl+V 貼上。貼上時放在相同位置。 */
const CLIP_MARK = 'CPS-OBJECT:';
let clipSrc = null, pasteCount = 0, lastPastePage = null;   // 同一頁連續貼上時往右下錯開
function clipPayload(){
  const o = selObj(); if (!o) return null;
  return { kind:ui.selK, layer:ui.layer, page:curPage().id, obj:JSON.parse(JSON.stringify(o)) };
}
// 把物件放到某一頁：遵守圖層規則（文字類 → 文字層；封面格式：物件 → 文字層、格子 → 底圖）
function placeObj(pg, data, dx = 0, dy = 0){
  const o = JSON.parse(JSON.stringify(data.obj)); o.id = uid();
  let li;
  if (data.kind === 'i'){
    if (!STK[o.k]) return null;
    li = (isCoverFmt(pg) || isTextKind(o.k)) ? TEXT_LAYER : Math.min(data.layer ?? 1, TEXT_LAYER);
    o.x += dx; o.y += dy;
    pg.layers[li].items.push(o);
  } else {
    li = isCoverFmt(pg) ? 0 : (data.layer === TEXT_LAYER ? 0 : (data.layer ?? 0));
    o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]);
    if (o.img){ if (assets.get(o.img.a)){ o.img.cx += dx; o.img.cy += dy; } else o.img = null; }
    pg.layers[li].panels.push(o);
  }
  if (!pg.layers[li].visible) pg.layers[li].visible = true;
  return { o, li };
}
const inTextInput = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || isModalOpen();
function copyEvent(e, cut){
  if (inTextInput()) return;
  const data = clipPayload(); if (!data) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', CLIP_MARK + JSON.stringify(data));
  clipSrc = data.page; pasteCount = 0; lastPastePage = null;
  if (cut){ deleteSel(); toast(t('cutDone')); } else toast(t('copied'));
}
document.addEventListener('copy', e => copyEvent(e, false));
document.addEventListener('cut', e => copyEvent(e, true));
function pasteObject(data){
  if (curPage().layers.some((L, i) => L.locked && i === (data.kind === 'i' ? TEXT_LAYER : 0))) return toast(t('locked'));
  pushHistory();
  // 貼在同一頁就往右下錯開，貼到別頁則放在完全相同的位置
  const same = data.page === curPage().id || lastPastePage === curPage().id;
  if (lastPastePage !== curPage().id) pasteCount = 0;
  const k = same ? ++pasteCount * 40 : 0; lastPastePage = curPage().id;
  const r = placeObj(curPage(), data, k, k);
  if (!r){ undoStack.pop(); return; }
  ui.layer = r.li; select(r.o.id, data.kind); commit(); renderAll(); toast(t('pasted'));
}
async function copyToPages(){
  const data = clipPayload(); if (!data) return;
  const others = doc.pages.map((pg, i) => ({ pg, i })).filter(x => x.i !== ui.page);
  if (!others.length) return toast(t('noOtherPages'));
  const r = await modal({ title:t('copyToTitle'), body:`<p>${t('copyToDesc')}</p>
      <label class="chk" style="margin-bottom:8px"><input type="checkbox" id="cpAll">${t('selectAll')}</label>
      <div class="cplist">${others.map(({ pg, i }) => `<label class="opt"><input type="checkbox" name="pages" value="${i}">${t('pageN', i + 1)}${pg.kind !== 'page' ? ` <small>${t('kind_' + pg.kind)}</small>` : ''}</label>`).join('')}</div>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('ok'), value:1, cls:'primary' }] });
  const picked = (r.form.pages || []).map(Number);
  if (!r.value || !picked.length) return;
  pushHistory();
  let n = 0; for (const i of picked) if (placeObj(doc.pages[i], data)) n++;
  commit(); renderPages(); toast(t('copiedToN', n));
}
// 「全選」核取方塊
document.addEventListener('change', e => { if (e.target.id === 'cpAll') document.querySelectorAll('#modal [name="pages"]').forEach(c => c.checked = e.target.checked); });

document.addEventListener('paste', async e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || isModalOpen()) return;
  // 先看是不是本工具複製的物件
  const txt = e.clipboardData.getData('text/plain');
  if (txt && txt.startsWith(CLIP_MARK)){
    e.preventDefault();
    try { pasteObject(JSON.parse(txt.slice(CLIP_MARK.length))); } catch (err){ console.error(err); }
    return;
  }
  const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (!item) return;
  e.preventDefault();
  const a = await addAsset(item.getAsFile(), 'pasted.png');
  const p = selPanel();
  if (p && !curLayer().locked){ pushHistory(); setPanelImage(p, a); commit(); renderAll(); toast(t('pastedPanel')); }
  else { file.dirty = true; updateFileState(); renderSide(); toast(t('pastedLib')); }
});

/* ================= 頁面繪製（匯出用） ================= */
const bmpCache = new Map();
async function getBitmap(id){
  if (!bmpCache.has(id)) bmpCache.set(id, await createImageBitmap(assets.get(id).blob));
  return bmpCache.get(id);
}
function tracePath(ctx, pts){ ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
async function pageToCanvas(pg, scale){
  const S = doc.settings, W = Math.round(S.w*scale), H = Math.round(S.h*scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = PS(pg).bg; ctx.fillRect(0, 0, W, H);
  for (const L of pg.layers){
    if (!L.visible || (!L.panels.length && !L.items.length)) continue;
    const lc = document.createElement('canvas'); lc.width = W; lc.height = H;
    const x = lc.getContext('2d'); x.setTransform(scale, 0, 0, scale, 0, 0);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    for (const p of L.panels){
      if (p.fill && p.fill !== 'none'){ tracePath(x, p.pts); x.fillStyle = p.fill; x.fill(); }
      const a = p.img && assets.get(p.img.a);
      if (a){
        const bmp = await getBitmap(a.id);
        x.save(); tracePath(x, p.pts); x.clip();
        x.translate(p.img.cx, p.img.cy); x.rotate((p.img.r || 0) * Math.PI/180); x.scale(p.img.s*(p.img.fx ? -1 : 1), p.img.s);
        x.drawImage(bmp, -a.w/2, -a.h/2, a.w, a.h); x.restore();
      }
      if (p.sw > 0){ tracePath(x, p.pts); x.lineWidth = p.sw; x.strokeStyle = p.sc; x.lineJoin = 'miter'; x.miterLimit = 10; x.stroke(); }
    }
    for (const it of L.items) drawItem(x, it);
    ctx.globalAlpha = L.opacity; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1;
  }
  return c;
}
async function ensurePageFonts(idxs){
  const lists = [];
  idxs.forEach(i => doc.pages[i].layers.forEach(L => L.visible && L.items.forEach(it => lists.push(itemPrims(it)))));
  await ensureFonts(lists);
}
const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

/* ================= PDF 產生器（JPEG 內嵌，不需外部套件） ================= */
function buildPDF(pages, pw, ph){
  const enc = new TextEncoder(), parts = []; let len = 0; const offs = [];
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (num, fn) => { offs[num] = len; push(`${num} 0 obj\n`); fn(); push('\nendobj\n'); };
  push('%PDF-1.4\n%âãÏÓ\n');
  const n = pages.length, total = 3 + 3*n;
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3*i} 0 R`).join(' ')}] /Count ${n} >>`));
  pages.forEach((p, i) => {
    const po = 3 + 3*i;
    obj(po, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${po+2} 0 R >> >> /Contents ${po+1} 0 R >>`));
    const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(po+1, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(po+2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
  });
  const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) push(String(offs[k]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type:'application/pdf' });
}

/* ================= 檔案系統工具 ================= */
const hasFS = !!window.showDirectoryPicker;
const isAbort = e => e && e.name === 'AbortError';
async function writeFile(dir, name, data){ const fh = await dir.getFileHandle(name, { create:true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
async function isEmptyDir(dir){ for await (const _ of dir.keys()) return false; return true; }
async function hasEntry(dir, name){ try { await dir.getFileHandle(name); return true; } catch { return false; } }
async function ensurePerm(dir){
  const opt = { mode:'readwrite' };
  if (await dir.queryPermission(opt) === 'granted') return true;
  return (await dir.requestPermission(opt)) === 'granted';
}
async function resolveTargetDir(picked, name){
  if (await isEmptyDir(picked) || picked.name === name) return picked;
  return picked.getDirectoryHandle(name, { create:true });
}
function download(blob, name){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const EXT = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp', 'image/gif':'.gif', 'image/avif':'.avif', 'image/bmp':'.bmp' };
const extOf = a => EXT[a.blob.type] || '.png';

/* ================= 專案：儲存 ================= */
function projectJSON(assetFiles, fontFiles){
  return JSON.stringify({ app:'ComicPanelStudio', version:3, name:doc.name, settings:doc.settings, pages:doc.pages, assets:assetFiles, fonts:fontFiles }, null, 1);
}
// 寫入一個子資料夾，並清掉不再使用的檔案（只清本程式產生的檔名）
async function syncFolder(dir, sub, entries, label){
  const d = await dir.getDirectoryHandle(sub, { create:true }), existing = new Set();
  for await (const n of d.keys()) existing.add(n);
  const needed = new Set(); let i = 0;
  for (const [fn, blob] of entries){
    needed.add(fn);
    if (!existing.has(fn)) await writeFile(d, fn, blob);
    busy(t('saving'), label + ' ' + fn, ++i / Math.max(1, entries.length) * 90);
  }
  for (const n of existing) if (!needed.has(n) && /^[a-z0-9]{6,12}\.\w+$/.test(n)) { try { await d.removeEntry(n); } catch {} }
}
async function writeProjectTo(dir){
  const all = [...assets.values()], fonts = [...customFonts.values()];
  await syncFolder(dir, 'images', all.map(a => [a.id + extOf(a), a.blob]), '');
  if (fonts.length) await syncFolder(dir, 'fonts', fonts.map(f => [f.id + '.' + f.ext, f.blob]), '');
  await writeFile(dir, 'project.json', projectJSON(
    all.map(a => ({ id:a.id, name:a.name, w:a.w, h:a.h, t:a.t, file:'images/' + a.id + extOf(a) })),
    fonts.map(f => ({ id:f.id, name:f.name, ext:f.ext, t:f.t, file:'fonts/' + f.id + '.' + f.ext }))));
}
async function saveProject(){
  if (!hasFS) return saveLegacyJSON();
  if (!file.dir) return saveProjectAs();
  try {
    if (!await ensurePerm(file.dir)) return toast(t('permDenied'));
    busy(t('saving'), '', 0);
    await writeProjectTo(file.dir);
    closeModal();
    file.dirty = false; scheduleCache(); updateFileState(); renderSide();
    toast(t('savedToast', file.dirName));
  } catch (err){ closeModal(); console.error(err); toast(t('saveFail', err.message)); }
}
async function saveProjectAs(){
  if (!hasFS){
    await modal({ title:t('saveAsTitle'), body:`<p>${t('noFS')}</p>`, buttons:[{ label:t('ok'), value:1, cls:'primary' }] });
    return saveLegacyJSON();
  }
  const r = await modal({ title:t('saveAsTitle'),
    body:`<div class="fgrid"><span>${t('projName')}</span><input type="text" name="name" value="${esc(doc.name || t('untitled'))}"></div><p>${t('saveAsDesc')}</p>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('next'), value:1, cls:'primary' }] });
  if (!r.value) return;
  const name = safeName(r.form.name);
  try {
    const picked = await window.showDirectoryPicker({ id:'cps-project', mode:'readwrite' });
    const dir = await resolveTargetDir(picked, name);
    if (!(file.dir && await dir.isSameEntry(file.dir)) && await hasEntry(dir, 'project.json')){
      const c = await modal({ title:t('saveAsTitle'), body:`<p>${t('overwriteQ', esc(dir.name))}</p>`,
        buttons:[{ label:t('cancel'), value:null }, { label:t('overwrite'), value:1, cls:'primary' }] });
      if (!c.value) return;
    }
    doc.name = r.form.name.trim() || t('untitled');
    busy(t('saving'), '', 0);
    await writeProjectTo(dir);
    closeModal();
    file.dir = dir; file.dirName = dir.name; file.dirty = false;
    scheduleCache(); updateFileState(); renderSide();
    toast(t('savedToast', dir.name));
  } catch (err){ closeModal(); if (!isAbort(err)){ console.error(err); toast(t('saveFail', err.message)); } }
}
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function saveLegacyJSON(){
  const list = [], fl = [];
  for (const a of assets.values()) list.push({ id:a.id, name:a.name, w:a.w, h:a.h, t:a.t, data:await blobToDataURL(a.blob) });
  for (const f of customFonts.values()) fl.push({ id:f.id, name:f.name, ext:f.ext, t:f.t, data:await blobToDataURL(f.blob) });
  download(new Blob([projectJSON(list, fl)], { type:'application/json' }), safeName(doc.name) + '.json');
  file.dirty = false; scheduleCache(); updateFileState();
}

/* ================= 專案：開啟 / 新建 ================= */
async function confirmDiscard(){
  if (!file.dirty) return true;
  const r = await modal({ title:t('file'), body:`<p>${t('discardQ')}</p>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('saveFirst'), value:'save' }, { label:t('discard'), value:'discard', cls:'primary' }] });
  if (r.value === 'save'){ await saveProject(); return !file.dirty; }
  return r.value === 'discard';
}
async function loadProject(o, getBlob, dirHandle, dirName){
  if (!o || !Array.isArray(o.pages)) throw new Error(t('notProject'));
  busy(t('openFolder'), '', 0);
  await clearAssets(); await clearFonts();
  const list = o.assets || [], fl = o.fonts || []; let missing = 0, i = 0;
  const get = async r => r.data ? await (await fetch(r.data)).blob() : await getBlob(r.file);
  for (const r of list){
    try {
      const blob = await get(r); if (!blob) throw 0;
      const a = { id:r.id, name:r.name, w:r.w, h:r.h, t:r.t || Date.now() + i, blob };
      await tx('assets', 'readwrite', s => s.put(a)); a.url = URL.createObjectURL(blob); assets.set(a.id, a);
    } catch { missing++; }
    busy(t('openFolder'), r.name, ++i / Math.max(1, list.length + fl.length) * 100);
  }
  for (const r of fl){
    try { const blob = await get(r); if (!blob) throw 0; await addFontFile(blob, r.name + '.' + (r.ext || 'ttf'), r.id, r.t); }
    catch { missing++; }
    busy(t('openFolder'), r.name, ++i / Math.max(1, list.length + fl.length) * 100);
  }
  doc = normalizeDoc({ version:3, name:o.name || dirName || t('untitled'), settings:o.settings || {}, pages:o.pages });
  file.dir = dirHandle || null; file.dirName = dirHandle ? dirName : ''; file.dirty = !dirHandle;
  undoStack = []; redoStack = []; ui.page = 0; ui.layer = 0; deselect(); tplThumbCache = null;
  closeModal(); scheduleCache(); fitZoom(); renderAll();
  toast(missing ? t('missingImgs', missing) : t('opened', doc.name));
}
async function openProjectFolder(){
  if (!await confirmDiscard()) return;
  if (!hasFS) return $('#fileDir').click();
  try {
    const dir = await window.showDirectoryPicker({ id:'cps-project', mode:'readwrite' });
    let o;
    try { o = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text()); }
    catch { return toast(t('notProject')); }
    await loadProject(o, async path => {
      let d = dir; const segs = path.split('/');
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s);
      return (await d.getFileHandle(segs[segs.length-1])).getFile();
    }, dir, dir.name);
  } catch (err){ closeModal(); if (!isAbort(err)){ console.error(err); toast(t('openFail', err.message)); } }
}
$('#fileDir').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  const pj = files.find(f => /(^|\/)project\.json$/.test(f.webkitRelativePath) && f.webkitRelativePath.split('/').length === 2);
  if (!pj) return toast(t('notProject'));
  const root = pj.webkitRelativePath.split('/')[0];
  const map = new Map(files.map(f => [f.webkitRelativePath.slice(root.length + 1), f]));
  try { await loadProject(JSON.parse(await pj.text()), async path => map.get(path), null, root); }
  catch (err){ closeModal(); toast(t('openFail', err.message)); }
});
$('#fileProj').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await loadProject(JSON.parse(await f.text()), async () => null, null, ''); }
  catch (err){ closeModal(); toast(t('openFail', err.message)); }
});
async function newProject(){
  if (!await confirmDiscard()) return;
  await clearAssets(); await clearFonts();
  makeDefaultDoc(); file.dir = null; file.dirName = ''; file.dirty = false;
  undoStack = []; redoStack = []; ui.page = 0; ui.layer = 0; deselect(); tplThumbCache = null;
  scheduleCache(); fitZoom(); renderAll(); toast(t('newDone'));
}
function makeDefaultDoc(){
  doc = { version:3, name:t('untitled'), settings:defaultSettings(), pages:[newPage()] };
  doc.pages[0].layers[0].panels = layoutPolys(TEMPLATES[9].n, innerRect(doc.pages[0]), doc.settings.gutter).map(pts => makePanel(pts));
  doc.pages[0].layers[0].tpl = { i:9, sig:panelSig(doc.pages[0].layers[0]) };
  return doc;
}
async function renameProject(){
  const r = await modal({ title:t('rename'), body:`<div class="fgrid"><span>${t('projName')}</span><input type="text" name="name" value="${esc(doc.name || '')}"></div>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('ok'), value:1, cls:'primary' }] });
  if (!r.value) return;
  doc.name = r.form.name.trim() || t('untitled'); commit(); renderSide();
}

/* ================= 匯出 ================= */
let exportOpts = { fmt:'pdf', range:'all', scale:'1' };
async function exportDialog(){
  const o = exportOpts, opt = (name, v, label, desc) =>
    `<label class="opt"><input type="radio" name="${name}" value="${v}" ${o[name] === v ? 'checked' : ''}>${label}${desc ? `<small>${desc}</small>` : ''}</label>`;
  const r = await modal({ title:t('exportTitle'), body:`
    <div class="fgrid"><span>${t('format')}</span><div>${opt('fmt','pdf',t('fmtPdf'),t('fmtPdfD'))}${opt('fmt','png',t('fmtPng'),t('fmtPngD'))}${opt('fmt','jpg',t('fmtJpg'),t('fmtJpgD'))}</div></div>
    <div class="fgrid"><span>${t('range')}</span><div>${opt('range','all',t('allPages', doc.pages.length))}${opt('range','cur',t('curPageOnly', ui.page + 1))}</div></div>
    <div class="fgrid"><span>${t('scale')}</span><div><select name="scale">${['1','1.5','2','3'].map(v => `<option ${v === o.scale ? 'selected' : ''} value="${v}">${v}× (${Math.round(doc.settings.w*v)}×${Math.round(doc.settings.h*v)})</option>`).join('')}</select></div></div>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('exportGo'), value:1, cls:'primary' }] });
  if (!r.value) return;
  exportOpts = { ...exportOpts, ...r.form };
  const idxs = exportOpts.range === 'cur' ? [ui.page] : doc.pages.map((_, i) => i);
  const scale = +exportOpts.scale, base = safeName(doc.name);
  try {
    if (exportOpts.fmt === 'pdf') await exportPDF(idxs, scale, base);
    else await exportImages(idxs, scale, base, exportOpts.fmt);
  } catch (err){ closeModal(); if (!isAbort(err)){ console.error(err); toast(t('saveFail', err.message)); } }
}
const pad3 = n => String(n).padStart(3, '0');
async function exportPDF(idxs, scale, base){
  const fname = base + (idxs.length === 1 && doc.pages.length > 1 ? `_p${pad3(idxs[0]+1)}` : '') + '.pdf';
  let handle = null;
  // 先選存檔位置（必須在使用者點擊後立刻呼叫）
  if (window.showSaveFilePicker) handle = await window.showSaveFilePicker({ suggestedName:fname, id:'cps-export', types:[{ description:'PDF', accept:{ 'application/pdf':['.pdf'] } }] });
  busy(t('exportTitle'), t('loadingFonts'), 0); await ensurePageFonts(idxs);
  const S = doc.settings, pw = +(S.w * 72 / 200).toFixed(2), ph = +(S.h * 72 / 200).toFixed(2);
  const pages = [];
  for (let k = 0; k < idxs.length; k++){
    busy(t('exportTitle'), t('exporting', k+1, idxs.length), k / idxs.length * 100);
    const c = await pageToCanvas(doc.pages[idxs[k]], scale);
    const b = await canvasBlob(c, 'image/jpeg', 0.92);
    pages.push({ jpeg:new Uint8Array(await b.arrayBuffer()), w:c.width, h:c.height });
  }
  const pdf = buildPDF(pages, pw, ph);
  if (handle){ const w = await handle.createWritable(); await w.write(pdf); await w.close(); }
  else download(pdf, fname);
  closeModal(); toast(t('exportDone', handle ? handle.name : fname));
}
async function exportImages(idxs, scale, base, fmt){
  const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png', ext = '.' + fmt, folder = base + '_export';
  let dir = null;
  if (hasFS){
    const ok = await modal({ title:t('exportTitle'), body:`<p>${t('exportFolderDesc', esc(folder))}</p>`,
      buttons:[{ label:t('cancel'), value:null }, { label:t('next'), value:1, cls:'primary' }] });
    if (!ok.value) return;
    const picked = await window.showDirectoryPicker({ id:'cps-export', mode:'readwrite' });
    dir = await resolveTargetDir(picked, folder);
  }
  busy(t('exportTitle'), t('loadingFonts'), 0); await ensurePageFonts(idxs);
  for (let k = 0; k < idxs.length; k++){
    busy(t('exportTitle'), t('exporting', k+1, idxs.length), k / idxs.length * 100);
    const c = await pageToCanvas(doc.pages[idxs[k]], scale);
    const b = await canvasBlob(c, type, 0.92), name = `page_${pad3(idxs[k]+1)}${ext}`;
    if (dir) await writeFile(dir, name, b);
    else { download(b, name); await new Promise(r => setTimeout(r, 300)); }
  }
  closeModal(); toast(t('exportDone', dir ? dir.name : idxs.length + ' ' + fmt.toUpperCase()));
}

/* ================= 事件：右側工具列 ================= */
const side = $('#side');
function syncField(f, v){ side.querySelectorAll(`[data-f="${f}"]`).forEach(x => { if (x !== document.activeElement) x.value = v; }); }
const imgOp = fn => () => { const p = selPanel(); if (!p || !p.img) return; pushHistory(); fn(p, assets.get(p.img.a)); commit(); renderStage(); renderSide(); };
const actions = {
  layer: el => setLayer(+el.dataset.l),
  lvis:  el => { const L = curPage().layers[+el.dataset.l]; pushHistory(); L.visible = !L.visible; commit(); renderStage(); renderSide(); },
  llock: el => { const li = +el.dataset.l, L = curPage().layers[li]; pushHistory(); L.locked = !L.locked; if (li === ui.layer) deselect(); commit(); renderStage(); renderSide(); },
  lang:  el => setLang(el.dataset.l),
  tpl:   el => applyTemplate(TEMPLATES[+el.dataset.i]),
  lstyle: el => applyLayoutStyle(el.dataset.k, false),
  lstyleall: () => { const k = layoutStyleOf(curPage()); applyLayoutStyle(k === 'custom' ? 'normal' : k, true); },
  cover: el => applyCover(COVERS[+el.dataset.i]),
  shape: el => addShape(SHAPES[+el.dataset.i]),
  sticker: el => addItem(el.dataset.k),
  tpreset: el => { const tp = TEXT_PRESETS[+el.dataset.i]; addItem('text', { p:tp.p(), r:tp.r }); },
  reseed: () => { const it = selItem(); if (!it) return; pushHistory(); it.p.seed = SEED(); commit(); updateItemDOM(it); },
  bpreset: el => addItem('bubble', {}, bubbleFromPreset(BUBBLE_PRESETS[+el.dataset.i])),
  tadd: () => { const it = selItem(); if (!it) return; pushHistory(); const n = (it.p.tails || []).length;
    it.p.tails = [...(it.p.tails || []), newTail(it, n % 2 ? 0.3 : -0.3, 0.95)]; commit(); updateItemDOM(it); renderSide(); },
  tdel: el => { const it = selItem(); if (!it) return; pushHistory(); it.p.tails.splice(+el.dataset.t, 1); commit(); updateItemDOM(it); renderSide(); },
  tstraight: el => { const it = selItem(), tl = it && it.p.tails[+el.dataset.t]; if (!tl) return; pushHistory(); tl.cx = null; tl.cy = null; commit(); updateItemDOM(it); },
  bfit: () => { const it = selItem(); if (!it) return; pushHistory(); [it.w, it.h] = bubbleFitSize(it); commit(); updateItemDOM(it); },
  fx: el => { const it = selItem(); if (!it || curLayer().locked) return; pushHistory(); it.p = applyFx(it.p, TEXT_FX[+el.dataset.i]); commit(); updateItemDOM(it); renderSide(); },
  splith: () => splitSel('h'), splitv: () => splitSel('v'),
  pdup: dupSel, pdel: deleteSel, vdel: deleteVertex, copyto: copyToPages,
  pfwd: () => reorderSel(1), pback: () => reorderSel(-1), pmove: el => moveSelToLayer(+el.dataset.l),
  imgedit:  () => toggleImgEdit(),
  icover:   imgOp((p, a) => { Object.assign(p.img, fitImg(p, a, 'cover')); p.img.r = 0; }),
  icontain: imgOp((p, a) => { Object.assign(p.img, fitImg(p, a, 'contain')); p.img.r = 0; }),
  iflip:    imgOp(p => { p.img.fx = !p.img.fx; }),
  irm:      imgOp(p => { p.img = null; ui.imgEdit = false; }),
  aimport:  () => $('#fileImg').click(),
  ause: el => { const p = selPanel(), a = assets.get(el.dataset.id); if (!p) return toast(t('selectFirst'));
    if (curLayer().locked) return toast(t('locked')); pushHistory(); setPanelImage(p, a); commit(); renderStage(); renderSide(); },
  adel: async el => { await removeAsset(el.dataset.id); file.dirty = true; updateFileState(); renderSide(); },
  afill: () => {
    const used = new Set(); curPage().layers.forEach(L => L.panels.forEach(p => p.img && used.add(p.img.a)));
    const free = [...assets.values()].sort((a, b) => a.t - b.t).filter(a => !used.has(a.id));
    const empty = curLayer().panels.filter(p => !p.img);
    if (!free.length || !empty.length) return toast(!empty.length ? t('noEmpty') : t('noFree'));
    pushHistory(); empty.forEach((p, i) => free[i] && setPanelImage(p, free[i])); commit(); renderAll();
    toast(t('filled', Math.min(free.length, empty.length)));
  },
  fimport: () => $('#fileFont').click(),
  fdel: async el => { await removeFont(el.dataset.id); file.dirty = true; updateFileState(); renderAll(); },
  pborderall: () => { const S = PS(); pushHistory(); curPage().layers.forEach(L => L.panels.forEach(p => { p.sw = S.stroke; p.sc = S.strokeColor; })); commit(); renderStage(); },
  presetov: () => {
    const pg = curPage(), m0 = PS(pg).margin; pushHistory();
    pg.ov = {}; rescaleMargin(pg, m0, PS(pg).margin); commit(); renderStage(); renderSide();
  },
  setsize: () => {
    const w = Math.round(+$('#pw').value), h = Math.round(+$('#ph').value), S = doc.settings;
    if (!(w >= 200 && h >= 200 && w <= 8000 && h <= 8000)) return toast(t('sizeRange'));
    pushHistory(); const sx = w/S.w, sy = h/S.h, sm = Math.sqrt(sx*sy);
    doc.pages.forEach(pg => pg.layers.forEach(L => {
      L.panels.forEach(p => {
        p.pts = p.pts.map(([x, y]) => [Math.round(x*sx*10)/10, Math.round(y*sy*10)/10]);
        if (p.img){ p.img.cx *= sx; p.img.cy *= sy; p.img.s *= sm; }
      });
      L.items.forEach(it => { it.x *= sx; it.y *= sy; it.w *= sx; it.h *= sy; if (it.k === 'text') it.p.size *= sm; if (it.p.tx != null){ it.p.tx *= sx; it.p.ty *= sy; } });
    }));
    S.w = w; S.h = h; tplThumbCache = null; commit(); fitZoom(); renderAll();
  },
};
side.addEventListener('click', e => {
  const tb = e.target.closest('#tabs button');
  if (tb){ ui.tab = tb.dataset.tab; renderSide(); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (e.target.matches('input, select, textarea')) return;
  e.stopPropagation(); actions[el.dataset.act] && actions[el.dataset.act](el);
});
side.addEventListener('input', e => {
  const el = e.target, f = el.dataset.f; if (!f) return;
  const v = el.type === 'checkbox' ? el.checked : el.value, S = doc.settings, pg = curPage();
  switch (f){
    case 'dim': ui.dimOther = v; renderStage(); return;
    case 'lop': { const L = pg.layers[+el.dataset.l]; gesture('lop' + el.dataset.l); L.opacity = +v; renderStage(); commit(); return; }
    case 'slant': ui.slant = +v; syncField(f, v); return;
    // 全域設定
    case 'margin': case 'gutter': case 'stroke': gesture('s' + f); S[f] = +v; syncField(f, v); if (f === 'margin') renderStage(); commit(); return;
    case 'strokeColor': gesture('s' + f); S[f] = v; commit(); return;
    case 'bg': gesture('sbg'); S.bg = v; renderStage(); commit(); return;
    // 此頁設定
    case 'pkind': pushHistory(); pg.kind = v; if (isCoverFmt(pg)){ toCoverFormat(pg); toast(t('coverFmtOn')); } deselect(); commit(); renderAll(); return;
    case 'pmargin': { gesture('pm' + pg.id); const m0 = PS(pg).margin; pg.ov.margin = +v; rescaleMargin(pg, m0, +v); syncField(f, v); renderStage(); commit(); return; }
    case 'pgutter': gesture('pg' + pg.id); pg.ov.gutter = +v; syncField(f, v); commit(); return;
    case 'pbg': gesture('pb' + pg.id); pg.ov.bg = v; renderStage(); commit(); return;
    case 'pstroke': case 'pstrokec': {
      gesture(f + pg.id);
      if (f === 'pstroke'){ pg.ov.stroke = +v; syncField(f, v); } else pg.ov.strokeColor = v;
      pg.layers.forEach(L => L.panels.forEach(p => { if (p.sw > 0){ if (f === 'pstroke' && +v > 0) p.sw = +v; if (f === 'pstrokec') p.sc = v; } }));
      renderStage(); commit(); return;
    }
  }
  if (curLayer().locked) return toast(t('locked'));
  // 物件屬性
  const it = selItem();
  if (it && f.startsWith('tl:')){
    const [, ti, key] = f.split(':'), tl = it.p.tails && it.p.tails[+ti]; if (!tl) return;
    gesture(f + it.id); tl[key] = key === 'bw' ? +v : v; if (key === 'bw') syncField(f, v);
    updateItemDOM(it); commit(); return;
  }
  if (it && (f.startsWith('ip:') || f.startsWith('ipn:') || f.startsWith('ic:'))){
    const key = f.split(':')[1];
    gesture(f + it.id);
    if (f.startsWith('ic:')){ it[key] = +v; syncField(f, v); }
    else if (f.startsWith('ipn:')){ it.p[key] = v ? side.querySelector(`[data-f="ip:${key}"]`).value : 'none'; }
    else {
      const specs = it.k === 'text' ? [...STK[it.k].fields, ...FX_FIELDS] : STK[it.k].fields;
      const spec = (specs.find(s => s.startsWith(key + ':')) || '').split(':')[1];
      if (spec === 'colorn' && it.p[key] === 'none') return;
      it.p[key] = spec === 'num' ? +v : spec === 'weight' ? +v : v;
      if (spec === 'num') syncField(f, v);
    }
    updateItemDOM(it); commit();
    if (f === 'ip:shape') renderSide();
    return;
  }
  // 格子屬性
  const p = selPanel(); if (!p) return;
  gesture(f + p.id);
  const a = p.img && assets.get(p.img.a);
  switch (f){
    case 'sw': p.sw = +v; syncField(f, v); renderStage(); break;
    case 'sc': p.sc = v; renderStage(); break;
    case 'fillOn': p.fill = v ? (side.querySelector('[data-f="fillc"]').value) : 'none'; renderStage(); break;
    case 'fillc': if (p.fill !== 'none'){ p.fill = v; renderStage(); } break;
    case 'iscale': if (a){ p.img.s = coverScale(p, a) * clamp(+v, 1, 1000) / 100; syncField(f, v); updatePanelDOM(p); } break;
    case 'irot': if (a){ p.img.r = +v; syncField(f, v); updatePanelDOM(p); } break;
  }
  commit();
});
// 記住使用者展開了哪些特效分組
side.addEventListener('toggle', e => { const d = e.target; if (d.classList && d.classList.contains('fxg')) d.open ? ui.fxOpen.add(d.dataset.g) : ui.fxOpen.delete(d.dataset.g); }, true);
side.addEventListener('change', e => {
  if (e.target.id === 'presetSel' && e.target.value !== ''){ const pr = PRESETS[+e.target.value]; $('#pw').value = pr[0]; $('#ph').value = pr[1]; }
});
side.addEventListener('dragstart', e => {
  const el = e.target.closest('.asset'); if (!el) return;
  e.dataTransfer.setData('application/x-comic-asset', el.dataset.id); e.dataTransfer.effectAllowed = 'copy';
});
$('#fileImg').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) await addAsset(f, f.name);
  file.dirty = true; updateFileState(); renderSide(); toast(t('imported', files.length));
});
$('#fileFont').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files){
    try { const ff = await addFontFile(f, f.name); toast(t('fontAdded', ff.name)); }
    catch (err){ console.error(err); toast(t('fontFail')); }
  }
  file.dirty = true; updateFileState(); renderSide();
});

/* ================= 事件：頁面列表 ================= */
const pagesEl = $('#pages');
pagesEl.addEventListener('click', e => {
  const pgEl = e.target.closest('.pg'); if (!pgEl) return;
  const i = +pgEl.dataset.i, act = e.target.closest('[data-pa]')?.dataset.pa;
  if (act === 'del'){
    if (doc.pages.length <= 1) return toast(t('keepOne'));
    pushHistory(); doc.pages.splice(i, 1); ui.page = clamp(ui.page > i ? ui.page - 1 : ui.page, 0, doc.pages.length-1);
    deselect(); commit(); renderAll(); return;
  }
  if (act === 'up' || act === 'down'){
    const j = act === 'up' ? i-1 : i+1; if (j < 0 || j >= doc.pages.length) return;
    pushHistory(); [doc.pages[i], doc.pages[j]] = [doc.pages[j], doc.pages[i]];
    if (ui.page === i) ui.page = j; else if (ui.page === j) ui.page = i;
    commit(); renderAll(); return;
  }
  gotoPage(i);
});
let dragPage = null;
pagesEl.addEventListener('dragstart', e => { const el = e.target.closest('.pg'); if (el){ dragPage = +el.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
pagesEl.addEventListener('dragover', e => { const el = e.target.closest('.pg'); if (el && dragPage != null){ e.preventDefault(); document.querySelectorAll('.pg.dragover').forEach(x => x.classList.remove('dragover')); el.classList.add('dragover'); } });
pagesEl.addEventListener('drop', e => {
  const el = e.target.closest('.pg'); if (!el || dragPage == null) return; e.preventDefault();
  const to = +el.dataset.i, from = dragPage; dragPage = null;
  if (to === from) return renderPages();
  pushHistory(); const cur = doc.pages[ui.page]; const [m] = doc.pages.splice(from, 1); doc.pages.splice(to, 0, m);
  ui.page = doc.pages.indexOf(cur); commit(); renderAll();
});
pagesEl.addEventListener('dragend', () => { dragPage = null; document.querySelectorAll('.pg.dragover').forEach(x => x.classList.remove('dragover')); });
$('#bAddPage').onclick = () => {
  pushHistory(); const np = newPage(), cur = curPage();
  // 新頁面沿用目前這頁的版面樣式（例如滿版無縫）
  if (cur.kind === 'page') STYLE_KEYS.forEach(k => { if (cur.ov && cur.ov[k] != null) np.ov[k] = cur.ov[k]; });
  doc.pages.splice(ui.page + 1, 0, np); commit(); gotoPage(ui.page + 1);
};
$('#bDupPage').onclick = () => {
  pushHistory(); const c = JSON.parse(JSON.stringify(curPage())); c.id = uid();
  c.layers.forEach(L => { L.panels.forEach(p => p.id = uid()); L.items.forEach(it => it.id = uid()); });
  doc.pages.splice(ui.page + 1, 0, c); commit(); gotoPage(ui.page + 1);
};

/* ================= 事件：頂部選單 / 鍵盤 ================= */
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#tSelect').onclick = () => setTool('select'); $('#tKnife').onclick = () => setTool('knife');
$('#bZoomIn').onclick = () => setZoom(ui.zoom * 1.2); $('#bZoomOut').onclick = () => setZoom(ui.zoom / 1.2);
$('#bSnap').onclick = () => setSnap(!snapOn); $('#bSnap').classList.toggle('on', snapOn);
$('#bFit').onclick = fitZoom; $('#bExport').onclick = exportDialog;
$('#bPreview').onclick = () => openPreview();

/* ================= 預覽：黑底浮窗，所有頁面由上往下接著看 =================
   用匯出的同一套繪圖（看到的就是成品），逐頁畫成圖片；從目前編輯的頁面開始。 */
let pv = null;     // { el, urls, cancel }
async function openPreview(){
  if (pv) return;
  const S = doc.settings, dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = Math.min(1.5, 1300 * dpr / S.w);           // 預覽解析度：夠清楚但不會太吃記憶體
  let w = 0; try { w = +localStorage.getItem('cps-pvw') || 0; } catch {}
  if (!w) w = Math.min(900, window.innerWidth - 120);
  let gap = true; try { gap = localStorage.getItem('cps-pvgap') !== '0'; } catch {}
  const el = document.createElement('div'); el.id = 'preview';
  el.innerHTML = `<div class="pvbar"><b>${t('preview')}</b><span class="pvst"></span><span class="grow"></span>
      <label class="chk"><input type="checkbox" id="pvGap" ${gap ? 'checked' : ''}>${t('pvGap')}</label>
      <button id="pvSmaller" title="${t('pvSmaller')}">－</button><span id="pvW"></span><button id="pvBigger" title="${t('pvBigger')}">＋</button>
      <button id="pvClose">✕ ${t('pvClose')}</button></div>
    <div class="pvscroll"><div class="pvpages${gap ? '' : ' gapless'}">${doc.pages.map((pg, i) =>
      `<div class="pvpage" data-i="${i}" style="aspect-ratio:${S.w}/${S.h}" title="${t('pvJump')}"><span class="pvn">${t('pageN', i + 1)}${pg.kind !== 'page' ? ' · ' + t('kind_' + pg.kind) : ''}</span></div>`).join('')}</div></div>`;
  document.body.appendChild(el);
  pv = { el, urls:[], cancel:false };
  const pages = $('.pvpages', el), sc = $('.pvscroll', el), st = $('.pvst', el);
  const setW = v => { w = clamp(Math.round(v), 240, 3000); pages.style.setProperty('--pvw', w + 'px'); $('#pvW').textContent = Math.round(w / S.w * 100) + '%'; try { localStorage.setItem('cps-pvw', w); } catch {} };
  // 縮放時保持目前看的位置
  const zoomBy = f => { const r = sc.scrollTop / (sc.scrollHeight || 1); setW(w * f); sc.scrollTop = r * sc.scrollHeight; };
  setW(w);
  $('#pvSmaller').onclick = () => zoomBy(1/1.15); $('#pvBigger').onclick = () => zoomBy(1.15);
  $('#pvGap').onchange = e => { pages.classList.toggle('gapless', !e.target.checked); try { localStorage.setItem('cps-pvgap', e.target.checked ? '1' : '0'); } catch {} };
  $('#pvClose').onclick = closePreview;
  pages.addEventListener('dblclick', e => { const p = e.target.closest('.pvpage'); if (p){ closePreview(); gotoPage(+p.dataset.i); } });
  // 從目前編輯的頁面開始看
  requestAnimationFrame(() => { const cur = pages.children[ui.page]; if (cur) sc.scrollTop = cur.offsetTop - 20; });
  // 先畫目前這頁，再往後、往前
  const order = [...doc.pages.keys()].sort((a, b) => (a < ui.page) - (b < ui.page) || (a < ui.page ? b - a : a - b));
  st.textContent = t('loadingFonts');
  await ensurePageFonts(order);
  let done = 0;
  for (const i of order){
    if (!pv || pv.cancel) return;
    st.textContent = t('pvRendering', ++done, order.length);
    const c = await pageToCanvas(doc.pages[i], scale);
    const blob = await canvasBlob(c, 'image/jpeg', 0.9);
    if (!pv || pv.cancel) return;
    const url = URL.createObjectURL(blob); pv.urls.push(url);
    const img = new Image(); img.src = url; img.alt = ''; img.draggable = false;
    pages.children[i].appendChild(img);
  }
  st.textContent = t('pvDone', doc.pages.length);
}
function closePreview(){
  if (!pv) return;
  pv.cancel = true; pv.urls.forEach(u => URL.revokeObjectURL(u)); pv.el.remove(); pv = null;
}
$('#bLang').onclick = () => setLang(LANG === 'zh' ? 'en' : 'zh');
$('#projName').onclick = renameProject;
const fileMenu = $('#fileMenu');
$('#bFile').onclick = e => { e.stopPropagation(); fileMenu.classList.toggle('open'); };
document.addEventListener('click', () => fileMenu.classList.remove('open'));
const menuActs = { new:newProject, open:openProjectFolder, openjson:async () => { if (await confirmDiscard()) $('#fileProj').click(); },
                   save:saveProject, saveas:saveProjectAs, export:exportDialog };
fileMenu.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; fileMenu.classList.remove('open'); menuActs[b.dataset.m](); });

/* ================= 字體選擇器（滑過即預覽、點擊套用） ================= */
const fontPop = document.createElement('div'); fontPop.id = 'fontPop'; document.body.appendChild(fontPop);
let fp = null;   // { it, key, orig, idx, opts, sample }
function sampleText(it){
  const s = String(it.p.text || it.p.heading || it.p.circle || it.p.label || '').replace(/\n/g, ' ').trim();
  return (s || '漫畫 Aa').slice(0, 10);
}
const loadFontFor = (v, text, weight = 400) => document.fonts.load(`${weight} 40px ${fontStack(v)}`, text || 'A').catch(() => {});
function openFontPicker(btn){
  const it = selItem(); if (!it) return;
  const key = btn.dataset.key, cur = it.p[key], sample = sampleText(it), opts = [];
  const groups = ['tc','jp','en'].map(g => [t('fg_' + g), FONTS.filter(f => f[3] === g).map(f => [f[0], LANG === 'zh' ? f[1] : f[2]])]);
  if (customFonts.size) groups.push([t('fg_custom'), [...customFonts.values()].map(f => ['cf:' + f.id, f.name])]);
  // 字體名稱用介面字體顯示；右邊的範例字等那一行捲到看得見時才換成該字體（才不會一次下載全部字體）
  fontPop.innerHTML = groups.map(([g, list]) => `<div class="fg">${g}</div>` + list.map(([v, l]) => { opts.push(v);
    return `<div class="fo${v === cur ? ' on hl' : ''}" data-v="${esc(v)}"><span class="fl">${esc(l)}</span><small class="fs">${esc(sample)}</small></div>`; }).join('')).join('');
  fontPop.style.display = 'block';
  const r = btn.getBoundingClientRect(), ph = fontPop.offsetHeight;
  fontPop.style.left = Math.min(r.left, window.innerWidth - fontPop.offsetWidth - 8) + 'px';
  fontPop.style.top = (r.bottom + 4 + ph > window.innerHeight - 8 ? Math.max(8, window.innerHeight - ph - 8) : r.bottom + 4) + 'px';
  fp = { it, key, orig:cur, idx:opts.indexOf(cur), opts, sample, loaded:new Set([cur]) };
  fontPop.querySelector('.fo.on')?.scrollIntoView({ block:'center' });
  if (fpObserver) fpObserver.disconnect();
  fpObserver = new IntersectionObserver(ents => ents.forEach(en => {
    if (!en.isIntersecting) return;
    const row = en.target, v = row.dataset.v, sm = row.querySelector('.fs');
    fpObserver.unobserve(row);
    sm.style.fontFamily = fontStack(v);
    row.classList.add('loading');
    loadFontFor(v, sample).then(() => { row.classList.remove('loading'); if (fp) fp.loaded.add(v); });
  }), { root:fontPop });
  fontPop.querySelectorAll('.fo').forEach(row => fpObserver.observe(row));
}
let fpObserver = null;
function previewFont(v){
  if (!fp) return;
  const it = fp.it, key = fp.key, row = fontPop.querySelector(`.fo[data-v="${CSS.escape(v)}"]`);
  it.p[key] = v; updateItemDOM(it);
  fontPop.querySelectorAll('.fo').forEach(el => el.classList.toggle('hl', el.dataset.v === v));
  // 這個字體的字形還沒下載完：顯示「載入中」，下載完自動重畫
  const text = String(it.p.text || fp.sample);
  if (!document.fonts.check(`${it.p.weight || 400} 40px ${fontStack(v)}`, text)){
    row && row.classList.add('loading');
    loadFontFor(v, text, it.p.weight).then(() => {
      row && row.classList.remove('loading');
      if (fp && fp.it === it && it.p[key] === v) updateItemDOM(it);
    });
  }
}
function closeFontPicker(commitV){
  if (!fp) return;
  const { it, key, orig } = fp; fp = null; fontPop.style.display = 'none';
  it.p[key] = orig;
  if (commitV != null && commitV !== orig){ pushHistory(); it.p[key] = commitV; commit(); }
  updateItemDOM(it); renderSide();
  loadFontFor(it.p[key], String(it.p.text || ''), it.p.weight).then(() => { if (curLayer().items.includes(it)) updateItemDOM(it); });
}
actions.fpick = el => fp ? closeFontPicker(null) : openFontPicker(el);
fontPop.addEventListener('mouseover', e => { const o = e.target.closest('.fo'); if (o && fp){ fp.idx = fp.opts.indexOf(o.dataset.v); previewFont(o.dataset.v); } });
fontPop.addEventListener('mouseleave', () => { if (fp){ fp.idx = fp.opts.indexOf(fp.orig); previewFont(fp.orig); } });
fontPop.addEventListener('click', e => { const o = e.target.closest('.fo'); if (o) closeFontPicker(o.dataset.v); });
document.addEventListener('pointerdown', e => {
  if (fp && !fontPop.contains(e.target) && !e.target.closest('[data-act="fpick"]')) closeFontPicker(null);
}, true);

document.addEventListener('keydown', e => {
  if (pv){ if (e.key === 'Escape'){ e.preventDefault(); closePreview(); } return; }
  if (fp){
    // 字體清單開著：上下鍵即時預覽、Enter 套用、Esc 取消
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      fp.idx = clamp(fp.idx + (e.key === 'ArrowDown' ? 1 : -1), 0, fp.opts.length - 1);
      const v = fp.opts[fp.idx]; previewFont(v);
      fontPop.querySelector(`.fo[data-v="${CSS.escape(v)}"]`)?.scrollIntoView({ block:'nearest' });
    } else if (e.key === 'Enter'){ e.preventDefault(); closeFontPicker(fp.opts[fp.idx]); }
    else if (e.key === 'Escape'){ e.preventDefault(); closeFontPicker(null); }
    return;
  }
  if (isModalOpen()){ if (e.key === 'Escape' && modalResolve) closeModal(null); return; }
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, p = selPanel(), it = selItem();
  if (ctrl && k === 's'){ e.preventDefault(); e.shiftKey ? saveProjectAs() : saveProject(); return; }
  if (ctrl && k === 'o'){ e.preventDefault(); openProjectFolder(); return; }
  if (ctrl && k === 'e'){ e.preventDefault(); exportDialog(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && e.key !== 'Escape') return;
  if (ctrl && k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))){ e.preventDefault(); redo(); return; }
  if (ctrl && k === 'd'){ e.preventDefault(); dupSel(); return; }
  if (ctrl) return;
  if (k === ' '){ if (!spaceDown){ spaceDown = true; work.classList.add('space'); } e.preventDefault(); return; }
  if (k === 'v') setTool('select');
  else if (k === 'k') setTool('knife');
  else if (k === 'p') openPreview();
  else if (k === 'l'){ const ls = visibleLayers(); setLayer(ls[(ls.indexOf(ui.layer) + 1) % ls.length]); }
  else if (k === '0') fitZoom();
  else if (k === 'enter'){ if (p && p.img) toggleImgEdit(); }
  else if (k === 'escape'){
    fileMenu.classList.remove('open');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (ui.tool === 'knife') setTool('select');
    else if (ui.imgEdit) toggleImgEdit(false);
    else if (ui.sel){ deselect(); renderStage(); renderSide(); }
  }
  else if (k === 'delete' || k === 'backspace'){ e.preventDefault(); if (ui.selV != null && !ui.imgEdit && p && p.pts.length > 3) deleteVertex(); else if (!ui.imgEdit) deleteSel(); }
  else if (k === 'pageup') gotoPage(ui.page - 1);
  else if (k === 'pagedown') gotoPage(ui.page + 1);
  else if (k.startsWith('arrow') && (p || it) && !curLayer().locked){
    e.preventDefault(); gesture('nudge' + ui.sel);
    const d = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
    if (it){ it.x += dx; it.y += dy; updateItemDOM(it); }
    else if (ui.imgEdit){ p.img.cx += dx; p.img.cy += dy; updatePanelDOM(p); }
    else if (ui.selV != null){ p.pts[ui.selV] = [p.pts[ui.selV][0] + dx, p.pts[ui.selV][1] + dy]; updatePanelDOM(p); }
    else { p.pts = p.pts.map(v => [v[0]+dx, v[1]+dy]); if (p.img){ p.img.cx += dx; p.img.cy += dy; } updatePanelDOM(p); }
    commit();
  }
});
document.addEventListener('keyup', e => { if (e.key === ' '){ spaceDown = false; work.classList.remove('space'); } });
window.addEventListener('resize', () => sizeStage());

let toastTimer = null;
function toast(msg){ const el = $('#toast'); el.textContent = msg; el.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.opacity = 0, 2000); }

/* ================= 啟動 ================= */
(async function init(){
  applyStatic();
  loadWebFonts();
  try {
    db = await openDB();
    const recs = await tx('assets', 'readonly', s => s.getAll()) || [];
    for (const r of recs){ r.url = URL.createObjectURL(r.blob); assets.set(r.id, r); }
    const frecs = await tx('fonts', 'readonly', s => s.getAll()) || [];
    for (const f of frecs){ try { await registerFont(f); } catch (e) { console.warn('font', f.name, e); } }
    const saved = await tx('kv', 'readonly', s => s.get('doc'));
    const meta = await tx('kv', 'readonly', s => s.get('file'));
    if (saved && saved.pages && saved.pages.length){
      doc = normalizeDoc(saved); doc.name = doc.name || t('untitled');
      if (meta){ file.dir = meta.dir || null; file.dirName = meta.dirName || ''; file.dirty = !!meta.dirty; }
    } else makeDefaultDoc();
  } catch (err){
    console.error(err); makeDefaultDoc();
  }
  renderAll(); fitZoom();
})();
