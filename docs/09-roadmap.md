# 09. 전체 로드맵

**문서 목적**: Phase 2-B 이후 모든 개발 단계 통합 계획. 우선순위·의존관계·예상 소요·결정 이슈 기록. **06**이 "현재 상태"라면 **09**는 "미래 방향".

**마지막 업데이트**: 2026-04-28 (Phase 5.4 / 5.5 완료 — 멀티채널 + 회귀 인프라 + 학습 보강)
**기준 상태**: Phase 1 MVP 완료, Phase 2-A/2-B 완료 (v0.4-boyle-complete), **Phase 3 소프트웨어 완료** (Step 3-6 실물 대기 — `phase3-real-sensor` 브랜치), **Phase 4.5 심화 탐구 모드 완료** (`feature/particle-controls`, 병합 대기), **반응형 레이아웃 + 단위 병기 완료** (`feature/responsive-canvas`, 병합 대기), **Phase 5.1 + 5.2 + 5.3 돌턴 완료** (`feature/dalton-experiment`), **Phase 5.4 완료** (`phase5-real-sensor` — protocol v1.2 + multi-channel SensorSource + outlier 가드 + A-1 노이즈 + baseline.js + 시나리오 회귀 + docs 권위 정합화), **Phase 5.5 완료** (회귀 인프라 6 트랙 + 학습 보강 + AI 설정 패널 기본 열림 + CI workflow). **Step I 실물 대기**.

---

## 1. 로드맵 개요

- [완료] **Phase 1**: MVP — 보일 법칙 시뮬레이션
- [완료] **Phase 2-A**: AI 튜터 UI (대화형 구조)
- [완료] **Phase 2-B**: AI 튜터 실제 API 연동 (Part 4, v0.3-ai-tutor-live)
- [진행] **Phase 3**: Arduino 실센서 통합 (소프트웨어 완료, 하드웨어·펌웨어 대기)
- [계획] **Phase 4**: Mock ↔ 실센서 비교 UX
- [완료·병합 대기] **Phase 4.5**: 심화 탐구 모드 (`feature/particle-controls`)
- [완료·병합 대기] **반응형 레이아웃 + 단위 병기**: `feature/responsive-canvas` (§4.6 참조)
- [완료] **Phase 5**: 돌턴의 부분압력 (Phase 5.1 ~ 5.5 완료, **Step I 본편 실물 대기**)
  - Phase 5.4 = 실센서 사전 준비 (멀티채널 + outlier 가드 + A-1 노이즈 + baseline.js + 시나리오 + docs 정합화)
  - Phase 5.5 = 회귀 인프라 + 학습 보강 6 트랙 + 후속 (PDF 폐기 + 설정 패널) + CI workflow
- [폐기] ~~Phase 5.x Matter.js 별 브랜치~~ — Phase 5.5 결정: 직접 구현 + patch fix 정책 확정 (`docs/10` Matter.js 결정)
- [보류] **[A] AI 튜터 통합**: `phase5-tutor-unify` — 실물 도착 후 Step I 완료 뒤 별 세션 (CC 권장 분기 시점)
- [계획] **Phase 6**: 교사 도구 (대시보드, 다중 사용자)
- [계획] **Phase 7**: 다른 법칙 확장 (샤를, 게이뤼삭) — 기존 Phase 5 에서 이연
- [장기] **Phase 8+**: 배포·상용화·연구 발표

---

## 2. Phase 2-B: AI 튜터 API 연동 (Part 4)

### 2-1. 목표
더미 응답 함수를 실제 Anthropic Messages API 호출로 교체. AI 튜터가 실제로 작동하게 만듦.

### 2-2. 작업 항목 (모두 완료 — v0.3-ai-tutor-live)
- [x] `callAnthropicAPI` 함수 구현
  - 대화 히스토리 `messages` 배열 누적 전송
  - `anthropic-dangerous-direct-browser-access` 헤더
- [x] 타이핑 인디케이터 UI
- [x] 에러 처리 (401, 429, 529, 네트워크)
- [x] 실제 `usage.input_tokens`, `output_tokens` 반영
- [x] 비용 경고 배너 (100원, 500원 임계)
- [x] [세션 초기화] 버튼 (질문별)
- [x] 더미 함수 제거 (`fakeApiDelay` 등)

### 2-3. 예상 소요
1~2시간 (기존 구조 활용, 함수 교체 중심) — **실제 완료: Part 4 당일**

