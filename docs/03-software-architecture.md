# 03. 소프트웨어 아키텍처

**문서 목적**: 웹 애플리케이션의 모듈 구성, 역할 분담, 데이터 흐름, 기술 스택을 정의한다. 현재 Part 3.5 구현 현황과 이후 Phase 계획을 구분한다.

---

## 1. 시스템 개요

### 1.1 현재 MVP 범위

- **단일 페이지 보일 법칙 전용** 웹 앱 (HTML + Vanilla JS + CSS + p5.js CDN)
- **Mock 센서 기반 완전 시뮬레이션** (실 ESP32 통신은 Phase 3 진행 중 — `phase3-real-sensor` 브랜치에서 WebSocket 펌웨어 에뮬레이터 Step 3-1~3-3 및 ESP32 펌웨어 스켈레톤·시뮬 완료; 브라우저 통합 Step 3-4~3-5와 실물 검증 Step 3-6 남음)
- **브라우저**: Chrome / Edge (Web Serial API 필요 시; 현 MVP엔 불필요)
- **AI 튜터**: Phase 2-B 완료. 실제 Anthropic Messages API 호출 + 멀티턴 대화 + 비용 표시 + docx 보고서 생성 작동 (v0.3-ai-tutor-live)

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
  │    └─ 슬라이더 / 온도 / 측정 / PV 산점도 / 분석 / BYOK 설정
  ├─ AI 튜터 (ai-tutor.js)                     ← Part 3.5에서 추가
  │    └─ 대화 상태·탭·메시지 렌더·입력창·실 Anthropic API 호출
  ├─ 로거 (logger.js)
  │    └─ CSV 유틸 + 다운로드
  └─ 오케스트레이션 (main.js)
       └─ 부팅, 상태 공유, 콜백 배선
