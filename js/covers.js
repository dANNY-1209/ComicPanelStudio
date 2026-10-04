'use strict';
/* ================= 封面 / 封底模板 =================
   參考常見排版慣例：
   · 單行本：滿版插圖、上方大標題 Logo、集數標、下方作者名、出版社 Logo
   · 同人誌：標題、社團名／作者名、活動新刊標，成人向作品在封面明顯處放 R18 / 成人向標示
   · 書腰：下方約 1/5 高的色帶放宣傳文案
   · 封底：故事簡介、條碼與定價區、社團 Logo、成人警語、版權頁（奧付）
   make(W,H) 回傳 { ov, panels:[{pts, sw}], items:[newItem 參數] } */
const bleedP = (W, H) => ({ pts:[[0,0],[W,0],[W,H],[0,H]], sw:0 });
const rectP = (x0, y0, x1, y1, sw = 0) => ({ pts:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]], sw });
const I = (k, x, y, w, h, p, r) => ({ k, x, y, w, h, p, r });
const TX = (x, y, p, r) => ({ k:'text', x, y, p, r });   // 文字物件
const outlined = (W, size, extra) => ({ size, fill:'#ffffff', stroke:'#111111', sw:size*0.2, ...extra });

const COVERS = [
  { kind:'cover', name:['經典單行本','Tankobon'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      I('titlelogo', W/2, H*0.12, W*0.92, H*0.16),
      I('vol', W*0.87, H*0.27, W*0.14, W*0.14),
      I('logo', W*0.9, H*0.875, W*0.09, W*0.09),
      TX(W/2, H*0.955, { text:t('s_byline'), font:'Noto Serif TC', weight:700, ...outlined(W, W*0.034) }) ] }) },
  { kind:'cover', name:['同人誌（成人向）','Doujin (adult)'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      TX(W*0.86, H*0.3, { text:t('s_title'), font:'Dela Gothic One', vert:true, lh:1.1, ...outlined(W, W*0.1) }),
      I('event', W*0.19, H*0.045, W*0.3, W*0.07),
      I('circle', W*0.28, H*0.905, W*0.46, W*0.14),
      I('r18c', W*0.88, H*0.915, W*0.15, W*0.15) ] }) },
  { kind:'cover', name:['同人誌（全年齡）','Doujin (all ages)'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      I('titlelogo', W/2, H*0.13, W*0.9, H*0.15, { font:'Mochiy Pop One', in:'#ff6fa5' }),
      I('event', W*0.19, H*0.045, W*0.3, W*0.07),
      I('circle', W*0.28, H*0.905, W*0.46, W*0.14),
      I('allage', W*0.85, H*0.93, W*0.22, W*0.07) ] }) },
  { kind:'cover', name:['書腰款','With obi band'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      I('titlelogo', W/2, H*0.13, W*0.9, H*0.16),
      I('obi', W/2, H*0.9, W, H*0.2),
      I('burst', W*0.8, H*0.74, W*0.3, W*0.22) ] }) },
  { kind:'cover', name:['雜誌風','Magazine'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      TX(W/2, H*0.085, { text:'COMIC', font:'Anton', size:W*0.24, fill:'#e60012', stroke:'#ffffff', sw:W*0.014, ls:W*0.01 }),
      I('tag', W*0.86, H*0.18, W*0.2, W*0.065, { text:'No.01' }),
      TX(W*0.25, H*0.33, { text:t('s_line1'), weight:900, ...outlined(W, W*0.045) }),
      TX(W*0.25, H*0.41, { text:t('s_line2'), weight:900, ...outlined(W, W*0.045) }),
      TX(W*0.25, H*0.49, { text:t('s_line3'), weight:900, ...outlined(W, W*0.045) }),
      I('burst', W*0.78, H*0.8, W*0.32, W*0.24, { text:t('s_newser') }) ] }) },
  { kind:'cover', name:['典雅邊框','Framed classic'], make:(W, H) => ({ ov:{ bg:'#f4efe6' }, panels:[rectP(W*0.12, H*0.09, W*0.88, H*0.66)], items:[
      I('frame', W/2, H/2, W, H, { color:'#8a6d3b', inset:W*0.04, gap:W*0.012, lw:W*0.004 }),
      TX(W/2, H*0.75, { text:t('s_title'), font:'Noto Serif TC', weight:900, size:W*0.08, fill:'#2b2118' }),
      TX(W/2, H*0.82, { text:t('s_sub'), font:'Noto Serif TC', size:W*0.032, fill:'#6b5a45', ls:W*0.01 }),
      TX(W/2, H*0.9, { text:t('s_author'), font:'Noto Serif TC', weight:700, size:W*0.036, fill:'#2b2118' }) ] }) },
  { kind:'cover', name:['直書和風','Vertical Japanese'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      TX(W*0.83, H*0.34, { text:t('s_title'), font:'Zen Antique', vert:true, ...outlined(W, W*0.13, { sw:W*0.02 }) }),
      I('seal', W*0.83, H*0.76, W*0.1, W*0.1),
      TX(W*0.1, H*0.78, { text:t('s_author'), font:'Noto Serif TC', weight:700, vert:true, ...outlined(W, W*0.04, { sw:W*0.008 }) }) ] }) },
  { kind:'cover', name:['對角雙圖','Diagonal split'], make:(W, H) => ({
      panels:layoutPolys({ d:'h', z:[1,1], k:[0.6] }, [[0,0],[W,0],[W,H],[0,H]], W*0.025).map(pts => ({ pts, sw:0 })), items:[
      TX(W/2, H/2, { text:t('s_title'), font:'Dela Gothic One', ...outlined(W, W*0.11, { sw:W*0.022 }) }, Math.atan2(H*0.6, W) * 180/Math.PI),
      TX(W*0.72, H*0.955, { text:t('s_byline'), weight:700, ...outlined(W, W*0.034) }) ] }) },
  { kind:'cover', name:['極簡深色','Minimal dark'], make:(W, H) => ({ ov:{ bg:'#1c1c1e' }, panels:[rectP(W*0.15, H*0.16, W*0.85, H*0.16 + W*0.7)], items:[
      I('tag', W/2, H*0.08, W*0.18, W*0.055, { text:'VOL.1', color:'#f2f2f2', fg:'#1c1c1e' }),
      TX(W/2, H*0.16 + W*0.7 + H*0.08, { text:t('s_title'), font:'Noto Serif TC', weight:900, size:W*0.075, fill:'#f2f2f2', ls:W*0.006 }),
      TX(W/2, H*0.92, { text:t('s_author'), font:'Noto Serif TC', size:W*0.032, fill:'#9a9a9e' }) ] }) },
  { kind:'cover', name:['分格拼貼','Panel collage'], make:(W, H) => ({
      panels:layoutPolys({ d:'h', z:[1.2,1], k:[0.06], c:[null, { d:'v', z:[1,1], k:[0.15] }] }, [[W*0.05,H*0.2],[W*0.95,H*0.2],[W*0.95,H*0.95],[W*0.05,H*0.95]], W*0.02).map(pts => ({ pts, sw:W*0.005 })), items:[
      TX(W/2, H*0.1, { text:t('s_title'), font:'Dela Gothic One', size:W*0.11, fill:'#111111' }),
      I('tag', W*0.86, H*0.175, W*0.18, W*0.05, { text:'VOL.1' }) ] }) },

  { kind:'back', name:['簡介＋條碼','Synopsis & barcode'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      I('synopsis', W/2, H*0.3, W*0.82, H*0.3),
      I('barcode', W*0.8, H*0.89, W*0.3, W*0.17),
      I('logo', W*0.13, H*0.9, W*0.1, W*0.1) ] }) },
  { kind:'back', name:['同人誌封底','Doujin back'], make:(W, H) => ({ ov:{ bg:'#ffffff' }, panels:[rectP(W*0.2, H*0.07, W*0.8, H*0.07 + W*0.6, 6)], items:[
      I('r18c', W*0.9, H*0.06, W*0.12, W*0.12),
      I('notice', W/2, H*0.6, W*0.84, W*0.2),
      I('colophon', W/2, H*0.83, W*0.84, H*0.2) ] }) },
  { kind:'back', name:['角色介紹','Characters'], make:(W, H) => {
      const polys = layoutPolys({ d:'v', z:[1,1,1] }, [[W*0.06,H*0.06],[W*0.94,H*0.06],[W*0.94,H*0.36],[W*0.06,H*0.36]], W*0.02);
      return { ov:{ bg:'#ffffff' }, panels:polys.map(pts => ({ pts, sw:6 })), items:[
        ...[0, 1, 2].map(i => I('tag', W*0.06 + W*0.88/3*(i + 0.5), H*0.395, W*0.2, W*0.055, { text:t('s_char') + (i + 1) })),
        I('synopsis', W/2, H*0.61, W*0.88, H*0.26, { bg:'#f3f3f3', bgop:1 }),
        I('barcode', W*0.8, H*0.89, W*0.3, W*0.17),
        I('logo', W*0.13, H*0.9, W*0.1, W*0.1) ] }; } },
  { kind:'back', name:['版權頁（奧付）','Colophon page'], make:(W, H) => ({ ov:{ bg:'#ffffff' }, panels:[], items:[
      TX(W/2, H*0.12, { text:t('s_title'), font:'Noto Serif TC', weight:700, size:W*0.05 }),
      I('logo', W/2, H*0.36, W*0.13, W*0.13),
      I('colophon', W/2, H*0.72, W*0.8, H*0.32) ] }) },
  { kind:'back', name:['滿版延續','Wraparound art'], make:(W, H) => ({ panels:[bleedP(W, H)], items:[
      I('titlelogo', W/2, H*0.09, W*0.6, H*0.08),
      TX(W/2, H*0.16, { text:t('s_byline'), weight:700, ...outlined(W, W*0.03) }),
      I('barcode', W*0.8, H*0.89, W*0.3, W*0.17) ] }) },
  { kind:'back', name:['極簡深色','Minimal dark'], make:(W, H) => ({ ov:{ bg:'#1c1c1e' }, panels:[], items:[
      I('logo', W/2, H*0.45, W*0.16, W*0.16, { color:'#f2f2f2', bg:'#1c1c1e' }),
      TX(W/2, H*0.58, { text:t('s_circle'), font:'Noto Serif TC', size:W*0.04, fill:'#f2f2f2' }),
      I('barcode', W*0.82, H*0.9, W*0.26, W*0.15),
      TX(W*0.3, H*0.92, { text:t('s_byline'), size:W*0.028, fill:'#9a9a9e' }) ] }) },
];
