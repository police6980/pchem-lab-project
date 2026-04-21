# 03. 소프트웨어 아키텍처

**문서 목적**: 웹 애플리케이션의 모듈 구성, 역할 분담, 데이터 흐름, 기술 스택을 정의한다. 현재 MVP 구현 현황과 v1.1+ 로드맵을 명확히 구분한다.

---

## 1. 시스템 개요

### 1.1 현재 MVP 범위

- **단일 페이지 보일 법칙 전용** 웹 앱 (HTML + Vanilla JS + CSS + p5.js CDN)
- **Mock 센서 기반 완전 시뮬레이션** (실 ESP32 통신 미구현)
- **브라우저**: Chrome / Edge (Web Serial API 필요 시; 현 MVP엔 불필요)

### 1.2 구조 도식

```
[Mock 센서 (ui.js 슬라이더)]
    ↓ (20Hz JSON 이벤트)
[SensorSource 추상화 (serial.js)]
    ↓
[웹 애플리케이션 (단일 페이지)]
  ├─ 시뮬레이션 엔진 (simulation.js)
  │    └─ Particle / GhostParticle / Box / ParticleSystem
  ├─ 렌더러 (renderer.js)
  │    └─ p5 인스턴스 2개 (시뮬 + 히스토그램)
  ├─ UI + 측정 (ui.js)
  │    └─ 슬라이더 / 온도 / 측정 / PV 산점도 / 분석
  ├─ 로거 (logger.js)
  │    └─ CSV 유틸 + 다운로드
  └─ 오케스트레이션 (main.js)
       └─ 부팅, 상태 공유, 콜백 배선
```

### 1.3 v1.1 이후 확장 방향

샤를·산염기로 확장될 때 도입 예정:
- **실험 선택 화면** 루트 페이지에 카드형 진입점
- **공통 엔진 모듈 분리**: `web/js/engine/` 폴더로 Particle·Box·ParticleSystem 이동, 실험별 특수 로직(`experiments/boyle/`, `experiments/charles/`)과 분리
- **LLM 튜터 모듈** (v2): 실시간 상태 JSON → API → 응답 UI

MVP 단계에선 **플랫 폴더 구조 + 보일 전용**으로 단순성 우선.

---

## 2. 모듈 구성 (현 구현)

### 2.1 폴더 구조

```
pchem-lab-project/
├── web/
│   ├── index.html              // 섹션 5개 DOM 선언
│   ├── config/
│   │   └── params.json         // 튜닝 가능 수치 단일 파일
│   ├── css/
│   │   └── style.css           // 전체 레이아웃 + 섹션별 스타일
│   └── js/
│       ├── simulation.js       // 물리 엔진
│       ├── renderer.js         // p5.js 드로잉 (2개 인스턴스)
│       ├── serial.js           // 센서 소스 추상화 (MockSensorSource)
│       ├── logger.js           // CSV 유틸
│       ├── ui.js               // DOM UI 함수 모음
│       └── main.js             // 부팅 + 오케스트레이션
├── firmware/                    // (미구현)
└── docs/                        // 설계 문서
```

스크립트 로드 순서 (`index.html`, `defer`):
```
p5.js (CDN) → simulation.js → renderer.js → serial.js → logger.js → ui.js → main.js
```

모듈 시스템 없음 (`<script>` 기반). 각 파일의 최상위 `const` / `function`은 전역 네임스페이스에 노출.

### 2.2 파일별 역할과 주요 심볼

#### `simulation.js` — 물리 엔진

**상수** (모듈 최상위):
- `BOX_INITIAL_X/Y/WIDTH/HEIGHT` (40 / 55 / 600 / 250)
- `BOX_MIN_WIDTH` / `BOX_MAX_WIDTH` (200 / 760)
- `DEFAULT_SPEED_SCALE` (120)
- `PARTICLE_RADIUS` (2.5)
- `DT_CAP` (0.05)

