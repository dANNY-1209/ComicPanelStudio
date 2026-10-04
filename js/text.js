'use strict';
/* ================= 字體清單（全部已確認為 SIL OFL 或 Apache 2.0 授權） =================
   [family, 中文名, 英文名, 分組, Google Fonts 字重] */
const FONTS = [
  ['Noto Sans TC','思源黑體','Noto Sans TC','tc','400;700;900'],
  ['Noto Serif TC','思源宋體','Noto Serif TC','tc','400;700;900'],
  ['LXGW WenKai TC','霞鶩文楷','LXGW WenKai TC','tc','400;700'],
  ['Huninn','jf 粉圓','Huninn (round)','tc',''],
  ['Iansui','芫荽（手寫）','Iansui (handwritten)','tc',''],
  ['Chiron GoRound TC','昭源甜圓','Chiron GoRound TC','tc','400;700;900'],
  ['Chiron Hei HK','昭源黑體','Chiron Hei HK','tc','400;700;900'],
  ['Chiron Sung HK','昭源宋體','Chiron Sung HK','tc','400;700;900'],
  ['Cactus Classical Serif','仙人掌明體','Cactus Classical Serif','tc',''],
  ['Dela Gothic One','Dela Gothic（超粗黑）','Dela Gothic One','jp',''],
  ['Zen Maru Gothic','Zen 丸ゴシック','Zen Maru Gothic','jp','400;700;900'],
  ['Zen Antique','Zen Antique（古風）','Zen Antique','jp',''],
  ['Shippori Mincho','しっぽり明朝','Shippori Mincho','jp','400;800'],
  ['Klee One','Klee（鉛筆）','Klee One','jp','400;600'],
  ['Kaisei Decol','Kaisei Decol','Kaisei Decol','jp','400;700'],
  ['Kiwi Maru','Kiwi Maru（圓體）','Kiwi Maru','jp','400;500'],
  ['Yusei Magic','Yusei Magic（麥克筆）','Yusei Magic','jp',''],
  ['Hachi Maru Pop','Hachi Maru Pop（可愛）','Hachi Maru Pop','jp',''],
  ['Mochiy Pop One','Mochiy Pop（POP）','Mochiy Pop One','jp',''],
  ['Rampart One','Rampart One（立體）','Rampart One','jp',''],
  ['Train One','Train One（雙線）','Train One','jp',''],
  ['Reggae One','Reggae One','Reggae One','jp',''],
  ['RocknRoll One','RocknRoll One','RocknRoll One','jp',''],
  ['Darumadrop One','Darumadrop（圓胖）','Darumadrop One','jp',''],
  ['DotGothic16','DotGothic16（像素）','DotGothic16','jp',''],
  ['Bangers','Bangers（美漫）','Bangers','en',''],
  ['Comic Neue','Comic Neue','Comic Neue','en','400;700'],
  ['Anton','Anton','Anton','en',''],
  ['Bebas Neue','Bebas Neue','Bebas Neue','en',''],
  ['Oswald','Oswald','Oswald','en','400;700'],
  ['Luckiest Guy','Luckiest Guy','Luckiest Guy','en',''],
  ['Permanent Marker','Permanent Marker','Permanent Marker','en',''],
  ['Patrick Hand','Patrick Hand','Patrick Hand','en',''],
  ['Creepster','Creepster（恐怖）','Creepster','en',''],
  ['Cinzel','Cinzel','Cinzel','en','400;700;900'],
  ['Playfair Display','Playfair Display','Playfair Display','en','400;700;900'],
  ['Black Han Sans','Black Han Sans','Black Han Sans','en',''],
];
const DEFAULT_FONT = 'Noto Sans TC';
function fontsURL(){
  return 'https://fonts.googleapis.com/css2?' + FONTS.map(f => 'family=' + f[0].replace(/ /g, '+') + (f[4] ? ':wght@' + f[4] : '')).join('&') + '&display=swap';
}
// 匯入的字體：值為 'cf:<id>'
const customFonts = new Map();           // id -> {id, name, blob, ext, t, face}
function fontFamily(v){ return v && v.startsWith('cf:') ? 'cps_' + v.slice(3) : (v || DEFAULT_FONT); }
function fontStack(v){ return `'${fontFamily(v)}','Noto Sans TC',sans-serif`; }
function fontLabel(v){
  if (v && v.startsWith('cf:')){ const f = customFonts.get(v.slice(3)); return f ? f.name : v; }
  const f = FONTS.find(x => x[0] === v); return f ? (LANG === 'zh' ? f[1] : f[2]) : (v || DEFAULT_FONT);
}
function fontOptions(cur){
  const grp = (label, list) => `<optgroup label="${label}">${list.map(([v, l]) =>
    `<option value="${v}" ${v === cur ? 'selected' : ''} style="font-family:${fontStack(v).replace(/"/g, '')}">${l}</option>`).join('')}</optgroup>`;
  let h = '';
  for (const g of ['tc','jp','en']) h += grp(t('fg_' + g), FONTS.filter(f => f[3] === g).map(f => [f[0], LANG === 'zh' ? f[1] : f[2]]));
  if (customFonts.size) h += grp(t('fg_custom'), [...customFonts.values()].map(f => ['cf:' + f.id, f.name]));
  return h;
}
const fontStr = pr => `${pr.weight || 400} ${pr.size}px ${fontStack(pr.font)}`;

