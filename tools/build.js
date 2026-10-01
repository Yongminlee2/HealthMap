// 사용법: cd tools && node build.js
// 입력(data/): hjd_20260701.geojson(행정동, 2026-07-01), emd/emd.shp(법정동), centers_2026.tsv(보건소 260곳)
// 출력: data/*.topo.json, data/centers_default.json, data/exceptions_report.txt, ../index.html
const fs = require('fs'), path = require('path'), cp = require('child_process');
const topojson = require('topojson-client');
const root = path.join(__dirname, '..'), D = f => path.join(root, 'data', f);
const SRC_DONG = D('hjd_20260701.geojson');       // 새 버전이 나오면 파일명만 바꾼다
const SRC_EMD = D('emd/emd.shp');
const ms = (...a) => cp.execFileSync(process.execPath, [path.join(__dirname, 'node_modules/mapshaper/bin/mapshaper'), ...a], { stdio: 'inherit' });

// ── 1) 경계 단순화 (이웃 경계는 공유 호라 틈이 안 생김) ─────────────────
ms(SRC_DONG, '-filter-fields', 'adm_cd2,adm_nm,sgg', '-rename-fields', 'c=adm_cd2,n=adm_nm,g=sgg',
  '-simplify', '25%', 'visvalingam', 'keep-shapes', '-o', 'format=topojson', 'quantization=30000', D('dong.topo.json'));
// 법정동 shp 는 이웃 경계가 어긋나 있어서 snap+clean 으로 먼저 붙인다. 좌표계 EPSG:5179(UTM-K), 글자 EUC-KR.
ms('-i', SRC_EMD, 'encoding=euc-kr', '-snap', 'interval=1', '-clean', 'gap-fill-area=20000',
  '-proj', 'wgs84', 'from=+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
  '-filter-fields', 'EMD_CD,EMD_KOR_NM', '-rename-fields', 'c=EMD_CD,n=EMD_KOR_NM',
  '-simplify', '10%', 'visvalingam', 'keep-shapes', '-o', 'format=topojson', 'quantization=30000', D('emd.topo.json'));

