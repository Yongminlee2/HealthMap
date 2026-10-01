const assert = require('assert');
const Core = require('../src/core.js');

// 구간: 등간격
assert.deepStrictEqual(Core.niceBreaks([0, 10, 100], 4, 'equal'), [0, 25, 50, 75, 100]);
// 구간: 분위수 (중복 경계는 합쳐진다)
assert.deepStrictEqual(Core.niceBreaks([1, 2, 3, 4, 5, 6, 7, 8], 2, 'quantile'), [1, 4.5, 8]);
assert.deepStrictEqual(Core.niceBreaks([5, 5, 5, 5], 3, 'quantile'), [5, 5.001]);
// 값이 없으면 빈 배열
assert.deepStrictEqual(Core.niceBreaks([], 3, 'equal'), []);

// 분류: 하한 포함, 상한 미포함, 마지막 구간만 상한 포함, 범위 밖은 끝 구간으로
const b = [0, 10, 20, 30];
assert.strictEqual(Core.classify(0, b), 0);
assert.strictEqual(Core.classify(9.99, b), 0);
assert.strictEqual(Core.classify(10, b), 1);
assert.strictEqual(Core.classify(30, b), 2);
assert.strictEqual(Core.classify(-5, b), 0);
assert.strictEqual(Core.classify(99, b), 2);
assert.strictEqual(Core.classify(NaN, b), -1);
assert.strictEqual(Core.classify(null, b), -1);

// 색 보간
assert.deepStrictEqual(Core.ramp(['#000000', '#ffffff'], 3), ['#000000', '#808080', '#ffffff']);
assert.deepStrictEqual(Core.ramp(['#000000', '#ffffff'], 1), ['#808080']);

// CSV: BOM, 따옴표, 쉼표, CRLF
assert.deepStrictEqual(
  Core.parseCSV('﻿a,b\r\n"x,1","y""z"\r\n\r\nlast,'),
  [['a', 'b'], ['x,1', 'y"z'], ['last', '']]
);
assert.strictEqual(Core.toCSV([['a', 'b,c'], ['d"e', 1]]), 'a,"b,c"\r\n"d""e",1');

// 매칭 우선순위: 코드 → 시도+이름 → 전국 유일 이름
const centers = [
  { id: '11140', sido: '서울특별시', name: '중구 보건소' },
  { id: '26110', sido: '부산광역시', name: '중구 보건소' },
  { id: '11110', sido: '서울특별시', name: '종로구 보건소' },
  { id: '41111', sido: '경기도', name: '수원시장안구 보건소' },
  { id: '29140', sido: '전남광주통합특별시', name: '서구 보건소' },
];
const r = Core.matchRows([
  { sido: '', name: '', code: '26110', value: '5' },            // 코드
  { sido: '서울', name: '중구', code: '', value: '1,200' },      // 시도+이름, 쉼표 숫자
  { sido: '', name: '종로구보건소', code: '', value: '7' },       // 유일 이름
  { sido: '', name: '중구', code: '', value: '9' },              // 모호 → 미매칭
  { sido: '광주광역시', name: '서구', code: '', value: '3' },     // 광주 ↔ 전남광주
  { sido: '경기도', name: '없는곳', code: '', value: '1' },       // 미매칭
  { sido: '', name: '수원시장안구', code: '', value: '' },        // 빈 값은 무시
  { sido: '', name: '수원시장안구', code: '', value: 'abc' },     // 숫자 아님 → 미매칭
], centers);
assert.deepStrictEqual(r.values, { 26110: 5, 11140: 1200, 11110: 7, 29140: 3 });
assert.strictEqual(r.unmatched.length, 3);
assert.deepStrictEqual(r.unmatched.map(x => x.name), ['중구', '없는곳', '수원시장안구']);

// 저장본: 파일 이름(윈도우 금지문자 제거), 만들기/읽기, 요약, 상태 고르기
const d0 = new Date(2026, 9, 2, 14, 3, 1);
assert.strictEqual(Core.stamp(d0), '20261002-140301');
assert.strictEqual(Core.snapshotFileName(d0, ''), '보건소지도_20261002-140301.json');
assert.strictEqual(Core.snapshotFileName(d0, '1차: 검토/본?'), '보건소지도_20261002-140301_1차 검토 본.json');
assert.strictEqual(Core.snapshotFileName(d0, 'a'.repeat(100)).length, '보건소지도_20261002-140301_.json'.length + 40);
const st = { values: { a: 1, b: 2 }, overrides: { x: 'y' }, overridesB: {}, extra: [{ id: 'X01' }], renamed: {}, showDong: true, unit: 'dong', legend: { title: 't' }, junk: 1 };
assert.deepStrictEqual(Core.summarize(st), { values: 2, dongEdits: 1, bjdEdits: 0, newCenters: 1 });
const picked = Core.pickState(st);
assert.strictEqual(picked.junk, undefined);
assert.notStrictEqual(picked.values, st.values);                    // 복사본(원본과 연결 끊김)
assert.deepStrictEqual(picked.values, st.values);
const snap = Core.makeSnapshot(Core.pickState(st), '이름', false, d0);
assert.strictEqual(snap.app, 'healthmap'); assert.strictEqual(snap.name, '이름'); assert.strictEqual(snap.summary.values, 2);
assert.deepStrictEqual(Core.parseSnapshot(JSON.stringify(snap)).state.values, { a: 1, b: 2 });
assert.strictEqual(Core.parseSnapshot('not json'), null);
assert.strictEqual(Core.parseSnapshot('{"app":"other","format":1,"state":{}}'), null);
assert.strictEqual(Core.parseSnapshot('{"app":"healthmap","format":9,"state":{}}'), null);

console.log('core tests ok');