```

### 1.3 이후 Phase 계획

자세한 로드맵은 `docs/06-project-status.md` §4 참조. 요약:
- **Phase 2-B** (완료): ai-tutor.js 실 Anthropic Messages API 호출. 멀티턴·비용·에러 처리·docx 보고서 생성 작동
- **Phase 3** (진행 중, `phase3-real-sensor` 브랜치): ESP32 실센서 + Web Serial (MockSensorSource 교체). 개발용 WebSocket 펌웨어 에뮬레이터(`tools/firmware-emulator/`)로 실물 도착 전 브라우저 수신 경로 사전 구현
- **Phase 5**: 샤를 법칙 확장. 현재 플랫 폴더 → `experiments/` 분리 검토
- **Phase 4/6**: 비교 UX, 교사 도구

MVP 단계에선 **플랫 폴더 + 보일 전용**으로 단순성 우선.

---

## 2. 모듈 구성 (현 구현)

### 2.1 폴더 구조

```
pchem-lab-project/
├── web/
│   ├── index.html              // 섹션 5개 + 사이드바 DOM 선언
│   ├── config/
│   │   └── params.json         // 튜닝 가능 수치 단일 파일
│   ├── css/
│   │   └── style.css           // 전체 레이아웃 + 섹션별 스타일
│   └── js/
│       ├── simulation.js       // 물리 엔진
│       ├── renderer.js         // p5.js 드로잉 (2개 인스턴스)
│       ├── serial.js           // 센서 소스 추상화 (MockSensorSource)
│       ├── logger.js           // CSV 유틸
│       ├── ai-tutor.js         // AI 튜터 대화 UI (Part 3.5)
│       ├── ui.js               // DOM UI 함수 모음 + BYOK 설정
│       └── main.js             // 부팅 + 오케스트레이션
├── firmware/                    // (Phase 3)
└── docs/                        // 설계 문서
```

스크립트 로드 순서 (`index.html`, `defer`):
```
p5.js (CDN) → simulation.js → renderer.js → serial.js →
logger.js → ai-tutor.js → ui.js → main.js
```

`ai-tutor.js`는 **`ui.js`보다 앞**에 로드되어야 한다 — `ui.js`의 `buildAnalysisCSV`가 전역 `aiConversations`를 읽고, `createAnalysisPanel.clear()`가 전역 `resetAllConversations()`를 호출하기 때문.

모듈 시스템 없음 (`<script>` 기반). 각 파일의 최상위 `const`/`function`은 전역 네임스페이스에 노출.

`index.html`에는 별도로 **사이드바 접기 토글만 담당하는 inline `<script>`** (4줄) 가 `<body>` 내부에 있음. 해당 토글은 단일 DOM 조작이라 현재도 inline 유지.

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
- `CYLINDER_LEFT/TOP/BOTTOM/RIGHT` — `BOX_INITIAL_*` 상수 기반
- `HIST_BIN_COUNT` (40), `HIST_TIME_ALPHA` (0.03)

**공개 함수**:
- `createRenderer(box, particleSystem, params, updateFn)` → `{ snapshotHistogramForGhost() }`
  - `section-canvas`에 시뮬 p5 인스턴스 append
  - `histogram-area`에 히스토그램 p5 인스턴스 + 토글 바 append
- `getAndResetFrameCount()` — FPS 측정용
- `spatialSmooth(bins)` — 히스토그램 공간 평활 (5-point 커널 + 경계 3-point fallback)

**내부 (클로저)**:
- 시뮬 p5 `draw()`: `updateFn(dt)` 호출 후 실린더/피스톤/입자/섬광 드로잉
- 히스토그램 p5 `draw()`: 시간 EMA → 공간 평활 → 막대 + ghost polyline + 이론 M-B
- `Flash` 클래스 — 충돌 섬광 수명 관리 (운동량 비례 크기, 입자 색 상속)

#### `serial.js` — 센서 소스 추상화

**클래스**:
- `SensorSource` — 추상 베이스 (`start`, `stop`, `onData` 구독 관리)
- `MockSensorSource extends SensorSource`:
  - 내부 pressure 상태 + Gaussian 노이즈 (σ=0.1)
  - 20Hz (`setInterval 50ms`)로 `{ sensor, value, unit, timestamp }` emit
  - `setPressure(v)` — 슬라이더에서 값 업데이트

**미구현** (Phase 3): `WebSerialSensorSource` — 실 센서 연결, MockSensorSource 대체

#### `logger.js` — CSV 유틸

**함수**:
- `downloadCSV(filename, headerArr, rowsArr)` — 단일 섹션 CSV (측정점 / 연속 로그)
- `downloadRawCSV(filename, content)` — 미리 조립된 다중 섹션 CSV (분석 보고서)
- `csvEscape(val)` — RFC 4180 인용 (쉼표·줄바꿈·쌍따옴표 포함 필드 처리)
- `formatTimestampForFilename(date)` — `YYYY-MM-DD_HH-MM-SS` 포맷

모든 출력에 BOM(`﻿`) 접두 → 엑셀 한글 호환.

#### `ai-tutor.js` — AI 튜터 대화 UI (Part 3.5)

**모듈 상수 / 상태** (전역):
- `aiConversations` — `{ 1, 2, 3, free }` 각각 `{ messages[], tokensIn, tokensOut }`
- `activeQuestion` — 현재 활성 탭 id (문자열 `"1"/"2"/"3"/"free"`, 초기 `"free"`)
- `QUESTION_TEXT` — Q1·Q2·Q3 전체 질문 문자열

**유틸 함수**:
- `escapeHtml(text)` — XSS 방지용 기본 이스케이프
- `renderMinimalMarkdown(text)` — `**bold**`, `*italic*`, 단락 `\n\n`, 줄바꿈 `\n→<br>`

**렌더링**:
- `renderConversation(questionId)` — 빈 상태(자유는 예시 안내, Q1~Q3는 질문 프롬프트 박스) + 메시지 말풍선 리스트 + auto-scroll
- `createMessageElement(msg)` — user/assistant 버블 DOM (아바타·bubble·meta)

**탭 제어**:
- `updateTabAvailability(datapointCount)` — count ≥ 3 이면 Q1~Q3 `aria-disabled="false"`. 자유 탭은 상시 활성. 끝에 `updateInputAvailability()` 호출
- `showTabDisabledToast(q)` — 탭과 컨텍스트 사이에 2.5 초 빨간 안내 삽입("측정점을 3개 이상 기록한 뒤 사용할 수 있습니다")
- `switchToQuestion(questionId)` — 탭 active 토글 + 컨텍스트 라벨/스니펫/class 갱신 + `renderConversation` + `updateInputAvailability`

**대화 + 입력창** (Phase 2-B 완료 — 실 API):
- `sendMessage()` — `activeQuestion`에 user 메시지 push → 타이핑 인디케이터 렌더 → `callAnthropicAPI` 호출 → AI 응답 push → 렌더. 중복 전송 방지 (버튼 disabled)
- `callAnthropicAPI(messages, systemPrompt)` — Anthropic `/v1/messages` `fetch`. 모델·시스템 프롬프트·멀티턴 히스토리 전달. 토큰 usage 반환 → 원화 환산 누적
- `generateQ3Question()` — 측정 데이터 기반 탐구 질문 AI 자동 생성. Q3 탭 빈 상태 버튼에서 호출
- `closeQuestion(qid)` — `[✓ 대화 마무리]` 클릭 시 AI 요약 생성 → 탭 gating 상태 업데이트 (Q1+Q2+Q3 완료 시 보고서 버튼 활성)
- `generateReport()` — 전체 대화 + 측정 데이터 → systemPrompt로 보고서 생성 → docx 조립 (표 + 차트 PNG + AI 본문) → 직접 다운로드
- `updateInputAvailability()` — API 키 + 현재 탭 활성 상태에 따라 input/btn disabled, placeholder 분기
- `resetTabConversation(qid)` — 탭별 [↺] 버튼 핸들러, 해당 세션만 비움
- `resetAllConversations()` — 5개 세션 전부 비우고 현재 탭 재렌더

**Init** (DOMContentLoaded):
- `#btn-toggle-settings` 클릭 → `#ai-settings-panel.open` 토글. API 키 없으면 초기 펼침
- 탭 click → aria-disabled 체크 → 비활성이면 toast, 활성이면 `switchToQuestion`
- `#message-input` input/keydown(Enter·Shift+Enter) / `#btn-send-message` click wiring
- `updateTabAvailability(0)` → `switchToQuestion("free")` 초기화 (main.js fetch 대기 중 탭 깜빡임 방지)

