'use strict';
/* ================= 線上版：雲端專案 + 多人即時編輯 =================
   只有從線上伺服器打開（/p/<專案id>）時才會啟用；直接開 index.html 時 ONLINE 是 null，
   整個檔案什麼都不做，工具就是原本的單機版。

   同步方式：每次修改後（commit）比對「上次同步的版本」和目前的作品，算出改了哪些
   物件的哪些欄位（js/sync-core.js），送給伺服器；別人的修改也用同樣格式收進來。
   復原只撤回自己的修改，不會蓋掉別人剛做的事。 */
const ONLINE = window.CPS_ONLINE || null;

Object.assign(I18N.zh, {
  cl_projects:'專案列表', cl_share:'分享…', cl_history:'版本紀錄…', cl_import:'匯入本機專案（取代目前內容）…', cl_importJson:'匯入舊版 .json 專案…',
  cl_download:'下載一份到電腦（專案資料夾）', cl_downloadJson:'下載一份到電腦（單一 .json）',
  cl_synced:'☁ 已同步', cl_syncing:'☁ 同步中…', cl_offline:'⚠ 離線，重新連線中…', cl_connecting:'連線中…', cl_readonly:'👁 僅檢視',
  cl_autoSaved:'線上版會自動儲存到雲端', cl_roToast:'你只有檢視權限，修改不會被儲存', cl_kicked:'你已經無法存取這個專案', cl_deleted:'這個專案已被刪除',
  cl_toList:'回到專案列表', cl_nowEdit:'你現在可以編輯了', cl_nowView:'你的權限改成「僅檢視」',
  cl_peerEditing:'{0} 也正在編輯這個物件', cl_onPage:'在第 {0} 頁', cl_you:'（你）',
  cl_replaceQ:'匯入會<b>取代這個雲端專案目前的全部內容</b>，其他協作者也會立刻看到。<br>需要的話，之後可以從「版本紀錄」還原。',
  cl_replace:'匯入並取代', cl_importTitle:'匯入本機專案', cl_importDesc:'選擇電腦上的專案資料夾（裡面有 project.json），或是舊版的 .json 專案檔。',
  cl_pickFolder:'選擇專案資料夾', cl_pickJson:'選擇 .json 檔', cl_later:'先不要',
  cl_uploadFail:'上傳失敗：{0}', cl_uploading:'上傳圖片 {0}',
  cl_histTitle:'版本紀錄', cl_histDesc:'每次有人編輯時，大約每 10 分鐘自動留一份快照。還原後所有人都會看到，也可以再按 Ctrl+Z 撤回。',
  cl_histNone:'還沒有快照（編輯一陣子之後才會出現）', cl_restore:'還原', cl_restored:'已還原到 {0} 的版本', cl_histLoading:'讀取中…',
  cl_shareTitle:'分享「{0}」', cl_shareDesc:'分享給 Sanctum 上有本站權限的人。「可編輯」能一起改；「僅檢視」只能看、預覽和匯出。',
  cl_owner:'擁有者', cl_canEdit:'可編輯', cl_canView:'僅檢視', cl_noShare:'不分享', cl_saved:'已儲存分享設定', cl_ownerOnly:'只有擁有者可以分享',
  cl_expired:'登入已過期', cl_expiredDesc:'請重新登入。還沒送出的修改可能會遺失。', cl_relogin:'重新登入',
  cl_search:'搜尋名字…', cl_mobileNote:'手機上只提供檢視與預覽，編輯請用電腦', cl_leaveQ:'還有修改沒送到伺服器，確定要離開？',
});
Object.assign(I18N.en, {
  cl_projects:'Projects', cl_share:'Share…', cl_history:'Version history…', cl_import:'Import local project (replaces content)…', cl_importJson:'Import legacy .json project…',
  cl_download:'Download a copy (project folder)', cl_downloadJson:'Download a copy (single .json)',
  cl_synced:'☁ Synced', cl_syncing:'☁ Syncing…', cl_offline:'⚠ Offline, reconnecting…', cl_connecting:'Connecting…', cl_readonly:'👁 View only',
  cl_autoSaved:'The online version saves to the cloud automatically', cl_roToast:'You can only view this project; changes are not saved', cl_kicked:'You no longer have access to this project', cl_deleted:'This project was deleted',
  cl_toList:'Back to projects', cl_nowEdit:'You can edit now', cl_nowView:'Your access changed to view only',
  cl_peerEditing:'{0} is also editing this object', cl_onPage:'on page {0}', cl_you:' (you)',
  cl_replaceQ:'Importing <b>replaces everything in this cloud project</b>, and collaborators will see it right away.<br>You can restore it later from Version history.',
  cl_replace:'Import and replace', cl_importTitle:'Import a local project', cl_importDesc:'Choose a project folder on your computer (the one with project.json), or a legacy .json project file.',
  cl_pickFolder:'Choose project folder', cl_pickJson:'Choose .json file', cl_later:'Not now',
  cl_uploadFail:'Upload failed: {0}', cl_uploading:'Uploading image {0}',
  cl_histTitle:'Version history', cl_histDesc:'A snapshot is kept about every 10 minutes while people edit. Restoring affects everyone, and Ctrl+Z can undo it.',
  cl_histNone:'No snapshots yet (they appear after some editing)', cl_restore:'Restore', cl_restored:'Restored the version from {0}', cl_histLoading:'Loading…',
  cl_shareTitle:'Share "{0}"', cl_shareDesc:'Share with people who have access to this site in Sanctum. "Can edit" can work on it with you; "View only" can view, preview and export.',
  cl_owner:'Owner', cl_canEdit:'Can edit', cl_canView:'View only', cl_noShare:'Not shared', cl_saved:'Sharing saved', cl_ownerOnly:'Only the owner can share',
  cl_expired:'Session expired', cl_expiredDesc:'Please log in again. Changes not yet sent may be lost.', cl_relogin:'Log in again',
  cl_search:'Search names…', cl_mobileNote:'On phones you can view and preview; use a computer to edit', cl_leaveQ:'Some changes have not reached the server yet. Leave anyway?',
});