### 2-4. 완료 기준
실제 API 키로 Q1 질문에 답변 → 의미 있는 AI 피드백 수신 → 학생 후속 질문 → AI 맥락 유지 응답. 전체 흐름 동작. **→ 충족**

### 2-5. 결정 완료 사항
- 모델: Sonnet 기본, Opus 옵션
- 저장: sessionStorage만
- 프롬프트: 질문별 focus + 학생 수준 + 자유 모드 분기 완료 (`docs/07` 참조)
- 비용 표시: 원 단위, 실시간

### 2-6. 미결정
- 대화 턴 제한 구체 숫자 (8턴 예정, 실험 후 조정)
- 긴 대화 시 초반 요약 압축 구현 시점 (2-B에 포함? 2-C로?)

---

## 3. Phase 3: Arduino 실센서 통합

### 3-1. 목표
실제 주사기 + 압력 센서 하드웨어에서 오는 실시간 데이터를 시뮬레이션과 병렬 표시.

### 3-2. 하드웨어
- 주사기 + DFRobot SEN0257 (압력 센서)
- ESP32 또는 Arduino Uno
- 상세: `docs/01-hardware-boyle.md` 참조

### 3-3. 소프트웨어 체크리스트

**완료 (2026-04-22)**
- [x] Web Serial API 설계 및 구현 (`WebSerialSensorSource` in `web/js/serial.js`)
  - 기존 `SensorSource` / `onData(cb)` 인터페이스 재사용 유지
  - `MockSensorSource` ↔ `WebSerialSensorSource` 런타임 교체 지원
- [x] Mock ↔ 실센서 전환 UI (`#sensor-panel`, `initSensorPanel()`)
  - 모드 토글, 포트 연결·해제, 상태 배지, 에러 토스트
  - Web Serial 미지원 브라우저에서 실센서 버튼 자동 비활성화
- [x] 프로토콜 v1.1 확정 (`docs/05-data-format.md`)
  - 타입 필드 `t` 기반 4종 (`d`/`s`/`c`/`e`) + 3종 송신 (`ping`/`calib`/`cfg`)
  - v1.0 레거시와 공존, `HELLO_TIMEOUT_MS` 폴백
- [x] `createSensorManager` 팩토리 — 모드 전환 간 구독 유지

**완료 (2026-04-23, `phase3-real-sensor` 브랜치)**
- [x] ESP32 펌웨어 스켈레톤(`firmware/boyle/boyle.ino` 1.1.0-skeleton), Wokwi 검증
- [x] ESP32 펌웨어 시뮬 버전(1.1.0-sim) — 포텐셔미터 → Pa 선형 매핑 5Hz 전송
- [x] Node.js + WebSocket 펌웨어 에뮬레이터(`tools/firmware-emulator/`) Step 3-1~3-3 — hello·데이터 프레임·CLI 키 조작·클램핑

**진행 중 · 남은 작업**
- [ ] Step 3-4: 브라우저 `WebSocketSensorSource` + v1.1 공통 파서
- [ ] Step 3-5: UI 센서 소스 토글 Mock/WebSocket/Serial
- [ ] Step 3-6 (하드웨어 입수 후): BMP280 구동 펌웨어(`bmp.readPressure()`로 `readPressurePa()` 교체), 실물 플래시·실험 검증
- [ ] 실센서 캘리브레이션 — 영점 플로우 실전 검증, 필요 시 2점 보정 추가
- [ ] 노이즈 튜닝 — 펌웨어 이동평균 / 브라우저 스무딩 α 실측 기반 조정

### 3-4. 캘리브레이션 UI
- [x] [🎯 영점 캘리브] 버튼 + p₀ 표시 (UI 레이어 완료)
- [ ] 2점 캘리브레이션 마법사 (실센서 오차 측정 후 필요성 판단)

### 3-5. 예상 소요
- 핵심 기능: 0.5~1일
- 현장 적응 (드라이버, 캘리브레이션, 노이즈 튜닝): 2~5일

### 3-6. 주요 기술 리스크
- Web Serial API 브라우저 지원 (Chrome/Edge만, 학교 PC 환경 확인)
- HTTPS 필수 (로컬 테스트 제외)
- 학교 PC 관리자 권한 없이 CH340 드라이버 설치 가능한지
- 센서 개체별 오차 (캘리브레이션 표준화 필요)

### 3-7. 교육적 설계 고려
- 실측 데이터가 시뮬과 다를 때 학생이 혼란 안 겪게 UI 설계
- AI 튜터가 편차를 "버그 아닌 물리"로 해석 유도
- 데이터 두 소스 동시 표시의 직관성