**주의**: `ai-tutor.js`는 textarea 기반 성찰 입력(Part 3 이전)에 의존하지 않는다. Part 3.5에서 왼쪽 textarea를 제거하고 사이드바 입력창 단일 진입점으로 통합됐다.

#### `ui.js` — DOM UI + BYOK 설정

**공개 함수** (각각 독립 UI 단위):
- `createDevPressureSlider(onChange)` → `HTMLElement`
  - 슬라이더(81~230 kPa) + 레이블 + 값 표시를 `control-row-actuators`에 append
- `createInfoPanel()` + `updateInfoPanel(data)`
  - 실측(온도·압력) + 시뮬(속도·충돌·KE) 숫자 패널. `info-panel-area`에 append
- `createTemperatureControl({ ... })`
  - 온도 프리셋(0/25/50/77°C) + 커스텀 입력 + 피드백. `control-row-temperature`에 append
- `createMeasurementPanel({ ... })` → `{ getStabilized, getMeasurementCount, getDatapoints, clearMeasurements }`
  - 현재값 블록(`control-row-actuators`) + 측정 패널(`section-measurements`) + PV 산점도 p5
  - 안정화 감지, 1 초 이동평균 기록, CSV 버튼 2종
- `createAnalysisPanel({ ... })` → `{ refresh, clear }`
  - 요약 + verdict + PV 막대 p5 + [분석 보고서 저장] 버튼 (`section-analysis`)
  - **성찰 textarea는 Part 3.5에서 제거** — 성찰은 사이드바 탭으로 이관

**단위 표시 유틸** (모듈 최상위, Phase 4.6 `feature/responsive-canvas`):
- `formatValueWithUnit(value, digits, unit)` — 단일 단위 HTML 포맷 (기존)
- `kPaToAtm(kPa)` — `kPa / 101.325`
- `particlesToMmol(n)` — `n × 0.006815` (기준 `n₀ = P₀V₀/RT₀ ≈ 2.044 mmol`, 300입자 기준)
- `formatValueDual(value, digits, unit, altValue, altDigits, altUnit)` — 병기 HTML (정보 패널용, `<span class="info-unit">` 래핑 포함)
- `main.js`에서 `textContent` 기반 병기는 인라인 템플릿 리터럴로 직접 작성 (심화 실시간 압력·입자수 표시, §4.4 참조)

**BYOK 설정 함수** (`createAnalysisPanel` 클로저 내부):
- `loadAISettings()` — sessionStorage 3개 키 복원
- `verifyKey()` — Anthropic `/v1/messages` 호출로 키 검증, `pchem_api_key` 저장
- `clearKey()` — 메모리·sessionStorage 키 삭제
- `maskKey(key)` / `showKeyStatus(cls, text)` / `formatApiError(status, msg)`
- `computeCost(model, tokensIn, tokensOut)` — `MODEL_PRICING` 기반 원화 환산
- `updateUsageDisplay()` — `#tokens-used`·`#cost-estimate` 텍스트 갱신
- `buildSystemPrompt(level, questionNum)` / `buildUserPrompt(...)` / `buildDataContext()` — `ai-tutor.js`의 대화 흐름에서 호출되어 실 API 요청 페이로드 조립 (Phase 2-B 완료)
- `buildAnalysisCSV()` — 전역 `aiConversations` 읽어 "AI 튜터 대화" 섹션 포함한 분석 보고서 CSV 생성

