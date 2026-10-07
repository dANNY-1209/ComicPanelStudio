'use strict';
/* ================= 內建圖案（全部是向量 + 可編輯文字） =================
   每個定義：
     cat     分類（text / bubble / age / cover / back / deco）
     name    [中文, 英文]
     size    (W,H) => [w,h]  以頁面尺寸決定預設大小
     uniform 縮放時保持比例
     edgeHit 只有邊緣可點選（滿版物件用，避免擋住下面的格子）
     tail    有可拖曳的尾巴
     props   () => 預設屬性
     fields  屬性面板：'key:type[:min:max:step]'，type = text/area/color/colorn/num/bool/font/weight/align
     draw    (it) => primitives，座標以物件中心為原點，範圍 ±w/2, ±h/2 */
const P = (d, fill, stroke, sw, extra) => ({ t:'path', d, fill, stroke, sw, ...extra });
const T = (text, x, y, o) => ({ t:'text', text, x, y, ...o });
const SEED = () => Math.floor(Math.random() * 1e9);

/* ---------- 對話框共用 ----------
   對話框物件 k:'bubble'
   p.shape：oval 橢圓 / round 圓角 / rect 方框 / cloud 思考雲 / spiky 吶喊 / wavy 顫抖 / hexagon 六角 / tech 切角
   p.tails：尾巴陣列，每個尾巴 { tx, ty（尖端）, cx, cy（彎曲控制點，null = 直的）, bw（根部寬度比例）, style:'tri'|'dots' }
   座標都是以對話框中心為原點的本地座標 */
const BUBBLE_SHAPES = ['oval','round','rect','cloud','spiky','wavy','hexagon','tech'];
const bubbleProps = () => ({ shape:'oval', text:t('s_dialog'), font:DEFAULT_FONT, size:40, weight:400, color:'#111111', align:'center', dir:'auto', wrap:true, lh:1.3,
  bg:'#ffffff', line:'#111111', lw:4, dash:false, double:false, rr:30, spikes:14, depth:0.28, bumps:11, seed:SEED(), tails:[] });
function bubbleShapeD(p, w, h){
  const m = Math.min(w, h);
  switch (p.shape){
    case 'round':   return rectD(-w/2, -h/2, w, h, m * (p.rr ?? 30) / 100);
    case 'rect':    return rectD(-w/2, -h/2, w, h, 0);
    case 'cloud':   return cloudD(w/2, h/2, Math.round(p.bumps || 11));
    case 'spiky':   return polyD(spikyPts(w/2, h/2, Math.round(p.spikes || 14), 1 - (p.depth ?? 0.28), seeded(p.seed)));
    case 'wavy': {
      const rnd = seeded(p.seed), pts = [];
      for (let i = 0; i < 48; i++){ const a = i/48*Math.PI*2, k = 1 - rnd()*0.06; pts.push([Math.cos(a)*w/2*k, Math.sin(a)*h/2*k]); }
      return polyD(pts);
    }
    case 'hexagon': { const c = Math.min(w*0.25, h*0.5); return polyD([[-w/2 + c, -h/2], [w/2 - c, -h/2], [w/2, 0], [w/2 - c, h/2], [-w/2 + c, h/2], [-w/2, 0]]); }
    case 'tech':    { const c = m*0.18; return polyD([[-w/2 + c, -h/2], [w/2 - c, -h/2], [w/2, -h/2 + c], [w/2, h/2 - c], [w/2 - c, h/2], [-w/2 + c, h/2], [-w/2, h/2 - c], [-w/2, -h/2 + c]]); }
    default:        return ellD(0, 0, w/2, h/2);
  }
}
// 尾巴的根部：從中心往控制點方向，落在橢圓邊緣稍微內側（被框的填色蓋住，所以看起來是從框長出來）
/* ---------- 尾巴與框的接合 ----------
   先算出框的實際外形（多邊形），找出尾巴從哪裡穿出框，
   再沿著外框往兩側各取一段當尾巴根部的兩個點 → 根部一定貼在框的邊上，不會有翹起來的角。 */
function bodyPoly(p, w, h){
  const m = Math.min(w, h), ell = (rx, ry, n = 120) => Array.from({ length:n }, (_, i) => { const a = i/n*Math.PI*2; return [Math.cos(a)*rx, Math.sin(a)*ry]; });
  switch (p.shape){
    case 'rect':    return [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]];
    case 'round': {
      const r = Math.min(m * (p.rr ?? 30) / 100, w/2, h/2), pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++){ const a = (a0 + i*90/8) * Math.PI/180; pts.push([cx + Math.cos(a)*r, cy + Math.sin(a)*r]); } };
      arc(w/2 - r, -h/2 + r, -90); arc(w/2 - r, h/2 - r, 0); arc(-w/2 + r, h/2 - r, 90); arc(-w/2 + r, -h/2 + r, 180);
      return pts;
    }
    case 'cloud':   return ell(w/2*0.97, h/2*0.97);
    case 'spiky':   return spikyPts(w/2, h/2, Math.round(p.spikes || 14), 1 - (p.depth ?? 0.28), seeded(p.seed));
    case 'wavy': {
      const rnd = seeded(p.seed), pts = [];
      for (let i = 0; i < 48; i++){ const a = i/48*Math.PI*2, k = 1 - rnd()*0.06; pts.push([Math.cos(a)*w/2*k, Math.sin(a)*h/2*k]); }
      return pts;
    }
    case 'hexagon': { const q = Math.min(w*0.25, h*0.5); return [[-w/2 + q, -h/2], [w/2 - q, -h/2], [w/2, 0], [w/2 - q, h/2], [-w/2 + q, h/2], [-w/2, 0]]; }
    case 'tech':    { const q = m*0.18; return [[-w/2 + q, -h/2], [w/2 - q, -h/2], [w/2, -h/2 + q], [w/2, h/2 - q], [w/2 - q, h/2], [-w/2 + q, h/2], [-w/2, h/2 - q], [-w/2, -h/2 + q]]; }
    default:        return ell(w/2, h/2);
  }
}
// 沿著外框走：累積長度、取某個位置的點
function perimeter(pts){ const cum = [0]; for (let i = 0; i < pts.length; i++){ const a = pts[i], b = pts[(i + 1) % pts.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); } return cum; }
function pointAtLen(pts, cum, s){
  const T = cum[cum.length - 1]; s = ((s % T) + T) % T;
  let i = 0; while (i < pts.length - 1 && cum[i + 1] < s) i++;
  const a = pts[i], b = pts[(i + 1) % pts.length], seg = (cum[i + 1] - cum[i]) || 1, u = (s - cum[i]) / seg;
  return [a[0] + (b[0] - a[0])*u, a[1] + (b[1] - a[1])*u];
}
// 從中心往 (dx,dy) 方向的射線，和外框最遠的交點（星形這種凹多邊形取最外側）
function rayHit(pts, cum, dx, dy){
  let best = null;
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx*ey - dy*ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (a[0]*ey - a[1]*ex) / den, u = (a[0]*dy - a[1]*dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && (!best || t > best.t)) best = { t, pt:[dx*t, dy*t], s:cum[i] + u*Math.hypot(ex, ey) };
  }
  return best;
}
function tailGeom(it, tl){
  const p = it.p, cxs = tl.cx ?? null, cys = tl.cy ?? null;
  const dirx = cxs != null ? cxs : tl.tx, diry = cys != null ? cys : tl.ty, L = Math.hypot(dirx, diry);
  // 尖端剛好在中心（例如 Alt 拖出的第一瞬間）時先朝下，避免方向算不出來
  const ux = L > 1e-6 ? dirx/L : 0, uy = L > 1e-6 ? diry/L : 1;
  const P = bodyPoly(p, it.w, it.h), cum = perimeter(P), hit = rayHit(P, cum, ux, uy) || { pt:[ux*it.w/2, uy*it.h/2], s:0 };
  const [ex, ey] = hit.pt;
  return { ex, ey, s:hit.s, P, cum, cx:cxs != null ? cxs : (ex + tl.tx)/2, cy:cys != null ? cys : (ey + tl.ty)/2 };
}
function tailPath(it, tl){
  const g = tailGeom(it, tl), { ex, ey, cx, cy } = g, bw = Math.min(it.w, it.h) * (tl.bw ?? 0.12);
  // 根部兩點：沿著外框往兩側各走 bw → 一定落在框的邊上
  const b1 = pointAtLen(g.P, g.cum, g.s - bw), b2 = pointAtLen(g.P, g.cum, g.s + bw);
  // 收尾點：往中心縮一點，讓尾巴和框的填色重疊（看不出接縫）
  const el = Math.hypot(ex, ey) || 1, ins = Math.min(el*0.5, bw*1.5), I = [ex - ex/el*ins, ey - ey/el*ins];
  // 彎曲控制點：左右各偏一點，給尾巴寬度；讓靠近 b1 的那一側接 b1
  const dx = tl.tx - ex, dy = tl.ty - ey, d = Math.hypot(dx, dy) || 1, nx = -dy/d, ny = dx/d;
  let c1 = [cx + nx*bw*0.45, cy + ny*bw*0.45], c2 = [cx - nx*bw*0.45, cy - ny*bw*0.45];
  if (Math.hypot(c1[0] - b1[0], c1[1] - b1[1]) > Math.hypot(c2[0] - b1[0], c2[1] - b1[1])) [c1, c2] = [c2, c1];
  return `M${f1(I[0])} ${f1(I[1])}L${f1(b1[0])} ${f1(b1[1])}Q${f1(c1[0])} ${f1(c1[1])} ${f1(tl.tx)} ${f1(tl.ty)}Q${f1(c2[0])} ${f1(c2[1])} ${f1(b2[0])} ${f1(b2[1])}Z`;
}
function tailDots(it, tl){
  const { ex, ey, cx, cy } = tailGeom(it, tl), m = Math.min(it.w, it.h) * (tl.bw ?? 0.12) / 0.12;
  const q = tt => [(1-tt)*(1-tt)*ex + 2*(1-tt)*tt*cx + tt*tt*tl.tx, (1-tt)*(1-tt)*ey + 2*(1-tt)*tt*cy + tt*tt*tl.ty];
  return [[0.38, 0.085], [0.68, 0.06], [0.95, 0.04]].map(([tt, r]) => { const [x, y] = q(tt); return ellD(x, y, m*r, m*r); });
}
/* ---------- 對話框文字：方向與自動換行 ----------
   dir：auto＝框比較瘦長就直書、比較扁寬就橫書；h＝橫書；v＝直書 */
