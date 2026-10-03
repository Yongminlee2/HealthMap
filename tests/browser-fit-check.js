// 화면 맞춤·확대 점검(브라우저 콘솔에 통째로 붙여 넣어 실행). index.html 을 연 탭에서 쓴다.
// 모든 보기(행정동·법정동·육각) × 전국/시도 × 섬 있음·없음에서 확인:
//  1) 범위 계산이 갱신 순서와 무관하게 늘 같은 값  2) 처음 위치에서 지도가 화면 안에 다 들어옴
//  3) 확대·축소 버튼이 막히지 않음  4) 어떤 경로로 와도 같은 상태면 같은 화면
// 결과: { n: 검사 횟수, bad: [] } — bad 가 비어 있어야 정상.
(async () => {
  const H = window.__hm, sel = document.querySelector('#regionSel'), isl = document.querySelector('#islandSel');
  const sidos = [...sel.options].map(o => o.value), res = { n: 0, bad: [] }, seen = {};
  const setRegion = v => { sel.value = v; sel.dispatchEvent(new Event('change')); };
  const setIsl = v => { isl.value = v; isl.dispatchEvent(new Event('change')); };
  const snap = () => JSON.stringify([H.bnd.minX, H.bnd.minY, H.bnd.maxX, H.bnd.maxY, H.vb.x, H.vb.y, H.vb.w, H.vb.h].map(x => Math.round(x * 10) / 10));
  const check = tag => {
    res.n++; const s1 = snap(); H.computeBounds(); if (snap() !== s1) res.bad.push(tag + ' 범위가 불안정');
    const { minX, minY, maxX, maxY } = H.bnd, v = H.vb;
    if (minX < v.x - 1 || minY < v.y - 1 || maxX > v.x + v.w + 1 || maxY > v.y + v.h + 1) res.bad.push(tag + ' 지도가 화면 밖');
    const w = v.w; H.zoomBy(1.5); if (!(H.vb.w > w * 1.4)) res.bad.push(tag + ' 축소 막힘'); H.zoomBy(1 / 1.5);
    const w1 = H.vb.w; H.zoomBy(1 / 1.5); if (!(H.vb.w < w1 * 0.7)) res.bad.push(tag + ' 확대 막힘'); H.zoomBy(1.5); H.fit();
  };
  for (const u of ['dong', 'bjd', 'hex']) {
    H.setUnit(u); setRegion(''); const modes = u === 'hex' ? ['show'] : ['show', 'hide'];
    for (const m of modes) { if (u !== 'hex') setIsl(m); for (const r of sidos) { setRegion(r); check(`${u} ${m} ${r || '전국'}`); seen[`${u}${m}${r}`] = snap(); } }
    for (const m of [...modes].reverse()) { if (u !== 'hex') setIsl(m); for (const r of [...sidos].reverse()) { setRegion(r); if (snap() !== seen[`${u}${m}${r}`]) res.bad.push(`${u} ${m} ${r || '전국'} 경로에 따라 화면이 다름`); } }
    if (u !== 'hex') setIsl('show'); setRegion('');
  }
  H.applyState({}); return res;
})();
