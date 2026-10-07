'use strict';
/* ================= Comic Panel Studio 線上版伺服器 =================
   沒有這個伺服器時，index.html 就是原本的單機版；有它時多了：
     · Discord 登入，權限來自 Sanctum（write-through 寫進 AUTH_DIR 的 json 檔，這裡只讀）
     · 雲端專案：每個專案有擁有者，可以分享給別人「可編輯」或「僅檢視」
     · 多人即時編輯：WebSocket 收送修改（格式見 js/sync-core.js），伺服器決定先後順序

   資料夾（DATA_DIR）：
     projects/<pid>/meta.json     名稱、擁有者、分享名單、時間
     projects/<pid>/doc.json      作品內容 { seq, doc }
     projects/<pid>/assets/       圖片原檔（檔名 = 圖片 id），assets.json 是索引
     projects/<pid>/fonts/        匯入的字體，fonts.json 是索引
     projects/<pid>/thumb.jpg     第一頁縮圖（專案列表用）
     projects/<pid>/history/      自動版本快照（最多 HISTORY_KEEP 份）
     trash/<pid>-<時間>/          刪掉的專案（不會真的刪，要清請手動）
     users.json                   登入過的人的名字與頭像
*/
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Sync = require('../js/sync-core.js');

const ENV = process.env;
const PORT          = +ENV.PORT || 3003;
const APP_ROOT      = path.resolve(__dirname, '..');
const DATA_DIR      = path.resolve(ENV.CPS_DATA || path.join(APP_ROOT, 'data'));
const AUTH_DIR      = path.resolve(ENV.CPS_AUTH_DIR || path.join(DATA_DIR, 'auth'));
const OWNER_ID      = (ENV.CPS_OWNER_DISCORD_ID || '').trim();
const CLIENT_ID     = ENV.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = ENV.DISCORD_CLIENT_SECRET || '';
const PUBLIC_URL    = (ENV.CPS_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI  = PUBLIC_URL + '/auth/discord/callback';
const SANCTUM_URL   = (ENV.CPS_SANCTUM_URL || '').replace(/\/$/, '');   // 權限申請頁（例如 Sanctum）；沒設就不顯示連結
const SECURE_COOKIE = (ENV.NODE_ENV || 'production') === 'production';
const SECRET        = ENV.CPS_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
// 本機測試用：設了就不走 Discord，直接以這個 discord_id 登入（?as=<id> 可切換身分）。正式環境絕不能設。
const DEV_BYPASS    = (ENV.CPS_DEV_BYPASS || '').trim();
const COOKIE        = 'cps_session';
const MAX_ASSET     = 40 * 1024 * 1024;
const MAX_FONT      = 30 * 1024 * 1024;
const MAX_WS_MSG    = 16 * 1024 * 1024;
const SAVE_DELAY    = 1500;
const HISTORY_EVERY = 10 * 60 * 1000;
const HISTORY_KEEP  = 60;

const PROJ_DIR  = path.join(DATA_DIR, 'projects');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
fs.mkdirSync(PROJ_DIR, { recursive:true });
fs.mkdirSync(TRASH_DIR, { recursive:true });

const now = () => Date.now();
const newId = (n = 10) => crypto.randomBytes(16).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, n).padEnd(n, '0');
const ID_RE = /^[a-z0-9]{4,24}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function writeJSON(file, obj){
  const tmp = file + '.' + process.pid + '.' + newId(6) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj));
  await fsp.rename(tmp, file);
}
function readJSONSync(file, dflt){ try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } }

/* ================= 簽章（session cookie 與 OAuth state 共用） ================= */
const b64u = b => Buffer.from(b).toString('base64url');
function sign(obj, ttlSec){
  const p = b64u(JSON.stringify({ ...obj, e:Math.floor(now()/1000) + ttlSec }));
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
}
function verify(tok){
  if (!tok || typeof tok !== 'string') return null;
  const [p, s] = tok.split('.');
  if (!p || !s) return null;
  const good = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e * 1000 > now() ? o : null; } catch { return null; }
}
function cookies(req){
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}

/* ================= 權限：Sanctum write-through 的白名單 =================
   AUTH_DIR/whitelist.json {discord:[…]}  能使用本站的人
   AUTH_DIR/admins.json    {discord:[…]}  站內管理員（看得到所有專案）
   AUTH_DIR/users.json     {discord:{id:{n,a}}}  名字與頭像（Sanctum 一起寫）
   owner 走環境變數，永遠是管理員。 */