const bubbleVert = it => it.p.dir === 'v' || (it.p.dir !== 'h' && (it.p.dir === 'auto' || it.p.dir == null) && it.h > it.w * 1.05) || (it.p.dir == null && it.p.vert);
// 不能放在行首／列首的標點（避頭點）
const NOSTART = new Set([...'、。，．,.！？!?」』）)】〉》ー…‥～〜ぁぃぅぇぉっゃゅょァィゥェォッャュョ']);
// 各形狀可以放字的內框比例
const BUB_INNER = { oval:[0.68, 0.68], cloud:[0.64, 0.62], spiky:[0.56, 0.56], wavy:[0.66, 0.66], hexagon:[0.66, 0.8], tech:[0.84, 0.8], round:[0.84, 0.8], rect:[0.88, 0.84] };
/* 直書換列（以寬度為優先）：
   1. 先算框的寬度放得下幾列（maxCols）
   2. 列的長度 L 取「放得進 maxCols 列的最短長度」與「框高（或整行長度，取較短）」兩者較大的那個
      → 框夠高時一列寫到底；框太矮時不會切成一堆短列，而是把列拉長
   3. 框的大小不會自動改變（放不下時由使用者自行調整）
   回傳 { text, need }，need 是最長一列的高度 */
function packCols(toks, cap){
  const cols = []; let cur = [], h = 0;
  for (const tk of toks){
    // 換到下一列（標點、「??」這類不放在列首，跟著上一列）
    if (cur.length && h + tk.h > cap + 0.5 && !NOSTART.has(tk.s[0]) && !/^[!?]/.test(tk.s)){ cols.push(cur); cur = []; h = 0; }
    cur.push(tk); h += tk.h;
  }
  if (cur.length || !cols.length) cols.push(cur);
  return cols;
}
const colsH = col => col.reduce((s, tk) => s + tk.h, 0);
function wrapVertical(p, innerW, innerH){
  const size = Math.max(1, +p.size || 12), lh = p.lh || 1.3;
  const lines = String(p.text ?? '').split('\n').map(l => vTokens(l, p));
  const maxCols = Math.max(1, Math.floor((innerW + size*lh*0.3) / (size*lh)));
  const lineHs = lines.map(colsH), longest = Math.max(size, ...lineHs);
  const minTok = Math.max(size, ...lines.flat().map(tk => tk.h));
  const count = L => lines.reduce((n, ts) => n + packCols(ts, L).length, 0);
  // 找出放得進 maxCols 列的最短列長（二分搜尋）
  let lo = minTok, hi = Math.max(minTok, longest), Lw = hi;
  if (count(hi) <= maxCols){ while (hi - lo > 1){ const mid = (lo + hi)/2; if (count(mid) <= maxCols) hi = mid; else lo = mid; } Lw = hi; }
  const L = Math.max(Lw, Math.min(innerH, longest), minTok);
  const cols = lines.flatMap(ts => ts.length ? packCols(ts, L) : [[]]);
  return { text:cols.map(col => col.map(tk => tk.s).join('')).join('\n'), need:Math.max(size, ...cols.map(col => Math.min(colsH(col), L))) };   // 列尾懸掛的標點不算進需要的高度，免得框被誤判太矮而長高
}
function wrapBubbleText(p, vert, innerW, innerH){
  if (vert) return wrapVertical(p, innerW, innerH);
  const out = [], size = Math.max(1, +p.size || 12), lh = p.lh || 1.3;
  for (const line of String(p.text ?? '').split('\n')){
    const ch = [...line];
    if (!ch.length){ out.push(''); continue; }
    {
      mctx.font = fontStr(p); if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
      let cur = '';
      for (const c of ch){
        if (cur && mctx.measureText(cur + c).width > innerW && !NOSTART.has(c)){ out.push(cur); cur = c; }
        else cur += c;
      }
      out.push(cur);
    }
  }
  return { text:out.join('\n'), need:out.length * size * lh };
}
function bubText(p, it, noWrap){
  const vert = it ? bubbleVert(it) : !!p.vert;
  let text = p.text;
  if (it && p.wrap !== false && !noWrap){ const k = BUB_INNER[p.shape] || [0.7, 0.7]; text = wrapBubbleText(p, vert, it.w*k[0], it.h*k[1]).text; }
  return T(text, 0, 0, { font:p.font, size:p.size, weight:p.weight, fill:p.color, vert, lh:p.lh, align:p.align, cols:p.cols });
}
// 依文字大小，算出每種形狀需要的框大小
/* 依文字算出好看的框大小：
   直書 → 試 1～12 列，挑「高約為寬的 1.7 倍」的那一種；橫書 → 試 1～12 行，挑「寬約為高的 1.6 倍」的那一種。
   換行用的規則和畫面上一樣，所以算出來的框剛好裝得下。 */
function bubbleFitSize(it){
  const p = it.p, k = BUB_INNER[p.shape] || [0.7, 0.7], size = +p.size || 12, lh = p.lh || 1.3, pad = size * 0.9;
  const vert = bubbleVert(it), best = { score:Infinity, w:it.w, h:it.h };
  const consider = (w, h, target) => { const s = Math.abs(Math.log((h / w) / target)); if (s < best.score) Object.assign(best, { score:s, w, h }); };
  if (vert){
    const lines = String(p.text ?? '').split('\n').map(l => vTokens(l, p));
    const total = lines.reduce((s, ts) => s + colsH(ts), 0), minTok = Math.max(size, ...lines.flat().map(tk => tk.h));
    for (let n = 1; n <= 12; n++){
      const L = Math.max(minTok, total / n), cols = lines.flatMap(ts => ts.length ? packCols(ts, L) : [[]]);
      const need = Math.max(size, ...cols.map(col => Math.min(colsH(col), L)));
      consider(cols.length * size * lh / k[0] + pad, need / k[1] + pad, 1.7);
    }
  } else {
    mctx.font = fontStr(p); if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
    const lines = String(p.text ?? '').split('\n'), widest = Math.max(size, ...lines.map(l => mctx.measureText(l).width));
    for (let n = 1; n <= 12; n++){
      const target = Math.max(size * 2, widest / n), r = wrapBubbleText(p, false, target, Infinity), rows = r.text.split('\n');
      const w = Math.max(...rows.map(l => mctx.measureText(l).width));
      consider(w / k[0] + pad, rows.length * size * lh / k[1] + pad, 1 / 1.6);
    }
  }
  return [Math.round(best.w), Math.round(best.h)];
}
// 聯集外框技巧：先畫兩倍寬的描邊，再用填色蓋掉內側 → 多個形狀看起來是同一個輪廓
function unionShapes(ds, p, dash){
  const out = [];
  ds.forEach(d => out.push(P(d, 'none', p.line, p.lw * 2, dash ? { dash } : {})));
  ds.forEach(d => out.push(P(d, p.bg)));
  return out;
}
function cloudD(rx, ry, n){
  const pts = []; for (let i = 0; i < n; i++){ const a = i / n * Math.PI * 2; pts.push([Math.cos(a)*rx*0.92, Math.sin(a)*ry*0.92]); }
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i <= n; i++){ const a = pts[i-1], b = pts[i % n], r = Math.hypot(b[0]-a[0], b[1]-a[1]) * 0.62; d += `A${f1(r)} ${f1(r)} 0 0 1 ${f1(b[0])} ${f1(b[1])}`; }
  return d + 'Z';
}
function spikyPts(rx, ry, n, inner, rnd, jit = 0.18){
  const pts = [];
  for (let i = 0; i < n * 2; i++){
    const a = i / (n*2) * Math.PI * 2 - Math.PI/2 + (rnd() - 0.5) * 0.12, k = i % 2 ? inner * (1 - rnd()*0.08) : 1 - rnd() * jit;
    pts.push([Math.cos(a)*rx*k, Math.sin(a)*ry*k]);
  }
  return pts;
}
// 圓形徽章共用
function badgeCircle(it, w){
  const p = it.p, r = w/2;
  return [P(ellD(0, 0, r, r), p.color), P(ellD(0, 0, r*0.84, r*0.84), 'none', p.fg, r*0.06),
          T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, r*1.45, r*1.45, 0.62), weight:900, fill:p.fg, lh:1.05 })];
}

