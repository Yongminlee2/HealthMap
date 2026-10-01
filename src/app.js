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
// 선(경계선)만 배율에 따라 점 수를 줄인다: 전국이 한눈에 보이는 배율에서는 0.7px 안쪽으로 붙은 점을 버리고, 확대하면 원래대로. 채움은 항상 원본.
// 레벨 l 의 허용 오차 LOD_TOL[l](지도 단위)와, 그 레벨을 쓰는 화면 배율 하한 LOD_T[l-1](px/단위). 어느 레벨이든 화면에서 오차는 0.6px 이하.
const LOD_TOL = [0, 0.5, 0.8, 1.5, 2.5], LOD_T = [1.0, 0.7, 0.4, 0.25];
// 호의 점을 줄인다(Douglas–Peucker): 끝점은 항상 남겨서 이웃 호와 이어지는 점이 어긋나지 않는다. 남길 점의 번호를 돌려준다.
function rdpKeep(p, eps) {
  const n = p.length, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop(); if (b - a < 2) continue;
    const dx = p[b][0] - p[a][0], dy = p[b][1] - p[a][1], len = Math.hypot(dx, dy) || 1e-9; let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - p[a][0]) * dy - (p[i][1] - p[a][1]) * dx) / len; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i); return out;
}
function buildLayer(topo) {
  const geoms = Object.values(topo.objects)[0].geometries, tr = topo.transform;
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  const lodPts = LOD_TOL.slice(1).map(() => []);
  const arcPts = topo.arcs.map(a => {
    let x = 0, y = 0; const P = [];
    const pts = a.map(q => {
      x += q[0]; y += q[1];
      const X = (x * tr.scale[0] + tr.translate[0] - LON0) * KX, Y = (LAT0 - (y * tr.scale[1] + tr.translate[1])) * KY;
      if (X < mnx) mnx = X; if (X > mxx) mxx = X; if (Y < mny) mny = Y; if (Y > mxy) mxy = Y;
      P.push([X, Y]);
      return X.toFixed(1) + ' ' + Y.toFixed(1);
    });
    lodPts.forEach((set, l) => set.push(rdpKeep(P, LOD_TOL[l + 1]).map(i => pts[i])));
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
  return { n: geoms.length, props, d, arcDL: [arcPts, ...lodPts].map(set => set.map(p => 'M' + p.join('L'))), arcA, arcB, idx: new Map(props.map((p, i) => [p.c, i])), bbox: [mnx, mny, mxx, mxy] };
}
const A = buildLayer(TOPO);                                    // 행정동: props {c 코드, n 이름, g 기본 보건소코드}
let B = null, L = A;                                           // 법정동은 처음 쓸 때 만든다: props {c, n, p 소속 행정동코드}
const defCenter = new Map(CENTERS.map(c => [c.id, c]));

// ── 상태 ────────────────────────────────────────────────
const LS = 'healthmap.v2';
const newLegend = () => ({ title: '', unit: '', n: 5, mode: 'equal', palette: '파랑', reverse: false, breaks: [], colors: [], customColors: false, noData: '#e3e7eb' });
const newLines = () => ({ border: '#2b3440', sido: '#0b1220', inner: '#ffffff' });
const S = { values: {}, overrides: {}, overridesB: {}, extra: [], renamed: {}, showDong: true, showSido: true, unit: 'dong', legend: newLegend(), lines: newLines() };
try { const d = JSON.parse(localStorage.getItem(LS) || '{}'); Object.assign(S, d); S.legend = Object.assign(newLegend(), d.legend); S.lines = Object.assign(newLines(), d.lines); } catch (e) {}
let sel = '', editMode = false, dongHC = [], hc = [], cmap = new Map();
const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} renderSaveBar(); };

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
// 시도까지 붙인 전체 주소("경기도 수원시 장안구 파장동"): 툴팁에서 같은 이름의 구·동을 구분하려고
const dongAddr = i => { const t = A.props[i].n.split(' '); return [t[0], t[1].replace(/^(.+?시)(.+구)$/, '$1 $2'), ...t.slice(2)].join(' '); };
const unitLabel = i => L === A ? dongLabel(i) : A.props[A.idx.get(L.props[i].p)].n.split(' ')[1] + ' ' + L.props[i].n;

