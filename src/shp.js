// Shapefile(.shp .shx .dbf .prj .cpg)과 zip 을 브라우저/노드 어디서나 만든다. 서버·외부 라이브러리 없음.
(function (root) {
  const Shp = {};

  // ── CRC32 (zip 용) ──
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  Shp.crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  // ── CP949 인코더: TextDecoder('euc-kr')(실제로는 CP949 전체)을 거꾸로 돌려 글자→바이트 표를 만든다. 표에 없는 글자는 '?' ──
  Shp.cp949Encoder = TD => {
    const map = new Map(), dec = new TD('euc-kr', { fatal: true });
    for (let a = 0x81; a <= 0xFE; a++) for (let b = 0x41; b <= 0xFE; b++) {
      try { const s = dec.decode(Uint8Array.of(a, b)); if (s.length === 1 && s !== '�' && !map.has(s)) map.set(s, [a, b]); } catch (e) {}
    }
    return str => { const out = []; for (const ch of String(str)) { const c = ch.codePointAt(0); if (c < 128) out.push(c); else { const m = map.get(ch); if (m) out.push(m[0], m[1]); else out.push(63); } } return Uint8Array.from(out); };
  };

  // ── .shp / .shx : 면(Polygon). records[i].rings = 닫힌 고리들(바깥은 시계, 구멍은 반시계), 좌표 [경도, 위도] ──
  function shpShx(records) {
    const sizes = records.map(r => 44 + 4 * r.rings.length + 16 * r.rings.reduce((s, q) => s + q.length, 0));
    const shpLen = 100 + sizes.reduce((s, z) => s + 8 + z, 0), shxLen = 100 + 8 * records.length;
    const shp = new Uint8Array(shpLen), shx = new Uint8Array(shxLen), a = new DataView(shp.buffer), b = new DataView(shx.buffer);
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity, o = 100;
    records.forEach((r, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, np = 0;
      for (const q of r.rings) for (const p of q) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; np++; }
      X0 = Math.min(X0, x0); Y0 = Math.min(Y0, y0); X1 = Math.max(X1, x1); Y1 = Math.max(Y1, y1);
      b.setInt32(100 + 8 * i, o / 2); b.setInt32(104 + 8 * i, sizes[i] / 2);               // shx: 이 레코드의 위치·길이(워드)
      a.setInt32(o, i + 1); a.setInt32(o + 4, sizes[i] / 2);                                  // 레코드 머리(번호, 길이: 큰 바이트 순서)
      let p = o + 8; a.setInt32(p, 5, true);
      [x0, y0, x1, y1].forEach((v, k) => a.setFloat64(p + 4 + 8 * k, v, true));
      a.setInt32(p + 36, r.rings.length, true); a.setInt32(p + 40, np, true); p += 44;
      let idx = 0; for (const q of r.rings) { a.setInt32(p, idx, true); p += 4; idx += q.length; }
      for (const q of r.rings) for (const pt of q) { a.setFloat64(p, pt[0], true); a.setFloat64(p + 8, pt[1], true); p += 16; }
      o += 8 + sizes[i];
    });
    if (!records.length) { X0 = Y0 = X1 = Y1 = 0; }
    for (const [v, len] of [[a, shpLen], [b, shxLen]]) {
      v.setInt32(0, 9994); v.setInt32(24, len / 2); v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
      [X0, Y0, X1, Y1].forEach((x, k) => v.setFloat64(36 + 8 * k, x, true));
    }
    return { shp, shx };
  }

  // ── .dbf : 글자는 CP949(언어 코드 0x4E), 숫자는 오른쪽 맞춤, 값이 없으면 빈칸 ──
  function dbf(fields, rows, encode, now) {
    const nf = fields.length, hdr = 32 + 32 * nf + 1, rec = 1 + fields.reduce((s, f) => s + f.len, 0);
    const out = new Uint8Array(hdr + rec * rows.length + 1), dv = new DataView(out.buffer), d = now || new Date();
    out[0] = 3; out[1] = d.getFullYear() - 1900; out[2] = d.getMonth() + 1; out[3] = d.getDate();
    dv.setUint32(4, rows.length, true); dv.setUint16(8, hdr, true); dv.setUint16(10, rec, true); out[29] = 0x4E;
    fields.forEach((f, i) => { const o = 32 + 32 * i; out.set(encode(f.name).subarray(0, 10), o); out[o + 11] = f.type.charCodeAt(0); out[o + 16] = f.len; out[o + 17] = f.dec || 0; });
    out[32 + 32 * nf] = 0x0D;
    const fit = (str, len) => { const bytes = []; for (const ch of String(str)) { const e = encode(ch); if (bytes.length + e.length > len) break; bytes.push(...e); } while (bytes.length < len) bytes.push(32); return bytes; };   // 한글이 반으로 잘리지 않게
    rows.forEach((r, ri) => {
      let o = hdr + rec * ri; out[o++] = 0x20;
      fields.forEach((f, fi) => {
        const v = r[fi];
        const bytes = f.type === 'N' ? Array.from(encode((v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(f.dec || 0)).padStart(f.len, ' ').slice(-f.len))) : fit(v === null || v === undefined ? '' : v, f.len);
        out.set(bytes, o); o += f.len;
      });
    });
    out[out.length - 1] = 0x1A;
    return out;
  }

  const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  // build({records, fields:[{name,type:'C'|'N',len,dec}], rows, encode, now}) → {shp,shx,dbf,prj,cpg}
  Shp.build = ({ records, fields, rows, encode, now }) => {
    const { shp, shx } = shpShx(records), text = s => Uint8Array.from(s, c => c.charCodeAt(0));
    return { shp, shx, dbf: dbf(fields, rows, encode, now), prj: text(PRJ), cpg: text('CP949') };
  };

  // ── 지도 데이터(TopoJSON) → 면 레코드. mode 'unit': 구역(동) 하나가 레코드 하나, 'hc': hc[i]가 같은 구역끼리 합쳐 레코드 하나.
  //    돌려주는 값: [{key, units:[구역 번호], rings:[[ [경도,위도]... ]]}] 바깥 고리는 시계, 구멍은 반시계(shapefile 규칙). 합쳐도 면적은 그대로다.
  Shp.geometry = (topo, hc, mode) => {
    const geoms = Object.values(topo.objects)[0].geometries, tr = topo.transform;
    const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(q => [x += q[0], y += q[1]]); });     // 정수 좌표
    const polys = g => g.type === 'Polygon' ? [g.arcs] : g.arcs;
    const dir = k => k < 0 ? arcs[~k].slice().reverse() : arcs[k];
    const A = new Int32Array(arcs.length).fill(-1), B = new Int32Array(arcs.length).fill(-1);               // 호를 쓰는 구역 둘
    geoms.forEach((g, u) => polys(g).forEach(p => p.forEach(r => r.forEach(k => { const a = k < 0 ? ~k : k; if (A[a] < 0) A[a] = u; else if (B[a] < 0 && A[a] !== u) B[a] = u; }))));
    const area = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
    const ringPts = ring => { const out = []; ring.forEach((k, n) => { const p = dir(k); for (let j = n ? 1 : 0; j < p.length; j++) out.push(p[j]); }); return out; };
    const outerSign = Math.sign(area(ringPts(polys(geoms[0])[0][0]))) || 1;                                  // 자료 속 바깥 고리의 방향
    const toLL = r => r.map(p => [p[0] * tr.scale[0] + tr.translate[0], p[1] * tr.scale[1] + tr.translate[1]]);
    const orient = (r, outer) => { const a = area(r); return (outer ? a > 0 : a < 0) ? r.slice().reverse() : r; };   // 바깥: 면적<0(시계), 구멍: 면적>0(반시계)
    if (mode === 'unit') return geoms.map((g, u) => { const rings = []; polys(g).forEach(p => p.forEach((r, ri) => rings.push(toLL(orient(ringPts(r), ri === 0))))); return { key: u, units: [u], rings }; });
    const by = new Map(); hc.forEach((c, u) => { if (!by.has(c)) by.set(c, []); by.get(c).push(u); });
    const key = p => p[0] + ',' + p[1], out = [];
    for (const [c, units] of by) {
      const segs = [];                                                                                      // 합친 면의 바깥 경계에 해당하는 호만(방향은 원래 고리 그대로)
      for (const u of units) polys(geoms[u]).forEach(p => p.forEach(r => r.forEach(k => {
        const a = k < 0 ? ~k : k, v = A[a] === u ? B[a] : A[a];
        if (v < 0 || v === u || hc[v] !== c) { const pts = dir(k); segs.push({ pts, s: key(pts[0]), e: key(pts[pts.length - 1]) }); }
      })));
      const starts = new Map(); segs.forEach((sg, i) => { if (!starts.has(sg.s)) starts.set(sg.s, []); starts.get(sg.s).push(i); });
      const used = new Uint8Array(segs.length), rings = [];
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1; let ring = segs[i].pts.slice(), end = segs[i].e;
        while (end !== segs[i].s) { const j = (starts.get(end) || []).find(x => !used[x]); if (j === undefined) break; used[j] = 1; ring = ring.concat(segs[j].pts.slice(1)); end = segs[j].e; }
        if (end !== segs[i].s) ring.push(ring[0]);                                                          // (끊긴 고리는 닫아 준다)
        rings.push(toLL(orient(ring, Math.sign(area(ring)) === outerSign)));
      }
      out.push({ key: c, units, rings });
    }
    return out;
  };

  // ── zip(저장만, 압축 없음). files: [{name, data:Uint8Array}] ──
  Shp.zip = (files, when) => {
    const t = when || new Date(), dtime = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1), ddate = ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = Shp.crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dtime, true); h.setUint16(12, ddate, true);
      h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dtime, true); c.setUint16(14, ddate, true);
      c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + f.data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Shp; else root.Shp = Shp;
})(typeof self !== 'undefined' ? self : this);