/* ================= 文字排版（直書 / 橫書 / 拱形 / 波浪） =================
   文字 primitive：
     基本：{t:'text', text, x, y, font, size, weight, fill, stroke, sw, align, vert, lh, ls, ax, ay, rot, op}
     特效：fillType('solid'|'grad'|'grad3'|'alt'), fill2, fill3, gA(漸層角度)
           stroke2, sw2（外層描邊）
           sh(bool), shC, shB, shX, shY（陰影／光暈）
           ex, exC, exA（立體厚度、顏色、方向）
           skew, sx, sy（斜體、橫向/縱向拉伸 %）, arc(-100~100 拱形), wave(0~1 波浪)
   (x,y) 是文字區塊的錨點；ax/ay 決定區塊如何對齊錨點 */
const mctx = document.createElement('canvas').getContext('2d');
const ROT_CH = new Set([...'「」『』（）()〈〉《》【】〔〕［］[]｛｝{}ー—―…‥〜～~-－=＝<>＜＞']);
const PUNCT = new Set([...'、。，．,.']);
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ']);
const setLS = (c, v) => { if ('letterSpacing' in c) c.letterSpacing = v + 'px'; };
/* ---------- 直書：中文與半形英數分開處理 ----------
   ch  ：中文、全形字 → 一字一格
   tcy ：縱中橫（「??」「!!」、兩位以內的數字、兩個以內的字母）→ 橫著擠在一格
   rot ：較長的英文單字／數字 → 整段轉 90 度側躺
   sp  ：半形空白 → 半格
   英文的「...」會先換成刪節號「…」（直書時是直的 ⋮） */
