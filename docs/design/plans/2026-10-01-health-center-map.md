# 보건소 GIS 지도 Implementation Plan


**Goal:** 2026-07 행정동 경계를 보건소 단위로 묶고 수치·범례로 색칠하는 단일 `index.html` 지도.

**Architecture:** node 빌드 스크립트가 GeoJSON→TopoJSON(위상 유지 단순화)과 기본 보건소 매핑을 만들어 `src/app.html` 템플릿에 내장한다. 화면 없는 로직은 `src/core.js`에 두고 node로 테스트하며 빌드 때 그대로 인라인한다.

**Tech Stack:** node 24, mapshaper 0.7(빌드 전용), topojson-client·SheetJS mini(인라인), 순수 SVG/JS.

## Global Constraints
- 서버 없이 `index.html` 더블클릭(file://)으로 동작, 외부 네트워크 요청 없음.
- 경계 기준 2026-07-01 행정동, 키는 행정동코드 10자리(`adm_cd2`).
- 기본 매핑 = 시군구(일반구 포함, `sgg` 5자리) 1개 = 보건소 1개.
- 화면 하단 출처 표기: 통계청 SGIS(공공누리 1유형) 가공 vuski/admdongkor(CC BY 4.0).
- 법정동·배경지도·관할 자동조사는 범위 밖.

## 파일
- `src/core.js` — 순수 로직(구간·색·CSV·매칭). Produces: `Core.niceBreaks(values,n,mode)`, `Core.classify(v,breaks)`, `Core.ramp(anchors,n)`, `Core.parseCSV(text)`, `Core.toCSV(rows)`, `Core.matchRows(rows,centers)`.
- `tests/core.test.js` — assert 기반 테스트.
- `tools/build.js` — 데이터 생성+조립. Produces `index.html`, `data/centers_default.json`, `data/exceptions_report.txt`.
- `src/app.html` — 화면 템플릿(`/*@CORE@*/ /*@TOPO@*/ /*@LIBS@*/` 자리표시자).

---

### Task 1: core.js (TDD)
- [ ] 실패하는 테스트 작성(`tests/core.test.js`): 등간격/분위수 경계, classify 경계값(하한 포함·상한 미포함·마지막 상한 포함), parseCSV(BOM·따옴표·쉼표·CRLF), matchRows 우선순위(코드→시도+이름→유일 이름)
- [ ] `node tests/core.test.js` 실패 확인
- [ ] `src/core.js` 구현
- [ ] 통과 확인, 커밋

### Task 2: 데이터 빌드
- [ ] mapshaper로 단순화 후 TopoJSON 생성(`-simplify percentage visvalingam keep-shapes`, 속성 c=adm_cd2,n=adm_nm,g=sgg)
- [ ] 기본 보건소 목록(시군구별) 생성, 자체검사(모든 행정동 1회 배정, 개수 출력)
- [ ] 예외 의심 목록(`exceptions_report.txt`) 출력
- [ ] 크기 확인(목표 ≤ 8MB), 커밋

### Task 3: 화면(app.html) + 조립
- [ ] SVG 지도·확대/이동·호버 툴팁·보건소 경계 mesh
- [ ] 데이터 탭(양식 CSV/xlsx 다운로드, 업로드, 미매칭 목록)
- [ ] 범례 탭(구간 수·자동/직접·색상표·구간색·없음색·제목/단위)
- [ ] 배정 탭(보건소 선택, 행정동 클릭 배정, 새 보건소/이름 변경, 매핑 CSV 입출력, localStorage)
- [ ] PNG(2배)·SVG 저장(제목+범례 포함)
- [ ] `tools/build.js`가 `index.html` 조립, 커밋

### Task 4: 브라우저 검증 + 문서
- [ ] 샘플 CSV 업로드→색칠, 클릭 배정, 범례 변경, PNG 저장 직접 확인, 콘솔 에러 0
- [ ] README(사용법·갱신법·출처), 커밋