// ── 지도 그리기 ─────────────────────────────────────────
const map = $('#map'), ov = $('#overlay'), stage = $('#stage'), tip = $('#tip');
map.innerHTML = '<g id="gFill" fill-rule="evenodd"></g><g id="gDong" fill="none" pointer-events="all"></g><g id="gSel" fill="#ff8a00" fill-opacity=".55" stroke="none" pointer-events="none"></g>' +
  '<path id="gInner" fill="none" stroke="#fff" stroke-linejoin="round" pointer-events="none"/>' +
  '<path id="gBorder" fill="none" stroke="#2b3440" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>' +
  '<path id="gSido" fill="none" stroke="#0b1220" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>';
const gFill = $('#gFill'), gDong = $('#gDong'), gSel = $('#gSel'), gInner = $('#gInner'), gBorder = $('#gBorder'), gSido = $('#gSido');
const [minX, minY, maxX, maxY] = A.bbox, BW = maxX - minX, BH = maxY - minY;
const coreBox = (() => {                                       // 단위 경로의 첫 점을 모아 1~99% 구간 = 본토+제주(먼 섬 제외)
  const xs = [], ys = []; for (const d of A.d) { const m = /(-?[\d.]+) (-?[\d.]+)/.exec(d); xs.push(+m[1]); ys.push(+m[2]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  return [q(xs, 0.01), q(ys, 0.01), q(xs, 0.99), q(ys, 0.99)];
})();
let vb = { x: 0, y: 0, w: 1, h: 1 }, lastCW = 0, strokesDirty = true, lod = 0;
let vbQueued = false;

function pickLod(sc) {                                         // 경계에서 왔다 갔다 하지 않게 10% 여유를 둔다
  let l = lod;
  while (l > 0 && sc >= LOD_T[l - 1] * 1.1) l--;
  while (l < LOD_T.length && sc < LOD_T[l] * 0.9) l++;
  return l;
}
function applyVB() {
  map.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  if (strokesDirty) {                                          // 선 굵기는 화면 기준 px 로 맞춘다(확대할 때만 다시 계산)
    const sc = stage.clientWidth / vb.w;
    const nl = pickLod(sc); if (nl !== lod) { lod = nl; drawLines(); }
    gBorder.setAttribute('stroke-width', (1.4 / sc).toFixed(3)); gInner.setAttribute('stroke-width', (0.5 / sc).toFixed(3)); gSido.setAttribute('stroke-width', (2.6 / sc).toFixed(3));
    strokesDirty = false;
  }
}
function queueVB(zoomed) {                                     // 휠·드래그가 몰려도 프레임당 한 번만 그린다
  if (zoomed) strokesDirty = true;
  if (!vbQueued) { vbQueued = true; requestAnimationFrame(() => { vbQueued = false; applyVB(); }); }
}
// 처음 위치: 본토(울릉·독도 같은 먼 섬 제외)가 화면 정중앙에 오고, 먼 섬도 잘리지 않는 배율로 맞춘다
function fit() {
  const cw = stage.clientWidth, ch = stage.clientHeight, pad = 24;   // pad: 가장자리 여백(화면 px)
  if (!cw || !ch) return;                                      // 창이 접혀 크기가 0일 때는 건드리지 않는다
  const cx = (coreBox[0] + coreBox[2]) / 2, cy = (coreBox[1] + coreBox[3]) / 2;
  const halfW = Math.max(cx - minX, maxX - cx), halfH = Math.max(cy - minY, maxY - cy);
  const sc = Math.min((cw - 2 * pad) / (2 * halfW), (ch - 2 * pad) / (2 * halfH));
  vb.w = cw / sc; vb.h = ch / sc; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
  lastCW = cw; strokesDirty = true; applyVB();
}
function zoomBy(f) {                                           // 화면 가운데 기준 확대(f<1) / 축소(f>1)
  const wNext = vb.w * f; if ((f < 1 && wNext < BW / 300) || (f > 1 && wNext > BW * 3)) return;
  const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w = wNext; vb.h *= f; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; queueVB(true);
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
// 보건소 하나 = 경로 하나로 합쳐 칠한다(동마다 따로 칠하면 이웃 동 사이에 가는 실선이 비친다). 동 경로(gDong)는 보이지 않는 클릭·툴팁용.
function rebuildFills() {
  const by = new Map();
  hc.forEach((c, i) => { if (!by.has(c)) by.set(c, []); by.get(c).push(L.d[i]); });
  gFill.innerHTML = [...by].map(([c, ds]) => `<path data-c="${c}" d="${ds.join('')}"/>`).join('');
}
function recolor() { for (const el of gFill.children) el.setAttribute('fill', colorOf(el.dataset.c)); }
function drawLines() {
  const border = [], inner = [], { arcA, arcB } = L, arcD = L.arcDL[lod];
  for (let a = 0; a < arcA.length; a++) {
    const u = arcA[a]; if (u < 0) continue;
    const v = arcB[a];
    (u === v || hc[u] !== hc[v] ? border : inner).push(arcD[a]);
  }
  gBorder.setAttribute('d', border.join(''));
  gInner.setAttribute('d', S.showDong ? inner.join('') : '');
  gSido.setAttribute('d', S.showSido ? sidoPath() : '');
}
function drawMesh() { drawLines(); drawSel(); }
function sidoPath() {
  L.sidoDs = L.sidoDs || [];
  if (L.sidoDs[lod] === undefined) {
    const so = Array.from({ length: L.n }, (_, i) => defCenter.get(L === A ? A.props[i].g : A.props[A.idx.get(L.props[i].p)].g).sido), out = [];
    for (let a = 0; a < L.arcA.length; a++) { const u = L.arcA[a]; if (u < 0) continue; const v = L.arcB[a]; if (u !== v && so[u] !== so[v]) out.push(L.arcDL[lod][a]); }   // 해안선은 보건소 경계선이 이미 그린다
    L.sidoDs[lod] = out.join('');
  }
  return L.sidoDs[lod];
}
let flash = false, flashTimer = 0;
function drawSel() { gSel.innerHTML = ((editMode || flash) && sel) ? hc.map((c, i) => c === sel ? `<path d="${L.d[i]}"/>` : '').join('') : ''; }
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
function refresh() { computeHC(); applyLines(); rebuildLegend(false); rebuildFills(); recolor(); drawMesh(); renderLegendPanel(); renderAssignPanel(); renderOverlay(); save(); }
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
  msg('#dataMsg', nd ? `${nd}개 보건소에 값을 적용했습니다. (최소 ${fmt(Math.min(...v))} / 최대 ${fmt(Math.max(...v))})\n매칭 실패 ${res.unmatched.length}행\n→ [범례] 탭에서 구간과 색을 바꿀 수 있습니다.` : '적용된 값이 없습니다. 열 제목과 보건소 이름을 확인해 주세요.', !nd);
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

// 경계선 색: 직접 고르거나 자주 쓰는 색을 눌러 바꾼다
const LINE_DEFS = [['border', '보건소 경계선'], ['sido', '시도 경계선'], ['inner', '세부 경계선(동)']];
const LINE_PRESETS = [['#111827', '검정'], ['#2b3440', '진회색'], ['#6b7785', '회색'], ['#ffffff', '흰색'], ['#d1242f', '빨강'], ['#1f6feb', '파랑']];
$('#lineColors').innerHTML = LINE_DEFS.map(([k, t]) => `<div class="lrow"><span>${t}</span><input type="color" data-k="${k}">` +
  LINE_PRESETS.map(([c, n]) => `<button class="sw" data-k="${k}" data-c="${c}" title="${n}" style="background:${c}"></button>`).join('') + '</div>').join('') +
  '<div class="row"><button class="btn" id="lineReset">경계선 색 기본값으로</button></div>';
function applyLines() {
  gBorder.setAttribute('stroke', S.lines.border); gInner.setAttribute('stroke', S.lines.inner); gSido.setAttribute('stroke', S.lines.sido);
  for (const i of $('#lineColors').querySelectorAll('input[type=color]')) i.value = S.lines[i.dataset.k];
}
$('#lineColors').addEventListener('input', e => { if (e.target.dataset.k && e.target.type === 'color') { S.lines[e.target.dataset.k] = e.target.value; applyLines(); save(); } });
$('#lineColors').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'lineReset') S.lines = newLines(); else if (b.dataset.k) S.lines[b.dataset.k] = b.dataset.c; else return;
  applyLines(); save();
});
$('#showSido').checked = S.showSido !== false;
$('#showSido').onchange = e => { S.showSido = e.target.checked; refresh(); };
$('#showDong').checked = S.showDong;
$('#showDong').onchange = e => { S.showDong = e.target.checked; refresh(); };
$('#unitSel').onchange = e => setUnit(e.target.value);
$('#fitBtn').onclick = fit; $('#zoomIn').onclick = () => zoomBy(1 / 1.5); $('#zoomOut').onclick = () => zoomBy(1.5);
$('#edit').onchange = e => { editMode = e.target.checked; map.classList.toggle('edit', editMode); drawSel(); };
function zoomToSel() {
  if (!sel) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  hc.forEach((c, i) => { if (c !== sel) return; for (const m of L.d[i].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) { const x = +m[1], y = +m[2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } });
  if (x0 > x1) return;
  const cw = stage.clientWidth, ch = stage.clientHeight; if (!cw || !ch) return;
  const bw = Math.max(x1 - x0, 20) * 1.5, bh = Math.max(y1 - y0, 20) * 1.5, sc = Math.min(cw / bw, ch / bh, cw / (BW / 300));
  vb.w = cw / sc; vb.h = ch / sc; vb.x = (x0 + x1) / 2 - vb.w / 2; vb.y = (y0 + y1) / 2 - vb.h / 2; strokesDirty = true; applyVB();
  flash = true; drawSel(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = false; drawSel(); }, 3000);
}
$('#zoomSel').onclick = zoomToSel; $('#csel').ondblclick = zoomToSel;
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
$('#mapImport').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!confirm('지금까지의 배정 편집 내용을 이 파일로 덮어씁니다. 계속할까요?')) return; if (!guardUnsaved('배정표 불러오기')) return; try { importMapping(await readTable(f)); } catch (err) { msg('#assignMsg', '파일을 읽지 못했습니다: ' + err.message, true); } };
$('#resetEdit').onclick = async () => { if (!confirm('배정·이름 편집을 모두 지우고 기본으로 되돌릴까요?')) return; if (!guardUnsaved('배정 초기화')) return; S.overrides = {}; S.overridesB = {}; S.extra = []; S.renamed = {}; sel = ''; refresh(); msg('#assignMsg', '초기화했습니다.'); };

