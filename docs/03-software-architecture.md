# 03. 소프트웨어 아키텍처

**문서 목적**: 웹 애플리케이션의 모듈 구성, 역할 분담, 데이터 흐름, 기술 스택을 정의한다. 현재 Part 3.5 구현 현황과 이후 Phase 계획을 구분한다.

---

## 1. 시스템 개요

### 1.1 현재 범위

- **4 페이지 분리** (랜딩 / 보일 / 입자운동 / 돌턴) — `<body data-page="...">` 디스패처. 단일 `web/js/*.js` 번들 공유.
- **3 모드 센서** (mock / ws-에뮬레이터 / real-WebSerial) — 모든 페이지 런타임 전환. `tools/firmware-emulator/` (Node.js + ws) + ESP32 펌웨어 (`firmware/boyle/boyle.ino`, DFRobot Gravity 1.6MPa) 양쪽 v1.2 프로토콜 송신.
- **Phase 3 소프트웨어 완료** (실물 조립·검증만 하드웨어 대기). **Phase 5.1 + 5.2 + 5.3 완료** (돌턴 학습 기능). **Phase 5.4 진행 중** (실센서 사전 준비 — multi-channel SensorSource + outlier 가드 + A-1 노이즈 시나리오 + 외부화 5 상수). 현재 진행 상태 권위 = `docs/06-project-status.md`.
- **브라우저**: Chrome / Edge (Web Serial API 실센서 모드 필수, mock / ws 모드는 무관).
- **AI 튜터**: Phase 2-B 완료. Anthropic Messages API 직접 호출 (BYOK, sessionStorage). 보일 = `ai-tutor.js` 모듈 전역 (전역 `aiConversations` 등) / 입자운동 = `createAdvTutorPanel` closure (`ui.js`) / 돌턴 = `createDaltonTutor` closure (`ui.js`) — 시뮬별 분리.

### 1.2 구조 도식

```
[mock 시뮬 본체]   [ws 에뮬레이터 + A-1 노이즈]   [real ESP32 + DFRobot 1.6MPa]
 setPressureImmediate    tools/firmware-emulator/    firmware/boyle/boyle.ino
 (deterministic, 60 Hz)  ws://localhost:8787         Web Serial @115200
        │                          │ v1.2 JSON                │ v1.2 JSON
        │                          └─────────┬────────────────┘
        │                                    ↓ 5 Hz/ch (200 ms)
        │                  [protocol.js · parseV11Line — Pa→kPa, ch 분기]
        │                                    ↓
        └───────► [SensorSource — Mock / WebSocket / WebSerial · serial.js]
                                             ↓
                  [createSensorManager — outlier 가드 5 단계 + 캘리브 offset]
                                             ↓ onChannelData(ch, cb)
            ws/real: EMA α=0.2 → 임계값 2 kPa → 점진 입자 보정
            mock:    α=1 (즉시) + 임계값 우회 — 시뮬 본체 deterministic
                                             ↓
[웹 앱 (4 페이지, body[data-page] 디스패처)]
  ├─ simulation.js                — Particle / Box / ParticleSystem (boyle, particles)
  ├─ dalton 5 region (main.js)    — Particle 만 재사용, 자체 physicsStep
  ├─ renderer.js                   — p5 시뮬 + 히스토그램
  ├─ ui.js                         — 슬라이더 / 온도 / 측정 / PV / BYOK
  ├─ AI 튜터 (보일=ai-tutor.js 모듈 전역 / 입자운동=createAdvTutorPanel / 돌턴=createDaltonTutor)
  ├─ logger.js                    — CSV
  └─ main.js                       — initBasicApp / initAdvancedMode / initDaltonApp
```

### 1.3 이후 Phase 계획

현재 진행 상태 권위 = `docs/06-project-status.md`. 본 문서는 아키텍처 관점 요약만:
- **Phase 2-B / 3 SW / 5.1~5.3 완료**. Phase 3 의 ESP32 실센서 / Web Serial / WebSocket 에뮬 모두 SW 측 완성, 실물 조립·검증만 대기.
- **Phase 5.4 진행 중** (`phase5-real-sensor`): protocol v1.2 + multi-channel SensorSource (mock/ws/real 단일 경로) + outlier 가드 5 단계 + A-1 노이즈 시나리오 + `params.dalton.sensor` 5 상수 외부화 + AI 튜터 정합화. 본 문서 §2 / §3 의 sensor 시스템 갱신 = Phase 5.4 결과.
- **폴더 재편** (Phase 6+ 이연): `experiments/` 분리 / 공통 `engine/` / 시뮬별 `experiments/{boyle,particles,dalton}/`. 현재는 **플랫 + body[data-page] 디스패처** 유지.

