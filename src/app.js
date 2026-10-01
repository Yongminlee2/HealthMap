(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "'Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const SOURCES = {
  dong: '경계: 통계청 SGIS 행정동(2026-07-01), 가공 vuski/admdongkor (CC BY 4.0)',
  bjd: '경계: 국토교통부 법정구역(2023-07), 소속 행정동: 통계청 SGIS(2026-07-01) 가공 vuski/admdongkor (CC BY 4.0)',
};
const PALETTES = {
  '파랑': ['#deebf7', '#3182bd', '#08306b'], '빨강': ['#fee5d9', '#fb6a4a', '#99000d'], '초록': ['#e5f5e0', '#41ab5d', '#00441b'],
  '보라': ['#efedf5', '#807dba', '#3f007d'], '주황': ['#fff5eb', '#fd8d3c', '#7f2704'], '노랑-빨강': ['#ffffb2', '#fd8d3c', '#800026'],
  '노랑-청록-남색': ['#fde725', '#21918c', '#440154'], '빨강-하양-파랑(발산)': ['#b2182b', '#f7f7f7', '#2166ac'],
};
const SIDO_ORDER = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '전남광주통합특별시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '경상북도', '경상남도', '제주특별자치도'];
const sidoRank = s => { const i = SIDO_ORDER.indexOf(s); return i < 0 ? 99 : i; };
const byRegion = (a, b) => sidoRank(a.sido) - sidoRank(b.sido) || a.name.localeCompare(b.name, 'ko');
const fmt = x => Number(x).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

// ── 지도 데이터: 호(arc)를 한 번만 풀어 경로 글자로 만들어 두고, 선은 호 단위로 골라 이어 붙인다 ──
const LAT0 = 38.7, LON0 = 124.5, KX = 800, KY = 1000;          // 위도 보정한 단순 투영
const MOVE_T = 6;                                               // 움직이는 동안 보건소 경계선에서 이보다 가까운 점(지도 단위, 전국 화면 약 1px)은 버린다
function buildLayer(topo) {
  const geoms = Object.values(topo.objects)[0].geometries, tr = topo.transform;
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  const arcLow = [];
  const arcPts = topo.arcs.map(a => {
    let x = 0, y = 0, lx = 0, ly = 0; const lo = [];
    const pts = a.map((q, n) => {
      x += q[0]; y += q[1];
      const X = (x * tr.scale[0] + tr.translate[0] - LON0) * KX, Y = (LAT0 - (y * tr.scale[1] + tr.translate[1])) * KY;
      if (X < mnx) mnx = X; if (X > mxx) mxx = X; if (Y < mny) mny = Y; if (Y > mxy) mxy = Y;
      const t = X.toFixed(1) + ' ' + Y.toFixed(1);
      if (n === 0 || n === a.length - 1 || (X - lx) * (X - lx) + (Y - ly) * (Y - ly) >= MOVE_T * MOVE_T) { lo.push(t); lx = X; ly = Y; }
      return t;
    });
    arcLow.push(lo);
    return pts;
  });
  const arcA = new Int32Array(topo.arcs.length).fill(-1), arcB = new Int32Array(topo.arcs.length).fill(-1);   // 호를 쓰는 구역 둘(바깥 호는 B=A)
  const ringD = (ring, src) => {
    const out = [];
    ring.forEach((k, n) => { const pts = k < 0 ? src[~k].slice().reverse() : src[k]; for (let j = n ? 1 : 0; j < pts.length; j++) out.push(pts[j]); });
    return 'M' + out.join('L') + 'Z';
  };
  const unitD = g => (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(poly => poly.map(ring => ringD(ring, arcPts)).join('')).join('');
  geoms.forEach((g, u) => (g.type === 'Polygon' ? [g.arcs] : g.arcs).forEach(poly => poly.forEach(ring => {
    for (const k of ring) { const a = k < 0 ? ~k : k; if (arcA[a] < 0) arcA[a] = u; else if (arcB[a] < 0 && arcA[a] !== u) arcB[a] = u; }
  })));
  const d = geoms.map(unitD);
  for (let a = 0; a < arcA.length; a++) if (arcA[a] >= 0 && arcB[a] < 0) arcB[a] = arcA[a];
  const props = geoms.map(g => g.properties);
  return { n: geoms.length, props, d, arcD: arcPts.map(p => 'M' + p.join('L')), arcDLow: arcLow.map(p => 'M' + p.join('L')), arcA, arcB, idx: new Map(props.map((p, i) => [p.c, i])), bbox: [mnx, mny, mxx, mxy] };
}
const A = buildLayer(TOPO);                                    // 행정동: props {c 코드, n 이름, g 기본 보건소코드}
let B = null, L = A;                                           // 법정동은 처음 쓸 때 만든다: props {c, n, p 소속 행정동코드}
const defCenter = new Map(CENTERS.map(c => [c.id, c]));

// ── 상태 ────────────────────────────────────────────────
const LS = 'healthmap.v2';
const newLegend = () => ({ title: '', unit: '', n: 5, mode: 'equal', palette: '파랑', reverse: false, breaks: [], colors: [], customColors: false, noData: '#e3e7eb' });
const S = { values: {}, overrides: {}, overridesB: {}, extra: [], renamed: {}, showDong: true, showSido: true, unit: 'dong', legend: newLegend() };
try { const d = JSON.parse(localStorage.getItem(LS) || '{}'); Object.assign(S, d); S.legend = Object.assign(newLegend(), d.legend); } catch (e) {}
let sel = '', editMode = false, dongHC = [], hc = [], cmap = new Map();
const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} renderSaveBar(); scheduleAuto(); };