---

## 4. Phase 4: Mock ↔ 실센서 비교 UX

### 4-1. 목표
이상기체 시뮬레이션과 실기체 측정을 **나란히 비교**하는 교육적 시각화. 이 플랫폼의 **진짜 가치** 구현.

### 4-2. 주요 기능
- 화면에 두 PV 그래프 동시 표시
  - 이상기체 (시뮬) 곡선
  - 실제 측정 (센서) 점들
- 편차 계산·시각화
  - 저압·고온에선 작고
  - 고압·저온에선 커짐
- 반데르발스 편차 탐구 모듈
  - 압축 인자 `Z = PV/nRT` 그래프
  - `b` 항 (분자 부피) 시각적 설명
  - `a` 항 (분자 인력) 시뮬레이션 가능성

### 4-3. 예상 소요
2~3주 (탐구 모듈 설계 포함)

### 4-4. 연구 가치
- 이상기체 vs 실기체 개념 시각화는 대학 물리화학 교재에도 드묾
- 고등학교·영재 과정에서 쓸 수 있는 자료로 기여 가능
- 논문·학회 발표 소재

---

## 4.5. Phase 4.5: 심화 탐구 모드 (완료, 병합 대기)

브랜치 `feature/particle-controls` 에서 완성. 자세한 완료 항목은 `06-project-status.md §2-E` 참조.

### 4.5-1. 목표
기본 보일 실험(`P = 독립, V = 반응`)을 벗어나 학생이 **V·T·N·기체 종류**를 전부 자유 조작하며 이상기체 전체 거동을 탐구하도록 한다. 기본 실험의 단일-변수 설계와 **직교**.

### 4.5-2. 구현 완료 항목 (요약)
- [x] 기본/심화 UI 분리 — 초기엔 탭(`#mode-tabs`, `initModeTabs`), 이후
  `feature/landing-page` 에서 **독립 페이지**(`boyle.html` / `particles.html`)
  로 전환. 탭 인프라는 dead code 로 정의만 유지
- [x] 심화 전용 물리 — `P = P₀·(V₀/V)·(T/T₀)·(N/N₀)` 강제, 속도 스케일 `σ ∝ √(T/m)`
- [x] 기체 4종 (He/N₂/Ar/CO₂), 온도 −100 ~ 500 °C, 입자 50 ~ 800, 유령 0
- [x] 메인 + 추적 실린더 듀얼 캔버스, 추적 입자 궤적 잔상 + 속도 게이지
- [x] peak-normalized 볼츠만 히스토그램 (이론 peak = y=1 고정)
- [x] PV/nT 검증 표 + 막대 그래프 + CSV
- [x] 심화 AI 튜터 사이드바 (기본과 API 키 공유)
- [x] 기본 실험 확장 연동 — 압력 81 ~ 500 kPa, 실린더 1000 px, 1/V vs P 그래프

### 4.5-3. 남은 작업 / 병합 조건
- [ ] 수업 시뮬레이션 검증 (실학생 대상 소규모 파일럿)
- [ ] `runPVAccuracyTest` 를 400 kPa 확장 범위에 맞춰 갱신 (Phase 3 에서 슬라이더 상한 500→400 으로 조정됨)
- [ ] 심화 모드 전용 AI 튜터 프롬프트 튜닝 (기체 비교·온도 효과 유도)
- [ ] main 병합 + `v0.5-advanced` 태그 할당

### 4.5-4. Phase 4 / Phase 5 와의 관계
- **Phase 4 (비교 UX)**: 심화 모드의 이상기체 거동은 Phase 4 반데르발스 편차 탐구의 **기준선**으로 재사용 가능
- **Phase 7 (다른 법칙 — 샤를·게이뤼삭, 기존 Phase 5 에서 이연)**: 심화 모드의 온도·부피 자유 조절 UI는 해당 확장에 **컴포넌트 재활용** 가능

### 4.5-5. 알려진 제약
- ~~데스크탑 ≥ 1872 px 가정~~ → **`feature/responsive-canvas`에서 해결** (1023px까지 정상 동작, 자세한 내용은 §4.6 참조)
- 시뮬레이션 내부 `Particle.mass = 1.0` 하드코딩 — 공식 표시 압력은 기체 독립이지만, 관측 피스톤 충돌 압력은 기체 질량 비의존 (UI 에는 노출되지 않음; `06 §2-E` 및 물리 검증 보고 참조)

---