**클래스**:
- `Particle { x, y, vx, vy, mass, radius; update(dt, box) }` — 단일 입자. 벽 충돌 이벤트 반환
- `GhostParticle { x, y, vx, vy; update(dt, box) }` — 반지름 없음. 벽 반사만 수행
- `Box { x, y, width, height; update, setTargetFromPressure, getArea, getPistonLength }` — 기체 영역 기하
- `ParticleSystem` — 입자 컨테이너
  - `update(dt)` / `scaleVelocities(ratio)` / `clampParticlesIntoBox()`
  - `getAverageSpeed()` (RMS) / `getAverageKineticEnergy()` / `getInitialAverageSpeed()`
  - `getVelocityHistogram(binCount, maxSpeed)` — 실+유령 3000 샘플
  - `getPistonCollisionCount()` / `getLastPistonCollisions()` / `getTotalMomentumTransfer()`
  - `getAndResetOverlapPairCount()` / `getParticles()`

**유틸**: `boxMullerStandardNormal()` — 정규분포 난수

#### `renderer.js` — p5.js 드로잉

**상수** (모듈 최상위):
- `SIM_CANVAS_WIDTH/HEIGHT` (900 / 360)
- `HIST_CANVAS_WIDTH/HEIGHT` (560 / 260)
- `CYLINDER_LEFT/TOP/BOTTOM/RIGHT` (40 / 55 / 305 / 810) — `BOX_INITIAL_*` 상수 기반
- `HIST_BIN_COUNT` (40), `HIST_TIME_ALPHA` (0.03), `HIST_X/Y/W/H` (히스토그램 내부 배치)

**공개 함수**:
- `createRenderer(box, particleSystem, params, updateFn)` → `{ snapshotHistogramForGhost() }`
  - `section-canvas`에 시뮬 p5 인스턴스 append
  - `histogram-area`에 히스토그램 p5 인스턴스 + 토글 바 append
- `getAndResetFrameCount()` — FPS 측정용
- `spatialSmooth(bins)` — 히스토그램 공간 평활 (5-point 커널 + 경계 3-point fallback)

**내부 (클로저)**:
- 시뮬 p5 `draw()`: `updateFn(dt)` 호출 후 실린더/피스톤/입자/섬광 드로잉
- 히스토그램 p5 `draw()`: 시간 EMA → 공간 평활 → drawHistogram (막대 + ghost polyline + 이론 M-B)
- `Flash` 클래스 — 충돌 섬광 수명 관리 (운동량 비례 크기, 입자 색 상속)

#### `serial.js` — 센서 소스 추상화

**클래스**:
- `SensorSource` — 추상 베이스 (`start`, `stop`, `onData` 구독 관리)
- `MockSensorSource extends SensorSource`:
  - 내부 pressure 상태 + Gaussian 노이즈 (σ=0.1)
  - 20Hz (`setInterval 50ms`)로 `{ sensor, value, unit, timestamp }` emit
  - `setPressure(v)` — 슬라이더에서 값 업데이트

**미구현**:
- `WebSerialSensorSource` (실 센서 연결, v1.1 계획)

#### `logger.js` — CSV 유틸

**함수**:
- `downloadCSV(filename, headerArr, rowsArr)` — 단일 섹션 CSV (측정점 / 연속 로그)
- `downloadRawCSV(filename, content)` — 미리 조립된 다중 섹션 CSV (분석 보고서)
- `csvEscape(val)` — RFC 4180 인용 (쉼표·줄바꿈·쌍따옴표 포함 필드 처리)
- `formatTimestampForFilename(date)` — `YYYY-MM-DD_HH-MM-SS` 포맷

모든 출력에 BOM(`﻿`) 접두 → 엑셀 한글 호환.

#### `ui.js` — DOM UI

**공개 함수** (각각 독립 UI 단위):
- `createDevPressureSlider(onChange)` → `HTMLElement`
  - 슬라이더(81~230 kPa) + 레이블 + 값 표시를 `control-row-actuators`에 append
- `createInfoPanel()` + `updateInfoPanel(data)`
  - 실측(온도·압력) + 시뮬(속도·충돌·KE) 숫자 패널. `info-panel-area`에 append
- `createTemperatureControl({ ... })`
  - 온도 프리셋(0/25/50/77°C) + 커스텀 입력 + 피드백. `control-row-temperature`에 append
- `createMeasurementPanel({ ... })` → `{ getStabilized, getMeasurementCount, getDatapoints, clearMeasurements }`
  - 현재값 블록(`control-row-actuators`) + 측정 패널(`section-measurements`) + PV 산점도 p5
  - 안정화 감지, 1초 이동평균 기록, CSV 버튼 2종
