// 자료취합 마감 알림 (단단이 캘린더 · 바탕화면 프로그램)
// - 자료취합 앱(별도 Firebase 프로젝트)에 "읽기"로만 연결해서
//   내 이름이 대상자 명단(roster)에 있고, 아직 제출하지 않은 취합 건을 찾아요.
// - 처음 한 번만 과 접속 코드를 입력해요. 코드는 파일에 저장하지 않아요
//   (자료취합 앱과 같은 방식으로 그 PC의 접속 기록에만 남아요).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const norm = s => String(s || '').replace(/\s+/g, '');
// 이름만 남김: "홍길동(○○과)", "홍길동 장학사", "홍길동님" → "홍길동"
const TITLES = /(장학관|장학사|교육연구관|교육연구사|연구관|연구사|주무관|사무관|서기관|과장님|과장|팀장|선생님|선생|님)$/;
const bare = s => { let t = norm(s).replace(/[\(\[（].*?[\)\]）]/g, ''); for (let i = 0; i < 2; i++) t = t.replace(TITLES, ''); return t };
const pad = n => String(n).padStart(2, '0');
export const DUE_HOUR = 18;                                 // 마감일 18시를 마감 시각으로 봄

let app, auth, db, uid, reqs = [], subs = [], unsub = [];

async function init(cfg) {
  if (app) return;
  app = initializeApp(cfg, 'collect');
  auth = getAuth(app); db = getFirestore(app);
  uid = await new Promise((res, rej) => {
    const un = onAuthStateChanged(auth, u => {
      if (u) { un(); res(u.uid); return }
      signInAnonymously(auth).catch(e => { un(); rej(e) });
    });
  });
}
// 이미 접속 코드를 넣은 적이 있는지
async function isMember() {
  try { const m = await getDoc(doc(db, 'members', uid)); if (!m.exists()) return false; await getDoc(doc(db, 'staff', 'list')); return true }
  catch (e) { return false }
}
export async function collectJoin(cfg, code) {
  await init(cfg);
  await setDoc(doc(db, 'members', uid), { code: String(code || '').trim(), at: Date.now() });
  if (!(await isMember())) throw new Error('접속 코드가 맞지 않아요');
}

// 내 이름으로 남은 취합 건 계산
function pending(name) {
  const me = bare(name); if (!me) return [];
  // 같은 사람으로 봄: 똑같은 이름, 또는 성을 빼고 적은 이름("민호" ↔ "정민호")
  const mine = n => { const b = bare(n); if (!b) return false; return b === me || (me.length >= 2 && b.length === me.length + 1 && b.endsWith(me)) || (b.length >= 2 && me.length === b.length + 1 && me.endsWith(b)) };
  const done = rid => subs.some(s => {
    const files = s.files ? (Array.isArray(s.files) ? s.files : Object.values(s.files)) : [];
    if (files.some(f => f && f.rid === rid && !f.gone && mine(f.who))) return true;
    const a = s.answers && s.answers[rid]; return !!(a && !a.gone && a.text && mine(a.who));
  });
  const now = Date.now(), out = [];
  for (const r of reqs) {
    if (r.closed || !r.deadline || !(r.roster || []).some(mine)) continue;
    const [y, m, d] = String(r.deadline).split('-').map(Number); if (!y) continue;
    const dueAt = new Date(y, m - 1, d, DUE_HOUR, 0).getTime();
    if (now > dueAt + 3 * 864e5) continue;                  // 마감 3일 지난 건 그만 보여 줌
    if (done(r.id)) continue;
    out.push({ id: r.id, title: r.title || '(제목 없음)', deadline: r.deadline, dueAt, owner: r.owner || '', mode: r.mode || 'file' });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

// 상태를 cb({state:'off'|'need-code'|'error'|'ok', items}) 로 알려 줌
export async function collectWatch(cfg, name, cb) {
  if (!cfg || !cfg.projectId) { cb({ state: 'off', items: [] }); return }
  try { await init(cfg) } catch (e) { cb({ state: 'error', items: [], msg: '자료취합에 연결하지 못했어요' }); return }
  if (!(await isMember())) { cb({ state: 'need-code', items: [] }); return }
  unsub.forEach(f => f()); unsub = [];
  const emit = () => cb({ state: 'ok', items: pending(name) });
  unsub.push(onSnapshot(collection(db, 'reqs'), q => { reqs = q.docs.map(d => ({ id: d.id, ...d.data() })); emit() }, () => cb({ state: 'error', items: [], msg: '취합 목록을 읽지 못했어요' })));
  unsub.push(onSnapshot(collection(db, 'subs'), q => { subs = q.docs.map(d => ({ uid: d.id, ...d.data() })); emit() }, () => {}));
  return () => { unsub.forEach(f => f()); unsub = [] };
}
// "D-1", "오늘 18:00 마감" 같은 글자
export function dueLabel(it, now = Date.now()) {
  const due = new Date(it.dueAt), t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - t0) / 864e5);
  if (now > it.dueAt) return { t: '마감 지남', c: 'over' };
  if (days === 0) { const h = (it.dueAt - now) / 36e5; return { t: h <= 1 ? Math.max(1, Math.round((it.dueAt - now) / 6e4)) + '분 남음' : '오늘 마감', c: 'today' } }
  if (days === 1) return { t: '내일 마감', c: 'soon' };
  return { t: 'D-' + days, c: days <= 3 ? 'soon' : '' };
}
export const fmtDue = it => { const d = new Date(it.dueAt); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':00' };