## 4.6. 반응형 레이아웃 + 단위 병기 (완료, 병합 대기)

브랜치 `feature/responsive-canvas` (parent: `feature/particle-controls`). **물리 코드 한 줄도 수정 안 함**. 자세한 커밋별 내역은 `06-project-status.md §2-F` 참조.

### 4.6-1. 목표
`feature/particle-controls`의 심화 탭이 요구하던 ~1900px 뷰포트 가정을 깨뜨리고, 일반 노트북(1366~1440px) 및 작은 모니터에서도 정상 작동하도록. 동시에 교육적 이해도를 높이기 위해 학생 친화 단위(atm, mmol) 병기.

### 4.6-2. 구현 완료 항목
- [x] AI 사이드바 overlay drawer 모드 (≤1599px, 우측 슬라이드 + `body.sidebar-collapsed` 재활용)
- [x] 심화 탭 트래커 세로 스택 (≤1919px, 오버플로 경계 정확 매칭)
- [x] 캔버스 CSS 스케일링 (≤1279px, `max-width:100%; height:auto` — 내부 해상도 불변)
- [x] visuals/measurements 섹션 세로 스택 (≤1023px)
- [x] Push 모드 사이드바 높이 상한 `min(720px, calc(100vh-32px))` (시선 이동 거리 단축)
- [x] Overlay 사이드바 `top:74px`로 본문 첫 카드와 정렬
- [x] 단위 병기 표시: `kPa (atm)`, `개 (mmol)` — 내부값 불변, PV=nRT 자가 일관성 <0.63% 오차
- [x] **재생 컨트롤** (슬로모션 + 일시정지, `69b18da`) — 0.25x/0.5x/1x segmented + ⏸ 버튼, 기본/심화 탭 공유 전역 상태(`speedMultiplier`, `isPaused`), dt 스케일링은 update 루프 진입점에서만 적용, 일시정지 시 기록 버튼 자동 비활성
- [x] **충돌/초 시뮬 시간 보정** (`0c295a7`) — `hitsPerSec / speedMultiplier`로 배율 무관 물리 상수 표시, 라벨 `"(시뮬 시간)"` 명시, 측정 CSV도 자동 sim-time 기준 저장

### 4.6-3. 물리 불변 보증
- `simulation.js`, `renderer.js`, `params.json`, `main.js`의 `createCanvas` 값 **무수정**
- 모든 변환은 표시 레이어 전용 유틸(`kPaToAtm`, `particlesToMmol`, `formatValueDual`) 경유
- 내부 raw 값(kPa, 입자수, mL, K)이 모든 계산·측정표·CSV·AI 프롬프트·그래프 축의 기준

### 4.6-4. 남은 작업 / 병합 조건
- [ ] main 병합 — `feature/particle-controls` 와 함께 병합 순서 결정
- [ ] 후속 동기화 작업(선택): AI 프롬프트·CSV 헤더·그래프 축·측정표 헤더의 kPa 리터럴 → atm 병기
- [ ] 실 디바이스 테스트 (iPad, 안드로이드 태블릿 — 현재 데스크탑 Chrome 기준 검증)
- [ ] **2x 배율** (후속): `simulation.js:185 DT_CAP=0.05` 이중 가드로 `dt × 2`가 무효화됨 → sub-step(한 프레임 updateFn 2회 호출) 방식 필요
- [ ] **스텝 모드 + 키보드 단축키** (후속): Space=일시정지, N=스텝 1프레임, ,/.=배율 조절

---

## 5. Phase 5: 돌턴의 부분압력 (진행 중)

**재정의 이력**: 2026-04-24 이전 Phase 5 계획은 "다른 법칙 확장 (샤를, 게이뤼삭)".
돌턴 부분압력의 실험 확장성·보일과의 병행 학습 효과가 더 크다고 판단되어
Phase 5 목표를 **돌턴 부분압력** 으로 재정의. 샤를·게이뤼삭은 **Phase 7** 로 이연.

상세 설계는 `docs/11-dalton-design.md` 참조 (1570줄).

### 5-1. 모델 (확정)
- **주사기 A (능동) → 주사기 B (수용, 피스톤 고정)** 2영역 직접 연결
- A·B 사이 체크밸브로 역류 방지
- 주입 후 A는 비어있음, B 내부 P_total 측정
- 이론값: `P_total = (V_A / V_B + 1) × 1 atm` (대기압 기준)
- 부피 입력: A·B 둘 다 숫자 입력 전용, 범위 10~100mL, 기본 50mL
- 실센서는 B 에만 부착 (DFRobot Gravity 1.6MPa, v1.1 프로토콜 재사용)

