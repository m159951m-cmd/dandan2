// 단단이 · 업무 취합 (주간 업무 일람 · 주요행사 자료 · 월간 계획)
// - 각자 자기 업무를 등록하고, 담당자는 모인 내용을 한글 파일(HWPX)로 받거나 인쇄해요.
// - 한글 파일은 과에서 쓰는 양식(forms/*.hwpx)에 내용을 채워서 만들어요.
// - 저장 위치: users/gather-box/items (사람 목록에는 나오지 않는 공용 상자)
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// - 주간 업무 일람 · 월간 계획에 등록한 것은 '과 주요일정'(팀 월별 계획표)에도 자동으로 들어가요.

export const TEAMS = ['과장', '중등장학', '중등인사', '교육과정', '교직단체'];
const KINDS = { ilam: '주간 업무 일람', event: '주요행사 자료', month: '월간 계획' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d || 1) };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = k => { const d = parse(k); return (d.getMonth() + 1) + '/' + d.getDate() };
const mdd = k => { const d = parse(k); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')' };
// 한글 문서용 날짜: "11. 3.(화)" (연도는 생략)
const hd = k => { const d = parse(k); return (d.getMonth() + 1) + '. ' + d.getDate() + '.(' + DOW[d.getDay()] + ')' };
const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };

export const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x };
export const nextWeekKey = () => ymd(addDays(mondayOf(new Date()), 7));
const weekDays = key => Array.from({ length: 7 }, (_, i) => ymd(addDays(parse(key), i)));
const weekLabel = key => { const a = parse(key), b = addDays(a, 6); return a.getFullYear() + '. ' + (a.getMonth() + 1) + '. ' + a.getDate() + '.(월) ~ ' + (b.getMonth() + 1) + '. ' + b.getDate() + '.(일)' };
const monthDefault = () => { const n = new Date(), d = new Date(n.getFullYear(), n.getMonth() + (n.getDate() >= 15 ? 1 : 0), 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1) };   // 15일부터는 다음 달
const monthDays = key => { const [y, m] = key.split('-').map(Number); const n = new Date(y, m, 0).getDate(); return Array.from({ length: n }, (_, i) => y + '-' + pad(m) + '-' + pad(i + 1)) };

let C = null;            // { fs, me, openSheet, closeSheet, toast }
let kind = 'ilam', week = null, month = null, items = [], unsub = null, editId = null;

const box = () => collection(C.fs, 'users', 'gather-box', 'items');
const itemDoc = id => doc(C.fs, 'users', 'gather-box', 'items', id);
const periodOf = k => k === 'month' ? month : week;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function initGather(ctx) { C = ctx }

/* ---------- 과 주요일정(팀 월별 계획표)에 자동으로 넣기 ----------
   단단이 '업무 일람 올리기'와 같은 이름표(id)를 써서, 나중에 일람 한글 파일을 올려도 두 번 생기지 않아요.
   같은 날 · 같은 팀 · 같은 제목이면 주간 일람과 월간 계획에 둘 다 등록해도 하나로 보여요. */