- `createAnalysisPanel({ ... })` → `{ refresh, clear }`
  - 요약 + verdict + PV 막대 p5 + 성찰 3문항 + 분석 CSV 버튼 (`section-analysis`)

#### `main.js` — 부팅 + 오케스트레이션

- **모듈 상수**: `REFERENCE_TEMP_K/V_ML/P_KPA/RMS/KE`, `TRANSITION_TAU`, `CONTINUOUS_MAX_ROWS/SAMPLE_INTERVAL_MS`, `USE_MOCK_SENSOR` 플래그
- **부팅 흐름** (DOMContentLoaded 내부): params.json fetch → Box/ParticleSystem 생성 → MockSensor + slider → createRenderer → createInfoPanel → createMeasurementPanel → 250ms 연속 로그 setInterval → createAnalysisPanel → createTemperatureControl → 1s/5s setInterval
- **상태 변수** (DOMContentLoaded 클로저): `smoothedP`, `sessionStartMs`, `currentTempCelsius`, `V0_REFERENCE_AREA`, `V0_current`, `continuousBuffer`, 전이 애니메이션 4변수, `pistonHitsAccumulator`, `continuousHitsAccumulator`, `analysisApi`

---

## 3. 데이터 흐름

### 3.1 부팅 시퀀스

```
1. HTML 로드 → 섹션 5개 DOM 선언됨 (빈 상태)
2. defer 스크립트 순차 실행 → 모듈 최상위 상수·클래스 정의
3. main.js DOMContentLoaded 핸들러:
   a. params.json fetch
   b. Box + ParticleSystem 생성 (300 실입자 + 2700 유령 초기화)
   c. MockSensorSource 생성 + createDevPressureSlider
   d. sensor.onData 콜백 등록 (smoothedP EWMA + box.setTargetFromPressure + updateInfoPanel 압력)
   e. sensor.start() — 20Hz 타이머 시작
   f. createRenderer — 시뮬 + 히스토그램 p5 인스턴스
   g. createInfoPanel + 초기 updateInfoPanel (실측 온도·압력, 시뮬 속도·KE 포함 이론값 병기)
   h. createMeasurementPanel (measApi 반환)
   i. 250ms 연속 로그 setInterval 설치
   j. createAnalysisPanel (analysisApi 반환, 초기 hidden)
   k. createTemperatureControl
   l. 1s setInterval (속도·KE 패널 갱신)
   m. 5s setInterval (진단 로그 + 피스톤 hits 집계)
```

### 3.2 실시간 프레임 사이클 (60Hz, 시뮬 p5 `draw()`)

```
1. dt = p.deltaTime / 1000, cap 0.05s
2. updateFn(dt) [main.js 제공]:
   a. system.update(dt)                                  // 입자 이동·벽 충돌·입자 간 충돌
   b. box.update(dt, volume_tau_seconds)                 // 박스 폭 지수 수렴
   c. system.clampParticlesIntoBox()                     // 피스톤 통과 입자 수습
   d. pistonHitsAccumulator += tickHits
      continuousHitsAccumulator += tickHits
   e. 전이 중이면 currentSpeedRatio 갱신 + system.scaleVelocities
3. frameCounter++                                         // FPS 측정
4. 충돌 섬광 spawn → update → filter
5. 배경 → 해칭 → 실린더 벽 → 피스톤(헤드/로드/손잡이) → 입자 HSB → 섬광 드로잉
```

히스토그램 p5 `draw()`는 독립 60Hz로 돌며 `particleSystem.getVelocityHistogram` 읽기만 (상태 변경 없음).

### 3.3 이벤트 기반 주기

| 주기 | 소스 | 동작 |
|---|---|---|
| 20Hz (50ms) | Mock 센서 `onData` | smoothedP EWMA + box target + info panel 압력 표시 |
| 20Hz (50ms) | 측정 패널 `setInterval` | currentP 표시, V 자동 추종, 안정화 감지, 기록 버튼 상태 |
| 4Hz (250ms) | 연속 로그 setInterval | 상태 스냅샷 → continuousBuffer |
| 1Hz (1s) | 패널 업데이트 setInterval | 속도·KE 실측 + 이론값 표시 |
| 0.2Hz (5s) | 진단 로그 setInterval | 콘솔 FPS·hits/s·overlap + 피스톤 hits 정보 패널 |