### 5-2. Phase 5.1: UI·상태머신 (완료, `feature/dalton-experiment`)
- Step A: HTML 스캐폴딩 + 2영역 DOM + 반응형 drawer CSS
- Step B-1: 이벤트 바인딩 인프라 + `params.dalton` 확장 + UI 폰트·폼 보정
- Step B-2: 이론값 실시간 계산 + 압력 표시 동적화 (stage 분기)
- Step B-3: 상태 머신 (IDLE → INJECTING → INJECTED → CONFIRMED) + 3버튼 + 안정화 카운트다운 + 기록 추가
- 태그: `phase5.1-stepA-complete`, `phase5.1-complete` (로컬·원격 모두)

### 5-3. Phase 5.2 시뮬 엔진 (완료, Step C-1~C-3, 2026-04-26)
- ✅ Step C-1: 정적 시린지 + ㄷ자 튜브 + 게이지 overlay (1160×600 캔버스)
- ✅ Step C-2: 입자 brownian (시린지당 60개) + 부피 보간 (lerp 0.15)
- ✅ Step C-3: 주입 애니메이션 — 11 versions 진화
  - waypoint → 5 region 물리 → 텔레포트 → 피스톤 동기 분출
  - 게이지 P_B 매 frame 진행률 동기 (releasedCount/total)
  - 부분 압력 list (체크박스 + 가스 흐림 토글, alpha 0.08)
- ✅ simulation.js Particle 재사용 (수정 0)
- 신규 함수 25개. main.js +1346 lines
- 14 commits / 1일 (2026-04-25~26)

### 5-4. Phase 5.3: 학습 기능 + 충돌 시뮬 정합화 (완료, 2026-04-26, 8 commits)
- ✅ Step F polish: stacked bar 그래프 (Dalton 법칙 시각화) + chart canvas dynamic resize (ResizeObserver)
- ✅ Step G: CSV export (logger.js 의 downloadCSV / formatTimestampForFilename 재사용, 11 컬럼)
- ✅ 분자 수 단일 산출 함수 정합화 (`computeMoleCount(P, V)`, V 비례 입자, particleCountPerSyringe 폐기)
- ✅ 측정 기록 비교 모드 (체크박스 FIFO 2 row + 정적 규칙 4 변수 차이 분석, LLM 미사용)
- ✅ 입자간 탄성 충돌 (직접 구현, spatial hash O(N) + 1D 탄성 충돌 + 위치 분리 W4-simple, R1+R5 만)
- ✅ 끼임 정정 v1~v5 누적 (volumeToPistonY 정확 비례, computeBox Math.max 제거, 입자 안전 마진, 텔레포트 stage 검사, rescue 함수)
- ✅ Step H: AI 튜터 돌턴 특화 (`createDaltonTutor` 자체 closure, 4 학습 목표, Q1~Q4×4 수준=16, F1 비교 모드 통합)
- ✅ 측정 기록 정리 (accordion 토글 폐기, 행 삭제 🗑️, 회차 번호 빈 자리 유지)
- ✅ 피스톤 시각 정정 (V=0 시 본체 침범 차단), `#ai-reopen-btn` 보일 형식 통일
- ✅ 물리 검증 테스트 (`tests/dalton-collision-test.js` 7 검증 — 보존 법칙 / Equipartition / M-B 분포 / 안정성)
- ⏳ Step I: Web Serial + WebSocket 실센서 연동 (pressureBSensor 실측값) — 실물 DFRobot 입수 후

### 5-5. Phase 5.4: 돌턴 실센서 사전 준비 (진행 중, 2026-04-27, `phase5-real-sensor`)

본편 Step I (실물 센서 데이터 수집) 진입 전 인프라 / 정리 단계. 약 20 commits / 1일.

