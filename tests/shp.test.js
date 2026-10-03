// Shapefile 쓰기 검증: 우리가 만든 .shp/.shx/.dbf 를 mapshaper(별도 구현)로 다시 읽어 도형·속성·한글이 맞는지 본다.
const assert = require('assert'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const Shp = require('../src/shp.js');

// 1) 도형: 구멍 있는 사각형 + 따로 떨어진 섬 하나(= 한 레코드에 부분 3개), 그리고 삼각형
const sq = (x, y, s) => [[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]];          // 시계 방향
const recs = [
  { rings: [sq(0, 0, 10), sq(2, 2, 3).reverse(), sq(20, 0, 4)] },                           // 바깥, 구멍(반시계), 섬
  { rings: [[[0, 20], [5, 30], [10, 20], [0, 20]]] },
];
const fields = [{ name: 'HC_CODE', type: 'C', len: 8 }, { name: 'HC_NAME', type: 'C', len: 40 }, { name: 'VALUE', type: 'N', len: 18, dec: 4 }, { name: 'CLASS', type: 'N', len: 3, dec: 0 }];
const rows = [['11700017', '마포구보건소', 12.5, 2], ['31700586', '평택시 송탄보건소', null, 0]];
const enc = Shp.cp949Encoder(TextDecoder);

const files = Shp.build({ records: recs, fields, rows, encode: enc });
assert.deepStrictEqual(Object.keys(files).sort(), ['cpg', 'dbf', 'prj', 'shp', 'shx']);
// 헤더: 파일 코드 9994, 도형 종류 5(Polygon), shx 길이 = 100 + 8*레코드
const dv = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
assert.strictEqual(dv(files.shp).getInt32(0), 9994); assert.strictEqual(dv(files.shp).getInt32(32, true), 5);
assert.strictEqual(files.shx.length, 100 + 8 * recs.length);
assert.strictEqual(dv(files.shp).getInt32(24) * 2, files.shp.length);                     // 파일 길이(워드)가 실제와 같다
assert.strictEqual(new TextDecoder().decode(files.cpg), 'CP949');
assert.ok(new TextDecoder().decode(files.prj).includes('GCS_WGS_1984'));

// 2) 한글 인코딩: 마포구 → CP949 바이트 → 다시 읽으면 같은 글자, 지원 안 되는 글자는 ?
assert.strictEqual(new TextDecoder('euc-kr').decode(enc('마포구보건소')), '마포구보건소');
assert.strictEqual(new TextDecoder('euc-kr').decode(enc('a가b😀')), 'a가b?');

// 3) 실제 GIS 도구(mapshaper)로 다시 읽기
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-'));
for (const k of ['shp', 'shx', 'dbf', 'prj', 'cpg']) fs.writeFileSync(path.join(dir, 't.' + k), files[k]);
const ms = path.join(__dirname, '..', 'tools', 'node_modules', 'mapshaper', 'bin', 'mapshaper');
cp.execFileSync(process.execPath, [ms, '-i', path.join(dir, 't.shp'), 'encoding=euc-kr', '-o', path.join(dir, 'out.json'), 'format=geojson'], { stdio: 'pipe' });
const gj = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
assert.strictEqual(gj.features.length, 2);
const f0 = gj.features[0];
assert.strictEqual(f0.properties.HC_NAME, '마포구보건소'); assert.strictEqual(f0.properties.HC_CODE, '11700017');
assert.strictEqual(f0.properties.VALUE, 12.5); assert.strictEqual(f0.properties.CLASS, 2);
assert.strictEqual(gj.features[1].properties.HC_NAME, '평택시 송탄보건소'); assert.strictEqual(gj.features[1].properties.VALUE, null);   // 값 없음은 비워 둔다
assert.strictEqual(f0.geometry.type, 'MultiPolygon');
assert.strictEqual(f0.geometry.coordinates.length, 2);                                       // 구멍 뚫린 면 + 섬
assert.strictEqual(f0.geometry.coordinates[0].length, 2);                                    // 바깥 + 구멍 1개 (구멍으로 인식됨)
assert.strictEqual(gj.features[1].geometry.type, 'Polygon');

// 4) zip: 파일 목록·CRC 가 맞는 표준 zip 인가(저장만 함, 압축 없음)
const zip = Shp.zip([{ name: 't.shp', data: files.shp }, { name: 'README_fields.txt', data: new TextEncoder().encode('필드 설명') }], new Date(2026, 9, 4, 12, 0, 0));
const zv = dv(zip), eocd = zip.length - 22;
assert.strictEqual(zv.getUint32(eocd, true), 0x06054b50); assert.strictEqual(zv.getUint16(eocd + 10, true), 2);
let off = zv.getUint32(eocd + 16, true); const seen = [];
for (let i = 0; i < 2; i++) {
  assert.strictEqual(zv.getUint32(off, true), 0x02014b50);
  const crc = zv.getUint32(off + 16, true), size = zv.getUint32(off + 24, true), nl = zv.getUint16(off + 28, true), lo = zv.getUint32(off + 42, true);
  const name = new TextDecoder().decode(zip.subarray(off + 46, off + 46 + nl));
  const data = zip.subarray(lo + 30 + zv.getUint16(lo + 26, true), lo + 30 + zv.getUint16(lo + 26, true) + size);
  assert.strictEqual(Shp.crc32(data), crc); seen.push(name); off += 46 + nl;
}
assert.deepStrictEqual(seen, ['t.shp', 'README_fields.txt']);
assert.strictEqual(Shp.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);        // CRC32 표준 검사값

fs.rmSync(dir, { recursive: true, force: true });

// 5) 실제 지도 데이터: 보건소 단위로 합쳐도 면적이 그대로이고(합친 경계가 맞다), 모든 고리가 닫혀 있다
const dongFile = path.join(__dirname, '..', 'data', 'dong.topo.json'), emdFile = path.join(__dirname, '..', 'data', 'emd.topo.json');
function checkReal(file, hcOf, label) {
  const topo = JSON.parse(fs.readFileSync(file, 'utf8')), tj = require('../tools/node_modules/topojson-client');
  const obj = Object.values(topo.objects)[0], geoms = obj.geometries, hc = hcOf(geoms);
  const area = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
  // 기준(다른 방법): topojson-client 로 푼 GeoJSON 에서 구역별 면적 = 바깥 면적 − 구멍 면적
  const truth = tj.feature(topo, obj).features.map(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).reduce((s, poly) => s + poly.reduce((t, r, i) => t + (i === 0 ? 1 : -1) * Math.abs(area(r)), 0), 0));
  const unitRecs = Shp.geometry(topo, hc, 'unit');
  assert.strictEqual(unitRecs.length, geoms.length);
  unitRecs.forEach((r, i) => assert.ok(Math.abs(-r.rings.reduce((s, q) => s + area(q), 0) - truth[i]) < 1e-9 * Math.max(1, truth[i]), label + ' unit area ' + i));
  const hcRecs = Shp.geometry(topo, hc, 'hc');
  assert.strictEqual(hcRecs.length, new Set(hc).size);
  let bad = 0, rings = 0;
  for (const r of hcRecs) {
    const want = r.units.reduce((s, u) => s + truth[u], 0), got = -r.rings.reduce((s, q) => s + area(q), 0);   // 바깥(−)과 구멍(+)을 더하면 −면적
    if (!(Math.abs(got - want) < 1e-9 * Math.max(1, want))) bad++;
    for (const q of r.rings) { rings++; assert.deepStrictEqual(q[0], q[q.length - 1], '고리가 닫혀 있다'); }
  }
  assert.strictEqual(bad, 0, label + ': 합친 면적이 구역 면적의 합과 다른 보건소 ' + bad + '개');
  console.log(`real data ${label}: 구역 ${unitRecs.length} → 보건소 ${hcRecs.length}, 면적 보존 OK, 고리 ${rings}`);
}
// 6) 섬 지우기: 두 번째 이후 덩어리(섬)를 빼면 면적이 남은 덩어리의 합과 같고, 빈 구역은 도형이 없다
function checkKeep(file, hcOf, label) {
  const topo = JSON.parse(fs.readFileSync(file, 'utf8')), tj = require('../tools/node_modules/topojson-client'), obj = Object.values(topo.objects)[0], geoms = obj.geometries, hc = hcOf(geoms);
  const area = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
  const keep = (u, k) => k === 0 || (u + k) % 5 === 0;                                      // 첫 덩어리는 항상, 나머지는 일부만 남김
  const truth = tj.feature(topo, obj).features.map((f, u) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).reduce((s, poly, k) => s + (keep(u, k) ? poly.reduce((t2, r, i) => t2 + (i === 0 ? 1 : -1) * Math.abs(area(r)), 0) : 0), 0));
  const units = Shp.geometry(topo, hc, 'unit', keep);
  units.forEach((r, u) => assert.ok(Math.abs(-r.rings.reduce((s, q) => s + area(q), 0) - truth[u]) < 1e-9 * Math.max(1, truth[u]), label + ' keep unit ' + u));
  const hcr = Shp.geometry(topo, hc, 'hc', keep); let bad = 0;
  for (const r of hcr) { const want = r.units.reduce((s, u) => s + truth[u], 0), got = -r.rings.reduce((s, q) => s + area(q), 0); if (!(Math.abs(got - want) < 1e-9 * Math.max(1, want))) bad++; for (const q of r.rings) assert.deepStrictEqual(q[0], q[q.length - 1]); }
  assert.strictEqual(bad, 0, label + ' keep 보건소 면적 불일치 ' + bad);
  console.log(`real data ${label}: 섬 일부 제거 후에도 면적 일치 OK (구역 ${units.length}, 보건소 ${hcr.length})`);
}
if (fs.existsSync(dongFile)) {
  checkKeep(dongFile, g => g.map(x => x.properties.g), '행정동');
}
if (fs.existsSync(dongFile)) {
  checkReal(dongFile, g => g.map(x => x.properties.g), '행정동(기본 배정)');
  // 사용자가 배정을 바꾼 지도: 구역 일부를 임의의 다른 보건소로 옮겨도 합친 면적이 맞아야 한다
  checkReal(dongFile, g => { const ids = [...new Set(g.map(x => x.properties.g))]; return g.map((x, i) => i % 7 === 0 ? ids[(i * 13) % ids.length] : x.properties.g); }, '행정동(배정 일부 변경)');
}
if (fs.existsSync(emdFile) && fs.existsSync(dongFile)) {
  const dg = new Map(Object.values(JSON.parse(fs.readFileSync(dongFile, 'utf8')).objects)[0].geometries.map(g => [g.properties.c, g.properties.g]));
  checkReal(emdFile, g => g.map(x => dg.get(x.properties.p)), '법정동');
}
console.log('shp tests ok');