### 3.4 측정 사이클 (학생 조작)

```
1. 슬라이더 조작 → MockSensor.setPressure → onData → smoothedP + box target 변화
   동시에: setSessionStart() 첫 호출 → sessionStartMs 고정
   동시에: 슬라이더 input 이벤트 → pHistory/widthHistory 버퍼 비움 → isStabilized=false
2. ≈3~4초 대기 → 버퍼 재충전 + 수렴 → isStabilized=true → [기록] 버튼 활성
3. 학생 [기록] 클릭:
   a. P = mean(pHistory), V = (학생 편집 없으면) pixelsToML(mean(widthHistory))
   b. datapoints.push({ id, P, V, PV, timestamp, tempK })
   c. renderTable / renderSummary / redrawPVPlot / updateExportButtonState
   d. onDataChange → analysisApi.refresh
   e. datapoints >= 3이면 #section-analysis 가시화
4. 필요 시 CSV 다운로드: 측정점 / 연속 로그 / 분석 보고서 3종
```

### 3.5 온도 변경 사이클 (학생 조작)

```
1. 온도 프리셋/커스텀 커밋
2. createTemperatureControl requestChange:
   - 기록 있으면 confirm 다이얼로그
   - onCommit(newCelsius) 호출
3. main.js onCommit:
   a. 진행 중 전이 snap (oldTempK 확정)
   b. currentTempCelsius 업데이트
   c. renderer.snapshotHistogramForGhost() — 이전 분포 캡처
   d. targetSpeedRatio = √(newTempK / oldTempK), 전이 시작
   e. recomputeV0Current() → box.setTargetFromPressure
   f. updateInfoPanel({ temp_K })
   g. measApi.clearMeasurements() — 표·PV 산점도 비우기
   h. continuousBuffer.length = 0, sessionStartMs = null
   i. analysisApi.clear() — 분석 + 성찰 textarea 초기화
4. 다음 60Hz 프레임부터 currentSpeedRatio → targetSpeedRatio 수렴 (0.3s tau, ~1.5s)
5. 박스 폭도 0.5s tau로 수렴 (속도 + V_baseline 모두 이동)
```

---

## 4. UI 구조 (4+1 섹션 레이아웃)

`#main-container` 내부에 5개 section 연직 배치:

```
<main-container>
  <section id="section-controls">               // 섹션 1 - 상단 컨트롤
    <div class="control-row-temperature"> ... </div>
    <div class="control-row-actuators">
      <div id="dev-pressure-slider">...</div>
      <div id="current-reading-block">P값 V값 [기록] [안정화 힌트]</div>
    </div>
  </section>

  <section id="section-canvas">                 // 섹션 2 - 시뮬 캔버스
    <canvas>...</canvas>                        // 900×360 (p5 append)
  </section>

  <section id="section-visuals">                // 섹션 3 - flex row
    <div id="histogram-area">                   //   좌: 히스토그램
      <div class="hist-toggles">...</div>
      <canvas>...</canvas>                      //   560×260 (p5 append)
    </div>
    <div id="info-panel-area">                  //   우: 숫자 패널
      <div id="info-panel">...</div>
    </div>
  </section>

  <section id="section-measurements">           // 섹션 4 - flex row
    <div id="measurement-panel">                //   좌: 표 + 요약 + CSV 버튼
      <div class="section-head">...</div>
      <table id="datapoints-table">...</table>
      <div id="measurement-summary">...</div>
    </div>
    <div id="pv-plot-area">                     //   우: PV 산점도
      <div class="plot-toggles">...</div>
      <div id="pv-plot-canvas-wrap"><canvas>...</canvas></div>
    </div>
  </section>

  <section id="section-analysis" class="hidden"> // 섹션 5 - 조건부 가시
    요약 + verdict + PV 막대 canvas + 성찰 3 textarea + [분석 보고서 저장]
  </section>
</main-container>
```

`.hidden { display: none }` — 분석 섹션만 `datapoints.length >= 3`일 때 토글.

### 4.1 레이아웃 shift 방지

- **슬라이더 고정 폭 420px** + 안정화 힌트 `visibility` 토글 (display 아님) + 힌트 공간 예약 120px
- 모든 수치 표시에 `min-width` + `text-align: right` 적용
- 상세는 `04-simulation-physics.md` §9 참고

---

