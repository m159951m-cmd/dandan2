// 업무일정표 메모장: 나만 보는 메모를 여러 개 저장 (삭제하기 전까지 그대로 남아요)
// 저장 위치: personal/{내 id}/memos/{메모 id}  { title, body, created, updated }
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let C = null, memos = [], unsub = null, curId = null, dirty = false, saving = false, delAsk = 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const when = ms => { if (!ms) return ''; const d = new Date(ms), n = new Date(), t = pad(d.getHours()) + ':' + pad(d.getMinutes()); return d.toDateString() === n.toDateString() ? '오늘 ' + t : (d.getFullYear() !== n.getFullYear() ? d.getFullYear() + '. ' : '') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + t };
const box = () => collection(C.fs, 'personal', C.me.uid, 'memos');
const mdoc = id => doc(C.fs, 'personal', C.me.uid, 'memos', id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = id => document.getElementById(id);
const titleOf = m => (m.title || '').trim() || String(m.body || '').split('\n').map(s => s.trim()).find(Boolean) || '제목 없는 메모';

export function initMemo(ctx) { C = ctx }

export function openMemo() {
  if (!C || !C.me) return;
  C.openSheet('<div class="mm-root" id="mm-root"><div class="mm-head"><h2>메모장 <small>나만 보여요 · 저장하면 삭제할 때까지 남아요</small></h2><button type="button" class="btn primary" data-mm-new>+ 새 메모</button></div>' +
    '<div class="mm-body"><div class="mm-list" id="mm-list"><p class="g-empty">불러오는 중…</p></div>' +
    '<form class="mm-edit" id="mm-edit" autocomplete="off"><input type="text" name="title" placeholder="제목 (비우면 첫 줄이 제목)" aria-label="메모 제목" maxlength="80">' +
    '<textarea name="body" placeholder="메모를 적어 주세요" aria-label="메모 내용"></textarea>' +
    '<div class="mm-acts"><span class="meta" id="mm-st"></span><span class="sp"></span><button type="button" class="btn danger" data-mm-del hidden>삭제</button><button type="submit" class="btn primary">저장</button></div></form></div>' +
    '<div class="acts"><span class="meta" style="margin-right:auto">다른 메모를 누르거나 닫으면 쓰던 내용은 자동으로 저장돼요.</span><button type="button" class="btn" data-mm-close>닫기</button></div></div>', '메모장', 'wide');
  const root = $('mm-root'); curId = null; dirty = false;
  root.addEventListener('click', onClick);
  root.addEventListener('input', e => { if (e.target.closest('#mm-edit')) { dirty = true; status('저장 안 됨') } });
  $('mm-edit').addEventListener('submit', e => { e.preventDefault(); save(true) });
  $('mm-edit').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(true) } });
  if (unsub) unsub();
  unsub = onSnapshot(box(), s => {
    memos = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (!$('mm-root')) { unsub && unsub(); unsub = null; return }
    renderList();
    if (curId == null) { if (memos.length) show(memos[0].id); else show('') }
  }, () => { const l = $('mm-list'); if (l) l.innerHTML = '<p class="g-empty">메모를 불러오지 못했어요.</p>' });
}

function renderList() {
  const el = $('mm-list'); if (!el) return;
  el.innerHTML = memos.length ? memos.map(m => '<button type="button" class="mm-it' + (m.id === curId ? ' on' : '') + '" data-mm-id="' + m.id + '"><b>' + esc(titleOf(m)) + '</b><small>' + esc(String(m.body || '').replace(/\s+/g, ' ').slice(0, 60)) + '</small><em>' + when(m.updated) + '</em></button>').join('')
    : '<p class="g-empty">아직 메모가 없어요.<br>오른쪽에 적고 <b>저장</b>을 누르세요.</p>';
}
function status(t) { const s = $('mm-st'); if (s) s.textContent = t }
function show(id) {
  const f = $('mm-edit'); if (!f) return;
  const m = memos.find(x => x.id === id) || null;
  curId = m ? m.id : ''; dirty = false; delAsk = 0;
  f.title.value = m ? m.title || '' : ''; f.body.value = m ? m.body || '' : '';
  const d = f.querySelector('[data-mm-del]'); d.hidden = !m; d.textContent = '삭제'; d.classList.remove('ask');
  status(m ? '저장됨 · ' + when(m.updated) : '새 메모');
  renderList();
  setTimeout(() => (m ? f.body : f.title).focus(), 30);
}
async function save(manual) {
  const f = $('mm-edit'); if (!f || saving) return;
  const title = f.title.value.trim(), body = f.body.value;
  if (!title && !body.trim()) { if (manual) C.toast('메모 내용을 적어 주세요'); return }
  if (!manual && !dirty) return;
  saving = true; status('저장하는 중…');
  const id = curId || newId(), old = memos.find(x => x.id === id);
  try {
    await setDoc(mdoc(id), { title, body, created: old ? old.created || Date.now() : Date.now(), updated: Date.now() });
    if (curId === '' || curId === id) curId = id;
    dirty = false; status('저장됨 · ' + when(Date.now())); if (manual) C.toast('메모를 저장했어요');
    const d = f.querySelector('[data-mm-del]'); if (d) d.hidden = false;
  } catch (e) { status('저장하지 못했어요'); C.toast('메모를 저장하지 못했어요') }
  finally { saving = false }
}
async function onClick(e) {
  const t = e.target;
  if (t.closest('[data-mm-close]')) { await save(false); if (unsub) { unsub(); unsub = null } C.closeSheet(); return }
  if (t.closest('[data-mm-new]')) { await save(false); show(''); return }
  const it = t.closest('[data-mm-id]'); if (it) { if (it.dataset.mmId === curId) return; await save(false); show(it.dataset.mmId); return }
  const del = t.closest('[data-mm-del]');
  if (del && curId) {
    if (!delAsk) { delAsk = 1; del.classList.add('ask'); del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (delAsk) { delAsk = 0; del.classList.remove('ask'); del.textContent = '삭제' } }, 3500); return }
    const id = curId; delAsk = 0;
    try { await deleteDoc(mdoc(id)); C.toast('메모를 지웠어요'); curId = null; const next = memos.find(x => x.id !== id); show(next ? next.id : '') } catch (err) { C.toast('지우지 못했어요') }
  }
}