**완료**:
- ✅ Protocol v1.2 — 멀티채널 (`ch` 필드) + 호환 모드 (commit `dc7ca57`, `docs/12`)
- ✅ Multi-channel SensorSource — `onChannelData(ch, p_kPa)` 단일 경로, ch ↔ 게이지 라우팅 (commit `8eeaea2`/`fc1cedc`, `docs/13`)
- ✅ Calibration pipeline — 영점 + 2점 보정 흐름 (`docs/14`)
- ✅ mock/ws/real 데이터 흐름 일원화 (옵션 C — 데이터 흐름 단일 + 처리 정책 모드별 차등) (commit `65d97e3`)
- ✅ `params.dalton.sensor` 5 상수 외부화 (commit `eaa524f`) — EMA α / 임계값 / mock interval / 노이즈 σ / safety timeout 여유
- ✅ AI 튜터 Q3 ↔ Q4 swap (보일/돌턴) (commit `819075a`) — Q4 = 메타 탭 (📊 질문 생성)
- ✅ 입자운동 AI 튜터 16 질문 (4 levels × Q1~Q4) 차등 (commit `e2f36d3`) — 보일/돌턴 패턴 일관 ([C] 완료)
- ✅ 입자운동 ai-tutor.js 비활성 버그 fix (commit `5ea401c`)
- ✅ 입자 stuck patch — A 박스 R1 (commit `d4b6979`) + B 박스 R5 (commit `72403ca`), 0.5 px epsilon 안전 마진
- ✅ 측정 기록 / CSV / record 데이터 키 일반화 — P_공기·P_CO₂ → P_A·P_B 위치 기반 (commit `1f1ad7b`/`d7afa1c`)
- ✅ 폐기 마커 + dead state 정리 — ★★★ 12 위치 (commit `1b01777`)

**남은 작업 (Step I 본편)**:
- [ ] 실물 DFRobot Gravity 1.6MPa 채널 2개 조립·플래시
- [ ] 캘리브레이션 검증 (영점 + 2점 보정 — `docs/14` 명세)
- [ ] 본 데이터 수집 — 돌턴 부분 압력 검증 (이론 vs 실측 편차 < 5% 목표)

### 5-6. 예상 소요
Phase 5.2 (시뮬 엔진): 완료 (3일, 14 commits). Phase 5.3 (학습 기능): 완료 (1일, 8 commits). Phase 5.4 (실센서 사전): 완료 (1일, 약 20 commits). Step I (실센서 본편): 하드웨어 입수 시 1~2일.

### 5-7. 별 브랜치 후보
- **`experiment/matter-js` (Phase 5.x)** — 입자간 충돌을 Matter.js 라이브러리로 재구현. 배경 = Phase 5.3 직접 구현 + Phase 5.4 patch (R1/R5 epsilon) 누적 → patch 패턴의 한계 명확. 직접 구현 ↔ 라이브러리 비교 자료, 논문 강력한 1차 자료가 될 수 있음. 5-region 모델 통합 + 회귀 검증 후 합류. 실물 작업 후 또는 병행.
- **`phase5-tutor-unify` ([A] AI 튜터 통합)** — Phase 6/7 신규 시뮬 추가 직전. 3 시뮬 (보일/돌턴/입자운동) 의 자체 closure → 공통 모듈 통합. Phase 5.4 의 입자운동 비활성 버그 (ai-tutor.js 의 `.ai-sidebar` 셀렉터 광역 영향) 가 통합 전 해결할 대표 이슈. 셀렉터 / 책임 분리 명확화 우선. **(완료)**: Phase 5.7 트랙 6 `tutor.js` factory 신설 (createTutor(config), 14 commits, 2026-04-29). Phase 6.4 17a 에서 vapor 통합.

### 5-8. Phase 5.5~5.10 누적 (2026-04-28~2026-05-08)

- **Phase 5.5** (2026-04-28) — 회귀 인프라 + 학습 보강 자율 6 트랙 (sequence replay / outlier 가드 unit test / 보일 측정 통계 / 가스 비교 / docs/16 §9 stale 정리).
- **Phase 5.6** (2026-04-28) — docs 정합 점검 + tests 보강 + CI 통합.
- **Phase 5.7** (2026-04-29) — `tutor.js` factory 통합 (트랙 6, 14 commits). 보일 / 입자운동 / 돌턴 Hybrid wrapper.
- **Phase 5.8** (2026-05-06) — Vernier GDX-GP 4번째 SensorSource 정식 편입. Boyle 단일 채널.
- **Phase 5.9** (2026-05-06~07) — Vernier Dalton 적용 + AI 튜터 D-(3) Vernier substate 컨텍스트.
- **Phase 5.10** (2026-05-08) — 펌웨어 셋업.

---

## 5.5 Phase 6.x: 증기압 실험 (vapor 트랙, `phase6-vapor-design` 브랜치)

### 5.5-1. 완료 (Phase 6.0~6.4, 2026-05-09)

