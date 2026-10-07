/* ================= 多人同步核心（瀏覽器與伺服器共用） =================
   作品是一棵 JSON 樹：doc → pages[] → layers[3] → panels[] / items[]。
   頁、格子、物件都有 id，所以「改了什麼」可以用 id 描述，不必靠陣列位置：

     路徑   ['pages', '#頁id', 'layers', 2, 'items', '#物件id', 'p', 'text']
            '#' 開頭 = 在陣列裡找這個 id；數字 = 固定位置（圖層）；其他 = 物件欄位

   四種操作（全部可以反過來，所以復原只會撤回「自己」的修改）：
     s  設定欄位        { o:'s', p:路徑, v:新值, u:舊值 }      v 不存在 = 刪掉欄位
     a  加入陣列        { o:'a', p:陣列路徑, v:物件, after:前一個的 id }
     r  從陣列移除      { o:'r', p:陣列路徑, id, u:原物件, after:原本前一個的 id }
     m  陣列重新排序    { o:'m', p:陣列路徑, ids:新順序, u:舊順序 }

   兩個人同時改同一個欄位時，以伺服器上「後到」的為準（逐欄位覆蓋）。 */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CPSync = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  // 每一層要怎麼比對：'obj' = 逐鍵比對；list = 以 id 比對的陣列；tuple = 固定長度陣列；其餘欄位整個值比對
  const LEAF = null;
  const ITEM  = { fields:{ p:'obj' } };
  const PANEL = { fields:{} };
  const LAYER = { fields:{ panels:{ list:PANEL }, items:{ list:ITEM } } };
  const PAGE  = { fields:{ ov:'obj', layers:{ tuple:LAYER } } };
  const ROOT  = { fields:{ settings:'obj', pages:{ list:PAGE } }, only:['name', 'settings', 'pages'] };

  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function setOp(path, k, v, u){
    const op = { o:'s', p:path.concat([k]) };
    if (v !== undefined) op.v = clone(v);
    if (u !== undefined) op.u = clone(u);
    return op;
  }

  // 逐鍵比對一個普通物件（settings、ov、物件的 p）
  function diffObj(path, a, b, out){
    a = a || {}; b = b || {};
    for (const k of Object.keys(b)) if (!has(a, k) || !same(a[k], b[k])) out.push(setOp(path, k, b[k], a[k]));
    for (const k of Object.keys(a)) if (!has(b, k)) out.push(setOp(path, k, undefined, a[k]));
  }

  function diffNode(path, a, b, schema, out){
    const keys = new Set(schema.only || [...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys){
      const sub = schema.fields[k], av = a[k], bv = b[k];
      if (sub === 'obj' && av && bv && typeof av === 'object' && typeof bv === 'object') diffObj(path.concat([k]), av, bv, out);
      else if (sub && sub.list && Array.isArray(av) && Array.isArray(bv)) diffList(path.concat([k]), av, bv, sub.list, out);
      else if (sub && sub.tuple && Array.isArray(av) && Array.isArray(bv) && av.length === bv.length)
        av.forEach((x, i) => diffNode(path.concat([k, i]), x, bv[i], sub.tuple, out));
      else if (has(b, k) ? (!has(a, k) || !same(av, bv)) : has(a, k)) out.push(setOp(path, k, bv, av));
    }
  }

  function diffList(path, a, b, schema, out){
    const am = new Map(a.map(x => [x.id, x])), bm = new Map(b.map(x => [x.id, x]));
    // 沒有 id 或 id 重複的陣列無法逐一比對 → 整個換掉
    if (am.size !== a.length || bm.size !== b.length || a.some(x => !x || x.id == null) || b.some(x => !x || x.id == null)){
      const parent = path.slice(0, -1), k = path[path.length - 1];
      out.push(setOp(parent, k, b, a)); return;
    }
    // 1) 移除：從後往前記，這樣復原時（反過來做）會由前往後加回去，after 指向的元素一定已經在
    const cur = a.filter(x => bm.has(x.id)).map(x => x.id);
    for (let i = a.length - 1; i >= 0; i--){
      const x = a[i];
      if (!bm.has(x.id)) out.push({ o:'r', p:path, id:x.id, u:clone(x), after:i ? a[i - 1].id : null });
    }
    // 2) 加入（依新陣列的順序，after 指向新陣列中的前一個）
    b.forEach((x, i) => {
      if (am.has(x.id)) return;
      const after = i ? b[i - 1].id : null;
      out.push({ o:'a', p:path, v:clone(x), after });
      cur.splice(after == null ? 0 : cur.indexOf(after) + 1, 0, x.id);
    });
    // 3) 順序不同 → 重新排序
    const want = b.map(x => x.id);
    if (cur.join() !== want.join()) out.push({ o:'m', p:path, ids:want, u:a.filter(x => bm.has(x.id)).map(x => x.id) });
    // 4) 兩邊都有的元素，逐欄位比對
    for (const x of b){ const o = am.get(x.id); if (o) diffNode(path.concat(['#' + x.id]), o, x, schema, out); }
  }

  function diff(a, b){ const out = []; diffNode([], a, b, ROOT, out); return out; }

  // 沿著路徑找到節點；找不到（例如那個物件已被別人刪掉）回傳 undefined
  function resolve(doc, path){
    let n = doc;
    for (const seg of path){
      if (n == null || typeof n !== 'object') return undefined;
      if (typeof seg === 'string' && seg[0] === '#'){
        if (!Array.isArray(n)) return undefined;
        const id = seg.slice(1); n = n.find(x => x && x.id === id);
      } else {
        if (BAD_KEYS.has(seg)) return undefined;
        n = n[seg];
      }
    }
    return n;
  }

  function validPath(p){
    return Array.isArray(p) && p.length <= 16 && p.every(s => (typeof s === 'number' && s >= 0 && s < 1e6) || (typeof s === 'string' && s.length <= 64 && !BAD_KEYS.has(s)));
  }
  function validOp(op){
    if (!op || typeof op !== 'object' || !validPath(op.p)) return false;
    switch (op.o){
      case 's': return op.p.length >= 1;
      case 'a': return !!op.v && typeof op.v === 'object' && typeof op.v.id === 'string' && (op.after == null || typeof op.after === 'string');
      case 'r': return typeof op.id === 'string';
      case 'm': return Array.isArray(op.ids) && op.ids.every(x => typeof x === 'string');
    }
    return false;
  }

  // 套用一個操作；回傳是否真的有改到東西
  function apply(doc, op){
    switch (op.o){
      case 's': {
        const parent = resolve(doc, op.p.slice(0, -1)), k = op.p[op.p.length - 1];
        if (parent == null || typeof parent !== 'object') return false;
        if (typeof k === 'string' && k[0] === '#') return false;
        if (has(op, 'v')) parent[k] = clone(op.v); else if (Array.isArray(parent)) return false; else delete parent[k];
        return true;
      }
      case 'a': {
        const list = resolve(doc, op.p);
        if (!Array.isArray(list) || list.some(x => x && x.id === op.v.id)) return false;
        const at = op.after == null ? 0 : list.findIndex(x => x && x.id === op.after) + 1;
        list.splice(at > 0 || op.after == null ? at : list.length, 0, clone(op.v));
        return true;
      }
      case 'r': {
        const list = resolve(doc, op.p);
        if (!Array.isArray(list)) return false;
        const i = list.findIndex(x => x && x.id === op.id);
        if (i < 0) return false;
        list.splice(i, 1); return true;
      }
      case 'm': {
        const list = resolve(doc, op.p);
        if (!Array.isArray(list)) return false;
        const by = new Map(list.map(x => [x && x.id, x]));
        const ordered = op.ids.filter(id => by.has(id)).map(id => by.get(id));
        const rest = list.filter(x => !op.ids.includes(x && x.id));
        const next = ordered.concat(rest);
        if (next.every((x, i) => x === list[i])) return false;
        list.splice(0, list.length, ...next); return true;
      }
    }
    return false;
  }

  function invert(op){
    switch (op.o){
      case 's': { const r = { o:'s', p:op.p }; if (has(op, 'u')) r.v = op.u; if (has(op, 'v')) r.u = op.v; return r; }
      case 'a': return { o:'r', p:op.p, id:op.v.id, u:op.v, after:op.after };
      case 'r': return { o:'a', p:op.p, v:op.u, after:op.after };
      case 'm': return { o:'m', p:op.p, ids:op.u, u:op.ids };
    }
  }
  const invertAll = ops => ops.slice().reverse().map(invert);

  // 傳給伺服器時不需要舊值（省流量）
  function wire(op){ const r = { ...op }; delete r.u; return r; }

  // 兩個操作是否搶同一個位置（用於「我還有沒送達的修改時，先忽略別人對同一處的修改」）
  function target(op){ return (op.o === 's' ? 's:' : op.o === 'm' ? 'm:' : 'x:') + JSON.stringify(op.p); }

  return { diff, apply, invert, invertAll, resolve, validOp, wire, target, clone };
});
