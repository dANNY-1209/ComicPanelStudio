// 隨機改動作品樹，檢查：diff 套回去會變成新版本；反向操作會變回舊版本。
const S = require('../../js/sync-core.js');
const assert = require('assert');
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const uid = () => Math.floor(rnd() * 1e9).toString(36);
const item = () => ({ id:uid(), k:'bubble', x:rnd()*100, y:rnd()*100, p:{ text:'hi' + uid(), size:20, tails:[{ tx:1 }] } });
const panel = () => ({ id:uid(), pts:[[0,0],[1,0],[1,1]], img:rnd() < .5 ? null : { a:uid(), s:1 }, sw:6 });
const layer = () => ({ visible:true, opacity:1, locked:false, panels:[panel(), panel()], items:[item()] });
const page = () => ({ id:uid(), kind:'page', ov:{}, layers:[layer(), layer(), layer()] });
const mkdoc = () => ({ version:3, name:'t', settings:{ w:1600, h:2259, margin:80 }, pages:[page(), page(), page()] });

function mutate(d){
  const n = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++){
    const pg = pick(d.pages), L = pick(pg.layers), r = rnd();
    if (r < .1) d.pages.splice(Math.floor(rnd() * d.pages.length), 0, page());
    else if (r < .15 && d.pages.length > 1) d.pages.splice(Math.floor(rnd() * d.pages.length), 1);
    else if (r < .2) d.pages.reverse();
    else if (r < .3) L.items.push(item());
    else if (r < .35 && L.items.length) L.items.splice(0, 1);
    else if (r < .4) L.panels.reverse();
    else if (r < .5 && L.items.length){ const it = pick(L.items); it.p.text = 'x' + uid(); if (rnd() < .3) delete it.p.size; }
    else if (r < .6 && L.panels.length){ const p = pick(L.panels); p.pts = [[rnd(), 2], [3, 4], [5, 6]]; }
    else if (r < .65) pg.ov.margin = rnd() < .5 ? 10 : undefined, pg.ov.margin === undefined && delete pg.ov.margin;
    else if (r < .7) d.settings.margin = Math.round(rnd() * 100);
    else if (r < .75) d.name = 'n' + uid();
    else if (r < .8) L.visible = !L.visible;
    else if (r < .85){ L.panels = [panel(), ...L.panels.slice(1)]; }
    else if (r < .9 && L.panels.length){ const p = L.panels.pop(); pick(pg.layers).panels.push(p); }
    else L.tpl = { i:3, sig:'x' };
  }
}
for (let round = 0; round < 3000; round++){
  const a = mkdoc(); mutate(a); const before = S.clone(a); mutate(a); const after = S.clone(a);
  const ops = S.diff(before, after);
  const x = S.clone(before); ops.forEach(op => { assert(S.validOp(S.wire(op)), 'invalid ' + JSON.stringify(op)); S.apply(x, S.wire(op)); });
  assert.deepStrictEqual(x, after, 'forward round ' + round);
  S.invertAll(ops).forEach(op => S.apply(x, op));
  assert.deepStrictEqual(x, before, 'inverse round ' + round);
  // 經過 JSON（伺服器傳輸）也一樣
  const y = S.clone(before); JSON.parse(JSON.stringify(ops.map(S.wire))).forEach(op => S.apply(y, op));
  assert.deepStrictEqual(y, after);
}
// 原型污染防護
assert.strictEqual(S.validOp({ o:'s', p:['__proto__', 'x'], v:1 }), false);
const z = {}; S.apply(z, { o:'s', p:['constructor', 'prototype', 'x'], v:1 }); assert.strictEqual({}.x, undefined);
console.log('sync-core ok');