상세 Phase 별 / 다음 단계 / 병합 대기 브랜치 = `docs/06-project-status.md`.

---

## 2. 모듈 구성 (현 구현)

### 2.1 폴더 구조

```
pchem-lab-project/
├── web/
│   ├── index.html              // 🏠 랜딩 (CAST 로고 + 실험 선택 + API 키 설정)
│   ├── boyle.html              // 🔬 보일의 법칙 (MBL·시뮬·AI), <body data-page="boyle">
│   ├── particles.html          // ⚗️ 입자운동론 (시뮬·AI), <body data-page="particles">
│   ├── dalton.html             // 🧪 돌턴의 부분압력 (Phase 5.3 완료), <body data-page="dalton">
│   ├── config/
│   │   └── params.json         // 튜닝 가능 수치 단일 파일 (`dalton` 키 포함)
│   ├── css/
│   │   └── style.css           // 4 페이지 공유 전체 스타일
│   └── js/                     // 4 페이지가 전부 공유, body.dataset.page 로 분기
│       ├── simulation.js       // 물리 엔진 (Box, Particle, ParticleSystem)
│       ├── renderer.js         // p5.js 드로잉 원시
│       ├── protocol.js         // v1.2 파서 공통 모듈 (parseV11Line — t:s/t:d/t:c/t:e, Pa→kPa)
│       ├── serial.js           // SensorSource (Mock/WebSerial/WebSocket) + createSensorManager
│       │                       //   + outlier 가드 5 단계 (Phase 5.4)
│       ├── logger.js           // CSV 유틸
│       ├── ai-tutor.js         // 보일 전용 AI 튜터 (입자운동·돌턴은 자체 closure 패턴 — createAdvTutorPanel·createDaltonTutor)
│       ├── ui.js               // DOM UI + 심화(adv-) AI 튜터·측정 패널
│       └── main.js             // 부팅 디스패처 + initBasicApp / initAdvancedMode / initDaltonApp
├── firmware/
│   ├── boyle/boyle.ino          // ESP32 펌웨어 (DFRobot Gravity 1.6MPa, v1.2 송신, 5 Hz)
│   └── README.md                // 배선·Wokwi 검증
├── tools/
│   └── firmware-emulator/
│       ├── emulator.js          // Node.js + ws (포트 8787, v1.2 송신, A-1 노이즈 4 모드)
│       ├── baseline.js          // 노이즈 특성 정량화 스크립트 (Phase 5.4 A-2)
│       ├── package.json         // ws@^8.20.0 단일 의존성
│       └── README.md            // 에뮬레이터 권위 문서 (CLI 키 / 노이즈 / 시나리오 추가법)
├── tests/
│   ├── dalton-collision-test.js // Phase 5.3 입자간 충돌 7 검증 (보존·Equipartition·Graham·M-B·안정성)
│   └── dalton-collision-test-result.txt
└── docs/                        // 설계 문서 00~19 (12-protocol / 13-multi-channel /
                                 // 14-calibration / 15-params / 16-onboarding /
                                 // 19-checklist 신규)
```

**페이지 디스패처 패턴** (`main.js` DOMContentLoaded):
```javascript
const page = document.body.dataset.page;
if      (page === "particles") initAdvancedMode(params);
else if (page === "dalton")    initDaltonApp(params);
else                           await initBasicApp(params);   // boyle 또는 기본값
```
- 4 페이지가 같은 `main.js` 를 로드하되 `<body data-page>` 로 해당 초기화만 실행
- 신규 실험 추가 시 `data-page="..."` 분기 한 줄 추가 패턴 유지 (돌턴은 Phase 5.1 에서 편입)
- 랜딩(`index.html`)은 `main.js` 를 로드하지 않음 — 자체 인라인 `<script>` 로 API 키 저장만 처리

스크립트 로드 순서 (`boyle.html` / `particles.html`, `defer`):
```
p5.js (CDN) → docx (CDN) → simulation.js → renderer.js → protocol.js →
serial.js → logger.js → ai-tutor.js → ui.js → main.js
```
`particles.html` 에선 센서·보고서 관련 스크립트가 실제로 호출되지 않지만
단일 CSS/JS 번들 유지를 위해 동일 로드. CDN 캐시 재사용으로 실질 비용 미미.

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

#### `serial.js` — 센서 소스 + 매니저 + outlier 가드

