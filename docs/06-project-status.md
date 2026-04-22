# 06. 프로젝트 진행 상태

**문서 목적**: 현재 구현 상태와 남은 작업의 마스터 트래커. 다른 설계 문서는 "어떻게 만들어졌는가"를 설명하고, 이 문서는 "어디까지 왔는가"를 기록한다.

**마지막 업데이트**: 2026-04-22
**현재 상태**: 보일 법칙 시뮬레이터 완성 + **심화 탐구 모드 추가** (`feature/particle-controls`) + **Phase 3 진행 중** — 소프트웨어(Web Serial 어댑터·프로토콜 v1.1·UI 패널) 완료, 하드웨어·펌웨어 대기.
**최신 태그**: `v0.4-boyle-complete` (main), `feature/particle-controls` 브랜치 작업 완료 (태그 미할당)
**다음 단계**: Arduino 하드웨어 입수 후 펌웨어 작성 + 실연결 테스트; `feature/particle-controls` 는 추가 검증 후 main 병합 예정

---

## 1. 빠른 요약

보일 법칙 MVP가 **Phase 2-B까지 완성**됐다. 2D 입자 시뮬레이션(실입자 300 + 유령 2700), 맥스웰-볼츠만 분포 시각화, HSB 속도 색상, 충돌 섬광, 안정화 감지 기반 측정 기록, PV 산점도, 분석 화면, CSV 내보내기, **실제 Anthropic Claude API 호출**(BYOK), **docx 탐구 보고서 자동 생성**까지 모두 동작한다. 이상기체 `PV = const` 편차는 **±0.5 % 이내**(목표 2 %).

Phase 2-B에서 AI 튜터의 더미 응답을 실 API로 교체하고, 멀티턴 대화·비용 표시·에러 처리를 완성했다. 이후 Q3 AI 자동 질문 생성, Q4 탭, 대화 마무리 버튼, 측정점 테이블 확장(평균 속도·충돌/s), 3개 차트(PV, v̄ vs P, 충돌/s vs P), 유령 입자 기반 충돌 카운트 스무딩, cross-tab 렌더 가드, docx 보고서 자동 생성까지 추가됐다.

다음 단계: Phase 3 (Arduino + ESP32 실센서 연동)로 진입.

---

## 2. 구현 완료된 기능 (Phase 1 MVP)

**시뮬레이션 엔진**
- [x] 주사기형 피스톤 시뮬레이션 (왼쪽 벽 고정 + 오른쪽 피스톤, U자형 실린더)
- [x] 이상기체 기하학적 강제 (`P₀V₀ = PV`, 속도/부피 시정수 분리)
- [x] 맥스웰-볼츠만 초기 속도 (Box-Muller 변환)
- [x] 입자-벽 탄성 반사 + 피스톤 충돌 이벤트 (피스톤 면만 집계)
- [x] 입자 간 탄성 충돌 (O(N²) 법선 방향 임펄스 교환)
- [x] 유령 입자 2700개 (히스토그램 샘플링 전용 풀)
- [x] 박스 목표 폭 지수 수렴 (`volume_tau = 0.5 s`)
- [x] 피스톤 수축 시 강제 수습 (`clampParticlesIntoBox`)
- [x] 온도 변경 시 속도 `√(T_new/T_old)` 스케일링 + `tau = 0.3 s` 부드러운 전이
- [x] V_baseline 동적 재계산 (Charles 법칙 `V ∝ T`)

**렌더링 (p5.js 2 인스턴스)**
- [x] 입자 박스: HSB 속도 색상(파랑→빨강), 충돌 섬광(운동량 비례, 입자 색 상속)
- [x] 속도 히스토그램: 40 bin, 시간 EMA(α=0.03) + 5-point 공간 커널
- [x] 이전 온도 분포 ghost 오버레이 (온도 변경 시 스냅샷 + fade)
- [x] 이론 맥스웰-볼츠만 곡선 오버레이