const STK = {
  /* ---------- 文字 ---------- */
  text: { cat:'text', name:['文字','Text'], size:() => [0, 0],
    props: () => ({ text:t('s_dialog'), font:DEFAULT_FONT, size:48, weight:400, fill:'#111111', stroke:'#ffffff', sw:0, align:'center', vert:false, lh:1.25, ls:0, ...FX_DEFAULTS }),
    fields: ['text:area','font:font','size:num:8:600','weight:weight','fill:color','align:align','vert:bool','cols:select:rtl|ltr','lh:num:0.8:3:0.05','ls:num:-20:120'],
    draw: it => [{ t:'text', x:0, y:0, ...it.p }] },

  /* ---------- 對話框（一個物件，形狀可隨時切換；尾巴可加多個或不加） ---------- */
  bubble: { cat:'bubble', name:['對話框','Speech bubble'], size:W => [W*0.3, W*0.2], tails:true, props:bubbleProps,
    fields: ['shape:select:' + BUBBLE_SHAPES.join('|'), 'text:area', 'dir:select:auto|h|v', 'cols:select:rtl|ltr', 'wrap:bool', 'font:font', 'size:num:10:300', 'weight:weight', 'color:color', 'align:align', 'lh:num:0.8:3:0.05',
             'bg:color', 'line:color', 'lw:num:0:30', 'dash:bool', 'double:bool', 'rr:num:0:50', 'spikes:num:6:40', 'depth:num:0.05:0.6:0.01', 'bumps:num:5:24'],
    // 只顯示目前形狀用得到的欄位
    fieldsFor: it => STK.bubble.fields.filter(s => {
      const k = s.split(':')[0], sh = it.p.shape;
      return !(k === 'rr' && sh !== 'round') && !((k === 'spikes' || k === 'depth') && sh !== 'spiky') && !(k === 'bumps' && sh !== 'cloud');
    }),
    draw: it => {
      const p = it.p, w = it.w, h = it.h, tails = p.tails || [];
      const dash = p.dash ? `${Math.max(2, p.lw*3)} ${Math.max(2, p.lw*2)}` : null;
      const ds = [bubbleShapeD(p, w, h), ...tails.filter(tl => tl.style !== 'dots').map(tl => tailPath(it, tl))];
      const out = p.lw > 0 ? unionShapes(ds, p, dash) : ds.map(d => P(d, p.bg));
      tails.filter(tl => tl.style === 'dots').forEach(tl => tailDots(it, tl).forEach(d => out.push(P(d, p.bg, p.line, p.lw, dash ? { dash } : {}))));
      if (p.double && p.lw > 0){ const g = Math.max(p.lw * 2.5, Math.min(w, h) * 0.04); out.push(P(bubbleShapeD(p, Math.max(10, w - 2*g), Math.max(10, h - 2*g)), 'none', p.line, Math.max(1, p.lw * 0.6))); }
      out.push(bubText(p, it));
      return out;
    } },

  /* ---------- 年齡標示 ---------- */
  r18c: { cat:'age', name:['R18 圓標','R18 circle'], size:W => [W*0.14, W*0.14], uniform:true,
    props: () => ({ text:'R18', color:'#e60012', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => badgeCircle(it, it.w) },
  r18sq: { cat:'age', name:['18禁 方標','18+ square'], size:W => [W*0.13, W*0.13], uniform:true,
    props: () => ({ text:LANG === 'zh' ? '18禁' : '18+', color:'#e60012', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(rectD(-w/2, -h/2, w, h, w*0.14), p.color), P(rectD(-w/2*0.86, -h/2*0.86, w*0.86, h*0.86, w*0.1), 'none', p.fg, w*0.03),
              T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, w*0.8, h*0.8, 0.55), weight:900, fill:p.fg })]; } },
  adult: { cat:'age', name:['成人向 方框','Adults only box'], size:W => [W*0.28, W*0.08],
    props: () => ({ text:t('s_adult'), color:'#000000', bg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','bg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(rectD(-w/2, -h/2, w, h, 0), p.bg, p.color, h*0.08), T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, w*0.88, h, 0.62), weight:900, fill:p.color })]; } },
  limit: { cat:'age', name:['限制級 八角','Restricted octagon'], size:W => [W*0.15, W*0.15], uniform:true,
    props: () => ({ text:t('s_limit'), color:'#d7000f', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:area','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, r = it.w/2, oct = k => Array.from({ length:8 }, (_, i) => { const a = Math.PI/8 + i*Math.PI/4; return [Math.cos(a)*r*k, Math.sin(a)*r*k]; });
      return [P(polyD(oct(1)), p.color), P(polyD(oct(0.86)), 'none', p.fg, r*0.05), T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, r*1.4, r*1.4, 0.6), weight:900, fill:p.fg, lh:1.05 })]; } },
  r15: { cat:'age', name:['R15 圓標','R15 circle'], size:W => [W*0.13, W*0.13], uniform:true,
    props: () => ({ text:'R15', color:'#f39800', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => badgeCircle(it, it.w) },
  allage: { cat:'age', name:['全年齡','All ages'], size:W => [W*0.22, W*0.07],
    props: () => ({ text:t('s_allage'), color:'#1a9e55', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(rectD(-w/2, -h/2, w, h, h/2), p.color), T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, w*0.8, h, 0.6), weight:900, fill:p.fg })]; } },
  notice: { cat:'age', name:['成人警語','Adult notice'], size:W => [W*0.8, W*0.2],
    props: () => ({ heading:t('s_noticeH'), body:t('s_noticeB'), color:'#e60012', bg:'#ffffff', fg:'#111111', font:'Noto Sans TC' }),
    fields: ['heading:text','body:area','color:color','bg:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h, hb = h*0.32;
      return [P(rectD(-w/2, -h/2, w, h, 0), p.bg, p.color, h*0.03), P(rectD(-w/2, -h/2, w, hb, 0), p.color),
              T(p.heading, 0, -h/2 + hb/2, { font:p.font, size:fitSize(p.heading, w*0.9, hb, 0.6), weight:900, fill:p.bg }),
              T(p.body, 0, hb/2, { font:p.font, size:fitSize(p.body, w*0.9, h - hb, 0.42), weight:700, fill:p.fg, lh:1.4 })]; } },

  /* ---------- 封面元素 ---------- */
  titlelogo: { cat:'cover', name:['標題 Logo','Title logo'], size:(W, H) => [W*0.9, H*0.15],
    props: () => ({ text:t('s_title'), sub:'', font:'Dela Gothic One', fill:'#ffffff', in:'#e60012', out:'#111111', vert:false }),
    fields: ['text:text','sub:text','font:font','fill:color','in:color','out:color','vert:bool'],
    draw: it => { const p = it.p, w = it.w, h = it.h, hasSub = !!p.sub;
      const s = fitSize(p.text, p.vert ? w : w, hasSub && !p.vert ? h*0.78 : h, 0.8, p.vert), y = hasSub && !p.vert ? -h*0.1 : 0;
      const o = { font:p.font, size:s, weight:900, vert:p.vert, lh:1.1 };
      return [T(p.text, 0, y, { ...o, fill:p.out, stroke:p.out, sw:s*0.34 }), T(p.text, 0, y, { ...o, fill:p.fill, stroke:p.in, sw:s*0.14 }),
              hasSub && !p.vert ? T(p.sub, 0, h*0.4, { font:p.font, size:h*0.15, fill:p.fill, stroke:p.out, sw:h*0.05 }) : null]; } },
  vol: { cat:'cover', name:['集數','Volume'], size:W => [W*0.14, W*0.14], uniform:true,
    props: () => ({ label:'VOL.', num:'01', color:'#111111', fg:'#ffffff', round:false }), fields:['label:text','num:text','color:color','fg:color','round:bool'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(p.round ? ellD(0, 0, w/2, h/2) : rectD(-w/2, -h/2, w, h, w*0.08), p.color),
              T(p.label, 0, -h*0.25, { font:'Oswald', size:h*0.17, weight:700, fill:p.fg, ls:h*0.02 }),
              T(p.num, 0, h*0.1, { font:'Anton', size:fitSize(p.num, w*0.85, h*0.55, 0.95), fill:p.fg })]; } },
  obi: { cat:'cover', name:['書腰','Obi band'], size:(W, H) => [W, H*0.2],
    props: () => ({ text:t('s_tagline'), sub:t('s_byline'), color:'#e60012', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','sub:text','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(rectD(-w/2, -h/2, w, h, 0), p.color), P(`M${f1(-w/2)} ${f1(-h/2 + h*0.06)}H${f1(w/2)}`, 'none', p.fg, h*0.015),
              T(p.text, 0, -h*0.08, { font:p.font, size:fitSize(p.text, w*0.92, h*0.5, 0.75), weight:900, fill:p.fg }),
              T(p.sub, 0, h*0.3, { font:p.font, size:h*0.13, weight:700, fill:p.fg })]; } },
  ribbon: { cat:'cover', name:['角落斜帶','Corner ribbon'], size:W => [W*0.3, W*0.3], uniform:true,
    props: () => ({ text:t('s_new'), color:'#e60012', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h, a = w*0.32, b = w*0.62;
      return [P(polyD([[w/2-b, -h/2], [w/2-a, -h/2], [w/2, -h/2+a], [w/2, -h/2+b]]), p.color),
              T(p.text, w/2 - (a+b)/4, -h/2 + (a+b)/4, { font:p.font, size:fitSize(p.text, (b-a)*1.6, (b-a)*0.7, 0.75), weight:900, fill:p.fg, rot:45 })]; } },
  burst: { cat:'cover', name:['爆炸標','Starburst'], size:W => [W*0.3, W*0.22],
    props: () => ({ text:t('s_hot'), color:'#ffe600', line:'#111111', fg:'#e60012', font:'Dela Gothic One', spikes:16, seed:SEED() }),
    fields: ['text:area','color:color','line:color','fg:color','font:font','spikes:num:6:30'],
    draw: it => { const p = it.p, w = it.w, h = it.h, rnd = seeded(p.seed);
      return [P(polyD(spikyPts(w/2, h/2, p.spikes, 0.7, rnd, 0.12)), p.color, p.line, Math.min(w, h)*0.025),
              T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, w*0.6, h*0.6, 0.7), fill:p.fg, rot:-8, lh:1.05 })]; } },
  tag: { cat:'cover', name:['標籤','Tag'], size:W => [W*0.22, W*0.07],
    props: () => ({ text:t('s_original'), color:'#111111', fg:'#ffffff', font:'Noto Sans TC' }), fields:['text:text','color:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(rectD(-w/2, -h/2, w, h, h/2), p.color), T(p.text, 0, 0, { font:p.font, size:fitSize(p.text, w*0.82, h, 0.58), weight:700, fill:p.fg })]; } },
  circle: { cat:'cover', name:['社團/作者名牌','Circle & author'], size:W => [W*0.42, W*0.14],
    props: () => ({ circle:t('s_circle'), author:t('s_author'), color:'#111111', bg:'#ffffff', font:'Noto Sans TC' }),
    fields: ['circle:text','author:text','color:color','bg:colorn','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [p.bg !== 'none' ? P(rectD(-w/2, -h/2, w, h, h*0.08), p.bg) : null,
              T(p.circle, 0, -h*0.17, { font:p.font, size:fitSize(p.circle, w*0.9, h*0.55, 0.85), weight:900, fill:p.color }),
              P(`M${f1(-w*0.42)} ${f1(h*0.1)}H${f1(w*0.42)}`, 'none', p.color, h*0.025),
              T(p.author, 0, h*0.3, { font:p.font, size:fitSize(p.author, w*0.8, h*0.3, 0.75), weight:700, fill:p.color })]; } },
  event: { cat:'cover', name:['活動新刊標','Event label'], size:W => [W*0.3, W*0.07],
    props: () => ({ event:'EVENT', text:t('s_new'), color:'#e60012', dark:'#111111', fg:'#ffffff', font:'Noto Sans TC' }),
    fields: ['event:text','text:text','color:color','dark:color','fg:color','font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h, lw = w*0.45;
      return [P(rectD(-w/2, -h/2, lw, h, 0), p.dark), P(rectD(-w/2 + lw, -h/2, w - lw, h, 0), p.color),
              T(p.event, -w/2 + lw/2, 0, { font:'Oswald', size:fitSize(p.event, lw*0.85, h, 0.62), weight:700, fill:p.fg }),
              T(p.text, -w/2 + lw + (w-lw)/2, 0, { font:p.font, size:fitSize(p.text, (w-lw)*0.85, h, 0.6), weight:900, fill:p.fg })]; } },
  seal: { cat:'cover', name:['落款印章','Hanko seal'], size:W => [W*0.1, W*0.1], uniform:true,
    props: () => ({ text:t('s_seal'), color:'#c8102e', font:'Zen Antique' }), fields:['text:text','color:color','font:font'],
    draw: it => { const p = it.p, w = it.w, n = Math.max(1, [...p.text].length);
      return [P(rectD(-w/2, -w/2, w, w, w*0.08), p.color), P(rectD(-w*0.42, -w*0.42, w*0.84, w*0.84, w*0.05), 'none', '#ffffff', w*0.03),
              T(p.text, 0, 0, { font:p.font, size:Math.min(w*0.62, w*0.76/n), vert:true, fill:'#ffffff' })]; } },
  frame: { cat:'cover', name:['頁面邊框','Page frame'], size:(W, H) => [W, H], edgeHit:true,
    props: () => ({ color:'#111111', lw:6, inset:40, gap:14, double:true }), fields:['color:color','lw:num:1:40','inset:num:0:300','gap:num:2:80','double:bool'],
    draw: it => { const p = it.p, w = it.w, h = it.h, i = p.inset, j = p.inset + p.gap;
      return [P(rectD(-w/2 + i, -h/2 + i, w - 2*i, h - 2*i, 0), 'none', p.color, p.lw),
              p.double ? P(rectD(-w/2 + j, -h/2 + j, w - 2*j, h - 2*j, 0), 'none', p.color, Math.max(1, p.lw*0.4)) : null]; } },

  /* ---------- 封底元素 ---------- */
  synopsis: { cat:'back', name:['故事簡介','Synopsis box'], size:(W, H) => [W*0.8, H*0.28],
    props: () => ({ heading:t('s_synH'), body:t('s_synB'), size:36, color:'#111111', bg:'#ffffff', bgop:0.88, font:'Noto Sans TC' }),
    fields: ['heading:text','body:area','size:num:12:120','font:font','color:color','bg:color','bgop:num:0:1:0.05'],
    draw: it => { const p = it.p, w = it.w, h = it.h, pad = Math.min(w, h)*0.08, s = p.size;
      return [P(rectD(-w/2, -h/2, w, h, s*0.4), p.bg, null, 0, { op:p.bgop }),
              T(p.heading, -w/2 + pad, -h/2 + pad, { ax:'left', ay:'top', align:'left', font:p.font, size:s*1.35, weight:900, fill:p.color }),
              P(`M${f1(-w/2 + pad)} ${f1(-h/2 + pad + s*1.9)}H${f1(w/2 - pad)}`, 'none', p.color, Math.max(1, s*0.06)),
              T(p.body, -w/2 + pad, -h/2 + pad + s*2.5, { ax:'left', ay:'top', align:'left', font:p.font, size:s, fill:p.color, lh:1.6 })]; } },
  barcode: { cat:'back', name:['條碼（示意）','Barcode (placeholder)'], size:W => [W*0.3, W*0.17],
    props: () => ({ isbn:'ISBN 978-0-000000-00-0', price:t('s_price'), seed:SEED() }), fields:['isbn:text','price:text'],
    draw: it => { const p = it.p, w = it.w, h = it.h, rnd = seeded(p.seed);
      let bits = '101'; for (let i = 0; i < 42; i++) bits += rnd() > 0.5 ? '1' : '0'; bits += '01010'; for (let i = 0; i < 42; i++) bits += rnd() > 0.5 ? '1' : '0'; bits += '101';
      const x0 = -w*0.42, mw = w*0.84 / bits.length, y0 = -h*0.24, y1 = h*0.16, yg = h*0.22;
      const guard = i => i < 3 || (i >= 45 && i < 50) || i >= 92;
      let d = '';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') d += rectD(x0 + i*mw, y0, mw, (guard(i) ? yg : y1) - y0, 0);
      return [P(rectD(-w/2, -h/2, w, h, 0), '#ffffff'), P(d, '#000000'),
              T(p.isbn, 0, -h*0.36, { font:'Oswald', size:h*0.1, fill:'#000000' }),
              T(p.price, 0, h*0.36, { font:'Noto Sans TC', size:h*0.11, weight:700, fill:'#000000' })]; } },
  colophon: { cat:'back', name:['版權頁/奧付','Colophon'], size:(W, H) => [W*0.8, H*0.3],
    props: () => ({ heading:t('s_colH'), body:t('s_colB'), size:30, color:'#111111', font:'Noto Serif TC' }),
    fields: ['heading:text','body:area','size:num:10:100','font:font','color:color'],
    draw: it => { const p = it.p, w = it.w, h = it.h, s = p.size;
      return [T(p.heading, -w/2, -h/2, { ax:'left', ay:'top', align:'left', font:p.font, size:s*1.25, weight:700, fill:p.color }),
              P(`M${f1(-w/2)} ${f1(-h/2 + s*1.9)}H${f1(w/2)}`, 'none', p.color, Math.max(1, s*0.08)),
              T(p.body, -w/2, -h/2 + s*2.5, { ax:'left', ay:'top', align:'left', font:p.font, size:s, fill:p.color, lh:1.7 }),
              P(`M${f1(-w/2)} ${f1(h/2)}H${f1(w/2)}`, 'none', p.color, Math.max(1, s*0.05))]; } },
  logo: { cat:'back', name:['社團 Logo','Circle logo'], size:W => [W*0.1, W*0.1], uniform:true,
    props: () => ({ text:'CPS', sub:'COMICS', color:'#111111', bg:'#ffffff', font:'Cinzel' }), fields:['text:text','sub:text','color:color','bg:color','font:font'],
    draw: it => { const p = it.p, r = it.w/2;
      return [P(ellD(0, 0, r, r), p.bg, p.color, r*0.08), P(ellD(0, 0, r*0.8, r*0.8), 'none', p.color, r*0.025),
              T(p.text, 0, -r*0.08, { font:p.font, size:fitSize(p.text, r*1.3, r*0.9, 0.8), weight:900, fill:p.color }),
              T(p.sub, 0, r*0.42, { font:p.font, size:r*0.16, weight:700, fill:p.color, ls:r*0.03 })]; } },

  /* ---------- 漫畫效果 ---------- */
  focus: { cat:'deco', name:['集中線','Focus lines'], size:(W, H) => [W, H], edgeHit:true,
    props: () => ({ color:'#111111', density:110, inner:0.55, seed:SEED() }), fields:['color:color','density:num:20:300','inner:num:0.1:0.95:0.01'],
    draw: it => { const p = it.p, w = it.w, h = it.h, rnd = seeded(p.seed), R = Math.hypot(w, h), n = p.density;
      let d = '';
      for (let i = 0; i < n; i++){
        const a = (i + rnd()*0.6) / n * Math.PI*2, dw = Math.PI*2 / n * (0.18 + rnd()*0.45), k = p.inner * (0.85 + rnd()*0.45);
        const tip = [Math.cos(a)*w/2*k, Math.sin(a)*h/2*k];
        d += polyD([[Math.cos(a - dw/2)*R, Math.sin(a - dw/2)*R], tip, [Math.cos(a + dw/2)*R, Math.sin(a + dw/2)*R]]);
      }
      return [P(d, p.color)]; } },
  speed: { cat:'deco', name:['速度線','Speed lines'], size:(W, H) => [W*0.9, H*0.3],
    props: () => ({ color:'#111111', density:50, seed:SEED() }), fields:['color:color','density:num:5:200'],
    draw: it => { const p = it.p, w = it.w, h = it.h, rnd = seeded(p.seed);
      let d = '';
      for (let i = 0; i < p.density; i++){
        const y = -h/2 + rnd()*h, th = 1.5 + rnd()*h*0.025, x0 = -w/2 + rnd()*w*0.3, x1 = x0 + w*(0.35 + rnd()*0.65);
        d += polyD([[x0, y - th/2], [Math.min(x1, w/2), y], [x0, y + th/2]]);
      }
      return [P(d, p.color)]; } },
  sparkle: { cat:'deco', name:['閃光','Sparkle'], size:W => [W*0.12, W*0.12], uniform:true,
    props: () => ({ color:'#ffffff', line:'#111111', lw:3 }), fields:['color:color','line:color','lw:num:0:20'],
    draw: it => { const p = it.p, r = it.w/2, q = r*0.16;
      return [P(polyD([[0, -r], [q, -q], [r, 0], [q, q], [0, r], [-q, q], [-r, 0], [-q, -q]]), p.color, p.line, p.lw)]; } },
  heart: { cat:'deco', name:['愛心','Heart'], size:W => [W*0.12, W*0.11],
    props: () => ({ color:'#ff4d88', line:'#111111', lw:0 }), fields:['color:color','line:color','lw:num:0:20'],
    draw: it => { const p = it.p, w = it.w/2, h = it.h/2;
      return [P(`M0 ${f1(h)}C${f1(-w*1.1)} ${f1(h*0.1)} ${f1(-w*0.95)} ${f1(-h*1.05)} 0 ${f1(-h*0.45)}C${f1(w*0.95)} ${f1(-h*1.05)} ${f1(w*1.1)} ${f1(h*0.1)} 0 ${f1(h)}Z`, p.color, p.line, p.lw)]; } },
  sweat: { cat:'deco', name:['汗滴','Sweat drop'], size:W => [W*0.05, W*0.08],
    props: () => ({ color:'#bfe6ff', line:'#111111', lw:3 }), fields:['color:color','line:color','lw:num:0:20'],
    draw: it => { const p = it.p, w = it.w/2, h = it.h/2;
      return [P(`M0 ${f1(-h)}C${f1(w*0.4)} ${f1(-h*0.3)} ${f1(w)} ${f1(h*0.1)} ${f1(w)} ${f1(h*0.45)}A${f1(w)} ${f1(w)} 0 0 1 ${f1(-w)} ${f1(h*0.45)}C${f1(-w)} ${f1(h*0.1)} ${f1(-w*0.4)} ${f1(-h*0.3)} 0 ${f1(-h)}Z`, p.color, p.line, p.lw)]; } },
  vein: { cat:'deco', name:['生氣符號','Anger mark'], size:W => [W*0.1, W*0.1], uniform:true,
    props: () => ({ color:'#e60012', lw:10 }), fields:['color:color','lw:num:2:40'],
    draw: it => { const p = it.p, r = it.w/2, g = r*0.18, out = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        const ax = sx*g, ay = sy*r*0.95, bx = sx*r*0.95, by = sy*g;
        out.push(P(`M${f1(ax)} ${f1(ay)}Q${f1(sx*g)} ${f1(sy*g)} ${f1(bx)} ${f1(by)}`, 'none', p.color, p.lw)); });
      return out; } },
};
const STK_CATS = ['text','bubble','age','cover','back','deco'];

