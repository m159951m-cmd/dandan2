// 공문서 양식 → .hwpx 만들기 (업무일정표 「공문서 양식」 버튼에서 사용)
// ── 공문서 생성 엔진 (브라우저·Node 공용) ──
const HwpxGen = (() => {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let idSeed = Date.now() % 900000000;
  const nextId = () => String(1000000000 + (idSeed = (idSeed * 7 + 12345) % 1000000000));
  const fill = (xml, vals) =>
    xml.replace(/\{\{([^{}]+)\}\}/g, (m, k) => (k === 'ID' ? nextId() : k in vals ? esc(vals[k]) : m));

  // CRC32
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  // 무압축(STORE) zip
  function zip(entries) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const [name, data] of entries) {
      const nb = enc.encode(name), crc = crc32(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...common]);
      parts.push(local, nb, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += local.length + nb.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(entries.length), ...u16(entries.length), ...u32(csize), ...u32(off), 0, 0]);
    const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
  }
  const b64 = s => { if (typeof atob === 'function') { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); };

  // inp = { 제목, 날짜, 부서, 담당, sections:[{title, items:[..]}] }
  function generate(tpl, inp) {
    const vals = { ...inp };
    if (tpl.id === 'speech') {
      const sig = String(inp['부서'] || '').trim();
      const m = sig.match(/^(.*?\S)\s{2,}(.+)$/) || sig.match(/^(.*\S)\s+(\S+(?:\s\S)*)$/);
      vals['서명1'] = m ? m[1] : sig; vals['서명2'] = m ? '  ' + m[2] : '';
    }
    let body = '';
    const P = tpl.protos;
    inp.sections.forEach((sec, i) => {
      if (P.heading) {
        if (i > 0 && P.spacer) body += fill(P.spacer, {});
        body += fill(P.heading, { 번호: i + 1, 소제목: sec.title });
        const items = sec.items && sec.items.length ? sec.items : ['내용을 입력하세요'];
        for (const it of items) body += fill(P.item, { 내용: it });
      } else {                       // 축사: 소제목 없이 문단 + 빈 줄
        if (i > 0 && P.spacer) body += fill(P.spacer, {});
        body += fill(P.item, { 내용: sec.title });
      }
    });
    const section = fill(tpl.prefix, vals) + body + fill(tpl.suffix, vals);
    const enc = new TextEncoder();
    const plain = section.replace(/<hp:t>([^<]*)<\/hp:t>/g, '$1\n').replace(/<[^>]+>/g, '').replace(/\n+/g, '\r\n').slice(0, 1000);
    const entries = tpl.order.map(name => {
      if (name === 'Contents/section0.xml') return [name, enc.encode(section)];
      if (name === 'Preview/PrvText.txt') return [name, enc.encode(plain)];
      let data = b64(tpl.files[name]);
      if (name === 'Contents/content.hpf') {
        const s = new TextDecoder().decode(data).replace(/<opf:title>[\s\S]*?<\/opf:title>/, '<opf:title>' + esc(inp['제목']) + '</opf:title>');
        data = enc.encode(s);
      }
      return [name, data];
    });
    return zip(entries);
  }
  return { generate };
})();
export default HwpxGen;