const DEPT = 'dept';
const ilId = s => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 } return 'il_' + h.toString(36) };
const firstTime = s => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : '' };
const names = s => String(s || '').split(/[,，、·\/]|\s및\s|\s외\s/).map(x => x.replace(/\(.*?\)|[*]|\s|수석교사|교사|장학사|장학관|주무관|회장|외.*$|\d+명/g, '').trim()).filter(x => /^[가-힣]{2,4}$/.test(x));
function mirrorOf(it) {
  if (!(it.kind === 'ilam' || it.kind === 'month') || !it.date || !it.title) return null;
  const head = it.title.replace(/\s+/g, ' ').trim();
  const trip = it.kind === 'ilam' && it.type === 'trip' && (/^출장$/.test(head) || (!!it.who && /출장/.test(head)));
  const title = trip ? '출장' + (it.content ? ' · ' + it.content : '') : head;
  const team = it.team || '업무';
  const people = [...new Set(names(it.type === 'trip' ? it.who : it.owner))];
  const who = people.length ? (people.length > 3 ? people.slice(0, 3).join(', ') + ' 외 ' + (people.length - 3) + '명' : people.join(', ')) + ' ' : '';
  const note = [it.content && !trip ? '내용: ' + it.content : '', it.place ? '장소: ' + it.place : '', it.attend ? '참석: ' + it.attend : '', it.time && !/^\d{1,2}:\d{2}~?$/.test(it.time) ? '시간: ' + it.time : ''].filter(Boolean).join('\n');
  return { id: ilId(DEPT + '|' + it.date + '|' + team + '|' + title), data: { title: '[' + team + '] ' + who + title, raw: title, people, date: it.date, endDate: it.end && it.end > it.date ? it.end : '', time: firstTime(it.time), pri: 'mid', cat: team, color: trip ? 'orange' : '', note, src: 'gather' } };
}
const deptDoc = id => doc(C.fs, 'users', DEPT, 'tasks', id);
async function putMirror(it) {
  const m = mirrorOf(it); if (!m) return;
  const ex = await getDoc(deptDoc(m.id)).catch(() => null);
  await setDoc(deptDoc(m.id), { ...m.data, done: ex && ex.exists() ? !!ex.data().done : false, gid: it.id, by: C.me.uid, byName: C.me.name, updated: Date.now(), ...(ex && ex.exists() ? {} : { created: Date.now() }) }, { merge: true });
}
// 다른 취합 항목이 같은 일정을 쓰고 있으면 지우지 않음
async function dropMirror(old, exceptId) {
  const m = mirrorOf(old); if (!m) return;
  try {
    const same = await getDocs(query(box(), where('date', '==', old.date)));
    if (same.docs.some(d => d.id !== exceptId && d.id !== old.id && (mirrorOf({ id: d.id, ...d.data() }) || {}).id === m.id)) return;
    const ex = await getDoc(deptDoc(m.id));
    if (ex.exists() && ex.data().src === 'gather') await deleteDoc(deptDoc(m.id));
  } catch (e) { }
}
const synced = new Set();       // 이 기능 전에 등록한 것도 한 번씩 넣어 줌
function backfill(list) { list.forEach(it => { const m = mirrorOf(it); if (!m || synced.has(it.id + m.id)) return; synced.add(it.id + m.id); putMirror(it).catch(() => synced.delete(it.id + m.id)) }) }

/* ---------- 정렬 · 한 줄 요약 ---------- */
const teamRank = t => { const i = TEAMS.indexOf(t); return i < 0 ? 9 : i };
function sorted(list, k) {
  const L = [...list];
  if (k === 'ilam') return L.sort((a, b) => a.date.localeCompare(b.date) || teamRank(a.team) - teamRank(b.team) || (a.time || '').localeCompare(b.time || '') || a.created - b.created);
  if (k === 'event') return L.sort((a, b) => (!!b.present - !!a.present) || a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.created - b.created);
  return L.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.created - b.created);
}
// 주간 업무 일람 칸에 들어갈 줄들
// 여러 날이면 "11/3(화) ~ 11/5(목)"
const ilamRange = it => it.end && it.end > it.date ? mdd(it.date) + ' ~ ' + mdd(it.end) : '';
function ilamLines(it) {
  const L = [], rng = ilamRange(it);
  if (it.type === 'trip') {
    L.push('○ ' + (it.title || '출장 및 기타 복무 사항'));
    if (it.who) L.push('출장자: ' + it.who);
    if (rng || it.time) L.push('시간(기간): ' + [rng, it.time].filter(Boolean).join(' '));
    if (it.content) L.push('내용: ' + it.content);
    if (it.place) L.push('장소: ' + it.place);
  } else {
    L.push('○ ' + it.title);
    if (rng) L.push('기간: ' + rng);
    if (it.time) L.push('시간: ' + it.time);
    if (it.content) L.push('내용: ' + it.content);
    if (it.place) L.push('장소: ' + it.place);
    if (it.attend) L.push('참석: ' + it.attend);
    if (it.owner) L.push('담당: ' + it.owner);
  }
  return L;
}
const eventWhen = it => it.end && it.end > it.date ? hd(it.date) + (it.time ? ' ' + it.time : '') + ' ~ ' + hd(it.end) : hd(it.date) + (it.time ? ' ' + it.time : '');
// 과 월간 계획 예시와 같은 모양: "∎행사명(장소, 14:00~, ~6/5)" — 여러 날이면 시작하는 날에만 적고 끝나는 날을 "~6/5"로
const monthRange = it => { if (!(it.end && it.end > it.date)) return ''; const b = parse(it.end); return '~' + (b.getMonth() + 1) + '/' + b.getDate() };
const monthTime = t => !t ? '' : /~/.test(t) ? t : t + '~';
const monthText = it => { const inside = [it.place, monthTime(it.time), monthRange(it)].filter(Boolean).join(', '); return '∎' + it.title + (inside ? '(' + inside + ')' : '') };
const monthOwner = it => (it.team || '') + (it.owner ? '(' + it.owner + ')' : '');