const Cloud = (() => {
  if (!ONLINE) return null;
  const S = CPSync, pid = ONLINE.pid, api = '/api/projects/' + pid;
  let ws = null, cid = null, access = ONLINE.access, connected = false, everConnected = false, retry = 0;
  let base = null;                 // 伺服器已有（或已送出）的版本
  let pending = [];                // 送出但還沒收到確認的批次 { b, ops }
  let bn = 0, openGroup = null, inUndo = false;
  let queue = [];                  // 拖曳中先暫存別人的修改，放開後再套用
  let peers = [], sideStale = false, flushTimer = null, lastPres = '', warnedSel = null;
  const canEdit = () => access === 'own' || access === 'edit';

  /* ---------- 連線 ---------- */
  function connect(){
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?p=' + encodeURIComponent(pid));
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
    ws.onclose = async ev => {
      connected = false; fileState();
      if (ev.code === 4003) return;
      // 連不上好幾次：看看是不是登入過期或權限被拿掉了
      if (retry >= 2){
        const st = await fetch('/api/me').then(r => r.status).catch(() => 0);
        if (st === 401) return loginExpired();
        if (st === 403) return kicked('unshared');
      }
      setTimeout(connect, Math.min(15000, 800 * 2 ** retry++));
    };
  }
  const wsSend = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function onMsg(m){
    switch (m.t){
      case 'hello': return onHello(m);
      case 'ack': pending = pending.filter(x => x.b !== m.b); fileState(); return;
      case 'nack':
        pending = pending.filter(x => x.b !== m.b);
        if (m.reason === 'readonly'){ setAccess('view'); toast(t('cl_roToast')); }
        wsSend({ t:'resync' }); return;
      case 'ops': if (drag || fp || dragPage != null){ queue.push(m); return; } return applyRemote([m]);
      case 'reset': return onReset(m.doc);
      case 'pres': peers = m.users.filter(u => u.cid !== cid); me = m.users.find(u => u.cid === cid) || me; drawPresence(); return;
      case 'asset': return addRemoteAsset(m.rec, true);
      case 'assetdel': return dropAsset(m.id);
      case 'font': return addRemoteFont(m.rec).then(() => renderAll());
      case 'fontdel': return removeFontLocal(m.id);
      case 'access': setAccess(m.access); toast(t(canEdit() ? 'cl_nowEdit' : 'cl_nowView')); return;
      case 'kick': kicked(m.reason); return;
    }
  }
  let me = null;

  async function onHello(m){
    cid = m.cid; connected = true; retry = 0; setAccess(m.access);
    // 圖片：網址直接指向伺服器，原檔（blob）要匯出時才下載
    for (const rec of m.assets) addRemoteAsset(rec, false);
    for (const id of [...assets.keys()]) if (!m.assets.some(r => r.id === id)) dropAsset(id, true);
    await Promise.all(m.fonts.filter(f => !customFonts.has(f.id)).map(addRemoteFont));
    if (!everConnected){
      everConnected = true;
      if (m.doc) setDoc(m.doc);
      else {
        makeDefaultDoc(); doc.name = m.name;
        base = S.clone(doc);
        if (canEdit()) wsSend({ t:'init', b:++bn, doc });
      }
      closeModal(); fitZoom(); renderAll();
      if (location.hash === '#import' && canEdit()){ history.replaceState(null, '', location.pathname); importDialog(true); }
    } else {
      // 重新連線：以伺服器的版本為準，再把自己還沒送達的修改疊上去重送
      const mine = [...pending.flatMap(x => x.ops), ...(base ? S.diff(base, doc) : [])];
      pending = [];
      const d = m.doc ? S.clone(m.doc) : doc;
      if (m.doc) mine.forEach(op => S.apply(d, S.wire(op)));
      const pageId = curPage() && curPage().id;
      base = S.clone(m.doc || doc); doc = normalizeDoc(d);
      keepPage(pageId); renderAll();
      flush();
    }
    fileState(); sendPres(true);
  }
  function setDoc(d){
    doc = normalizeDoc(S.clone(d)); doc.name = doc.name || ONLINE.name;
    base = S.clone(doc);           // 讀檔時的格式整理（normalizeDoc）只留在本機，不送出
  }
  function onReset(d){
    if (!d) return;
    const pageId = curPage() && curPage().id;
    pending = []; setDoc(d); undoStack = []; redoStack = []; openGroup = null;
    keepPage(pageId); deselectIfGone(); renderAll();
  }
  function kicked(reason){
    ws && ws.close();
    modal({ title:t(reason === 'deleted' ? 'cl_deleted' : 'cl_kicked'), body:'', buttons:[{ label:t('cl_toList'), value:1, cls:'primary' }] })
      .then(() => location.href = '/');
  }
  function loginExpired(){
    modal({ title:t('cl_expired'), body:`<p>${t('cl_expiredDesc')}</p>`, buttons:[{ label:t('cl_relogin'), value:1, cls:'primary' }] })
      .then(() => { location.href = '/auth/login?next=' + encodeURIComponent('/p/' + pid); });
  }
  function setAccess(a){
    access = a;
    document.body.classList.toggle('ro', !canEdit());
    if (!canEdit() && ui.tool === 'knife') ui.tool = 'select';
    buildMenu(); fileState();
  }

  /* ---------- 送出自己的修改 ---------- */
  function flush(){
    if (!doc || !base) return;
    const ops = S.diff(base, doc);
    if (!ops.length) return;
    if (!canEdit()){
      // 沒有編輯權限：把畫面上的改動撤回
      const pageId = curPage().id;
      doc = normalizeDoc(S.clone(base)); keepPage(pageId); deselectIfGone(); renderAll();
      toast(t('cl_roToast')); return;
    }
    if (!inUndo){
      if (!openGroup || undoStack[undoStack.length - 1] !== openGroup){ openGroup = []; undoStack.push(openGroup); if (undoStack.length > 150) undoStack.shift(); redoStack = []; }
      openGroup.push(...ops);
    }
    ops.forEach(op => S.apply(base, S.wire(op)));
    const b = ++bn; pending.push({ b, ops });
    wsSend({ t:'ops', b, ops:ops.map(S.wire) });
    fileState(); thumbSoon();
  }
  function changed(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 60); }

  /* ---------- 復原／重做：只撤回自己的修改 ---------- */
  function pushHist(){
    flush();
    openGroup = []; undoStack.push(openGroup); if (undoStack.length > 150) undoStack.shift();
    redoStack = []; lastGesture.k = null;
  }
  function stepHist(from, to, invert){
    flush();
    while (from.length && !from[from.length - 1].length) from.pop();
    const g = from.pop(); if (!g) return false;
    openGroup = null;
    const pageId = curPage().id;
    (invert ? S.invertAll(g) : g.map(S.wire)).forEach(op => S.apply(doc, op));
    doc = normalizeDoc(doc);
    to.push(g);
    inUndo = true; try { flush(); } finally { inUndo = false; }
    keepPage(pageId); deselectIfGone(); commitLocal(); renderAll();
    return true;
  }
  const undoOnline = () => stepHist(undoStack, redoStack, true) && toast(t('undoT'));
  const redoOnline = () => stepHist(redoStack, undoStack, false) && toast(t('redoT'));

  /* ---------- 收到別人的修改 ---------- */
  function applyRemote(msgs){
    flush();
    const mask = new Set(pending.flatMap(x => x.ops.map(S.target)));
    const pageId = curPage() && curPage().id;
    let n = 0;
    for (const m of msgs) for (const op of m.ops){
      if (mask.has(S.target(op))) continue;      // 我對同一處還有沒送達的修改：等伺服器排序後我的會蓋過去
      if (S.apply(doc, op)) n++;
      S.apply(base, op);
    }
    if (!n) return;
    keepPage(pageId); deselectIfGone();
    // 只重畫必要的部分；正在右側欄打字時先不要重畫，免得游標跳掉
    renderPages(); renderStage();
    if (side.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) sideStale = true;
    else renderSide();
    fileState(); thumbSoon();
  }
  function drainQueue(){ if (queue.length && !drag && !fp && dragPage == null){ const q = queue; queue = []; applyRemote(q); } }

  function keepPage(pageId){
    const i = doc.pages.findIndex(p => p.id === pageId);
    ui.page = i >= 0 ? i : clamp(ui.page, 0, doc.pages.length - 1);
  }
  function deselectIfGone(){ if (ui.sel && !selPanel() && !selItem()) deselect(); }
  function commitLocal(){ scheduleCache(); refreshThumb(); }

  /* ---------- 圖片與字體 ---------- */
  function addRemoteAsset(rec, render){
    if (assets.has(rec.id)) return;
    assets.set(rec.id, { id:rec.id, name:rec.name, w:rec.w, h:rec.h, t:rec.t, blob:null, url:`${api}/assets/${rec.id}` });
    if (render){ renderStage(); refreshThumb(); renderPages(); if (ui.tab === 'assets' || ui.tab === 'props') renderSide(); }
  }
  function dropAsset(id, quiet){
    const a = assets.get(id); if (!a) return;
    if (a.url && a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
    assets.delete(id); bmpCache.delete(id);
    if (!quiet && ui.tab === 'assets') renderSide();
  }
  async function blobOf(a){
    if (a.blob) return a.blob;
    const r = await fetch(`${api}/assets/${a.id}`);
    if (!r.ok) throw new Error('image ' + r.status);
    a.blob = await r.blob(); return a.blob;
  }
  async function ensureBlobs(){
    const list = [...assets.values()].filter(a => !a.blob);
    for (let i = 0; i < list.length; i++){ busy(t('saving'), list[i].name, i / list.length * 100); await blobOf(list[i]); }
  }
  async function upload(kind, id, blob, q){
    const r = await fetch(`${api}/${kind}/${encodeURIComponent(id)}?` + new URLSearchParams(q), {
      method:'PUT', body:blob, headers:{ 'Content-Type':blob.type || 'application/octet-stream', 'X-CPS-Cid':cid || '' } });
    if (!r.ok){ const e = await r.json().catch(() => ({})); throw new Error(e.error || r.status); }
  }
  async function uploadAsset(a){
    if (!canEdit()) throw new Error(t('cl_roToast'));
    try { await upload('assets', a.id, a.blob, { name:a.name, w:a.w, h:a.h, t:a.t }); }
    catch (e){ toast(t('cl_uploadFail', e.message)); throw e; }
  }
  function deleteAsset(id){ if (canEdit()) fetch(`${api}/assets/${encodeURIComponent(id)}`, { method:'DELETE', headers:{ 'X-CPS-Cid':cid || '' } }); }
  async function addRemoteFont(rec){
    if (customFonts.has(rec.id)) return;
    try {
      const r = await fetch(`${api}/fonts/${rec.id}`); if (!r.ok) return;
      await registerFont({ id:rec.id, name:rec.name, ext:rec.ext, t:rec.t, blob:await r.blob() });
    } catch (e){ console.warn('font', rec.name, e); }
  }
  async function uploadFont(f){
    if (!canEdit()) throw new Error(t('cl_roToast'));
    try { await upload('fonts', f.id, f.blob, { name:f.name, ext:f.ext, t:f.t }); }
    catch (e){ toast(t('cl_uploadFail', e.message)); throw e; }
  }
  function deleteFont(id){ if (canEdit()) fetch(`${api}/fonts/${encodeURIComponent(id)}`, { method:'DELETE', headers:{ 'X-CPS-Cid':cid || '' } }); }
  function removeFontLocal(id){
    const f = customFonts.get(id); if (!f) return;
    if (f.face) document.fonts.delete(f.face);
    customFonts.delete(id); renderAll();
  }

  /* ---------- 專案列表用的縮圖（第一頁） ---------- */
  let thumbTimer2 = null, thumbKey = '';
  function thumbSoon(){
    if (!canEdit()) return;
    clearTimeout(thumbTimer2);
    thumbTimer2 = setTimeout(async () => {
      if (!doc || !doc.pages.length) return;
      const key = JSON.stringify([doc.settings, doc.pages[0]]);
      if (key === thumbKey) return;
      try {
        await ensurePageFonts([0]);
        const c = await pageToCanvas(doc.pages[0], Math.min(1, 360 / doc.settings.w));
        const b = await canvasBlob(c, 'image/jpeg', 0.82);
        const r = await fetch(api + '/thumb', { method:'PUT', body:b, headers:{ 'Content-Type':'image/jpeg' } });
        if (r.ok) thumbKey = key;
      } catch (e){ console.warn('thumb', e); }
    }, 2500);
  }

  /* ---------- 狀態列、選單 ---------- */
  function fileState(){
    if (!doc) return;
    $('#projName').textContent = doc.name || t('untitled');
    $('#projName').title = t('rename');
    const st = $('#saveState');
    if (!connected){ st.className = 'dirty'; st.textContent = everConnected ? t('cl_offline') : t('cl_connecting'); }
    else if (!canEdit()){ st.className = ''; st.textContent = t('cl_readonly'); }
    else if (pending.length){ st.className = ''; st.textContent = t('cl_syncing'); }
    else { st.className = 'clean'; st.textContent = t('cl_synced'); }
    document.title = (doc.name || t('untitled')) + ' — ' + t('appName');
  }
  function buildMenu(){
    const ed = canEdit(), own = access === 'own';
    $('#fileMenu').innerHTML = `
      <button data-m="cl_projects"><span>← ${t('cl_projects')}</span></button><hr>
      ${own ? `<button data-m="cl_share"><span>${t('cl_share')}</span></button>` : ''}
      <button data-m="cl_history"><span>${t('cl_history')}</span></button><hr>
      ${ed ? `<button data-m="cl_import"><span>${t('cl_import')}</span><kbd>Ctrl+O</kbd></button><button data-m="openjson"><span>${t('cl_importJson')}</span></button><hr>` : ''}
      <button data-m="saveas"><span>${t('cl_download')}</span><kbd>Ctrl+Shift+S</kbd></button>
      <button data-m="cl_dljson"><span>${t('cl_downloadJson')}</span></button><hr>
      <button data-m="export"><span>${t('exportMenu')}</span><kbd>Ctrl+E</kbd></button>`;
  }
  function confirmReplace(){
    if (skipConfirm){ skipConfirm = false; return Promise.resolve(true); }
    if (!canEdit()){ toast(t('cl_roToast')); return Promise.resolve(false); }
    return modal({ title:t('cl_importTitle'), body:`<p>${t('cl_replaceQ')}</p>`,
      buttons:[{ label:t('cancel'), value:null }, { label:t('cl_replace'), value:1, cls:'primary' }] }).then(r => !!r.value);
  }
  let skipConfirm = false;
  async function importDialog(fresh){
    const r = await modal({ title:t('cl_importTitle'), body:`<p>${t('cl_importDesc')}</p>`,
      buttons:[{ label:t('cl_later'), value:null }, { label:t('cl_pickJson'), value:'json' }, { label:t('cl_pickFolder'), value:'dir', cls:'primary' }] });
    if (!r.value) return;
    skipConfirm = !!fresh;
    if (r.value === 'dir') openProjectFolder(); else $('#fileProj').click();
  }

  /* ---------- 分享 ---------- */
  async function shareDialog(){
    if (access !== 'own') return toast(t('cl_ownerOnly'));
    const [users, info] = await Promise.all([fetch('/api/users').then(r => r.json()), fetch(api).then(r => r.json())]);
    const shares = { ...(info.sharesDetail || {}) };
    const list = users.filter(u => u.id !== info.owner.id);
    const row = u => `<div class="shrow" data-n="${esc(u.name.toLowerCase())}">${avatarHTML(u)}<span class="nm">${esc(u.name)}</span>
      <select name="s_${u.id}"><option value="">${t('cl_noShare')}</option><option value="edit" ${shares[u.id] === 'edit' ? 'selected' : ''}>${t('cl_canEdit')}</option><option value="view" ${shares[u.id] === 'view' ? 'selected' : ''}>${t('cl_canView')}</option></select></div>`;
    const sorted = list.sort((a, b) => (!!shares[b.id] - !!shares[a.id]) || a.name.localeCompare(b.name));
    const pr = modal({ title:t('cl_shareTitle', esc(doc.name)), body:`<p class="note" style="margin-top:0">${t('cl_shareDesc')}</p>
        <div class="shrow owner">${avatarHTML(info.owner)}<span class="nm">${esc(info.owner.name)}</span><span class="muted">${t('cl_owner')}</span></div>
        <input type="text" class="shsearch" placeholder="${t('cl_search')}">
        <div class="shlist">${sorted.map(row).join('')}</div>`,
      buttons:[{ label:t('cancel'), value:null }, { label:t('ok'), value:1, cls:'primary' }] });
    const sbox = $('#modal .shsearch');
    sbox.removeAttribute('name');
    sbox.oninput = () => { const q = sbox.value.trim().toLowerCase(); document.querySelectorAll('#modal .shrow[data-n]').forEach(el => el.style.display = !q || el.dataset.n.includes(q) ? '' : 'none'); };
    const res = await pr;
    if (!res.value) return;
    const out = {};
    for (const [k, v] of Object.entries(res.form)) if (k.startsWith('s_') && v) out[k.slice(2)] = v;
    const r = await fetch(api + '/shares', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ shares:out }) });
    toast(r.ok ? t('cl_saved') : t('saveFail', r.status));
  }
  function avatarHTML(u, color){
    const ring = color ? ` style="box-shadow:0 0 0 2px ${color}"` : '';
    return u.avatar ? `<img class="av" src="${esc(u.avatar)}" alt=""${ring}>` : `<span class="av"${ring}>${esc((u.name || '?').slice(0, 1).toUpperCase())}</span>`;
  }

  /* ---------- 版本紀錄 ---------- */
  async function historyDialog(){
    const pr = modal({ title:t('cl_histTitle'), body:`<p class="note" style="margin-top:0">${t('cl_histDesc')}</p><div class="histlist">${t('cl_histLoading')}</div>`,
      buttons:[{ label:t('cancel'), value:null }] });
    const list = await fetch(api + '/history').then(r => r.json()).catch(() => []);
    const fmt = ts => new Date(ts).toLocaleString(LANG === 'zh' ? 'zh-TW' : 'en-US', { dateStyle:'medium', timeStyle:'short' });
    const box = $('#modal .histlist');
    if (box) box.innerHTML = list.length ? list.map(h => `<div class="histrow"><span>${fmt(h.t)}</span>${canEdit() ? `<button data-hid="${h.id}">${t('cl_restore')}</button>` : ''}</div>`).join('') : `<p class="muted">${t('cl_histNone')}</p>`;
    box && box.addEventListener('click', async e => {
      const b = e.target.closest('[data-hid]'); if (!b) return;
      closeModal(null);
      const hid = b.dataset.hid;
      const [snap, back] = await Promise.all([fetch(`${api}/history/${hid}`).then(r => r.json()), fetch(`${api}/history/${hid}/restore-files`, { method:'POST' }).then(r => r.json())]);
      (back.assets || []).forEach(rec => addRemoteAsset(rec, false));
      await Promise.all((back.fonts || []).map(addRemoteFont));
      if (!snap.doc) return;
      pushHistory();
      const pageId = curPage().id, keepName = doc.name;
      doc = normalizeDoc(S.clone(snap.doc)); doc.name = keepName;
      keepPage(pageId); deselectIfGone(); commit(); renderAll();
      toast(t('cl_restored', fmt(+hid)));
    });
    await pr;
  }

  /* ---------- 協作者：頭像、頁面標記、選取框 ---------- */
  function sendPres(force){
    if (!connected || !doc) return;
    const pg = curPage(), s = JSON.stringify([pg && pg.id, ui.sel]);
    if (!force && s === lastPres) return;
    lastPres = s; wsSend({ t:'pres', page:pg && pg.id, sel:ui.sel });
  }
  function drawPresence(){
    const box = $('#peers'); if (!box) return;
    const all = me ? [me, ...peers] : peers, seen = new Set();
    box.innerHTML = all.filter(u => { const k = u.id; if (seen.has(k) && u !== me) return false; seen.add(k); return true; }).map(u => {
      const pi = doc ? doc.pages.findIndex(p => p.id === u.page) : -1;
      return `<span class="peer" data-page="${esc(u.page || '')}" title="${esc(u.name)}${u === me ? t('cl_you') : ''}${pi >= 0 ? ' · ' + t('cl_onPage', pi + 1) : ''}${u.access === 'view' ? ' · ' + t('cl_canView') : ''}">${avatarHTML(u, u.color)}</span>`;
    }).join('');
    pageDots(); drawPeerSel();
  }
  function pageDots(){
    document.querySelectorAll('#pages .pg').forEach(el => {
      const pg = doc && doc.pages[+el.dataset.i]; if (!pg) return;
      let d = el.querySelector('.pdots');
      if (!d){ d = document.createElement('span'); d.className = 'pdots'; el.querySelector('.thumb').appendChild(d); }
      d.innerHTML = peers.filter(u => u.page === pg.id).map(u => `<i style="background:${u.color}" title="${esc(u.name)}"></i>`).join('');
    });
  }
  function drawPeerSel(){
    const g = document.getElementById('peerSel'); if (!g || !doc) return;
    const pg = curPage(), z = ui.zoom; let h = '';
    for (const u of peers){
      if (u.page !== pg.id || !u.sel) continue;
      let box = null, poly = null;
      for (const L of pg.layers){
        const p = L.panels.find(x => x.id === u.sel); if (p){ poly = p.pts; box = boxOfPts(p.pts); break; }
        const it = L.items.find(x => x.id === u.sel); if (it){ box = itemWorldBox(it); break; }
      }
      if (!box) continue;
      if (poly) h += `<polygon points="${ptsStr(poly)}" fill="none" stroke="${u.color}" stroke-width="${3/z}"/>`;
      else h += `<rect x="${f1(box.x0)}" y="${f1(box.y0)}" width="${f1(box.x1 - box.x0)}" height="${f1(box.y1 - box.y0)}" fill="none" stroke="${u.color}" stroke-width="${3/z}"/>`;
      const fs = 12/z, w = (u.name.length * 7.5 + 12)/z;
      h += `<rect x="${f1(box.x0)}" y="${f1(box.y0 - 20/z)}" width="${f1(w)}" height="${f1(18/z)}" rx="${f1(3/z)}" fill="${u.color}"/>`
         + `<text x="${f1(box.x0 + 6/z)}" y="${f1(box.y0 - 11/z)}" font-size="${f1(fs)}" font-family="Segoe UI, sans-serif" font-weight="700" fill="#fff" dominant-baseline="central">${esc(u.name)}</text>`;
    }
    g.innerHTML = h;
  }
  function noteSelect(id){
    if (!id || id === warnedSel) return;
    const u = peers.find(p => p.sel === id && p.page === (curPage() && curPage().id));
    if (u){ warnedSel = id; toast(t('cl_peerEditing', u.name)); }
  }

  /* ---------- 唯讀模式：擋掉會改內容的操作 ---------- */
  const ro = () => !canEdit();
  document.addEventListener('keydown', e => {
    if (!ro() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || isModalOpen()) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (k === 'delete' || k === 'backspace' || k.startsWith('arrow') || (ctrl && 'zyxdv'.includes(k)) || (ctrl && k === 'o')){ e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  for (const ev of ['paste', 'cut']) document.addEventListener(ev, e => { if (ro()) e.stopImmediatePropagation(); }, true);
  window.addEventListener('beforeunload', e => { if (pending.length || (base && doc && canEdit() && S.diff(base, doc).length)){ e.preventDefault(); e.returnValue = t('cl_leaveQ'); } });

  function boot(){
    document.body.classList.add('online');
    const hdr = document.querySelector('header .grow');
    hdr.insertAdjacentHTML('afterend', '<span id="peers"></span>');
    document.querySelector('header .brand').onclick = () => location.href = '/';
    document.querySelector('header .brand').style.cursor = 'pointer';
    $('#center').insertAdjacentHTML('beforeend', `<div id="mobileNote">${t('cl_mobileNote')}</div>`);
    // 單機版的 IndexedDB 不用：雲端專案不寫入瀏覽器暫存
    Object.assign(menuActs, {
      cl_projects:() => location.href = '/', cl_share:shareDialog, cl_history:historyDialog,
      cl_import:openProjectFolder, cl_dljson:async () => { await ensureBlobs(); closeModal(); saveLegacyJSON(); },
    });
    buildMenu();
    busy(t('cl_connecting'), ONLINE.name, 30);
    connect();
    // 僅檢視：畫面上不能拖、不能丟圖片進來（平移畫面仍可以）
    svg.addEventListener('pointerdown', e => { if (ro() && e.button === 0 && !spaceDown) e.stopImmediatePropagation(); }, true);
    work.addEventListener('drop', e => { if (ro()){ e.preventDefault(); e.stopImmediatePropagation(); toast(t('cl_roToast')); } }, true);
    pagesEl.addEventListener('dragstart', e => { if (ro()) e.preventDefault(); }, true);
    side.addEventListener('focusout', () => setTimeout(() => {
      if (sideStale && !(side.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))){ sideStale = false; renderSide(); }
    }, 0));
    // 保險：有些修改沒有呼叫 commit，定時也比對一次（拖曳中的位置也會因此即時讓別人看到）
    setInterval(() => { if (doc && base) flush(); }, 400);
    setInterval(drainQueue, 200);
    setInterval(() => sendPres(false), 300);
  }

  return { boot, flush, changed, pushHist, undo:undoOnline, redo:redoOnline, uploadAsset, deleteAsset, uploadFont, deleteFont,
    blobOf, ensureBlobs, fileState, confirmReplace, drawPeerSel, pageDots, sendPres, noteSelect, canEdit, drainQueue,
    saveNow:() => { flush(); toast(t('cl_autoSaved')); } };
})();
