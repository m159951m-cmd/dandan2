// 단단이 · 여비 정산 (업무 취합의 한 탭)
// - 각자: 국내여비 정산 신청서(관외 출장) 내용을 넣고, 증빙(PDF·사진)을 붙이고, 마우스로 서명해서 제출
//   · 일비 · 식비 · 자가용 연료비 · 합계는 자동 계산
//   · 연료비 = 이동거리 × 유가 ÷ 연비. 유가는 출장 첫날의 오피넷 '경남 평균판매가격'(담당자가 올린 오피넷 자료),
//     전기는 무공해차 통합누리집의 기후에너지환경부 급속(100~199kW) 요금
//   · 서명은 한 번 그리면 다음부터 자동으로 들어감
// - 담당자: 과 '출장여비 정산신청내역' 엑셀로 받기(새 파일 / 내 엑셀에 이어 붙이기),
//   정산 신청서를 한글 파일로 일괄 받기(각 신청서 다음 장에 증빙), 인쇄·PDF
// - 저장 위치: users/travel-box/items · users/travel-box/files (증빙 이미지 조각) · settings/fuel-연도 · settings/fuel-ev
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d || 1) };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 };
const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dayCount = (a, b) => Math.max(1, Math.round((parse(b || a) - parse(a)) / 864e5) + 1);
const dot = k => { const d = parse(k); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.' };
const md = k => { const d = parse(k); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')' };

// 기준 (과 엑셀 '참고' 시트의 적용비)
export const RATE = { day: 25000, meal: 25000 };
// 여비 예산이 모자라 지금은 운임 중 자가용 연료비만 지급 → 대중교통 운임 · 통행료 칸을 숨기고 합계에서도 뺌
// (다시 지급하게 되면 false 로 바꾸면 칸이 돌아와요)
export const FUEL_ONLY = true;
// 식비: 식사 시간(9시 · 12시 · 18시)이 출장 시간 안에 들어간 끼니만 셈. 끼니 수별 금액
export const MEAL = [0, 8340, 16670, 25000];
const MEAL_AT = [9 * 60, 12 * 60, 18 * 60];
const hm = s => { const m = String(s || '').match(/(\d{1,2})\s*[:시]\s*(\d{0,2})/); return m ? +m[1] * 60 + (+m[2] || 0) : null };
// 출장 시간 "09:30~18:00" → 첫날은 출발 시각부터, 마지막 날은 도착 시각까지, 가운데 날은 하루 종일
export function mealCount(t) {
  const days = dayCount(t.start, t.end), parts = String(t.time || '').split(/[~∼〜-]/);
  const a = hm(parts[0]), b = hm(parts[1]);
  const from = a == null ? 0 : a, to = b == null ? 24 * 60 : b;
  let n = 0; const per = [];
  for (let d = 0; d < days; d++) {
    const s0 = d === 0 ? from : 0, e0 = d === days - 1 ? to : 24 * 60;
    const k = MEAL_AT.filter(x => x >= s0 && x <= e0).length; per.push(k); n += k;
  }
  return { n, per };
}
export const mealMoney = left => Math.floor(left / 3) * RATE.meal + MEAL[left % 3];
export const FUEL = {
  gas: { n: '휘발유', eff: 11.97, unit: 'ℓ', key: 'g' },
  diesel: { n: '경유', eff: 12.52, unit: 'ℓ', key: 'd' },
  lpg: { n: 'LPG', eff: 8.83, unit: 'ℓ', key: 'l' },
  hybrid: { n: '하이브리드(휘발유)', eff: 15.37, unit: 'ℓ', key: 'g' },
  ev: { n: '전기', eff: 5.22, unit: 'kWh', key: 'ev' },
  h2: { n: '수소', eff: 94.9, unit: 'kg', key: '' },
};
const MODES = ['자차', 'KTX', 'SRT', '일반열차', '고속버스', '시외버스', '항공', '택시', '시내버스', '관용차량', '동승', '기타'];
const EV_DEFAULT = [{ from: '2022-09-01', p: 347.2 }];
const OPINET = 'https://www.opinet.co.kr/user/dopospdrg/dopOsPdrgSelect.do';
const EVURL = 'https://ev.or.kr/nportal/evcarInfo/initEvcarChargePriceV2.do';

let C = null, month = null, items = [], unsub = null, editId = null, cur = null, pend = [], fuelCache = {}, evList = null, sign = null;
const tbox = () => collection(C.fs, 'users', 'travel-box', 'items');
const tdoc = id => doc(C.fs, 'users', 'travel-box', 'items', id);
const fdoc = id => doc(C.fs, 'users', 'travel-box', 'files', id);

/* ---------- 유가 · 전기 단가 ---------- */
async function fuelYear(y) {
  if (fuelCache[y]) return fuelCache[y];
  try { const s = await getDoc(doc(C.fs, 'settings', 'fuel-' + y)); fuelCache[y] = s.exists() ? (s.data().days || {}) : {} } catch (e) { fuelCache[y] = {} }
  return fuelCache[y];
}
async function evPrices() {
  if (evList) return evList;
  try { const s = await getDoc(doc(C.fs, 'settings', 'fuel-ev')); evList = s.exists() && Array.isArray(s.data().list) && s.data().list.length ? s.data().list : EV_DEFAULT } catch (e) { evList = EV_DEFAULT }
  return evList;
}
// 출장 첫날 기준 단가 → { p, src } 또는 null
export async function priceFor(type, date) {
  const F = FUEL[type]; if (!F || !date) return null;
  if (F.key === 'ev') { const L = (await evPrices()).slice().sort((a, b) => a.from.localeCompare(b.from)); const hit = L.filter(x => x.from <= date).pop() || L[0]; return hit ? { p: hit.p, src: '기후에너지환경부 급속(100~199kW) ' + hit.p + '원/kWh' } : null }
  if (!F.key) return null;
  const days = await fuelYear(date.slice(0, 4)); const row = days[date];
  if (!row || !row[F.key]) return null;
  return { p: row[F.key], src: '오피넷 경남 ' + md(date) + ' ' + (F.key === 'g' ? '보통휘발유' : F.key === 'd' ? '자동차용경유' : 'LPG') + ' ' + row[F.key].toLocaleString('ko-KR') + '원/ℓ' };
}
const fuelAmt = (km, price, eff) => km > 0 && price > 0 && eff > 0 ? Math.floor(km * price / eff / 10) * 10 : 0;

/* ---------- 계산 ---------- */
export function calc(t) {
  const days = dayCount(t.start, t.end);
  const dayAmt = t.dayManual ? num(t.dayAmt) : (t.govCar ? RATE.day / 2 : RATE.day) * days;
  const mc = mealCount(t), mealLeft = Math.max(0, mc.n - num(t.mealsGiven));
  const mealAmt = t.mealManual ? num(t.mealAmt) : mealMoney(mealLeft);
  const fareSum = FUEL_ONLY ? 0 : (t.fares || []).filter(f => f.mode !== '자차').reduce((a, f) => a + num(f.amt), 0);
  const fuel = t.fuel && t.fuel.on ? (t.fuel.manual ? num(t.fuel.amt) : fuelAmt(num(t.fuel.km), num(t.fuel.price), num(t.fuel.eff) || (FUEL[t.fuel.type] || {}).eff)) : 0;
  const lodging = num(t.lodging && t.lodging.actual);
  const toll = FUEL_ONLY ? 0 : num(t.toll), cut = num(t.deduct);
  return { days, meals: mc.n, mealLeft, dayAmt, mealAmt, fareSum, fuel, lodging, toll, cut, total: dayAmt + mealAmt + fareSum + fuel + lodging + toll - cut };
}

export function initTravel(ctx) { C = ctx }

/* ---------- 화면 ---------- */
export async function openTravel() {
  month = month || ymd(new Date()).slice(0, 7); editId = null; pend = [];
  try { const s = await getDoc(doc(C.fs, 'personal', C.me.uid, 'meta', 'sign')); sign = s.exists() ? s.data().png || null : null } catch (e) { sign = null }
  C.openSheet('<div id="tv-root" class="g-root tv-root"><div class="g-head"><h2>업무 취합</h2>' +
    '<div class="g-tabs" role="tablist"><button type="button" role="tab" data-g-back="ilam">주간 업무 일람</button><button type="button" role="tab" data-g-back="event">주요행사 자료</button><button type="button" role="tab" data-g-back="month">월간 계획</button><button type="button" role="tab" aria-selected="true">여비 정산</button></div></div>' +
    '<div class="g-period"><button type="button" class="icon" data-tv-move="-1" aria-label="이전 달">‹</button><b id="tv-plabel"></b><button type="button" class="icon" data-tv-move="1" aria-label="다음 달">›</button><span class="g-count" id="tv-count"></span></div>' +
    '<div class="g-body"><div class="g-list" id="tv-list"></div><form class="g-form tv-form" id="tv-form" autocomplete="off"></form></div>' +
    '<div class="acts g-acts tv-acts"><button type="button" class="btn" data-tv-xlsx>엑셀로 받기</button><button type="button" class="btn" data-tv-append>내 엑셀에 이어 붙이기</button><button type="button" class="btn" data-tv-hwp>정산서 한글로 일괄 받기</button><button type="button" class="btn" data-tv-print>인쇄 · PDF</button><button type="button" class="btn" data-tv-fuel>유가 자료</button><span class="sp"></span><button type="button" class="btn primary" data-close>닫기</button></div>' +
    '<input type="file" id="tv-xin" accept=".xlsx" hidden><input type="file" id="tv-oin" accept=".xlsx,.xls,.csv" hidden></div>', '여비 정산', 'wide');
  const root = document.getElementById('tv-root');
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput); root.addEventListener('change', onChange);
  root.querySelector('#tv-form').addEventListener('submit', onSubmit);
  root.querySelector('#tv-xin').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) appendXlsx(f) });
  root.querySelector('#tv-oin').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importOpinet(f) });
  watch(); newForm();
}
function watch() {
  if (unsub) unsub(); items = []; renderList();
  const m = month;
  document.getElementById('tv-plabel').textContent = m.slice(0, 4) + '년 ' + Number(m.slice(5)) + '월 출장';
  unsub = onSnapshot(query(tbox(), where('period', '==', m)), s => {
    if (!document.getElementById('tv-root')) { unsub && unsub(); unsub = null; return }
    if (m !== month) return;
    items = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.start.localeCompare(b.start) || (a.name || '').localeCompare(b.name || '', 'ko'));
    renderList();
  }, () => { });
}
let picked = null;   // 담당자가 고른 것 (없으면 전부)
function renderList() {
  const el = document.getElementById('tv-list'); if (!el) return;
  document.getElementById('tv-count').textContent = items.length ? items.length + '건 · 합계 ' + won(items.reduce((a, t) => a + calc(t).total, 0)) + '원' : '';
  if (!items.length) { el.innerHTML = '<p class="g-empty">이 달에 제출된 여비 정산서가 없어요.<br>오른쪽에서 작성해 주세요.</p>'; return }
  el.innerHTML = '<div class="tv-pickall"><label><input type="checkbox" data-tv-all' + (!picked ? ' checked' : '') + '> 전체 선택 (받기 · 인쇄에 쓸 것)</label></div>' + items.map(t => {
    const c = calc(t), wait = t.fuel && t.fuel.on && !t.fuel.manual && !num(t.fuel.price);
    return '<div class="g-it' + (t.id === editId ? ' on' : '') + '"><input type="checkbox" class="tv-ck" data-tv-pick="' + t.id + '"' + (!picked || picked.has(t.id) ? ' checked' : '') + ' aria-label="선택">' +
      '<div class="g-tx"><b>' + esc(t.name) + ' · ' + esc(t.place || '') + '</b><small>' + md(t.start) + (t.end && t.end > t.start ? ' ~ ' + md(t.end) : '') + ' · ' + esc(t.purpose || '') + '</small>' +
      '<small>합계 <b class="tv-sum">' + won(c.total) + '원</b> · 증빙 ' + (t.files || []).reduce((a, f) => a + (f.pages || []).length, 0) + '장' + (t.sign ? ' · 서명 ✓' : ' · <span class="tv-warn">서명 없음</span>') + (wait ? ' · <span class="tv-warn">유가 등록 대기</span>' : '') + '</small></div>' +
      '<div class="g-btns"><button type="button" class="btn-x" data-tv-one="' + t.id + '">한글</button><button type="button" class="btn-x" data-tv-edit="' + t.id + '">수정</button><button type="button" class="btn-x del" data-tv-del="' + t.id + '">삭제</button></div></div>';
  }).join('');
}
const selected = () => items.filter(t => !picked || picked.has(t.id));