**컨트롤 UI**
- [x] [DEV MODE] 압력 슬라이더 (81~230 kPa, `BOX_MAX_WIDTH` cap 회피 설계)
- [x] 온도 프리셋 (0/25/50/77 °C) + 커스텀 입력 (0~77 °C)
- [x] 온도 변경 시 측정점·세션 로그·AI 대화 일괄 초기화
- [x] 슬라이더 레이아웃 shift 방지 (`visibility` + 고정 폭 420)

**정보 패널**
- [x] 실측 블록 (온도·압력)
- [x] 시뮬레이션 블록 (평균 속도·피스톤 충돌/s·평균 KE, 이론값 병기)

**측정·기록**
- [x] 안정화 감지 (1 s 윈도우, P 및 box.width 모두 < 0.5 %)
- [x] [기록] 버튼 (1 s 이동평균, 안정화 중 비활성)
- [x] 측정점 표 + `P·V` 자동 계산 + 평균·편차 요약
- [x] PV 산점도 (연결선·이론 곡선 `P·V = const` 토글)
- [x] CSV 2종 내보내기 (측정점 한글 / 연속 로그 영문, UTF-8 BOM)
- [x] [전체 삭제] 시 측정점·세션 로그·AI 대화 일괄 초기화 (Part 3.5에서 확장)

**분석 화면** (측정점 ≥ 3 시 노출)
- [x] 이번 세션 요약 (온도, 측정점 수, 평균 `P·V`, 최대 편차, 소요 시간)
- [x] 보일 법칙 검증 (편차 기반 등급 판정 문구)
- [x] PV 막대 그래프 (편차 색 코드: ≤2 % 녹, ≤5 % 주황, >5 % 빨강)
- [x] 분석 보고서 CSV (실험 조건·요약·측정점·AI 대화 통합)

**AI 튜터 UI** (Phase 1 UI 구조)
- [x] 우측 사이드바 (380 px sticky, 5 섹션 메인 레이아웃)
- [x] 설정 패널 접이식 (API 키·학생 수준·모델·경고·사용량 표시)
- [x] Q1/Q2/Q3/Q4/자유 탭 (측정점 ≥ 3 조건 gating, 자유는 상시 활성)
- [x] 메시지 말풍선 (학생 우측 보라·AI 좌측 회색, 마크다운 렌더)
- [x] 입력창 (Enter 전송·Shift+Enter 줄바꿈, API 키·탭 준비 상태 기반 활성)
- [x] BYOK sessionStorage 패턴, 가격표 기반 원화 환산

**배포·개발 도구**
- [x] GitHub Pages 배포: https://police6980.github.io/pchem-lab-project/web/
- [x] `runPVAccuracyTest()` 콘솔 자동 검증 (6점 순차 기록, 편차 < 2 % 확인)
- [x] Mock 센서 기반 개발 환경 (실 ESP32 없이 UI 검증 가능)

---

## 2-B. Phase 2-B 완료 기능 (Part 4 이후)

**AI 튜터 실 API 연동**
- [x] Anthropic Messages API 직접 호출 (BYOK, browser fetch, `anthropic-dangerous-direct-browser-access` 헤더)
- [x] 멀티턴 대화 히스토리 누적 전송 (탭별 독립 세션)
- [x] 타이핑 인디케이터 (요청 중 "..." 말풍선)
- [x] 에러 처리 세분화 (401 키 불일치 / 429 rate limit / 529 overloaded / 네트워크 0)
- [x] 비용 실시간 원화 환산 + 경고 배너 (100원 주황 / 500원 빨강)
- [x] 탭별 [↺ 초기화] 버튼 (해당 세션만 비움, 누적 사용량은 유지)
- [x] Q3 AI 자동 질문 생성 (측정 데이터 기반, 학생 수준별 톤)
- [x] Q4 탭 신설 (다음 실험 설계 질문)
- [x] [✓ 대화 마무리] 버튼 + AI 요약 생성
- [x] 8턴 소프트 경고 (무한 대화 방지)
- [x] 탭 "new" 뱃지 (다른 탭 응답 도착 시 펄스 표시)
- [x] cross-tab 렌더 오염 방지 (activeQuestion 가드)