/* ---------- 文字預設樣式（都是 'text' 物件） ---------- */
const TEXT_PRESETS = [
  { name:['標題','Title'],          p:() => ({ text:t('s_title'), font:'Dela Gothic One', size:150, fill:'#ffffff', stroke:'#111111', sw:16 }) },
  { name:['副標','Subtitle'],       p:() => ({ text:t('s_sub'), weight:700, size:64 }) },
  { name:['作者名','Author'],       p:() => ({ text:t('s_byline'), font:'Noto Serif TC', weight:700, size:56 }) },
  { name:['對話','Dialogue'],       p:() => ({ text:t('s_dialog'), size:40 }) },
  { name:['直書對話','Vertical'],   p:() => ({ text:t('s_dialog'), size:40, vert:true }) },
  { name:['狀聲詞','SFX'],          p:() => ({ text:t('s_sfx'), font:'Dela Gothic One', size:180, fill:'#ffffff', stroke:'#000000', sw:18 }), r:-8 },
  { name:['旁白','Narration'],      p:() => ({ text:t('s_narr'), font:'LXGW WenKai TC', size:40 }) },
  { name:['手寫','Handwritten'],    p:() => ({ text:t('s_dialog'), font:'Iansui', size:44 }) },
  { name:['美漫字','Comic EN'],     p:() => ({ text:'WHAM!', font:'Bangers', size:160, fill:'#ffe600', stroke:'#111111', sw:14, ls:4 }) },
];