/* ---------- 화면 ---------- */
export function openGather(k) {
  if (k) kind = k;
  week = week || nextWeekKey(); month = month || monthDefault(); editId = null;
  C.openSheet('<div id="g-root" class="g-root"><div class="g-head"><h2>업무 취합</h2>' +
    '<div class="g-tabs" role="tablist">' + Object.entries(KINDS).map(([k, n]) => '<button type="button" role="tab" data-g-kind="' + k + '">' + n + '</button>').join('') + '<button type="button" role="tab" data-g-travel>여비 정산</button></div></div>' +
    '<div class="g-period"><button type="button" class="icon" data-g-move="-1" aria-label="이전">‹</button><b id="g-plabel"></b><button type="button" class="icon" data-g-move="1" aria-label="다음">›</button><span class="g-count" id="g-count"></span></div>' +
    '<div class="g-body"><div class="g-list" id="g-list"></div><form class="g-form" id="g-form" autocomplete="off"></form></div>' +
    '<div class="acts g-acts"><button type="button" class="btn" data-g-print>인쇄 · PDF</button><button type="button" class="btn" data-g-hwp>한글 파일 받기</button><span class="sp"></span><button type="button" class="btn primary" data-close>닫기</button></div></div>', '업무 취합', 'wide');
  const root = document.getElementById('g-root');
  root.addEventListener('click', onClick);
  root.querySelector('#g-form').addEventListener('submit', onSubmit);
  root.querySelector('#g-form').addEventListener('change', e => { if (e.target.name === 'type') renderForm(formValues()); if (e.target.name === 'date') { const en = e.target.form.querySelector('[name=end]'); if (en) { en.min = e.target.value; if (en.value && en.value <= e.target.value) en.value = '' } } });
  watch();
}
function watch() {
  if (unsub) unsub(); items = []; paint();
  const k = kind, p = periodOf(k);
  unsub = onSnapshot(query(box(), where('kind', '==', k), where('period', '==', p)), s => {
    if (!document.getElementById('g-root')) { unsub && unsub(); unsub = null; return }
    if (k !== kind || p !== periodOf(kind)) return;
    items = s.docs.map(d => ({ id: d.id, ...d.data() })); renderList(); backfill(items);
  }, () => { const l = document.getElementById('g-list'); if (l) l.innerHTML = '<p class="g-empty">목록을 불러오지 못했어요.</p>' });
}
function paint() {
  const root = document.getElementById('g-root'); if (!root) return;
  root.querySelectorAll('[data-g-kind]').forEach(b => b.setAttribute('aria-selected', b.dataset.gKind === kind));
  root.querySelector('#g-plabel').textContent = kind === 'month' ? month.replace('-', '년 ').replace(/^(\d+)년 0?(\d+)$/, '$1년 $2월') : weekLabel(week);
  renderList(); renderForm();
}
function renderList() {
  const el = document.getElementById('g-list'); if (!el) return;
  const L = sorted(items, kind);
  document.getElementById('g-count').textContent = L.length ? L.length + '건 모임' : '';
  if (!L.length) { el.innerHTML = '<p class="g-empty">아직 등록된 업무가 없어요.<br>오른쪽에서 등록해 주세요.</p>'; return }
  let h = '', last = '';
  for (const it of L) {
    const head = kind === 'event' ? (it.present ? '발표자료' : '비발표자료') : mdd(it.date);
    if (head !== last) { h += '<div class="g-day">' + head + '</div>'; last = head }
    let main, sub;
    if (kind === 'ilam') { main = (it.type === 'trip' ? '[출장·복무] ' : '') + it.title; sub = ilamLines(it).slice(1).join(' · ') }
    else if (kind === 'event') { main = it.title + ' (' + [it.owner, it.ext].filter(Boolean).join(', ') + ')'; sub = eventWhen(it) + (it.place ? ' · ' + it.place : '') }
    else { main = monthText(it).slice(1); sub = monthOwner(it) }
    h += '<div class="g-it' + (it.id === editId ? ' on' : '') + '">' + (kind !== 'event' ? '<span class="g-team t-' + teamRank(it.team) + '">' + esc(it.team || '') + '</span>' : (it.present ? '<span class="g-team t-pr">발표</span>' : '')) +
      '<div class="g-tx"><b>' + esc(main) + '</b><small>' + esc(sub) + '</small><small class="g-by">' + esc(it.byName || '') + ' 등록</small></div>' +
      '<div class="g-btns"><button type="button" class="btn-x" data-g-edit="' + it.id + '">수정</button><button type="button" class="btn-x del" data-g-del="' + it.id + '">삭제</button></div></div>';
  }
  el.innerHTML = h;
}
const sel = (name, opts, v) => '<select name="' + name + '">' + opts.map(([val, n]) => '<option value="' + esc(val) + '"' + (val === v ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
const inp = (name, label, v, ph, req) => '<label class="fl">' + label + '<input type="text" name="' + name + '" value="' + esc(v || '') + '" placeholder="' + esc(ph || '') + '"' + (req ? ' required' : '') + '></label>';
function formValues() { const f = document.getElementById('g-form'); return f ? Object.fromEntries(new FormData(f)) : {} }
function renderForm(pre) {
  const f = document.getElementById('g-form'); if (!f) return;
  const it = pre || (editId && items.find(x => x.id === editId)) || {};
  const myTeam = ls.get('g-team') || '';
  const team = it.team || myTeam || TEAMS[1];
  let h = '<h3>' + (editId ? '수정하기' : '새로 등록') + ' · ' + KINDS[kind] + '</h3>';
  if (kind === 'ilam') {
    const days = weekDays(week), type = it.type || 'work';
    h += '<div class="g-seg"><label><input type="radio" name="type" value="work"' + (type !== 'trip' ? ' checked' : '') + '><span>업무 · 행사</span></label><label><input type="radio" name="type" value="trip"' + (type === 'trip' ? ' checked' : '') + '><span>출장 · 복무</span></label></div>' +
      '<div class="row3"><label class="fl">' + (type === 'trip' ? '시작일' : '날짜 (시작일)') + sel('date', days.map(k => [k, mdd(k)]), it.date || days[0]) + '</label><label class="fl">끝나는 날 · 여러 날이면<input type="date" name="end" value="' + esc(it.end || '') + '" min="' + esc(it.date || days[0]) + '"></label><label class="fl">담당 팀' + sel('team', TEAMS.map(t => [t, t]), team) + '</label></div>';
    if (type === 'trip') h += inp('title', '제목', it.title, '예: 출장, 연가, 교육', true) + '<div class="row2">' + inp('who', '출장자', it.who ?? C.me.name) + inp('time', '시간', it.time, '예: 09:00~18:00') + '</div>' + inp('content', '내용', it.content) + inp('place', '장소', it.place);
    else h += inp('title', '행사 · 업무 이름', it.title, '예: 교원단체 정책협의회', true) + '<div class="row2">' + inp('time', '시간', it.time, '예: 14:00') + inp('place', '장소', it.place) + '</div>' + inp('content', '내용', it.content) + '<div class="row2">' + inp('attend', '참석', it.attend) + inp('owner', '담당', it.owner ?? C.me.name) + '</div>';
  } else if (kind === 'event') {
    const days = weekDays(week);
    h += '<label class="check g-pr"><input type="checkbox" name="present"' + (it.present ? ' checked' : '') + '> 발표자료 (파란 글씨로 맨 앞에 나와요)</label>' +
      inp('title', '행사명', it.title, '', true) + '<div class="row2">' + inp('owner', '담당자', it.owner ?? C.me.name) + inp('ext', '내선번호', it.ext ?? (ls.get('g-ext') || '')) + '</div>' +
      inp('purpose', '가. 목적', it.purpose) +
      '<div class="row3"><label class="fl">나. 날짜' + sel('date', days.map(k => [k, mdd(k)]), it.date || days[0]) + '</label>' + inp('time', '시간', it.time, '10:00') + '<label class="fl">끝나는 날 (여러 날이면)<input type="date" name="end" value="' + esc(it.end || '') + '"></label></div>' +
      '<div class="row2">' + inp('place', '다. 장소', it.place) + inp('target', '라. 대상', it.target) + '</div>' +
      '<label class="fl">마. 내용 (한 줄에 하나씩)<textarea name="contents" rows="3">' + esc((it.contents || []).join('\n')) + '</textarea></label>' +
      '<label class="fl">바. 홍보계획' + sel('promo', [['보도자료 제공', '보도자료 제공'], ['없음', '없음']], it.promo || '없음') + '</label>';
  } else {
    const days = monthDays(month);
    h += '<div class="row3"><label class="fl">날짜 (시작일)' + sel('date', days.map(k => [k, mdd(k)]), it.date || days[0]) + '</label><label class="fl">끝나는 날 · 여러 날이면<input type="date" name="end" value="' + esc(it.end || '') + '" min="' + esc(it.date || days[0]) + '"></label><label class="fl">담당 팀' + sel('team', TEAMS.map(t => [t, t]), team) + '</label></div>' +
      inp('title', '행사 · 업무 이름', it.title, '', true) + '<div class="row3">' + inp('time', '시간', it.time, '14:00') + inp('place', '장소', it.place) + inp('owner', '담당자', it.owner ?? C.me.name) + '</div>' +
''
  }
  h += '<div class="acts">' + (editId ? '<button type="button" class="btn" data-g-cancel>새로 등록하기</button>' : '') + '<button type="submit" class="btn primary">' + (editId ? '수정 저장' : '등록') + '</button></div>';
  f.innerHTML = h;
}
async function onSubmit(e) {
  e.preventDefault();
  const v = formValues(); const title = (v.title || '').trim(); if (!title) return;
  const base = { kind, period: periodOf(kind), date: v.date, title, time: (v.time || '').trim(), place: (v.place || '').trim(), owner: (v.owner || '').trim(), team: v.team || '', updated: Date.now(), by: C.me.uid, byName: C.me.name };
  let t;
  if (kind === 'ilam') t = { ...base, end: v.end && v.end > v.date ? v.end : '', type: v.type === 'trip' ? 'trip' : 'work', who: (v.who || '').trim(), content: (v.content || '').trim(), attend: (v.attend || '').trim() };
  else if (kind === 'event') t = { ...base, present: !!v.present, ext: (v.ext || '').trim(), purpose: (v.purpose || '').trim(), end: v.end && v.end > v.date ? v.end : '', target: (v.target || '').trim(), contents: String(v.contents || '').split('\n').map(s => s.replace(/^\s*[-·•]\s*/, '').trim()).filter(Boolean), promo: v.promo || '없음' };
  else t = { ...base, end: v.end && v.end > v.date ? v.end : '' };
  if (v.team) ls.set('g-team', v.team); if (v.ext) ls.set('g-ext', v.ext.trim());
  try {
    if (editId) {
      const old = items.find(x => x.id === editId), id = editId;
      await updateDoc(itemDoc(id), t);
      const nu = { ...old, ...t, id };
      if (old && (mirrorOf(old) || {}).id !== (mirrorOf(nu) || {}).id) await dropMirror(old, id);
      await putMirror(nu).catch(() => { });
      C.toast('수정했어요' + (mirrorOf(nu) ? ' · 과 주요일정에도 반영' : ''));
    } else {
      const id = newId(); await setDoc(itemDoc(id), { ...t, created: Date.now() });
      await putMirror({ ...t, id }).catch(() => { }); synced.add(id + ((mirrorOf({ ...t, id }) || {}).id || ''));
      C.toast('등록했어요' + (mirrorOf({ ...t, id }) ? ' · 과 주요일정에도 들어갔어요' : ''));
    }
    editId = null; renderForm(); const f = document.getElementById('g-form'); f && f.querySelector('[name=title]') && f.querySelector('[name=title]').focus();
  } catch (err) { C.toast('저장하지 못했어요') }
}
let delAsk = null, delTm = 0;
async function onClick(e) {
  const t = e.target;
  if (t.closest('[data-g-travel]')) { if (unsub) { unsub(); unsub = null } import('./travel.js').then(m => m.openTravel()); return }
  const kb = t.closest('[data-g-kind]'); if (kb) { if (kb.dataset.gKind !== kind) { kind = kb.dataset.gKind; editId = null; watch() } return }
  const mv = t.closest('[data-g-move]'); if (mv) {
    const n = Number(mv.dataset.gMove);
    if (kind === 'month') { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); month = d.getFullYear() + '-' + pad(d.getMonth() + 1) }
    else week = ymd(addDays(parse(week), 7 * n));
    editId = null; watch(); return;
  }
  const ed = t.closest('[data-g-edit]'); if (ed) { editId = ed.dataset.gEdit; renderForm(); renderList(); const f = document.getElementById('g-form'); f && f.scrollIntoView({ block: 'nearest' }); return }
  if (t.closest('[data-g-cancel]')) { editId = null; renderForm(); renderList(); return }
  const dl = t.closest('[data-g-del]'); if (dl) {
    if (delAsk !== dl) { delAsk = dl; dl.textContent = '한 번 더'; dl.classList.add('ask'); clearTimeout(delTm); delTm = setTimeout(() => { delAsk = null; dl.textContent = '삭제'; dl.classList.remove('ask') }, 3000); return }
    delAsk = null; try { const old = items.find(x => x.id === dl.dataset.gDel); await deleteDoc(itemDoc(dl.dataset.gDel)); if (old) await dropMirror(old, old.id); if (editId === dl.dataset.gDel) { editId = null; renderForm() } C.toast('삭제했어요') } catch (err) { C.toast('삭제하지 못했어요') } return;
  }
  if (t.closest('[data-g-hwp]')) { downloadHwp(); return }
  if (t.closest('[data-g-print]')) { printNow(); return }
}

/* ---------- 한글 파일(HWPX) 만들기 ---------- */
const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const kids = (el, name) => [...el.children].filter(c => c.localName === name);
const all = (el, name) => [...el.getElementsByTagNameNS(HP, name)];
function loadZipLib() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error('zip')); document.head.appendChild(s) });
}
// 같은 모양(문단·글자 모양)으로 새 문단 만들기
function makeP(src, text, charPr) {
  const p = src.cloneNode(true);
  all(p, 'linesegarray').forEach(x => x.remove());
  const runs = kids(p, 'run');
  let r = runs[0];
  if (!r) { r = p.ownerDocument.createElementNS(HP, 'hp:run'); r.setAttribute('charPrIDRef', charPr || '0'); p.insertBefore(r, p.firstChild) }
  runs.slice(1).forEach(x => x.remove());
  while (r.firstChild) r.removeChild(r.firstChild);
  if (charPr) r.setAttribute('charPrIDRef', charPr);
  if (text !== '') { const t = p.ownerDocument.createElementNS(HP, 'hp:t'); t.textContent = text; r.appendChild(t) }
  return p;
}
function setRunText(run, text) { while (run.firstChild) run.removeChild(run.firstChild); const t = run.ownerDocument.createElementNS(HP, 'hp:t'); t.textContent = text; run.appendChild(t) }
function cellMap(tbl) { const m = {}; for (const tr of kids(tbl, 'tr')) for (const tc of kids(tr, 'tc')) { const a = kids(tc, 'cellAddr')[0]; m[a.getAttribute('colAddr') + ',' + a.getAttribute('rowAddr')] = tc } return m }
const subOf = tc => kids(tc, 'subList')[0];
function fillCell(tc, paras) { const sub = subOf(tc); kids(sub, 'p').forEach(p => p.remove()); paras.forEach(p => sub.appendChild(p)) }
function setCellText(tc, text) { const p = kids(subOf(tc), 'p')[0]; fillCell(tc, [makeP(p, text)]) }