**데이터·시각화 확장**
- [x] 측정 테이블에 v̄ (px/s), 충돌/s 컬럼 추가
- [x] P vs V 산점도 + 보일 법칙 이론 곡선 (SVG 인라인)
- [x] v̄ vs P 차트 (등온 조건에서 속도 일정 확인)
- [x] 충돌/s vs P 차트 (전체 입자 기준)
- [x] 차트 3개 가로 배치 (`.chart-wrap` flex)
- [x] 유령 입자 피스톤 충돌 카운트 포함 (`getTotalPistonCollisionCount`, 10× 샘플로 노이즈 감소)
- [x] 충돌/s EMA 스무딩 (α = 0.15, τ ≈ 1.5 s)

**탐구 보고서 (docx)**
- [x] [📄 탐구 보고서 초안 생성] 버튼 (Q1 + Q2 + Q3 "대화 마무리" 시 활성)
- [x] docx 직접 다운로드 (모달 없음)
- [x] 보고서 구조 (8 섹션): 1. 탐구 제목 / 2. 목표 / 3. 조건 / **4. 실험 결과 (표 + 차트 이미지 자동 삽입)** / 5. 데이터 분석 / 6. 결론 / 7. 더 탐구하고 싶은 것 / **8. 반성 (학생 작성 가이드)**
- [x] SVG → PNG ArrayBuffer 변환 후 `ImageRun` 삽입 (docx.js 8.5.0 UMD)
- [x] [💬 대화 내려받기] — 전체 대화 txt 저장

---

## 2-C. 2026-04-22 세션 추가 기능 (v0.4-boyle-complete)

**AI 튜터 고도화**
- [x] 오개념 감지 원칙 (systemPrompt 원칙 9): 물리적 오류 발견 시 직접 교정 대신 "잠깐, [학생이 한 말]이라고 하셨는데 [반례 상황]에서도 그럴까요?" 형식의 반례 질문
- [x] 수준 자동 감지 원칙 (systemPrompt 원칙 10): AI가 응답 끝에 `[[LEVEL:xxx]]` 신호 삽입 → 클라이언트에서 파싱 → 드롭다운 자동 전환 + 초록색 토스트 알림 (태그는 학생에게 비표시)
- [x] **4단계 수준 시스템** (초등/중학/고등/대학) — 기존 3단계(중/고/대)에서 확장
- [x] 수준별 Q1~Q4 텍스트 — 같은 질문도 학생 수준에 맞춰 다른 문구 (`QUESTION_TEXT[level][q]` 중첩 구조)
- [x] 수준별 QUESTION_FOCUS — AI 튜터의 교육적 의도도 수준별로 차별화 (16개 지침: 4 수준 × Q1-Q4)
- [x] `LEVEL_GUIDES`에 `elem` 프로필 추가 (공·구슬 비유, 수식 없음, 격려 많이)

**물리 시각화 안정성**
- [x] 유령 입자(2700) 피스톤 충돌 카운트 포함 → 실입자만의 Poisson 잡음 10× 감소 (`getTotalPistonCollisionCount`)
- [x] 충돌률 EMA 스무딩 α=0.15, τ≈1.5s, 250ms 갱신
- [x] **안정화 윈도우 10초**로 확장 (기존 1s → 2s → 4s → 6s → 10s로 단계적 확장, 충돌률이 새 압력에서 충분히 수렴하도록)
- [x] 안정화 카운트다운 UI (`#stabilization-countdown`) — 대기 중: 주황 "안정화 중... 약 N초" / 완료: 녹색 (130px min-width로 레이아웃 shift 방지)

**보고서 재구조화**
- [x] docx 보고서 섹션 순서 재편 — 서술 중심 구조 (제목·목표·조건 → 결과 → 분석·결론·확장·반성)
- [x] §4 "실험 결과"에 표 + 3개 차트 이미지 코드로 자동 삽입 (AI는 `[표와 그래프 자동 삽입]` 텍스트 출력 금지 지시)
- [x] §8 "반성" 학생 직접 작성 가이드 (회색 이탤릭 안내 문구)
- [x] 충돌/s vs P 차트 (3번째 차트, 보라색 `#8e44ad`)