/* ---------- 物件工具 ---------- */
function newItem(k, o = {}){
  const def = STK[k], S = doc.settings, [w, h] = def.size(S.w, S.h);
  const it = { id:uid(), k, x:o.x ?? S.w/2, y:o.y ?? S.h/2, w:o.w ?? w, h:o.h ?? h, r:o.r || 0, op:1, p:{ ...def.props(), ...(o.p || {}) } };
  return it;
}
const itemPrims = it => { const d = STK[it.k]; return d ? d.draw(it).filter(Boolean) : []; };
function itemBox(it){
  if (it.k === 'text'){ const B = textBounds({ ...FX_DEFAULTS, ...it.p, x:0, y:0 }); return { w:2*Math.max(Math.abs(B.x0), Math.abs(B.x1)), h:2*Math.max(Math.abs(B.y0), Math.abs(B.y1)) }; }
  return { w:it.w, h:it.h };
}
function itemSVG(it, editor){
  const b = itemBox(it), def = STK[it.k] || {};
  let hit = '';
  if (editor) hit = def.edgeHit
    ? `<rect class="ihit" data-iid="${it.id}" x="${-b.w/2}" y="${-b.h/2}" width="${b.w}" height="${b.h}" fill="none" stroke="transparent" stroke-width="${Math.max(30, 24/ui.zoom)}" pointer-events="stroke"/>`
    : `<rect class="ihit" data-iid="${it.id}" x="${-b.w/2}" y="${-b.h/2}" width="${b.w}" height="${b.h}" fill="transparent"/>`;
  // 只有工作區的物件才給 id（縮圖如果也用同一個 id，即時更新會改到縮圖而不是工作區）
  return `<g${editor ? ` id="it-${it.id}"` : ''} transform="translate(${f1(it.x)} ${f1(it.y)}) rotate(${it.r || 0})" opacity="${it.op ?? 1}">${primsSVG(itemPrims(it))}${hit}</g>`;
}
function drawItem(ctx, it){
  ctx.save(); ctx.translate(it.x, it.y); ctx.rotate((it.r || 0) * Math.PI/180); ctx.globalAlpha *= (it.op ?? 1);
  drawPrims(ctx, itemPrims(it)); ctx.restore();
}
// 縮圖預覽用
function itemPreviewSVG(it){
  const b = itemBox(it); let x0 = -b.w/2, y0 = -b.h/2, x1 = b.w/2, y1 = b.h/2;
  for (const tl of it.p.tails || []){ x0 = Math.min(x0, tl.tx); x1 = Math.max(x1, tl.tx); y0 = Math.min(y0, tl.ty); y1 = Math.max(y1, tl.ty); }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  return `<svg viewBox="${f1(x0 - pad)} ${f1(y0 - pad)} ${f1(x1 - x0 + 2*pad)} ${f1(y1 - y0 + 2*pad)}" preserveAspectRatio="xMidYMid meet">${primsSVG(itemPrims(it))}</svg>`;
}