**모듈 상수** (Phase 5.4 outlier 가드, line 5-15):
- `GUARD_NEGATIVE_THRESHOLD_KPA = 0`, `GUARD_SATURATION_KPA = 1600`
- `GUARD_MEDIAN_WINDOW = 3`, `GUARD_WARN_INTERVAL_MS = 1000`
- `P_ATM_KPA = 101.325` (캘리브 기준값)

**클래스 4 종**:
- `SensorSource` — 추상 베이스 (`connect` / `disconnect` / `onData` / `on` 구독, `sendCalib` / `sendConfig` no-op 기본)
- `MockSensorSource extends SensorSource`:
  - 채널 배열 (`{ ch, pressure, label }`) + interval emit (기본 50 ms = 20 Hz, σ=0.1 kPa, `params.dalton.sensor.mock_*` 외부화)
  - `setPressure(v, ch)` — 슬라이더 / dev 모드 갱신
  - `setPressureImmediate(v, ch)` ★ — Phase 5.4 commit iii. 시뮬 본체가 매 frame 호출 (mock 모드 전용, deterministic. 노이즈·임계값 우회)
- `WebSocketSensorSource extends SensorSource` — 에뮬레이터 연결 (`ws://localhost:8787`, hello timeout 3s, ping 2s)
- `WebSerialSensorSource extends SensorSource` — 실센서 (`navigator.serial.requestPort`, baud 115200, line buffer 4096 자))

**`createSensorManager(config)` factory** (Phase 5.4):
- swappable source + 캘리브 offset + outlier 가드 + 채널별 라우팅
- `setMode(mode)` — `mock` / `ws` / `real` 런타임 전환. 모드 전환 시 calib offset / outlier state 리셋
- `onData(cb)` — 모든 채널 data (보일 하위 호환)
- `onChannelData(ch, cb)` ★ — 특정 ch 만 필터링 (돌턴 ch0=B / ch1=A 분리)
- `on(type, cb)` — `connect` / `disconnect` / `calibrated` / `error` 이벤트
- `sendCalib(ch?)` / `sendConfig(rateMs)` — source 위임
- 내부 메서드 `_dispatchData` → **outlier 가드 → 캘리브 → dispatch** 순 (clean 값에 캘리브)
- 내부 메서드 `_applyOutlierGuard(rawData)` — 5 단계 (NaN drop / 음수 reject / saturation clip / median(3) spike / lastValid 갱신). 상세 = §3.8

**의사결정 근거** (왜 매니저 / 왜 단일 위치 가드 / 왜 mock setPressureImmediate 분리) = `docs/10-dev-journal.md` Phase 5.4 결정 블록 권위.

**v1.0 / v1.1 호환** (`protocol.js` 분기): `t` 필드 없는 메시지 → v1.0 fallback. `channels` 배열 없는 hello → v1.1 단일 채널 모드. 자세히 = `docs/12-protocol-v1.2.md`.

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
- **재생 컨트롤 전역 상태** (Phase 4.6, `feature/responsive-canvas`): `speedMultiplier` (0.25/0.5/1), `isPaused` (bool). `main.js` 최상위 `let` 에 정의되어 보일/입자운동 두 페이지가 공유 (현재 구조에선 두 페이지가 동시 로드되지 않으므로 실질적으로 각 페이지 독립 상태). dt 스케일링은 각 페이지 update 루프 진입점에서만 적용 (`scaledDt = dt * speedMultiplier`). 일시정지는 update 콜백 early return. 물리 코드(`simulation.js`, `renderer.js`) 불변.
- **부팅 흐름** (async DOMContentLoaded 내부): `params.json` fetch → Box/ParticleSystem 생성 → MockSensor + slider → `createRenderer` → `createInfoPanel` → `createMeasurementPanel` → 250 ms 연속 로그 `setInterval` → `createAnalysisPanel` → `createTemperatureControl` → 1 s/5 s `setInterval`
- **상태 변수** (DOMContentLoaded 클로저): `smoothedP`, `sessionStartMs`, `currentTempCelsius`, `V0_REFERENCE_AREA`, `V0_current`, `continuousBuffer`, 전이 애니메이션 4변수, `pistonHitsAccumulator`, `continuousHitsAccumulator`, `analysisApi`