const HALF = /[\x21-\x7E]/;
function vTokens(line, pr){
  line = String(line).replace(/\.{2,}/g, m => '…'.repeat(Math.max(1, Math.round(m.length / 3))));
  const ch = [...line], out = [], size = Math.max(1, +pr.size || 12);
  for (let i = 0; i < ch.length;){
    const c = ch[i];
    if (c === ' '){ out.push({ s:' ', k:'sp', h:size*0.5 }); i++; continue; }
    if (HALF.test(c)){
      let j = i; while (j < ch.length && HALF.test(ch[j])) j++;
      const run = ch.slice(i, j).join(''); i = j;
      if (run.length <= 2 || (/^[!?]+$/.test(run) && run.length <= 3)) out.push({ s:run, k:'tcy', h:size });
      else { mctx.font = fontStr(pr); if ('letterSpacing' in mctx) mctx.letterSpacing = '0px'; out.push({ s:run, k:'rot', h:mctx.measureText(run).width + size*0.15 }); }
      continue;
    }
    out.push({ s:c, k:'ch', h:size }); i++;
  }
  return out;
}
function layoutText(pr){
  const size = Math.max(1, +pr.size || 12), lh = pr.lh || 1.25, ls = +pr.ls || 0;
  const lines = String(pr.text ?? '').split('\n'), g = [];
  const wave = +pr.wave || 0, arc = +pr.arc || 0;
  const perChar = !pr.vert && (arc || wave || pr.fillType === 'alt');
  let W, H, ci = 0;
  if (pr.vert){
    const colW = size * lh, toks = lines.map(l => vTokens(l, pr));
    const colH = ts => ts.reduce((s, tk) => s + tk.h, 0) + Math.max(0, ts.length - 1) * ls;
    W = lines.length * colW; H = Math.max(size, ...toks.map(colH));
    toks.forEach((ts, c) => {
      // cols：rtl＝傳統直書（第一列在最右、往左換列）；ltr＝第一列在最左、往右換列
      const x = pr.cols === 'ltr' ? -W/2 + colW*(c + 0.5) : W/2 - colW*(c + 0.5);
      let y = -H/2;
      for (const tk of ts){
        let gx = x, gy = y + tk.h/2, rot = 0, sx = 1;
        if (tk.k === 'ch'){
          const ch = tk.s; rot = ROT_CH.has(ch) ? 90 : 0;
          // 句讀與小字靠在「遠離下一列」的那一側：往左排（傳統）放右上，往右排放左上
          const side = pr.cols === 'ltr' ? -1 : 1;
          if (PUNCT.has(ch)){ gx += side*size*0.32; gy -= size*0.32; }
          else if (SMALL.has(ch)){ gx += side*size*0.08; gy -= size*0.08; }
        } else if (tk.k === 'rot') rot = 90;
        else if (tk.k === 'tcy'){
          // 縱中橫：太寬就橫向壓扁，塞進一格
          mctx.font = fontStr(pr); if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
          const w = mctx.measureText(tk.s).width; if (w > size*0.95) sx = size*0.95 / w;
        }
        y += tk.h + ls;
        if (tk.k === 'sp') continue;
        if (wave){ gx += wave*size*0.3*Math.sin(ci*0.9); rot += wave*18*Math.cos(ci*0.9); }
        g.push({ s:tk.s, x:gx, y:gy, anchor:'middle', rot, sx, ci:ci++ });
      }
    });
  } else {
    mctx.font = fontStr(pr); setLS(mctx, ls);
    const ws = lines.map(l => mctx.measureText(l).width);
    setLS(mctx, 0);
    W = Math.max(1, ...ws); H = lines.length * size * lh;
    const al = pr.align || 'center';
    lines.forEach((l, i) => {
      const y = -H/2 + size*lh*(i + 0.5);
      if (!perChar){
        g.push({ s:l, x: al === 'left' ? -W/2 : al === 'right' ? W/2 : 0, y, anchor: al === 'left' ? 'start' : al === 'right' ? 'end' : 'middle', rot:0, ci:ci++, w:ws[i] });
        return;
      }
      // 逐字排版（拱形、波浪、逐字變色需要）
      const lw = ws[i], chars = [...l], cw = chars.map(ch => mctx.measureText(ch).width);
      let x = al === 'left' ? -W/2 : al === 'right' ? W/2 - lw : -lw/2;
      const lc = x + lw/2, theta = arc/100*Math.PI, sg = Math.sign(theta), R = Math.abs(theta) > 1e-3 ? lw / Math.abs(theta) : 0;
      chars.forEach((ch, j) => {
        const cx = x + cw[j]/2; x += cw[j] + ls;
        let gx = cx, gy = y, rot = 0;
        if (R){ const phi = (cx - lc) / R; gx = lc + R*Math.sin(phi); gy = y + sg*(R*(1 - Math.cos(phi)) - R*(1 - Math.cos(theta/2))/2); rot = sg*phi*180/Math.PI; }
        if (wave){ gy += wave*size*0.3*Math.sin(ci*0.9); rot += wave*18*Math.cos(ci*0.9); }
        g.push({ s:ch, x:gx, y:gy, anchor:'middle', rot, ci:ci++ });
      });
    });
  }
  const ax = pr.ax || 'center', ay = pr.ay || 'middle';
  const ox = (pr.x || 0) + (ax === 'left' ? W/2 : ax === 'right' ? -W/2 : 0);
  const oy = (pr.y || 0) + (ay === 'top' ? H/2 : ay === 'bottom' ? -H/2 : 0);
  g.forEach(q => { q.x += ox; q.y += oy; });
  // 外框範圍（逐字時用每個字的位置算，拱形時會比原本的區塊大）
  let b = { x0:ox - W/2, y0:oy - H/2, x1:ox + W/2, y1:oy + H/2 };
  if (pr.vert || perChar) for (const q of g){
    b.x0 = Math.min(b.x0, q.x - size*0.6); b.x1 = Math.max(b.x1, q.x + size*0.6);
    b.y0 = Math.min(b.y0, q.y - size*0.6); b.y1 = Math.max(b.y1, q.y + size*0.6);
  }
  return { g, W, H, cx:ox, cy:oy, b, perChar, size, bo:baseOff(pr) };
}
// 依框大小推算字級（中日文字寬 1，其他 0.6）
function textUnits(s){ let u = 0; for (const ch of s) u += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6; return u; }
function fitSize(text, w, h, k = 0.6, vert = false){
  const lines = String(text || ' ').split('\n'), n = lines.length, u = Math.max(1, ...lines.map(textUnits));
  return vert ? Math.min(w * k / n, h * 0.9 / Math.max(1, ...lines.map(l => [...l].length)))
              : Math.min(h * k / n, w * 0.9 / u);
}