async function buildHwpx(file, edit) {
  const JSZip = await loadZipLib();
  const buf = await (await fetch('forms/' + file, { cache: 'no-cache' })).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('Contents/section0.xml').async('string');
  const docx = new DOMParser().parseFromString(xml, 'application/xml');
  if (docx.getElementsByTagName('parsererror').length) throw new Error('양식 파일을 읽지 못했어요');
  edit(docx);
  let out = new XMLSerializer().serializeToString(docx);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + out;
  zip.file('Contents/section0.xml', out);
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  if (zip.file('Preview/PrvText.txt')) zip.file('Preview/PrvText.txt', '');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}

function editIlam(docx, list, wk) {
  const tbl = all(docx.documentElement, 'tbl')[0], m = cellMap(tbl), days = weekDays(wk), a = parse(days[0]), b = parse(days[6]);
  // 제목 [2026. 11. 2. ~ 2026. 11. 8.]
  for (const r of all(m['0,0'], 'run')) { const t = all(r, 't')[0]; if (t && /\[/.test(t.textContent)) setRunText(r, '[' + a.getFullYear() + '. ' + (a.getMonth() + 1) + '. ' + a.getDate() + '. ~ ' + b.getFullYear() + '. ' + (b.getMonth() + 1) + '. ' + b.getDate() + '.]') }
  for (let c = 1; c <= 5; c++) setCellText(m[c + ',1'], mdd(days[c - 1]));
  { const ps = kids(subOf(m['6,1']), 'p'); fillCell(m['6,1'], [makeP(ps[0], mdd(days[5])), makeP(ps[1] || ps[0], mdd(days[6]))]) }
  const sample = kids(subOf(m['1,2']), 'p'), headP = sample[0], bodyP = sample[1] || sample[0];
  const standing = sample.map(p => p.cloneNode(true));                 // 과장 월요일 고정 일정(월요회의 등)은 그대로
  TEAMS.forEach((team, ri) => {
    for (let c = 1; c <= 6; c++) {
      const dset = c === 6 ? [days[5], days[6]] : [days[c - 1]];
      const its = list.filter(it => it.team === team && dset.includes(it.date));
      const paras = [];
      if (ri === 0 && c === 1) standing.forEach(p => paras.push(p));
      its.forEach(it => ilamLines(it).forEach((ln, i) => {
        if (i === 0 && c === 6) ln = '○ ' + (parse(it.date).getDay() === 6 ? '(토) ' : '(일) ') + ln.slice(2);
        paras.push(makeP(i === 0 ? headP : bodyP, ln));
      }));
      if (!paras.length) paras.push(makeP(bodyP, ''));
      fillCell(m[c + ',' + (ri + 2)], paras);
    }
  });
}
function editEvent(docx, list) {
  const sec = docx.documentElement, ps = kids(sec, 'p');
  // 0: 머리(중등교육과) · 1: 제목 · 2~5: 가~라 · 6: 마 · 7~9: - · 10: 바 · 11: 빈 줄 · 12~: 작성요령
  const [P0, PT, PA, PB, PC, PD, PE, PL, , , PF, PS] = ps;
  ps.slice(1).forEach(p => p.remove());
  const add = p => sec.appendChild(p);
  const tail = (p, idx, text) => { const c = p.cloneNode(true); all(c, 'linesegarray').forEach(x => x.remove()); const runs = kids(c, 'run'); setRunText(runs[idx], text); return c };
  list.forEach((it, i) => {
    const t = PT.cloneNode(true); all(t, 'linesegarray').forEach(x => x.remove());
    const runs = kids(t, 'run');
    setRunText(runs[0], (i + 1) + '. ' + it.title);
    if (!it.present) runs[0].setAttribute('charPrIDRef', '81');            // 발표자료만 파란 글씨
    if (runs[1]) setRunText(runs[1], '(' + [it.owner, it.ext].filter(Boolean).join(', ') + ')');
    add(t);
    add(tail(PA, kids(PA, 'run').length - 1, '가. 목적: ' + (it.purpose || '')));
    add(makeP(PB, '  나. 일시(기간): ' + eventWhen(it)));
    add(makeP(PC, '  다. 장소: ' + (it.place || '')));
    add(makeP(PD, '  라. 대상: ' + (it.target || '')));
    add(makeP(PE, '  마. 내용'));
    (it.contents && it.contents.length ? it.contents : ['']).forEach(c => add(makeP(PL, '    - ' + c)));
    add(makeP(PF, '  바. 홍보계획: ' + (it.promo || '없음')));
    add(makeP(PS, ''));
  });
}
function editMonth(docx, list, mk) {
  const [y, mo] = mk.split('-').map(Number);
  for (const t of all(docx.documentElement, 't')) if (/월\s*중등교육과\s*월간\s*계획/.test(t.textContent)) t.textContent = y + '. ' + mo + '월 중등교육과 월간 계획';
  const tbl = all(docx.documentElement, 'tbl')[0], rows = kids(tbl, 'tr');
  const ex = rows[1], exCells = kids(ex, 'tc');
  const contentP = kids(subOf(exCells[1]), 'p')[0], ownerP = kids(subOf(exCells[2]), 'p')[0];
  // 요일별 줄 모양(주말 색 등)을 양식에서 가져옴
  const byDow = {};
  rows.slice(2).forEach(r => { const c = kids(r, 'tc'); const w = all(c[1], 't').map(x => x.textContent).join('').trim(); const i = DOW.indexOf(w); if (i >= 0 && !byDow[i]) byDow[i] = r });
  rows.slice(1).forEach(r => r.remove());
  const days = monthDays(mk);
  days.forEach((k, i) => {
    const d = parse(k), src = byDow[d.getDay()] || rows[2], r = src.cloneNode(true), cs = kids(r, 'tc');
    cs.forEach(tc => kids(tc, 'cellAddr')[0].setAttribute('rowAddr', String(i + 1)));
    setCellText(cs[0], String(d.getDate())); setCellText(cs[1], DOW[d.getDay()]);
    const its = list.filter(it => it.date === k);
    fillCell(cs[2], its.length ? its.map(it => makeP(contentP, monthText(it))) : [makeP(contentP, '')]);
    fillCell(cs[3], its.length ? its.map(it => makeP(ownerP, monthOwner(it))) : [makeP(ownerP, '')]);
    tbl.appendChild(r);
  });
  tbl.setAttribute('rowCnt', String(days.length + 1));
}
function fileName() {
  if (kind === 'month') { const [y, m] = month.split('-').map(Number); return y + '. ' + m + '월 중등교육과 월간 계획.hwpx' }
  const a = parse(week), b = addDays(a, 6), r = (a.getMonth() + 1) + '.' + a.getDate() + '.~' + (b.getMonth() + 1) + '.' + b.getDate() + '.';
  return kind === 'ilam' ? '중등교육과 주요행사·업무 일람(' + r + ').hwpx' : '중등교육과 주요행사 자료(' + r + ').hwpx';
}
async function downloadHwp() {
  const L = sorted(items, kind);
  if (!L.length && kind === 'event') { C.toast('등록된 행사가 없어요'); return }
  try {
    C.toast('한글 파일을 만들고 있어요');
    const blob = kind === 'ilam' ? await buildHwpx('week-ilam.hwpx', d => editIlam(d, L, week))
      : kind === 'event' ? await buildHwpx('week-event.hwpx', d => editEvent(d, L))
        : await buildHwpx('month-plan.hwpx', d => editMonth(d, L, month));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000);
    C.toast('받았어요 · 다운로드 폴더를 확인해 주세요');
  } catch (err) { console.error(err); C.toast('한글 파일을 만들지 못했어요') }
}
// 테스트용
export const _hwpx = { buildHwpx, editIlam, editEvent, editMonth, sorted };

