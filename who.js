// 이름만으로 들어가기 (대시보드 · 위젯 · 첫 화면 공용)
// - Firebase "익명 로그인"으로 접속하고, 이름으로 사람을 찾아요.
// - 같은 이름의 기존 사용자가 있으면 그 일정으로 이어지고, 없으면 새로 만들어요.
// - 이름은 이 PC(브라우저)에 기억돼요.
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const KEY = 'who-v1';
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20);
export function savedWho() { try { const w = JSON.parse(localStorage.getItem(KEY) || 'null'); return w && w.id && w.name ? w : null } catch (e) { return null } }
export function forgetWho() { try { localStorage.removeItem(KEY) } catch (e) { } }
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
// 이름으로 들어가기. create:false 이고 처음 보는 이름이면 {isNew:true} 를 돌려줌
export async function enterByName(fs, raw, { create = false } = {}) {
  const name = cleanName(raw);
  if (name.length < 2) throw new Error('이름을 두 글자 이상 입력해 주세요.');
  const found = await getDocs(query(collection(fs, 'users'), where('name', '==', name)));
  let id = found.empty ? null : found.docs[0].id;
  if (!id) { if (!create) return { isNew: true, name }; id = await idFor(name) }
  await setDoc(doc(fs, 'users', id), { name, lastSeen: Date.now() }, { merge: true });
  const w = { id, name }; remember(w); return w;
}
// 오류 문구
export function whoError(e) {
  const c = (e && e.code) || '';
  if (/admin-restricted|operation-not-allowed/.test(c)) return 'Firebase에서 "익명" 로그인을 켜 주세요. (Authentication → 로그인 방법 → 익명)';
  if (/network/.test(c)) return '네트워크에 연결할 수 없어요. 기관 보안망에서 Firebase가 막혀 있을 수 있어요.';
  if (/permission/.test(c)) return 'Firestore 규칙을 새로 게시했는지 확인해 주세요.';
  return (e && e.message) || '들어가지 못했어요. 잠시 후 다시 시도해 주세요.';
}