let aclCache = { t:0, wl:new Set(), ad:new Set(), names:{} };
function acl(){
  if (now() - aclCache.t > 30000){
    const ids = f => new Set((readJSONSync(path.join(AUTH_DIR, f), {}).discord || []).map(String));
    aclCache = { t:now(), wl:ids('whitelist.json'), ad:ids('admins.json'), names:readJSONSync(path.join(AUTH_DIR, 'users.json'), {}).discord || {} };
  }
  return aclCache;
}
function roleOf(did){
  if (!did) return null;
  if (OWNER_ID && did === OWNER_ID) return 'admin';
  const a = acl();
  if (a.ad.has(did)) return 'admin';
  if (a.wl.has(did)) return 'user';
  return null;
}
// 登入過的人：名字、頭像
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const localUsers = readJSONSync(USERS_FILE, {});
function profile(did){
  const s = acl().names[did] || {}, l = localUsers[did] || {};
  const n = l.n || s.n || ('user ' + String(did).slice(-4)), a = l.a || s.a || '';
  return { id:did, name:n, avatar:a ? `https://cdn.discordapp.com/avatars/${did}/${a}.png?size=64` : '' };
}
async function rememberUser(did, n, a){
  localUsers[did] = { n, a, t:now() };
  await writeJSON(USERS_FILE, localUsers).catch(e => log('users.json', e.message));
}
function roster(){
  const a = acl(), ids = new Set([...a.wl, ...a.ad]);
  if (OWNER_ID) ids.add(OWNER_ID);
  return [...ids].map(profile).sort((x, y) => x.name.localeCompare(y.name));
}

/* ================= 專案 ================= */
const projects = new Map();     // pid → meta
for (const pid of fs.readdirSync(PROJ_DIR)){
  const m = readJSONSync(path.join(PROJ_DIR, pid, 'meta.json'), null);
  if (m && m.id === pid) projects.set(pid, m);
}
const pdir = pid => path.join(PROJ_DIR, pid);
const saveMeta = m => writeJSON(path.join(pdir(m.id), 'meta.json'), m);

// 這個人對這個專案的權限：'own' | 'edit' | 'view' | null（站內管理員至少可看）
function access(m, did, role){
  if (!m || !did) return null;
  if (m.owner === did) return 'own';
  const s = m.shares && m.shares[did];
  if (s === 'edit' || s === 'view') return s;
  if (role === 'admin') return 'view';
  return null;
}
const canEdit = a => a === 'own' || a === 'edit';

function summary(m, did, role){
  const st = fs.statSync(path.join(pdir(m.id), 'thumb.jpg'), { throwIfNoEntry:false });
  return { id:m.id, name:m.name, owner:profile(m.owner), created:m.created, updated:m.updated, pages:m.pages || 0,
    access:access(m, did, role), shares:Object.keys(m.shares || {}).length, thumb:st ? Math.round(st.mtimeMs).toString(36) : null,
    online:rooms.has(m.id) ? new Set([...rooms.get(m.id).conns].map(c => c.user.id)).size : 0 };
}

async function createProject(owner, name, doc){
  let pid; do pid = newId(10); while (projects.has(pid));
  const dir = pdir(pid);
  await fsp.mkdir(path.join(dir, 'assets'), { recursive:true });
  await fsp.mkdir(path.join(dir, 'fonts'), { recursive:true });
  await fsp.mkdir(path.join(dir, 'history'), { recursive:true });
  const m = { id:pid, name:String(name || 'Untitled').slice(0, 120), owner, shares:{}, created:now(), updated:now(), pages:doc && doc.pages ? doc.pages.length : 0 };
  if (doc) doc.name = m.name;
  await writeJSON(path.join(dir, 'doc.json'), { seq:0, doc:doc || null });
  await writeJSON(path.join(dir, 'assets.json'), {});
  await writeJSON(path.join(dir, 'fonts.json'), {});
  await saveMeta(m);
  projects.set(pid, m);
  return m;
}

/* ================= 即時協作房間 ================= */
const rooms = new Map();        // pid → room
const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#20c997', '#f06595', '#845ef7', '#94d82d'];

