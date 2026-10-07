// 伺服器端到端測試：起一個臨時伺服器（DEV_BYPASS 登入），模擬擁有者、編輯者、檢視者、陌生人。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const S = require('../../js/sync-core.js');

const tmp = fs.mkdtempSync(path.join(process.env.CPS_TEST_TMP || os.tmpdir(), 'cps-test-'));
const OWNER = '100000000000000001', ED = '100000000000000002', VIEW = '100000000000000003', STRANGER = '100000000000000009', MEMBER = '100000000000000004';
fs.mkdirSync(path.join(tmp, 'auth'), { recursive:true });
fs.writeFileSync(path.join(tmp, 'auth/whitelist.json'), JSON.stringify({ discord:[ED, VIEW, MEMBER] }));
fs.writeFileSync(path.join(tmp, 'auth/admins.json'), JSON.stringify({ discord:[] }));
fs.writeFileSync(path.join(tmp, 'auth/users.json'), JSON.stringify({ discord:{ [ED]:{ n:'Editor' }, [VIEW]:{ n:'Viewer' }, [MEMBER]:{ n:'Member' } } }));
Object.assign(process.env, { CPS_DATA:tmp, CPS_AUTH_DIR:path.join(tmp, 'auth'), CPS_OWNER_DISCORD_ID:OWNER, CPS_DEV_BYPASS:OWNER, NODE_ENV:'development', PORT:'0' });
const { server } = require('../server.js');

