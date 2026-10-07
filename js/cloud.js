'use strict';
/* ================= 線上版：專案列表 ================= */
const ME = window.CPS_ME || {}, SANCTUM = window.CPS_SANCTUM || '';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const STR = {
  zh:{ appName:'漫畫分格工作室', sanctum:'回到 Sanctum', offline:'下載單機版（GitHub）', logout:'登出',
    import:'從電腦匯入', new:'＋ 新專案', search:'搜尋專案…', mine:'我的專案', shared:'與我共用', others:'全部（管理員）',
    emptyMine:'還沒有專案。按「＋ 新專案」開始，或把電腦上的專案資料夾匯入進來。', emptyShared:'還沒有人分享專案給你。', emptyOthers:'沒有其他專案。', noMatch:'沒有符合的專案。',
    open:'開啟', rename:'重新命名', share:'分享', dup:'建立副本', del:'刪除',
    newTitle:'新專案', name:'名稱', create:'建立', cancel:'取消', ok:'確定', untitled:'未命名漫畫',
    importTitle:'從電腦匯入', importDesc:'會先建立一個新的雲端專案，接著請在編輯器裡選擇專案資料夾（裡面有 project.json）或 .json 檔。',
    delTitle:'刪除專案', delQ:'確定要刪除「{0}」？分享給別人的也會一起消失。<br><small>（伺服器上會保留一份，需要救回請找管理員）</small>', delGo:'刪除',
    shareTitle:'分享「{0}」', shareDesc:'分享給 Sanctum 上有本站權限的人。「可編輯」能一起改；「僅檢視」只能看、預覽和匯出。',
    owner:'擁有者', canEdit:'可編輯', canView:'僅檢視', noShare:'不分享', searchName:'搜尋名字…', saved:'已儲存', failed:'失敗：{0}',
    pages:'{0} 頁', sharedN:'分享給 {0} 人', onlineN:'{0} 人在線上', by:'{0} 的專案', edited:'編輯於 {0}',
    accOwn:'擁有者', accEdit:'可編輯', accView:'僅檢視', dupDone:'已建立副本', justNow:'剛剛', minAgo:'{0} 分鐘前', hrAgo:'{0} 小時前', dayAgo:'{0} 天前' },
  en:{ appName:'Comic Panel Studio', sanctum:'Back to Sanctum', offline:'Offline version (GitHub)', logout:'Log out',
    import:'Import from computer', new:'+ New project', search:'Search projects…', mine:'My projects', shared:'Shared with me', others:'All (admin)',
    emptyMine:'No projects yet. Click "+ New project" to start, or import a project folder from your computer.', emptyShared:'Nobody has shared a project with you yet.', emptyOthers:'No other projects.', noMatch:'No matching projects.',
    open:'Open', rename:'Rename', share:'Share', dup:'Duplicate', del:'Delete',
    newTitle:'New project', name:'Name', create:'Create', cancel:'Cancel', ok:'OK', untitled:'Untitled comic',
    importTitle:'Import from computer', importDesc:'A new cloud project is created first; then choose the project folder (with project.json) or a .json file in the editor.',
    delTitle:'Delete project', delQ:'Delete "{0}"? People you shared it with lose it too.<br><small>(A copy stays on the server; ask an admin to recover it.)</small>', delGo:'Delete',
    shareTitle:'Share "{0}"', shareDesc:'Share with people who have access to this site in Sanctum. "Can edit" can work on it with you; "View only" can view, preview and export.',
    owner:'Owner', canEdit:'Can edit', canView:'View only', noShare:'Not shared', searchName:'Search names…', saved:'Saved', failed:'Failed: {0}',
    pages:'{0} pages', sharedN:'Shared with {0}', onlineN:'{0} online', by:"{0}'s project", edited:'Edited {0}',
    accOwn:'Owner', accEdit:'Can edit', accView:'View only', dupDone:'Duplicated', justNow:'just now', minAgo:'{0} min ago', hrAgo:'{0} h ago', dayAgo:'{0} d ago' },
};
let LANG = 'zh';
try { LANG = localStorage.getItem('cps-lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en'); } catch {}
if (!STR[LANG]) LANG = 'zh';
const t = (k, ...a) => { let s = STR[LANG][k] ?? k; a.forEach((v, i) => s = s.replace('{' + i + '}', v)); return s; };

let data = { mine:[], shared:[], others:[] }, tab = 'mine';
try { tab = sessionStorage.getItem('cps-tab') || 'mine'; } catch {}

function ago(ts){
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minAgo', Math.floor(s / 60));
  if (s < 86400) return t('hrAgo', Math.floor(s / 3600));
  if (s < 86400 * 14) return t('dayAgo', Math.floor(s / 86400));
  return new Date(ts).toLocaleDateString(LANG === 'zh' ? 'zh-TW' : 'en-US');
}
const avatar = u => u && u.avatar ? `<img class="av" src="${esc(u.avatar)}" alt="">` : `<span class="av">${esc(((u && u.name) || '?').slice(0, 1).toUpperCase())}</span>`;