/* ================= 文字特效 ================= */
const FX_DEFAULTS = { fillType:'solid', fill2:'#ff3b00', fill3:'#ffd400', gA:90, stroke2:'#ffffff', sw2:0,
  sh:false, shC:'#000000', shB:20, shX:6, shY:6, ex:0, exC:'#333333', exA:45, skew:0, sx:100, sy:100, arc:0, wave:0 };
// 屬性面板的分組（key:type[:min:max:step]）
const FX_GROUPS = [
  ['fx_fill',   ['fillType:select:solid|grad|grad3|alt', 'fill:color', 'fill2:color', 'fill3:color', 'gA:num:0:360']],
  ['fx_stroke', ['stroke:color', 'sw:num:0:120', 'stroke2:color', 'sw2:num:0:120']],
  ['fx_shadow', ['sh:bool', 'shC:color', 'shB:num:0:200', 'shX:num:-150:150', 'shY:num:-150:150']],
  ['fx_3d',     ['ex:num:0:200', 'exC:color', 'exA:num:0:360']],
  ['fx_warp',   ['skew:num:-45:45', 'sx:num:20:300', 'sy:num:20:300', 'arc:num:-100:100', 'wave:num:0:1:0.05']],
];
const FX_FIELDS = FX_GROUPS.flatMap(g => g[1]);
// 一鍵特效樣式：數值都依字級 s 換算，所以大字小字效果比例一致
const TEXT_FX = [
  { name:['無特效','Plain'],    p:s => ({ fill:'#111111', sw:0 }) },
  { name:['熱血','Shonen'],     p:s => ({ fillType:'grad', fill:'#fff200', fill2:'#ff3b00', gA:90, stroke:'#000000', sw:s*0.09, stroke2:'#ffffff', sw2:s*0.06 }) },
  { name:['立體','3D Pop'],     p:s => ({ fill:'#ffde00', stroke:'#111111', sw:s*0.06, ex:s*0.12, exC:'#b00000', exA:45 }) },
  { name:['霓虹','Neon'],       p:s => ({ fill:'#ffffff', stroke:'#00e5ff', sw:s*0.035, sh:true, shC:'#00e5ff', shB:s*0.35, shX:0, shY:0 }) },
  { name:['少女','Sweet'],      p:s => ({ fillType:'grad', fill:'#ffd1e8', fill2:'#ff5fa2', gA:90, stroke:'#ffffff', sw:s*0.12, stroke2:'#ff5fa2', sw2:s*0.04, sh:true, shC:'#ff8cc0', shB:s*0.2, shX:0, shY:0 }) },
  { name:['恐怖','Horror'],     p:s => ({ fill:'#b30000', stroke:'#000000', sw:s*0.03, sh:true, shC:'#000000', shB:s*0.15, shX:0, shY:s*0.06, wave:0.2 }) },
  { name:['金屬','Metal'],      p:s => ({ fillType:'grad3', fill:'#ffffff', fill3:'#8a8f98', fill2:'#e8e8e8', gA:90, stroke:'#222222', sw:s*0.05, sh:true, shC:'#000000', shB:s*0.1, shX:s*0.03, shY:s*0.05 }) },
  { name:['黃金','Gold'],       p:s => ({ fillType:'grad3', fill:'#fff6a8', fill3:'#d4a017', fill2:'#8a5a00', gA:90, stroke:'#3b2200', sw:s*0.05, ex:s*0.06, exC:'#5a3a00', exA:60 }) },
  { name:['冰晶','Ice'],        p:s => ({ fillType:'grad', fill:'#ffffff', fill2:'#6ec6ff', gA:90, stroke:'#0b4f8a', sw:s*0.05, stroke2:'#ffffff', sw2:s*0.04 }) },
  { name:['復古','Retro'],      p:s => ({ fill:'#f7e7c6', stroke:'#4b2e1a', sw:s*0.05, ex:s*0.1, exC:'#c4572a', exA:135, skew:-10 }) },
  { name:['墨黑','Ink'],        p:s => ({ fill:'#111111', stroke:'#ffffff', sw:s*0.12, sh:true, shC:'#000000', shB:s*0.05, shX:s*0.04, shY:s*0.04 }) },
  { name:['彩虹','Rainbow'],    p:s => ({ fillType:'alt', fill:'#ff4d4d', fill2:'#ffd84d', fill3:'#4dc3ff', stroke:'#ffffff', sw:s*0.08, stroke2:'#111111', sw2:s*0.04 }) },
  { name:['拱形','Arch'],       p:s => ({ fill:'#ffffff', stroke:'#111111', sw:s*0.1, arc:45 }) },
  { name:['衝擊','Impact'],     p:s => ({ fill:'#ffffff', stroke:'#000000', sw:s*0.14, skew:-14, sx:115, sy:90 }) },
];
function applyFx(p, fx){
  const keep = { text:p.text, font:p.font, size:p.size, weight:p.weight, align:p.align, vert:p.vert, lh:p.lh, ls:p.ls };
  return { ...p, ...FX_DEFAULTS, stroke:'#ffffff', sw:0, ...fx.p(p.size), ...keep };
}

// 圖案分頁的「特效標題」快速樣式
[[1, ['熱血標題','Shonen title']], [2, ['立體標題','3D title']], [3, ['霓虹標題','Neon title']], [7, ['黃金標題','Gold title']]].forEach(([fi, name]) =>
  TEXT_PRESETS.push({ name, p:() => applyFx({ ...STK.text.props(), text:t('s_title'), font:'Dela Gothic One', size:150 }, TEXT_FX[fi]) }));