// 확대·이동·클릭·툴팁
let drag = null, moved = false;
map.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY), f = Math.exp(Math.max(-120, Math.min(120, dy)) * 0.002), r = map.getBoundingClientRect();
  if ((f < 1 && vb.w * f < BW / 300) || (f > 1 && vb.w * f > BW * 3)) return;
  const mx = vb.x + (e.clientX - r.left) / r.width * vb.w, my = vb.y + (e.clientY - r.top) / r.height * vb.h;
  vb.x = mx - (mx - vb.x) * f; vb.y = my - (my - vb.y) * f; vb.w *= f; vb.h *= f; queueVB(true);
}, { passive: false });
map.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; moved = false; });
window.addEventListener('mousemove', e => {
  if (drag) {
    const r = map.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (moved) { vb.x = drag.vx - dx / r.width * vb.w; vb.y = drag.vy - dy / r.height * vb.h; queueVB(false); tip.style.display = 'none'; return; }
  }
  const t = e.target;
  if (t.dataset && t.dataset.i !== undefined && t.parentNode === gDong) {
    const i = +t.dataset.i, c = cmap.get(hc[i]), v = S.values[c.id], k = v === undefined ? -1 : Core.classify(v, S.legend.breaks);
    tip.textContent = `${c.sido} ${c.name}\n값: ${v === undefined ? '없음' : fmt(v) + (S.legend.unit ? ' ' + S.legend.unit : '')}${k >= 0 ? `  (구간 ${k + 1})` : ''}\n` +
      (L === A ? `행정동: ${dongAddr(i)}` : `법정동: ${L.props[i].n}\n행정동: ${dongAddr(A.idx.get(L.props[i].p))}`);
    const r = stage.getBoundingClientRect(); tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 14, r.height - tip.offsetHeight - 6) + 'px';
  } else tip.style.display = 'none';
});
window.addEventListener('mouseup', () => { drag = null; setTimeout(() => moved = false, 0); });
map.addEventListener('click', e => {
  if (moved) return;
  if (e.target.dataset.i === undefined) return closePop();
  if (editMode) assign(+e.target.dataset.i); else openPop(+e.target.dataset.i, e);
});
// 지도에서 보건소를 클릭해 값을 바로 입력
const pop = $('#valpop'); let popCenter = '';
function closePop() { pop.hidden = true; popCenter = ''; }
function openPop(i, e) {
  const c = cmap.get(hc[i]); if (!c) return; popCenter = c.id;
  $('#vpName').textContent = `${c.sido} ${c.name}`; $('#vpInput').value = S.values[c.id] ?? '';
  const r = stage.getBoundingClientRect(); pop.hidden = false;
  pop.style.left = Math.max(6, Math.min(e.clientX - r.left + 10, r.width - 262)) + 'px'; pop.style.top = Math.max(6, Math.min(e.clientY - r.top + 10, r.height - 100)) + 'px';
  $('#vpInput').focus(); $('#vpInput').select();
}
function commitPop(clear) {
  if (!popCenter) return;
  const v = parseFloat($('#vpInput').value);
  if (clear || !Number.isFinite(v)) delete S.values[popCenter]; else S.values[popCenter] = v;
  closePop(); refreshColors();
}
$('#vpOk').onclick = () => commitPop(false); $('#vpClear').onclick = () => commitPop(true);
$('#vpInput').addEventListener('keydown', e => { if (e.key === 'Enter') commitPop(false); else if (e.key === 'Escape') closePop(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
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
  const keepLod = lod; if (keepLod) { lod = 0; drawLines(); }                  // 내보내는 이미지는 선도 원본 점으로
  const cw = stage.clientWidth, ch = stage.clientHeight, m = map.cloneNode(true);
  m.removeAttribute('id'); m.removeAttribute('class'); m.removeAttribute('style');
  m.querySelector('#gSel')?.remove(); m.querySelector('#gDong').remove();
  m.setAttribute('x', 0); m.setAttribute('y', 0); m.setAttribute('width', cw); m.setAttribute('height', ch);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><rect width="${cw}" height="${ch}" fill="#fff"/>${new XMLSerializer().serializeToString(m)}${ov.innerHTML}</svg>`;
  if (keepLod) { lod = keepLod; drawLines(); }
  return { svg, cw, ch };
}
$('#svgBtn').onclick = () => download(new Blob([composite().svg], { type: 'image/svg+xml;charset=utf-8' }), '보건소지도.svg');
$('#pngBtn').onclick = () => {
  const { svg, cw, ch } = composite(), img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = cw * 2; c.height = ch * 2; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => download(b, '보건소지도.png')); };
  img.onerror = () => alert('이미지를 만들지 못했습니다. SVG 저장을 이용해 주세요.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};


// ── 저장·이력: 사용자가 [저장]을 누를 때만 브라우저(localStorage)의 이력에 쌓는다(자동 저장 없음) ──
const HIST_KEY = 'healthmap.hist', META_KEY = 'healthmap.save', p2 = n => String(n).padStart(2, '0');
let meta = { hash: '', at: '' }, hist = [];                         // hist: 최신순
try { Object.assign(meta, JSON.parse(localStorage.getItem(META_KEY) || '{}')); hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) {}
const stateHash = () => JSON.stringify(Core.pickState(S));
const hasWork = () => { const m = Core.summarize(S); return !!(m.values || m.dongEdits || m.bjdEdits || m.newCenters || Object.keys(S.renamed).length || S.legend.title); };
const fmtTime = iso => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hmsg = (t, err) => msg('#histMsg', t, err);
function renderSaveBar() {
  const el = $('#saveState'); if (!el) return;
  const clean = !hasWork(), same = stateHash() === meta.hash;
  el.textContent = clean ? '편집한 내용이 없습니다' : same ? '✓ 저장됨 ' + meta.at : '● 저장 안 됨';
  el.className = clean ? '' : same ? 'ok' : 'dirty';
}
function markSaved() { meta = { hash: stateHash(), at: fmtTime(new Date()) }; try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} renderSaveBar(); }
function writeHist() { try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); return true; } catch (e) { return false; } }
function addSnapshot(name) {
  hist.unshift(Core.makeSnapshot(Core.pickState(S), name, false, new Date()));
  if (!writeHist()) { hist.shift(); alert('브라우저 저장 공간이 부족합니다. 저장 이력에서 오래된 저장본을 삭제해 주세요.'); return false; }
  markSaved(); renderHistory(); return true;
}
// 지우거나 덮어쓰기 전에: 저장 안 된 작업이 있으면 먼저 저장할지 묻는다. 계속해도 되면 true
function guardUnsaved(why) {
  if (!hasWork() || stateHash() === meta.hash) return true;
  if (confirm(`저장하지 않은 작업이 있습니다. ${why} 전에 지금 상태를 저장할까요?\n[확인] 저장하고 계속   [취소] 저장하지 않고 계속할지 다시 묻기`)) return addSnapshot(`${why} 전 저장`);
  return confirm('저장하지 않고 계속할까요? 지금 작업은 사라집니다.');
}
function applyState(st) {
  const d = Core.pickState(st);
  Object.assign(S, { values: {}, overrides: {}, overridesB: {}, extra: [], renamed: {}, showDong: true, showSido: true, unit: 'dong' }, d);
  S.legend = Object.assign(newLegend(), d.legend); S.lines = Object.assign(newLines(), d.lines);
  sel = ''; $('#showDong').checked = S.showDong; $('#showSido').checked = S.showSido; setUnit(S.unit === 'bjd' ? 'bjd' : 'dong');
}
function restore(snap) {
  const label = snap.name || fmtTime(snap.savedAt);
  if (!confirm(`'${label}' 저장본을 불러올까요?`) || !guardUnsaved('불러오기')) return;
  applyState(snap.state); markSaved(); hmsg(`'${label}'을(를) 불러왔습니다.`);
}
function quickSave() {
  const name = $('#saveName').value.trim();
  if (addSnapshot(name)) { $('#saveName').value = ''; hmsg('저장했습니다. 아래 이력에 쌓였습니다.'); }
}
function renderHistory() {
  $('#histGuide').textContent = '자동으로 저장되지 않습니다. 위쪽 [저장](Ctrl+S)을 누를 때마다 그때 상태가 아래 이력에 쌓이고, 이력에서 언제든 그때 상태로 되돌릴 수 있습니다. (작업 중인 내용은 새로고침해도 이 브라우저에 남아 있지만 이력에는 저장한 것만 쌓입니다.) 이력은 이 브라우저 안에 저장되므로 브라우저 데이터를 지우면 함께 사라집니다.';
  $('#histList').innerHTML = !hist.length ? '<div class="hint">아직 저장한 기록이 없습니다.</div>'
    : hist.map((x, i) => { const m = x.summary || {}; return `<div class="hist"><div class="t">${esc(x.name || '이름 없음')}</div>` +
        `<div class="s">${fmtTime(x.savedAt)} · 값 ${m.values || 0}개 · 배정 변경 ${(m.dongEdits || 0) + (m.bjdEdits || 0)}건${m.newCenters ? ` · 새 보건소 ${m.newCenters}` : ''}</div>` +
        `<button class="btn b" data-act="load" data-i="${i}">불러오기</button> <button class="btn b" data-act="del" data-i="${i}">삭제</button></div>`; }).join('');
  renderSaveBar();
}
$('#histList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const x = hist[+b.dataset.i]; if (!x) return;
  if (b.dataset.act === 'load') return restore(x);
  if (!confirm(`'${x.name || fmtTime(x.savedAt)}' 저장본을 삭제할까요? (되돌릴 수 없습니다)`)) return;
  hist.splice(+b.dataset.i, 1); writeHist(); renderHistory();
});
$('#saveBtn').onclick = quickSave; $('#saveNow').onclick = quickSave;
$('#resetAll').onclick = () => {
  if (!confirm('값·범례·배정 편집을 모두 지우고 처음 상태로 돌릴까요?')) return;
  if (!guardUnsaved('초기화')) return;
  applyState({}); meta = { hash: '', at: '' }; renderSaveBar(); hmsg('처음 상태로 돌렸습니다.' + (hist.length ? ' 저장해 둔 이력은 그대로 있습니다.' : ''));
};
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); quickSave(); } });
renderHistory();
fit(); setUnit(S.unit === 'bjd' ? 'bjd' : 'dong');
window.__hm = { addSnapshot, applyState, get hist() { return hist; }, get meta() { return meta; }, S, A, get B() { return B; }, get L() { return L; }, get hc() { return hc; }, get cmap() { return cmap; }, setUnit };   // 점검용
})();
