// 무작위 조작 점검(브라우저 콘솔에서 실행): `await fuzz(seed, steps)` 를 부르면 { steps, bad: [] } 를 돌려준다.
// 쓰는 법: const src = await (await fetch('/tests/browser-fuzz.js')).text(); (0, eval)(src); await fuzz(1, 150)
// 매 단계 뒤에 검사: 오류 없음 / 육각 겹침 없음 / 화면 위치 = 계산 위치 / 색이 값·범례와 일치 / 저장→불러오기 왕복이 같은 상태.
window.fuzz = async function (seed, steps) {
  const H = window.__hm, S = H.S, $ = s => document.querySelector(s), bad = [], log = [], st = {};
  let rs = seed >>> 0; const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  window.confirm = () => true; window.alert = m => bad.push('alert: ' + m);
  const errs = []; const onErr = e => errs.push(e.message); window.addEventListener('error', onErr);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const map = $('#map'), norm = c => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; };
  const ev = (t, x, y, tgt = window) => tgt.dispatchEvent(new MouseEvent(t, { clientX: Math.round(x), clientY: Math.round(y), bubbles: true, button: 0 }));
  const chg = (s, v) => { const e = $(s); if (v !== undefined) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } e.dispatchEvent(new Event('change', { bubbles: true })); };
  const tool = v => { const r = document.querySelector(`input[name=hexTool][value=${v}]`); r.checked = true; r.dispatchEvent(new Event('change')); };
  const sidos = [...$('#regionSel').options].map(o => o.value);
  const poly = id => document.getElementById(id)?.querySelector('polygon');
  const ctr = id => { const q = poly(id).getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2, q.width]; };
  const visibleHex = () => [...H.hexById.keys()].filter(id => !S.hexCut.includes(id));
  const expColor = id => { const v = S.values[id], k = v === undefined ? -1 : Core.classify(v, S.legend.breaks); return norm(k < 0 ? S.legend.noData : S.legend.colors[k]); };
  const hexEditOn = () => { if (S.unit !== 'hex') H.setUnit('hex'); if (S.region) chg('#regionSel', ''); $('#hexEdit').checked = true; chg('#hexEdit'); };

  const ops = {
    unit: () => H.setUnit(pick(['dong', 'bjd', 'hex', 'hex', 'hex'])),
    region: () => chg('#regionSel', rnd() < 0.5 ? '' : pick(sidos)),
    sample: () => $('#sample').click(),
    clear: () => $('#clearVal').click(),
    legend: () => { chg('#ln', String(2 + Math.floor(rnd() * 8))); chg('#lpal', pick([...$('#lpal').options].map(o => o.value))); chg('#lmode', pick(['equal', 'quantile'])); },
    rename: () => { const c = pick([...H.cmap.values()]); const sel = $('#csel'); if (![...sel.options].some(o => o.value === c.id)) return; sel.value = c.id; chg('#csel'); $('#cname').value = pick(['가나다보건소', '신규구', '긴이름의보건소테스트', c.name]); $('#crename').click(); },
    newCenter: () => { $('#newname').value = pick(['신규A', '신규B', '새보건소']); $('#newbtn').click(); },
    delCenter: () => { if (!S.extra.length) return; const sel = $('#csel'); sel.value = pick(S.extra).id; chg('#csel'); $('#cdel').click(); },
    hexMove: async () => {
      hexEditOn(); tool('move'); const ids = visibleHex(); if (!ids.length) return; const id = pick(ids), [cx, cy, w] = ctr(id), px = w / 34.9;
      const [ox, oy] = pick([[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 2], [0, -2]]), tx = cx + ox * 26.175 * px, ty = cy + oy * 15.1 * px;
      ev('mousedown', cx, cy, poly(id)); ev('mousemove', (cx + tx) / 2, (cy + ty) / 2); ev('mousemove', tx, ty); ev('mouseup', tx, ty); await wait(5); },
    hexPlace: async () => {
      hexEditOn(); tool('place'); const pool = [...S.extra.map(e => e.id), ...S.hexCut].filter(i => H.cmap.has(i)); const c = H.cmap.get(pool.length && rnd() < 0.8 ? pick(pool) : pick([...H.cmap.keys()])); const sel = $('#csel'); if (![...sel.options].some(o => o.value === c.id)) return; sel.value = c.id; chg('#csel');
      const ids = visibleHex().filter(i => i !== c.id); if (!ids.length) return; const id = pick(ids), [cx, cy, w] = ctr(id), px = w / 34.9, h0 = JSON.stringify(S.hexPos) + S.hexCut.length + S.hexAdd.length;
      for (const [ox, oy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 2], [0, -2]].sort(() => rnd() - 0.5)) { const tx = cx + ox * 26.175 * px, ty = cy + oy * 15.1 * px; ev('mousemove', tx, ty, map); await wait(5); map.dispatchEvent(new MouseEvent('click', { clientX: Math.round(tx), clientY: Math.round(ty), bubbles: true })); await wait(5); if (JSON.stringify(S.hexPos) + S.hexCut.length + S.hexAdd.length !== h0) break; } },
    hexDelete: async () => {
      hexEditOn(); tool('select'); const ids = visibleHex(); const id = pick(ids), q = poly(id).getBoundingClientRect();
      ev('mousedown', q.x - 2, q.y - 2, map); ev('mousemove', q.x + q.width / 2, q.y + q.height / 2); ev('mousemove', q.right + 2, q.bottom + 2); ev('mouseup', q.right + 2, q.bottom + 2); await wait(5);
      if (S.hexCut.length < 60) $('#hexDel').click(); else $('#hexClear').click(); },
    gisAssign: async () => {
      if (S.unit === 'hex') H.setUnit(pick(['dong', 'bjd'])); if (S.region) chg('#regionSel', '');
      const sel = $('#csel'), opts = [...sel.options]; if (!opts.length) return; sel.value = pick(opts).value; chg('#csel'); $('#edit').checked = true; chg('#edit');
      for (let k = 0; k < 3; k++) { const paths = [...document.querySelectorAll('#gDong path')]; if (!paths.length) break; const t = pick(paths); await wait(5); t.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 300, bubbles: true })); }
      $('#edit').checked = false; chg('#edit'); },
    islandDelete: async () => {
      if (S.unit === 'hex') H.setUnit(pick(['dong', 'bjd'])); $('#islandEdit').checked = true; chg('#islandEdit');
      const r = map.getBoundingClientRect(), x0 = r.left + rnd() * r.width * 0.5, y0 = r.top + rnd() * r.height * 0.5;
      ev('mousedown', x0, y0, map); ev('mousemove', x0 + 5, y0 + 5); ev('mousemove', x0 + r.width * (0.2 + rnd() * 0.5), y0 + r.height * (0.2 + rnd() * 0.5)); ev('mouseup', x0 + r.width * 0.5, y0 + r.height * 0.5); await wait(5);
      if (rnd() < 0.7) $('#islandDel').click(); else $('#islandClear').click(); $('#islandEdit').checked = false; chg('#islandEdit'); },
    islandReset: () => { if (S.unit !== 'hex') $('#islandReset').click(); },
    mapRoundtrip: async () => {
      let blob; const oc = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return 'x'; }; HTMLAnchorElement.prototype.click = function () {}; $('#mapExport').click(); URL.createObjectURL = oc;
      const text = await blob.text(), canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v), before = canon([S.overrides, S.overridesB, S.extra.map(e => e.name + e.id).sort(), S.renamed]);
      const dt = new DataTransfer(); dt.items.add(new File([text], 'm.csv')); $('#mapImport').files = dt.files; chg('#mapImport'); await wait(300);
      const after = canon([S.overrides, S.overridesB, S.extra.map(e => e.name + e.id).sort(), S.renamed]); if (before !== after) { const B = JSON.parse(before), Af = JSON.parse(after), d = []; for (const k of Object.keys({ ...B[0], ...Af[0] })) if (B[0][k] !== Af[0][k]) d.push(`동 ${k}: ${B[0][k]} → ${Af[0][k]} (기본 ${H.A.props[H.A.idx.get(k)]?.g})`); for (const k of Object.keys({ ...B[1], ...Af[1] })) if (B[1][k] !== Af[1][k]) d.push(`법정동 ${k}: ${B[1][k]} → ${Af[1][k]}`); bad.push('배정표 왕복 불일치 ' + d.slice(0, 6).join(' | ') + ' 새보건소 ' + B[2] + '→' + Af[2] + ' 이름바꿈 ' + JSON.stringify(B[3]) + '→' + JSON.stringify(Af[3])); } },
    hexReset: () => { $('#hexReset').click(); },
    hexPosReset: () => { $('#hexPosReset').click(); },
    roundtrip: () => { const a = JSON.stringify(Core.pickState(S)); H.applyState(JSON.parse(a)); const b = JSON.stringify(Core.pickState(S)); if (a !== b) bad.push('왕복 불일치 ' + a.length + ' vs ' + b.length); },
    saveRestore: () => { $('#saveName').value = 'f'; $('#saveBtn').click(); const a = JSON.stringify(Core.pickState(S)); if (rnd() < 0.5) { H.applyState({}); H.applyState(H.hist[0].state); if (JSON.stringify(Core.pickState(S)) !== a) bad.push('이력 복원 불일치'); } },
    island: () => { if (S.unit === 'hex') return; chg('#islandSel', pick(['show', 'hide'])); },
    legendEdit: () => { const bi = [...document.querySelectorAll('#ltable input[data-b]')]; if (bi.length) { const e = pick(bi); e.value = String(+e.value + (rnd() < 0.5 ? 1 : -1) * Math.ceil(rnd() * 3)); chg('#ltable input[data-b="' + e.dataset.b + '"]'); } const ci = [...document.querySelectorAll('#ltable input[data-c]')]; if (ci.length) { const e = pick(ci); e.value = pick(['#ff00ff', '#00ffff', '#123456']); e.dispatchEvent(new Event('input', { bubbles: true })); } const nd = $('#lnod'); nd.value = pick(['#cccccc', '#00ff00']); nd.dispatchEvent(new Event('input', { bubbles: true })); },
    popupValue: async () => { const els = S.unit === 'hex' ? [...document.querySelectorAll('#gHex g.hexagon.on:not(.cut) polygon')].filter(p => /^\d{8}$|^X/.test(p.parentNode.id)) : [...document.querySelectorAll('#gDong path')]; if (!els.length) return; const t = pick(els); if (S.unit === 'hex' && $('#hexEdit').checked) { $('#hexEdit').checked = false; chg('#hexEdit'); } if ($('#islandEdit').checked) { $('#islandEdit').checked = false; chg('#islandEdit'); } if ($('#edit').checked) { $('#edit').checked = false; chg('#edit'); } await wait(5); t.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 300, bubbles: true })); if ($('#valpop').hidden) { bad.push('팝업 안 열림'); return; } $('#vpInput').value = String(Math.round(rnd() * 100)); $('#vpOk').click(); },
    keyEsc: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); },
    zoom: () => { H.zoomBy(rnd() < 0.5 ? 1.5 : 1 / 1.5); if (rnd() < 0.3) H.fit(); },
    zoomSel: () => { const sel = $('#csel'); const o = pick([...sel.options]); if (!o) return; sel.value = o.value; chg('#csel'); $('#zoomSel').click(); },
    lines: () => { const ci = $('#lineColors input[data-k=border]'); ci.value = pick(['#ff0000', '#00ff00', '#2b3440']); ci.dispatchEvent(new Event('input', { bubbles: true })); },
    toggles: () => { chg('#hexName', rnd() < 0.5); chg('#hexVal', rnd() < 0.5); chg('#showSido', rnd() < 0.5); chg('#showDong', rnd() < 0.5); },
  };
  const weights = { unit: 3, region: 3, sample: 2, clear: 1, legend: 2, rename: 3, newCenter: 2, delCenter: 1, hexMove: 10, hexPlace: 6, hexDelete: 3, hexReset: 1, hexPosReset: 1, gisAssign: 4, legendEdit: 2, popupValue: 3, keyEsc: 1, islandDelete: 3, islandReset: 1, mapRoundtrip: 1, roundtrip: 3, saveRestore: 1, island: 1, zoom: 2, zoomSel: 2, lines: 1, toggles: 2 };
  const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));

  const invariants = tag => {
    const hexIds = [...H.hexById.keys()]; const all = [...H.cmap.keys()];
    if (S.unit === 'hex') {
      const vis = visibleHex(); const cs = vis.map(id => { const h = H.hexById.get(id); return [id, h.c0[0] + h.dx, h.c0[1] + h.dy]; });
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.hypot(cs[i][1] - cs[j][1], cs[i][2] - cs[j][2]) < 20) { bad.push(`${tag} 육각 겹침 ${cs[i][0]} ${cs[j][0]}`); i = cs.length; break; }
      const r = map.getBoundingClientRect(), v = map.viewBox.baseVal;                  // 실제로 그려진 viewBox(확대는 다음 프레임에 반영되므로 H.vb 가 아니라 이것)
      let off = 0, n = 0; for (const id of vis) { const h = H.hexById.get(id); if (!h.g.classList.contains('on')) continue; const q = poly(id).getBoundingClientRect(); const ex = r.left + ((h.box[0] + h.box[2]) / 2 - v.x) / v.w * r.width, ey = r.top + ((h.box[1] + h.box[3]) / 2 - v.y) / v.h * r.height; n++; if (Math.hypot(ex - (q.x + q.width / 2), ey - (q.y + q.height / 2)) > 1.5) off++; }
      if (off) bad.push(`${tag} 화면 위치≠계산 위치 ${off}/${n}`);
      for (const id of hexIds) { const h = H.hexById.get(id); if (norm(h.poly.style.fill) !== expColor(id)) { bad.push(`${tag} 육각 색 불일치 ${id}`); break; } }
      for (const id of S.hexAdd) if (!H.cmap.has(id)) bad.push(`${tag} 없는 보건소의 새 육각 ${id}`);
      for (const id of Object.keys(S.hexPos)) if (!H.hexById.has(id)) bad.push(`${tag} 없는 육각의 위치 ${id}`);
      const moved = Object.keys(S.hexPos).length > 0 || S.hexAdd.length > 0; if ([...document.querySelectorAll('#gHex .st19')].some(e => (e.style.display === 'none') !== moved)) bad.push(`${tag} 원래 시도선 표시 상태 틀림`);
      const nm = H.bnd; for (const id of vis) { const h = H.hexById.get(id); if (S.region && !h.g.classList.contains('on')) continue; if (h.box[0] < nm.minX - 1 || h.box[2] > nm.maxX + 1 || h.box[1] < nm.minY - 1 || h.box[3] > nm.maxY + 1) { bad.push(`${tag} 범위 밖 육각 ${id}`); break; } }
      for (const id of vis) { const h = H.hexById.get(id), c = H.cmap.get(id); if (!c) continue; const t = [...h.g.querySelectorAll('.svg_sigungu')][0]; const custom = S.renamed[id] !== undefined || S.extra.some(e => e.id === id); if (custom && t.textContent !== (c.name.replace(/보건의료원|보건소/g, '').trim() || c.name)) { bad.push(`${tag} 육각 글자≠이름 ${id}`); break; } }
    } else {
      const L = H.L, A = H.A, def = i => S.unit === 'dong' ? A.props[i].g : null;
      const dongHC = A.props.map(p => S.overrides[p.c] ?? p.g);
      for (let i = 0; i < L.n; i++) { const exp = S.unit === 'dong' ? dongHC[i] : (S.overridesB[L.props[i].c] ?? dongHC[A.idx.get(L.props[i].p)]); if (H.hc[i] !== exp) { bad.push(`${tag} 배정 불일치 ${i}`); break; } }
      const drawn = new Set(); document.querySelectorAll('#gFill path').forEach(el => drawn.add(el.dataset.c));
      const want = new Set(); for (let i = 0; i < L.n; i++) { const ps = L.unitParts[i]; if (ps.some(p => L.compOn[L.partComp[p]]) && (!S.region || H.cmap.get(H.hc[i])?.sido === S.region)) want.add(H.hc[i]); }
      if (!S.region && drawn.size !== want.size) bad.push(`${tag} 칠한 보건소 수 ${drawn.size} vs ${want.size}`);
      for (const c of L.comps.keys()) if (L.protectedC[c] && !L.compOn[c]) { bad.push(`${tag} 보호 섬이 꺼짐`); break; }
      for (const el of document.querySelectorAll('#gFill path')) if (norm(el.getAttribute('fill')) !== expColor(el.dataset.c)) { bad.push(`${tag} 지도 색 불일치`); break; }
    }
    const v = H.vb; if (!(isFinite(v.x + v.y + v.w + v.h) && v.w > 0)) bad.push(`${tag} viewBox 이상 ${JSON.stringify(v)}`);
    const a = JSON.stringify(Core.pickState(S)); try { JSON.parse(a); } catch (e) { bad.push(tag + ' 상태 직렬화 실패'); }
  };

  H.applyState({}); $('#sample').click();
  for (let i = 0; i < steps; i++) {
    const op = pick(bag); const before = errs.length;
    const h0 = JSON.stringify([S.hexPos, S.hexAdd, S.hexCut]); st[op] = st[op] || [0, 0]; st[op][1]++;
    try { const r = ops[op](); if (r && r.then) await r; } catch (e) { bad.push(`step ${i} ${op}: 예외 ${e.message}`); }
    if (errs.length > before) bad.push(`step ${i} ${op}: 화면 오류 ${errs.slice(before).join('|')}`);
    if (JSON.stringify([S.hexPos, S.hexAdd, S.hexCut]) !== h0) st[op][0]++;
    log.push(op); invariants(`step ${i} ${op}`); if (bad.length > 25) break;
  }
  window.removeEventListener('error', onErr); H.applyState({});
  return { steps: log.length, bad: bad.slice(0, 25), effective: Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('hex')).map(([k, v]) => [k, v.join('/')])) };
};