---

## 2-D. Phase 3 착수 — 소프트웨어 부분 완료 (2026-04-22)

Arduino·ESP32 하드웨어 입수 전 선행 가능한 브라우저·프로토콜 쪽을 완료. Mock 어댑터로 전체 UI 체인을 테스트 가능한 상태.

**시리얼 어댑터 계층**
- [x] `SensorSource` 추상 베이스 — 이벤트 시스템(`on`/`_emitEvent`), `connect/disconnect`, `sendCalib/sendConfig` 인터페이스 통합
- [x] `MockSensorSource` — `connect/disconnect` 이벤트 발행, `sendCalib` (현재압을 p₀로 에뮬레이트), `sendConfig(rateMs)` (주기 동적 변경)
- [x] `WebSerialSensorSource` 신규 구현 (`web/js/serial.js`)
  - Web Serial API 포트 선택·열기·읽기 루프
  - `TextDecoder` 스트리밍 + `LINE_BUFFER_MAX=4096` 오버플로 가드
  - 2 s 주기 ping keep-alive, 3 s `HELLO_TIMEOUT_MS` v1.0 폴백
  - `NotFoundError`(사용자 취소) 무시, 읽기 루프 에러를 `"error"` 이벤트로 격상
- [x] `createSensorManager(initialPressure)` 팩토리 — 모드 전환 간 `onData`/`on(...)` 구독 유지, `setMode('mock'|'real')` 로 내부 source 교체

**프로토콜 v1.1 확정**
- [x] `docs/05-data-format.md` 에 v1.0(레거시) + v1.1 스펙 공존 명세
- [x] 펌웨어 → 브라우저: `"t":"d"` (데이터), `"t":"s"` (hello/상태), `"t":"c"` (캘리브 ACK), `"t":"e"` (에러)
- [x] 브라우저 → 펌웨어: `"t":"ping"`, `"t":"calib"`, `"t":"cfg","rate":ms`
- [x] 버전 협상 규칙 (펌웨어가 `"t":"s"`를 먼저 보내면 v1.1, 타임아웃 시 v1.0 폴백)
- [x] 단위 규약: 기존 kPa 유지

**UI 패널**
- [x] `#section-controls` 상단에 `#sensor-panel` 추가 (index.html)
  - `[🖥 시뮬레이션] / [⚡ 실센서]` 모드 토글
  - `[🔌 포트 연결] / [✖ 연결 해제]` 버튼
  - 상태 배지 (연결 안 됨 / 연결됨 / 에러), 센서 라벨·펌웨어 버전 표시
  - `[🎯 영점 캘리브]` — 연결 시에만 활성, 성공 시 `p₀ = N.N kPa` 표시
  - 에러 토스트 5 s 자동 소멸
- [x] `initSensorPanel(sensorManager)` — Web Serial 미지원 브라우저에서 실센서 버튼 자동 비활성화 + 툴팁
- [x] `main.js`에서 `USE_MOCK_SENSOR` 플래그 제거 → sensorManager 기반 일원화, 부팅 시 Mock 자동 연결
- [x] Mock 모드로 전체 UI 체인 (슬라이더 → 센서 → box → info panel → 측정 기록 → 차트 → 보고서) 정상 동작 확인

**Mock 테스트 가능 상태의 의미**: 하드웨어 없이도 (1) 모드 토글, (2) 이벤트 라우팅, (3) 상태 배지·에러 표시, (4) 캘리브 피드백까지 모든 UI 경로가 검증 가능. 실 펌웨어 붙이면 `t` 필드 파서만 실제 라인을 받아 동일 이벤트 발행.

---

## 2-E. 심화 탐구 모드 + 기본 실험 확장 (`feature/particle-controls`)