function allCenters() {
  const m = new Map();
  for (const c of CENTERS.concat(S.extra)) m.set(c.id, { id: c.id, sido: c.sido, name: S.renamed[c.id] || c.name });
  return m;
}
function computeHC() {
  cmap = allCenters();
  dongHC = A.props.map(p => S.overrides[p.c] ?? p.g);
  hc = L === A ? dongHC : L.props.map(p => S.overridesB[p.c] ?? dongHC[A.idx.get(p.p)] ?? '');
}
const defaultOf = i => L === A ? A.props[i].g : dongHC[A.idx.get(L.props[i].p)];     // 손대지 않았을 때의 보건소
const usedCenters = () => { const used = new Set(hc); return [...cmap.values()].filter(c => used.has(c.id)).sort(byRegion); };
const dongLabel = i => A.props[i].n.split(' ').slice(1).join(' ');
const unitLabel = i => L === A ? dongLabel(i) : A.props[A.idx.get(L.props[i].p)].n.split(' ')[1] + ' ' + L.props[i].n;

// ── 지도 그리기 ─────────────────────────────────────────
const map = $('#map'), ov = $('#overlay'), stage = $('#stage'), tip = $('#tip');
map.innerHTML = '<g id="gDong" fill-rule="evenodd"></g><g id="gSel" fill="#ff8a00" fill-opacity=".55" stroke="none" pointer-events="none"></g>' +
  '<path id="gInner" fill="none" stroke="#fff" stroke-linejoin="round" pointer-events="none"/>' +
  '<path id="gBorder" fill="none" stroke="#2b3440" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>' +
  '<path id="gSido" fill="none" stroke="#0b1220" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>';
const gDong = $('#gDong'), gSel = $('#gSel'), gInner = $('#gInner'), gBorder = $('#gBorder'), gSido = $('#gSido'), dongEls = gDong.children;
const [minX, minY, maxX, maxY] = A.bbox, BW = maxX - minX, BH = maxY - minY;
let vb = { x: 0, y: 0, w: 1, h: 1 }, lastCW = 0, strokesDirty = true, borderFull = '', borderLow = '';

function applyVB() {
  map.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  if (strokesDirty) {                                          // 선 굵기는 화면 기준 px 로 맞춘다(확대할 때만 다시 계산)
    const sc = stage.clientWidth / vb.w;
    gBorder.setAttribute('stroke-width', (1.4 / sc).toFixed(3)); gInner.setAttribute('stroke-width', (0.5 / sc).toFixed(3)); gSido.setAttribute('stroke-width', (2.6 / sc).toFixed(3));
    strokesDirty = false;
  }
}
// 움직이는 동안은 가는 세부선을 숨기고(가장 무거움) 멈추면 다시 보인다. 갱신은 프레임당 한 번.
let moving = false, quiet = 0, vbQueued = false, borderIsLow = false;
function syncBorder() {                                        // 전국이 보이는 배율에서 움직일 때만 성긴 경계선(확대 상태에서 쓰면 각져 보임)
  const want = moving && lastCW / vb.w < 0.3;
  if (want !== borderIsLow) { borderIsLow = want; gBorder.setAttribute('d', want ? borderLow : borderFull); }
}
function moveVB(zoomed) {
  if (zoomed) strokesDirty = true;
  if (!moving) { moving = true; gInner.style.display = 'none'; map.setAttribute('shape-rendering', 'optimizeSpeed'); }
  syncBorder();
  clearTimeout(quiet); quiet = setTimeout(() => { moving = false; gInner.style.display = ''; map.removeAttribute('shape-rendering'); syncBorder(); }, 150);
  if (!vbQueued) { vbQueued = true; requestAnimationFrame(() => { vbQueued = false; applyVB(); }); }
}
function fit() {
  const cw = stage.clientWidth, ch = stage.clientHeight, m = 40;
  if (!cw || !ch) return;                                      // 창이 접혀 크기가 0일 때는 건드리지 않는다
  const sc = Math.min(cw / (BW + 2 * m), ch / (BH + 2 * m));
  vb.w = cw / sc; vb.h = ch / sc; vb.x = minX + BW / 2 - vb.w / 2; vb.y = minY + BH / 2 - vb.h / 2;
  lastCW = cw; strokesDirty = true; applyVB();
}

// ── 범례 계산 ───────────────────────────────────────────
function legendValues() { const used = new Set(hc); return Object.entries(S.values).filter(([id, v]) => used.has(id) && Number.isFinite(v)).map(([, v]) => v); }
function rebuildLegend(regenColors) {
  const Lg = S.legend, vals = legendValues();
  if (Lg.mode !== 'custom' || Lg.breaks.length < 2) { if (Lg.mode === 'custom') Lg.mode = 'equal'; Lg.breaks = Core.niceBreaks(vals, Lg.n, Lg.mode); }
  const n = Math.max(Lg.breaks.length - 1, 0);
  if (regenColors || Lg.colors.length !== n || !Lg.customColors) {
    const a = PALETTES[Lg.palette].slice(); if (Lg.reverse) a.reverse();
    Lg.colors = n ? Core.ramp(a, n) : []; if (regenColors) Lg.customColors = false;
  }
}
const colorOf = id => { const v = S.values[id], k = v === undefined ? -1 : Core.classify(v, S.legend.breaks); return k < 0 ? S.legend.noData : S.legend.colors[k]; };
function recolor() {
  const cache = {};
  for (let i = 0; i < hc.length; i++) dongEls[i].setAttribute('fill', cache[hc[i]] || (cache[hc[i]] = colorOf(hc[i])));
}
function drawMesh() {
  const border = [], borderLo = [], inner = [], { arcA, arcB, arcD, arcDLow } = L;
  for (let a = 0; a < arcA.length; a++) {
    const u = arcA[a]; if (u < 0) continue;
    const v = arcB[a];
    if (u === v || hc[u] !== hc[v]) { border.push(arcD[a]); borderLo.push(arcDLow[a]); } else inner.push(arcD[a]);
  }
  borderFull = border.join(''); borderLow = borderLo.join('');
  borderIsLow = false; gBorder.setAttribute('d', borderFull); syncBorder();
  gInner.setAttribute('d', S.showDong ? inner.join('') : '');
  gSido.setAttribute('d', S.showSido ? sidoPath() : '');
  drawSel();
}
// 시도 경계: 행정구역 자체의 경계라 보건소 배정을 바꿔도 그대로다(기본 연결의 시도 기준). 층마다 한 번만 만든다.
function sidoPath() {
  if (L.sidoD === undefined) {
    const so = Array.from({ length: L.n }, (_, i) => defCenter.get(L === A ? A.props[i].g : A.props[A.idx.get(L.props[i].p)].g).sido), out = [];
    for (let a = 0; a < L.arcA.length; a++) { const u = L.arcA[a]; if (u < 0) continue; const v = L.arcB[a]; if (u !== v && so[u] !== so[v]) out.push(L.arcD[a]); }   // 해안선은 보건소 경계선이 이미 그린다
    L.sidoD = out.join('');
  }
  return L.sidoD;
}
function drawSel() { gSel.innerHTML = (editMode && sel) ? hc.map((c, i) => c === sel ? `<path d="${L.d[i]}"/>` : '').join('') : ''; }
function setUnit(kind) {
  if (kind === 'bjd' && !B) B = buildLayer(TOPO_B);
  L = kind === 'bjd' ? B : A; S.unit = kind; $('#unitSel').value = kind;
  gDong.innerHTML = L.d.map((d, i) => `<path data-i="${i}" d="${d}"/>`).join('');
  refresh();
}