/* ---------- 작성 칸 ---------- */
function blank() {
  const today = ymd(new Date());
  return { name: C.me.name, rank: ls.get('tv-rank') || '', dept: ls.get('tv-dept') || '중등교육과', from: ls.get('tv-from') || '창원', start: today, end: '', time: '09:00~18:00', place: '', city: '', purpose: '', scope: '관외', govCar: false,
    mealsGiven: 0, lodging: { cap: '', actual: '', reason: '' }, fares: [], fuel: { on: false, km: '', type: ls.get('tv-fuel') || 'gas', price: '', eff: '', src: '' }, toll: '', deduct: '', note: '', applyDate: today, files: [] };
}
function newForm() { editId = null; cur = blank(); pend = []; renderForm(); renderList() }
const I = (n, label, v, extra = '') => '<label class="fl">' + label + '<input name="' + n + '" value="' + esc(v ?? '') + '" ' + extra + '></label>';
function renderForm() {
  const f = document.getElementById('tv-form'); if (!f) return; const t = cur, c = calc(t);
  const fuelOpts = Object.entries(FUEL).map(([k, v]) => '<option value="' + k + '"' + (t.fuel.type === k ? ' selected' : '') + '>' + v.n + '</option>').join('');
  f.innerHTML = '<h3>' + (editId ? '정산서 수정' : '여비 정산서 작성') + ' <small class="tv-sub">국내여비 정산 신청서(관외 출장)</small></h3>' +
    '<fieldset><legend>신청인</legend><div class="row3">' + I('name', '성명', t.name, 'required') + I('rank', '직급(직위)', t.rank, 'placeholder="예: 장학사"') + I('dept', '소속', t.dept) + '</div></fieldset>' +
    '<fieldset><legend>출장 일정</legend><div class="row3">' + I('start', '출장 시작일', t.start, 'type="date" required') + I('end', '끝나는 날 (하루면 비움)', t.end, 'type="date"') + I('time', '출장 시간', t.time, 'placeholder="09:00~18:00"') + '</div>' +
    '<div class="row3">' + I('place', '출장지 (장소)', t.place, 'required placeholder="예: 경주 한화리조트"') + I('city', '출장 지역 (시·군)', t.city, 'placeholder="예: 경주"') + I('from', '출발지 (근무지·거주지)', t.from) + '</div>' +
    I('purpose', '출장 목적', t.purpose, 'required') + '</fieldset>' +
    '<fieldset><legend>일비 · 식비 · 숙박비</legend><div class="row3"><label class="fl">일비 (' + c.days + '일)<input name="dayAmt" value="' + c.dayAmt + '" inputmode="numeric"></label>' +
    '<label class="fl">식사 제공받은 횟수 (전체 ' + c.meals + '끼 중)<input name="mealsGiven" type="number" min="0" max="' + c.meals + '" value="' + num(t.mealsGiven) + '"></label><label class="fl">식비<input name="mealAmt" value="' + c.mealAmt + '" inputmode="numeric"></label></div>' +
    '<label class="check"><input type="checkbox" name="govCar"' + (t.govCar ? ' checked' : '') + '> 관용차량으로 다녀왔어요 (일비 1/2)</label>' +
    '<p class="meta tv-hint" id="tv-mealh">' + mealHint(t, c) + '</p>' +
    '<div class="row3">' + I('lcap', '숙박 상한액 또는 받은 선금', t.lodging.cap, 'inputmode="numeric"') + I('lact', '숙박 실제 소요액', t.lodging.actual, 'inputmode="numeric"') + I('lrsn', '초과지출 사유', t.lodging.reason) + '</div></fieldset>' +
    (FUEL_ONLY ? '' : '<fieldset><legend>운임 (대중교통 등)</legend><div class="tv-fares">' + t.fares.map((r, i) =>
      '<div class="tv-fare"><input type="date" data-fare="' + i + '" data-k="date" value="' + esc(r.date || '') + '" aria-label="일자"><select data-fare="' + i + '" data-k="mode" aria-label="교통편">' + MODES.map(m => '<option' + (r.mode === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' +
      '<input data-fare="' + i + '" data-k="from" value="' + esc(r.from || '') + '" placeholder="출발지"><input data-fare="' + i + '" data-k="to" value="' + esc(r.to || '') + '" placeholder="도착지"><input data-fare="' + i + '" data-k="grade" value="' + esc(r.grade || '') + '" placeholder="등급"><input data-fare="' + i + '" data-k="amt" value="' + esc(r.amt || '') + '" placeholder="금액" inputmode="numeric"' + (r.mode === '자차' ? ' disabled title="자차는 아래 연료비로 계산돼요"' : '') + '><button type="button" class="btn-x del" data-fare-del="' + i + '" aria-label="이 줄 지우기">✕</button></div>').join('') +
    '</div><button type="button" class="btn-x" data-fare-add>+ 운임 줄 추가</button>' + (t.fares.length > 4 ? '<p class="meta tv-warn">정산서 칸은 4줄이라 5번째 줄부터는 "외 n건"으로 합쳐져요.</p>' : '') + '</fieldset>') +
    '<fieldset><legend>' + (FUEL_ONLY ? '운임 (자가용 연료비만 지급)' : '자가용 연료비') + '</legend>' + (FUEL_ONLY ? '<p class="meta tv-hint">지금은 여비 예산 사정으로 운임은 <b>자가용 연료비만</b> 지급해요. 대중교통 운임 · 통행료는 적지 않아요.</p>' : '') + '<label class="check"><input type="checkbox" name="fon"' + (t.fuel.on ? ' checked' : '') + '> 자가용으로 다녀왔어요</label>' +
    (t.fuel.on ? '<div class="row3">' + I('km', '이동거리 (왕복 km)', t.fuel.km, 'inputmode="decimal" placeholder="예: 214"') + '<label class="fl">유종<select name="ftype">' + fuelOpts + '</select></label>' + (FUEL_ONLY ? '<span></span>' : I('toll', '통행료', t.toll, 'inputmode="numeric"')) + '</div>' +
      '<div class="row3">' + I('fprice', '단가 (원/' + (FUEL[t.fuel.type] || {}).unit + ')', t.fuel.price, 'inputmode="decimal"') + I('feff', '연비 (km/' + (FUEL[t.fuel.type] || {}).unit + ')', t.fuel.eff || (FUEL[t.fuel.type] || {}).eff, 'inputmode="decimal"') + '<label class="fl">연료비<input name="famt" value="' + c.fuel + '" readonly></label></div>' +
      '<p class="meta tv-hint" id="tv-fsrc">' + fuelNote(t) + '</p>' : (FUEL_ONLY ? '' : '<div class="row3">' + I('toll', '통행료', t.toll, 'inputmode="numeric"') + '</div>')) + '</fieldset>' +
    '<fieldset><legend>증빙 서류 (PDF · 사진)</legend><div class="tv-files">' + filesHTML() + '</div><label class="btn-x tv-up">+ 파일 붙이기<input type="file" id="tv-fin" accept="application/pdf,image/*" multiple hidden></label><p class="meta tv-hint">영수증 · 교통비 증빙 등을 붙이면 정산서 다음 장에 출력돼요. PDF는 쪽마다 사진으로 바뀌어요 (최대 10쪽).</p></fieldset>' +
    '<fieldset><legend>기타</legend><div class="row3">' + I('deduct', '공제', t.deduct, 'inputmode="numeric"') + I('scope', '관내/관외', t.scope) + I('applyDate', '신청일', t.applyDate, 'type="date"') + '</div>' + I('note', '비고', t.note, 'placeholder="예: 동승, 1식 제공"') + '</fieldset>' +
    '<div class="tv-total"><div><span>일비</span><b>' + won(c.dayAmt) + '</b></div><div><span>식비</span><b>' + won(c.mealAmt) + '</b></div><div><span>숙박비</span><b>' + won(c.lodging) + '</b></div>' + (FUEL_ONLY ? '<div><span>운임(연료비)</span><b>' + won(c.fuel) + '</b></div>' : '<div><span>운임</span><b>' + won(c.fareSum) + '</b></div><div><span>연료비</span><b>' + won(c.fuel) + '</b></div><div><span>통행료</span><b>' + won(c.toll) + '</b></div>') + (c.cut ? '<div><span>공제</span><b>-' + won(c.cut) + '</b></div>' : '') + '<div class="all"><span>합계</span><b>' + won(c.total) + '원</b></div></div>' +
    '<div class="tv-sign"><div class="tv-sign-box">' + (sign ? '<img src="' + sign + '" alt="내 서명">' : '<span>아직 서명이 없어요</span>') + '</div><button type="button" class="btn-x" data-tv-sign>' + (sign ? '서명 다시 그리기' : '서명 그리기') + '</button><small>한 번 그리면 다음부터 자동으로 들어가요.</small></div>' +
    '<div class="acts">' + (editId ? '<button type="button" class="btn" data-tv-new>새로 작성</button>' : '') + '<button type="submit" class="btn primary">' + (editId ? '수정 저장' : '서명하고 제출') + '</button></div>';
  f.querySelector('#tv-fin').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = '' });
  if (t.fuel.on && !num(t.fuel.price)) refreshPrice();
}
function mealHint(t, c) {
  return '일비 하루 25,000원 · 식비는 출장 시간에 식사 시간(9시 · 12시 · 18시)이 들어간 끼니만 셈해요: 이번 출장 <b>' + c.meals + '끼</b>' + (num(t.mealsGiven) ? ' − 제공 ' + num(t.mealsGiven) + '끼 = ' + c.mealLeft + '끼' : '') + ' → ' + won(c.mealAmt) + '원 (1끼 8,340 · 2끼 16,670 · 3끼 25,000). 금액은 직접 고쳐도 돼요.';
}
function fuelNote(t) {
  const F = FUEL[t.fuel.type] || {};
  if (t.fuel.src) return '단가: ' + esc(t.fuel.src) + ' · 연료비 = 거리 × 단가 ÷ 연비 (10원 미만 버림)';
  if (F.key === 'ev') return '단가: <a href="' + EVURL + '" target="_blank" rel="noopener">무공해차 통합누리집</a> 기후에너지환경부 급속(100~199kW) 요금';
  if (!F.key) return '수소는 단가를 직접 넣어 주세요.';
  const last = t.fuel.lastDay ? ' (지금 등록된 유가는 ' + md(t.fuel.lastDay) + '까지예요)' : '';
  const today = t.start >= ymd(new Date()) ? ' 오늘 · 앞으로의 유가는 그날 밤에 자동으로 들어와요.' : '';
  return '<span class="tv-warn">' + md(t.start) + ' 오피넷 유가가 아직 없어요' + last + '.</span>' + today + ' 담당자가 <a href="' + OPINET + '" target="_blank" rel="noopener">오피넷</a> 자료를 올리면 자동으로 계산돼요. 지금 직접 넣어도 돼요.';
}
async function refreshPrice() {
  const t = cur; if (!t.fuel.on) return;
  const r = await priceFor(t.fuel.type, t.start);
  if (cur !== t) return;
  if (r) { t.fuel.price = r.p; t.fuel.src = r.src } else { t.fuel.src = ''; if (!t.fuel.priceManual) t.fuel.price = ''; const ks = Object.keys(await fuelYear(t.start.slice(0, 4))).sort(); t.fuel.lastDay = ks[ks.length - 1] || '' }
  const f = document.getElementById('tv-form'); if (!f) return;
  const pi = f.querySelector('[name=fprice]'); if (pi) pi.value = t.fuel.price;
  const n = document.getElementById('tv-fsrc'); if (n) n.innerHTML = fuelNote(t);
  updateTotals();
}
function read() {
  const f = document.getElementById('tv-form'); if (!f) return; const t = cur, v = n => { const e = f.querySelector('[name=' + n + ']'); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined };
  ['name', 'rank', 'dept', 'start', 'end', 'time', 'place', 'city', 'from', 'purpose', 'deduct', 'scope', 'applyDate', 'note', 'toll'].forEach(k => { const x = v(k); if (x !== undefined) t[k] = typeof x === 'string' ? x.trim() : x });
  t.govCar = !!v('govCar'); t.mealsGiven = num(v('mealsGiven'));
  t.lodging = { cap: v('lcap') || '', actual: v('lact') || '', reason: (v('lrsn') || '').trim() };
  if (v('km') !== undefined) { t.fuel.km = v('km'); t.fuel.type = v('ftype'); t.fuel.eff = v('feff') }
  f.querySelectorAll('[data-fare]').forEach(e => { const r = t.fares[+e.dataset.fare]; if (r) r[e.dataset.k] = e.value });
}
function updateTotals() {
  const f = document.getElementById('tv-form'); if (!f) return; const c = calc(cur);
  const set = (n, val) => { const e = f.querySelector('[name=' + n + ']'); if (e && document.activeElement !== e) e.value = val };
  set('dayAmt', c.dayAmt); set('mealAmt', c.mealAmt); set('famt', c.fuel);
  const mh = document.getElementById('tv-mealh'); if (mh) mh.innerHTML = mealHint(cur, c);
  const mg = f.querySelector('[name=mealsGiven]'); if (mg) { mg.max = c.meals; const lb = mg.closest('label'); if (lb && lb.firstChild && lb.firstChild.nodeType === 3) lb.firstChild.textContent = '식사 제공받은 횟수 (전체 ' + c.meals + '끼 중)' }
  const box = f.querySelector('.tv-total'); if (box) box.outerHTML = '<div class="tv-total"><div><span>일비</span><b>' + won(c.dayAmt) + '</b></div><div><span>식비</span><b>' + won(c.mealAmt) + '</b></div><div><span>숙박비</span><b>' + won(c.lodging) + '</b></div>' + (FUEL_ONLY ? '<div><span>운임(연료비)</span><b>' + won(c.fuel) + '</b></div>' : '<div><span>운임</span><b>' + won(c.fareSum) + '</b></div><div><span>연료비</span><b>' + won(c.fuel) + '</b></div><div><span>통행료</span><b>' + won(c.toll) + '</b></div>') + (c.cut ? '<div><span>공제</span><b>-' + won(c.cut) + '</b></div>' : '') + '<div class="all"><span>합계</span><b>' + won(c.total) + '원</b></div></div>';
}
function onInput(e) {
  if (!e.target.closest('#tv-form')) return;
  const n = e.target.name;
  if (n === 'dayAmt') { cur.dayManual = true; cur.dayAmt = e.target.value }
  if (n === 'mealAmt') { cur.mealManual = true; cur.mealAmt = e.target.value }
  if (n === 'fprice') { cur.fuel.price = e.target.value; cur.fuel.priceManual = true; cur.fuel.src = cur.fuel.price ? '직접 입력 ' + cur.fuel.price + '원' : ''; const n = document.getElementById('tv-fsrc'); if (n) n.innerHTML = fuelNote(cur) }
  read(); updateTotals();
}
function onChange(e) {
  if (!e.target.closest('#tv-form')) return;
  const n = e.target.name;
  read();
  if (n === 'mealsGiven') cur.mealManual = false;
  if (n === 'govCar' || n === 'start' || n === 'end') cur.dayManual = false;
  if (n === 'time' || n === 'start' || n === 'end') cur.mealManual = false;
  if (n === 'fon') { cur.fuel.on = e.target.checked; renderForm(); return }
  if (n === 'ftype') { cur.fuel.eff = ''; cur.fuel.priceManual = false; ls.set('tv-fuel', e.target.value); renderForm(); return }
  if (n === 'start' && cur.fuel.on && !cur.fuel.priceManual) refreshPrice();
  if (e.target.dataset.k === 'mode') { renderForm(); return }
  updateTotals();
}

