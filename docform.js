// 공문서 양식: 4가지 양식 중 하나를 고르면 .hwpx 를 만들어 바로 열어요
// - 업무일정표 프로그램(새 버전) 안에서는 '문서\업무일정표 공문서' 폴더에 저장하고 한글로 바로 열기
// - 웹 브라우저에서는 파일로 내려받기
// 양식 원본: forms/doc-templates.json · 만드는 엔진: forms/docgen.js (처음 누를 때 한 번만 불러와요)
let C = null, TPL = null, GEN = null;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const V = () => window.__V || '';

const LIST = [
  { id: 'report', name: '보고서 (표지형)', desc: '표지 + 번호 소제목', ico: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M9.5 11h5M10 17h4"/>' },
  { id: 'brief', name: '1쪽 보고', desc: '제목 띠 + □ 소제목 · 보고·요청용', ico: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 6.5h8v2.5H8z"/><path d="M8 13h1M10.5 13H16M8 16.5h1M10.5 16.5H15"/>' },
  { id: 'event', name: '행사 보고', desc: '행사명·부서 머리표 · 교육감 참석 행사', ico: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 8.5h14M14 3v5.5"/><path d="M8 12.5h8M8 16h6"/>' },
  { id: 'speech', name: '축사·인사말', desc: '로고 + 제목 + 문단 + 날짜·서명', ico: '<path d="M12 3v4M12 21v-4"/><path d="M9 7h6l-1 10h-4z"/><path d="M7 11a5 5 0 0 0 10 0"/>' },
];
const today = id => {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(), w = '일월화수목금토'[d.getDay()];
  if (id === 'report') return `${y}. ${m}.`;
  if (id === 'brief') return `${y}. ${m}. ${dd}.(${w})`;
  if (id === 'speech') return `${y}년 ${m}월 ${dd}일`;
  return `${y}. ${m}. ${dd}.`;
};
const ymd = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') };
const inApp = () => { try { return typeof window.top.appOpenDoc === 'function' } catch (e) { return false } };

export function initDocForm(ctx) { C = ctx }

async function load() {
  if (!TPL) {
    const [r, m] = await Promise.all([fetch('forms/doc-templates.json' + V()), import('./forms/docgen.js' + V())]);
    if (!r.ok) throw new Error('양식 파일 ' + r.status);
    TPL = await r.json(); GEN = m.default;
  }
}

export function openDocForm() {
  const dept = ls.get('df-dept') || '중등교육과';
  C.openSheet('<div class="df-root" id="df-root"><h2>공문서 양식 <small>고르면 한글 파일(.hwpx)이 바로 열려요</small></h2>' +
    '<div class="df-f"><label><span>제목 <em>비우면 한글에서 적어요</em></span><input type="text" id="df-title" maxlength="80" placeholder="예: 2026 교직단체 협의회 결과 보고" autocomplete="off"></label>' +
    '<label><span>부서</span><input type="text" id="df-dept" maxlength="60" value="' + esc(dept) + '" autocomplete="off"></label></div>' +
    '<div class="df-list">' + LIST.map(t => '<button type="button" class="df-it" data-df="' + t.id + '"><span class="df-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.ico + '</svg></span><span><b>' + t.name + '</b><small>' + t.desc + '</small></span><span class="ar">›</span></button>').join('') + '</div>' +
    '<div class="df-st" id="df-st" role="status">' + (inApp() ? '파일은 <b>문서 › 업무일정표 공문서</b> 폴더에 저장돼요.' : '웹에서는 파일로 내려받아요. 업무일정표 프로그램에서는 바로 열려요.') + '</div>' +
    '<div class="acts"><button type="button" class="btn" data-df-close>닫기</button></div></div>', '공문서 양식');
  const root = $('df-root');
  root.addEventListener('click', e => {
    if (e.target.closest('[data-df-close]')) { C.closeSheet(); return }
    const b = e.target.closest('[data-df]'); if (b) make(b.dataset.df, b);
  });
  load().catch(() => { });   // 미리 불러 두기
}

async function make(id, btn) {
  const st = $('df-st'), all = document.querySelectorAll('.df-it');
  all.forEach(x => x.disabled = true); btn.classList.add('busy'); st.textContent = '만드는 중…';
  try {
    await load();
    const tpl = TPL.find(t => t.id === id); if (!tpl) throw new Error('양식 없음');
    const title = $('df-title').value.trim(), dept = $('df-dept').value.trim();
    ls.set('df-dept', dept);
    const D = tpl.fieldDefaults || {};
    const inp = {
      제목: title || (tpl.id === 'event' ? '행사명을 입력하세요' : '제목을 입력하세요'),
      날짜: today(id),
      부서: id === 'speech' ? (D['부서'] || '') : dept,
      담당: '',
      sections: tpl.defaults.map(d => ({ title: id === 'speech' ? d + ' 내용을 입력하세요' : d, items: [] })),
    };
    const bytes = GEN.generate(tpl, inp);
    const name = ((title || tpl.name.replace(/[()\s·]/g, '')).replace(/[\\/:*?"<>|]/g, '').slice(0, 60)) + '_' + ymd() + '.hwpx';
    if (inApp()) {
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const r = String(await window.top.appOpenDoc(name, btoa(bin)) || '');
      if (r.startsWith('!')) throw new Error(r.slice(1));
      C.toast('한글로 여는 중이에요 · ' + name); C.closeSheet();
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      st.innerHTML = '✓ <b>' + esc(name) + '</b> 을(를) 내려받았어요. 다운로드 폴더에서 열어 보세요.';
    }
  } catch (e) {
    st.textContent = '만들지 못했어요: ' + (e && e.message || e);
  } finally { all.forEach(x => x.disabled = false); btn.classList.remove('busy') }
}
