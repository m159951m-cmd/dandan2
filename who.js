// 이름만으로 들어가기 (대시보드 · 위젯 · 첫 화면 공용)
// - Firebase "익명 로그인"으로 접속하고, 이름으로 사람을 찾아요.
// - 같은 이름의 기존 사용자가 있으면 그 일정으로 이어지고, 없으면 새로 만들어요.
// - 이름은 이 PC(브라우저)에 기억돼요.
// - 처음에 숫자 4자리 PIN을 정하고, 다른 PC(또는 '다른 이름으로' 후)에서 들어올 때 PIN을 물어요.
//   (화면 잠금 수준의 간단한 확인이에요. PIN은 그대로 저장하지 않고 암호화한 값만 저장해요)
//   PIN을 잊으면: Firebase 콘솔 → Firestore → users → (그 사람) → meta → pin 문서를 지우면 다시 정할 수 있어요.
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const KEY = 'who-v1';
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20);
export function savedWho() { try { const w = JSON.parse(localStorage.getItem(KEY) || 'null'); return w && w.id && w.name ? w : null } catch (e) { return null } }
export function forgetWho() { try { const w = savedWho(); if (w) untrust(w.id); localStorage.removeItem(KEY) } catch (e) { } }
function remember(w) { try { localStorage.setItem(KEY, JSON.stringify(w)) } catch (e) { } }

// 익명 로그인이 끝날 때까지 기다림
export function ready(auth) {
  return new Promise((res, rej) => {
    const un = onAuthStateChanged(auth, u => {
      if (u) { un(); res(u); return }
      signInAnonymously(auth).catch(e => { un(); rej(e) });
    });
  });
}
async function idFor(name) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.replace(/\s/g, '')));
  return 'n_' + [...new Uint8Array(buf)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
}
/* ---------- PIN (숫자 4자리) ---------- */
const TRUST = 'who-trust';
const trusted = () => { try { return JSON.parse(localStorage.getItem(TRUST) || '[]') } catch (e) { return [] } };
const trust = id => { try { const t = trusted(); if (!t.includes(id)) t.push(id); localStorage.setItem(TRUST, JSON.stringify(t)) } catch (e) { } };
const untrust = id => { try { localStorage.setItem(TRUST, JSON.stringify(trusted().filter(x => x !== id))) } catch (e) { } };
async function pinHash(id, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dandan-pin|' + id + '|' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const pinDoc = (fs, id) => doc(fs, 'users', id, 'meta', 'pin');
async function pinOf(fs, id) { const s = await getDoc(pinDoc(fs, id)); return s.exists() ? s.data().h || '' : '' }
// 화면 가운데 작은 창 (어느 페이지에서나 같은 모양)
function pinDialog({ title, desc, twice, cancel, check }) {
  return new Promise((resolve, reject) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,25,40,.5);display:flex;align-items:center;justify-content:center;padding:20px;font-family:"IBM Plex Sans KR","Malgun Gothic",system-ui,sans-serif';
    const inp = 'width:100%;box-sizing:border-box;font-size:28px;letter-spacing:.5em;text-align:center;padding:10px 8px 10px 20px;border:2px solid #cfd6de;border-radius:12px;outline:none;font-family:inherit';
    wrap.innerHTML = '<form style="background:#fff;border-radius:18px;max-width:360px;width:100%;padding:26px 24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px;color:#16202b">' +
      '<h2 style="margin:0;font-size:20px">' + title + '</h2><p style="margin:0;color:#56616e;font-size:14px;line-height:1.55">' + desc + '</p>' +
      '<input name="a" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="••••" aria-label="PIN 숫자 4자리" style="' + inp + '">' +
      (twice ? '<input name="b" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="한 번 더" aria-label="PIN 한 번 더" style="' + inp + ';font-size:20px;letter-spacing:.3em">' : '') +
      '<p data-m style="margin:0;min-height:18px;color:#c0262d;font-size:13.5px"></p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' + (cancel ? '<button type="button" data-c style="font:inherit;font-size:15px;padding:10px 18px;border-radius:999px;border:1px solid #d5dae0;background:#fff;cursor:pointer">취소</button>' : '') +
      '<button type="submit" style="font:inherit;font-size:15px;font-weight:700;padding:10px 22px;border-radius:999px;border:0;background:#1e88d6;color:#fff;cursor:pointer">확인</button></div>' +
      '<p style="margin:0;font-size:12px;color:#8a95a3">PIN을 잊었으면 단단이 담당자에게 초기화를 부탁하세요.</p></form>';
    document.body.appendChild(wrap);
    const f = wrap.querySelector('form'), a = f.a, b = f.b, m = wrap.querySelector('[data-m]');
    [a, b].filter(Boolean).forEach(x => x.addEventListener('input', () => { x.value = x.value.replace(/\D/g, '').slice(0, 4) }));
    setTimeout(() => a.focus(), 30);
    const done = v => { wrap.remove(); resolve(v) };
    if (cancel) wrap.querySelector('[data-c]').onclick = () => { wrap.remove(); reject(new Error('PIN을 입력하지 않았어요.')) };
    f.onsubmit = async e => {
      e.preventDefault();
      if (!/^\d{4}$/.test(a.value)) { m.textContent = '숫자 4자리를 넣어 주세요.'; a.focus(); return }
      if (twice && a.value !== b.value) { m.textContent = '두 번 넣은 PIN이 달라요.'; b.value = ''; b.focus(); return }
      const r = await check(a.value).catch(() => '확인하지 못했어요. 잠시 후 다시 해 주세요.');
      if (r === true) done(a.value); else { m.textContent = r; a.value = ''; if (b) b.value = ''; a.focus() }
    };
  });
}
async function setPin(fs, w, cancel) {
  await pinDialog({ title: 'PIN 정하기', desc: '<b>' + w.name + '</b> 님, 다른 사람이 내 이름으로 들어오지 못하게 숫자 4자리를 정해 주세요. 다른 PC에서 들어올 때 물어봐요.', twice: true, cancel,
    check: async pin => { await setDoc(pinDoc(fs, w.id), { h: await pinHash(w.id, pin), at: Date.now() }); return true } });
  trust(w.id);
}
async function askPin(fs, w, h) {
  let tries = 0, until = 0;
  await pinDialog({ title: 'PIN 입력', desc: '<b>' + w.name + '</b> 님의 숫자 4자리 PIN을 넣어 주세요.', cancel: true,
    check: async pin => {
      if (Date.now() < until) return Math.ceil((until - Date.now()) / 1000) + '초 뒤에 다시 해 주세요.';
      if (await pinHash(w.id, pin) === h) return true;
      if (++tries >= 5) { until = Date.now() + 30e3; tries = 0; return 'PIN이 5번 틀렸어요. 30초 뒤에 다시 해 주세요.' }
      return 'PIN이 맞지 않아요. (' + tries + '/5)';
    } });
  trust(w.id);
}
// 이 PC에 이미 들어와 있는 사람: PIN이 아직 없으면 정하게 함 (처음 한 번)
export async function ensurePin(fs, w) {
  try { if (!(await pinOf(fs, w.id))) await setPin(fs, w, false); else trust(w.id) } catch (e) { }
  return w;
}