/* ---------- 증빙 파일: 사진은 줄이고, PDF는 쪽마다 사진으로 ---------- */
function filesHTML() {
  const old = (cur.files || []).map((f, i) => '<span class="tv-file">' + esc(f.name) + ' (' + (f.pages || []).length + '장)<button type="button" data-file-del="' + i + '" aria-label="빼기">✕</button></span>');
  const neu = pend.map((f, i) => '<span class="tv-file new">' + esc(f.name) + (f.busy ? ' · 바꾸는 중…' : ' (' + f.pages.length + '장)') + '<button type="button" data-pend-del="' + i + '" aria-label="빼기">✕</button></span>');
  return old.concat(neu).join('') || '<span class="meta">붙인 파일이 없어요.</span>';
}
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) { const t = setInterval(() => { if (window.pdfjsLib || window.ExcelJS || window.JSZip) { clearInterval(t); res() } }, 50); setTimeout(() => { clearInterval(t); res() }, 4000); return } const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s) }) }
const canvasJpeg = cv => cv.toDataURL('image/jpeg', 0.82);
function fit(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)] }
async function imageToJpeg(file) {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url });
    const [w, h] = fit(img.naturalWidth, img.naturalHeight, 1700); const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); return [{ w, h, data: canvasJpeg(cv) }];
  } finally { URL.revokeObjectURL(url) }
}
async function pdfToJpegs(file) {
  if (!window.pdfjsLib) await loadScript('lib/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 10); p++) {
    const page = await pdf.getPage(p), v0 = page.getViewport({ scale: 1 }), k = Math.min(2.2, 1600 / Math.max(v0.width, v0.height)), vp = page.getViewport({ scale: k });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise; out.push({ w: cv.width, h: cv.height, data: canvasJpeg(cv) });
  }
  return out;
}
async function addFiles(list) {
  for (const file of list) {
    if (file.size > 20e6) { C.toast(file.name + ': 20MB보다 큰 파일은 붙일 수 없어요'); continue }
    const it = { name: file.name, busy: true, pages: [] }; pend.push(it); refreshFiles();
    try { it.pages = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfToJpegs(file) : await imageToJpeg(file) }
    catch (e) { pend.splice(pend.indexOf(it), 1); C.toast(file.name + ': 읽지 못했어요') }
    it.busy = false; refreshFiles();
  }
}
function refreshFiles() { const el = document.querySelector('#tv-form .tv-files'); if (el) el.innerHTML = filesHTML() }
const CH = 700000;
async function uploadPages(pages) {
  const fid = newId(), meta = [];
  for (let p = 0; p < pages.length; p++) {
    const b64 = pages[p].data.split(',')[1], n = Math.ceil(b64.length / CH);
    for (let c = 0; c < n; c++) await setDoc(fdoc(fid + '_' + p + '_' + c), { d: b64.slice(c * CH, (c + 1) * CH) });
    meta.push({ w: pages[p].w, h: pages[p].h, n });
  }
  return { fid, pages: meta };
}
async function pageData(f, p) { const pg = f.pages[p]; let s = ''; for (let c = 0; c < pg.n; c++) { const d = await getDoc(fdoc(f.fid + '_' + p + '_' + c)); s += d.exists() ? d.data().d : '' } return s }
async function dropFile(f) { try { for (let p = 0; p < (f.pages || []).length; p++) for (let c = 0; c < f.pages[p].n; c++) await deleteDoc(fdoc(f.fid + '_' + p + '_' + c)) } catch (e) { } }