/* 從「字的視覺中心」到英文基線（alphabetic）的距離。
   編輯畫面（SVG）和匯出（Canvas）都從這條基線畫字，兩邊位置就會完全一致。 */
const baseOffCache = new Map();
function baseOff(pr){
  const f = fontStr({ ...pr, size:100 });
  if (!baseOffCache.has(f) || document.fonts.status === 'loading'){
    mctx.font = f; mctx.textBaseline = 'alphabetic';
    const m = mctx.measureText('Mg漢');
    const a = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 80, d = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 20;
    baseOffCache.set(f, (a - d) / 2 / 100);
  }
  return baseOffCache.get(f) * (+pr.size || 12);
}
document.fonts && document.fonts.addEventListener('loadingdone', () => baseOffCache.clear());

/* ---------- 特效：繪製層次 ----------
   由下往上：立體（多層位移）→ 外層描邊 → 主體（內層描邊＋填色）；陰影加在最底層 */
function textPasses(pr){
  const sw = +pr.sw || 0, sw2 = +pr.sw2 || 0;
  const st = pr.stroke && pr.stroke !== 'none' && sw > 0, st2 = pr.stroke2 && pr.stroke2 !== 'none' && sw2 > 0;
  const outerW = (st ? sw : 0) + 2*sw2, passes = [];
  const ex = +pr.ex || 0;
  if (ex > 0){
    const a = (pr.exA ?? 45) * Math.PI/180, steps = Math.min(30, Math.max(2, Math.ceil(ex/2)));
    const w = st2 ? outerW : st ? sw : 0;
    for (let i = steps; i >= 1; i--){ const d = ex*i/steps; passes.push({ fill:pr.exC || '#333', stroke:w ? pr.exC || '#333' : null, sw:w, dx:Math.cos(a)*d, dy:Math.sin(a)*d }); }
  }
  if (st2) passes.push({ fill:pr.stroke2, stroke:pr.stroke2, sw:outerW });
  passes.push({ fill:'FILL', stroke:st ? pr.stroke : null, sw:st ? sw : 0 });
  if (pr.sh) passes[0].shadow = true;
  return passes;
}
const altColor = (pr, i) => [pr.fill, pr.fill2, pr.fill3][i % 3] || pr.fill;
// 漸層線（區塊座標）
function gradLine(pr, L){
  const a = (pr.gA ?? 90) * Math.PI/180, c = Math.cos(a), s = Math.sin(a), half = (Math.abs(L.W*c) + Math.abs(L.H*s)) / 2;
  return [L.cx - c*half, L.cy - s*half, L.cx + c*half, L.cy + s*half];
}
const gradStops = pr => pr.fillType === 'grad3' ? [[0, pr.fill], [0.5, pr.fill3], [1, pr.fill2]] : [[0, pr.fill], [1, pr.fill2]];
// 把漸層端點換算到某個字旋轉後的座標系（字有旋轉時漸層才不會跟著轉）
function localPt(q, x, y){ const a = -(q.rot || 0) * Math.PI/180, dx = x - q.x, dy = y - q.y; return [q.x + Math.cos(a)*dx - Math.sin(a)*dy, q.y + Math.sin(a)*dx + Math.cos(a)*dy]; }
function textTf(pr){
  const sk = +pr.skew || 0, sx = (pr.sx ?? 100)/100, sy = (pr.sy ?? 100)/100, r = +pr.rot || 0;
  if (!sk && sx === 1 && sy === 1 && !r) return '';
  const x = pr.x || 0, y = pr.y || 0;
  return `translate(${f1(x)} ${f1(y)}) rotate(${r}) skewX(${sk}) scale(${sx} ${sy}) translate(${f1(-x)} ${f1(-y)})`;
}