// 이름으로 들어가기. create:false 이고 처음 보는 이름이면 {isNew:true} 를 돌려줌
export async function enterByName(fs, raw, { create = false } = {}) {
  const name = cleanName(raw);
  if (name.length < 2) throw new Error('이름을 두 글자 이상 입력해 주세요.');
  const found = await getDocs(query(collection(fs, 'users'), where('name', '==', name)));
  let id = found.empty ? null : found.docs[0].id;
  if (!id) { if (!create) return { isNew: true, name }; id = await idFor(name) }
  const w = { id, name };
  // 이 PC에서 처음 들어오는 이름이면 PIN 확인 (PIN이 없으면 새로 정함)
  if (!trusted().includes(id)) { const h = found.empty ? '' : await pinOf(fs, id); if (h) await askPin(fs, w, h); else await setPin(fs, w, true) }
  await setDoc(doc(fs, 'users', id), { name, lastSeen: Date.now() }, { merge: true });
  remember(w); return w;
}
// 오류 문구
export function whoError(e) {
  const c = (e && e.code) || '';
  if (/admin-restricted|operation-not-allowed/.test(c)) return 'Firebase에서 "익명" 로그인을 켜 주세요. (Authentication → 로그인 방법 → 익명)';
  if (/network/.test(c)) return '네트워크에 연결할 수 없어요. 기관 보안망에서 Firebase가 막혀 있을 수 있어요.';
  if (/permission/.test(c)) return 'Firestore 규칙을 새로 게시했는지 확인해 주세요.';
  return (e && e.message) || '들어가지 못했어요. 잠시 후 다시 시도해 주세요.';
}
