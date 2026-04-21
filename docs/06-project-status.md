# 06. 프로젝트 진행 상태

**문서 목적**: 현재 구현 상태와 남은 작업의 마스터 트래커. 다른 설계 문서는 "어떻게 만들어졌는가"를 설명하고, 이 문서는 "어디까지 왔는가"를 기록한다.

**마지막 업데이트**: 2026-04-21
**현재 버전**: Part 3.5 완료 (v0.2 MVP 직전, Phase 2-B 진행 중)

---

## 1. 빠른 요약

보일 법칙 MVP의 물리 엔진과 UI는 사실상 완성 상태다. 2D 입자 시뮬레이션(실입자 300 + 유령 2700), 맥스웰-볼츠만 분포 시각화, HSB 속도 색상, 충돌 섬광, 안정화 감지 기반 측정 기록, PV 산점도, 분석 화면, CSV 내보내기까지 모두 동작한다. 이상기체 `PV = const` 편차는 **±0.5 % 이내**로 확인됐다(목표 2 %).

Part 3.5에서 왼쪽 분석 영역의 성찰 textarea를 제거하고, 우측 사이드바(380 px sticky) 기반 대화형 AI 튜터 UI로 통합했다. Q1/Q2/Q3/자유 탭, 메시지 말풍선, 설정 패널(BYOK), 입력창까지 구조·UI 완비. **실제 Anthropic API 호출은 아직 더미 함수로 시뮬레이션 중**이며, 이것을 교체하는 것이 **Phase 2-B (Part 4)**의 작업이다.

다음 작업: Phase 2-B 완료 후 Phase 3 (Arduino 실센서 연동)로 진입.

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

**AI 튜터 UI** (구조·UI 완성 / 실제 API 호출은 Phase 2-B)
- [x] 우측 사이드바 (380 px sticky, 5 섹션 메인 레이아웃)
- [x] 설정 패널 접이식 (API 키·학생 수준·모델·경고·사용량 표시)
- [x] Q1/Q2/Q3/자유 탭 (측정점 ≥ 3 조건 gating, 자유는 상시 활성)
- [x] 메시지 말풍선 (학생 우측 보라·AI 좌측 회색, 마크다운 렌더)
- [x] 입력창 (Enter 전송·Shift+Enter 줄바꿈, API 키·탭 준비 상태 기반 활성)
- [x] BYOK sessionStorage 패턴, 가격표 기반 원화 환산
- [ ] **실제 Anthropic API 호출** — Phase 2-B에서 더미 함수 교체 예정

**배포·개발 도구**
- [x] GitHub Pages 배포: https://police6980.github.io/pchem-lab-project/web/
- [x] `runPVAccuracyTest()` 콘솔 자동 검증 (6점 순차 기록, 편차 < 2 % 확인)
- [x] Mock 센서 기반 개발 환경 (실 ESP32 없이 UI 검증 가능)

---

## 3. 진행 중인 작업

### Phase 2-B: AI 튜터 실제 API 연동 (Part 4)

**현재 상태 (2026-04-21 기준)**: 대화 UI는 완성. 모든 AI 응답은 `generateDummyAiResponse` 더미 함수로 시연 중. 실제 Anthropic Messages API 호출은 Phase 2-B 완료 시점부터 작동.

> Phase 1 체크리스트의 "AI 튜터 UI" · "BYOK 설정" 항목은 **구조·UI 완성**을 의미하며, 실제 LLM 응답은 Phase 2-B 완료 후부터 흘러옴.

작업 내용:
- [ ] `fakeApiDelay` + `generateDummyAiResponse` 제거, Anthropic `/v1/messages` `fetch`로 교체
- [ ] 대화 히스토리 전체를 `messages` 배열로 누적 전송 (multi-turn)
- [ ] 타이핑 인디케이터 표시 (요청 중 말풍선 placeholder)
- [ ] 에러 처리 (401 키 불일치, 429 rate limit, 529 overloaded, 네트워크 0)
- [ ] 토큰 사용량 누적 + 원화 환산 표시 (기존 `updateUsageDisplay` 활성화)
- [ ] 비용 경고 배너 (100원 주황, 500원 빨강)
- [ ] [세션 초기화] 버튼 (질문별 대화 삭제, 누적 사용량은 유지)
- [ ] `seedDummyMessages`·`fakeApiDelay`·`generateDummyAiResponse` 최종 제거