/* ---------- 서명 ---------- */
function signPad() {
  return new Promise(resolve => {
    const w = document.createElement('div'); w.className = 'tv-pad-wrap';
    w.innerHTML = '<div class="tv-pad"><h3>서명 그리기</h3><p class="meta">마우스(또는 손가락)로 이름을 써 주세요.</p><canvas width="560" height="200"></canvas><div class="acts"><button type="button" class="btn" data-x>지우기</button><span class="sp"></span><button type="button" class="btn" data-c>취소</button><button type="button" class="btn primary" data-ok>저장</button></div></div>';
    document.body.appendChild(w);
    const cv = w.querySelector('canvas'), g = cv.getContext('2d'); g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    let down = false, any = false;
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height] };
    cv.addEventListener('pointerdown', e => { down = true; any = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y) });
    cv.addEventListener('pointermove', e => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke() });
    cv.addEventListener('pointerup', () => { down = false });
    w.querySelector('[data-x]').onclick = () => { g.clearRect(0, 0, cv.width, cv.height); any = false };
    w.querySelector('[data-c]').onclick = () => { w.remove(); resolve(null) };
    w.querySelector('[data-ok]').onclick = () => {
      if (!any) return;
      // 그린 부분만 잘라서 저장
      const d = g.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(cv.width - 1, x1 + m); y1 = Math.min(cv.height - 1, y1 + m);
      const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      w.remove(); resolve(o.toDataURL('image/png'));
    };
  });
}
async function drawSign() {
  const png = await signPad(); if (!png) return null;
  sign = png; try { await setDoc(doc(C.fs, 'personal', C.me.uid, 'meta', 'sign'), { png, at: Date.now() }) } catch (e) { }
  const b = document.querySelector('#tv-form .tv-sign-box'); if (b) b.innerHTML = '<img src="' + png + '" alt="내 서명">';
  const bt = document.querySelector('[data-tv-sign]'); if (bt) bt.textContent = '서명 다시 그리기';
  return png;
}