**주요 상수** (`createAnalysisPanel` 내부):
- `MODEL_PRICING` — `claude-sonnet-4-6` $3/$15, `claude-opus-4-7` $5/$25 per MTok
- `USD_TO_KRW = 1400`
- `LEVEL_GUIDES` / `QUESTION_FOCUS` / `QUESTION_TEXT` — 프롬프트 빌더 참조용 (`ai-tutor.js`의 `QUESTION_TEXT`와 부분 중복 — 후속 통합 여지 있음)

#### `main.js` — 부팅 + 오케스트레이션

- **모듈 상수**: `REFERENCE_TEMP_K/V_ML/P_KPA/RMS/KE`, `TRANSITION_TAU` (0.3), `CONTINUOUS_MAX_ROWS` (10000), `CONTINUOUS_SAMPLE_INTERVAL_MS` (250), `USE_MOCK_SENSOR` 플래그
- **재생 컨트롤 전역 상태** (Phase 4.6, `feature/responsive-canvas`): `speedMultiplier` (0.25/0.5/1), `isPaused` (bool). 기본/심화 탭 공유. dt 스케일링은 각 탭의 update 루프 진입점에서만 적용 (`scaledDt = dt * speedMultiplier`). 일시정지는 update 콜백 early return. 물리 코드(`simulation.js`, `renderer.js`) 불변.
- **부팅 흐름** (async DOMContentLoaded 내부): `params.json` fetch → Box/ParticleSystem 생성 → MockSensor + slider → `createRenderer` → `createInfoPanel` → `createMeasurementPanel` → 250 ms 연속 로그 `setInterval` → `createAnalysisPanel` → `createTemperatureControl` → 1 s/5 s `setInterval`
- **상태 변수** (DOMContentLoaded 클로저): `smoothedP`, `sessionStartMs`, `currentTempCelsius`, `V0_REFERENCE_AREA`, `V0_current`, `continuousBuffer`, 전이 애니메이션 4변수, `pistonHitsAccumulator`, `continuousHitsAccumulator`, `analysisApi`

---

## 3. 데이터 흐름

### 3.1 부팅 시퀀스

```
1. HTML 로드 → <main> 섹션 5개 + <aside> 사이드바 DOM 선언됨
2. defer 스크립트 순차 실행 → 모듈 최상위 상수·클래스 정의
3. DOMContentLoaded 발생:
   a. ai-tutor.js 리스너 먼저 (등록 순):
      - 설정 패널 토글 wiring + 초기 펼침 (키 없을 때)
      - 탭 click wiring, 입력창 wiring
      - updateTabAvailability(0) → switchToQuestion("free")
        (데이터 로드 전이므로 탭은 회색 상태로 시작)
   b. main.js async 리스너:
      - await params.json fetch
      - Box + ParticleSystem 생성 (300 실입자 + 2700 유령)
      - MockSensorSource + createDevPressureSlider
      - sensor.onData 콜백 + sensor.start() (20 Hz)
      - createRenderer
      - createInfoPanel + 초기 updateInfoPanel
      - createMeasurementPanel (measApi)
      - 250 ms 연속 로그 setInterval
      - createAnalysisPanel → 내부 refresh() → updateTabAvailability(data.length)
      - createTemperatureControl
      - 1 s/5 s setInterval
```

### 3.2 실시간 프레임 사이클 (60 Hz, 시뮬 p5 `draw()`)

```
1. dt = p.deltaTime / 1000, cap 0.05 s
2. updateFn(dt) [main.js 제공]:
   a. system.update(dt)                    // 입자 이동·벽 충돌·입자 간 충돌
   b. box.update(dt, volume_tau_seconds)   // 박스 폭 지수 수렴
   c. system.clampParticlesIntoBox()       // 피스톤 통과 입자 수습
   d. pistonHitsAccumulator += tickHits
      continuousHitsAccumulator += tickHits
   e. 전이 중이면 currentSpeedRatio 갱신 + system.scaleVelocities
3. frameCounter++                           // FPS 측정
4. 충돌 섬광 spawn → update → filter
5. 배경 → 해칭 → 실린더 벽 → 피스톤 → 입자 HSB → 섬광 드로잉
```