- **Phase 6.0** — vapor 설계 (`docs/17-vapor-design.md` 신규, 13 섹션) + 시뮬 물리 명세 3건 묶음 (위상 통과 / 응집력 / 카운터) + 외부 시뮬 API 배제 결정 (matter.js / 클라우드 SaaS / PhET / AI 시뮬 모두 배제, 자체 구현 유지).
- **Phase 6.1-a** — `phase5-real-sensor` → `phase6-vapor-design` 머지 (Phase 3 SW + 5.3/5.4/5.7/5.9 통합본). vapor 페이지 골격 (initVaporApp 분기 + params.vapor placeholder).
- **Phase 6.1-b** — vapor 시뮬 본체:
  - **5+ 회 액체 모델 시도-폐기 사이클** (sub-step 1) — dense free / option Z / LJ-like / 응집 영역 / Schroeder LJ MD 모두 폐기.
  - **정적 격자 + 표면 동역학 회귀** (sub-step B-2 final 마커) — "운동이 빈 공간 만든다" 본질 결함 발견.
  - **finalization fixup 1~14** — 시각 효과 + 시간 척도 (5분 평형) + ghost particle + 정공법 회귀 (calibration 폐기) + T+P 카드 통합 + 평형 ratio 단일 + rate 워밍업.
  - **finalization fixup 15a~15t** — 화살표 매칭 4단계 진화 → 매칭 폐기 + dual-layer 5-state 학생 평형 결정 + P 영역 그래픽화 (Johnstone 3수준 통합) + 사이드바 → top-control 변환 + CSS scaling 모델 좌표 보존.
  - **fixup 16a Dalton 부피 입력 확정** (vapor 15b 패턴 100% 재사용 — 페이지 간 패턴 재사용 첫 사례).
- **Phase 6.4** — vapor AI 튜터 통합 + 시스템 layout 본질 발견 + INDEX 카드 + 헤더 통일 + dead code 정리:
  - **fixup 17a** — vapor AI 튜터 통합 (`tutor.js` factory 재사용, Phase 6.4 예약 docstring 실행).
  - **fixup 17b/17c/17d** — 사이드바 layout 4단계 진화. silent regression 수정 + flex 부모 시도 (적응형 미작동) → dalton fixed 복제 (잘못된 옵션) → **시스템 차원 본질 발견** (`@media (max-width: 1599px)` 룰) → 1599 → 1199 축소 + 캔버스 max-width 1279 → 1599 확장 + flex 부모 정공법 회귀.
  - **fixup 17e** — INDEX vapor 카드 (boyle 다음, Phase 6 dual-layer 학습 흐름).
  - **fixup 17f** — 4 페이지 헤더 통일 (CAST prefix + Phase/fixup 표시, 개발용 in-progress).
  - **fixup 17g-1** — dead code 보수 정리 (신중 모드 4-등급, codebase healthy).

### 5.5-2. 예약

- **Phase 6.3** — vapor 4 데이터 소스 분기 활성화 (ws/real/vernier).
- **Phase 6.5** — 액체 종류 + 액체 양 비교 활동 (β + α 통합, water 외 ethanol 추가).
- **Phase 6.6** — 학생 수준 검증 + README 정합.
- **Phase 6.7** — 추가 액체 옵션 (메탄올 등 확장).

### 5.5-3. 권위 문서

- 전체 자세: `docs/17-vapor-design.md` (Phase 6.0 작성 + 17h-2 갱신 — §13 학생 평형 결정 5-state + §14 AI 튜터 통합 + §15 시스템 layout + §16 헤더 통일 + §17 INDEX 카드 + §18 dead code 부록 + §99 핸드오프).
- 의사결정 history: `docs/10-dev-journal.md` Phase 6.0~6.4 (17h-1a/b/c/d entries, +1232 줄 / 46 결정 블록 / 67 commits 합성).

---

## 6. Phase 7: 교사 도구 (구 Phase 6, vapor 트랙 시작 후 라벨 변경)

### 6-1. 교사 대시보드
- 여러 학생 동시 모니터링
- 측정 진행, AI 사용, 성찰 깊이
- 학생별 CSV 자동 수집
- 수업 후 분석

### 6-2. 다중 사용자 지원
- 서버·DB 도입 (처음으로 BYOK 패턴 벗어남)
- 사용자 인증
- 학급 단위 관리
- 개인정보 보호 정책 수립

### 6-3. 예상 소요
- 대시보드만: 2~3주
- 다중 사용자 + 서버: 1~2개월
- 보안·개인정보 법적 검토 병행

### 6-4. 주요 이슈
- 개인정보 보호 (학생 답변·대화 서버 저장)
- 교육청·학교 승인 절차
- 호스팅 비용 (학교 부담? 연구비?)