// ── 지도 위 글자(제목·범례·출처): 화면과 내보내기에서 같은 조각을 쓴다 ──
const mctx = document.createElement('canvas').getContext('2d');
function legendItems() {
  const Lg = S.legend, b = Lg.breaks, n = b.length - 1, items = [];
  for (let i = 0; i < n; i++) items.push({ c: Lg.colors[i], t: `${fmt(b[i])} 이상 ${fmt(b[i + 1])} ${i === n - 1 ? '이하' : '미만'}` });
  items.push({ c: Lg.noData, t: '자료 없음' });
  return items;
}
function renderOverlay() {
  const cw = stage.clientWidth, ch = stage.clientHeight, Lg = S.legend;
  ov.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  let o = `<g font-family="${FONT}">`;
  if (Lg.title) o += `<text x="18" y="34" font-size="22" font-weight="700" fill="#1b2733">${esc(Lg.title)}</text>`;
  const items = legendItems(); mctx.font = `12px ${FONT}`;
  const head = Lg.unit ? 22 : 0, tw = Math.max(Lg.unit ? mctx.measureText(Lg.unit).width : 0, ...items.map(it => mctx.measureText(it.t).width));
  const w = Math.ceil(tw) + 56, h = 16 + head + items.length * 20, x0 = 14, y0 = ch - h - 14;
  o += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="6" fill="#fff" fill-opacity=".93" stroke="#d9e0e7"/>`;
  if (Lg.unit) o += `<text x="${x0 + 12}" y="${y0 + 22}" font-size="12" font-weight="700" fill="#1b2733">${esc(Lg.unit)}</text>`;
  items.forEach((it, i) => {
    const y = y0 + 12 + head + i * 20;
    o += `<rect x="${x0 + 12}" y="${y}" width="22" height="14" fill="${it.c}" stroke="#8a95a1" stroke-width=".5"/><text x="${x0 + 42}" y="${y + 11}" font-size="12" fill="#1b2733">${esc(it.t)}</text>`;
  });
  o += `<text x="${cw - 10}" y="${ch - 8}" font-size="10" fill="#6b7785" text-anchor="end">${esc(SOURCES[S.unit])}</text></g>`;
  ov.innerHTML = o;
}

// ── 패널: 범례 ──────────────────────────────────────────
function renderLegendPanel() {
  const Lg = S.legend, b = Lg.breaks, n = b.length - 1, counts = new Array(Math.max(n, 0)).fill(0);
  for (const c of usedCenters()) { const k = S.values[c.id] === undefined ? -1 : Core.classify(S.values[c.id], b); if (k >= 0) counts[k]++; }
  $('#ltitle').value = Lg.title; $('#lunit').value = Lg.unit; $('#ln').value = Lg.n; $('#lmode').value = Lg.mode;
  $('#lpal').value = Lg.palette; $('#lrev').checked = Lg.reverse; $('#lnod').value = Lg.noData;
  $('#ltable').innerHTML = n < 1 ? '<tr><td class="hint">값을 올리면 구간이 만들어집니다.</td></tr>' : b.slice(0, n).map((_, i) =>
    `<tr><td><input type="color" data-c="${i}" value="${Lg.colors[i]}"></td><td><input type="number" step="any" data-b="${i}" value="${b[i]}"></td><td>~</td>` +
    `<td>${i < n - 1 ? esc(fmt(b[i + 1])) + ' 미만' : `<input type="number" step="any" data-b="${n}" value="${b[n]}">`}</td><td class="cnt">${counts[i]}곳</td></tr>`).join('');
}

// ── 패널: 배정 ──────────────────────────────────────────
function renderAssignPanel() {
  const cnt = {}; for (const id of hc) cnt[id] = (cnt[id] || 0) + 1;
  const q = $('#csrch').value.trim();
  const list = [...cmap.values()].filter(c => (cnt[c.id] || S.extra.some(e => e.id === c.id)) && (!q || (c.sido + c.name).includes(q))).sort(byRegion);
  let html = '', cur = '';
  for (const c of list) {
    if (c.sido !== cur) { if (cur) html += '</optgroup>'; html += `<optgroup label="${esc(c.sido)}">`; cur = c.sido; }
    html += `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)} (${cnt[c.id] || 0})</option>`;
  }
  $('#csel').innerHTML = html + (cur ? '</optgroup>' : '');
  const c = cmap.get(sel), isExtra = S.extra.some(e => e.id === sel), unitName = L === A ? '행정동' : '법정동';
  $('#cinfo').textContent = c ? `${c.sido} ${c.name} · ${unitName} ${cnt[sel] || 0}개${isExtra ? ' · 새로 만든 보건소' : ''}` : '보건소를 선택하세요.';
  $('#cname').value = c ? c.name : '';
  $('#clist').innerHTML = c ? hc.map((id, i) => id === sel ? esc(unitLabel(i)) : null).filter(Boolean).join('<br>') : '';
  $('#cdel').disabled = !isExtra;
  const nb = Object.keys(S.overridesB).length;
  $('#unitHint').textContent = L === A ? (nb ? `법정동 보기에서 한 보정 ${nb}건은 행정동 보기에 나타나지 않습니다.` : '')
    : '법정동 보기의 배정은 법정동 단위로 저장되며 행정동 보기에는 나타나지 않습니다. (행정동 보기에서 한 배정은 기본값으로 이어집니다)';
  if (!$('#newsido').options.length) $('#newsido').innerHTML = SIDO_ORDER.map(s => `<option>${esc(s)}</option>`).join('');
}

// 값·범례만 바뀔 때는 경계를 다시 만들지 않는다
function refreshColors() { rebuildLegend(false); recolor(); renderLegendPanel(); renderAssignPanel(); renderOverlay(); save(); }
function refresh() { computeHC(); rebuildLegend(false); recolor(); drawMesh(); renderLegendPanel(); renderAssignPanel(); renderOverlay(); save(); }
const msg = (el, t, err) => { const e = $(el); e.textContent = t; e.classList.toggle('err', !!err); };

// ── 데이터 입출력 ───────────────────────────────────────
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
const csvBlob = rows => new Blob(['﻿' + Core.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
const templateRows = () => [['시도', '보건소명', '보건소코드', '값']].concat(usedCenters().map(c => [c.sido, c.name, c.id, S.values[c.id] ?? '']));
async function readTable(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) { const wb = XLSX.read(buf); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); }
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }   // 엑셀 한글 CSV(CP949) 대응
  return Core.parseCSV(text);
}
function applyValues(rows) {
  if (!rows.length) return msg('#dataMsg', '빈 파일입니다.', true);
  const h = rows[0].map(x => String(x).trim());
  let iS = h.findIndex(x => x.includes('시도')), iC = h.findIndex(x => x.includes('코드')),
      iN = h.findIndex(x => /보건소|기관|이름|명/.test(x) && !x.includes('코드') && !x.includes('시도')),
      iV = h.findIndex(x => /값|수치|value/i.test(x)), start = 1;
  if (iN < 0 && iC < 0) { iS = 0; iN = 1; iC = 2; iV = 3; start = 0; }     // 제목줄이 없으면 순서대로
  if (iV < 0) iV = h.length - 1;
  const data = rows.slice(start).map(r => ({ sido: iS < 0 ? '' : r[iS], name: iN < 0 ? '' : r[iN], code: iC < 0 ? '' : r[iC], value: r[iV] }));
  const res = Core.matchRows(data, usedCenters());
  S.values = res.values; refreshColors();
  const v = Object.values(res.values), nd = v.length;
  msg('#dataMsg', nd ? `${nd}개 보건소에 값을 적용했습니다. (최소 ${fmt(Math.min(...v))} / 최대 ${fmt(Math.max(...v))})\n매칭 실패 ${res.unmatched.length}행` : '적용된 값이 없습니다. 열 제목과 보건소 이름을 확인해 주세요.', !nd);
  $('#unmatchedBox').hidden = !res.unmatched.length;
  $('#unmatchedSum').textContent = `매칭 실패 ${res.unmatched.length}행 보기`;
  $('#unmatched').innerHTML = res.unmatched.slice(0, 200).map(r => esc([r.sido, r.name, r.code, r.value].filter(x => x !== '' && x !== undefined).join(' / '))).join('<br>');
}

// 배정표: 행정동 전부 + (법정동 보정이 있으면) 법정동코드가 적힌 줄
function mappingRows() {
  computeHC();
  const rows = [['행정동코드', '행정동명', '보건소코드', '보건소명', '시도', '법정동코드', '법정동명']];
  A.props.forEach((p, i) => { const c = cmap.get(dongHC[i]); rows.push([p.c, dongLabel(i), c.id, c.name, c.sido, '', '']); });
  if (Object.keys(S.overridesB).length) {
    B = B || buildLayer(TOPO_B);
    for (const [code, id] of Object.entries(S.overridesB)) { const i = B.idx.get(code), c = cmap.get(id); if (i !== undefined && c) rows.push(['', '', c.id, c.name, c.sido, code, B.props[i].n]); }
  }
  return rows;
}
function importMapping(rows) {
  const h = (rows[0] || []).map(x => String(x).trim()), ci = n => h.indexOf(n);
  const iD = ci('행정동코드'), iC = ci('보건소코드'), iN = ci('보건소명'), iS = ci('시도'), iB = ci('법정동코드');
  if (iD < 0 || (iC < 0 && iN < 0)) return msg('#assignMsg', "'행정동코드'와 '보건소코드'(또는 '보건소명') 열이 필요합니다.", true);
  S.overrides = {}; S.overridesB = {}; S.extra = []; S.renamed = {};
  const all = allCenters(); let skipped = 0, made = 0; const bRows = [];
  const newId = pref => { if (pref && /^X\d+$/.test(pref) && !all.has(pref)) return pref; let k = 1; while (all.has('X' + String(k).padStart(2, '0'))) k++; return 'X' + String(k).padStart(2, '0'); };
  const centerFor = (r, fallbackSido) => {                       // 코드가 있으면 그 보건소, 없으면 이름으로 새로 만들거나 찾는다
    const name = iN < 0 ? '' : String(r[iN]).trim(); let id = iC < 0 ? '' : String(r[iC]).trim();
    if (!all.has(id)) {
      if (!name) return null;
      const sido = (iS >= 0 && String(r[iS]).trim()) || fallbackSido;
      let ex = S.extra.find(c => c.name === name && c.sido === sido);
      if (!ex) { ex = { id: newId(id), sido, name }; S.extra.push(ex); all.set(ex.id, ex); made++; }
      return ex.id;
    }
    if (name && name !== all.get(id).name) { S.renamed[id] = name; all.get(id).name = name; }
    return id;
  };
  for (const r of rows.slice(1)) {
    if (iB >= 0 && String(r[iB]).trim()) { bRows.push(r); continue; }
    const di = A.idx.get(String(r[iD]).trim()); if (di === undefined) { skipped++; continue; }
    const id = centerFor(r, defCenter.get(A.props[di].g).sido); if (!id) { skipped++; continue; }
    if (id !== A.props[di].g) S.overrides[A.props[di].c] = id;
  }
  if (bRows.length) {
    B = B || buildLayer(TOPO_B);
    for (const r of bRows) {
      const bi = B.idx.get(String(r[iB]).trim()); if (bi === undefined) { skipped++; continue; }
      const pi = A.idx.get(B.props[bi].p), id = centerFor(r, defCenter.get(A.props[pi].g).sido); if (!id) { skipped++; continue; }
      if (id !== (S.overrides[A.props[pi].c] ?? A.props[pi].g)) S.overridesB[B.props[bi].c] = id;
    }
  }
  sel = ''; refresh();
  msg('#assignMsg', `배정표를 불러왔습니다. 새 보건소 ${made}개, 건너뛴 줄 ${skipped}개.`);
}

// ── 배정 편집 ───────────────────────────────────────────
function assign(i) {
  const p = L.props[i], store = L === A ? S.overrides : S.overridesB, def = defaultOf(i), name = L === A ? '행정동' : '법정동';
  if (!sel) return msg('#assignMsg', '먼저 보건소를 선택하세요.', true);
  if (hc[i] === sel) {
    if (def === sel) return msg('#assignMsg', `'${unitLabel(i)}'은(는) 이 보건소의 기본 ${name}입니다. 다른 보건소를 선택해 그쪽으로 넣어 주세요.`, true);
    delete store[p.c];
  } else if (def === sel) delete store[p.c]; else store[p.c] = sel;
  msg('#assignMsg', ''); refresh();
}

// ── 이벤트 ──────────────────────────────────────────────
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
});
$('#tplCsv').onclick = () => download(csvBlob(templateRows()), '보건소_값_양식.csv');
$('#tplXlsx').onclick = () => {
  const rows = templateRows(), ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '값'); XLSX.writeFile(wb, '보건소_값_양식.xlsx');
};
$('#fileVal').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { applyValues(await readTable(f)); } catch (err) { msg('#dataMsg', '파일을 읽지 못했습니다: ' + err.message, true); } };
$('#clearVal').onclick = () => { S.values = {}; S.legend.customColors = false; if (S.legend.mode !== 'custom') S.legend.breaks = []; refreshColors(); msg('#dataMsg', '값을 지웠습니다.'); };
$('#sample').onclick = () => { S.values = {}; for (const c of usedCenters()) S.values[c.id] = Math.round(Math.random() * 1000) / 10; S.legend.mode = 'equal'; rebuildLegend(true); refreshColors(); msg('#dataMsg', `샘플 값(0~100 난수) ${Object.keys(S.values).length}개를 넣었습니다.`); };

$('#ln').innerHTML = [2, 3, 4, 5, 6, 7, 8, 9].map(n => `<option>${n}</option>`).join('');
$('#lpal').innerHTML = Object.keys(PALETTES).map(k => `<option>${k}</option>`).join('');
const legendInput = (id, fn) => $(id).addEventListener('change', e => { fn(e.target); refreshColors(); });
legendInput('#ltitle', t => S.legend.title = t.value); legendInput('#lunit', t => S.legend.unit = t.value);
legendInput('#ln', t => { S.legend.n = +t.value; if (S.legend.mode === 'custom') S.legend.mode = 'equal'; rebuildLegend(true); });
legendInput('#lmode', t => { S.legend.mode = t.value; if (t.value !== 'custom') { S.legend.breaks = []; rebuildLegend(true); } });
legendInput('#lpal', t => { S.legend.palette = t.value; rebuildLegend(true); });
legendInput('#lrev', t => { S.legend.reverse = t.checked; rebuildLegend(true); });
$('#lnod').addEventListener('input', e => { S.legend.noData = e.target.value; recolor(); renderOverlay(); save(); });
$('#ltable').addEventListener('input', e => {
  if (e.target.dataset.c === undefined) return;
  S.legend.colors[+e.target.dataset.c] = e.target.value; S.legend.customColors = true; recolor(); renderOverlay(); save();
});
$('#ltable').addEventListener('change', e => {
  if (e.target.dataset.b === undefined) return;
  const Lg = S.legend, i = +e.target.dataset.b, v = parseFloat(e.target.value), b = Lg.breaks;
  if (!Number.isFinite(v) || (i > 0 && v <= b[i - 1]) || (i < b.length - 1 && v >= b[i + 1])) { renderLegendPanel(); return; }   // 오름차순이 아니면 되돌림
  b[i] = v; Lg.mode = 'custom'; refreshColors();
});

$('#showSido').checked = S.showSido !== false;
$('#showSido').onchange = e => { S.showSido = e.target.checked; refresh(); };
$('#showDong').checked = S.showDong;
$('#showDong').onchange = e => { S.showDong = e.target.checked; refresh(); };
$('#unitSel').onchange = e => setUnit(e.target.value);
$('#fitBtn').onclick = fit;
$('#edit').onchange = e => { editMode = e.target.checked; map.classList.toggle('edit', editMode); drawSel(); };
$('#csrch').oninput = renderAssignPanel;
$('#csel').onchange = e => { sel = e.target.value; renderAssignPanel(); drawSel(); };
$('#crename').onclick = () => {
  const n = $('#cname').value.trim(); if (!sel || !n) return;
  if (S.extra.some(e => e.id === sel)) S.extra.find(e => e.id === sel).name = n; else S.renamed[sel] = n;
  refresh();
};
$('#newbtn').onclick = () => {
  const name = $('#newname').value.trim(); if (!name) return msg('#assignMsg', '보건소 이름을 입력하세요.', true);
  let k = 1; const ids = new Set(S.extra.map(e => e.id)); while (ids.has('X' + String(k).padStart(2, '0'))) k++;
  const c = { id: 'X' + String(k).padStart(2, '0'), sido: $('#newsido').value, name }; S.extra.push(c); sel = c.id; $('#newname').value = '';
  msg('#assignMsg', `'${name}'을(를) 만들었습니다. 편집 모드를 켜고 지도에서 구역을 클릭해 넣으세요.`); refresh();
};
$('#cdel').onclick = () => {
  if (!S.extra.some(e => e.id === sel) || !confirm('이 보건소를 삭제하고 소속 구역을 기본 보건소로 되돌릴까요?')) return;
  for (const o of [S.overrides, S.overridesB]) for (const [d, id] of Object.entries(o)) if (id === sel) delete o[d];
  S.extra = S.extra.filter(e => e.id !== sel); delete S.values[sel]; sel = ''; refresh();
};
$('#mapExport').onclick = () => download(csvBlob(mappingRows()), '보건소_행정동_배정표.csv');
$('#mapImport').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!confirm('지금까지의 배정 편집 내용을 이 파일로 덮어씁니다. 계속할까요?')) return; if (!(await backupFirst('배정표 불러오기'))) return; try { importMapping(await readTable(f)); } catch (err) { msg('#assignMsg', '파일을 읽지 못했습니다: ' + err.message, true); } };
$('#resetEdit').onclick = async () => { if (!confirm('배정·이름 편집을 모두 지우고 기본으로 되돌릴까요?')) return; if (!(await backupFirst('배정 초기화'))) return; S.overrides = {}; S.overridesB = {}; S.extra = []; S.renamed = {}; sel = ''; refresh(); msg('#assignMsg', '초기화했습니다.'); };

// 확대·이동·클릭·툴팁
let drag = null, moved = false;
map.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1 / 1.25 : 1.25, r = map.getBoundingClientRect();
  if ((f < 1 && vb.w < BW / 300) || (f > 1 && vb.w > BW * 3)) return;
  const mx = vb.x + (e.clientX - r.left) / r.width * vb.w, my = vb.y + (e.clientY - r.top) / r.height * vb.h;
  vb.x = mx - (mx - vb.x) * f; vb.y = my - (my - vb.y) * f; vb.w *= f; vb.h *= f; moveVB(true);
}, { passive: false });
map.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; moved = false; });
window.addEventListener('mousemove', e => {
  if (drag) {
    const r = map.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (moved) { vb.x = drag.vx - dx / r.width * vb.w; vb.y = drag.vy - dy / r.height * vb.h; moveVB(false); tip.style.display = 'none'; return; }
  }
  const t = e.target;
  if (t.dataset && t.dataset.i !== undefined && t.parentNode === gDong) {
    const i = +t.dataset.i, c = cmap.get(hc[i]), v = S.values[c.id], k = v === undefined ? -1 : Core.classify(v, S.legend.breaks);
    tip.textContent = `${c.sido} ${c.name}\n값: ${v === undefined ? '없음' : fmt(v) + (S.legend.unit ? ' ' + S.legend.unit : '')}${k >= 0 ? `  (구간 ${k + 1})` : ''}\n` +
      (L === A ? `행정동: ${unitLabel(i)}` : `법정동: ${unitLabel(i)}\n행정동: ${dongLabel(A.idx.get(L.props[i].p))}`);
    const r = stage.getBoundingClientRect(); tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 14, r.height - tip.offsetHeight - 6) + 'px';
  } else tip.style.display = 'none';
});
window.addEventListener('mouseup', () => { drag = null; setTimeout(() => moved = false, 0); });
map.addEventListener('click', e => { if (moved || !editMode || e.target.dataset.i === undefined) return; assign(+e.target.dataset.i); });
map.addEventListener('mouseleave', () => tip.style.display = 'none');
window.addEventListener('resize', () => {
  const cw = stage.clientWidth, ch = stage.clientHeight;
  if (!cw || !ch) return;
  if (!lastCW || !isFinite(vb.w + vb.h + vb.x + vb.y)) { fit(); renderOverlay(); return; }
  const sc = lastCW / vb.w, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
  vb.w = cw / sc; vb.h = ch / sc; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; lastCW = cw; strokesDirty = true; applyVB(); renderOverlay();
});

// 이미지 저장: 지금 화면 그대로(확대 상태·제목·범례 포함)
function composite() {
  const cw = stage.clientWidth, ch = stage.clientHeight, m = map.cloneNode(true);
  m.removeAttribute('id'); m.removeAttribute('class'); m.removeAttribute('style'); m.removeAttribute('shape-rendering');
  m.querySelector('#gSel')?.remove(); m.querySelector('#gInner').removeAttribute('style'); m.querySelector('#gBorder').setAttribute('d', borderFull);
  m.setAttribute('x', 0); m.setAttribute('y', 0); m.setAttribute('width', cw); m.setAttribute('height', ch);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><rect width="${cw}" height="${ch}" fill="#fff"/>${new XMLSerializer().serializeToString(m)}${ov.innerHTML}</svg>`;
  return { svg, cw, ch };
}
$('#svgBtn').onclick = () => download(new Blob([composite().svg], { type: 'image/svg+xml;charset=utf-8' }), '보건소지도.svg');
$('#pngBtn').onclick = () => {
  const { svg, cw, ch } = composite(), img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = cw * 2; c.height = ch * 2; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => download(b, '보건소지도.png')); };
  img.onerror = () => alert('이미지를 만들지 못했습니다. SVG 저장을 이용해 주세요.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};


// ── 저장·이력: index.html 이 있는 폴더에 파일로 쌓는다 (크롬/엣지). 안 되는 브라우저는 다운로드 파일 ──
const FS_OK = typeof window.showDirectoryPicker === 'function';
const META_KEY = 'healthmap.save', AUTO_MS = 15000, AUTO_KEEP = 30, AUTO_NAME = '자동저장', p2 = n => String(n).padStart(2, '0');
let meta = { hash: '', at: '' }; try { Object.assign(meta, JSON.parse(localStorage.getItem(META_KEY) || '{}')); } catch (e) {}
let dir = null, dirState = FS_OK ? 'none' : 'unsupported', saves = [], autoTimer = 0;      // dirState: none | ready | needs(권한 다시 필요) | unsupported
const stateHash = () => JSON.stringify(Core.pickState(S));
const hasWork = () => { const m = Core.summarize(S); return !!(m.values || m.dongEdits || m.bjdEdits || m.newCenters || Object.keys(S.renamed).length || S.legend.title); };
const fmtTime = iso => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hmsg = (t, err) => msg('#histMsg', t, err);
function renderSaveBar() {
  const el = $('#saveState'); if (!el) return;
  const clean = !hasWork(), same = stateHash() === meta.hash;
  el.textContent = clean ? '편집한 내용이 없습니다' : same ? '✓ 저장됨 ' + meta.at : (dirState === 'ready' ? '● 곧 자동 저장됩니다' : '● 저장 안 됨');
  el.className = clean ? '' : same ? 'ok' : 'dirty';
}
function markSaved() { meta = { hash: stateHash(), at: fmtTime(new Date()) }; try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} renderSaveBar(); }
// 폴더가 연결돼 있으면 고친 뒤 15초 조용해질 때 한 벌을 자동으로 쌓는다(자동 저장본은 최근 30개만 남김)
function scheduleAuto() {
  clearTimeout(autoTimer);
  if (dirState !== 'ready' || !hasWork() || stateHash() === meta.hash) return;
  autoTimer = setTimeout(() => { if (dirState === 'ready' && hasWork() && stateHash() !== meta.hash) saveSnapshot(AUTO_NAME, true, true); }, AUTO_MS);
}

