// 화면 없는 순수 로직. node 테스트와 브라우저(빌드 때 인라인) 양쪽에서 쓴다.
(function (root) {
  const Core = {};
  const clean = x => Number(x.toPrecision(12));

  // n개 구간의 경계 n+1개. 값이 모두 같으면 [v, v+0.001].
  Core.niceBreaks = function (values, n, mode) {
    const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return [];
    const min = v[0], max = v[v.length - 1], range = max - min;
    const p = range > 0 ? Math.pow(10, Math.floor(Math.log10(range)) - 2) : 0.001;
    const out = [];
    for (let i = 0; i <= n; i++) {
      let x;
      if (mode === 'quantile') {
        const pos = (v.length - 1) * i / n, lo = Math.floor(pos), hi = Math.ceil(pos);
        x = v[lo] + (v[hi] - v[lo]) * (pos - lo);
      } else x = min + range * i / n;
      if (i === 0) x = Math.floor(min / p) * p;
      else if (i === n) x = Math.ceil(max / p) * p;
      else x = Math.round(x / p) * p;
      out.push(clean(x));
    }
    const u = out.filter((x, i) => i === 0 || x > out[i - 1]);
    if (u.length < 2) u.push(clean(u[0] + 0.001));
    return u;
  };

  // 구간 번호 0..n-1, 값 없음 -1. 하한 포함·상한 미포함, 범위 밖은 양 끝 구간.
  Core.classify = function (val, b) {
    if (val === null || val === undefined || val === '') return -1;
    val = Number(val);
    if (!Number.isFinite(val)) return -1;
    for (let i = 1; i < b.length; i++) if (val < b[i]) return i - 1;
    return b.length - 2;
  };

  // 앵커 색들을 n개로 선형 보간
  Core.ramp = function (anchors, n) {
    const rgb = anchors.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
    const hex = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    return Array.from({ length: n }, (_, i) => {
      const t = (n === 1 ? 0.5 : i / (n - 1)) * (rgb.length - 1);
      const a = Math.min(Math.floor(t), rgb.length - 2), f = t - a;
      return hex(rgb[a].map((x, k) => x + (rgb[a + 1][k] - x) * f));
    });
  };

  Core.parseCSV = function (text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (!(row.length === 1 && row[0] === '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    return rows;
  };

  Core.toCSV = rows => rows.map(r => r.map(x => {
    const s = x === null || x === undefined ? '' : String(x);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');

  const SIDO = { 충청북도: '충북', 충청남도: '충남', 경상북도: '경북', 경상남도: '경남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 전남광주통합특별시: '전남광주' };
  const sidoKey = s => { s = String(s || '').replace(/\s/g, ''); return SIDO[s] || s.slice(0, 2); };
  const sidoOk = (a, b) => !a || a === b || (a === '전남광주' && (b === '광주' || b === '전남')) || (b === '전남광주' && (a === '광주' || a === '전남'));
  const normName = s => String(s || '').replace(/\s/g, '').replace(/보건의료원|보건소/g, '');

  // rows: [{sido,name,code,value}], centers: [{id,sido,name}]
  // → {values:{id:number}, unmatched:[row]} (값이 빈 행은 무시)
  Core.matchRows = function (rows, centers) {
    const byId = new Map(centers.map(c => [String(c.id), c]));
    const cs = centers.map(c => ({ id: String(c.id), sk: sidoKey(c.sido), nn: normName(c.name) }));
    const values = {}, unmatched = [];
    for (const r of rows) {
      const raw = String(r.value === undefined || r.value === null ? '' : r.value).trim();
      if (raw === '') continue;
      const num = Number(raw.replace(/,/g, ''));
      const code = String(r.code || '').trim();
      let id = byId.has(code) ? code : null;
      if (!id) {
        const nn = normName(r.name), sk = sidoKey(r.sido);
        if (nn) {
          const same = cs.filter(c => c.nn === nn);
          const bySido = r.sido ? same.filter(c => sidoOk(sk, c.sk)) : [];
          if (bySido.length === 1) id = bySido[0].id;
          else if (!r.sido && same.length === 1) id = same[0].id;
        }
      }
      if (id && Number.isFinite(num)) values[id] = num; else unmatched.push(r);
    }
    return { values, unmatched };
  };

  // ── 저장본(작업 상태 스냅샷) ──
  const STATE_KEYS = ['values', 'overrides', 'overridesB', 'extra', 'renamed', 'showDong', 'showSido', 'unit', 'legend', 'lines', 'region', 'hexVal', 'hexName'];
  Core.pickState = o => { const out = {}; for (const k of STATE_KEYS) if (o && o[k] !== undefined) out[k] = JSON.parse(JSON.stringify(o[k])); return out; };   // 복사본(원본과 연결 끊김)
  Core.summarize = st => ({ values: Object.keys(st.values || {}).length, dongEdits: Object.keys(st.overrides || {}).length, bjdEdits: Object.keys(st.overridesB || {}).length, newCenters: (st.extra || []).length });
  Core.makeSnapshot = (state, name, auto, d) => ({ id: d.getTime(), savedAt: d.toISOString(), name: name || '', auto: !!auto, summary: Core.summarize(state), state });

  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