**dalton 영역 신규 함수 25개** (Phase 5.2 Step C-1~C-3, `initDaltonApp` closure 안):
- 물리: `physicsStep`, `physicsSubstep`, `getRegion`, `rescueParticleFromNull`
- 시각: `drawDaltonScene`, `drawSyringe`, `drawConnectorTube`, `drawParticlesByGas`
- 주입: `runInjectionAnimation`, `startInjectionTransfer`, `updateInjectionTransfer`, `teleportToR5NozzleEntry`, `finalizeInjectedVolume`, `forceRemainingToR5`
- 부분 압력: `countR5ParticlesByGas`, `updatePartialPressureList`
- 박스·보간: `computeBox`, `updateBox`, `lerpDisplayedVolumes`, `volumeToPistonY`
- 가스: `getGasData`, `getGasColor`, `rebuildParticleSystem`, `rebuildAllSystems`
- 카운트: `countParticlesInRegions`

**dalton sensor 통합 함수** (Phase 5.4, `initDaltonApp` closure 안):
- `daltonSensorManager` (createSensorManager 인스턴스, 멀티채널 config + `params.dalton.sensor` 외부화 5 상수 전달)
- `daltonSensorManager.onChannelData(0, cb)` / `onChannelData(1, cb)` — ch0=B / ch1=A 라우팅 + EMA + 임계값 + freeze 가드 (mock 차등은 §3.7)
- `applyEMA(prev, next)` (`EMA_ALPHA=0.2`)
- `maybeUpdateParticleTarget(side, force, forceThreshold)` — `PARTICLE_UPDATE_THRESHOLD_KPA=2.0` 임계값 + stage IDLE/STABILIZING 만 갱신 + freeze 가드
- `stepParticleCounts()` — `targetParticles_A/B` 향해 매 frame ±2 입자 점진 보정
- 모드 토글 wiring (`main.js:1055-1115`) — `btnModeMock/Ws/Real` 클릭 → `setMode("mock"|"ws"|"real")` + UI 분기 (calibUI / freezeUI / channelStatus)
- 캘리브 wiring — `btnCalibCh0/Ch1/All` → `daltonSensorManager.sendCalib(ch?)`. ACK 수신 시 `_handleCalibrated` (`serial.js:503-510`) 가 offset 갱신

**`USE_MOCK_SENSOR` 플래그**: Phase 5.4 에서 제거. 3-mode 토글 (`setMode`) 로 대체.

**simulation.js 재사용 패턴**: dalton 은 `Particle` 클래스 (위치·속도·반지름·gasKey) 만 재사용. `ParticleSystem` 미사용 — 5 region 모델은 boyle 의 1 region 과 본질 다름. dalton 자체 `physicsStep`/`physicsSubstep` 으로 처리.

### 2.X vapor.js — 증기압 시뮬 본체 (Phase 6.1-b finalization, 2026-05-09)

**역할**: vapor 페이지 (`web/vapor.html`) 시뮬 본체. main.js `initVaporApp` 안 `mountVaporSketch` 호출.

**시뮬 모델 (정공법 회귀 끝, 5+ 회 시도-폐기 사이클 후)**:
- **액체 내부** = 정적 격자 (V_liquid 영역 빈틈없이, 위치 고정 ±0.5 px 미세 진동, 사라지지 X). 운동 X.
- **표면 한 줄** = 동적 (격자 위 경계, 좌우 ±2 px sinusoidal). 매 frame `random() < evap_rate × dt` Poisson 평가 → GasParticle 생성.
- **기체** = 자유 비행 (시작 0, hard sphere 분자-분자 충돌 + 박스 hard wall + 약 중력). KE HSB 색 → fixup 15o `#60a5fa` 단일.
- **Ghost particle** (보일 패턴 재사용): visible 80 + ghost 800 = 880 모두 게이트, visible 만 렌더. 통계 √N 흡수 (잡음 √0.7 ≈ 0.84× ↓).

**핵심 메서드**:
- `world.pressureKPa` getter — 단일 측정값 모드별 source 분기 (mock=시뮬값, real=실측값). DOM 보존, source 만 교체.
- `world.confirmEquilibrium()` — 5-state machine + 학생 [평형 확정] 버튼 (Phase 6.1-b fixup 15n dual-layer 정공법).
- `world.setTemperature(T)` — Boltzmann factor `evap_rate(T) = base × exp(E_a × (1 - T_ref/T))`. fixup 15e EMA reset 폐기 (자연 수렴).

**5-state 평형 머신** (Phase 6.1-b fixup 15n): `none / near / detected / confirmed / exited`. detected (시뮬 자동 hold 10s) ≠ confirmed (학생 명시 [확정] 클릭).