히스토그램 p5 `draw()`는 독립 60 Hz로 돌며 `particleSystem.getVelocityHistogram` 읽기만 (상태 변경 없음).

### 3.3 이벤트 기반 주기

| 주기 | 소스 | 동작 |
|---|---|---|
| 20 Hz (50 ms) | Mock 센서 `onData` | smoothedP EWMA + box target + info panel 압력 표시 |
| 20 Hz (50 ms) | 측정 패널 `setInterval` | currentP 표시, V 자동 추종, 안정화 감지, 기록 버튼 상태 |
| 4 Hz (250 ms) | 연속 로그 setInterval | 상태 스냅샷 → continuousBuffer |
| 1 Hz (1 s) | 패널 업데이트 setInterval | 속도·KE 실측 + 이론값 표시 |
| 0.2 Hz (5 s) | 진단 로그 setInterval | 콘솔 FPS·hits/s·overlap + 피스톤 hits 정보 패널 |

### 3.4 측정 사이클 (학생 조작)

```
1. 슬라이더 조작 → MockSensor.setPressure → onData → smoothedP + box target 변화
   동시에: setSessionStart() 첫 호출 → sessionStartMs 고정
   동시에: 슬라이더 input 이벤트 → pHistory/widthHistory 버퍼 비움 → isStabilized=false
2. ≈3~4 초 대기 → 버퍼 재충전 + 수렴 → isStabilized=true → [기록] 버튼 활성
3. 학생 [기록] 클릭:
   a. P = mean(pHistory), V = (학생 편집 없으면) pixelsToML(mean(widthHistory))
   b. datapoints.push({ id, P, V, PV, timestamp, tempK })
   c. renderTable / renderSummary / redrawPVPlot
   d. onDataChange → analysisApi.refresh
   e. refresh 진입부에서 updateTabAvailability(data.length)
      → datapoints >= 3 이면 사이드바 Q1~Q3 탭 활성화
   f. datapoints >= 3 이면 #section-analysis 가시화
4. 필요 시 CSV 다운로드: 측정점 / 연속 로그 / 분석 보고서 3종
   (분석 보고서는 aiConversations 전체를 "AI 튜터 대화" 섹션에 포함)
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
   i. analysisApi.clear() → resetAllConversations() + refresh()
      → aiConversations 4개 세션 전부 초기화, 탭 다시 회색
4. 다음 60 Hz 프레임부터 currentSpeedRatio → targetSpeedRatio 수렴 (0.3 s tau, ~1.5 s)
5. 박스 폭도 0.5 s tau로 수렴 (속도 + V_baseline 모두 이동)
```

### 3.6 AI 대화 사이클 (학생 조작)

```
1. 측정점 3개 이상 기록 후 Q1/Q2/Q3 탭 활성 (또는 자유 탭은 상시)
2. 학생이 탭 클릭 → switchToQuestion → 빈 상태 안내 렌더
3. 입력창에 메시지 작성 + Enter (Shift 없이)
4. sendMessage:
   a. aiConversations[qid].messages.push({ role:"user", content, timestamp })
   b. renderConversation → 학생 말풍선 + 타이핑 인디케이터
   c. callAnthropicAPI(messages, systemPrompt) → `/v1/messages` fetch
   d. 응답 assistant 말풍선 push, 토큰 usage 누적 (원화 환산)
   e. renderConversation → AI 응답 표시 (다른 탭이 활성이면 "new" 뱃지 대신 표시)
   f. 전송 버튼 재활성화. 에러 시 타이핑 인디케이터 제거 + alert
5. 대화 계속 → 8턴 소프트 경고. [✓ 대화 마무리]로 AI 요약 + 탭 완료 처리
6. Q1+Q2+Q3 완료 시 [📄 탐구 보고서 초안 생성] 활성 → docx 다운로드
```

---

## 4. UI 구조 (좌우 2분할 레이아웃)

### 4.1 최상위 레이아웃

`<body>`는 flexbox 2분할: `main-area` (flex:1) + `ai-sidebar` (380 px sticky).