const idb = () => new Promise((res, rej) => { const r = indexedDB.open('healthmap', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); };

async function listSaves() {
  saves = [];
  try {
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !/^보건소지도_.*\.json$/.test(name)) continue;
      const snap = Core.parseSnapshot(await (await h.getFile()).text());
      if (snap) saves.push({ file: name, snap });
    }
    saves.sort((a, b) => b.snap.savedAt.localeCompare(a.snap.savedAt));
  } catch (e) { dirState = e.name === 'NotFoundError' ? 'none' : 'needs'; }
}
async function useDir(h) { dir = h; dirState = 'ready'; try { await idbSet('dir', h); } catch (e) {} await listSaves(); renderHistory(); scheduleAuto(); }
async function pickDir() {
  try { await useDir(await window.showDirectoryPicker({ id: 'healthmap', mode: 'readwrite' })); }
  catch (e) { if (e.name !== 'AbortError') hmsg(e.name === 'SecurityError' ? '브라우저가 막아 둔 폴더입니다(바탕화면·문서·다운로드 폴더 자체 등). 그 안에 새 폴더를 만들고 index.html을 옮긴 뒤 그 폴더를 골라 주세요.' : '폴더를 열지 못했습니다: ' + e.message, true); }
}
async function reconnect() {
  try { if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') { dirState = 'ready'; await listSaves(); } } catch (e) {}
  renderHistory(); scheduleAuto(); return dirState === 'ready';
}
async function initDir() {
  if (!FS_OK) return renderHistory();
  try { const h = await idbGet('dir'); if (h) { dir = h; dirState = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ready' : 'needs'; if (dirState === 'ready') await listSaves(); } } catch (e) {}
  renderHistory(); scheduleAuto();
}
const fileExists = async n => { try { await dir.getFileHandle(n); return true; } catch (e) { return false; } };

// 지금 상태를 저장. 성공하면 true. auto=사람이 누르지 않은 저장, markDone=저장 표시까지 할지(자동저장)
async function saveSnapshot(name, auto, markDone) {
  const now = new Date(), snap = Core.makeSnapshot(Core.pickState(S), name, auto, now);
  try {
    if (!FS_OK) { download(new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' }), Core.snapshotFileName(now, name)); if (!auto) markSaved(); return true; }
    if (!dir) { await pickDir(); if (!dir) return false; }
    if (dirState === 'needs' && !(await reconnect())) return false;
    let fname = Core.snapshotFileName(now, name), k = 2;
    while (await fileExists(fname)) fname = fname.replace(/(-\d+)?\.json$/, `-${k++}.json`);
    const w = await (await dir.getFileHandle(fname, { create: true })).createWritable();
    await w.write(JSON.stringify(snap, null, 1)); await w.close();
    if (!auto || markDone) markSaved();
    await listSaves();
    const autos = saves.filter(x => x.snap.auto && x.snap.name === AUTO_NAME);
    if (autos.length > AUTO_KEEP) { for (const x of autos.slice(AUTO_KEEP)) { try { await dir.removeEntry(x.file); } catch (e) {} } await listSaves(); }
    renderHistory(); return true;
  } catch (e) { if (!auto) alert('저장하지 못했습니다: ' + e.message); else { dirState = 'needs'; renderHistory(); } return false; }
}
// 지우거나 덮어쓰기 전에: 저장 안 된 작업이 있으면 자동백업(폴더 있을 때) 또는 확인
async function backupFirst(why) {
  if (!hasWork() || stateHash() === meta.hash) return true;
  if (FS_OK && dir && dirState === 'ready') return saveSnapshot(`자동백업(${why} 전)`, true);
  return confirm('저장하지 않은 작업이 있는데 저장 폴더가 없어 되돌릴 수 없습니다. 계속할까요?');
}
function applyState(st) {
  const d = Core.pickState(st);
  Object.assign(S, { values: {}, overrides: {}, overridesB: {}, extra: [], renamed: {}, showDong: true, showSido: true, unit: 'dong' }, d);
  S.legend = Object.assign(newLegend(), d.legend);
  sel = ''; $('#showDong').checked = S.showDong; $('#showSido').checked = S.showSido; setUnit(S.unit === 'bjd' ? 'bjd' : 'dong');
}
async function restore(snap) {
  const label = snap.name || fmtTime(snap.savedAt);
  if (!confirm(`'${label}' 저장본을 불러올까요?\n지금 작업이 저장돼 있지 않으면 자동백업으로 남깁니다.`)) return;
  if (!(await backupFirst('불러오기'))) return;
  applyState(snap.state); markSaved(); hmsg(`'${label}'을(를) 불러왔습니다.`);
}
async function quickSave() {
  const name = $('#saveName').value.trim();
  if (await saveSnapshot(name, false)) { $('#saveName').value = ''; hmsg(FS_OK ? '저장했습니다. 아래 이력에 쌓였습니다.' : '저장 파일을 내려받았습니다.'); }
}
function renderHistory() {
  $('#histGuide').textContent = FS_OK ? '처음 한 번만 index.html이 들어 있는 폴더를 골라 주세요. 그 뒤로는 고치는 대로 그 폴더에 저장 파일이 자동으로 쌓이고, 아래 이력에서 예전 상태로 되돌릴 수 있습니다. (브라우저를 껐다 켜면 폴더 연결을 한 번 다시 눌러야 합니다)'
    : '이 브라우저는 폴더 저장을 지원하지 않아, 저장할 때마다 파일이 다운로드 폴더에 생깁니다. 크롬이나 엣지를 쓰면 폴더에 자동으로 쌓이고 이력 목록도 볼 수 있습니다.';
  $('#dirInfo').textContent = { none: '아직 연결하지 않았습니다. [폴더 연결]을 누르고 index.html이 들어 있는 폴더를 골라 주세요.', ready: `📁 ${dir && dir.name} (연결됨 · 자동 저장 켜짐)`, needs: `📁 ${dir && dir.name} — 연결이 풀렸습니다. [폴더 다시 연결]을 눌러 주세요.`, unsupported: '지원하지 않는 브라우저입니다.' }[dirState];
  $('#dirPick').hidden = !FS_OK; $('#dirPick').textContent = dir ? '폴더 바꾸기' : '폴더 연결'; $('#dirReconnect').hidden = dirState !== 'needs';
  $('#histList').innerHTML = dirState !== 'ready' ? `<div class="hint">${FS_OK ? '폴더가 연결되면 저장 이력이 여기에 나옵니다.' : '저장 파일은 아래 [저장 파일 직접 불러오기]로 불러오세요.'}</div>`
    : !saves.length ? '<div class="hint">아직 저장한 기록이 없습니다.</div>'
    : saves.map((x, i) => { const m = x.snap.summary || {}; return `<div class="hist"><div class="t">${esc(x.snap.name || '이름 없음')}${x.snap.auto ? '<span class="tag">자동</span>' : ''}</div>` +
        `<div class="s">${fmtTime(x.snap.savedAt)} · 값 ${m.values || 0}개 · 배정 변경 ${(m.dongEdits || 0) + (m.bjdEdits || 0)}건${m.newCenters ? ` · 새 보건소 ${m.newCenters}` : ''}</div>` +
        `<button class="btn b" data-act="load" data-i="${i}">불러오기</button> <button class="btn b" data-act="del" data-i="${i}">삭제</button></div>`; }).join('');
  renderSaveBar();
}
$('#histList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const x = saves[+b.dataset.i]; if (!x) return;
  if (b.dataset.act === 'load') return restore(x.snap);
  if (!confirm(`'${x.snap.name || fmtTime(x.snap.savedAt)}' 저장본을 삭제할까요? (되돌릴 수 없습니다)`)) return;
  try { await dir.removeEntry(x.file); await listSaves(); renderHistory(); } catch (err) { hmsg('삭제하지 못했습니다: ' + err.message, true); }
});
$('#dirPick').onclick = pickDir; $('#dirReconnect').onclick = reconnect;
$('#saveBtn').onclick = quickSave; $('#saveNow').onclick = quickSave;
$('#histFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const snap = Core.parseSnapshot(await f.text()); if (!snap) return hmsg('이 프로그램의 저장 파일이 아닙니다.', true);
  restore(snap);
};
$('#resetAll').onclick = async () => {
  if (!confirm('값·범례·배정 편집을 모두 지우고 처음 상태로 돌릴까요?')) return;
  if (!(await backupFirst('초기화'))) return;
  applyState({}); meta = { hash: '', at: '' }; renderSaveBar(); hmsg('처음 상태로 돌렸습니다.' + (dirState === 'ready' ? ' 이전 작업은 이력에 자동백업으로 남아 있습니다.' : ''));
};
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); quickSave(); } });
initDir();
fit(); setUnit(S.unit === 'bjd' ? 'bjd' : 'dong');
window.__hm = { useDir, saveSnapshot, applyState, get saves() { return saves; }, get meta() { return meta; }, AUTO_MS, S, A, get B() { return B; }, get L() { return L; }, get hc() { return hc; }, get cmap() { return cmap; }, setUnit };   // 점검용
})();