## 5. 기술 스택 결정

### 5.1 확정된 기술

| 계층 | 기술 | 근거 |
|---|---|---|
| 시뮬레이션 | p5.js v1.11.2 (CDN) | 교육용 레퍼런스 풍부, RAF + canvas 래핑 단순, 2개 인스턴스 자연스럽게 공존 |
| UI | HTML + CSS + Vanilla JS | 프레임워크 오버헤드 없음, `<script defer>`로 로드 |
| 설정 | `params.json` 단일 파일 | MVP 규모에 계층 분리 불필요 |
| 데이터 | 메모리 내 배열 + 브라우저 CSV 다운로드 | 프라이버시·설치 무부담 |
| 펌웨어 | Arduino C++ (계획, v1.1) | 표준, SEN0257 레퍼런스 풍부 |

### 5.2 미정 / 유보

- **Web Serial API 통신**: v1.1 실 센서 연결 시 MockSensorSource 교체
- **LLM 제공자**: Claude vs GPT 등. v2 LLM 튜터 설계 시 결정
- **빌드 도구**: 현재 없음 (pure JS, 모듈 미사용). 타입 검사·번들링 필요성 생기면 도입 고려

---

## 6. 모듈 간 의존성

```
main.js
 ├─→ simulation.js   (Box, ParticleSystem, DEFAULT_SPEED_SCALE 등)
 ├─→ renderer.js     (createRenderer, getAndResetFrameCount)
 ├─→ serial.js       (MockSensorSource)
 ├─→ logger.js       (간접: ui.js 경유)
 └─→ ui.js           (createDevPressureSlider, createInfoPanel, updateInfoPanel,
                      createMeasurementPanel, createTemperatureControl, createAnalysisPanel)

ui.js
 ├─→ logger.js       (downloadCSV, downloadRawCSV, csvEscape, formatTimestampForFilename)
 └─→ main.js 상수    (REFERENCE_P_KPA, REFERENCE_V_ML — 크로스 모듈)

renderer.js
 └─→ simulation.js   (BOX_INITIAL_*, BOX_MAX_WIDTH)

simulation.js / serial.js / logger.js — 독립 (상호 참조 없음)
```

**크로스 모듈 상수 참조**: `<script>` 전역 네임스페이스. `defer` 로드 순서상 ui.js가 main.js보다 먼저 파싱되지만, `createAnalysisPanel` 호출 시점엔 main.js의 상수가 이미 정의돼 안전.

---

## 7. 미구현 / v1.1+ / v2 계획

### 7.1 v1.1 — 보일 실물 통합

- [ ] ESP32 펌웨어 (SEN0257 압력 센서, 20Hz JSON 스트림)
- [ ] `WebSerialSensorSource` 구현 (`serial.js`) — MockSensorSource 대체
- [ ] hello 핸드셰이크: `{ type: "hello", device: "boyle_v1" }`
- [ ] `USE_MOCK_SENSOR` 플래그 off → 실 센서 모드
- [ ] 센서 캘리브레이션 UI (개별 오프셋 보정)

### 7.2 v1.2 — 샤를 법칙

- [ ] 샤를 전용 장비 (에어챔버 + DS18B20 온도 센서)
- [ ] **실험 선택 화면** (루트 페이지)
- [ ] 폴더 구조 재편:
  - `web/js/engine/` (공통 Particle·Box·ParticleSystem)
  - `web/js/experiments/boyle/` + `experiments/charles/`
  - 공통 UI 컴포넌트 (`web/js/ui/common/`)
- [ ] `experiments.json` 분리 (보일·샤를별 기본값·상수)

### 7.3 v2 — 산염기 + LLM

- [ ] 산염기 장비 (pH 센서)
- [ ] 이온화 시각화 규칙 (강산/약산)
- [ ] **LLM 튜터 모듈**:
  - 호출 트리거 (학생 질문 + 이벤트 기반)
  - 상태 컨텍스트 JSON 스키마 (`05-data-format.md` 참고)
  - 프롬프트 설계 (`07-llm-tutor.md` 신설)
  - 응답 UI (채팅창)
  - API 제공자 결정
- [ ] **이벤트 로그** (`events_*.csv`) + **대화 로그** (`chat_*.json`)
- [ ] **반데르발스 편차 교육 활용** (고밀도 구간 명시적 표시)