/* ---------- 圖案分頁的對話框樣式（都是同一種 bubble 物件，只是預設不同） ---------- */
const newTail = (it, kx = -0.3, ky = 0.95, style = 'tri') => ({ tx:Math.round(it.w*kx), ty:Math.round(it.h*ky), cx:null, cy:null, bw:0.12, style });
const BUBBLE_PRESETS = [
  { name:['橢圓','Oval'],        p:{ shape:'oval' },   tail:'tri' },
  { name:['圓角','Rounded'],     p:{ shape:'round' },  tail:'tri' },
  { name:['方框','Box'],         p:{ shape:'rect' },   tail:'tri' },
  { name:['思考雲','Thought'],   p:{ shape:'cloud' },  tail:'dots' },
  { name:['吶喊','Shout'],       p:{ shape:'spiky', weight:900, size:52 }, textKey:'s_sfx', tail:null },
  { name:['顫抖','Shaky'],       p:{ shape:'wavy' },   tail:'tri' },
  { name:['小聲（虛線）','Whisper'], p:{ shape:'oval', dash:true, lw:3 }, tail:'tri' },
  { name:['六角','Hexagon'],     p:{ shape:'hexagon' }, tail:'tri' },
  { name:['機械／電話','Tech'],  p:{ shape:'tech', font:'DotGothic16' }, tail:'tri' },
  { name:['強調（雙線）','Emphasis'], p:{ shape:'oval', double:true, weight:700 }, tail:'tri' },
  { name:['內心獨白（無尾）','Inner voice'], p:{ shape:'round', line:'#111111', lw:2 }, tail:null },
  { name:['旁白框','Narration'], p:{ shape:'rect', lw:3, font:'LXGW WenKai TC' }, textKey:'s_narr', tail:null, size:W => [W*0.42, W*0.11] },
];
function bubbleFromPreset(bp, o = {}){
  const it = newItem('bubble', { ...o, p:{ ...bp.p, ...(bp.textKey ? { text:t(bp.textKey) } : {}) } });
  if (bp.size){ [it.w, it.h] = bp.size(doc.settings.w, doc.settings.h); }
  if (bp.tail) it.p.tails = [newTail(it, -0.3, 0.95, bp.tail)];
  return it;
}
// 舊版的 b_* 對話框轉成新的 bubble 物件
const OLD_BUBBLES = { b_oval:'oval', b_round:'round', b_think:'cloud', b_shout:'spiky', b_whisper:'oval', b_box:'rect', b_wave:'wavy' };
function migrateItem(it){
  if (it.k === 'bubble' && it.p && it.p.dir == null){ it = { ...it, p:{ ...it.p, dir:it.p.vert ? 'v' : 'auto', wrap:it.p.wrap ?? true } }; delete it.p.vert; }
  // 已移除的貼圖：手繪抖動愛心 → 改成找來的塗鴉愛心
  if (it.k === 'heart_wobble' && STK.clip_oc355481) return { ...it, k:'clip_oc355481', p:{ tint:it.p && it.p.color || 'none', keepDark:true, flip:false } };
  if (!OLD_BUBBLES[it.k]) return it;
  const p = it.p, shape = OLD_BUBBLES[it.k];
  const np = { ...bubbleProps(), ...p, shape, dash:it.k === 'b_whisper', tails:[] };
  if (p.spikes) np.spikes = p.spikes;
  if (p.tail && p.tx != null) np.tails = [{ tx:p.tx, ty:p.ty, cx:null, cy:null, bw:0.12, style:it.k === 'b_think' ? 'dots' : 'tri' }];
  delete np.tail; delete np.tx; delete np.ty;
  return { ...it, k:'bubble', p:np };
}

/* ================= 更多圖案：18 禁標誌、扭曲愛心、狀態表現（漫符） ================= */
const rotPts = (pts, deg, cx = 0, cy = 0) => { const a = deg*Math.PI/180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + c*(x-cx) - s*(y-cy), cy + s*(x-cx) + c*(y-cy)]); };
const lineD = pts => 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L');
// 愛心曲線（參數式），正規化到 [-0.5, 0.5]
const HEART_RAW = (() => {
  const n = 140, pts = [];
  for (let i = 0; i < n; i++){ const t = i/n*Math.PI*2; pts.push([16*Math.sin(t)**3, -(13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t))]); }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([x, y]) => [(x - (x0 + x1)/2) / (x1 - x0), (y - (y0 + y1)/2) / (y1 - y0)]);
})();
// f(u, v, i, n)：對每個點做變形
const heartPts = (w, h, f, cx = 0, cy = 0) => HEART_RAW.map(([u, v], i) => { if (f) [u, v] = f(u, v, i, HEART_RAW.length); return [cx + u*w, cy + v*h]; });
const heartD = (w, h, f, cx, cy) => polyD(heartPts(w, h, f, cx, cy));
const HEART_FIELDS = ['color:color', 'line:color', 'lw:num:0:20'];
const heartProps = (extra = {}) => () => ({ color:'#ff4d88', line:'#111111', lw:0, ...extra });
// 多個形狀合成一個輪廓（填色同色）
const unionFill = (ds, fill, line, lw) => lw > 0 ? unionShapes(ds, { bg:fill, line, lw }) : ds.map(d => P(d, fill));

Object.assign(STK, {
  /* ---------- 18 禁禁止標誌 ---------- */
  no18: { cat:'age', name:['18禁 禁止標誌','No-18 sign'], size:W => [W*0.14, W*0.14], uniform:true,
    props: () => ({ text:'18', color:'#d7000f', fg:'#111111', bg:'none', tight:-6, font:'Noto Sans TC' }),
    fields: ['text:text', 'color:color', 'fg:color', 'bg:colorn', 'tight:num:-30:30', 'font:font'],
    draw: it => no18Prims(it.p, it.w, 0) },
  no18c: { cat:'age', name:['18禁 標誌＋文字','No-18 + caption'], size:W => [W*0.16, W*0.21],
    props: () => ({ text:'18', sub:t('s_adult'), color:'#d7000f', fg:'#111111', bg:'none', tight:-6, font:'Noto Sans TC' }),
    fields: ['text:text', 'sub:text', 'color:color', 'fg:color', 'bg:colorn', 'tight:num:-30:30', 'font:font'],
    draw: it => { const p = it.p, w = it.w, h = it.h, d = Math.min(w, h*0.76), cy = -h/2 + d/2, capH = h - d;
      return [...no18Prims(p, d, cy), T(p.sub, 0, h/2 - capH*0.45, { font:p.font, size:fitSize(p.sub, w*0.98, capH*0.95, 0.72), weight:900, fill:p.color })]; } },

  /* ---------- 愛心（各種扭曲） ---------- */
  heart_tilt: { cat:'heart', name:['歪斜愛心','Tilted'], size:W => [W*0.12, W*0.11], props:heartProps(), fields:HEART_FIELDS,
    draw: it => [P(polyD(rotPts(heartPts(it.w, it.h, (u, v) => [u*(u < 0 ? 1.14 : 0.86), v + u*0.2]), -14)), it.p.color, it.p.line, it.p.lw)] },
  heart_twist: { cat:'heart', name:['扭轉愛心','Twisted'], size:W => [W*0.12, W*0.12], props:heartProps(), fields:HEART_FIELDS,
    draw: it => [P(heartD(it.w, it.h, (u, v) => [u*0.88 + 0.1*Math.sin((v + 0.5)*Math.PI*2.2), v]), it.p.color, it.p.line, it.p.lw)] },
  heart_melt: { cat:'heart', name:['融化愛心','Melting'], size:W => [W*0.12, W*0.15], props:heartProps({ seed:SEED() }), fields:HEART_FIELDS,
    draw: it => { const p = it.p, w = it.w, h = it.h, hh = h*0.72, rnd = seeded(p.seed), ds = [heartD(w, hh, null, 0, -h/2 + hh/2)];
      [-0.2, 0.04, 0.22].forEach(ux => { const x = ux*w, dw = w*(0.06 + rnd()*0.03), top = -h/2 + hh*(0.55 + Math.abs(ux)*-0.3), len = h*(0.12 + rnd()*0.2);
        ds.push(rectD(x - dw/2, top, dw, len, dw/2), ellD(x, top + len, dw*0.75, dw*0.8)); });
      return unionFill(ds, p.color, p.line, p.lw); } },
  heart_broken: { cat:'heart', name:['碎裂愛心','Broken'], size:W => [W*0.14, W*0.12], props:heartProps({ lw:3 }), fields:HEART_FIELDS,
    draw: it => { const p = it.p, w = it.w*0.85, h = it.h, n = HEART_RAW.length, pts = heartPts(w, h);
      const top = pts[0], bot = pts[n/2], zig = []; for (let i = 1; i < 6; i++){ const tt = i/6; zig.push([(i % 2 ? 1 : -1)*w*0.07, top[1] + (bot[1] - top[1])*tt]); }
      const right = [...pts.slice(0, n/2 + 1), ...zig.slice().reverse()], left = [...pts.slice(n/2), top, ...zig];
      return [P(polyD(rotPts(left.map(([x, y]) => [x - w*0.06, y]), -9, 0, h*0.4)), p.color, p.line, p.lw),
              P(polyD(rotPts(right.map(([x, y]) => [x + w*0.06, y]), 9, 0, h*0.4)), p.color, p.line, p.lw)]; } },
  heart_pulse: { cat:'heart', name:['心跳愛心','Pulsing'], size:W => [W*0.16, W*0.16], uniform:true, props:heartProps({ lw:0 }), fields:HEART_FIELDS,
    draw: it => { const p = it.p, r = it.w/2, out = [P(heartD(it.w*0.6, it.h*0.55), p.color, p.line, p.lw)];
      let d = ''; for (let i = 0; i < 10; i++){ const a = i/10*Math.PI*2 - Math.PI/2; d += `M${f1(Math.cos(a)*r*0.72)} ${f1(Math.sin(a)*r*0.72)}L${f1(Math.cos(a)*r*0.96)} ${f1(Math.sin(a)*r*0.96)}`; }
      out.push(P(d, 'none', p.color, r*0.06)); return out; } },
  heart_double: { cat:'heart', name:['雙心','Double'], size:W => [W*0.15, W*0.13], props:heartProps({ fill2:'#ffb3cf' }), fields:['color:color', 'fill2:color', 'line:color', 'lw:num:0:20'],
    draw: it => { const p = it.p, w = it.w, h = it.h;
      return [P(polyD(rotPts(heartPts(w*0.48, h*0.5, null, w*0.24, -h*0.2), 18, w*0.24, -h*0.2)), p.fill2, p.line, p.lw),
              P(heartD(w*0.72, h*0.75, null, -w*0.12, h*0.1), p.color, p.line, p.lw)]; } },
  heart_gloss: { cat:'heart', name:['光澤愛心','Glossy'], size:W => [W*0.12, W*0.11], props:heartProps(), fields:HEART_FIELDS,
    draw: it => { const p = it.p, w = it.w, h = it.h, hl = [];
      for (let i = 0; i < 24; i++){ const a = i/24*Math.PI*2; hl.push([-w*0.2 + Math.cos(a)*w*0.11, -h*0.17 + Math.sin(a)*h*0.055]); }
      return [P(heartD(w, h), p.color, p.line, p.lw), P(polyD(rotPts(hl, -38, -w*0.2, -h*0.17)), '#ffffff', null, 0, { op:0.85 }),
              P(ellD(-w*0.06, -h*0.29, w*0.03, w*0.03), '#ffffff', null, 0, { op:0.85 })]; } },
  heart_arrow: { cat:'heart', name:['一箭穿心','Pierced'], size:W => [W*0.18, W*0.13], props:heartProps({ arrow:'#6b4a2b' }), fields:['color:color', 'arrow:color', 'line:color', 'lw:num:0:20'],
    draw: it => { const p = it.p, w = it.w, h = it.h, s = Math.min(w, h), a = [-w*0.48, h*0.3], b = [w*0.46, -h*0.3], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = rotPts([[0, 0], [-s*0.16, -s*0.07], [-s*0.16, s*0.07]], ang*180/Math.PI).map(([x, y]) => [x + b[0], y + b[1]]);
      const fl = [-1, 1].map(sg => rotPts([[0, 0], [-s*0.1, sg*s*0.08]], ang*180/Math.PI).map(([x, y]) => [x + a[0] + Math.cos(ang)*s*0.08, y + a[1] + Math.sin(ang)*s*0.08]));
      return [P(heartD(w*0.62, h*0.9), p.color, p.line, p.lw), P(lineD([a, b]), 'none', p.arrow, s*0.035), P(polyD(head), p.arrow),
              ...fl.map(seg => P(lineD(seg), 'none', p.arrow, s*0.03))]; } },
  heart_hollow: { cat:'heart', name:['空心愛心 ♡','Outline ♡'], size:W => [W*0.12, W*0.11], props:heartProps({ lw:10 }), fields:['color:color', 'lw:num:1:40'],
    draw: it => [P(heartD(it.w - it.p.lw, it.h - it.p.lw), 'none', it.p.color, it.p.lw)] },
  heart_scatter: { cat:'heart', name:['飄散小愛心','Floating hearts'], size:W => [W*0.25, W*0.2], props:heartProps({ fill2:'#ffb3cf', count:7, seed:SEED() }),
    fields:['color:color', 'fill2:color', 'line:color', 'lw:num:0:20', 'count:num:2:20'],
    draw: it => { const p = it.p, w = it.w, h = it.h, rnd = seeded(p.seed), out = [];
      for (let i = 0; i < p.count; i++){ const s = Math.min(w, h)*(0.16 + rnd()*0.22), x = (rnd() - 0.5)*(w - s), y = (rnd() - 0.5)*(h - s);
        out.push(P(polyD(rotPts(heartPts(s, s*0.92, null, x, y), (rnd() - 0.5)*50, x, y)), i % 3 === 2 ? p.fill2 : p.color, p.line, p.lw)); }
      return out; } },

});
STK.heart.cat = 'heart';
STK_CATS.splice(0, STK_CATS.length, 'text', 'bubble', 'heart', 'mood', 'deco', 'age', 'cover', 'back');

