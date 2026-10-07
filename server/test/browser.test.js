// 瀏覽器端到端測試（選用；需要 Playwright + Chromium）：
//   PW_MODULE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome node test/browser.test.js
// 三個人同時開同一個專案：擁有者 A、編輯者 B、檢視者 C。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW_MODULE || 'playwright-core');

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(process.env.CPS_TEST_TMP || os.tmpdir(), 'cps-bt-'));
const SHOTS = process.env.SHOTS || path.join(tmp, 'shots');
fs.mkdirSync(SHOTS, { recursive:true });
const OWNER = '200000000000000001', ED = '200000000000000002', VIEW = '200000000000000003';
fs.mkdirSync(path.join(tmp, 'auth'));
fs.writeFileSync(path.join(tmp, 'auth/whitelist.json'), JSON.stringify({ discord:[ED, VIEW] }));
fs.writeFileSync(path.join(tmp, 'auth/users.json'), JSON.stringify({ discord:{ [OWNER]:{ n:'Owner' }, [ED]:{ n:'Editor' }, [VIEW]:{ n:'Viewer' } } }));
const PORT = 3000 + Math.floor(Math.random() * 900) + 100, BASE = `http://127.0.0.1:${PORT}`;

let srv;
function startServer(){
  srv = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env:{ ...process.env, PORT, CPS_DATA:tmp, CPS_AUTH_DIR:path.join(tmp, 'auth'),
    CPS_OWNER_DISCORD_ID:OWNER, CPS_DEV_BYPASS:OWNER, CPS_SESSION_SECRET:'browser-test-secret', NODE_ENV:'development' }, stdio:['ignore', 'pipe', 'inherit'] });
  return new Promise(r => srv.stdout.on('data', d => { if (/server on/.test(d)) r(); }));
}
const stopServer = () => new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM'); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, what = 'condition'){
  const t0 = Date.now();
  for (;;){ try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(100); }
}
const errors = [];
async function person(browser, id, name){
  const ctx = await browser.newContext({ viewport:{ width:1400, height:900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${BASE}/auth/login?as=${id}`);
  return page;
}
const count = (pg, expr, arg) => pg.evaluate(expr, arg);

(async () => {
  await startServer();
  const browser = await chromium.launch({ executablePath:process.env.CHROME, args:['--no-sandbox'] });
  try {
    // ---- 擁有者：列表頁、建立專案 ----
    const A = await person(browser, OWNER, 'A');
    await A.waitForSelector('#bNew');
    await A.screenshot({ path:path.join(SHOTS, '01-dashboard-empty.png') });
    await A.click('#bNew');
    await A.fill('#modal input[name=name]', '共同作品');
    await A.click('#modal .mbtns .primary');
    await A.waitForURL(/\/p\/[a-z0-9]+$/);
    const pid = A.url().split('/p/')[1];
    await until(() => count(A, () => doc && doc.pages.length === 1 && document.querySelector('#saveState').classList.contains('clean')), 8000, 'A synced');
    assert.strictEqual(await count(A, () => doc.name), '共同作品');

    // 分享：B 可編輯、C 僅檢視（透過 API，以擁有者 cookie）
    const r = await A.evaluate(async ([pid, ED, VIEW]) => (await fetch(`/api/projects/${pid}/shares`, { method:'PUT', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ shares:{ [ED]:'edit', [VIEW]:'view' } }) })).status, [pid, ED, VIEW]);
    assert.strictEqual(r, 200);

    const B = await person(browser, ED, 'B');
    await B.goto(`${BASE}/p/${pid}`);
    await until(() => count(B, () => doc && doc.pages.length === 1), 8000, 'B loaded');
    await until(() => count(A, () => document.querySelectorAll('#peers .peer').length === 2), 5000, 'A sees B');

    // ---- A 新增頁面 → B 看到 ----
    await A.click('#bAddPage');
    await until(() => count(B, () => doc.pages.length === 2), 5000, 'B gets new page');

    // ---- A 套用 4 格模板 → B 的格子數一樣 ----
    await A.click('#tabs button[data-tab="layout"]');
    await A.click('.tpl[data-act="tpl"][data-i="3"]');
    const nA = await count(A, () => curPage().layers[0].panels.length);
    try { await until(() => count(B, n => doc.pages[1].layers[0].panels.length === n, nA), 5000, 'B gets template'); }
    catch (e){ console.log('A', nA, await count(A, () => JSON.stringify({ page:ui.page, ids:doc.pages.map(p => p.id + ':' + p.layers[0].panels.length), base:0 })),
      'B', await count(B, () => JSON.stringify(doc.pages.map(p => p.id + ':' + p.layers[0].panels.length)))); throw e; }

    // ---- B 放對話框 → A 看到 ----
    await B.click('.pg[data-i="1"]');
    await B.click('#tabs button[data-tab="stickers"]');
    await B.click('.tpl[data-act="bpreset"][data-i="0"]');
    await until(() => count(A, () => doc.pages[1].layers[2].items.length === 1), 5000, 'A gets bubble');
    // 協作者的選取框（B 選著剛放的對話框，A 也在第 2 頁）
    await until(() => count(A, () => document.querySelectorAll('#peerSel rect').length >= 1), 5000, 'A sees B selection');
    await A.screenshot({ path:path.join(SHOTS, '02-editor-A-sees-B.png') });

    // ---- 復原只撤回自己的：A 加文字，B 加頁；A 按 Ctrl+Z ----
    await A.click('#tabs button[data-tab="stickers"]');
    await A.click('.tpl[data-act="tpreset"][data-i="0"]');
    await until(() => count(B, () => doc.pages[1].layers[2].items.length === 2), 5000, 'B gets text');
    await B.click('#bAddPage');
    await until(() => count(A, () => doc.pages.length === 3), 5000, 'A gets B page');
    await A.click('#center'); await A.keyboard.press('Escape');
    await A.keyboard.press('Control+z');
    await until(() => count(B, () => doc.pages[1].layers[2].items.length === 1), 5000, 'undo removes A text on B');
    assert.strictEqual(await count(A, () => doc.pages.length), 3, 'B page survives A undo');
    assert.strictEqual(await count(A, () => doc.pages[1].layers[2].items.length), 1);
    await A.keyboard.press('Control+y');
    await until(() => count(B, () => doc.pages[1].layers[2].items.length === 2), 5000, 'redo');

    // ---- PR #1 的新功能也會同步：上下層互換 ----
    const sig = pg => pg.evaluate(() => JSON.stringify(doc.pages[1].layers.slice(0, 2).map(L => L.panels.map(p => p.id))));
    await A.click('.pg[data-i="1"]');
    await A.click('#layers .lswap');
    const swapped = await sig(A);
    await until(async () => (await sig(B)) === swapped, 5000, 'B gets layer swap');
    await A.click('#layers .lswap');      // 換回來，後面的步驟還要用下層的格子
    const back = await sig(A);
    await until(async () => (await sig(B)) === back, 5000, 'B gets swap back');

    // ---- 同時改同一個欄位：最後大家一致 ----
    await A.evaluate(() => { doc.settings.margin = 111; commit(); });
    await B.evaluate(() => { doc.settings.margin = 222; commit(); });
    await sleep(1500);
    const mA = await count(A, () => doc.settings.margin), mB = await count(B, () => doc.settings.margin);
    assert.strictEqual(mA, mB, `converged margin ${mA} vs ${mB}`);

    // ---- B 上傳圖片 → A 收到，而且匯出用得到原檔 ----
    const png = fs.readFileSync(path.join(ROOT, 'assets/logo-32.png'));
    await B.setInputFiles('#fileImg', { name:'dot.png', mimeType:'image/png', buffer:png });
    await until(() => count(A, () => assets.size === 1), 5000, 'A gets asset');
    await B.evaluate(() => { const p = doc.pages[1].layers[0].panels[0], a = [...assets.values()][0]; pushHistory(); setPanelImage(p, a); commit(); });
    await until(() => count(A, () => !!doc.pages[1].layers[0].panels[0].img), 5000, 'A gets image placement');
    const w = await A.evaluate(async () => (await pageToCanvas(doc.pages[1], 0.1)).width);
    assert.ok(w > 0);

    // ---- 檢視者：唯讀、改不動 ----
    const C = await person(browser, VIEW, 'C');
    await C.goto(`${BASE}/p/${pid}`);
    await until(() => count(C, () => doc && doc.pages.length === 3), 8000, 'C loaded');
    assert.ok(await count(C, () => document.body.classList.contains('ro')));
    assert.strictEqual(await count(C, () => getComputedStyle(document.querySelector('#side')).display), 'none');
    const before = await count(C, () => JSON.stringify(doc.pages));
    await C.evaluate(() => { doc.pages.pop(); commit(); });     // 繞過介面直接改：會被撤回
    await sleep(600);
    assert.strictEqual(await count(C, () => JSON.stringify(doc.pages)), before, 'viewer change reverted');
    assert.strictEqual(await count(A, () => doc.pages.length), 3, 'viewer change not propagated');
    await C.screenshot({ path:path.join(SHOTS, '03-viewer.png') });

    // ---- 斷線重連：伺服器重啟期間 A 的修改不會遺失 ----
    await stopServer();
    await until(() => count(A, () => /離線|Offline/.test(document.querySelector('#saveState').textContent)), 5000, 'A offline');
    await A.evaluate(() => { doc.name = '離線時改的名字'; commit(); });
    await startServer();
    await until(() => count(B, () => doc && doc.name === '離線時改的名字'), 20000, 'offline edit delivered after reconnect');

    // ---- 列表頁（等第一頁縮圖上傳） ----
    await until(() => A.evaluate(async pid => !!(await (await fetch('/api/projects/' + pid)).json()).thumb, pid), 10000, 'thumbnail uploaded');
    await A.goto(BASE + '/');
    await A.waitForSelector('.card');
    await A.screenshot({ path:path.join(SHOTS, '04-dashboard.png') });
    await B.goto(BASE + '/');
    await B.click('[data-tab="shared"]');
    await until(() => count(B, () => document.querySelectorAll('.card').length === 1), 5000, 'B shared list');

    // ---- 手機寬度 ----
    const M = await person(browser, ED, 'M');
    await M.setViewportSize({ width:390, height:844 });
    await M.goto(BASE + '/');
    await M.click('[data-tab="shared"]');
    await M.waitForSelector('.card');
    await M.screenshot({ path:path.join(SHOTS, '05-mobile-list.png') });
    await M.goto(`${BASE}/p/${pid}`);
    await until(() => count(M, () => doc && doc.pages.length === 3), 8000, 'mobile loaded');
    await sleep(500);
    assert.ok(await count(M, () => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll on mobile');
    await M.screenshot({ path:path.join(SHOTS, '06-mobile-editor.png') });

    // ---- 單機版（直接開檔案，不經伺服器）照常運作 ----
    const O = await (await browser.newContext()).newPage();
    O.on('pageerror', e => errors.push('offline: ' + e.message));
    await O.goto('file://' + path.join(ROOT, 'index.html'));
    await until(() => count(O, () => typeof doc !== 'undefined' && doc && doc.pages.length === 1), 8000, 'offline boots');
    assert.strictEqual(await count(O, () => ONLINE), null);
    await O.click('#bAddPage');
    await O.keyboard.press('Control+z');
    assert.strictEqual(await count(O, () => doc.pages.length), 1, 'offline undo');
    await O.screenshot({ path:path.join(SHOTS, '07-offline.png') });

    assert.deepStrictEqual(errors, [], 'page errors:\n' + errors.join('\n'));
    console.log('browser ok — screenshots in', SHOTS);
  } finally {
    await browser.close();
    await stopServer().catch(() => {});
  }
  process.exit(0);
})().catch(async e => { console.error(e); console.error(errors.join('\n')); try { srv.kill(); } catch {} process.exit(1); });