cross-ref `docs/17-vapor-design.md` §6 (시뮬 명세 fixup 15+ 17 sub-section) + §13 (학생 평형 결정 메커니즘 5-state).

### 2.X tutor.js factory — 4 페이지 통합 (Phase 5.7 트랙 6 + Phase 6.4 fixup 17a)

**역할**: 보일 (ai-tutor.js 모듈 전역) / 입자운동 (ui.js createAdvAiTutor closure) / 돌턴 (main.js createDaltonTutor nested closure) 의 3 패턴 분산 통합. 단일 factory `createTutor(config)` + 공통 상수 + 헬퍼.

**page-specific config**:
- **boyle**: ai-tutor.js Hybrid wrapper (Phase 5.7 트랙 6-a-2).
- **particles**: ui.js createAdvAiTutor Hybrid wrapper (트랙 6-b).
- **dalton**: main.js createDaltonTutor Hybrid wrapper (트랙 6-c).
- **vapor**: main.js initVaporTutor `vaporConfig` (Phase 6.4 fixup 17a) — `tutor.js` 자체 변경 0 (factory + 공통 logic 그대로).

**vapor 통합 본질**: tutor.js 헤더 docstring "Phase 6.4 예약" (Phase 6.1-a `b3972b3` 선언) → fixup 17a 실행. **silent regression 패턴**: fixup 17a 시 `vaporTutor.init()` 1줄 누락 = 모든 핸들러 미바인딩 silent fail (visible 에러 X). fixup 17b 진단 시 dalton:3492 비교로 발견.

cross-ref `docs/07-ai-tutor.md` §4.6.5 (vapor AI 튜터 통합 자세) + `docs/17-vapor-design.md` §14 (vaporConfig + buildDataContext + 4 데이터 소스 분기 Phase 6.3 예약).

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
| 60 Hz (frame) | mock setPressureImmediate (시뮬 본체) | deterministic P 갱신 → onChannelData(mock 분기) → 즉시 반영 (α=1, 임계값 우회) |
| 20 Hz (50 ms) | mock interval (`mock_interval_ms`, σ=0.1 kPa) | 노이즈 보존용 추가 emit (mock 모드만) |
| 5 Hz/ch (200 ms) | ws/real (펌웨어/에뮬 송신) | parseV11Line → outlier 가드 5 단계 → 캘리브 → onChannelData → EMA(α=0.2) → 임계값(2 kPa) → 점진 입자 보정 |
| 20 Hz (50 ms) | 측정 패널 `setInterval` | currentP 표시, V 자동 추종, 안정화 감지, 기록 버튼 상태 |
| 4 Hz (250 ms) | 연속 로그 setInterval | 상태 스냅샷 → continuousBuffer |
| 1 Hz (1 s) | 패널 업데이트 setInterval | 속도·KE 실측 + 이론값 표시 |
| 0.2 Hz (5 s) | 진단 로그 setInterval (`DEBUG_DIAGNOSTICS` 게이팅) | 콘솔 FPS·hits/s·overlap |

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

### 3.4-D 돌턴 측정 사이클 (요약)

상세 stage machine = `docs/11-dalton-design.md`. 본 문서 요약:

```
IDLE → [주입 시작] → INJECTING (애니메이션 3 s)
     → INJECTED → 안정화 카운트다운 5 s → [확인] → CONFIRMED
     → [초기화] → IDLE 복귀
```

각 stage 의 sensor 처리 차등:
- `IDLE` / `STABILIZING` — `maybeUpdateParticleTarget` 갱신 (EMA + 임계값)
- `INJECTING` — particle target 갱신 차단 (애니메이션 우선)
- `INJECTED` / `CONFIRMED` — V_A=0 → P_A 게이지 "—" 표시 (`updatePressureReadouts` stage 분기)
- `pressureFrozen` (압력 확정 토글) — 모든 stage 에서 갱신 차단, frozen 값 유지

### 3.7 mock vs ws/real 정책 차등 (Phase 5.4 핵심)

같은 `onChannelData` 콜백이 모드별로 다른 정책 적용 (`main.js:965-986`):