/* ---------- 저장 ---------- */
async function onSubmit(e) {
  e.preventDefault(); read(); const t = cur;
  if (!t.name || !t.start || !t.place || !t.purpose) { C.toast('성명 · 출장일 · 출장지 · 목적을 넣어 주세요'); return }
  if (pend.some(f => f.busy)) { C.toast('증빙 파일을 바꾸는 중이에요. 잠시 후 다시 눌러 주세요'); return }
  const mine = !editId || (items.find(x => x.id === editId) || {}).pid === C.me.uid;
  if (mine && !sign) { const p = await drawSign(); if (!p) { C.toast('서명을 그려야 제출할 수 있어요'); return } }
  ls.set('tv-rank', t.rank); ls.set('tv-dept', t.dept); ls.set('tv-from', t.from);
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '올리는 중…';
  try {
    const files = (t.files || []).slice();
    for (const f of pend) files.push({ name: f.name, ...(await uploadPages(f.pages)) });
    const c = calc(t);
    const data = { ...t, files, period: t.start.slice(0, 7), dayAmt: c.dayAmt, mealAmt: c.mealAmt, total: c.total,
      fuel: { ...t.fuel, amt: c.fuel, eff: num(t.fuel.eff) || (FUEL[t.fuel.type] || {}).eff || 0 }, updated: Date.now(), by: C.me.uid, byName: C.me.name };
    if (mine) data.sign = sign;
    delete data.id;
    if (editId) { await updateDoc(tdoc(editId), data); C.toast('수정했어요') }
    else { await setDoc(tdoc(newId()), { ...data, pid: C.me.uid, created: Date.now() }); C.toast('제출했어요 · 합계 ' + won(c.total) + '원') }
    if (data.period !== month) { month = data.period; watch() }
    newForm();
  } catch (err) { console.error(err); C.toast('저장하지 못했어요') }
  finally { btn.disabled = false }
}
let delAsk = null, delTm = 0;
async function onClick(e) {
  const t = e.target;
  const back = t.closest('[data-g-back]'); if (back) { if (unsub) { unsub(); unsub = null } C.openGather(back.dataset.gBack); return }
  const mv = t.closest('[data-tv-move]'); if (mv) { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + Number(mv.dataset.tvMove), 1); month = d.getFullYear() + '-' + pad(d.getMonth() + 1); picked = null; watch(); return }
  if (t.closest('[data-tv-all]')) { picked = t.checked ? null : new Set(); renderList(); return }
  const pk = t.closest('[data-tv-pick]'); if (pk) { if (!picked) picked = new Set(items.map(x => x.id)); pk.checked ? picked.add(pk.dataset.tvPick) : picked.delete(pk.dataset.tvPick); if (picked.size === items.length) picked = null; renderList(); return }
  const ed = t.closest('[data-tv-edit]'); if (ed) { const it = items.find(x => x.id === ed.dataset.tvEdit); if (!it) return; editId = it.id; cur = JSON.parse(JSON.stringify(it)); cur.fuel = { ...blank().fuel, ...(cur.fuel || {}) }; cur.lodging = cur.lodging || { cap: '', actual: '', reason: '' }; cur.fares = cur.fares || []; pend = []; renderForm(); renderList(); return }
  if (t.closest('[data-tv-new]')) { newForm(); return }
  const dl = t.closest('[data-tv-del]'); if (dl) {
    if (delAsk !== dl) { delAsk = dl; dl.textContent = '한 번 더'; dl.classList.add('ask'); clearTimeout(delTm); delTm = setTimeout(() => { delAsk = null; dl.textContent = '삭제'; dl.classList.remove('ask') }, 3000); return }
    delAsk = null; const it = items.find(x => x.id === dl.dataset.tvDel); try { await deleteDoc(tdoc(dl.dataset.tvDel)); for (const f of (it && it.files) || []) await dropFile(f); if (editId === dl.dataset.tvDel) newForm(); C.toast('삭제했어요') } catch (err) { C.toast('삭제하지 못했어요') } return;
  }
  if (t.closest('[data-fare-add]')) { read(); const last = cur.fares[cur.fares.length - 1]; cur.fares.push({ date: last ? last.date : cur.start, mode: cur.fuel.on ? '자차' : 'KTX', from: last ? last.to : cur.from, to: last ? last.from : (cur.city || ''), grade: '', amt: '' }); renderForm(); return }
  const fd = t.closest('[data-fare-del]'); if (fd) { read(); cur.fares.splice(+fd.dataset.fareDel, 1); renderForm(); return }
  const xf = t.closest('[data-file-del]'); if (xf) { read(); cur.files.splice(+xf.dataset.fileDel, 1); refreshFiles(); return }
  const xp = t.closest('[data-pend-del]'); if (xp) { pend.splice(+xp.dataset.pendDel, 1); refreshFiles(); return }
  if (t.closest('[data-tv-sign]')) { await drawSign(); return }
  const one = t.closest('[data-tv-one]'); if (one) { const it = items.find(x => x.id === one.dataset.tvOne); if (it) downloadHwp([it], it.name + ' 국내여비 정산 신청서(' + md(it.start).replace(/[()]/g, '') + ').hwpx'); return }
  if (t.closest('[data-tv-hwp]')) { const L = selected(); if (!L.length) { C.toast('받을 정산서를 골라 주세요'); return } downloadHwp(L, month.slice(0, 4) + '. ' + Number(month.slice(5)) + '월 국내여비 정산 신청서(' + L.length + '건).hwpx'); return }
  if (t.closest('[data-tv-xlsx]')) { newXlsx(); return }
  if (t.closest('[data-tv-append]')) { document.getElementById('tv-xin').click(); return }
  if (t.closest('[data-tv-print]')) { printNow(); return }
  if (t.closest('[data-tv-fuel]')) { fuelPanel(); return }
}

/* ---------- 유가 자료 (담당자) ---------- */
async function fuelPanel() {
  const y = month.slice(0, 4), days = await fuelYear(y), keys = Object.keys(days).sort(), ev = (await evPrices()).slice().sort((a, b) => b.from.localeCompare(a.from));
  const w = document.createElement('div'); w.className = 'tv-pad-wrap';
  w.innerHTML = '<div class="tv-pad tv-fuelp"><h3>유가 자료</h3>' +
    '<p class="meta">' + y + '년 경남 평균판매가격: ' + (keys.length ? keys.length + '일치 (' + md(keys[0]) + ' ~ ' + md(keys[keys.length - 1]) + ')' : '아직 없어요') + '</p>' +
    '<p class="meta">오피넷 유가정보 API를 연결해 두면 매일 밤 자동으로 들어와요 (GitHub fuel-daily). 연결 전이나 빠진 날은 아래처럼 파일로 올려요.</p>' +
    '<ol class="tv-steps"><li><a href="' + OPINET + '" target="_blank" rel="noopener">오피넷 평균판매가격</a> → <b>지역별</b> 탭 → 구분 <b>일간</b>, 지역 <b>경남</b>, 제품 <b>보통휘발유 · 자동차용경유 · LPG</b> → 기간 고르고 조회 → <b>엑셀저장</b>(또는 CSV저장)</li><li>받은 파일을 아래 버튼으로 올려요. 과 엑셀의 <b>주유소</b> 시트가 있는 파일을 올려도 돼요.</li></ol>' +
    '<button type="button" class="btn primary" data-up>오피넷 파일 올리기</button>' +
    '<h3 style="margin-top:14px">전기 충전 단가 (원/kWh)</h3><p class="meta"><a href="' + EVURL + '" target="_blank" rel="noopener">무공해차 통합누리집 충전요금</a>의 기후에너지환경부 급속 <b>100~199kW</b> 요금. 바뀌면 바뀐 날짜와 함께 넣어 주세요.</p>' +
    '<ul class="tv-evl">' + ev.map(x => '<li>' + esc(x.from) + '부터 <b>' + x.p + '원</b></li>').join('') + '</ul>' +
    '<div class="row3"><label class="fl">적용 시작일<input type="date" data-evd value="' + ymd(new Date()) + '"></label><label class="fl">단가<input data-evp inputmode="decimal" placeholder="예: 347.2"></label><button type="button" class="btn" data-evadd style="align-self:end">추가</button></div>' +
    '<div class="acts"><button type="button" class="btn" data-c>닫기</button></div></div>';
  document.body.appendChild(w);
  w.querySelector('[data-c]').onclick = () => w.remove();
  w.querySelector('[data-up]').onclick = () => { w.remove(); document.getElementById('tv-oin').click() };
  w.querySelector('[data-evadd]').onclick = async () => {
    const d = w.querySelector('[data-evd]').value, p = num(w.querySelector('[data-evp]').value); if (!d || !p) return;
    const L = (await evPrices()).filter(x => x.from !== d).concat([{ from: d, p }]);
    try { await setDoc(doc(C.fs, 'settings', 'fuel-ev'), { list: L, updated: Date.now(), byName: C.me.name }); evList = L; C.toast('전기 단가를 저장했어요'); w.remove(); fuelPanel() } catch (e) { C.toast('저장하지 못했어요') }
  };
}
const toKey = v => {
  if (v instanceof Date) return v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate());
  const s = String(v || ''); let m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) }
  return '';
};
// CSV 읽기 ("1,952.81" 처럼 따옴표 안의 쉼표도 처리)
function csvRows(txt) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true; else if (ch === ',' || ch === '\t') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows;
}
async function readTable(file) {
  if (/\.xls$/i.test(file.name)) {   // 오피넷 '엑셀저장'은 표(HTML)로 된 .xls 파일인 경우가 많음
    const buf = await file.arrayBuffer(); let txt = new TextDecoder('utf-8').decode(buf); if (txt.includes('\ufffd')) txt = new TextDecoder('euc-kr').decode(buf);
    if (/<table/i.test(txt)) { const d = new DOMParser().parseFromString(txt, 'text/html'); return [...d.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) }
    throw new Error('이 .xls 파일은 읽을 수 없어요. 오피넷에서 CSV저장으로 받아 올려 주세요');
  }
  if (/\.csv$/i.test(file.name)) {
    const buf = await file.arrayBuffer(); let txt = new TextDecoder('utf-8').decode(buf); if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf);
    return csvRows(txt);
  }
  if (!window.ExcelJS) await loadScript('lib/exceljs.min.js');
  const wb = new window.ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet('주유소') || wb.worksheets.find(s => { let ok = false; s.eachRow((r, i) => { if (i < 30 && r.values.some(v => String(v).includes('보통휘발유'))) ok = true }); return ok }) || wb.worksheets[0];
  const rows = []; ws.eachRow({ includeEmpty: false }, r => rows.push(r.values.slice(1).map(v => v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? v.text ?? '') : v)));
  return rows;
}
async function importOpinet(file) {
  try {
    C.toast('유가 자료를 읽고 있어요');
    const rows = await readTable(file);
    // 머리줄: 칸 하나가 통째로 '보통휘발유'(또는 '휘발유')이고, 칸이 3개 이상인 줄 (위쪽 설명 줄은 건너뜀)
    const hi = rows.findIndex(r => r.filter(v => String(v ?? '').trim()).length >= 3 && r.some(v => /^(보통)?휘발유$/.test(String(v ?? '').replace(/\s/g, ''))));
    if (hi < 0) throw new Error('보통휘발유 칸을 찾지 못했어요');
    const H = rows[hi].map(v => String(v || '').replace(/\s/g, ''));
    const col = re => H.findIndex(h => re.test(h));
    const cd = col(/^(기간|일자|날짜|구분|일시)$/), cg = col(/^보통휘발유$/) >= 0 ? col(/^보통휘발유$/) : col(/^휘발유$/), cs = col(/^(자동차용)?경유$/), cl = col(/LPG|부탄/);
    const byYear = {}; let n = 0;
    for (const r of rows.slice(hi + 1)) {
      const k = toKey(r[cd >= 0 ? cd : 0]); if (!k) continue;
      const ok = x => x > 300 && x < 5000 ? x : 0;   // 원/ℓ 범위를 벗어난 값은 버림
      const g = ok(num(r[cg])), d = cs >= 0 ? ok(num(r[cs])) : 0, l = cl >= 0 ? ok(num(r[cl])) : 0; if (!g && !d && !l) continue;
      (byYear[k.slice(0, 4)] = byYear[k.slice(0, 4)] || {})[k] = { ...(g ? { g } : {}), ...(d ? { d } : {}), ...(l ? { l } : {}) }; n++;
    }
    if (!n) throw new Error('날짜별 가격을 찾지 못했어요');
    for (const [y, days] of Object.entries(byYear)) { const old = await fuelYear(y); const merged = { ...old, ...days }; await setDoc(doc(C.fs, 'settings', 'fuel-' + y), { days: merged, updated: Date.now(), byName: C.me.name }); fuelCache[y] = merged }
    const ks = Object.values(byYear).flatMap(o => Object.keys(o)).sort();
    C.toast('유가 ' + n + '일치를 저장했어요 (' + md(ks[0]) + ' ~ ' + md(ks[ks.length - 1]) + ')');
    if (cur && cur.fuel.on && !cur.fuel.priceManual) refreshPrice();
  } catch (e) { console.error(e); C.toast('유가 자료를 읽지 못했어요: ' + (e.message || '')) }
}
// 연료비가 비어 있으면(유가 등록 전 제출) 지금 유가로 다시 계산
async function withFuel(L) {
  const out = [];
  for (const t of L) {
    const x = JSON.parse(JSON.stringify(t));
    if (x.fuel && x.fuel.on && !x.fuel.manual && !num(x.fuel.price)) { const r = await priceFor(x.fuel.type, x.start); if (r) { x.fuel.price = r.p; x.fuel.src = r.src } }
    out.push(x);
  }
  return out;
}