// ── 2) 보건소 260곳(centers_2026.tsv)과 행정동 연결 ────────────────────
const gj = JSON.parse(fs.readFileSync(SRC_DONG, 'utf8'));
const centersRaw = fs.readFileSync(D('centers_2026.tsv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => { const [, id, name] = l.split('\t'); return { id, name }; });
const sggs = new Map();
for (const f of gj.features) { const p = f.properties; if (!sggs.has(p.sgg)) sggs.set(p.sgg, { id: p.sgg, sido: p.sidonm, nm: p.sggnm }); }
// 보건소코드 앞 2자리 → 가능한 시도 (이름 맞출 때 같은 이름의 다른 지역을 거르는 용도)
const GROUP = { 11: ['서울특별시'], 21: ['부산광역시'], 31: ['경기도', '인천광역시'], 41: ['경기도'], 32: ['강원특별자치도'], 33: ['충청북도'], 34: ['대전광역시', '세종특별자치시', '충청남도'], 35: ['전북특별자치도'], 36: ['전남광주통합특별시'], 37: ['대구광역시', '경상북도'], 38: ['울산광역시', '경상남도'], 39: ['제주특별자치도'] };
// 이름만으로는 안 붙는 보건소: 시군구 이름 직접 지정
const WHOLE = {
  31700012: ['부천시원미구'], 31700420: ['부천시소사구'], 31700497: ['부천시오정구'],
  31700322: ['안산시단원구'], 31700543: ['안산시상록구'], 35700204: ['전주시덕진구'], 35700205: ['전주시완산구'],
  31700374: ['서해구'],                                                                    // 2026-07 인천 서구 분할: '서구보건소'가 서해구를 맡는 것으로 본다
  38700115: ['창원시마산합포구', '창원시마산회원구'], 38700034: ['창원시진해구'], 38700140: ['창원시의창구', '창원시성산구'],
  31700210: ['화성시만세구', '화성시효행구'],                                              // 효행구보건소가 목록에 없어 만세구보건소에 합침(확인 필요)
};
// 한 시를 둘 이상의 보건소가 나누는 곳: 이름 목록(읍면동)에 드는 곳은 해당 보건소, 나머지는 rest
const SPLIT = {
  평택시: { sgg: '평택시', rest: 31700357, by: { 31700586: ['진위면', '서탄면', '청북읍', '고덕면', '고덕동', '서정동', '송탄동', '지산동', '송북동', '신장1동', '신장2동'] } },
  구미시: { sgg: '구미시', rest: 37700278, by: { 37700421: ['선산읍', '고아읍', '무을면', '옥성면', '도개면', '해평면', '산동읍', '장천면'] } },
  남양주시: { sgg: '남양주시', rest: 31700446, by: { 31700616: ['진접읍', '오남읍', '별내면', '별내동'] } },
  제주시: { sgg: '제주시', rest: 39700020, by: { 39700062: ['구좌읍', '조천읍', '우도면'], 39700038: ['한림읍', '애월읍', '한경면'] } },
  서귀포시: { sgg: '서귀포시', rest: 39700046, by: { 39700011: ['남원읍', '성산읍', '표선면'], 39700054: ['대정읍', '안덕면'] } },
};
const sggCenter = new Map();                                                               // sgg 코드 → 보건소코드 (통째로 맡는 경우)
const norm = s => s.replace(/보건소|보건의료원/g, '').replace(/[\s()]/g, '');
for (const c of centersRaw) {
  const g = GROUP[c.id.slice(0, 2)], base = norm(c.name);
  const names = WHOLE[c.id] || [base];
  if (Object.values(SPLIT).some(s => s.rest == c.id || Object.keys(s.by).includes(c.id))) continue;
  for (const nm of names) {
    const hit = [...sggs.values()].filter(s => s.nm === nm && (WHOLE[c.id] || g.includes(s.sido)));
    if (hit.length !== 1) throw new Error(`보건소 ${c.id} ${c.name}: '${nm}'에 맞는 시군구 ${hit.length}개`);
    if (sggCenter.has(hit[0].id)) throw new Error(`시군구 ${hit[0].id}가 보건소 둘에 걸림`);
    sggCenter.set(hit[0].id, c.id);
  }
}
const dongCenter = new Map(), tail = nm => nm.split(' ').pop();
for (const f of gj.features) {
  const p = f.properties; let id = sggCenter.get(p.sgg);
  if (!id) {
    const sp = Object.values(SPLIT).find(s => s.sgg === p.sggnm);
    if (!sp) throw new Error('보건소 없는 시군구 ' + p.adm_nm);
    id = String(sp.rest);
    for (const [cid, list] of Object.entries(sp.by)) if (list.includes(tail(p.adm_nm))) id = cid;
  }
  dongCenter.set(p.adm_cd2, String(id));
}
// 검증: 모든 행정동이 정확히 한 보건소에, 모든 보건소가 행정동 1개 이상
const cnt = new Map(); for (const id of dongCenter.values()) cnt.set(id, (cnt.get(id) || 0) + 1);
for (const c of centersRaw) if (!cnt.get(c.id)) throw new Error('행정동 없는 보건소 ' + c.id + ' ' + c.name);
for (const [, id] of dongCenter) if (!centersRaw.some(c => c.id === id)) throw new Error('목록에 없는 보건소 ' + id);
const sidoOf = new Map(); for (const f of gj.features) { const id = dongCenter.get(f.properties.adm_cd2); if (!sidoOf.has(id)) sidoOf.set(id, f.properties.sidonm); }
const centers = centersRaw.map(c => ({ id: c.id, sido: sidoOf.get(c.id), name: c.name })).sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(D('centers_default.json'), JSON.stringify(centers));

// 행정동 topo 의 g 를 보건소코드로 바꿔 쓴다
const dongTopo = JSON.parse(fs.readFileSync(D('dong.topo.json'), 'utf8'));
const dongGeoms = Object.values(dongTopo.objects)[0].geometries;
if (dongGeoms.length !== gj.features.length || new Set(dongGeoms.map(g => g.properties.c)).size !== dongGeoms.length) throw new Error('행정동 수/코드 이상');
for (const g of dongGeoms) g.properties = { c: g.properties.c, n: g.properties.n, g: dongCenter.get(g.properties.c) };
fs.writeFileSync(D('dong.topo.json'), JSON.stringify(dongTopo));
console.log(`행정동 ${dongGeoms.length}개, 보건소 ${centers.length}곳`);

// ── 3) 법정동 → 소속 행정동(가장 많이 겹치는 곳) ───────────────────────
const emdTopo = JSON.parse(fs.readFileSync(D('emd.topo.json'), 'utf8'));
const emdFeats = topojson.feature(emdTopo, Object.values(emdTopo.objects)[0]).features;
const dongFeats = topojson.feature(dongTopo, Object.values(dongTopo.objects)[0]).features;
const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h));
const bbox = r => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
const CELL = 0.05, grid = new Map(), dinfo = dongFeats.map((f, i) => ({ i, polys: polysOf(f.geometry).map(p => ({ p, bb: bbox(p[0]) })) }));
for (const d of dinfo) for (const q of d.polys) for (let x = Math.floor(q.bb[0] / CELL); x <= Math.floor(q.bb[2] / CELL); x++) for (let y = Math.floor(q.bb[1] / CELL); y <= Math.floor(q.bb[3] / CELL); y++) { const k = x + ',' + y; if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(d); }
const locate = (x, y) => {
  const cand = grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
  if (cand) for (const d of cand) for (const q of d.polys) if (x >= q.bb[0] && x <= q.bb[2] && y >= q.bb[1] && y <= q.bb[3] && inPoly(x, y, q.p)) return d.i;
  let best = -1, bd = 1e9;                                                    // 바다·틈에 떨어지면 가장 가까운 행정동
  for (const d of dinfo) for (const q of d.polys) { const dx = Math.max(q.bb[0] - x, 0, x - q.bb[2]), dy = Math.max(q.bb[1] - y, 0, y - q.bb[3]), dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = d.i; } }
  return best;
};
const emdGeoms = Object.values(emdTopo.objects)[0].geometries; let weak = 0;
emdFeats.forEach((f, k) => {
  const big = polysOf(f.geometry).map(p => ({ p, bb: bbox(p[0]) })).sort((a, b) => (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]) - (a.bb[2] - a.bb[0]) * (a.bb[3] - a.bb[1]))[0];
  const pts = [], N = 7;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = big.bb[0] + (big.bb[2] - big.bb[0]) * (i + .5) / N, y = big.bb[1] + (big.bb[3] - big.bb[1]) * (j + .5) / N; if (inPoly(x, y, big.p)) pts.push([x, y]); }
  if (!pts.length) { const r = big.p[0]; pts.push([r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]); }
  const votes = new Map(); for (const [x, y] of pts) { const i = locate(x, y); votes.set(i, (votes.get(i) || 0) + 1); }
  const [bi, bv] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bv / pts.length < 0.6) weak++;
  emdGeoms[k].properties = { c: emdGeoms[k].properties.c, n: emdGeoms[k].properties.n, p: dongGeoms[bi].properties.c };
});
if (new Set(emdGeoms.map(g => g.properties.c)).size !== emdGeoms.length) throw new Error('법정동코드 중복');
fs.writeFileSync(D('emd.topo.json'), JSON.stringify(emdTopo));
console.log(`법정동 ${emdGeoms.length}개 (행정동 하나로 정하기 애매한 곳 ${weak}개)`);