| 영역 | mock | ws / real |
|---|---|---|
| **데이터 출처** | 시뮬 본체 PV=k 강제 (`setPressureImmediate`) + interval σ=0.1 kPa | 펌웨어 / 에뮬 송신 (5 Hz/ch, Pa) |
| **EMA α** | 1.0 (즉시 반영, 평활 X) | 0.2 (`params.dalton.sensor.ema_alpha`, 시정수 ≈ 1 s @ 5 Hz) |
| **임계값** | 우회 (`forceThreshold=true`) | 2.0 kPa (`particle_update_threshold_kpa`) |
| **freeze 가드** | 비대상 (mock 은 시뮬 본체가 freeze 인지) | `pressureFrozen` 시 갱신 차단 |
| **outlier 가드 발동** | 거의 X (σ=0.1 → 음수 / saturation 도달 X) | 발동 가능 (실측 σ 추정 2~4 kPa, A-1 spike / clip 등) |
| **결정론** | 보존 (시뮬 정확도 우선) | 평활 (실물 노이즈 흡수) |

**의사결정 근거**: mock = 학습 시 시뮬 정확성 / 결정론적 동작 우선. ws/real = 실물 노이즈 흡수 + 입자 시각 깜박임 회피. 상세 = `docs/10-dev-journal.md` Phase 5.4 commit iii (mock 일원화) + commit iv (5 상수 외부화) 결정 블록.

### 3.8 outlier 가드 5 단계 (Phase 5.4)

`createSensorManager._dispatchData` 단일 위치에 silent guard. ws/real 모드 견고성 + A-1 노이즈 모드 양립:

```
data → _applyOutlierGuard:
  1. NaN / undefined / null    → silent drop (return null)
  2. value ≤ 0 kPa             → 이전 유효값 유지 (없으면 drop) + warn(1/sec)
  3. value ≥ 1600 kPa          → 1600 으로 clip + warn(1/sec)
  4. median(3) spike filter   → 3-sample 윈도우 채워지면 median 적용 (latency 0.6 s)
  5. _lastValidValue[ch] 갱신
→ _applyCalibration → dispatch
```

**상태 변수** (채널별 dict): `_lastValidValue[ch]`, `_medianBuffer[ch]`, `_lastWarnTime[ch_type]`. `setMode` 시 모두 리셋.

**A-1 정합성**: silent (콘솔 only, UI 알림 X) → harsh 모드 spike 차단 자체가 견고성 입증. mock 영향 거의 X (σ=0.1 kPa). 상세 = `tools/firmware-emulator/README.md` §4 + `docs/10-dev-journal.md` outlier 가드 결정 블록.

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

#### 4.2.1 돌턴 sensor panel

좌측 컨트롤 패널 최상단 별 section (`#dalton-sensor-panel`). Phase 5.4 신규. 권위 = `web/dalton.html:35-72`.

구성 요소:
- 3-mode 토글 — `mock` (`btn-mode-mock`) / `ws` (`btn-mode-ws`) / `real` (`btn-mode-real`)
- ws 컨트롤 — `ws-status` (연결 중 / 연결됨 / 실패)
- real 컨트롤 — `[🔌 포트 연결]` / `[✖ 연결 해제]` / `serial-status`
- 채널 상태 행 (ws/real 시 가시) — ch0 (B-receiver) + ch1 (A-injector) 각 sensor / live / calib status / `[🎯 영점]` 버튼
- `[🎯 전체 캘리브]` / `[🔒 압력 확정]` (freeze 토글)
- `sensor-error` — outlier / 연결 에러 표시

**보일** (`web/boyle.html:26-30`) 도 동일 3-mode 토글 보유. 단일 채널이라 채널 행 단순화.

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
| `≤1919px` | Step 2a | 심화 페이지(particles.html) `#adv-section-canvas`를 column 방향, 트래커 칼럼 가운데 정렬 |
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

### 4.5 시스템 layout 1199 분기 + 4 페이지 헤더 통일 (Phase 6.4 fixup 17d/17f)

**시스템 차원 본질 발견** (Phase 6.4 fixup 17b/17c/17d 4단계 진화 후): `style.css:2336` `@media (max-width: 1599px)` 룰 = boyle/particles/vapor 모든 가림 문제 시스템 차원 원인. <1600px viewport 자동 fixed overlay slide-in 전환 → flex 부모 무력화.

**fixup 17d 본질 해결**:
- `@media (max-width: 1599px)` → `@media (max-width: 1199px)` 축소.
- 캔버스 `max-width: 100%` 룰 `@media 1279px` → `@media 1599px` 확장 (1200~1599 flex 축소 시 캔버스 정합).
- vapor 전용 flex 부모 (`#vapor-page-wrap` + `#vapor-main-container`) 신설 (boyle `#basic-mode` 패턴 정확 복제).

**분기 자세**:
- **≥1200px**: flex 자동 축소 (적응형 정공법). main flex:1 + aside flex-basis:380.
- **<1200px**: fixed overlay drawer (좁은 폭 canvas 시각 보존, 1599 룰 의도 절반 유지).

