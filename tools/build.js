// 사용법: cd tools && node build.js
// 1) data/hjd_*.geojson → mapshaper 단순화 → TopoJSON  2) 기본 보건소 목록  3) src/app.html 에 내장해 ../index.html 생성
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const SRC = path.join(root, 'data', 'hjd_20260701.geojson');   // 새 버전이 나오면 이 줄과 README 의 출처 날짜만 바꾼다
const TOPO = path.join(root, 'data', 'dong.topo.json');
const SIMPLIFY = '25%';

// 1) 단순화. visvalingam + keep-shapes: 이웃 경계는 공유 호(arc)라 틈이 안 생기고 작은 섬도 안 사라진다.
cp.execFileSync(process.execPath, [
  path.join(__dirname, 'node_modules/mapshaper/bin/mapshaper'), SRC,
  '-filter-fields', 'adm_cd2,adm_nm,sgg', '-rename-fields', 'c=adm_cd2,n=adm_nm,g=sgg',
  '-simplify', SIMPLIFY, 'visvalingam', 'keep-shapes',
  '-o', 'format=topojson', 'quantization=30000', TOPO], { stdio: 'inherit' });

// 2) 기본 보건소 = 시군구(일반구 포함) 1개. 이름은 "수원시장안구" → "수원시 장안구 보건소"
const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const spaced = s => s.replace(/^(.+?시)(.+구)$/, '$1 $2');
const centers = new Map();
for (const f of gj.features) {
  const p = f.properties;
  const c = centers.get(p.sgg) || { id: p.sgg, sido: p.sidonm, name: spaced(p.sggnm) + ' 보건소', dongs: 0 };
  c.dongs++; centers.set(p.sgg, c);
}
const list = [...centers.values()].sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(root, 'data', 'centers_default.json'), JSON.stringify(list));

// 자체검사: 모든 행정동이 정확히 한 보건소에 배정, 코드 중복 없음
const topo = JSON.parse(fs.readFileSync(TOPO, 'utf8'));
const geoms = Object.values(topo.objects)[0].geometries;
const codes = new Set(geoms.map(g => g.properties.c));
if (codes.size !== geoms.length) throw new Error('행정동코드 중복');
if (geoms.length !== gj.features.length) throw new Error('행정동 수 불일치(단순화 중 소실)');
for (const g of geoms) if (!centers.has(g.properties.g)) throw new Error('보건소 없는 행정동 ' + g.properties.n);
console.log(`행정동 ${geoms.length}개, 기본 보건소 ${list.length}개`);

// 예외 의심 목록: 사람이 확인해야 할 곳
const NEW_GU = /^(인천광역시) (영종구|제물포구|서해구|검단구)$|화성시.+구$/;
const report = [
  '# 기본 매핑(시군구 1개 = 보건소 1개)이 실제 관할과 다를 수 있는 곳',
  '', '## 2026-07 신설·개편 구 (관할이 새로 짜였을 수 있음)',
  ...list.filter(c => NEW_GU.test(c.sido + ' ' + c.name.replace(' 보건소', '')) || /화성시 .+구/.test(c.name)).map(c => `- ${c.sido} ${c.name} (${c.id}, 행정동 ${c.dongs})`),
  '', '## 행정동이 많은 시군구 상위 25 (보건소가 2곳 이상일 가능성)',
  ...[...list].sort((a, b) => b.dongs - a.dongs).slice(0, 25).map(c => `- ${c.sido} ${c.name} (${c.id}, 행정동 ${c.dongs})`),
  '', '## 참고', '- 광주·전남은 2026-07 통합으로 시군구 코드가 바뀌었다. 과거 코드로 만든 값 파일은 시도+이름 매칭으로만 붙는다.', ''];
fs.writeFileSync(path.join(root, 'data', 'exceptions_report.txt'), report.join('\n'));

// 3) 조립
const tpl = path.join(root, 'src', 'app.html');
if (fs.existsSync(tpl)) {
  const read = f => fs.readFileSync(f, 'utf8');
  const lib = f => read(path.join(__dirname, 'node_modules', f)).replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/m, '');
  const slots = {
    '/*@CORE@*/': read(path.join(root, 'src', 'core.js')),
    '/*@LIBS@*/': lib('topojson-client/dist/topojson-client.min.js') + '\n' + lib('xlsx/dist/xlsx.mini.min.js'),
    '/*@DATA@*/': 'const TOPO=' + JSON.stringify(topo) + ';\nconst CENTERS=' + JSON.stringify(list.map(({ id, sido, name }) => ({ id, sido, name }))) + ';',
  };
  let html = read(tpl);
  for (const [k, v] of Object.entries(slots)) html = html.split(k).join(v);
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log(`index.html ${(html.length / 1048576).toFixed(1)}MB`);
}