---

## 7. Phase 7+: 배포·상용화·연구

### 7-1. 배포 확장
- 현재: GitHub Pages (개발·연구용)
- 다음: PWA (설치 가능 웹앱, 교실 단위)
- 필요 시: Electron (데스크탑 앱, 오프라인 학교)
- `docs/03` 참조

### 7-2. 연구 발표
- 교육공학 학회
- 과학교육학회
- STEM 교육 저널
- 방법론 근거: `docs/07` (AI 설계), `docs/08` (물리 검증)

### 7-3. 상용화 (가능성)
- 교육 플랫폼 납품
- 오픈소스 유지 + 상용 지원
- 연구 성과 기반 창업

---

## 8. 의존관계 그래프

```
Phase 2-B ─────────────────────────┐
                                    ↓
        Phase 3 (실센서) ─────────────→ Phase 4 (비교)
                                            ↓
                                    Phase 5 (돌턴 부분압력) ─┐
                                            ↓              ├→ Phase 8 (연구·배포)
                                    Phase 7 (샤를·게이뤼삭) ─┘
                                            ↓
                                    Phase 6 (교사 도구)

Phase 4.5 (심화 탐구) ─── Phase 1 MVP 위에서 직교 확장, main 병합 후 Phase 4/5/6 병행 가능
Phase 4.6 (반응형 + 단위 병기) ─── Phase 4.5 에서 파생. 물리 코드 불변, 표시 레이어만 확장
```

**병렬 가능**: Phase 2-B 와 Phase 3 는 상호 의존 없음 → 개발자·펌웨어 엔지니어 분담 시 병렬 진행 가능.
**직교**: Phase 4.5 는 기본 실험 구조 위에 얹힌 독립 탭으로, Phase 3~6 과 상호 간섭 없이 진행 가능.
**강한 의존**: Phase 4 는 Phase 3 실센서 데이터 필수. Phase 6 대시보드는 Phase 3-5 수업 운영 데이터 기반.

---

## 9. 우선순위 결정 기준

### 9-1. 필수 (순차 진행)
1. **Phase 2-B**: 없으면 AI 튜터가 장식
2. **Phase 3**: 없으면 "센서-시뮬레이션 통합"이라는 본질 상실
3. **Phase 4**: 없으면 Phase 3이 "그냥 센서 연동"에 머묾

### 9-2. 선택 (병렬 가능)
- **Phase 5** (돌턴 부분압력): 실험 다각화
- **Phase 6** (교사 도구): 운영 규모 확장
- **Phase 7** (샤를·게이뤼삭): 법칙 확장
- **Phase 8+** (배포·연구): 성과 확장

### 9-3. 결정 철학
**"하나의 Phase를 완전히 끝내고 다음"**.
병렬 작업은 품질 저하와 문맥 전환 비용. 특히 교육 도구는 **학생·교사 피드백 반영 주기**가 중요하므로 각 Phase 후 실제 수업 투입이 다음 설계의 근거가 됨.

---

## 10. 절대 추구하지 않을 것 (역 로드맵)

- 시뮬레이션 조작 AI (학생 주체성 파괴)
- 자동 채점 AI (교사 역할 침범)
- 학생 감시 도구 (윤리)
- 광고 수익 모델 (교육 본질 훼손)
- 복잡도 우선의 기능 확장 (교사·학생 혼란)

---

## 11. 열린 질문 (향후 검토)

- AI 튜터 평가 지표 구체화: 어떻게 "효과"를 측정할 것인가
- 영재 교육 특화 vs 일반 교육 확장: 언제·어떻게
- 오픈소스 라이선스 선택 (현재 미설정)
- 학생 데이터 프라이버시 정책 문서화
- 국제화 (영어권 사용자)

---

## 12. 관련 문서

- `00-project-overview.md` — 프로젝트 비전 (왜)
- `06-project-status.md` — 현재 상태 (어디까지)
- `07-ai-tutor.md` — AI 튜터 상세 (어떻게)
- `08-physics-validation.md` — 물리 검증 (얼마나 정확한가)
- `01-hardware-boyle.md` — Phase 3 보일 하드웨어 명세
- `02-hardware-charles.md` — 샤를 하드웨어 초안 (Phase 7 이연, 현재 보류)
- `11-dalton-design.md` — Phase 5 돌턴 부분압력 설계서
- `03-software-architecture.md` — Phase 8 배포 확장 (PWA, Electron) 참조