**4 페이지 적용**:
- vapor / boyle / particles 일괄 (동일 flex 부모 패턴, 페이지 간 일관성).
- **dalton 제외** (별도 grid layout, 사용자 비판 X + grid wrap risk 격리).

**4 페이지 헤더 통일** (fixup 17f):
- DOM: `<nav class="page-nav">` + `<h1 class="page-title">` (semantic 강화).
- CSS: `.page-nav` flex / `.page-title` 신설. `.dalton-nav / .dalton-page-title` 폐기.
- `.dalton-page-utilities` 단독 기능 격리 보존 (단위 atm/kPa 토글 + CSV 다운로드).
- 텍스트 형식: `CAST — [학습 주제] — Phase X fixup Y (요약)` (개발용 in-progress, 완료 시 제거 의도).

**silent regression 패턴**: factory init() 호출 누락 = visible 에러 X, UI 무반응 silent fail. dalton:3492 비교로 발견 (fixup 17b).

**agent 한계 명시**: vapor 단독 검토로 시스템 차원 룰 (@media 1599) 미발견. **사용자 본질 진단 의뢰 (4 페이지 균등) → 시스템 차원 원인 발견** = 사용자 + agent 협업 패턴 정합. fixup 17d body "vapor 17b 미작동 본질 = 1599 룰 무인지 (CC 진단 누락 인정)".

cross-ref `docs/17-vapor-design.md` §15 (시스템 layout 4단계 진화 + silent regression + agent 한계) + §16 (4 페이지 헤더 통일).

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
main.js (initBasicApp / initAdvancedMode / initDaltonApp)
 ├─→ simulation.js   (Box, ParticleSystem, DEFAULT_SPEED_SCALE, Particle, BOX_INITIAL_* 등)
 ├─→ renderer.js     (createRenderer, getAndResetFrameCount)
 ├─→ protocol.js     (parseV11Line — v1.2)
 ├─→ serial.js       (createSensorManager, MockSensorSource, WebSocketSensorSource,
 │                    WebSerialSensorSource, GUARD_* 상수)
 ├─→ logger.js       (downloadCSV, formatTimestampForFilename)
 └─→ ui.js           (createDevPressureSlider, createInfoPanel, createMeasurementPanel,
                      createTemperatureControl, createAnalysisPanel, initSensorPanel,
                      createAdvTutorPanel, createDaltonTutor)

serial.js
 └─→ protocol.js     (parseV11Line)

ui.js
 ├─→ logger.js       (downloadCSV, downloadRawCSV, csvEscape, formatTimestampForFilename)
 ├─→ ai-tutor.js     (aiConversations [read], updateTabAvailability,
                      updateInputAvailability, resetAllConversations — typeof 가드)
 └─→ main.js 상수    (REFERENCE_P_KPA, REFERENCE_V_ML — 크로스 모듈)

ai-tutor.js (보일 전용)
 └─→ (독립) simulation/renderer/serial/logger 비의존. DOM만 조작.

createAdvTutorPanel (입자운동) / createDaltonTutor (돌턴)
 └─→ ui.js closure. ai-tutor.js 의 `aiConversations` 와 별 store (시뮬별 분리).

renderer.js
 └─→ simulation.js   (BOX_INITIAL_*, BOX_MAX_WIDTH)

protocol.js / simulation.js / logger.js — 독립 (상호 참조 없음)
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

**현재 진행 상태 권위 = `docs/06-project-status.md`**. 본 § 은 아키텍처 변동만 요약.

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

### 7.2 Phase 3 — 보일 실물 통합 (SW 완료)

- ESP32 펌웨어 (DFRobot Gravity 1.6MPa, **5 Hz** v1.2 JSON, hello + data + calib ACK)
- `WebSerialSensorSource` + `WebSocketSensorSource` 구현 (`serial.js`)
- `USE_MOCK_SENSOR` 플래그 → **3-mode 토글로 대체** (Phase 5.4)
- 캘리브 UI / 연결 관리 UI 완성. 실물 조립·검증만 하드웨어 대기 (`docs/19-real-sensor-integration-checklist.md`)

### 7.3 Phase 4 — 비교 UX

- Mock ↔ 실센서 병행 표시 (전환 토글)
- **반데르발스 편차 교육 활용** (v1 탄성 충돌 부산물로 이미 +16 % 재현됨 — `06` §7 참조)
- 이상기체 vs 실제 기체 비교 그래프