/* ================= primitive → SVG 字串 / Canvas 繪製 ================= */
let GID = 0;
function primsSVG(prims){
  let s = '';
  for (const pr of prims){
    if (!pr) continue;
    if (pr.t === 'path'){
      const st = pr.stroke && pr.stroke !== 'none' && pr.sw > 0;
      s += `<path d="${pr.d}" fill="${pr.fill || 'none'}"${pr.fr ? ` fill-rule="${pr.fr}"` : ''}`
         + (st ? ` stroke="${pr.stroke}" stroke-width="${pr.sw}" stroke-linejoin="round" stroke-linecap="${pr.cap || 'round'}"` : '')
         + (st && pr.dash ? ` stroke-dasharray="${pr.dash}"` : '') + (pr.op != null ? ` opacity="${pr.op}"` : '') + '/>';
    } else if (pr.t === 'text') s += textSVG(pr);
    else if (pr.t === 'img') s += `<image href="${pr.url}" x="${f1(pr.x)}" y="${f1(pr.y)}" width="${f1(pr.w)}" height="${f1(pr.h)}" preserveAspectRatio="xMidYMid meet"${pr.flip ? ' transform="scale(-1 1)"' : ''}${pr.op != null ? ` opacity="${pr.op}"` : ''}/>`;
  }
  return s;
}
function textSVG(pr){
  const L = layoutText(pr), passes = textPasses(pr), id = 'tg' + (++GID);
  const grad = pr.fillType === 'grad' || pr.fillType === 'grad3';
  let defs = '', gi = 0;
  const gradDef = (q) => {
    let [x1, y1, x2, y2] = gradLine(pr, L);
    if (q && q.rot){ [x1, y1] = localPt(q, x1, y1); [x2, y2] = localPt(q, x2, y2); }
    const gid = id + '_' + (gi++);
    defs += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}">${gradStops(pr).map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
    return `url(#${gid})`;
  };
  const sharedGrad = grad ? gradDef(null) : null;
  if (pr.sh) defs += `<filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="${+pr.shX || 0}" dy="${+pr.shY || 0}" stdDeviation="${(+pr.shB || 0)/2}" flood-color="${pr.shC || '#000'}" flood-opacity="1"/></filter>`;
  // 主體填色在每個字上要用的漸層（有旋轉的字各自一份）
  const mainFill = L.g.map(q => pr.fillType === 'alt' ? altColor(pr, q.ci) : grad ? (q.rot ? gradDef(q) : sharedGrad) : (pr.fill || '#000'));
  const glyph = (q, i, main) => `<text x="${f1(q.x)}" y="${f1(q.y + L.bo)}" text-anchor="${q.anchor}"${q.rot || (q.sx && q.sx !== 1) ? ` transform="translate(${f1(q.x)} ${f1(q.y)})${q.rot ? ` rotate(${f1(q.rot)})` : ''}${q.sx && q.sx !== 1 ? ` scale(${q.sx.toFixed(3)} 1)` : ''} translate(${f1(-q.x)} ${f1(-q.y)})"` : ''}${main ? ` fill="${mainFill[i]}"` : ''}>${esc(q.s)}</text>`;
  let body = '';
  for (const ps of passes){
    const main = ps.fill === 'FILL';
    let a = main ? '' : ` fill="${ps.fill}"`;
    if (ps.sw > 0 && ps.stroke) a += ` stroke="${ps.stroke}" stroke-width="${f1(ps.sw)}" stroke-linejoin="round" paint-order="stroke"`;
    if (ps.dx || ps.dy) a += ` transform="translate(${f1(ps.dx)} ${f1(ps.dy)})"`;
    if (ps.shadow) a += ` filter="url(#${id}f)"`;
    body += `<g${a}>` + L.g.map((q, i) => glyph(q, i, main)).join('') + '</g>';
  }
  let at = `font-family="${fontStack(pr.font)}" font-size="${pr.size}" font-weight="${pr.weight || 400}"`;
  if (!pr.vert && !L.perChar && pr.ls) at += ` letter-spacing="${pr.ls}"`;
  const tf = textTf(pr); if (tf) at += ` transform="${tf}"`;
  if (pr.op != null) at += ` opacity="${pr.op}"`;
  return `<g ${at} style="white-space:pre">${defs ? `<defs>${defs}</defs>` : ''}${body}</g>`;
}
const ALIGN = { start:'left', middle:'center', end:'right' };
function drawPrims(ctx, prims){
  for (const pr of prims){
    if (!pr) continue;
    ctx.save();
    if (pr.op != null) ctx.globalAlpha *= pr.op;
    if (pr.t === 'path'){
      const p2 = new Path2D(pr.d);
      if (pr.fill && pr.fill !== 'none'){ ctx.fillStyle = pr.fill; ctx.fill(p2, pr.fr || 'nonzero'); }
      if (pr.stroke && pr.stroke !== 'none' && pr.sw > 0){
        ctx.lineWidth = pr.sw; ctx.strokeStyle = pr.stroke; ctx.lineJoin = 'round'; ctx.lineCap = pr.cap || 'round';
        ctx.setLineDash(pr.dash ? String(pr.dash).split(/[ ,]+/).map(Number) : []);
        ctx.stroke(p2);
      }
    } else if (pr.t === 'text') drawText(ctx, pr);
    else if (pr.t === 'img'){
      const im = clipImage(pr.url);
      if (im.complete && im.naturalWidth){
        // 跟 SVG 的 preserveAspectRatio="xMidYMid meet" 一樣：等比例放進框內置中
        const k = Math.min(pr.w / im.naturalWidth, pr.h / im.naturalHeight), dw = im.naturalWidth*k, dh = im.naturalHeight*k;
        if (pr.flip) ctx.scale(-1, 1);
        ctx.drawImage(im, pr.x + (pr.w - dw)/2, pr.y + (pr.h - dh)/2, dw, dh);
      }
    }
    ctx.restore();
  }
}
function drawText(ctx, pr){
  const L = layoutText(pr), passes = textPasses(pr), grad = pr.fillType === 'grad' || pr.fillType === 'grad3';
  const x = pr.x || 0, y = pr.y || 0;
  ctx.translate(x, y); ctx.rotate((+pr.rot || 0) * Math.PI/180);
  if (pr.skew) ctx.transform(1, 0, Math.tan(pr.skew * Math.PI/180), 1, 0, 0);
  ctx.scale((pr.sx ?? 100)/100, (pr.sy ?? 100)/100); ctx.translate(-x, -y);
  ctx.font = fontStr(pr); ctx.textBaseline = 'alphabetic';
  setLS(ctx, (pr.vert || L.perChar) ? 0 : (+pr.ls || 0));
  const gl = grad ? gradLine(pr, L) : null;
  const fillFor = q => {
    if (pr.fillType === 'alt') return altColor(pr, q.ci);
    if (!grad) return pr.fill || '#000';
    // 每個字的座標原點在字中心，所以漸層端點要換到字的座標系
    let [x1, y1] = localPt(q, gl[0], gl[1]), [x2, y2] = localPt(q, gl[2], gl[3]);
    const gr = ctx.createLinearGradient(x1 - q.x, y1 - q.y, x2 - q.x, y2 - q.y);
    gradStops(pr).forEach(([o, c]) => gr.addColorStop(o, c));
    return gr;
  };
  const drawPass = ps => {
    if (ps.dx || ps.dy) ctx.translate(ps.dx, ps.dy);
    for (const q of L.g){
      ctx.save(); ctx.translate(q.x, q.y); if (q.rot) ctx.rotate(q.rot * Math.PI/180); if (q.sx && q.sx !== 1) ctx.scale(q.sx, 1);
      ctx.textAlign = ALIGN[q.anchor];
      if (ps.sw > 0 && ps.stroke){ ctx.lineWidth = ps.sw; ctx.strokeStyle = ps.stroke; ctx.lineJoin = 'round'; ctx.strokeText(q.s, 0, L.bo); }
      ctx.fillStyle = ps.fill === 'FILL' ? fillFor(q) : ps.fill; ctx.fillText(q.s, 0, L.bo);
      ctx.restore();
    }
  };
  for (const ps of passes){
    if (ps.shadow){
      // 陰影單獨畫：字本身畫在畫面外，只讓陰影落在畫面內 → 陰影是整體輪廓，不會蓋到描邊上
      ctx.save();
      const m = ctx.getTransform(), k = Math.hypot(m.a, m.b), BIG = 20000;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e - BIG, m.f);
      ctx.shadowColor = pr.shC || '#000'; ctx.shadowBlur = (+pr.shB || 0) * k;
      ctx.shadowOffsetX = m.a*(+pr.shX || 0) + m.c*(+pr.shY || 0) + BIG; ctx.shadowOffsetY = m.b*(+pr.shX || 0) + m.d*(+pr.shY || 0);
      drawPass(ps);
      ctx.restore();
    }
    ctx.save(); drawPass(ps); ctx.restore();
  }
}
// 文字（含特效）實際佔的範圍，給選取框與縮放用
function textBounds(pr){
  const L = layoutText(pr), sw = +pr.sw || 0, sw2 = +pr.sw2 || 0, ex = +pr.ex || 0;
  let pad = L.size*0.12 + sw/2 + sw2;
  let { x0, y0, x1, y1 } = L.b;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  if (ex){ const a = (pr.exA ?? 45)*Math.PI/180, dx = Math.cos(a)*ex, dy = Math.sin(a)*ex; x0 = Math.min(x0, x0 + dx); x1 = Math.max(x1, x1 + dx); y0 = Math.min(y0, y0 + dy); y1 = Math.max(y1, y1 + dy); }
  if (pr.sh){ const b = +pr.shB || 0, sx = +pr.shX || 0, sy = +pr.shY || 0; x0 = Math.min(x0, x0 + sx - b); x1 = Math.max(x1, x1 + sx + b); y0 = Math.min(y0, y0 + sy - b); y1 = Math.max(y1, y1 + sy + b); }
  // 套上斜體與拉伸
  const sk = Math.tan((+pr.skew || 0)*Math.PI/180), kx = (pr.sx ?? 100)/100, ky = (pr.sy ?? 100)/100, ox = pr.x || 0, oy = pr.y || 0;
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([px, py]) => { const lx = (px - ox)*kx, ly = (py - oy)*ky; return [ox + lx + sk*ly, oy + ly]; });
  return { x0:Math.min(...cs.map(c => c[0])), x1:Math.max(...cs.map(c => c[0])), y0:Math.min(...cs.map(c => c[1])), y1:Math.max(...cs.map(c => c[1])) };
}