// ── 4) 확인이 필요한 곳 목록 ───────────────────────────────────────────
const nameOf = new Map(centers.map(c => [c.id, c]));
const dongsOf = id => gj.features.filter(f => dongCenter.get(f.properties.adm_cd2) === id).map(f => tail(f.properties.adm_nm));
const report = ['# 보건소 ↔ 행정동 기본 연결에서 사람이 확인해야 할 곳', '',
  '보건소 260곳은 data/centers_2026.tsv(사용자 제공)가 기준이고, 아래는 시군구 단위로 딱 떨어지지 않아 규칙으로 정한 곳입니다.', '',
  '## 한 시를 둘 이상의 보건소가 나누는 곳 (읍면동 단위 지정)'];
for (const sp of Object.values(SPLIT)) for (const id of [String(sp.rest), ...Object.keys(sp.by)]) report.push(`- ${nameOf.get(id).sido} ${nameOf.get(id).name} (${id}): ${dongsOf(id).join(', ')}`);
report.push('', '## 관할을 추정으로 정한 곳 (보건소 목록은 사용자 제공 260곳이 기준)', '- 평택시: 송탄보건소 관할은 웹 자료가 엇갈려 위 읍면동으로 정했습니다. 공식 관할표로 확인하세요.',
  '- 화성시 효행구(봉담읍·매송면·비봉면·정남면·기배동): 제공된 목록에 효행구보건소가 없어 만세구보건소(31700210)에 포함했습니다.',
  '- 제주시 추자면은 제주보건소에 넣었습니다.',
  '- 인천 서구보건소(31700374)는 2026-07 분할 후 서해구를 맡는 것으로 보았습니다.',
  '', '## 시군구 여러 곳을 한 보건소가 맡는 곳');