### 7.4 Phase 5 — 돌턴의 부분압력

설계서 = `docs/11-dalton-design.md`. 본 문서는 SW 변동만:

- **Phase 5.1 / 5.2 / 5.3 완료** (`feature/dalton-experiment` 브랜치): UI·상태머신 / 5 region 시뮬 엔진 / 학습 기능 (stacked bar + CSV 11 컬럼 + 비교 모드 + 입자간 충돌 직접 구현)
- **Phase 5.4 진행 중** (`phase5-real-sensor`): 본 문서 §2 / §3 sensor 시스템 갱신 = Phase 5.4 결과. protocol v1.2 + multi-channel SensorSource + outlier 가드 5 단계 + A-1 노이즈 시나리오 + `params.dalton.sensor` 외부화 5 + AI 튜터 정합화
- 폴더 재편 (`engine/` + `experiments/` 분리) **Phase 6+ 이연**

### 7.5 Phase 6.x — 증기압 실험 (vapor 트랙, `phase6-vapor-design` 브랜치)

**Phase 6.0~6.4 완료** (06 status 일관, `docs/17-vapor-design.md` 권위 문서):
- Phase 6.0 = vapor 설계 (docs/17 신규) + 시뮬 물리 명세 3건 + 외부 API 배제 결정.
- Phase 6.1-a = main 통합 baseline + vapor 페이지 골격.
- Phase 6.1-b = 시뮬 본체 (5+ 시도 → Schroeder 폐기 → 정적 격자 회귀) + finalization fixup 1~16 + Dalton 16a 부피 입력 확정.
- Phase 6.4 = vapor AI 튜터 통합 (17a) + 시스템 layout 본질 발견 (17b/17c/17d) + INDEX 카드 (17e) + 헤더 통일 (17f) + dead code 정리 (17g-1).

**예약**:
- Phase 6.3 = vapor 4 데이터 소스 분기 활성화 (ws/real/vernier).
- Phase 6.5 = 액체 종류 + 액체 양 비교 활동 (β + α 통합).
- Phase 6.6 = 학생 수준 검증 + README 정합.
- Phase 6.7 = 추가 액체 옵션 (메탄올 등 확장).

### 7.6 Phase 7 — 교사 도구 (구 Phase 6, vapor 트랙 시작 후 라벨 변경)

- 학생 활동 모니터링 대시보드
- 다중 사용자 지원 (서버·DB 필요, 아키텍처 변화 수반)
- 폴더 재편 (Phase 5 후반 → Phase 7+ 이연 — 신규 시뮬 추가 시점에 자연스러움)

---

## 8. cross-ref 표

본 문서는 아키텍처 권위. 영역별 권위 docs:

| 영역 | 권위 docs |
|---|---|
| 프로토콜 v1.2 (메시지 형식 / 채널 / Pa↔kPa) | `docs/12-protocol-v1.2.md` |
| Multi-channel SensorSource 인터페이스 (`onChannelData` / 게이지 라우팅) | `docs/13-multi-channel-interface.md` |
| 캘리브레이션 파이프라인 (전략 C — 브라우저 측 보정) | `docs/14-calibration-pipeline.md` |
| `params.json` 모든 키 + `dalton.gases` + `SCENE` 좌표 + 갱신 흐름 | `docs/15-params-config-guide.md` |
| 개발자 onboarding (새 PC 진입 / 자주 막히는 곳) | `docs/16-developer-onboarding.md` |
| 실물 센서 통합 절차서 (Step I) | `docs/19-real-sensor-integration-checklist.md` |
| 에뮬레이터 (CLI 키 / 노이즈 4 모드 / 시나리오 추가법) | `tools/firmware-emulator/README.md` |
| 펌웨어 (배선 / Wokwi / v1.2 송신 코드) | `firmware/README.md` |
| 시뮬 물리 결정 (왜 `volume_tau=0.5s` 등) + top-level params 표 | `docs/04-simulation-physics.md` |
| 돌턴 시뮬 설계 (5 region / stage machine / 부분 압력) | `docs/11-dalton-design.md` |
| **vapor 시뮬 설계 (정적 격자 + 표면 동역학 + 5-state 학생 평형 + AI 튜터 + 시스템 layout)** | **`docs/17-vapor-design.md`** |
| 진행 상태 마스터 (Phase 별 / 병합 대기 / 다음 단계) | `docs/06-project-status.md` |
| **의사결정 근거** (왜 mock 일원화 / 왜 outlier 가드 / 왜 A-1 4 모드) | `docs/10-dev-journal.md` |