// 匯出前先把會用到的字形載入（Google Fonts 的中文字體是按需分段下載）
/* ---------- 內建素材（SVG）：改色後轉成 blob 網址，畫面與匯出共用 ---------- */
const clipURLs = new Map(), clipImgs = new Map();
const NAMED = { black:'#000000', white:'#ffffff', red:'#ff0000', blue:'#0000ff', green:'#008000', yellow:'#ffff00', pink:'#ffc0cb', gray:'#808080', grey:'#808080' };
function hexLum(h){
  h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126*r + 0.7152*g + 0.0722*b) / 255;
}
// 改色：把白色以外的顏色換成指定色（可選擇保留深色線條）
function recolorSVG(svg, tint, keepDark){
  svg = svg.replace(/(fill|stroke|stop-color)(="|:\s*)(black|white|red|blue|green|yellow|pink|gr[ae]y)\b/gi, (m, a, b, n) => a + b + NAMED[n.toLowerCase()]);
  svg = svg.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (m, r, g, b) => '#' + [r, g, b].map(v => (+v).toString(16).padStart(2, '0')).join(''));
  return svg.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, m => { const l = hexLum(m); if (l > 0.9) return m; if (keepDark && l < 0.2) return m; return tint; });
}
function clipURL(c, tint, keepDark){
  const key = c.id + '|' + (tint || 'none') + '|' + (keepDark ? 1 : 0);
  if (!clipURLs.has(key)){
    let svg = c.svg.replace('<svg ', `<svg width="${c.w}" height="${c.h}" `);
    if (tint && tint !== 'none') svg = recolorSVG(svg, tint, keepDark);
    clipURLs.set(key, URL.createObjectURL(new Blob([svg], { type:'image/svg+xml' })));
  }
  return clipURLs.get(key);
}
function clipImage(url){
  if (!clipImgs.has(url)){ const im = new Image(); im.src = url; clipImgs.set(url, im); }
  return clipImgs.get(url);
}
const waitImg = im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = r; });
async function ensureFonts(primLists){
  // 圖片素材也要先載入完成才能畫到匯出畫布上
  await Promise.all(primLists.flat().filter(pr => pr && pr.t === 'img').map(pr => waitImg(clipImage(pr.url))));
  const jobs = [];
  for (const prims of primLists) for (const pr of prims) if (pr && pr.t === 'text' && pr.text)
    jobs.push(document.fonts.load(fontStr(pr), String(pr.text).replace(/\n/g, '')).catch(() => {}));
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 15000))]);
}

/* ================= 形狀路徑小工具 ================= */
const f1 = n => (+n).toFixed(1);
function rectD(x, y, w, h, r = 0){
  r = Math.max(0, Math.min(r, w/2, h/2));
  if (!r) return `M${f1(x)} ${f1(y)}H${f1(x+w)}V${f1(y+h)}H${f1(x)}Z`;
  return `M${f1(x+r)} ${f1(y)}H${f1(x+w-r)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x+w)} ${f1(y+r)}V${f1(y+h-r)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x+w-r)} ${f1(y+h)}H${f1(x+r)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x)} ${f1(y+h-r)}V${f1(y+r)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x+r)} ${f1(y)}Z`;
}
function ellD(cx, cy, rx, ry){ return `M${f1(cx-rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx+rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx-rx)} ${f1(cy)}Z`; }
function polyD(pts){ return 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'Z'; }
function seeded(seed){
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}