예상 소요: 집중 작업 1시간 이내. 선행 조건: docs 리뉴얼(06~08) 완료.

---

## 4. 남은 Phase (로드맵)

### Phase 3: Arduino 실센서 연동
- DFRobot SEN0257 + ESP32 펌웨어
- Web Serial API 어댑터 (`serial.js`의 `MockSensorSource` → 실센서 모듈로 교체만으로 전환)
- 캘리브레이션 UI (영점·2점 보정)
- 연결 관리 UI (포트 선택·재연결·실패 안내)
- 파일럿: 실제 주사기 + 센서로 보일 법칙 데이터 수집
- 예상 소요: 핵심 구현 0.5~1일 + 현장 적응 2~5일

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
| 슬라이더 범위 | 81 ~ 230 kPa | `ui.js` `createDevPressureSlider` |
| 기본 온도 | 25 °C (298.15 K) | `params.json` `initial_temperature_K` |
| 온도 입력 범위 | 0 ~ 77 °C | `ui.js` `createTemperatureControl` |
| 초기 P | 101.3 kPa | `params.json` `initial_pressure_kPa` |
| 초기 V 표시 | 30.0 mL | `params.json` `initial_volume_mL` |
| V_baseline (25 °C 기준) | 50.0 mL | `params.json` `baseline_volume_mL` |
| 기준 가스 폭 (px) | 600 | `params.json` `baseline_gas_width_px` |
| `BOX_INITIAL_WIDTH` | 600 | `simulation.js` |
| `BOX_MIN_WIDTH` | 200 | `simulation.js` |
| `BOX_MAX_WIDTH` | 760 | `simulation.js` |
| `BOX_INITIAL_HEIGHT` | 250 | `simulation.js` |
| `PARTICLE_RADIUS` | 2.5 px | `simulation.js` |
| 실입자 수 | 300 | `params.json` `particle_count` |
| 유령 입자 수 | 2700 | `params.json` `ghost_count` |
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
| 안정화 윈도우 | 1 s (20 샘플 × 50 ms) | `ui.js` `STABILIZATION_WINDOW` |
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

> **주석:** 향후 `docs/08-physics-validation.md`로 이관 예정. 현재는 본 문서에 임시 보관.

### 이상기체 `PV = const` (±0.5 %)

`runPVAccuracyTest()` 콘솔 자동화:
- 슬라이더 81·100·130·160·190·220 kPa 순차 기록
- 각 점마다 안정화 감지 통과 후 1 s 이동평균으로 저장
- 편차 < 0.5 % (목표 2 %)
- 관련 커밋: `0f575e7` (PV accuracy 개선)

### Charles 법칙 `V ∝ T` 선형

- 0 °C (273.15 K) → V_baseline = 45.80 mL
- 25 °C (298.15 K) → V_baseline = 50.00 mL (기준)
- 77 °C (350.15 K) → V_baseline = 58.72 mL
- 선형 관계 정확 (V₀ = 50 × T/298.15)

### Equipartition `KE ∝ T`

- 25 °C → 평균 속도 172 px/s, KE 14,796 a.u.
- 77 °C → 평균 속도 184 px/s, KE 16,908 a.u.
- KE 비 1.143 ≈ 350.15/298.15 ✓
- 2D 자유도 2개 모두 정확히 열적

### 2D 맥스웰-볼츠만 분포 형태

이론 곡선 오버레이로 실측과 시각적 일치 확인. σ = RMS/√2 변환식 적용.

### 부산물: 반데르발스 편차 재현 (고밀도)

입자 간 탄성 충돌 구현 후 고밀도 상태에서 P·V 곱이 +16 % 상승:
- 저밀도 (50 kPa, width 800): PV ≈ 15,200 (기준)
- 기본 (101 kPa, width 400): PV ≈ 15,200 ✓
- 고밀도 (300 kPa, width 135): PV ≈ 17,685 (+16 %)

해석: 입자 반지름(2.5)이 박스 폭 대비 무시할 수 없을 때 "유효 부피" 감소 효과 — 반데르발스 방정식 `(P + a/V²)(V − b) = RT`의 b항(입자 크기 보정)의 미시적 재현. v1 탄성 충돌 구현의 부산물이며, Phase 4에서 교육적 활용 설계 예정.

관련 커밋: `5e83191` (입자 간 탄성 충돌 구현).

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
- **릴리스 태그**: `v0.2-mvp-complete` (Phase 2-B 완료 시 부여 예정)

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