let base;
const cookieOf = {};
async function login(id){
  const r = await fetch(`${base}/auth/login?as=${id}`, { redirect:'manual' });
  cookieOf[id] = r.headers.get('set-cookie').split(';')[0];
}
async function req(id, method, url, body, headers = {}){
  const r = await fetch(base + url, { method, headers:{ Cookie:cookieOf[id] || '', ...(body && !(body instanceof Buffer) ? { 'Content-Type':'application/json' } : {}), ...headers },
    body:body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined, redirect:'manual' });
  const ct = r.headers.get('content-type') || '';
  return { status:r.status, body:ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
function client(id, pid){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?p=${pid}`, { headers:{ Cookie:cookieOf[id] } });
    const c = { ws, msgs:[], waiters:[] };
    ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter(w => !(w.f(m) && (w.r(m), true))); });
    ws.on('open', () => resolve(c));
    ws.on('unexpected-response', (q, r) => reject(new Error('ws ' + r.statusCode)));
    ws.on('error', reject);
    c.send = m => ws.send(JSON.stringify(m));
    c.wait = (f, ms = 3000) => { const hit = c.msgs.find(f); if (hit){ c.msgs.splice(c.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((r, j) => { const w = { f, r:m => { c.msgs.splice(c.msgs.indexOf(m), 1); r(m); } }; c.waiters.push(w); setTimeout(() => j(new Error('timeout waiting')), ms); }); };
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const docOf = () => ({ version:3, name:'x', settings:{ w:1600, h:2259, margin:80 }, pages:[{ id:'pg1', kind:'page', ov:{}, layers:[
  { visible:true, opacity:1, locked:false, panels:[{ id:'pa1', pts:[[0,0],[1,0],[1,1]], img:null, sw:6 }], items:[] },
  { visible:true, opacity:1, locked:false, panels:[], items:[] },
  { visible:true, opacity:1, locked:false, panels:[], items:[{ id:'it1', k:'bubble', x:10, y:10, p:{ text:'hi', size:20 } }] } ] }] });

(async () => {
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const id of [OWNER, ED, VIEW, STRANGER, MEMBER]) await login(id);

  // 沒登入、沒權限
  assert.strictEqual((await req(null, 'GET', '/api/projects')).status, 401);
  assert.strictEqual((await req(STRANGER, 'GET', '/api/projects')).status, 403);
  assert.strictEqual((await req(STRANGER, 'GET', '/')).status, 403);
  assert.strictEqual((await req(OWNER, 'GET', '/')).status, 200);

  // 建立專案、分享
  const p = (await req(OWNER, 'POST', '/api/projects', { name:'測試漫畫' })).body;
  assert.ok(p.id && p.access === 'own');
  assert.strictEqual((await req(ED, 'GET', '/api/projects/' + p.id)).status, 404, 'not shared yet');
  assert.strictEqual((await req(ED, 'PUT', `/api/projects/${p.id}/shares`, { shares:{ [ED]:'edit' } })).status, 404);
  const sh = await req(OWNER, 'PUT', `/api/projects/${p.id}/shares`, { shares:{ [ED]:'edit', [VIEW]:'view', [OWNER]:'view', bad:'edit', [MEMBER]:'admin' } });
  assert.deepStrictEqual(sh.body.shares, { [ED]:'edit', [VIEW]:'view' });
  assert.strictEqual((await req(ED, 'GET', '/api/projects')).body.shared.length, 1);
  assert.strictEqual((await req(OWNER, 'GET', '/p/' + p.id)).status, 200);
  assert.strictEqual((await req(MEMBER, 'GET', '/p/' + p.id)).status, 404);
  const users = (await req(ED, 'GET', '/api/users')).body;
  assert.ok(users.some(u => u.name === 'Editor') && users.some(u => u.id === OWNER));

  // 即時協作
  await assert.rejects(client(MEMBER, p.id), /403/);
  const A = await client(OWNER, p.id), hA = await A.wait(m => m.t === 'hello');
  assert.strictEqual(hA.doc, null); assert.strictEqual(hA.access, 'own');
  A.send({ t:'init', b:1, doc:docOf() }); await A.wait(m => m.t === 'ack' && m.b === 1);
  const B = await client(ED, p.id), hB = await B.wait(m => m.t === 'hello');
  assert.strictEqual(hB.doc.name, '測試漫畫', 'init takes project name');
  const V = await client(VIEW, p.id), hV = await V.wait(m => m.t === 'hello');
  assert.strictEqual(hV.access, 'view');
  const pres = await A.wait(m => m.t === 'pres' && m.users.length === 3);
  assert.ok(pres.users.every(u => u.color));

  // A 改文字，B、V 收到；A 收到 ack
  const local = S.clone(hB.doc), next = S.clone(local);
  next.pages[0].layers[2].items[0].p.text = 'hello';
  next.pages[0].layers[0].panels.push({ id:'pa2', pts:[[5,5],[6,5],[6,6]], img:null, sw:2 });
  const ops = S.diff(local, next).map(S.wire);
  A.send({ t:'ops', b:2, ops });
  await A.wait(m => m.t === 'ack' && m.b === 2);
  const got = await B.wait(m => m.t === 'ops');
  assert.strictEqual(got.ops.length, ops.length);
  got.ops.forEach(op => S.apply(local, op));
  assert.deepStrictEqual(local, next);
  await V.wait(m => m.t === 'ops');

  // 檢視者送修改會被拒絕
  V.send({ t:'ops', b:9, ops:[{ o:'s', p:['name'], v:'hack' }] });
  assert.strictEqual((await V.wait(m => m.t === 'nack')).reason, 'readonly');
  // 惡意路徑被過濾
  A.send({ t:'ops', b:3, ops:[{ o:'s', p:['__proto__', 'polluted'], v:1 }] });
  await A.wait(m => m.t === 'ack' && m.b === 3);
  assert.strictEqual({}.polluted, undefined);

  // 圖片上傳：上傳者不會收到自己的廣播，其他人會
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await req(ED, 'PUT', `/api/projects/${p.id}/assets/img01?name=a.png&w=1&h=1`, png, { 'Content-Type':'image/png', 'X-CPS-Cid':hB.cid });
  assert.strictEqual(up.status, 200);
  assert.strictEqual((await A.wait(m => m.t === 'asset')).rec.id, 'img01');
  assert.strictEqual((await req(VIEW, 'PUT', `/api/projects/${p.id}/assets/img02`, png, { 'Content-Type':'image/png' })).status, 403);
  assert.strictEqual((await req(ED, 'PUT', `/api/projects/${p.id}/assets/img03`, png, { 'Content-Type':'text/html' })).status, 415);
  const dl = await req(VIEW, 'GET', `/api/projects/${p.id}/assets/img01`);
  assert.strictEqual(dl.status, 200); assert.ok(dl.body.equals(png));
  assert.strictEqual((await req(ED, 'GET', `/api/projects/${p.id}/assets/..%2Fmeta.json`)).status, 404);

  // 重新命名會同步到線上的人
  await req(ED, 'PATCH', '/api/projects/' + p.id, { name:'改名了' });
  const rn = await A.wait(m => m.t === 'ops' && m.ops[0].p[0] === 'name');
  assert.strictEqual(rn.ops[0].v, '改名了');

  // 把編輯者降為檢視：線上立刻改權限；移除分享：被請出去
  await req(OWNER, 'PUT', `/api/projects/${p.id}/shares`, { shares:{ [ED]:'view' } });
  assert.strictEqual((await B.wait(m => m.t === 'access')).access, 'view');
  assert.strictEqual((await V.wait(m => m.t === 'kick')).reason, 'unshared');

  // 副本、存檔、版本紀錄
  const copy = (await req(ED, 'POST', `/api/projects/${p.id}/duplicate`)).body;
  assert.strictEqual(copy.access, 'own'); assert.ok(copy.name.startsWith('改名了'));
  assert.strictEqual((await req(ED, 'GET', `/api/projects/${copy.id}/assets/img01`)).status, 200, 'copy keeps images');
  A.ws.close(); B.ws.close(); V.ws.close();
  await sleep(300);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'projects', p.id, 'doc.json')));
  assert.strictEqual(saved.doc.pages[0].layers[2].items[0].p.text, 'hello');
  assert.strictEqual(saved.doc.name, '改名了');
  const hist = (await req(OWNER, 'GET', `/api/projects/${p.id}/history`)).body;
  assert.ok(hist.length >= 1, 'snapshot on close');

  // 刪除：只有擁有者
  assert.strictEqual((await req(ED, 'DELETE', '/api/projects/' + p.id)).status, 403);
  assert.strictEqual((await req(OWNER, 'DELETE', '/api/projects/' + p.id)).status, 200);
  assert.strictEqual((await req(OWNER, 'GET', '/api/projects/' + p.id)).status, 404);
  assert.ok(fs.readdirSync(path.join(tmp, 'trash')).some(f => f.startsWith(p.id)), 'moved to trash');

  console.log('server ok');
  server.close(); fs.rmSync(tmp, { recursive:true, force:true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