```
<body flex gap:16 padding:16>
  <main id="main-container" class="main-area">   ← 좌: 5 섹션
    <section id="section-controls"> ... </section>
    <section id="section-canvas"> ... </section>
    <section id="section-visuals"> ... </section>
    <section id="section-measurements"> ... </section>
    <section id="section-analysis" class="hidden"> ... </section>
  </main>
  <script> /* btn-ai-collapse 토글 inline (4줄) */ </script>
  <aside id="ai-sidebar" class="ai-sidebar">     ← 우: 380 px sticky
    ... (§4.3)
  </aside>
</body>
```

`body.sidebar-collapsed #ai-sidebar { display: none }` — 접기 상태.

### 4.2 메인 영역 섹션

```
<main id="main-container" class="main-area">
  <section id="section-controls">              // 섹션 1 - 상단 컨트롤
    <div class="control-row-temperature"> 온도 프리셋·커스텀·현재값 </div>
    <div class="control-row-actuators">
      <div id="dev-pressure-slider"> 슬라이더·레이블·값 </div>
      <div id="current-reading-block"> P·V·[기록]·안정화 힌트 </div>
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
      <table id="datapoints-table">...</table>
      <div id="measurement-summary">...</div>
    </div>
    <div id="pv-plot-area">                     //   우: PV 산점도
      <div class="plot-toggles">...</div>
      <div id="pv-plot-canvas-wrap"><canvas>...</canvas></div>
    </div>
  </section>

  <section id="section-analysis" class="hidden">  // 섹션 5 - 조건부 가시
    이번 세션 요약 + 보일 법칙 검증 verdict +
    PV 막대 canvas + [분석 보고서 저장] 버튼
  </section>
</main>
```

`.hidden { display: none }` — 분석 섹션은 `datapoints.length >= 3` 일 때만 가시. Part 3.5부터 **성찰 textarea는 완전 제거**됨 (사이드바 대화로 통합).

### 4.3 AI 사이드바 (Part 3.5)

```
<aside id="ai-sidebar" class="ai-sidebar">                  // 380 px sticky
  <header class="sidebar-header">
    <h2>🤖 AI 튜터</h2>
    <div class="header-actions">
      <button id="btn-toggle-settings">⚙</button>
      <button id="btn-ai-collapse">×</button>
    </div>
  </header>

  <div id="ai-settings-panel" class="settings-panel">       // 접이식 (max-height 트랜지션)
    <div class="key-section">
      <input id="ai-api-key" type="password">
      <button id="btn-verify-key">저장 및 검증</button>
      <button id="btn-clear-key">키 삭제</button>
      <span id="key-status"></span>
    </div>
    <div class="options-row">
      <select id="ai-student-level">middle/high/univ</select>
      <select id="ai-model">sonnet/opus</select>
    </div>
    <div class="warning-banner"> API 키 안내 </div>
    <div class="usage-display">
      <span id="tokens-used">0</span> 토큰 / <span id="cost-estimate">0</span>원
    </div>
  </div>

  <div class="sidebar-body">                                // flex column, flex:1
    <nav class="question-tabs">
      Q1 | Q2 | Q3 | 💬 자유                               // aria-disabled 로 gating
    </nav>
    <div class="question-context" id="question-context">
      <small>현재 대화 주제:</small>
      <p class="question-snippet" id="question-snippet"></p>
    </div>
    <div class="conversation-scroll" id="conversation-scroll">  // overflow-y: auto
      <div class="empty-state" id="conversation-empty">...</div>
      <div class="messages-list" id="messages-list">
        <!-- 동적 .message.user-message / .ai-message 버블 -->
      </div>
    </div>
  </div>

  <div class="message-input-area">                          // flex-shrink: 0
    <textarea id="message-input" rows="2" disabled></textarea>
    <button id="btn-send-message" disabled>↑</button>
  </div>
</aside>
```

- 탭 4개: Q1/Q2/Q3는 `datapoints.length >= 3` 일 때 활성 (`aria-disabled="false"`), 자유는 상시
- 비활성 탭 클릭 시 2.5 초 안내 toast (`.tab-disabled-hint`) 탭 바로 아래 삽입
- 입력창 활성 조건: API 키 존재 + 현재 탭 활성
- 설정 패널 초기 상태: API 키 없으면 자동 펼침 (`.open`), 있으면 접힘

### 4.4 레이아웃 shift 방지 + 반응형 동작 (Phase 4.6)

**레이아웃 shift 방지 (기존)**
- **슬라이더 고정 폭 420 px** + 안정화 힌트 `visibility` 토글 + 힌트 공간 예약 120 px
- 모든 수치 표시에 `min-width` + `text-align: right`
- 상세는 `04-simulation-physics.md` §9 참조