/* ---------- 狀聲詞文字樣式 ---------- */
[
  [['♡','♡'], () => ({ text:'♡', font:'Noto Sans TC', size:120, weight:900, fill:'#ff4d88', stroke:'#ffffff', sw:12 })],
  [['哈啊…♡','Haah…♡'], () => ({ text:LANG === 'zh' ? '哈啊…♡' : 'haah…♡', font:'Iansui', size:70, fill:'#111111', stroke:'#ffffff', sw:10, wave:0.15, fillType:'solid' })],
  [['噗通','Thump'], () => ({ text:LANG === 'zh' ? '噗通' : 'THUMP', font:'Dela Gothic One', size:130, fill:'#ffffff', stroke:'#e60012', sw:14, skew:-8 })],
  [['ビクッ','Twitch'], () => ({ text:'ビクッ', font:'Dela Gothic One', size:120, fill:'#ffffff', stroke:'#111111', sw:14, wave:0.3 })],
  [['ドキドキ','Doki doki'], () => ({ text:'ドキドキ', font:'Mochiy Pop One', size:100, fillType:'grad', fill:'#ff8fb8', fill2:'#e6005c', stroke:'#ffffff', sw:12 })],
  [['ゾクッ','Shiver'], () => ({ text:'ゾクッ', font:'Rampart One', size:120, fill:'#7b3fe4', stroke:'#ffffff', sw:10, wave:0.25 })],
  [['顫抖文字','Shaky text'], () => ({ text:LANG === 'zh' ? '抖…抖…' : 'sh-shaking', font:'Iansui', size:70, fill:'#111111', stroke:'#ffffff', sw:8, wave:0.45 })],
].forEach(([name, p]) => TEXT_PRESETS.push({ name, p:() => ({ ...STK.text.props(), ...p() }) }));

// 標準禁止標誌比例（以直徑 d 為基準，數字在斜線後面）
// 量出文字「實際筆畫」的範圍（不是文字框），用來把數字真正放在圓心、並決定大小
function inkBox(text, font, weight, size){
  mctx.font = `${weight} ${size}px ${fontStack(font)}`; mctx.textBaseline = 'alphabetic'; mctx.textAlign = 'center';
  if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
  const m = mctx.measureText(text);
  return { l:m.actualBoundingBoxLeft, r:m.actualBoundingBoxRight, a:m.actualBoundingBoxAscent, d:m.actualBoundingBoxDescent };
}
function no18Prims(p, d, cy){
  const k = d / 276, r = 124*k, ring = 28*k, s = (231 - 138)*k;
  // 每個字分開排：用字的前進寬度排列，再加上「數字間距」（字級的百分比，負數＝靠緊）
  const chars = [...String(p.text || '')], tight = (p.tight ?? -6) / 100;
  mctx.font = `900 100px ${fontStack(p.font)}`; mctx.textBaseline = 'alphabetic'; mctx.textAlign = 'left';
  if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
  const pos = []; let x = 0, L = Infinity, Rr = -Infinity, A = 0, D = 0;
  for (const ch of chars){
    const m = mctx.measureText(ch);
    pos.push(x);
    L = Math.min(L, x - m.actualBoundingBoxLeft); Rr = Math.max(Rr, x + m.actualBoundingBoxRight);
    A = Math.max(A, m.actualBoundingBoxAscent); D = Math.max(D, m.actualBoundingBoxDescent);
    x += m.width + tight*100;
  }
  const out = [];
  if (p.bg && p.bg !== 'none') out.push(P(ellD(0, cy, r, r), p.bg));
  if (chars.length){
    // 數字筆畫高度最多佔直徑 56%、寬度最多 70%（筆畫四角不會碰到圓環）
    const inkW = (Rr - L) || 1, inkH = (A + D) || 1, size = Math.min(d*0.56 / inkH, d*0.70 / inkW) * 100, sc = size / 100;
    const x0 = -(L + Rr)/2 * sc;                      // 讓筆畫左右置中
    const base = cy + (A - D)/2 * sc;                  // 讓筆畫上下置中的基線位置
    const y = base - baseOff({ font:p.font, weight:900, size });
    chars.forEach((ch, i) => out.push(T(ch, x0 + pos[i]*sc, y, { ax:'left', align:'left', font:p.font, size, weight:900, fill:p.fg })));
  }
  // 斜線和圓環一樣粗
  out.push(P(ellD(0, cy, r, r), 'none', p.color, ring), P(`M${f1(-s)} ${f1(cy - s)}L${f1(s)} ${f1(cy + s)}`, 'none', p.color, ring, { cap:'butt' }));
  return out;
}

/* ---------- 內建 CC0 素材（Openclipart）註冊成貼圖 ---------- */
if (typeof CLIPART !== 'undefined') for (const c of CLIPART){
  STK['clip_' + c.id] = { cat:c.cat, clip:true, name:c.name, uniform:true,
    size:W => { const s = W*0.16, a = c.w / c.h; return a >= 1 ? [s, s/a] : [s*a, s]; },
    props: () => ({ tint:'none', keepDark:false, flip:false }),
    fields: ['tint:colorn', 'keepDark:bool', 'flip:bool'],
    draw: it => [{ t:'img', url:clipURL(c, it.p.tint, it.p.keepDark), x:-it.w/2, y:-it.h/2, w:it.w, h:it.h, flip:it.p.flip }] };
}