function loadRoom(pid){
  let r = rooms.get(pid);
  if (r) return r;
  const dir = pdir(pid), d = readJSONSync(path.join(dir, 'doc.json'), { seq:0, doc:null });
  r = { pid, doc:d.doc, seq:d.seq || 0, conns:new Set(), saveTimer:null, dirty:false, lastHist:0, colorN:0,
        assets:readJSONSync(path.join(dir, 'assets.json'), {}), fonts:readJSONSync(path.join(dir, 'fonts.json'), {}) };
  rooms.set(pid, r);
  return r;
}
function scheduleSave(r){
  r.dirty = true;
  if (r.saveTimer) return;
  r.saveTimer = setTimeout(() => { r.saveTimer = null; saveRoom(r).catch(e => log('save', r.pid, e.message)); }, SAVE_DELAY);
}
async function saveRoom(r){
  if (!r.dirty) return;
  r.dirty = false;
  const m = projects.get(r.pid); if (!m) return;
  const dir = pdir(r.pid);
  await writeJSON(path.join(dir, 'doc.json'), { seq:r.seq, doc:r.doc });
  // 每隔一段時間留一份快照，可以從「版本紀錄」還原
  if (r.doc && now() - r.lastHist > HISTORY_EVERY){
    r.lastHist = now();
    const hd = path.join(dir, 'history');
    await fsp.mkdir(hd, { recursive:true });
    await writeJSON(path.join(hd, `${now()}.json`), { seq:r.seq, doc:r.doc });
    const old = (await fsp.readdir(hd)).filter(f => f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) await fsp.unlink(path.join(hd, f)).catch(() => {});
  }
  m.updated = now(); m.pages = r.doc && r.doc.pages ? r.doc.pages.length : 0;
  if (r.doc && typeof r.doc.name === 'string' && r.doc.name.trim() && r.doc.name !== m.name) m.name = r.doc.name.trim().slice(0, 120);
  await saveMeta(m);
}
async function closeRoomIfIdle(r){
  if (r.conns.size) return;
  clearTimeout(r.saveTimer); r.saveTimer = null;
  if (r.dirty){ r.lastHist = 0; await saveRoom(r).catch(e => log('save', r.pid, e.message)); }   // 有改過就在關房前留一份快照
  if (!r.conns.size) rooms.delete(r.pid);
}
function send(c, msg){ if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function broadcast(r, msg, except){ const s = JSON.stringify(msg); for (const c of r.conns) if (c !== except && c.ws.readyState === 1) c.ws.send(s); }
function presence(r){
  return [...r.conns].map(c => ({ cid:c.cid, id:c.user.id, name:c.user.name, avatar:c.user.avatar, color:c.color, access:c.access, page:c.page || null, sel:c.sel || null }));
}
const pushPresence = r => broadcast(r, { t:'pres', users:presence(r) });

// 分享或權限改了：線上的人立刻套用新權限（被移除的人會被請出去）
function refreshAccess(pid){
  const r = rooms.get(pid), m = projects.get(pid); if (!r) return;
  for (const c of r.conns){
    const a = m ? access(m, c.user.id, roleOf(c.user.id)) : null;
    if (!a){ send(c, { t:'kick', reason:m ? 'unshared' : 'deleted' }); c.ws.close(4003, 'no access'); continue; }
    if (a !== c.access){ c.access = a; send(c, { t:'access', access:a }); }
  }
  pushPresence(r);
}

function onMessage(c, raw){
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  const r = c.room;
  switch (msg.t){
    case 'ops': {
      if (!canEdit(c.access)) return send(c, { t:'nack', b:msg.b, reason:'readonly' });
      if (!Array.isArray(msg.ops) || !r.doc) return send(c, { t:'nack', b:msg.b, reason:'bad' });
      const ops = msg.ops.filter(Sync.validOp);
      for (const op of ops){ try { Sync.apply(r.doc, op); } catch (e){ log('apply', r.pid, e.message); } }
      r.seq++;
      broadcast(r, { t:'ops', seq:r.seq, from:c.cid, ops }, c);
      send(c, { t:'ack', b:msg.b, seq:r.seq });
      scheduleSave(r);
      return;
    }
    case 'init': {   // 新專案第一次開啟：由第一個編輯者送出預設內容
      if (!canEdit(c.access) || r.doc || !msg.doc || !Array.isArray(msg.doc.pages)) return;
      r.doc = msg.doc; r.seq++;
      const m = projects.get(r.pid); if (m) r.doc.name = m.name;
      broadcast(r, { t:'reset', seq:r.seq, doc:r.doc }, c);
      send(c, { t:'ack', b:msg.b, seq:r.seq });
      scheduleSave(r);
      return;
    }
    case 'pres': {
      c.page = typeof msg.page === 'string' ? msg.page.slice(0, 40) : null;
      c.sel = typeof msg.sel === 'string' ? msg.sel.slice(0, 40) : null;
      broadcast(r, { t:'pres', users:presence(r) });
      return;
    }
    case 'resync': return send(c, { t:'reset', seq:r.seq, doc:r.doc });
    case 'ping': return send(c, { t:'pong' });
  }
}

/* ================= HTTP 小工具 ================= */
function sendJSON(res, code, obj, headers = {}){
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });
  res.end(body);
}
const fail = (res, code, msg) => sendJSON(res, code, { error:msg });
function readBody(req, limit){
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > limit){ reject(Object.assign(new Error('too large'), { code:413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSONBody(req, limit = 64 * 1024 * 1024){
  const b = await readBody(req, limit);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad json'), { code:400 }); }
}
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.avif':'image/avif', '.bmp':'image/bmp',
  '.ico':'image/x-icon', '.json':'application/json', '.md':'text/markdown; charset=utf-8', '.ttf':'font/ttf', '.otf':'font/otf', '.woff':'font/woff', '.woff2':'font/woff2' };

// 給 js/css 加上 ?v=<修改時間>，改完程式不用怕瀏覽器吃舊檔
function versioned(html){
  return html.replace(/(src|href)="((?:js|css|assets)\/[^"?]+)"/g, (m, a, f) => {
    const st = fs.statSync(path.join(APP_ROOT, f), { throwIfNoEntry:false });
    return st ? `${a}="/${f}?v=${Math.round(st.mtimeMs).toString(36)}"` : m;
  });
}
function page(file, inject = ''){
  let html = fs.readFileSync(path.join(APP_ROOT, file), 'utf8');
  html = versioned(html);
  if (inject) html = html.replace('</head>', inject + '\n</head>');
  return html;
}
function sendHTML(res, html, code = 200){ res.writeHead(code, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' }); res.end(html); }
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const jsonForScript = o => JSON.stringify(o).replace(/</g, '\\u003c');

async function serveStatic(req, res, rel){
  const file = path.join(APP_ROOT, rel);
  if (!file.startsWith(APP_ROOT + path.sep) || /(^|\/)(server|data|node_modules|\.git)(\/|$)/.test(rel)) return fail(res, 404, 'not found');
  const st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile()) return fail(res, 404, 'not found');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type':MIME[ext] || 'application/octet-stream', 'Content-Length':st.size,
    'Cache-Control':/[?&]v=/.test(req.url) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
async function serveFile(res, file, type, extra = {}){
  const st = await fsp.stat(file).catch(() => null);
  if (!st) return fail(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type':type || 'application/octet-stream', 'Content-Length':st.size, 'Cache-Control':'private, max-age=31536000, immutable', ...extra });
  fs.createReadStream(file).pipe(res);
}

/* ================= 登入 ================= */
function currentUser(req){
  const s = verify(cookies(req)[COOKIE]);
  if (!s || !s.d) return null;
  const role = roleOf(s.d);
  return { ...profile(s.d), role };
}
function setSession(res, did){
  const parts = [`${COOKIE}=${sign({ d:did }, 30 * 86400)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + 30 * 86400];
  if (SECURE_COOKIE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
async function discordUser(code){
  const tr = await fetch('https://discord.com/api/oauth2/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI }) });
  if (!tr.ok) throw new Error('token ' + tr.status);
  const tok = await tr.json();
  const ur = await fetch('https://discord.com/api/users/@me', { headers:{ Authorization:'Bearer ' + tok.access_token } });
  if (!ur.ok) throw new Error('user ' + ur.status);
  return ur.json();
}
const safeNext = n => (typeof n === 'string' && /^\/(p\/[a-z0-9]+)?$/.test(n)) ? n : '/';

/* ================= 路由 ================= */
async function route(req, res){
  const url = new URL(req.url, 'http://x'), p = url.pathname, M = req.method;

  if (p === '/api/health') return sendJSON(res, 200, { ok:true, rooms:rooms.size, projects:projects.size });

  // 靜態檔（app 本體）
  if (M === 'GET' && /^\/(js|css|assets)\//.test(p)) return serveStatic(req, res, decodeURIComponent(p.slice(1)));
  if (M === 'GET' && p === '/favicon.ico') return serveStatic(req, res, 'assets/logo-32.png');

  // ---- 登入 ----
  if (p === '/auth/login'){
    if (DEV_BYPASS){ const as = url.searchParams.get('as'); const did = /^\d{5,25}$/.test(as || '') ? as : DEV_BYPASS; setSession(res, did); res.writeHead(302, { Location:safeNext(url.searchParams.get('next')) }); return res.end(); }
    if (!CLIENT_ID) return sendHTML(res, msgPage('Discord 登入尚未設定', 'DISCORD_CLIENT_ID 沒有設定。'), 500);
    const state = sign({ n:newId(8), next:safeNext(url.searchParams.get('next')) }, 600);
    res.writeHead(302, { Location:'https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id:CLIENT_ID, redirect_uri:REDIRECT_URI, response_type:'code', scope:'identify', state, prompt:'none' }) });
    return res.end();
  }
  if (p === '/auth/discord/callback'){
    const st = verify(url.searchParams.get('state')), code = url.searchParams.get('code');
    if (!st || !code){ res.writeHead(302, { Location:'/' }); return res.end(); }
    try {
      const u = await discordUser(code);
      await rememberUser(u.id, u.global_name || u.username, u.avatar || '');
      setSession(res, u.id);
      log('login', u.id, u.username, roleOf(u.id) || 'no-access');
      res.writeHead(302, { Location:st.next || '/' }); return res.end();
    } catch (e){
      log('oauth', e.message);
      return sendHTML(res, msgPage('登入失敗', '跟 Discord 換資料時出錯了，請再試一次。<br><a href="/auth/login">重新登入</a>'), 502);
    }
  }
  if (p === '/auth/logout'){
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${SECURE_COOKIE ? '; Secure' : ''}`);
    res.writeHead(302, { Location:'/' }); return res.end();
  }

  const me = currentUser(req);

  // ---- 頁面 ----
  if (M === 'GET' && (p === '/' || p === '/index.html')){
    if (!me) return sendHTML(res, loginPage());
    if (!me.role) return sendHTML(res, noAccessPage(me), 403);
    return sendHTML(res, page('cloud.html', `<script>window.CPS_ME=${jsonForScript(me)};window.CPS_SANCTUM=${jsonForScript(SANCTUM_URL)};</script>`));
  }
  let mm;
  if (M === 'GET' && (mm = /^\/p\/([a-z0-9]+)\/?$/.exec(p))){
    if (!me) { res.writeHead(302, { Location:'/auth/login?next=' + encodeURIComponent('/p/' + mm[1]) }); return res.end(); }
    if (!me.role) return sendHTML(res, noAccessPage(me), 403);
    const m = projects.get(mm[1]), a = access(m, me.id, me.role);
    if (!a) return sendHTML(res, msgPage('找不到這個專案', '專案不存在，或是擁有者沒有分享給你。<br><a href="/">回到專案列表</a>'), 404);
    const boot = { pid:m.id, name:m.name, access:a, me };
    return sendHTML(res, page('index.html', `<base href="/"><script>window.CPS_ONLINE=${jsonForScript(boot)};</script>`));
  }

  // ---- API（以下都要登入） ----
  if (!p.startsWith('/api/')) return fail(res, 404, 'not found');
  if (!me) return fail(res, 401, 'login required');
  if (!me.role) return fail(res, 403, 'no access');

  if (p === '/api/me') return sendJSON(res, 200, me);
  if (p === '/api/users') return sendJSON(res, 200, roster());

  if (p === '/api/projects' && M === 'GET'){
    const mine = [], shared = [], others = [];
    for (const m of projects.values()){
      const a = access(m, me.id, me.role); if (!a) continue;
      const s = summary(m, me.id, me.role);
      if (a === 'own') mine.push(s); else if (m.shares && m.shares[me.id]) shared.push(s); else others.push(s);
    }
    const by = (x, y) => y.updated - x.updated;
    return sendJSON(res, 200, { mine:mine.sort(by), shared:shared.sort(by), others:me.role === 'admin' ? others.sort(by) : [] });
  }
  if (p === '/api/projects' && M === 'POST'){
    const body = await readJSONBody(req, 1024 * 1024);
    const m = await createProject(me.id, (body.name || '').trim() || '未命名漫畫', null);
    log('create', m.id, 'by', me.id);
    return sendJSON(res, 201, summary(m, me.id, me.role));
  }

  if ((mm = /^\/api\/projects\/([a-z0-9]+)(\/.*)?$/.exec(p))){
    const pid = mm[1], sub = mm[2] || '', m = projects.get(pid);
    if (!ID_RE.test(pid) || !m) return fail(res, 404, 'not found');
    const a = access(m, me.id, me.role);
    if (!a) return fail(res, 404, 'not found');
    const dir = pdir(pid);

    if (sub === '' && M === 'GET') return sendJSON(res, 200, { ...summary(m, me.id, me.role), sharesDetail:a === 'own' ? m.shares : undefined });
    if (sub === '' && M === 'PATCH'){
      if (!canEdit(a)) return fail(res, 403, 'read only');
      const body = await readJSONBody(req, 64 * 1024);
      const name = String(body.name || '').trim().slice(0, 120);
      if (!name) return fail(res, 400, 'name required');
      m.name = name; m.updated = now(); await saveMeta(m);
      const r = rooms.get(pid);
      if (r && r.doc){ const op = { o:'s', p:['name'], v:name }; Sync.apply(r.doc, op); r.seq++; broadcast(r, { t:'ops', seq:r.seq, from:null, ops:[op] }); scheduleSave(r); }
      else {
        const d = readJSONSync(path.join(dir, 'doc.json'), null);
        if (d && d.doc){ d.doc.name = name; await writeJSON(path.join(dir, 'doc.json'), d); }
      }
      return sendJSON(res, 200, summary(m, me.id, me.role));
    }
    if (sub === '' && M === 'DELETE'){
      if (a !== 'own' && me.role !== 'admin') return fail(res, 403, 'owner only');
      const r = rooms.get(pid);
      if (r){ await saveRoom(r).catch(() => {}); clearTimeout(r.saveTimer); }
      projects.delete(pid);
      refreshAccess(pid); rooms.delete(pid);
      await fsp.rename(dir, path.join(TRASH_DIR, `${pid}-${now()}`));
      log('delete', pid, 'by', me.id);
      return sendJSON(res, 200, { ok:true });
    }
    if (sub === '/shares' && M === 'PUT'){
      if (a !== 'own') return fail(res, 403, 'owner only');
      const body = await readJSONBody(req, 256 * 1024), shares = {};
      for (const [did, lv] of Object.entries(body.shares || {})){
        if (/^\d{5,25}$/.test(did) && did !== m.owner && (lv === 'edit' || lv === 'view')) shares[did] = lv;
      }
      m.shares = shares; await saveMeta(m);
      refreshAccess(pid);
      log('share', pid, JSON.stringify(shares));
      return sendJSON(res, 200, { shares });
    }
    if (sub === '/duplicate' && M === 'POST'){
      const r = rooms.get(pid); if (r) await saveRoom(r).catch(() => {});
      const d = readJSONSync(path.join(dir, 'doc.json'), { doc:null });
      const copy = await createProject(me.id, m.name + '（副本）', d.doc);
      const nd = pdir(copy.id);
      for (const k of ['assets', 'fonts']){
        const idx = readJSONSync(path.join(dir, k + '.json'), {}), out = {};
        for (const [id, rec] of Object.entries(idx)){
          if (rec.deleted) continue;
          await fsp.copyFile(path.join(dir, k, id), path.join(nd, k, id)).then(() => { out[id] = rec; }).catch(() => {});
        }
        await writeJSON(path.join(nd, k + '.json'), out);
      }
      await fsp.copyFile(path.join(dir, 'thumb.jpg'), path.join(nd, 'thumb.jpg')).catch(() => {});
      log('duplicate', pid, '→', copy.id, 'by', me.id);
      return sendJSON(res, 201, summary(copy, me.id, me.role));
    }
    if (sub === '/thumb' && M === 'GET') return serveFile(res, path.join(dir, 'thumb.jpg'), 'image/jpeg', { 'Cache-Control':'private, max-age=60' });
    if (sub === '/thumb' && M === 'PUT'){
      if (!canEdit(a)) return fail(res, 403, 'read only');
      const b = await readBody(req, 2 * 1024 * 1024);
      if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return fail(res, 400, 'jpeg only');
      await fsp.writeFile(path.join(dir, 'thumb.jpg'), b);
      return sendJSON(res, 200, { ok:true });
    }
    // 圖片與字體
    if ((mm = /^\/(assets|fonts)\/([A-Za-z0-9_-]{1,40})$/.exec(sub))){
      const kind = mm[1], fid = mm[2], file = path.join(dir, kind, fid), r = loadRoomLite(pid), idx = r[kind];
      if (M === 'GET'){
        const rec = idx[fid]; if (!rec) return fail(res, 404, 'not found');
        return serveFile(res, file, kind === 'assets' ? (rec.type || 'image/png') : 'application/octet-stream');
      }
      if (!canEdit(a)) return fail(res, 403, 'read only');
      if (M === 'PUT'){
        const b = await readBody(req, kind === 'assets' ? MAX_ASSET : MAX_FONT);
        if (!b.length) return fail(res, 400, 'empty');
        const q = url.searchParams, type = String(req.headers['content-type'] || '').split(';')[0];
        if (kind === 'assets' && !/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(type)) return fail(res, 415, 'image only');
        await fsp.writeFile(file, b);
        const rec = kind === 'assets'
          ? { id:fid, name:String(q.get('name') || 'image').slice(0, 200), w:+q.get('w') || 1, h:+q.get('h') || 1, t:+q.get('t') || now(), type, size:b.length, by:me.id }
          : { id:fid, name:String(q.get('name') || 'font').slice(0, 200), ext:/^(ttf|otf|woff2?)$/.test(q.get('ext')) ? q.get('ext') : 'ttf', t:+q.get('t') || now(), size:b.length, by:me.id };
        idx[fid] = rec;
        await writeJSON(path.join(dir, kind + '.json'), idx);
        const room = rooms.get(pid);
        if (room) broadcast(room, { t:kind === 'assets' ? 'asset' : 'font', rec }, [...room.conns].find(c => c.cid === req.headers['x-cps-cid']));
        return sendJSON(res, 200, rec);
      }
      if (M === 'DELETE'){
        // 不真的刪檔，只標記：版本紀錄還原時可能還會用到
        if (idx[fid]){ idx[fid].deleted = now(); await writeJSON(path.join(dir, kind + '.json'), idx); }
        const room = rooms.get(pid);
        if (room) broadcast(room, { t:kind === 'assets' ? 'assetdel' : 'fontdel', id:fid }, [...room.conns].find(c => c.cid === req.headers['x-cps-cid']));
        return sendJSON(res, 200, { ok:true });
      }
    }
    // 版本紀錄
    if (sub === '/history' && M === 'GET'){
      const hd = path.join(dir, 'history');
      const files = (await fsp.readdir(hd).catch(() => [])).filter(f => /^\d+\.json$/.test(f)).sort().reverse();
      return sendJSON(res, 200, files.map(f => ({ id:f.slice(0, -5), t:+f.slice(0, -5) })));
    }
    if ((mm = /^\/history\/(\d+)$/.exec(sub)) && M === 'GET'){
      const d = readJSONSync(path.join(dir, 'history', mm[1] + '.json'), null);
      if (!d) return fail(res, 404, 'not found');
      return sendJSON(res, 200, d);
    }
    if ((mm = /^\/history\/(\d+)\/restore-files$/.exec(sub)) && M === 'POST'){
      // 還原版本前，把那個版本用到、但後來被刪掉的圖片／字體救回來
      if (!canEdit(a)) return fail(res, 403, 'read only');
      const d = readJSONSync(path.join(dir, 'history', mm[1] + '.json'), null);
      if (!d || !d.doc) return fail(res, 404, 'not found');
      const s = JSON.stringify(d.doc), r = loadRoomLite(pid), back = { assets:[], fonts:[] };
      for (const k of ['assets', 'fonts']){
        let changed = false;
        for (const [id, rec] of Object.entries(r[k])) if (rec.deleted && s.includes(id)){ delete rec.deleted; back[k].push(rec); changed = true; }
        if (changed) await writeJSON(path.join(dir, k + '.json'), r[k]);
      }
      const room = rooms.get(pid);
      if (room){ back.assets.forEach(rec => broadcast(room, { t:'asset', rec })); back.fonts.forEach(rec => broadcast(room, { t:'font', rec })); }
      return sendJSON(res, 200, back);
    }
  }
  return fail(res, 404, 'not found');
}
// 圖片索引一律經過房間的快取（同一份物件），避免同時上傳時互相蓋掉；沒人在線就用完關掉
function loadRoomLite(pid){
  const r = loadRoom(pid);
  setTimeout(() => closeRoomIfIdle(r), 5000);
  return r;
}

/* ================= 簡單頁面（登入／沒權限） ================= */
function shell(title, body){
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHTML(title)} · Comic Panel Studio</title><link rel="icon" href="/assets/logo-32.png"><link rel="stylesheet" href="/css/cloud.css">
</head><body class="center"><main class="card">
<img src="/assets/logo.svg" alt="" class="biglogo"><h1>Comic Panel Studio</h1>${body}</main></body></html>`;
}
const loginPage = () => shell('登入', `<p class="muted">漫畫分格工作室 · 線上版</p>
  <a class="btn primary big" href="/auth/login${''}">用 Discord 登入</a>
  <p class="muted small">${SANCTUM_URL ? `使用權限由 <a href="${escHTML(SANCTUM_URL)}">Sanctum</a> 管理。<br>` : ''}想離線使用？到 <a href="https://github.com/dANNY-1209/ComicPanelStudio">GitHub</a> 下載單機版。</p>`);
const noAccessPage = me => shell('沒有權限', `<p>嗨 <b>${escHTML(me.name)}</b>，你目前還沒有這個站的使用權限。</p>
  ${SANCTUM_URL ? `<a class="btn primary big" href="${escHTML(SANCTUM_URL)}">到 Sanctum 申請</a>` : '<p class="muted">請聯絡站長開通。</p>'}
  <p class="muted small"><a href="/auth/logout">換一個帳號</a></p>`);
const msgPage = (t, body) => shell(t, `<h2>${escHTML(t)}</h2><p>${body}</p>`);

/* ================= 啟動 ================= */
const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    if (!res.headersSent) fail(res, e.code >= 400 && e.code < 600 ? e.code : 500, e.code ? e.message : 'server error');
    if (!e.code) log('error', req.method, req.url, e.stack);
  });
});
const wss = new WebSocketServer({ noServer:true, maxPayload:MAX_WS_MSG });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const me = url.pathname === '/ws' && currentUser(req);
  const pid = url.searchParams.get('p'), m = pid && projects.get(pid);
  const a = me && me.role && m ? access(m, me.id, me.role) : null;
  if (!a){ socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    const r = loadRoom(pid);
    const c = { ws, cid:newId(8), user:me, access:a, room:r, color:COLORS[r.colorN++ % COLORS.length], page:null, sel:null, alive:true };
    r.conns.add(c);
    const live = idx => Object.values(idx).filter(x => !x.deleted);
    send(c, { t:'hello', cid:c.cid, access:a, seq:r.seq, doc:r.doc, name:m.name, owner:profile(m.owner), assets:live(r.assets), fonts:live(r.fonts), color:c.color });
    pushPresence(r);
    ws.on('message', d => onMessage(c, d.toString()));
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => { r.conns.delete(c); pushPresence(r); closeRoomIfIdle(r); });
  });
});
// 斷線偵測
setInterval(() => { for (const r of rooms.values()) for (const c of r.conns){ if (!c.alive){ c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 30000).unref();

async function shutdown(){
  log('shutting down, saving', rooms.size, 'room(s)');
  for (const r of rooms.values()){ clearTimeout(r.saveTimer); await saveRoom(r).catch(e => log('save', r.pid, e.message)); }
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

if (require.main === module){
  server.listen(PORT, () => log(`Comic Panel Studio server on :${PORT}  data=${DATA_DIR}  auth=${AUTH_DIR}${DEV_BYPASS ? '  [DEV_BYPASS ON]' : ''}`));
}
module.exports = { server, projects, rooms };