**반응형 브레이크포인트 (Phase 4.6, `feature/responsive-canvas`)**

`feature/responsive-canvas`에서 4단계 @media 블록을 CSS에 추가. **물리 코드·HTML 구조·p5 `createCanvas` 값 전부 불변**. 각 브레이크포인트는 독립 블록으로 배치되어 단계별 롤백 가능.

| 브레이크포인트 | 블록 이름 | 변경 내용 |
|---|---|---|
| `≥1920px` | — | 기존 push 모드 레이아웃 그대로 |
| `≤1919px` | Step 2a | 심화 탭 `#adv-section-canvas`를 column 방향, 트래커 칼럼 가운데 정렬 |
| `≤1599px` | Step 1 | `#ai-sidebar`/`#adv-ai-sidebar`를 `position:fixed` drawer로 전환 (top:74, right:0, max-height calc, overflow:hidden, translateX 슬라이드) |
| `≤1279px` | Step 2b | 모든 p5 `<canvas>`에 `max-width:100%; height:auto` (내부 비트맵 불변, CSS 축소만) |
| `≤1023px` | Step 2c | `#section-visuals`, `#adv-section-visuals`, `#section-measurements`, `#adv-section-measurements` flex-direction:column |

**사이드바 높이 정책 (Push / Overlay 공통 "떠있는 카드")**
- Push 모드(≥1600px): `height: min(720px, calc(100vh - 32px))` — 이전 꽉 채움(~1048px)에서 **720px로 축소**하여 입력창을 자연스러운 시선 영역으로 끌어올림
- Overlay 모드(<1600px): `top: 74px` (본문 첫 카드와 y좌표 정렬) + `max-height: calc(100vh - 106px)` + `translateX(0/100%)` 슬라이드
- 양 모드 모두 `overflow: hidden` (라운드 모서리 보호). 내부 `.conversation-scroll`이 `overflow-y: auto`로 메시지 스크롤 담당

**첫 로드 자동 overlay 닫힘** (`main.js` 상단):
```js
const _narrowViewport = window.innerWidth < 1600;
document.body.classList.toggle("sidebar-collapsed", _narrowViewport);
document.body.classList.toggle("adv-sidebar-collapsed", _narrowViewport);
```
- `defer` 스크립트라 첫 페인트 전에 실행 → FOUC 없음
- 리사이즈 이벤트 리스너는 미구현 (현 단계에서 의도적 보류)

**남은 작업**: 동적 리사이즈 시 (1920 ↔ 1440 실시간 전환) 사이드바 클래스 재평가 없음. 한 번의 클릭으로 복구 가능하므로 실사용에 영향 경미.

---

## 5. 기술 스택

### 5.1 확정된 기술

| 계층 | 기술 | 근거 |
|---|---|---|
| 시뮬레이션 | p5.js v1.11.2 (CDN) | 교육용 레퍼런스 풍부, RAF + canvas 래핑 단순, 2개 인스턴스 자연스럽게 공존 |
| UI | HTML + CSS + Vanilla JS | 프레임워크 오버헤드 없음, `<script defer>`로 로드 |
| 설정 | `params.json` 단일 파일 | MVP 규모에 계층 분리 불필요 |
| 데이터 | 메모리 내 배열 + 브라우저 CSV 다운로드 | 프라이버시·설치 무부담 |
| AI 튜터 | Anthropic Claude API (BYOK) | 브라우저 직접 호출, `anthropic-dangerous-direct-browser-access` 헤더, sessionStorage 키 |
| 펌웨어 | Arduino C++ (Phase 3) | 표준, SEN0257 레퍼런스 풍부 |

### 5.2 미정 / 유보

- **Web Serial API 통신**: Phase 3에서 MockSensorSource 교체
- **빌드 도구**: 현재 없음 (pure JS, 모듈 미사용). 타입 검사·번들링 필요성 생기면 도입 고려

---

## 6. 모듈 간 의존성