function applyStatic(){
  document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i]').forEach(el => el.textContent = t(el.dataset.i));
  document.querySelectorAll('[data-ip]').forEach(el => el.placeholder = t(el.dataset.ip));
  $('#bLang').textContent = LANG === 'zh' ? 'EN' : '中';
  $('#meName').textContent = ME.name || '';
  $('#meAv').innerHTML = avatar(ME);
  if (SANCTUM) $('#lnSanctum').href = SANCTUM; else $('#lnSanctum').hidden = true;
}

async function load(){
  const r = await fetch('/api/projects');
  if (r.status === 401) return location.href = '/auth/login';
  data = await r.json();
  render();
}
function render(){
  const tabs = [['mine', data.mine.length], ['shared', data.shared.length]];
  if (ME.role === 'admin') tabs.push(['others', data.others.length]);
  if (!tabs.some(x => x[0] === tab)) tab = 'mine';
  $('#tabs').innerHTML = tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${t(k)}<span class="n">${n}</span></button>`).join('');
  const q = $('#q').value.trim().toLowerCase();
  const list = (data[tab] || []).filter(p => !q || p.name.toLowerCase().includes(q) || p.owner.name.toLowerCase().includes(q));
  $('#grid').innerHTML = list.map(card).join('');
  $('#empty').textContent = list.length ? '' : q ? t('noMatch') : t(tab === 'mine' ? 'emptyMine' : tab === 'shared' ? 'emptyShared' : 'emptyOthers');
}
function card(p){
  const acc = { own:'accOwn', edit:'accEdit', view:'accView' }[p.access];
  const own = p.access === 'own';
  return `<article class="card" data-id="${p.id}">
    <a class="thumb" href="/p/${p.id}">${p.thumb ? `<img src="/api/projects/${p.id}/thumb?v=${p.thumb}" alt="" loading="lazy">` : '<span class="blank"></span>'}
      ${p.online ? `<span class="live">● ${t('onlineN', p.online)}</span>` : ''}</a>
    <div class="info">
      <div class="nm" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="meta">${own ? '' : `${avatar(p.owner)}<span>${esc(t('by', p.owner.name))}</span> · `}<span class="acc ${p.access}">${t(acc)}</span></div>
      <div class="meta muted">${t('edited', ago(p.updated))} · ${t('pages', p.pages)}${p.shares && own ? ' · ' + t('sharedN', p.shares) : ''}</div>
      <button class="more ghost" data-more="${p.id}" aria-label="menu">⋯</button>
      <div class="dd cardmenu">
      <a href="/p/${p.id}">${t('open')}</a>
      ${p.access !== 'view' ? `<button data-act="rename">${t('rename')}</button>` : ''}
      ${own ? `<button data-act="share">${t('share')}</button>` : ''}
      <button data-act="dup">${t('dup')}</button>
      ${own || ME.role === 'admin' ? `<hr><button data-act="del" class="danger">${t('del')}</button>` : ''}
    </div>
    </div>
  </article>`;
}
const findP = id => [...data.mine, ...data.shared, ...data.others].find(p => p.id === id);

/* ---------- 對話框 ---------- */
let modalResolve = null;
function modal({ title, body = '', buttons = [] }){
  const m = $('#modal');
  $('h3', m).textContent = title || '';
  $('.mbody', m).innerHTML = body;
  $('.mbtns', m).innerHTML = buttons.map((b, i) => `<button data-mi="${i}" class="${b.cls || ''}">${b.label}</button>`).join('');
  m.classList.add('open');
  setTimeout(() => { const f = $('.mbody input[type=text]', m); if (f){ f.focus(); f.select(); } }, 30);
  return new Promise(res => {
    modalResolve = v => {
      const form = {};
      m.querySelectorAll('.mbody [name]').forEach(el => form[el.name] = el.value);
      m.classList.remove('open'); modalResolve = null; res({ value:v, form });
    };
    $('.mbtns', m).onclick = e => { const b = e.target.closest('[data-mi]'); if (b) modalResolve(buttons[+b.dataset.mi].value); };
  });
}
$('#modal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input[type=text]')){ const b = $('#modal .mbtns button.primary'); b && b.click(); }
  if (e.key === 'Escape' && modalResolve) modalResolve(null);
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && modalResolve) modalResolve(null); });
let toastTimer;
function toast(msg){ const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200); }
async function call(url, opt = {}){
  const r = await fetch(url, { ...opt, headers:{ 'Content-Type':'application/json', ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

/* ---------- 動作 ---------- */
async function newProject(importAfter){
  const r = await modal({ title:t(importAfter ? 'importTitle' : 'newTitle'),
    body:`${importAfter ? `<p class="muted">${t('importDesc')}</p>` : ''}<label class="field"><span>${t('name')}</span><input type="text" name="name" value="${esc(t('untitled'))}"></label>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('create'), value:1, cls:'primary' }] });
  if (!r.value) return;
  try {
    const p = await call('/api/projects', { method:'POST', body:JSON.stringify({ name:r.form.name.trim() || t('untitled') }) });
    location.href = '/p/' + p.id + (importAfter ? '#import' : '');
  } catch (e){ toast(t('failed', e.message)); }
}
async function rename(p){
  const r = await modal({ title:t('rename'), body:`<label class="field"><span>${t('name')}</span><input type="text" name="name" value="${esc(p.name)}"></label>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('ok'), value:1, cls:'primary' }] });
  if (!r.value || !r.form.name.trim()) return;
  try { await call('/api/projects/' + p.id, { method:'PATCH', body:JSON.stringify({ name:r.form.name.trim() }) }); load(); }
  catch (e){ toast(t('failed', e.message)); }
}
async function share(p){
  const [users, info] = await Promise.all([call('/api/users'), call('/api/projects/' + p.id)]);
  const shares = { ...(info.sharesDetail || {}) };
  const list = users.filter(u => u.id !== info.owner.id).sort((a, b) => (!!shares[b.id] - !!shares[a.id]) || a.name.localeCompare(b.name));
  const pr = modal({ title:t('shareTitle', p.name), body:`<p class="muted">${t('shareDesc')}</p>
      <div class="shrow owner">${avatar(info.owner)}<span class="nm">${esc(info.owner.name)}</span><span class="muted">${t('owner')}</span></div>
      <input type="text" class="shsearch" placeholder="${t('searchName')}">
      <div class="shlist">${list.map(u => `<div class="shrow" data-n="${esc(u.name.toLowerCase())}">${avatar(u)}<span class="nm">${esc(u.name)}</span>
        <select name="s_${u.id}"><option value="">${t('noShare')}</option><option value="edit" ${shares[u.id] === 'edit' ? 'selected' : ''}>${t('canEdit')}</option><option value="view" ${shares[u.id] === 'view' ? 'selected' : ''}>${t('canView')}</option></select></div>`).join('')}</div>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('ok'), value:1, cls:'primary' }] });
  const sb = $('#modal .shsearch');
  sb.oninput = () => { const q = sb.value.trim().toLowerCase(); document.querySelectorAll('#modal .shrow[data-n]').forEach(el => el.style.display = !q || el.dataset.n.includes(q) ? '' : 'none'); };
  const r = await pr;
  if (!r.value) return;
  const out = {};
  for (const [k, v] of Object.entries(r.form)) if (k.startsWith('s_') && v) out[k.slice(2)] = v;
  try { await call('/api/projects/' + p.id + '/shares', { method:'PUT', body:JSON.stringify({ shares:out }) }); toast(t('saved')); load(); }
  catch (e){ toast(t('failed', e.message)); }
}
async function dup(p){
  try { await call('/api/projects/' + p.id + '/duplicate', { method:'POST' }); toast(t('dupDone')); tab = 'mine'; load(); }
  catch (e){ toast(t('failed', e.message)); }
}
async function del(p){
  const r = await modal({ title:t('delTitle'), body:`<p>${t('delQ', esc(p.name))}</p>`,
    buttons:[{ label:t('cancel'), value:null }, { label:t('delGo'), value:1, cls:'danger primary' }] });
  if (!r.value) return;
  try { await call('/api/projects/' + p.id, { method:'DELETE' }); load(); }
  catch (e){ toast(t('failed', e.message)); }
}

/* ---------- 事件 ---------- */
const closeMenus = () => document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
document.addEventListener('click', e => {
  const more = e.target.closest('[data-more]');
  if (more){ e.preventDefault(); const dd = more.nextElementSibling, was = dd.classList.contains('open'); closeMenus(); if (!was) dd.classList.add('open'); return; }
  if (e.target.closest('#bUser')){ const dd = $('#userDD'), was = dd.classList.contains('open'); closeMenus(); if (!was) dd.classList.add('open'); return; }
  const act = e.target.closest('[data-act]');
  if (act){ const p = findP(act.closest('.card').dataset.id); closeMenus(); ({ rename, share, dup, del })[act.dataset.act](p); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb){ tab = tb.dataset.tab; try { sessionStorage.setItem('cps-tab', tab); } catch {} render(); return; }
  if (!e.target.closest('.dd')) closeMenus();
});
$('#q').addEventListener('input', render);
$('#bNew').onclick = () => newProject(false);
$('#bImport').onclick = () => newProject(true);
$('#bLang').onclick = () => { LANG = LANG === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('cps-lang', LANG); } catch {} applyStatic(); render(); };
// 回到這個分頁時更新（別人可能剛分享了新專案）
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

applyStatic();
load();