/* ---------- 엑셀 (과 '출장여비 정산신청내역' 모양) ---------- */
const COLS = ['순', '출장일', '출장시간', '출장자', '출발', '출장지\n(학교명)', '도착', '이동\n거리', '유종', '일비', '식비', '운임', '통행료', '숙박비', '대중\n교통비', '공제', '계', '감사\n여부', '관내\n관외', '비고'];
const WIDTH = [3.6, 17.1, 15.3, 11.5, 6.9, 51.9, 11.9, 8.4, 12.6, 10.4, 10.8, 10.8, 12.6, 12.9, 10.5, 5.9, 12.5, 6.9, 6.1, 52.9];
function rowOf(t, i) {
  const c = calc(t), multi = t.end && t.end > t.start;
  const notes = [t.govCar ? '관용차량' : '', num(t.mealsGiven) ? num(t.mealsGiven) + '식 제공' : '', t.note || ''].filter(Boolean).join(', ');
  const [yy, mm, dd] = t.start.split('-').map(Number);
  return [i, multi ? t.start + '~' + (t.end.slice(0, 7) === t.start.slice(0, 7) ? t.end.slice(8) : t.end.slice(5)) : new Date(Date.UTC(yy, mm - 1, dd)), t.time || '', t.name, t.from || '', t.place || '', t.city || '',
    t.fuel && t.fuel.on ? num(t.fuel.km) || null : null, t.fuel && t.fuel.on ? (FUEL[t.fuel.type] || {}).n : null, c.dayAmt, c.mealAmt, c.fuel || null, c.toll || null, c.lodging || null, c.fareSum || null, c.cut || null, null, null, t.scope || '관외', notes || null];
}
function fillRow(ws, r, vals, style) {
  vals.forEach((v, k) => { const cell = ws.getCell(r, k + 1); if (style && style[k]) cell.style = JSON.parse(JSON.stringify(style[k])); if (v !== null && v !== undefined) cell.value = v; else cell.value = null });
  ws.getCell(r, 17).value = { formula: 'SUM(J' + r + ':O' + r + ')-P' + r };
  const b = ws.getCell(r, 2); if (b.value instanceof Date) b.numFmt = 'yyyy-mm-dd';
}
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000) }
const periodText = () => { const [y, m] = month.split('-').map(Number); return '기간 : ' + y + '. ' + m + '. 1. ~ ' + y + '. ' + m + '. ' + new Date(y, m, 0).getDate() + '.' };
async function newXlsx() {
  const L = await withFuel(selected()); if (!L.length) { C.toast('받을 정산서가 없어요'); return }
  if (!window.ExcelJS) await loadScript('lib/exceljs.min.js');
  const wb = new window.ExcelJS.Workbook(), ws = wb.addWorksheet('여비정산');
  WIDTH.forEach((w, i) => ws.getColumn(i + 1).width = w);
  ws.getCell('B1').value = '중등교육과 출장여비 정산신청내역'; ws.getCell('B1').font = { bold: true, size: 16 };
  ws.getCell('B3').value = periodText(); ws.getCell('K3').value = 8340; ws.getCell('L3').value = 16670;
  const thin = { style: 'thin' }, border = { top: thin, left: thin, bottom: thin, right: thin };
  COLS.forEach((h, i) => { const c = ws.getCell(4, i + 1); c.value = h; c.font = { bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } }; c.border = border });
  ws.getRow(4).height = 32;
  L.forEach((t, i) => { const r = 5 + i; fillRow(ws, r, rowOf(t, i + 1)); for (let k = 1; k <= 20; k++) { const c = ws.getCell(r, k); c.border = border; if (k >= 10 && k <= 17) c.numFmt = '#,##0;-#,##0;"-"'; c.alignment = { vertical: 'middle', horizontal: k === 6 || k === 20 ? 'left' : 'center', wrapText: k === 6 || k === 20 } } });
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), month.slice(0, 4) + '. ' + Number(month.slice(5)) + '월 출장여비 정산신청내역(단단이 ' + L.length + '건).xlsx');
  C.toast('엑셀을 받았어요');
}
async function appendXlsx(file) {
  const L = await withFuel(selected()); if (!L.length) { C.toast('붙일 정산서가 없어요'); return }
  try {
    C.toast('엑셀에 이어 붙이고 있어요');
    if (!window.ExcelJS) await loadScript('lib/exceljs.min.js');
    const wb = new window.ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet('여비정산') || wb.worksheets[0];
    // 마지막 번호 줄 바로 아래에 끼워 넣고, 아래 '계' 줄의 합계 범위를 늘림
    let last = 4, lastNo = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => { const a = row.getCell(1).value; if (r > 4 && typeof a === 'number') { last = r; lastNo = a } });
    const style = []; for (let k = 1; k <= 20; k++) style.push(JSON.parse(JSON.stringify(ws.getCell(last, k).style || {})));
    const vals = L.map((t, i) => rowOf(t, lastNo + 1 + i));
    // 아래쪽 병합 칸('계' 줄 등)은 잠시 풀었다가 밀린 자리에 다시 병합
    const colN = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    const below = []; (ws.model.merges || []).slice().forEach(rg => { const m = String(rg).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/); if (m && +m[2] > last) { below.push(m); try { ws.unMergeCells(rg) } catch (e) { } } });
    ws.insertRows(last + 1, vals.map(v => v.map(x => x === null ? undefined : x)), 'i');
    below.forEach(m => { const r1 = +m[2] + vals.length, r2 = +m[4] + vals.length, c1 = colN(m[1]), c2 = colN(m[3]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) ws.getCell(r, c).value = null;
      try { ws.mergeCells(r1, c1, r2, c2) } catch (e) { } });
    vals.forEach((v, i) => fillRow(ws, last + 1 + i, v, style));
    for (let r = last + 1 + vals.length; r < last + 12 + vals.length; r++) { if (String(ws.getCell(r, 1).value || '').replace(/\s/g, '') === '계') { ws.getCell(r, 17).value = { formula: 'SUM(Q5:Q' + (last + vals.length) + ')' }; break } }
    saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.name.replace(/\.xlsx$/i, '') + '(단단이 추가 ' + L.length + '건).xlsx');
    C.toast(L.length + '건을 ' + (last + 1) + '번째 줄부터 끼워 넣었어요 (순 ' + (lastNo + 1) + '번부터)');
  } catch (e) { console.error(e); C.toast('엑셀을 열지 못했어요') }
}