`main` 브랜치의 보일 법칙 MVP 위에 **기본/심화** 듀얼 탭 구조를 얹고, 기본 실험도 범위 확장했다. 모든 작업은 `feature/particle-controls` 브랜치에 누적.

### 탭 분리 + 심화 탐구 신규 구현
- [x] 상단 탭 (`#mode-tabs`) — `🔬 기본 실험` / `⚗️ 심화 탐구`
- [x] `initModeTabs({ onSwitch })` — 전환 시 p5 draw 루프 pause/resume
- [x] 탭별 독립 DOM (모든 심화 요소는 `adv-` 접두사)

### 심화 탐구 물리 모델
- [x] **부피 주도** (기본과 반대): 학생이 V 슬라이더 조작 → `P = P₀·(V₀/V)·(T/T₀)·(N/N₀)` 로 압력 자동 계산
- [x] 입자 수 자유 조절 (50~800, step 50) — 슬라이더 변경 시 `ParticleSystem` 재생성
- [x] 기체 종류 4종: **He (4) / N₂ (28) / Ar (40) / CO₂ (44) g/mol**
- [x] 속도 스케일: `σ = σ₀·√(T/T_ref)·√(m_ref/m)` — 2-D Maxwell-Boltzmann 정합
- [x] 온도 범위 **−100 °C ~ 500 °C** (프리셋 6개: −100/0/25/100/300/500 + 커스텀)
- [x] 유령입자 **0개** (순수 실입자 통계) — 관측 노이즈를 체감 포인트로

### 심화 탐구 시각화
- [x] **메인 실린더** (1000×360 p5) — 기본 실험 `drawCylinderShell / drawPiston / drawParticlesHSB` 헬퍼 재사용
- [x] **추적 실린더** (400×144 p5, `p.scale(0.4)`) — `particles[0]` 한 개만 빨강→파랑 HSB + 3× 반경 + 다크 외곽선으로 강조, 45프레임 잔상 (속도별 HSB + 알파 페이드)
- [x] 추적 실린더 하단 **속도 게이지** (HTML/CSS) — 현재 속도 바 + 평균 속도 세로 마커, 100 ms 갱신
- [x] **볼츠만 히스토그램**: x축 `4·σ(He, 500°C)` 고정, y축 peak-normalized (`probDensity / (1/σ)·e^(−0.5)` → 이론 peak 항상 y=1), EMA 제거
- [x] **피스톤 충돌 플래시** — 기본 실험과 동일 소스(`getLastPistonCollisions`), 고정벽 제외

### 심화 탐구 데이터 기록
- [x] **PV/nT 검증 표** (`#adv-section-measurements`): 컬럼 `# / 기체 / T(K) / V(mL) / N / P(kPa) / PV·nT⁻¹` + 행별 `×` 삭제
- [x] **PV/nT 막대 그래프**: y축 `0 → mean × 2` 고정 스케일, 이론선(평균) 토글
- [x] CSV 내보내기: `advanced_pvnt_YYYY-MM-DD_HH-MM-SS.csv` (UTF-8 BOM)
- [x] `기록` 버튼 — 컨트롤 바 우측(기체 드롭다운 옆), 강조색

### 심화 탐구 AI 튜터
- [x] 독립 사이드바 (`#adv-ai-sidebar`) — Q1-Q4 + 자유 탭, 메시지 입력, 학생 수준/모델 드롭다운
- [x] **기본 실험과 API 키 공유** — `sessionStorage["pchem_api_key"]` 동일 키, 키 입력 UI는 기본 실험에만
- [x] `createAdvAiTutor({ getAdvState })` — 자체 대화 상태, Anthropic Messages API 직접 호출
- [x] `buildContext` 에 실험 조건 + 기록된 측정점(N≥2 시) 포함
- [x] `× 사이드바 접기` + 우측 재열기 버튼 (`body.adv-sidebar-collapsed` 로 scoped)
- [x] 입력창 활성 상태 = API 키 유무 반영 (`updateInputAvailability()`, 탭 전환·포커스·탭 클릭 시 갱신)