```
main.js
 ├─→ simulation.js   (Box, ParticleSystem, DEFAULT_SPEED_SCALE, BOX_INITIAL_* 등)
 ├─→ renderer.js     (createRenderer, getAndResetFrameCount)
 ├─→ serial.js       (MockSensorSource)
 ├─→ logger.js       (downloadCSV, formatTimestampForFilename — 연속 로그 CSV)
 └─→ ui.js           (createDevPressureSlider, createInfoPanel, updateInfoPanel,
                      createMeasurementPanel, createTemperatureControl, createAnalysisPanel)

ui.js
 ├─→ logger.js       (downloadCSV, downloadRawCSV, csvEscape, formatTimestampForFilename)
 ├─→ ai-tutor.js     (aiConversations [read], updateTabAvailability,
                      updateInputAvailability, resetAllConversations — 모두 typeof 가드)
 └─→ main.js 상수    (REFERENCE_P_KPA, REFERENCE_V_ML — 크로스 모듈)

ai-tutor.js
 └─→ (독립) simulation/renderer/serial/logger 비의존. DOM만 조작.

renderer.js
 └─→ simulation.js   (BOX_INITIAL_*, BOX_MAX_WIDTH)

simulation.js / serial.js / logger.js — 독립 (상호 참조 없음)
```

**`ui.js → ai-tutor.js` 역방향 호출 지점** (모두 `typeof === "function"` 가드):
- `createAnalysisPanel.refresh()` 진입부 → `updateTabAvailability(data.length)`
- `createAnalysisPanel.clear()` → `resetAllConversations()`
- `verifyKey()` 성공 / `clearKey()` → `updateInputAvailability()`
- `buildAnalysisCSV()` → 전역 `aiConversations` 직접 읽기 (가드 없음, 항상 존재 가정)

가드 덕분에 `ai-tutor.js` 로드 실패 시에도 측정·분석 코어 기능은 동작.

**크로스 모듈 상수 참조**: `<script>` 전역 네임스페이스. `defer` 로드 순서로 선언·호출 시점 보장됨 (ai-tutor.js → ui.js → main.js).

---

## 7. Phase별 로드맵 (아키텍처 관점)

자세한 Phase 계획은 `docs/06-project-status.md` §3~§4 참조.

### 7.1 Phase 2-B — AI 튜터 실 API 연동 (완료, v0.3-ai-tutor-live)

완료 항목:
- `ai-tutor.js`의 `callAnthropicAPI` 도입 → Anthropic `/v1/messages` 직접 호출
- 멀티턴 대화 히스토리 누적 전송, 탭별 독립 세션
- 타이핑 인디케이터, 에러 처리 (401/429/529/0), 토큰·비용 누적 표시, 비용 경고 배너 (100원/500원), 탭별 [↺] 초기화 버튼
- Q3 AI 자동 질문 생성, Q4 탭 신설, [✓ 대화 마무리] + AI 요약, 8턴 소프트 경고, cross-tab 렌더 가드 + "new" 뱃지
- 측정점 테이블에 v̄·충돌/s 컬럼, 차트 3개 (PV / v̄ vs P / 충돌/s vs P)
- 유령 입자 피스톤 충돌 카운트 포함 (`getTotalPistonCollisionCount`)
- docx 보고서 자동 생성 (docx.js 8.5.0 UMD, SVG → PNG → ImageRun)

후속 정리 여지 (블로커 아님): `QUESTION_TEXT` ai-tutor.js/ui.js 중복, `ui.js`의 `buildSystemPrompt` 경로 정리

### 7.2 Phase 3 — 보일 실물 통합

- ESP32 펌웨어 (SEN0257, 20 Hz JSON 스트림, hello 핸드셰이크 `{ type, device }`)
- `WebSerialSensorSource` 구현 — `serial.js`에 `SensorSource` 서브클래스 추가
- `USE_MOCK_SENSOR` 플래그 off → 실센서 모드
- 캘리브레이션 UI (영점·2점 보정), 연결 관리 UI (포트 선택·재연결·실패 안내)

### 7.3 Phase 4 — 비교 UX

- Mock ↔ 실센서 병행 표시 (전환 토글)
- **반데르발스 편차 교육 활용** (v1 탄성 충돌 부산물로 이미 +16 % 재현됨 — `06` §7 참조)
- 이상기체 vs 실제 기체 비교 그래프

### 7.4 Phase 5 — 다른 법칙

- 샤를 법칙 — 별도 장비 (`02-hardware-charles.md`)
- **실험 선택 화면** 루트 페이지
- **폴더 구조 재편**:
  - `web/js/engine/` — 공통 Particle·Box·ParticleSystem
  - `web/js/experiments/boyle/` + `experiments/charles/`
  - 공통 UI 컴포넌트 `web/js/ui/common/`
  - `experiments.json` — 실험별 기본값·상수 분리

### 7.5 Phase 6 — 교사 도구

- 학생 활동 모니터링 대시보드
- 다중 사용자 지원 (서버·DB 필요, 아키텍처 변화 수반)
