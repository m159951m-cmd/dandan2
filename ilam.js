// 주요행사·업무 일람 (HWPX) 읽기
// - HWPX = zip 안에 Contents/section*.xml (표)
// - 표: 1행 제목 [YYYY. M. D. ~ ...], 2행 날짜(10/26(월) ...), 3행부터 담당(과장, 중등장학 ...) × 날짜 칸
// - 칸 안의 일정은 "○ 제목" 다음 줄에 "시간: / 기간: / 장소: / 내용: / 참석: / 담당: / 출장자:" 가 이어짐

/* ---------- zip ---------- */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(bytes).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(); const out = []; let n = 0;
  try { for (;;) { const { done, value } = await r.read(); if (done) break; out.push(value); n += value.length } }
  catch (e) { if (!n) throw e }
  const all = new Uint8Array(n); let o = 0; for (const c of out) { all.set(c, o); o += c.length } return all;
}
export async function unzip(buf, want) {
  const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break }
  if (e < 0) throw new Error('HWPX(압축) 파일이 아니에요');
  const cnt = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const files = {};
  const dec = new TextDecoder();
  for (let k = 0; k < cnt; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!want(name)) continue;
    const ds = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    const raw = b.subarray(ds, ds + csize);
    files[name] = method === 0 ? raw.slice() : await inflateRaw(raw);
  }
  return files;
}

/* ---------- 표 꺼내기 (브라우저 DOMParser) ---------- */
export async function readHwpx(file) {
  const files = await unzip(await file.arrayBuffer(), n => /^Contents\/section\d+\.xml$/i.test(n));
  const names = Object.keys(files).sort();
  if (!names.length) throw new Error('한글 문서 내용(section)을 찾지 못했어요');
  const tables = [];
  for (const n of names) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(files[n]), 'application/xml');
    for (const tb of doc.getElementsByTagNameNS('*', 'tbl')) {
      const cells = [];
      for (const tc of tb.getElementsByTagNameNS('*', 'tc')) {
        if (tc.parentNode.parentNode !== tb) continue; // 표 안의 표는 건너뜀
        const a = tc.getElementsByTagNameNS('*', 'cellAddr')[0];
        const lines = [...tc.getElementsByTagNameNS('*', 'p')].map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join(''));
        cells.push({ row: +a.getAttribute('rowAddr'), col: +a.getAttribute('colAddr'), lines });
      }
      tables.push(cells);
    }
  }
  return tables;
}

/* ---------- 일정 뽑기 (순수 함수) ---------- */
const pad = n => String(n).padStart(2, '0');
const firstTime = s => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : '' };
const KEYS = ['시간', '기간', '장소', '내용', '참석', '담당', '출장자', '대상', '일시'];
function kv(line) {
  const m = line.replace(/^\s*[*※-]?\s*/, '').match(/^([가-힣 ]{1,6}?)\s*[:：]\s*(.*)$/);
  if (!m) return null; const k = m[1].replace(/\s/g, '');
  return KEYS.includes(k) ? [k, m[2].trim()] : null;
}
const people = s => String(s || '').split(/[,，、·\/]|\s및\s|\s외\s/).map(x => x.replace(/\(.*?\)|[*]|\s|수석교사|교사|장학사|장학관|주무관|회장|외.*$|\d+명/g, '').trim()).filter(x => /^[가-힣]{2,4}$/.test(x));