### 심화 탐구 레이아웃
- [x] 제어 영역 2줄 압축 — 온도 / [부피+압력+입자수+기체+기록]
- [x] 측정 기록 + 그래프 3카드 가로 배치

### 기본 실험 확장 (동시 반영)
- [x] **압력 슬라이더 81 ~ 500 kPa** (기존 81 ~ 230 kPa)
- [x] 실린더 캔버스 900 → **1000 px**, `BOX_INITIAL_X` 40 → 20, `BOX_MAX_WIDTH` 760 → 880, `BOX_MIN_WIDTH` 200 → 120 (P=500 kPa 지점 V≈10.1 mL 시각화)
- [x] 측정 그래프 영역 3카드 (표 : P-V : 1/V-P = 4 : 3 : 3)
- [x] **1/V vs P 그래프 신규** — x: 0~500 kPa, y: 0~0.12 (1/mL), 이론선 `1/V = P/(P₀·V₀)` 토글
- [x] 그래프 토글 기본 미체크 + 측정점 2개 이상일 때만 활성화
- [x] 측정점 표 컬럼 `기체 / 온도(K)` 컨텍스트 추가

### 미적용 / 후속 작업
- [ ] main 병합 전 실전 검증 (수업 시뮬레이션)
- [ ] 측정 기록 관련 리그레션 테스트 (500 kPa 범위에서 `runPVAccuracyTest` 갱신)
- [ ] AI 튜터 심화 모드 전용 프롬프트 튜닝 (기체 종류 비교 유도 등)
- [ ] 반응형 레이아웃 — **별도 브랜치 진행 중**. 현 브랜치는 데스크탑 ≥ 1872 px 기준 (심화 탭)

---

## 3. 진행 중인 작업

**Phase 3: Arduino 실센서 통합** — 소프트웨어 레이어 완료, **하드웨어·펌웨어 대기**.

다음 필수 작업:
- [ ] Arduino / ESP32 하드웨어 입수 (DFRobot SEN0257)
- [ ] 펌웨어 작성 (프로토콜 v1.1 준수, USB-CDC 115200 baud, `"t":"s"` hello + 주기 `"t":"d"` 송신)
- [ ] 실센서 캘리브레이션 — 영점 보정 플로우 검증, 필요 시 2점 보정 추가
- [ ] 노이즈 튜닝 (펌웨어 측 이동평균 / 브라우저 측 스무딩 α 조정)
- [ ] 파일럿: 실제 주사기 + 센서로 보일 법칙 데이터 수집, `PV = const` ±2 % 검증

---

## 4. 남은 Phase (로드맵)

### Phase 3: Arduino 실센서 연동 (진행 중)
- [x] Web Serial 어댑터 + 프로토콜 v1.1 + UI 패널
- [ ] 하드웨어·펌웨어·캘리브레이션·노이즈 튜닝 (위 §3 참조)
- 예상 소요: 핵심 구현 0.5~1일 + 현장 적응 2~5일 (소프트웨어 완료분 제외)

### Phase 4: 비교 UX
- Mock ↔ 실센서 병행 표시 (전환 토글)
- 반데르발스 편차 탐구 모듈 (§7 부산물 참조)
- 이상기체 vs 실제 기체 비교 그래프

### Phase 5: 다른 법칙 확장
- 샤를 법칙 — 별도 하드웨어 (`docs/02-hardware-charles.md`), DS18B20 + 에어챔버
- 게이뤼삭·이상기체 법칙 통합 UX

### Phase 6: 교사 도구
- 학생 활동 모니터링 대시보드
- 다중 사용자 지원 (서버·DB 필요, 아키텍처 변화 수반)

---

## 5. 핵심 설계 철학

이 프로젝트는 **"기체 법칙이 성립하는 순간 미시 세계에서 실제로 무엇이 일어나는가를 학생이 볼 수 있게 한다"**를 목표로 한다. 핵심 원칙 요약:

- **2층 분리**: 실측(센서·학생 입력)은 숫자 계층, 시뮬레이션은 정성적 인과 시각화 계층. 두 층이 동시에 돌며 Johnstone의 macro ↔ sub-micro 연결이 완성됨.
- **시간축 분리 수렴**: 1차 물리량(속도)은 즉시 반영, 2차 물리량(부피)은 `tau` 지수 수렴. 공식이 아닌 **인과 과정**을 시간축에 펼침.
- **시각화가 주인공**: HSB 색·충돌 섬광·히스토그램을 **하나의 속도 색 언어**로 통합.

자세한 근거·수식·튜닝 파라미터:
- 교육학·비전: `docs/00-project-overview.md`
- 물리 모델·충돌 규칙: `docs/04-simulation-physics.md`
- 데이터 흐름·모듈 의존성: `docs/03-software-architecture.md`

---

## 6. 주요 수치 확정값 (실측 기반)

코드 및 `web/config/params.json` 기준.

| 항목 | 값 | 출처 |
|---|---|---|
| 슬라이더 범위 (기본) | 81 ~ 500 kPa (`feature/particle-controls`), main: 81 ~ 230 | `ui.js` `createDevPressureSlider` |
| 부피 슬라이더 범위 (심화) | 20 ~ 80 mL | `index.html` `#adv-volume-slider` |
| 온도 범위 (기본) | 0 ~ 77 °C | `ui.js` `createTemperatureControl` |
| 온도 범위 (심화) | −100 ~ 500 °C | `index.html` `#adv-temp-custom-input` |
| 기본 온도 | 25 °C (298.15 K) | `params.json` `initial_temperature_K` |
| 초기 P | 101.3 kPa | `params.json` `initial_pressure_kPa` |
| 초기 V 표시 | 30.0 mL | `params.json` `initial_volume_mL` |
| V_baseline (25 °C 기준) | 50.0 mL | `params.json` `baseline_volume_mL` |
| 기준 가스 폭 (px) | 600 | `params.json` `baseline_gas_width_px` |
| `SIM_CANVAS_WIDTH` | 1000 (`feature`), main: 900 | `renderer.js` |
| `BOX_INITIAL_X` | 20 (`feature`), main: 40 | `simulation.js` |
| `BOX_INITIAL_WIDTH` | 600 | `simulation.js` |
| `BOX_MIN_WIDTH` | 120 (`feature`), main: 200 | `simulation.js` |
| `BOX_MAX_WIDTH` | 880 (`feature`), main: 760 | `simulation.js` |
| `BOX_INITIAL_HEIGHT` | 250 | `simulation.js` |
| `PARTICLE_RADIUS` | 2.5 px | `simulation.js` |
| 실입자 수 (기본) | 300 | `params.json` `particle_count` |
| 실입자 수 범위 (심화) | 50 ~ 800 (step 50, 기본 300) | `index.html` `#adv-particle-slider` |
| 유령 입자 수 (기본) | 2700 | `params.json` `ghost_count` |
| 유령 입자 수 (심화) | 0 | `main.js` `initAdvancedMode` |
| 기체 종류 (심화) | He(4) / N₂(28) / Ar(40) / CO₂(44) g/mol | `main.js` `ADV_GAS_MASSES` |
| `DEFAULT_SPEED_SCALE` | 120 (초기 RMS 기준) | `simulation.js` |
| `DT_CAP` | 0.05 s (프레임 드롭 가드) | `simulation.js` |
| 속도 수렴 시정수 | 0.05 s | `params.json` `velocity_tau_seconds` |
| 부피 수렴 시정수 | 0.5 s | `params.json` `volume_tau_seconds` |
| 온도 전이 시정수 | 0.3 s | `main.js` `TRANSITION_TAU` |
| 압력 스무딩 윈도우 | 0.3 s | `params.json` `pressure_smooth_window_sec` |
| 섬광 지속 시간 | 0.12 s | `params.json` `flash_duration_sec` |
| 섬광 초기 alpha | 120 | `params.json` `flash_initial_alpha` |
| `v_max_color_factor` | 2.0 (× v_max_init) | `params.json` |
| 렌더링 FPS | p5.js 기본 60 | (명시 `frameRate` 호출 없음) |
| 안정화 윈도우 | 10 s (200 샘플 × 50 ms) | `ui.js` `STABILIZATION_WINDOW` |
| 안정화 임계 | 0.5 % | `ui.js` `STABILIZATION_THRESHOLD` |
| 이동평균 기록 윈도우 | 1 s (안정화 버퍼 재사용) | `ui.js` |
| 연속 로그 샘플링 | 250 ms (4 Hz) | `main.js` `CONTINUOUS_SAMPLE_INTERVAL_MS` |
| 연속 로그 최대 행 | 10,000 | `main.js` `CONTINUOUS_MAX_ROWS` |
| 히스토그램 bin | 40 | `renderer.js` `HIST_BIN_COUNT` |
| 히스토그램 시간 EMA | α = 0.03 | `renderer.js` `HIST_TIME_ALPHA` |
| PV 정확도 목표 | ±2 % | `runPVAccuracyTest` |
| PV 정확도 실측 | **±0.5 % 이내** | 동 |