/* ---------- 인쇄 · PDF ---------- */
function printHTML() {
  const L = sorted(items, kind), E = s => esc(s).replace(/\n/g, '<br>');
  const css = '@page{size:A4 ' + (kind === 'ilam' ? 'landscape' : 'portrait') + ';margin:12mm}body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;color:#000;margin:0}h1{font-size:18px;text-align:center;margin:0 0 10px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #444;padding:5px 6px;font-size:11px;vertical-align:top;word-break:keep-all;overflow-wrap:anywhere}th{background:#eef1f5;font-size:12px}td.h{font-weight:700;text-align:center;vertical-align:middle;background:#f7f8fa}.o{font-weight:700;margin-top:4px}.o:first-child{margin-top:0}.ev{margin:0 0 14px;font-size:14px;line-height:1.6}.ev h2{font-size:16px;margin:0 0 2px}.ev h2.pr{color:#0033cc}.ev h2 small{font-size:12px;color:#c0c;font-weight:400}.ev p{margin:0 0 0 1.2em}.sat{color:#0033cc}.sun{color:#c00}';
  let body;
  if (kind === 'ilam') {
    const days = weekDays(week), a = parse(days[0]), b = parse(days[6]);
    body = '<h1>중등교육과 주요행사·업무 일람 [' + a.getFullYear() + '. ' + (a.getMonth() + 1) + '. ' + a.getDate() + '. ~ ' + b.getFullYear() + '. ' + (b.getMonth() + 1) + '. ' + b.getDate() + '.]</h1><table><colgroup><col style="width:7%">' + '<col>'.repeat(6) + '</colgroup><tr><th>날짜<br>담당</th>' +
      days.slice(0, 5).map(k => '<th>' + mdd(k) + '</th>').join('') + '<th>' + mdd(days[5]) + '<br>' + mdd(days[6]) + '</th></tr>' +
      TEAMS.map(team => '<tr><td class="h">' + team + '</td>' + [0, 1, 2, 3, 4, 5].map(c => {
        const ds = c === 5 ? [days[5], days[6]] : [days[c]];
        let h = team === '과장' && c === 0 ? '<div class="o">○ 월요회의</div>시간: 09:00<br>장소: 중회의실<div class="o">○ 학교정책국 부서장 회의</div>시간: 월요회의 직후<br>장소: 학교정책국장실' : '';
        L.filter(it => it.team === team && ds.includes(it.date)).forEach(it => { const ln = ilamLines(it); h += '<div class="o">' + E(ln[0]) + '</div>' + ln.slice(1).map(E).join('<br>') });
        return '<td>' + h + '</td>';
      }).join('') + '</tr>').join('') + '</table>';
  } else if (kind === 'event') {
    body = '<h1>&lt;중등교육과&gt;</h1>' + (L.length ? L.map((it, i) => '<div class="ev"><h2 class="' + (it.present ? 'pr' : '') + '">' + (i + 1) + '. ' + E(it.title) + ' <small>(' + E([it.owner, it.ext].filter(Boolean).join(', ')) + ')</small></h2>' +
      '<p>가. 목적: ' + E(it.purpose) + '</p><p>나. 일시(기간): ' + E(eventWhen(it)) + '</p><p>다. 장소: ' + E(it.place) + '</p><p>라. 대상: ' + E(it.target) + '</p><p>마. 내용</p>' + (it.contents || []).map(c => '<p>&nbsp;&nbsp;- ' + E(c) + '</p>').join('') + '<p>바. 홍보계획: ' + E(it.promo || '없음') + '</p></div>').join('') : '<p>등록된 행사가 없어요.</p>');
  } else {
    const [y, m] = month.split('-').map(Number);
    body = '<h1>' + y + '. ' + m + '월 중등교육과 월간 계획</h1><table><colgroup><col style="width:7%"><col style="width:7%"><col><col style="width:22%"></colgroup><tr><th>일</th><th>요일</th><th>주요 행사 및 업무 내용</th><th>담당</th></tr>' +
      monthDays(month).map(k => { const d = parse(k), its = L.filter(it => it.date === k), cl = d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '';
        return '<tr><td class="h ' + cl + '">' + d.getDate() + '</td><td class="h ' + cl + '">' + DOW[d.getDay()] + '</td><td>' + its.map(it => E(monthText(it))).join('<br>') + '</td><td>' + its.map(it => E(monthOwner(it))).join('<br>') + '</td></tr>' }).join('') + '</table>';
  }
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(fileName().replace('.hwpx', '')) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
}
function printNow() {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f); f.contentDocument.open(); f.contentDocument.write(printHTML()); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print() } catch (e) { C.toast('인쇄하지 못했어요') } setTimeout(() => f.remove(), 60000) }, 250);
}