// 날짜 문자열에서 날짜들 뽑기: "10. 26.(월) 13:30~10. 27.(화)" / "10/26(월)"
function datesIn(s, year, baseMonth) {
  const out = [];
  for (const m of String(s || '').matchAll(/(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*\.?\s*(?:\(|$|~|\s)/g)) {
    const mo = +m[1], d = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = baseMonth && mo < baseMonth - 6 ? year + 1 : year;
    out.push(y + '-' + pad(mo) + '-' + pad(d));
  }
  return out;
}

export function parseIlam(cells) {
  const at = (r, c) => cells.find(x => x.row === r && x.col === c);
  const title = cells.filter(x => x.row === 0).map(x => x.lines.join(' ')).join(' ');
  const ym = title.match(/(20\d\d)\s*\.\s*(\d{1,2})\s*\./); const year = ym ? +ym[1] : new Date().getFullYear(), baseMonth = ym ? +ym[2] : 0;
  // 날짜 줄 찾기: 칸 대부분이 "10/26(월)" 꼴인 행
  const rows = [...new Set(cells.map(c => c.row))].sort((a, b) => a - b);
  const headRow = rows.find(r => cells.filter(c => c.row === r && c.col > 0 && datesIn(c.lines.join(' '), year, baseMonth).length).length >= 3);
  if (headRow === undefined) throw new Error('날짜 줄(10/26(월) …)을 찾지 못했어요. 업무 일람 표가 맞는지 확인해 주세요.');
  const colDate = {}; cells.filter(c => c.row === headRow && c.col > 0).forEach(c => { const d = datesIn(c.lines.join(' '), year, baseMonth); if (d.length) colDate[c.col] = d[0] });
  const items = [];
  for (const r of rows.filter(r => r > headRow)) {
    const lab = at(r, 0); const group = lab ? lab.lines.join(' ').replace(/\s+/g, ' ').trim() : '';
    for (const c of cells.filter(x => x.row === r && x.col > 0 && colDate[x.col])) {
      // ○ 단위로 나누기
      const blocks = []; let cur = null;
      for (const raw of c.lines) {
        const line = raw.replace(/ /g, ' ').trimEnd(); if (!line.trim()) continue;
        const m = line.match(/^\s*[○◦●•◎□■▶]\s*(.*)$/);
        if (m) { cur = { head: m[1].trim(), lines: [] }; blocks.push(cur) } else if (cur) cur.lines.push(line); else { cur = { head: line.trim(), lines: [] }; blocks.push(cur) }
      }
      for (const b of blocks) {
        // 출장처럼 "출장자:"가 여러 번 나오면 사람별로 나눔
        const subs = []; let s = { lines: [] };
        for (const l of b.lines) { const p = kv(l); if (p && p[0] === '출장자' && s.lines.some(x => kv(x))) { subs.push(s); s = { lines: [] } } s.lines.push(l) }
        subs.push(s);
        for (const sb of subs) {
          const f = {}; const extra = [];
          for (const l of sb.lines) { const p = kv(l); if (p) { if (!f[p[0]]) f[p[0]] = p[1] } else extra.push(l.trim()) }
          const isTrip = /^출장$/.test(b.head) || (!!f['출장자'] && /출장/.test(b.head));
          let titleTxt = b.head.replace(/\s+/g, ' ').trim();
          if (isTrip) titleTxt = '출장' + (f['내용'] ? ' · ' + f['내용'] : '');
          if (!titleTxt) continue;
          const period = f['기간'] || f['일시'] || '';
          const ds = datesIn(period, year, baseMonth);
          const date = ds[0] || colDate[c.col];
          let end = ds.length > 1 ? ds[ds.length - 1] : '';
          if (end && end <= date) end = '';
          const time = firstTime(f['시간'] || period);
          const who = [...new Set([...people(f['출장자']), ...people(f['담당']), ...extra.flatMap(x => (x.match(/[,，]\s*([가-힣]{2,4})\s*$/) || []).slice(1))])];
          const detail = [f['내용'] && !isTrip ? '내용: ' + f['내용'] : '', f['장소'] ? '장소: ' + f['장소'] : '', f['참석'] ? '참석: ' + f['참석'] : '', f['시간'] && !/^\d{1,2}:\d{2}~?$/.test(f['시간']) ? '시간: ' + f['시간'] : '', f['담당'] ? '담당: ' + f['담당'] : '', f['출장자'] ? '출장자: ' + f['출장자'] : '', ...extra].filter(Boolean).join('\n');
          items.push({ group, date, endDate: end, time, title: titleTxt, place: f['장소'] || '', people: who, detail });
        }
      }
    }
  }
  const ds = Object.values(colDate).sort();
  return { title: title.replace(/\s+/g, ' ').trim(), from: ds[0] || '', to: ds[ds.length - 1] || '', items };
}