/* ---------- 한글 파일 (국내여비 정산 신청서) ---------- */
const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const kids = (el, name) => [...el.children].filter(c => c.localName === name);
const all = (el, name) => [...el.getElementsByTagNameNS(HP, name)];
function makeP(src, text) {
  const p = src.cloneNode(true); all(p, 'linesegarray').forEach(x => x.remove());
  const runs = kids(p, 'run'); let r = runs[0];
  if (!r) { r = p.ownerDocument.createElementNS(HP, 'hp:run'); r.setAttribute('charPrIDRef', '0'); p.insertBefore(r, p.firstChild) }
  runs.slice(1).forEach(x => x.remove()); while (r.firstChild) r.removeChild(r.firstChild);
  if (text !== '') { const t = p.ownerDocument.createElementNS(HP, 'hp:t'); t.textContent = text; r.appendChild(t) }
  return p;
}
function cellMap(tbl) { const m = {}; for (const tr of kids(tbl, 'tr')) for (const tc of kids(tr, 'tc')) { const a = kids(tc, 'cellAddr')[0]; m[a.getAttribute('colAddr') + ',' + a.getAttribute('rowAddr')] = tc } return m }
const subOf = tc => kids(tc, 'subList')[0];
function setCell(tc, text) { if (!tc) return; const sub = subOf(tc), ps = kids(sub, 'p'); const p = makeP(ps[0], text); ps.forEach(x => x.remove()); sub.appendChild(p) }
const b64bytes = b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u };
const rid = () => String(1000000000 + Math.floor(Math.random() * 999999999));
const NSDECL = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';
let zo = 0;
function picXML(binId, W, H) {
  const id = rid(); zo++;
  return '<hp:pic id="' + id + '" zOrder="' + zo + '" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + rid() + '" reverse="0">' +
    '<hp:offset x="0" y="0"/><hp:orgSz width="' + W + '" height="' + H + '"/><hp:curSz width="' + W + '" height="' + H + '"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="' + Math.round(W / 2) + '" centerY="' + Math.round(H / 2) + '" rotateimage="1"/>' +
    '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
    '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + W + '" y="0"/><hc:pt2 x="' + W + '" y="' + H + '"/><hc:pt3 x="0" y="' + H + '"/></hp:imgRect><hp:imgClip left="0" right="' + W + '" top="0" bottom="' + H + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="' + W + '" dimheight="' + H + '"/>' +
    '<hc:img binaryItemIDRef="' + binId + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + H + '" heightRelTo="ABSOLUTE" protect="0"/>' +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>';
}
function frag(docx, xml) { const d = new DOMParser().parseFromString('<w ' + NSDECL + '>' + xml + '</w>', 'application/xml'); return docx.importNode(d.documentElement.firstElementChild, true) }
const fareRows = t => {
  const L = FUEL_ONLY ? [] : (t.fares || []).filter(f => f.date || f.mode || f.from || f.to).map(f => ({ ...f }));
  if (t.fuel && t.fuel.on && !L.some(f => f.mode === '자차')) {
    L.unshift({ date: t.start, mode: '자차', from: t.from || '', to: t.city || t.place || '', grade: '', amt: '' }, { date: t.end || t.start, mode: '자차', from: t.city || t.place || '', to: t.from || '', grade: '', amt: '' });
  }
  if (L.length > 4) { const rest = L.slice(3); L.splice(3, L.length - 3, { date: '', mode: '외 ' + rest.length + '건', from: '', to: '', grade: '', amt: rest.reduce((a, f) => a + (f.mode === '자차' ? 0 : num(f.amt)), 0) }) }
  return L;
};
const whenText = t => { const a = parse(t.start), b = parse(t.end || t.start); let s = a.getFullYear() + '년 ' + (a.getMonth() + 1) + '월 ' + a.getDate() + '일'; if (t.end && t.end > t.start) s += ' ~ ' + (b.getFullYear() !== a.getFullYear() ? b.getFullYear() + '년 ' : '') + (b.getMonth() !== a.getMonth() ? (b.getMonth() + 1) + '월 ' : '') + b.getDate() + '일'; return s + (t.time ? ' (' + t.time + ')' : '') };
async function buildHwpx(L) {
  if (!window.JSZip) await loadScript('jszip.min.js');
  const zip = await window.JSZip.loadAsync(await (await fetch('forms/travel-form.hwpx', { cache: 'no-cache' })).arrayBuffer());
  const docx = new DOMParser().parseFromString(await zip.file('Contents/section0.xml').async('string'), 'application/xml');
  const hpf = new DOMParser().parseFromString(await zip.file('Contents/content.hpf').async('string'), 'application/xml');
  const manifest = hpf.getElementsByTagNameNS('*', 'manifest')[0];
  const sec = docx.documentElement, P0 = kids(sec, 'p')[0], T0 = P0.cloneNode(true);
  let img = 100; zo = 50;
  const addBin = (bytes, ext) => { img++; const id = 'image' + img, path = 'BinData/' + id + '.' + ext; zip.file(path, bytes); const it = hpf.createElementNS(manifest.namespaceURI, (manifest.prefix ? manifest.prefix + ':' : '') + 'item'); it.setAttribute('id', id); it.setAttribute('href', path); it.setAttribute('media-type', ext === 'png' ? 'image/png' : 'image/jpg'); it.setAttribute('isEmbeded', '1'); manifest.appendChild(it); return id };
  const plainP = (text, brk) => { const p = docx.createElementNS(HP, 'hp:p'); p.setAttribute('id', '0'); p.setAttribute('paraPrIDRef', '0'); p.setAttribute('styleIDRef', '0'); p.setAttribute('pageBreak', brk ? '1' : '0'); p.setAttribute('columnBreak', '0'); p.setAttribute('merged', '0'); const r = docx.createElementNS(HP, 'hp:run'); r.setAttribute('charPrIDRef', '0'); if (text) { const t = docx.createElementNS(HP, 'hp:t'); t.textContent = text; r.appendChild(t) } p.appendChild(r); return p };
  const MAXW = 48000, MAXH = 64000;
  for (let i = 0; i < L.length; i++) {
    const t = L[i], c = calc(t);
    let P = P0;
    if (i > 0) { P = T0.cloneNode(true); all(P, 'secPr').forEach(x => x.remove()); all(P, 'ctrl').forEach(x => x.remove()); P.setAttribute('pageBreak', '1'); sec.appendChild(P) }
    all(P, 'linesegarray').forEach(x => x.remove());
    const tbl = all(P, 'tbl')[0]; tbl.setAttribute('id', rid()); const m = cellMap(tbl);
    setCell(m['1,1'], t.dept || ''); setCell(m['5,1'], t.rank || ''); setCell(m['9,1'], t.name || '');
    setCell(m['2,3'], whenText(t)); setCell(m['2,4'], t.place || ''); setCell(m['2,5'], t.purpose || '');
    setCell(m['2,7'], t.lodging && t.lodging.cap ? won(t.lodging.cap) + '원' : ''); setCell(m['6,7'], c.lodging ? won(c.lodging) + '원' : '-'); setCell(m['10,7'], (t.lodging && t.lodging.reason) || '');
    const given = num(t.mealsGiven);
    setCell(m['2,8'], '제공'); setCell(m['4,8'], given + '회'); setCell(m['6,8'], '미제공'); setCell(m['8,8'], c.mealLeft + '회'); setCell(m['10,8'], won(c.mealAmt) + '원');
    const fr = fareRows(t);
    for (let r = 0; r < 4; r++) { const f = fr[r] || {}; setCell(m['1,' + (11 + r)], f.date ? dot(f.date) : ''); setCell(m['2,' + (11 + r)], f.mode || ''); setCell(m['4,' + (11 + r)], f.from || ''); setCell(m['6,' + (11 + r)], f.to || ''); setCell(m['8,' + (11 + r)], f.grade || ''); setCell(m['10,' + (11 + r)], f.mode && f.mode !== '자차' && num(f.amt) ? won(f.amt) + '원' : '') }
    if (t.fuel && t.fuel.on) {
      const F = FUEL[t.fuel.type] || {};
      setCell(m['1,15'], F.n || ''); setCell(m['2,15'], num(t.fuel.km) + 'km'); setCell(m['4,15'], num(t.fuel.price) ? num(t.fuel.price).toLocaleString('ko-KR') + '원/' + F.unit : '유가 확인 필요');
      setCell(m['6,15'], 'km/' + F.unit + ' ' + (num(t.fuel.eff) || F.eff)); setCell(m['8,15'], c.toll ? '통행료 ' + won(c.toll) + '원' : ''); setCell(m['10,15'], won(c.fuel + c.toll) + '원');
    } else { ['1', '2', '4', '6', '8'].forEach(k => setCell(m[k + ',15'], '')); setCell(m['10,15'], c.toll ? won(c.toll) + '원' : '') }
    // 아래 글: 첨부 · 날짜 · 서명
    const nPages = (t.files || []).reduce((a, f) => a + (f.pages || []).length, 0);
    for (const tt of all(m['0,16'], 't')) {
      if (/첨\s*부\s*:/.test(tt.textContent)) tt.textContent = ' 첨 부 : ' + (nPages ? '증빙서류 ' + nPages + '매.' : '없음');
      const dm = tt.textContent.match(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/); if (dm) { const d = parse(t.applyDate || ymd(new Date())); tt.textContent = tt.textContent.replace(dm[0], d.getFullYear() + ' 년  ' + (d.getMonth() + 1) + ' 월  ' + d.getDate() + ' 일') }
      if (/성\s*명/.test(tt.textContent) && /신\s*청\s*인/.test(tt.textContent)) tt.textContent = tt.textContent.replace(/(성\s*명)\s*\S*\s*$/, '$1  ' + (t.name || '') + '    ');
    }
    if (t.sign) {
      const run = all(m['0,16'], 'run').find(r => /서명\s*또는\s*인/.test(r.textContent));
      if (run) {
        const im = await new Promise(res => { const x = new Image(); x.onload = () => res(x); x.onerror = () => res(null); x.src = t.sign });
        if (im) { const H = 2600, W = Math.min(9000, Math.round(H * im.naturalWidth / im.naturalHeight)), id = addBin(b64bytes(t.sign.split(',')[1]), 'png');
          const r2 = docx.createElementNS(HP, 'hp:run'); r2.setAttribute('charPrIDRef', run.getAttribute('charPrIDRef')); r2.appendChild(frag(docx, picXML(id, W, Math.round(W * im.naturalHeight / im.naturalWidth)))); run.parentNode.insertBefore(r2, run) }
      }
    }
    // 증빙: 신청서 다음 장부터 한 장씩
    for (const f of t.files || []) for (let p = 0; p < (f.pages || []).length; p++) {
      const pg = f.pages[p], b64 = await pageData(f, p); if (!b64) continue;
      const id = addBin(b64bytes(b64), 'jpg'); let W = MAXW, H = Math.round(MAXW * pg.h / pg.w); if (H > MAXH) { H = MAXH; W = Math.round(MAXH * pg.w / pg.h) }
      sec.appendChild(plainP('[증빙] ' + t.name + ' · ' + f.name + (f.pages.length > 1 ? ' (' + (p + 1) + '/' + f.pages.length + ')' : ''), true));
      const pp = plainP('', false); kids(pp, 'run')[0].appendChild(frag(docx, picXML(id, W, H))); sec.appendChild(pp);
    }
  }
  let out = new XMLSerializer().serializeToString(docx); if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + out;
  let hx = new XMLSerializer().serializeToString(hpf); if (!hx.startsWith('<?xml')) hx = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + hx;
  zip.file('Contents/section0.xml', out); zip.file('Contents/content.hpf', hx); zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}