---

## 7. 물리 검증 기록

상세 검증 기록은 **`docs/08-physics-validation.md`** 로 이관됨.

주요 결과 요약:
- 보일 법칙 `P·V = const`: 편차 **±0.5 %** (목표 2 %, `runPVAccuracyTest` 자동화)
- 속도 `√T` 비례 (0 → 77 °C): 실측 1.137 vs 이론 1.132 (오차 0.4 %)
- 운동에너지 `T` 비례 (0 → 77 °C): 실측 1.282 vs 이론 1.282 (오차 0 %)
- Charles `V ∝ T` 선형, 2D 맥스웰-볼츠만 분포 시각 일치

검증 방법·데이터 표·한계·재현 지침은 08 참조.

---

## 8. 기술 스택

- **프론트엔드**: Vanilla HTML/CSS/JavaScript (프레임워크 없음)
- **시뮬레이션·히스토그램**: p5.js 1.11.2 (CDN)
- **AI**: Anthropic Claude API (BYOK, 브라우저 직접 호출, `anthropic-dangerous-direct-browser-access` 헤더)
- **배포**: GitHub Pages (정적 호스팅)
- **버전 관리**: Git
- **빌드 시스템 없음** — `<script defer>` 글로벌 네임스페이스

---

## 9. 저장소·배포 정보

- **GitHub 저장소**: https://github.com/police6980/pchem-lab-project (public)
- **배포 URL**: https://police6980.github.io/pchem-lab-project/web/
- **브랜치**: `main`
- **릴리스 태그**: `v0.2-mvp-ui-complete` (Part 3.5 UI 완성), `v0.3-ai-tutor-live` (Phase 2-B 완료), `v0.4-boyle-complete` (보일 시뮬레이터 완성 — **최신**)

---

## 10. 관련 문서 링크

**현재 존재**
- `00-project-overview.md` — 프로젝트 비전·교육학적 근거
- `01-hardware-boyle.md` — 보일 장비 하드웨어 (ESP32 + SEN0257, Phase 3 대상)
- `02-hardware-charles.md` — 샤를 장비 하드웨어 (DS18B20 + 에어챔버, Phase 5 대상)
- `03-software-architecture.md` — 웹 앱 모듈 구성·데이터 흐름
- `04-simulation-physics.md` — 시뮬레이션 물리 모델·충돌·시각화
- `05-data-format.md` — JSON 프로토콜·CSV 스키마·params.json
- `06-project-status.md` — **본 문서** (진행 상태 마스터)

**계획 문서 (신규)**
- `07-ai-tutor.md` — AI 튜터 설계 (프롬프트, 컨텍스트 구성, 에러 처리)
- `08-physics-validation.md` — 물리 검증 기록 (현재는 본 문서 §7에 보관)
- `09-roadmap.md` — Phase 3~6 상세 로드맵