for (const [id, c] of nameOf) { const s = [...sggCenter].filter(([, v]) => v === id); if (s.length > 1) report.push(`- ${c.sido} ${c.name} (${id}): ${s.map(([k]) => sggs.get(k).nm).join(' + ')}`); }
report.push('', '## 경계 자료 기준일', '- 행정동: 2026-07-01 (SGIS 원자료)', '- 법정동: 2023-07-29 (국토교통부 법정구역 shp). 소속 행정동은 2026 기준으로 연결했습니다. 최신 법정동 shp 는 V-World 로그인 후 받아야 합니다.', '');
fs.writeFileSync(D('exceptions_report.txt'), report.join('\n'));

// ── 4-2) 엑셀로 확인하는 매핑표 ────────────────────────────────────────────
// 첫 시트('행정동별')는 앱의 [배정표 불러오기]가 그대로 읽는 형식이다(엑셀에서 보건소코드를 고쳐 다시 불러올 수 있음).
{
  const XLSX = require('xlsx');
  const SIDO_ORDER = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '전남광주통합특별시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '경상북도', '경상남도', '제주특별자치도'];
  const sidoRank = s => { const i = SIDO_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  const spacedSgg = nm => nm.replace(/^(.+?시)(.+구)$/, '$1 $2');
  const NOTE_SONG = new Set(SPLIT.평택시.by[31700586]);
  const noteOf = f => {
    const p = f.properties, t = tail(p.adm_nm);
    if (p.sggnm === '평택시' && (NOTE_SONG.has(t) || dongCenter.get(p.adm_cd2) === '31700357')) return '관할 추정(평택 송탄/평택 구분, 공식 관할표 확인 필요)';
    if (p.sggnm === '화성시효행구') return '목록에 효행구보건소가 없어 만세구보건소에 포함';
    if (p.sggnm === '제주시' && t === '추자면') return '관할 추정(제주보건소로 분류)';
    if (p.sggnm === '서해구') return '인천 서구 분할 후 서구보건소가 서해구를 맡는 것으로 분류';
    return '';
  };
  const dongRows = [['행정동코드', '행정동명', '보건소코드', '보건소명', '시도', '시군구', '비고']];
  for (const f of gj.features) { const p = f.properties, id = dongCenter.get(p.adm_cd2), c = nameOf.get(id); dongRows.push([p.adm_cd2, p.adm_nm.split(' ').slice(1).join(' '), id, c.name, c.sido, spacedSgg(p.sggnm), noteOf(f)]); }
  dongRows.splice(1, dongRows.length, ...dongRows.slice(1).sort((a, b) => a[4] === b[4] ? (a[3] === b[3] ? a[0].localeCompare(b[0]) : a[3].localeCompare(b[3], 'ko')) : sidoRank(a[4]) - sidoRank(b[4])));
  const centerRows = [['보건소코드', '시도', '보건소명', '행정동 수', '소속 시군구', '소속 행정동', '비고']];
  for (const c of centers) {
    const fs_ = gj.features.filter(f => dongCenter.get(f.properties.adm_cd2) === c.id);
    centerRows.push([c.id, c.sido, c.name, fs_.length, [...new Set(fs_.map(f => spacedSgg(f.properties.sggnm)))].join(', '), fs_.map(f => tail(f.properties.adm_nm)).join(', '), [...new Set(fs_.map(noteOf).filter(Boolean))].join(' / ')]);
  }
  centerRows.splice(1, centerRows.length, ...centerRows.slice(1).sort((a, b) => sidoRank(a[1]) - sidoRank(b[1]) || a[2].localeCompare(b[2], 'ko')));
  const dongByCode = new Map(gj.features.map(f => [f.properties.adm_cd2, f.properties]));
  const bjdRows = [['법정동코드', '법정동명', '시도', '시군구', '소속 행정동', '소속 행정동코드', '보건소코드', '보건소명']];
  for (const g of emdGeoms) { const p = g.properties, d = dongByCode.get(p.p), id = dongCenter.get(p.p), c = nameOf.get(id); bjdRows.push([p.c, p.n, d.sidonm, spacedSgg(d.sggnm), tail(d.adm_nm), p.p, id, c.name]); }
  bjdRows.splice(1, bjdRows.length, ...bjdRows.slice(1).sort((a, b) => sidoRank(a[2]) - sidoRank(b[2]) || a[3].localeCompare(b[3], 'ko') || a[0].localeCompare(b[0])));
  const noteRows = [['확인이 필요한 곳 / 이 파일 보는 법'], [''], ['● 보건소 목록은 사용자가 제공한 2026년 260곳이 기준입니다.'], ['● 첫 시트(행정동별)는 지도 프로그램의 [배정표 불러오기]로 다시 읽을 수 있습니다. 보건소코드·보건소명 열을 고쳐서 불러오면 지도에 반영됩니다.'],
    ['● 법정동별 시트의 소속 행정동은 법정동 경계(2023-07)와 행정동 경계(2026-07)가 가장 많이 겹치는 곳으로 연결한 것입니다.'], [''], ...report.filter(l => /^- /.test(l) && !/^- 행정동:|^- 법정동:/.test(l)).map(l => ['● ' + l.slice(2)])];
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(wch => ({ wch })); if (rows.length > 1 && rows[0].length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) }; XLSX.utils.book_append_sheet(wb, ws, name); };
  add('행정동별', dongRows, [14, 28, 12, 26, 18, 18, 46]);
  add('보건소별', centerRows, [12, 18, 26, 10, 30, 90, 46]);
  add('법정동별', bjdRows, [12, 16, 18, 18, 18, 14, 12, 26]);
  const wsn = XLSX.utils.aoa_to_sheet(noteRows); wsn['!cols'] = [{ wch: 140 }]; XLSX.utils.book_append_sheet(wb, wsn, '확인필요');
  XLSX.writeFile(wb, path.join(root, '보건소_행정동_매핑표.xlsx'));
  console.log(`매핑표 엑셀: 행정동 ${dongRows.length - 1}행, 보건소 ${centerRows.length - 1}행, 법정동 ${bjdRows.length - 1}행`);
}

// ── 5) 조립 ─────────────────────────────────────────────────────────────
const tpl = path.join(root, 'src', 'app.html');
if (fs.existsSync(tpl)) {
  const read = f => fs.readFileSync(f, 'utf8');
  const lib = f => read(path.join(__dirname, 'node_modules', f)).replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/m, '');
  const slots = {
    '/*@CORE@*/': read(path.join(root, 'src', 'core.js')),
    '/*@APP@*/': read(path.join(root, 'src', 'app.js')),
    '/*@LIBS@*/': lib('xlsx/dist/xlsx.mini.min.js'),
    '/*@DATA@*/': 'const TOPO=' + JSON.stringify(dongTopo) + ';\nconst TOPO_B=' + JSON.stringify(emdTopo) + ';\nconst CENTERS=' + JSON.stringify(centers) + ';',
  };
  let html = read(tpl);
  for (const [k, v] of Object.entries(slots)) html = html.split(k).join(v);
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log(`index.html ${(html.length / 1048576).toFixed(1)}MB`);
}