async function downloadHwp(L, name) {
  try { C.toast('한글 파일을 만들고 있어요 (증빙이 많으면 조금 걸려요)'); saveBlob(await buildHwpx(await withFuel(L)), name); C.toast('받았어요 · 다운로드 폴더를 확인해 주세요') }
  catch (e) { console.error(e); C.toast('한글 파일을 만들지 못했어요') }
}
export const _travel = { buildHwpx, calc, rowOf, priceFor };

/* ---------- 인쇄 · PDF (신청서 + 증빙) ---------- */
async function printNow() {
  const L = await withFuel(selected()); if (!L.length) { C.toast('인쇄할 정산서가 없어요'); return }
  C.toast('인쇄 화면을 준비하고 있어요');
  const E = s => esc(s); let body = '';
  for (const t of L) {
    const c = calc(t), fr = fareRows(t), F = (t.fuel && FUEL[t.fuel.type]) || {};
    body += '<section class="pg"><h1>국내여비 정산 신청서(관외 출장)</h1><table><colgroup><col style="width:12%"><col style="width:16%"><col span="9"></colgroup>' +
      '<tr><th>소 속</th><td colspan="2">' + E(t.dept) + '</td><th colspan="2">직 급(직위)</th><td colspan="2">' + E(t.rank) + '</td><th colspan="2">성 명</th><td colspan="2">' + E(t.name) + '</td></tr>' +
      '<tr><th rowspan="3">출장(부임)일정</th><th>일 시</th><td colspan="9">' + E(whenText(t)) + '</td></tr><tr><th>출장(부임)지</th><td colspan="9">' + E(t.place) + '</td></tr><tr><th>출장 목적</th><td colspan="9">' + E(t.purpose) + '</td></tr>' +
      '<tr><th>숙 박 비</th><th>상한액 또는 지급받은 선금</th><td colspan="2">' + (t.lodging && t.lodging.cap ? won(t.lodging.cap) + '원' : '') + '</td><th colspan="2">실제 소요액</th><td colspan="2">' + (c.lodging ? won(c.lodging) + '원' : '-') + '</td><th colspan="2">초과지출 사유</th><td>' + E(t.lodging && t.lodging.reason) + '</td></tr>' +
      '<tr><th>식비</th><th>식사제공여부(1일 3회 기준)</th><td colspan="2">제공</td><td colspan="2">' + num(t.mealsGiven) + '회</td><td colspan="2">미제공</td><td colspan="2">' + c.mealLeft + '회</td><td>' + won(c.mealAmt) + '원</td></tr>' +
      '<tr><th rowspan="5">운임</th><th>일 자</th><th colspan="2">교통편</th><th colspan="2">출발지</th><th colspan="2">도착지</th><th colspan="2">등 급</th><th>금 액</th></tr>' +
      [0, 1, 2, 3].map(r => { const f = fr[r] || {}; return '<tr><td>' + (f.date ? dot(f.date) : '') + '</td><td colspan="2">' + E(f.mode) + '</td><td colspan="2">' + E(f.from) + '</td><td colspan="2">' + E(f.to) + '</td><td colspan="2">' + E(f.grade) + '</td><td>' + (f.mode && f.mode !== '자차' && num(f.amt) ? won(f.amt) + '원' : '') + '</td></tr>' }).join('') +
      '<tr><th>연료비신청</th><td>' + (t.fuel && t.fuel.on ? E(F.n) : '') + '</td><td colspan="2">' + (t.fuel && t.fuel.on ? num(t.fuel.km) + 'km' : '') + '</td><td colspan="2">' + (t.fuel && t.fuel.on && num(t.fuel.price) ? num(t.fuel.price).toLocaleString('ko-KR') + '원/' + F.unit : '') + '</td><td colspan="2">' + (t.fuel && t.fuel.on ? 'km/' + F.unit + ' ' + (num(t.fuel.eff) || F.eff) : '') + '</td><td colspan="2">' + (c.toll ? '통행료 ' + won(c.toll) + '원' : '') + '</td><td>' + (c.fuel + c.toll ? won(c.fuel + c.toll) + '원' : '') + '</td></tr>' +
      '<tr><td colspan="11" class="foot">｢공무원 여비 규정｣ 제16조 제1항·제2항에 의하여 관계서류를 첨부하여 위와 같이 국내여비의 정산을 신청합니다.<br><br>첨 부 : ' + ((t.files || []).length ? '증빙서류 ' + (t.files || []).reduce((a, f) => a + (f.pages || []).length, 0) + '매.' : '없음') +
      '<p class="date">' + (() => { const d = parse(t.applyDate || ymd(new Date())); return d.getFullYear() + ' 년  ' + (d.getMonth() + 1) + ' 월  ' + d.getDate() + ' 일' })() + '</p><p class="sig">신 청 인 &nbsp; 성 명 &nbsp;' + E(t.name) + ' ' + (t.sign ? '<img src="' + t.sign + '" alt="">' : '') + ' (서명 또는 인)</p></td></tr></table>' +
      '<p class="sum">참고 · 일비 ' + won(c.dayAmt) + ' · 식비 ' + won(c.mealAmt) + ' · 숙박비 ' + won(c.lodging) + ' · 운임 ' + won(c.fareSum) + ' · 연료비 ' + won(c.fuel) + ' · 통행료 ' + won(c.toll) + (c.cut ? ' · 공제 -' + won(c.cut) : '') + ' = <b>' + won(c.total) + '원</b></p></section>';
    for (const f of t.files || []) for (let p = 0; p < (f.pages || []).length; p++) { const b = await pageData(f, p); if (b) body += '<section class="pg att"><p class="cap">[증빙] ' + E(t.name) + ' · ' + E(f.name) + '</p><img src="data:image/jpeg;base64,' + b + '" alt=""></section>' }
  }
  const css = '@page{size:A4 portrait;margin:14mm}body{font-family:"Malgun Gothic","맑은 고딕",serif;margin:0;color:#000}.pg{page-break-after:always}.pg:last-child{page-break-after:auto}h1{text-align:center;font-size:22px;margin:0 0 14px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #333;padding:6px 5px;font-size:12px;text-align:center;word-break:keep-all;overflow-wrap:anywhere}th{background:#f3f4f6;font-weight:600}.foot{text-align:left;padding:14px 16px;line-height:1.7;font-size:13px}.date{text-align:right;margin:22px 10px 8px}.sig{text-align:right;margin:8px 10px}.sig img{height:42px;vertical-align:middle;margin:0 4px}.sum{font-size:11px;color:#444;margin-top:8px}.att{text-align:center}.att .cap{text-align:left;font-size:12px;margin:0 0 6px}.att img{max-width:100%;max-height:250mm}';
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write('<!doctype html><html><head><meta charset="utf-8"><title>국내여비 정산 신청서</title><style>' + css + '</style></head><body>' + body + '</body></html>'); fr.contentDocument.close();
  setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print() } catch (e) { C.toast('인쇄하지 못했어요') } setTimeout(() => fr.remove(), 60000) }, 600);
}
