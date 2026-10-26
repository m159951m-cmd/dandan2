// 단단이 · 공지사항 보내기 + 오늘의 뉴스 보기 (업무일정표 위쪽 버튼)
// - 공지는 받는 사람의 업무일정표에 큰 창으로 뜨고, '확인했어요'를 누를 때까지 사라지지 않아요.
// - 모든 사람 / 골라서 보내기. 보낸 사람은 누가 확인했는지 볼 수 있어요.
// - '카톡으로도 보내기'를 켜면 GitHub 프로그램(notice-kakao)이 15분 안팎으로 각자 카톡 '나와의 채팅'으로 보내요.
// - 저장 위치: users/notice-box/items (사람 목록에는 나오지 않는 공용 상자)
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const when = ms => { const d = new Date(ms), t = pad(d.getHours()) + ':' + pad(d.getMinutes()); return ymd(d) === ymd(new Date()) ? '오늘 ' + t : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + t };
const DEFAULT_KW = ['한국교총', '전교조', '교사노조', '교원단체', '교권', '경남교육청'];
const HIDE = new Set(['dept', 'gather-box', 'notice-box']);

let C = null, notices = [], unsub = null, kakao = {}, kUnsub = null;
const nbox = () => collection(C.fs, 'users', 'notice-box', 'items');
const ndoc = id => doc(C.fs, 'users', 'notice-box', 'items', id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const people = () => { const P = C.profiles() || {}; return Object.keys(P).filter(u => !HIDE.has(u) && u !== C.me.uid && P[u] && P[u].name).map(u => ({ u, name: P[u].name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) };
const nameOf = u => ((C.profiles() || {})[u] || {}).name || '이름 없음';

// ctx: { fs, me(getter), profiles(), openSheet, closeSheet, toast, onChange }
export function initNotice(ctx) {
  C = ctx; if (unsub) unsub(); if (kUnsub) kUnsub();
  const since = Date.now() - 14 * 864e5;
  unsub = onSnapshot(query(nbox(), where('created', '>=', since)), s => {
    notices = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.created - b.created);
    C.onChange && C.onChange(); renderSent();
  }, () => { });
  kUnsub = onSnapshot(collection(C.fs, 'kakaoSubs'), s => { kakao = {}; s.docs.forEach(d => { if (d.data().connected) kakao[d.id] = 1 }) }, () => { });
}
const isForMe = n => n.from !== C.me.uid && (n.to === 'all' || (n.to || []).includes(C.me.uid));
const acked = n => !!(n.acks && n.acks[C.me.uid]) || ls.get('nt-ack-' + n.id) === '1';
// 아직 확인하지 않은 나에게 온 공지 (오래된 것부터)
export function noticePending() { return C ? notices.filter(n => isForMe(n) && !acked(n)) : [] }
export async function noticeAck(n) {
  ls.set('nt-ack-' + n.id, '1');
  try { await updateDoc(ndoc(n.id), { ['acks.' + C.me.uid]: Date.now(), ['ackNames.' + C.me.uid]: C.me.name }) } catch (e) { }
}
export const noticeText = n => ({ title: n.title || '공지사항', body: n.body || '', from: n.fromName || '', at: when(n.created) });

/* ---------- 공지 보내기 창 ---------- */
export function openNoticeComposer() {
  const P = people(), kc = P.filter(p => kakao[p.u]).length;
  C.openSheet('<div class="nt-root" id="nt-root"><h2>공지사항 보내기</h2><div class="nt-body">' +
    '<form id="nt-form" class="nt-form fl" autocomplete="off">' +
    '<label class="fl">제목<input type="text" name="title" maxlength="60" placeholder="예: 오늘 오후 3시 과 회의"></label>' +
    '<label class="fl">내용<textarea name="body" rows="5" maxlength="1000" required placeholder="알릴 내용을 적어 주세요"></textarea></label>' +
    '<div class="fl">받는 사람<div class="g-seg"><label><input type="radio" name="to" value="all" checked><span>모든 사람 (' + P.length + '명)</span></label><label><input type="radio" name="to" value="pick"><span>골라서 보내기</span></label></div></div>' +
    '<div class="nt-pick" id="nt-pick" hidden><div class="nt-pick-head"><span>받을 사람을 골라 주세요</span><button type="button" class="btn-x" data-nt-all>모두 선택</button></div><div class="nt-people">' +
    P.map(p => '<label><input type="checkbox" name="who" value="' + esc(p.u) + '"> ' + esc(p.name) + (kakao[p.u] ? ' <span class="nt-k" title="카톡 연결됨">카톡</span>' : '') + '</label>').join('') + '</div></div>' +
    '<label class="check nt-kakao"><input type="checkbox" name="kakao"> 카톡으로도 보내기 (선택)</label>' +
    '<p class="meta nt-note">카톡은 \'카톡으로 받기\'를 연결한 사람(' + kc + '명)에게만 가요. 평일 8시~19시에 보통 15~30분 안에 도착해요.</p>' +
    '<div class="acts"><button type="button" class="btn" data-close>닫기</button><button type="submit" class="btn primary">공지 보내기</button></div></form>' +
    '<div class="nt-sent"><h3>내가 보낸 공지</h3><div id="nt-sent"></div></div></div></div>', '공지사항 보내기', 'wide');
  const f = document.getElementById('nt-form');
  f.addEventListener('change', e => { if (e.target.name === 'to') document.getElementById('nt-pick').hidden = e.target.value !== 'pick' });
  f.addEventListener('submit', onSend);
  document.getElementById('nt-root').addEventListener('click', onClick);
  renderSent();
}
async function onSend(e) {
  e.preventDefault();
  const f = e.target, fd = new FormData(f), body = String(fd.get('body') || '').trim(), title = String(fd.get('title') || '').trim();
  if (!body) return;
  const pick = fd.get('to') === 'pick', who = fd.getAll('who');
  if (pick && !who.length) { C.toast('받을 사람을 골라 주세요'); return }
  const n = { title, body, from: C.me.uid, fromName: C.me.name, to: pick ? who : 'all', toNames: pick ? who.map(nameOf) : [], total: pick ? who.length : people().length, kakao: !!fd.get('kakao'), kakaoDone: false, acks: {}, ackNames: {}, created: Date.now() };
  try {
    await setDoc(ndoc(newId()), n);
    f.reset(); document.getElementById('nt-pick').hidden = true;
    C.toast(n.kakao ? '공지를 보냈어요 · 카톡은 곧 도착해요' : '공지를 보냈어요');
  } catch (err) { C.toast('보내지 못했어요') }
}
let delAsk = null, delTm = 0;
async function onClick(e) {
  if (e.target.closest('[data-nt-all]')) { const bs = [...document.querySelectorAll('#nt-form [name=who]')]; const on = bs.some(b => !b.checked); bs.forEach(b => b.checked = on); return }
  const d = e.target.closest('[data-nt-del]'); if (d) {
    if (delAsk !== d) { delAsk = d; d.textContent = '한 번 더'; d.classList.add('ask'); clearTimeout(delTm); delTm = setTimeout(() => { delAsk = null; d.textContent = '거두기'; d.classList.remove('ask') }, 3000); return }
    delAsk = null; try { await deleteDoc(ndoc(d.dataset.ntDel)); C.toast('공지를 거뒀어요') } catch (err) { C.toast('지우지 못했어요') }
  }
}
function renderSent() {
  const el = document.getElementById('nt-sent'); if (!el) return;
  const mine = notices.filter(n => n.from === C.me.uid).slice().reverse();
  if (!mine.length) { el.innerHTML = '<p class="g-empty">아직 보낸 공지가 없어요.</p>'; return }
  el.innerHTML = mine.map(n => {
    const targets = n.to === 'all' ? people().map(p => p.u) : (n.to || []);
    const ok = targets.filter(u => n.acks && n.acks[u]), wait = targets.filter(u => !(n.acks && n.acks[u]));
    const k = n.kakao ? (n.kakaoDone ? '카톡 보냄 ' + Object.values(n.kakaoSent || {}).filter(v => v !== 'fail').length + '명' : '카톡 보내는 중') : '';
    return '<div class="nt-it"><div class="nt-top"><b>' + esc(n.title || '공지사항') + '</b><span>' + when(n.created) + '</span></div><p>' + esc(n.body).replace(/\n/g, '<br>') + '</p>' +
      '<div class="nt-st"><span class="nt-ok">확인 ' + ok.length + ' / ' + targets.length + '</span>' + (k ? '<span class="nt-k">' + k + '</span>' : '') + '<span class="sp"></span><button type="button" class="btn-x del" data-nt-del="' + n.id + '">거두기</button></div>' +
      (wait.length ? '<small class="nt-wait">아직 확인 안 함: ' + esc(wait.map(nameOf).join(', ')) + '</small>' : '<small class="nt-wait done">모두 확인했어요 ✓</small>') + '</div>';
  }).join('');
}

/* ---------- 오늘의 뉴스 (+ 내 키워드 설정) ---------- */
const KW_CSS = '.kw-box{border:1px solid var(--line);border-radius:12px;background:var(--soft);padding:10px 12px;margin:0 0 10px;display:flex;flex-direction:column;gap:8px}' +
  '.kw-box[hidden]{display:none}.kw-chips{display:flex;flex-wrap:wrap;gap:6px}' +
  '.kw-chip{display:inline-flex;align-items:center;gap:2px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:3px 4px 3px 10px;font-size:13px}' +
  '.kw-chip button{border:0;background:none;color:var(--muted);width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:14px;line-height:1}.kw-chip button:hover{background:#ffe3e3;color:#c92a2a}' +
  '.kw-add{display:flex;gap:6px}.kw-add input{flex:1;min-width:0;border:1px solid var(--line)!important;border-radius:8px;padding:7px 10px!important;background:#fff!important;font:inherit}' +
  '.kw-note{font-size:12px;color:var(--muted);margin:0}.kw-row{display:flex;gap:6px;align-items:center}.kw-row .sp{flex:1}' +
  '.nw-kwbtn{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}.nw-kwbtn:hover{background:var(--accent-soft)}';
function kwStyle() { if (document.getElementById('kw-css')) return; const s = document.createElement('style'); s.id = 'kw-css'; s.textContent = KW_CSS; document.head.appendChild(s) }
async function loadKw() {
  try {
    const s = await getDoc(doc(C.fs, 'personal', C.me.uid, 'meta', 'news')); const k = s.exists() && s.data().keywords;
    if (Array.isArray(k) && k.length) return { kw: k, mine: true };
    const g = await getDoc(doc(C.fs, 'settings', 'news')); const b = g.exists() && g.data().keywords;
    if (Array.isArray(b) && b.length) return { kw: b, mine: false };
  } catch (e) { }
  return { kw: DEFAULT_KW.slice(), mine: false };
}
export async function openNews(opts = {}) {
  kwStyle();
  C.openSheet('<h2>오늘의 교육 뉴스</h2>' +
    '<div class="kw-box" id="kw-box" hidden><b style="font-size:14px">내 뉴스 키워드</b>' +
    '<div class="kw-chips" id="kw-chips"></div>' +
    '<form class="kw-add" id="kw-add"><input id="kw-in" maxlength="20" placeholder="키워드 넣고 Enter (예: 교원단체)" aria-label="새 키워드"><button type="submit" class="btn">추가</button></form>' +
    '<p class="kw-note">최대 12개 · 나에게만 적용돼요(카톡 뉴스도). 새로 넣은 키워드의 기사는 <b>다음 날 아침 7시</b> 뉴스부터 모여요.</p>' +
    '<div class="kw-row"><button type="button" class="btn" id="kw-def">기본값으로</button><span class="sp"></span><button type="button" class="btn" id="kw-cancel">취소</button><button type="button" class="btn primary" id="kw-save">저장</button></div></div>' +
    '<div class="nw-list" id="nw-list"><p class="g-empty">불러오는 중…</p></div>' +
    '<div class="acts"><span class="meta" id="nw-kw" style="margin-right:auto"></span><button type="button" class="nw-kwbtn" id="nw-kwbtn">⚙ 키워드 설정</button><button type="button" class="btn primary" data-close>닫기</button></div>', '오늘의 교육 뉴스', 'wide');
  let { kw } = await loadKw();
  let draft = kw.slice();
  const $ = id => document.getElementById(id);
  const box = $('kw-box'); if (!box) return;
  const chips = () => { $('kw-chips').innerHTML = draft.length ? draft.map((x, i) => '<span class="kw-chip">' + esc(x) + '<button type="button" data-kw-x="' + i + '" aria-label="' + esc(x) + ' 빼기">×</button></span>').join('') : '<span class="kw-note">키워드가 없어요. 아래에 넣어 주세요.</span>' };
  const openBox = () => { draft = kw.slice(); chips(); box.hidden = false; $('nw-kwbtn').hidden = true; setTimeout(() => $('kw-in').focus(), 0) };
  const closeBox = () => { box.hidden = true; $('nw-kwbtn').hidden = false };
  const add = v => {
    const list = String(v || '').split(/[,\n]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean);
    for (const x of list) { if (draft.includes(x)) continue; if (draft.length >= 12) { C.toast('키워드는 12개까지예요'); break } draft.push(x) }
    chips();
  };
  $('nw-kwbtn').onclick = openBox;
  $('kw-cancel').onclick = closeBox;
  $('kw-def').onclick = () => { draft = DEFAULT_KW.slice(); chips() };
  $('kw-chips').onclick = e => { const b = e.target.closest('[data-kw-x]'); if (!b) return; draft.splice(+b.dataset.kwX, 1); chips() };
  $('kw-add').onsubmit = e => { e.preventDefault(); add($('kw-in').value); $('kw-in').value = ''; $('kw-in').focus() };
  $('kw-save').onclick = async () => {
    if ($('kw-in').value.trim()) { add($('kw-in').value); $('kw-in').value = '' }
    if (!draft.length) { C.toast('키워드를 하나 이상 넣어 주세요'); return }
    const b = $('kw-save'); b.disabled = true;
    try {
      await setDoc(doc(C.fs, 'personal', C.me.uid, 'meta', 'news'), { keywords: draft.slice(0, 12), updated: Date.now(), byName: (C.me && C.me.name) || '' });
      kw = draft.slice(0, 12); closeBox(); render(); C.toast('키워드를 저장했어요. 새 키워드는 내일 아침 뉴스부터 모여요');
    } catch (e) { C.toast('저장하지 못했어요. 잠시 뒤 다시 해 주세요') }
    b.disabled = false;
  };
  if (opts.edit) openBox();

  let nd = null, old = false;
  for (let i = 0; i <= 5 && !nd; i++) { const d = new Date(); d.setDate(d.getDate() - i); try { const s = await getDoc(doc(C.fs, 'news', ymd(d))); if (s.exists()) { nd = s.data(); old = i > 0 } } catch (e) { break } }
  function render() {
    const el = $('nw-list'); if (!el) return;
    const k = $('nw-kw'); if (k) k.textContent = '내 키워드: ' + kw.join(', ');
    if (!nd) { el.innerHTML = '<p class="g-empty">아직 모은 뉴스가 없어요. 평일 아침 7시쯤 자동으로 모여요.</p>'; return }
    const items = (nd.items || []).filter(it => !it.kw || !it.kw.length || it.kw.some(x => kw.includes(x)));
    el.innerHTML = '<p class="meta" style="margin:0 0 6px">' + (old ? '최근 · ' : '') + esc(nd.label || '') + ' · ' + items.length + '건</p>' + (items.length ? '<ul class="nw">' + items.map(it => '<li><a href="' + esc(it.link) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a><small>' + esc(it.source || '') + ' · ' + when(it.pub) + ((it.kw || []).filter(x => kw.includes(x)).map(x => ' · #' + esc(x)).join('')) + '</small></li>').join('') + '</ul>' : '<p class="g-empty">키워드에 맞는 기사가 없었어요. <b>⚙ 키워드 설정</b>에서 키워드를 바꿔 보세요.</p>');
  }
  render();
}
