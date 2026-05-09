# 증기압 실험 시뮬레이션 설계

> Phase 6 신규 트랙. 보일·돌턴 패턴 재사용, AI 튜터 통합, 4 모드 분기 적용.

---

## 1. 정체성 및 핵심 철학

**한 줄**: 삼각플라스크 + 수조(중탕) 셋업으로 T 변화에 따른 액-기 동적 평형 관찰. 시뮬은 미시 인과(증발·응축) 가시화, 실측 P/T는 시뮬 구동 신호.

**Johnstone 3수준 매핑**:
- macro: 학생 가시 실측값 — 수조 T, 플라스크 내부 P
- sub-micro: 시뮬 입자 — 액체상·기체상, 증발/응축 사건
- symbolic: 측정점 표 (T, P_vap) → 그래프 → ln P vs 1/T (univ에서 C-C 식)

---

## 2. 학습 목표

MVP 학습 목표 4개:

1. **동적 평형의 속도론적 정의** — 증발 속도 = 응축 속도. 반응이 멈춘 것이 아닌 안정점.
2. **T-증기압 관계** — 정성 (high까지) → 정량 / Clausius-Clapeyron (univ)
3. **분자 수준 인과** — Maxwell-Boltzmann 분포 + 탈출 에너지 임계
4. **양방향 접근** — 평형은 안정점, 서로 다른 출발 조건도 같은 P_vap로 수렴

MVP 외 후속 트랙 학습 목표:
- 세기 성질 발견 (β) — V_liquid 변화에도 평형 P 동일, V_gas 는 평형 도달 시간에만 영향
- 물질 휘발성 비교 (α) — 동일 T 에서 액체 종류만 변경 시 평형 P 차이 (분자간 힘 비교). Phase 6.5 에 β 와 통합 비교 화면으로 구현
- 라울 법칙 — 혼합 액체 (별개 후속 항목)
- 끓는점-외압 관계 (별도 시린지 셋업)

---

## 3. 학생 수준 차등 (돌턴 패턴 재사용)

| 수준 | 노출 범위 |
|---|---|
| elem | 목표 ① 정성. 평형 = "변화가 멈춘 듯 보이는 상태" |
| middle | ① + ② 정성 (T↑ → P↑) |
| high | ①~④. C-C 식은 정성적 언급 |
| univ | ①~④ + C-C 식 정량, ln P vs 1/T 그래프 |

---

## 4. 실험 셋업

**물리 구성**:
- 삼각플라스크: 100 / 250 / 500 mL 프리셋 (실험실 규격)
- 액체: 물 (MVP). 에탄올은 후속 옵션
- 플라스크 입구: 밀폐 마개 + 압력 센서 포트 (ESP32-S3 + DFRobot Gravity)
- 외부: 수조에 잠김. 수조 가열 → 수조 T가 실험 제어 변수
- 온도 센서: 수조 안 (플라스크 내부 아님)

**열평형 가정**: 수조 ↔ 플라스크 내 액체 간 충분 시간 후 열평형. 수조 T = 플라스크 액체 T로 가정. "충분 시간"이 무엇인지는 학생 토론 거리.

**측정 채널**:
- P (kPa): 플라스크 내부 절대압 또는 게이지압 (펌웨어 결정 사항)
- T (°C): 수조 온도

---

## 4.5 실측 압력 자동 보정 (P_total → P_vap)

기체 압력 센서로 측정되는 값은 `P_total = P_air(T) + P_vap(T)`. 용기를 진공으로 만들 수 없는 실험 환경상 공기 기여분을 자동 보정해 학생에게는 깨끗한 `P_vap` 만 노출.

### 보정 식
- 기준점 `(T_0, P_total_0)` 은 실험 시작 직후 첫 1초 평균값.
- `T_0` 에서 액체별 포화 증기압 `P_vap_lookup(T_0)` 표에서 추출.
- 공기 분압 초기값: `P_air(T_0) = P_total_0 - P_vap_lookup(T_0)`
- 이상기체 V 일정 가정으로 임의 T 의 공기 분압: `P_air(T) = P_air(T_0) × (T / T_0)` (T 는 절대온도 K)
- 학생 가시 증기압: `P_vap(T) = P_total(T) - P_air(T)`

### 학생 가시
- 압력 게이지: `P_vap` (kPa)
- 측정점 표: `(T_celsius, P_vap)`
- raw `P_total` / `P_air` 는 개발 모드 토글로만 노출.

### 모드별 동작
- mock: 보정 비활성. 시뮬 P 를 `P_vap` 로 직접 표시.
- ws / real / vernier: 자동 보정 활성.

### 가드
- `P_vap < 0` 또는 `P_vap > 1.5 × P_vap_lookup(T)` : "측정 이상 가능 — 마개 누출?" 경고 표시.

### 실험 권장
- 시작 온도 ≥ 40°C 권장 — 25~30°C 구간은 ΔP_vap 너무 작아 공기 팽창 대비 신호 묻힘.

### params.json 신규
- `liquids: { water: { p_vap_table_celsius_to_kpa: [[0, 0.61], [5, 0.87], [10, 1.23], ...], ... } }`
- `correction_settle_sec` (기본 1.0) — 첫 1초 평균
- `correction_warning_factor` (기본 1.5) — 누출 가드 배수

### 배제된 대안
- 옵션 B (학생 직접 분해): 영재 능동 학습 가치 있으나, 본 시뮬의 핵심은 "동적 평형 가시화" 라 분해 활동은 시뮬 학습 흐름에서 분리되는 부담. 후속 워크시트 활동으로 분리 가능.
- 옵션 C (셋 다 표시 + 학생 수준 토글): 화면 복잡도↑, MVP 우선 단순화. 후속에서 개발 모드 토글로 일부 제공 가능.

> **구현 시점**: docs/17 명세는 본 commit 에서 추가. 코드 구현은 Phase 6.2 (실측 T 통합) 또는 6.1-d (측정 패널) 에서 진입. 결정 블록은 6.1 종료 시 일지에 묶어 기록.

---

## 5. 입력 변수 및 자동 스케일

학생 입력 (실험 시작 전 1회. 시작 후 잠금. 리셋으로 재설정 가능):
- `V_flask`: 100 / 250 / 500 mL 프리셋
- `V_liquid`: 자유 입력. 가드 — `0 < V_liquid ≤ 0.5 · V_flask`
- 액체 종류: 물 / (에탄올, 후속)

파생: `V_gas = V_flask − V_liquid`

**자동 스케일 정책** (시각 고정, 의미 단위만 변동):
- 시뮬 캔버스 픽셀 크기 일정
- 액체상·기체상 영역 박스 비율 = V_liquid : V_gas
- 화면 입자 수 가독성 위해 고정 (액체 ~600, 기체 평형 시 ~30, params.json 조정)
- "1 입자가 표상하는 mol"이 입력에 따라 변동 → 패널에 표시
- 압력 게이지 y축: V_gas에 따라 자동 범위 조정 (plateau가 화면 안에 들어옴)

---

## 6. 시뮬레이션 명세

### 액체상·기체상 모델 — 교과서 정합 (정적 격자 + 표면 동적)

본 시뮬은 분자 동역학 시뮬레이션이 아님. 학습 목표 (동적 평형 가시화) 달성에 필요한 최소 추상화 모델.

**발견 (Phase 6.1-b 5+ 회 시도 끝)**: 액체 내부에 분자 운동을 시뮬하면 "가득 차있음" 보장 불가능 (격자 진동·자유 이동+중력·표면 띠·사건 추상화·LJ MD·응집 영역 가속도장 모두 시각 결함). 사용자가 처음부터 명시한 "분자 운동 중요 X, 표면만 명확하게" 요구가 정답.

#### 액체 내부 = 정적 격자

- V_liquid 영역에 격자 빈틈없이 배치 — 200~300 입자 자동 계산 (V_liquid 영역 면적 + `molecule_radius_px` 기반).
- 위치 고정, 운동 X (또는 ±0.5 px 미세 진동, `liquid_jitter_amp_px`).
- 절대 사라지지 않음. 격자 항상 가득.

#### 표면 한 줄 = 동적

- 격자 위 경계 한 줄 (격자 칸 수만큼).
- 좌우 미세 진동 (±2 px, `surface_jitter_amp_px`, sinusoidal).
- 매 1 초마다 확률 게이트 (`p_evap_per_sec_per_particle`, 매우 작게) → 통과 시 GasParticle 생성 (`gas_init_KE` 위 방향 발사).
- 표면 입자는 사라지지 않음 (격자 자리 항상 채움).

#### 기체 = 자유 비행

- 시작 0 개. 증발 사건으로만 생성.
- LJ X. 단순 hard sphere 분자-분자 충돌 (등질량 impulse exchange) + 박스 사방 hard wall 반사.
- 색: KE HSB 매핑 (느림 청 → 빠름 적, 보일 패턴).
- 표면 도달 시 (`y > liquid_top - 5 px`) 응축 게이트 `p_condense_per_hit` → 통과 시 사라짐, 실패 시 위로 반사.

**T 입력 → 시뮬 결합** (Phase 6.2 시점):
- 수조 T → 표면 탈출 KE 또는 표면 진동 amplitude → 탈출 빈도 변동.
- 액체 내부 정적이라 T 가시화는 표면·기체에만.

**압력 산출** (Phase 6.4 시점):
- 기체 입자 박스 벽 충돌 빈도 → 시뮬 P.
- 실측 P 와 별도 비교 가시 (학생 토론 자료).

#### 배제된 대안 (5+ 회 시도 누적, 시간순)

- 동일 입자 모델 + 영역 분할 (6.1-b 초기): 액체 입자 통통 튐, 학생 인지 충돌.
- 자유 이동 + 중력 only (6.1-b''): 응집력 부재로 모든 입자 바닥에 깔림.
- 표면 분자 + 띠 (옵션 Z, 6.1-b'''): fake animation, 응축 시 격자 자리 모호.
- 자체 LJ-like piecewise (첫 LJ 시도): 함수 모양 본질 차이, 응집 실패.
- 응집 영역 + 외부 가속도장: 명시 가속도장 가둠 → 자연 게이트 X, 균등 분포.
- Schroeder LJ + Verlet (B-2 + fixup): 응집 풀려 듬성듬성. "가득 차있음" 보장 X. 덩어리째 떠오름 (중력·spring 바닥 추가해도 미해결). 운동이 빈 공간 만듦이 본질 결함.

본 모델은 "정적 격자 + 표면 동적" 으로 위 모든 결함 회피.

#### 정직한 한계

본 모델은 분자 동역학 시뮬레이션 X. 액체 내부 분자 운동은 추상화 (시뮬 X).

학습 목표 매핑:
- ① 동적 평형 (증발 ↔ 응축 균형) — 표면 사건 + 기체 응축으로 충족.
- ② T-증기압 — 표면 KE 또는 탈출 확률 매핑 (Phase 6.2).
- ③ 분자 운동 분포 — 기체상 KE HSB 색 + (high 이상) MB 분포 히스토그램 보강 (Phase 6.3).
- ④ 양방향 접근 — 평형 안정점 가시 (다른 출발 조건도 같은 plateau).

학습 목표 외 (액체 내부 분자 운동 정확 모델) 은 별 학습 자료로 분리.

> **보조 통찰** (보일 시뮬 v1 자산 재사용): vapor 기체상 hard sphere 분자-분자 충돌 = 분자 부피 (excluded volume) 자연 반영 → van der Waals 편차 (PV ≠ const) 자연 재현 가능. boyle 시뮬 v1 자산 검증 (`docs/10` Phase 0 결정 1 + Step F++). vapor 기체 plateau 통계 약함 (50개), 단 정성적 가시 가능. 액체 (정적 격자) + 표면 (KE 시각용 smooth random walk) 은 분자-분자 충돌 X — 기체상만 적용.

### P 영역 vertical 중앙 정렬 (fixup 15t)

직전 fixup 15s P 영역 그래픽화 후 사용자 비판 "전체적으로 살짝 아래로 보내서 박스에 중간으로". P 영역 카드 안 vertical unbalance.

**자세**:
- `.vapor-card-tp` display:flex column + `.vapor-tp-pressure` flex 1 1 auto + justify-content:center.
- T 영역 + divider 위쪽 그대로. P 영역 컨텐츠 카드 안 vertical 중앙.

### P 영역 그래픽화 — Johnstone 3수준 통합 (fixup 15s)

사용자 비판 "비어보임" — 직전 fixup 15j 부활 후 P 영역 단일 측정값 + 막대 + reach time 텍스트 시각 빈약. 사용자 명시 "동그란 아날로그 압력계 + 전자시계 형태".

**자세**:
- T+P 카드 P 영역 좌우 분할 (55:45).
- 좌 = SVG 반원 압력계 (viewBox 200×120, 바늘 ±90° rotate, 0~30 kPa 눈금).
- 우 상단 = LCD 풍 전자시계 (어두운 배경 + 진한 녹 + 글로우, MM:SS).
- 우 하단 = 입자 수 막대 (정적 max 1000, gradient #93c5fd→#60a5fa).
- 폐기: `.vapor-pvap-big / .vapor-pressure-bar-wrap / .vapor-pvap-meta / .vapor-pvap-particles`.
- main.js dom dict `gaugeNeedle / particlesBar` 신규, `pressureBar` 폐기.
- 200ms readout: 바늘 angle (P/30 × 180 - 90 clamp), 시계 MM:SS padStart, 막대 width clamp.
- 768 미만 모바일 반응형 (stack).

**Johnstone 3수준 통합 시각화**: 시뮬 미시 (캔버스 입자) + 측정 도구 거시 (압력계 + 시계) + rate 그래프 기호 (rate 카드). 3 영역 = 학생 표상 연결 명시. 정공법 정합 — 데이터 source 그대로, 시각만 풍부.

### 가스 입자 수 부활 — 부분 reversal 종결 (fixup 15p)

사용자 비판 "압력 아래 빈 공간에 아까 삭제했던 입자 수 정보 여기 넣으면 되겠다". 직전 fixup 15g counter 카드 신규 → fixup 15h 통째 폐기 → mock 단계 정량 인지 단서 부재.

**자세**:
- T+P 카드 P 영역 하단 가스 입자 수 inline (별도 카드 X).
- main.js dom dict gasCount + 200ms readout (`world.gasParticles.length`).
- CSS `.vapor-pvap-particles` small text + strong tabular-nums.

**부분 reversal 패턴**: 15g 신규 → 15h 폐기 → 15p 부활 (위치 변경). 카드 자체 폐기는 보존, 정보 자체는 부활. 학습 단서 = 가스 입자 수 = 증기압 직접 source.

### 평형 배지 + [확정] 버튼 rate 카드 이동 + spacing (fixup 15q/15r)

직전 fixup 15n 학생 평형 결정 후 평형 배지 = 시뮬 헤더, [확정] 버튼 = 측정점 영역. 학생 인지 흐름 = rate 그래프 두 곡선 만남 → 평형 상태 → 확정 액션 — 세 영역 분산.

**fixup 15q 자세**:
- eq-badge 시뮬 헤더 → rate 카드 그래프 아래 이동.
- [⊕ 평형 확정] 버튼 측정점 영역 → rate 카드 이동.
- 시뮬 헤더 양측 정렬 (좌 ⏱ 경과 + 우 mmol).

**fixup 15r 자세**:
- rate 카드 순서: graph → readouts → badge+button → note.
- 배지 + 버튼 row spacing 균형 (margin-top 16 / bottom 12, gap 12, btn padding 5×14).
- 사용자 비판 "숫자 아래에 위치 + 균형 있게 떨어트려".

**인지 통합**: 인지 (rate 그래프 두 선 만남) ↔ 상태 (배지) ↔ 액션 (확정) 한 영역. 학생 인지 흐름 단절 X.

### T 잠금 확장 + 가스 색 단일화 (fixup 15o)

사용자 비판 "확인 안 눌러도 온도가 변해버린다" — 직전 fixup 14 T 입력 = 입력 버튼/Enter 확정 단 프리셋 클릭 = 즉시 동기화 + 확정 = 14 의 확정 패턴 정합 X.

**T 잠금 확장 자세**:
- 프리셋 클릭 = `tInput.value` 설정 + dirty class 추가 만. `applyTemperature` 호출 X.
- 학생 [입력] 클릭 또는 Enter 키 명시 확정 강제.
- pre-start / post-start 단일 메커니즘 통일 (모든 T 변경 = 학생 명시 확정).

**가스 색 단일화 자세**:
- gas particle color KE 매핑 폐기 → 단일 #60a5fa (Tailwind blue-400, 액체 #1E40AF 보다 연한).
- 표면 입자 KE 매핑 / 형광 노랑 birth flash / glow + stroke 보존.
- params.json `gas_color` 신규 키.

**근거**: 학생 인지 단순 (기체 = 같은 색, 액체와 시각 차별). 표면 KE 매핑 = 사건 영역 한정 = 학습 단서.

### V_gas 자동 + mmol 시뮬 헤더 + height 정합 (fixup 15l/15m)

**fixup 15l 자세**:
- `vapor-layout-v2` max-width 1700 → 1900 (시뮬 좌우 여백 ~150 → ~20-40px).
- `vapor-rate-canvas` max-width 256 → 100% (카드 폭 정합).
- card min-height 미세 조정 (시뮬 box ~780 ≈ cards-region 합산).

**fixup 15m 자세** (15l 검증 실패 보정, flex stretch 옵션 C):
- cards-region `align-items: stretch + rate flex 1 1 auto` (viewport-independent).
- V_gas display 칸 신규: input readonly + 자동 채워짐 (V_flask - V_liquid).
- 보조 정보 (1 입자 ≈ X mmol) top-control → 시뮬 헤더 옆 이동.
- readonly input 시각 (회색 배경).

**근거**: viewport-independent 정합 (카드 min-height 무관). 학생 인지 부담 ↓ (V_gas 자동). 보조 정보 시뮬 인접 = 정량 인지 시뮬 정합.

### 시뮬 시각 확대 — CSS scaling + visible ratio (fixup 15k)

사용자 비판 "빈 공간이 많은데" — 시뮬 영역 sparse. 직전 fixup 15h CSS scaling 1.375× (canvas display 1100, 모델 좌표 800×480 보존) 검증 후 추가 확대 합의.

**자세**:
- `vapor-layout-v2` max-width 1500 → 1700 (canvas display 1100 → 1300, **CSS scaling 1.625×**, 모델 좌표 800×480 보존).
- `ghost_gas_visible_ratio` 0.4 → **0.7** (visible 입자 1.75× ↑ at all T, T=25 53→93).
- `pressure_per_visible_gas_kPa` 0.06 → 0.034 (P 값 보존, 비례 조정).
- card min-height: tp 300→360, rate 340→400. cards-region width 320 → 340.

**트레이드오프 (논문 1차 자료)**: ghost 통계 √N 잡음 흡수 효과 일부 손실 (visible_ratio ↑ → ghost 통계 결합 부담 ↓). 학습 가치 (시각 사건 풍부) > 통계 안정.

**근거**: 시각 사건 부족 (sparse) 직접 해소. 모델 좌표 보존 = regression 격리 (15h 동일 패턴). P 비례 조정 = 의미 보존.

### P 영역 부활 — 단일 측정값 모드별 source 분기 (fixup 15j, 3단계 reversal 종결)

직전 fixup 15f P 영역 hidden → fixup 15h hidden 유지. 사용자 의도 "시뮬일 때는 시뮬값" — mock 단계 시뮬 P 표시 가치 발견. **`world.pressureKPa` getter + recordEquilibrium / drawPTGraph 모두 existing — 부활 비용 = hidden wrap 제거만**.

**자세**:
- P 영역 `.vapor-tp-pressure` `vapor-real-only hidden` 제거 + placeholder 폐기 + 단순화.
- divider 부활 (T 영역 / P 영역 구분).
- P display: "평형 증기압 P_vap" + big value + bar + reach time (theory meta dropped).
- measurement-region: mock placeholder 폐기 + table + record button + P-T graph 활성.
- measurement table: theory column dropped (5 cols 합산).
- P-T graph: theory dashed line 보존 (시각 비교 단서, 정량 정합 의무 X).

**핵심 철학** — **단일 측정값 + 모드별 source 분기**:
- mock 모드 = 시뮬값 (`world.pressureKPa`).
- real 모드 (Phase 6.3+) = 실측값 (`world.pressureMeasured` 또는 SensorSource 직접). 같은 DOM, source 만 교체.

**의사결정 reversal**: 15f hidden → 15h 유지 → 15j 부활 (3단계, 사용자 의도 회복). measurement 인프라 무비용 부활 = 회귀 손실 X 검증 — 직전 결정의 부활 비용이 0 임을 확인 = 회귀가 손실 아님.

### 시뮬 중심 단순화 — 사이드바 → top-control 변환 (fixup 15h, 15g 즉시 번복)

사용자 의도 "시뮬 중심" — 학습 목표 카드 / counter 카드 = 시뮬 자체로 충분 학습 단서. 시뮬 입자 시각화 = 본 프로젝트 핵심.

**자세**:
- 사이드바 (`.vapor-control-narrow`) → top horizontal 2-row (`.vapor-top-control`).
- canvas display 800 → **1100** (모델 좌표 800×480 보존, **CSS scaling 1.375×**).
- max-width 1400 → 1500.
- card min-height: tp 200→300, rate 220→340. cards-region width 280 → 320.
- **학습 목표 카드 (fixup 15g 신규) 통째 제거**.
- **counter 카드 통째 제거 + JS readout cleanup**.
- net -94 줄.

**의사결정 reversal**: 15g 학습 목표 카드 + counter 카드 신규 → 15h 즉시 폐기 (의사결정 즉시 reversal). 시뮬 width ↑ 가 학습 가치에 직접 효과.

**핵심 자세**: **CSS scaling 으로 모델 좌표 보존 = regression 격리**. 후일 fixup 15k 1.625× 추가 확대 시 동일 패턴 재사용.

### UI 균형 다층 시도 (fixup 15g, 즉시 폐기)

mock 단계 학습 단서 부족 인지 (fixup 15f hidden 후 화면 단순). 학습 목표 명시 + 시뮬 placeholder 다층 = 학생 안내 강화 시도.

**자세** (의사결정 reversal raw 자세 보존):
- 학습 목표 카드 신설 (Johnstone 3수준 거시/입자/기호) — `vapor-top-row` 위 3열 그리드.
- `vapor-layout-v2` max-width 1400 + margin auto.
- 시뮬 placeholder 강화 (icon + 본문 + hint 다층).
- counts 카드 footer "분자 수 = 동적 평형의 양적 지표" — 학습 단서 명시.

(후일 fixup 15h 에서 즉시 폐기 — "시뮬 자체가 충분 학습 단서" 사용자 의도. 의사결정 reversal raw 자세 보존 = 논문 1차 자료.)

### P 영역 mock hidden + 헤더 단순화 (fixup 15f, 후일 15j 부활)

T+P 카드 P 영역 mock placeholder ("측정 모드 활성 후 표시") 학습 단서 = 사이드바 측정 모드 토글이 동일 안내 → 중복. 카드 column 합산 ~744 → 비대칭.

**자세**:
- P 영역 (divider + pressure section) `vapor-real-only hidden` wrap. DOM 보존 (real 모드 진입 시 자동 부활).
- 카드 헤더 "온도 / 증기압 (센서 영역)" → "센서 영역" 단일.
- min-height 280 → 200.
- hotfix: `.vapor-real-only[hidden] { display: none }` (`display:flex` 가 HTML hidden 속성 default override 결함 차단).

(후일 fixup 15j 에서 P 영역 부활 — 사용자 의도 "시뮬일 때는 시뮬값". 3단계 reversal 1단계.)

### T 변경 시 EMA 보존 — prime 의도 시작 시점 한정 (fixup 15e)

사용자 검증 — T 변경 시 evap 곡선 0 폭락 (mapY(null) 그래프 바닥) + 13.9 spike (prime 평균 + 잡음 결함). 직전 fixup 10 setTemperature reset 보강 + fixup 15a v1 prime 평균 = T 변경 시 부작용.

**자세**:
- `setTemperature`: `_emaPrimed / _ratePrimeBuf / evapEMA / condEMA` reset 폐기.
- 직전 EMA (3.5/s) 보존 → α=0.05 로 새 raw (11.1/s) 향해 점진 수렴.
- raw buf reset 추가 (`_rateRawEvapBuf / _rateRawCondBuf = []`) — 직전 T 잔재 회피.

**핵심**: prime intent = 시작 시점 한정 (warmup lag block, EMA=0 → 정상값). T 변경 시 EMA 이미 정상값 → prime 불필요. α=0.05 자연 수렴 (~60초) = 학생 직관 정합.

**EMA prime 4단계 진화 마무리**: fixup 9 첫 tick prime → fixup 14 첫 N tick 폐기 → fixup 15a v1 N tick 평균 prime → fixup 15e 시작 시점 한정. 의도 명확화 마무리.

### 평형 hysteresis 4-state (fixup 15d, 후일 15n 5-state 진화)

직전 fixup 13 ratio 단일 metric `[0.9, 1.1] / 5초 hold` → sticky 평형 (도달 후 이탈 추적 X). 학생 검증 시 이탈 후에도 ★ 표지 잔존 → 인지 혼선.

**자세**:
- `rate_ema_alpha`: 0.1 → 0.05 (τ=10s → 20s, 잡음 흡수 √2배).
- `equilibrium_hold_sec`: 5 → 10.
- hysteresis: enter zone [0.9, 1.1] / exit zone [0.85, 1.15].
- 4-state: reached (★ 녹) / exited (주황) / near (노랑) / none (회색).
- vapor.js `_equilibriumState + _everReachedEquilibrium + _equilibriumHoldStart` 신규.
- 이탈 시 `_everReachedEquilibrium=false` → 재도달 시 hold 다시 (strict re-entry).
- params 신규: `equilibrium_exit_ratio_min/max (0.85/1.15)`. 보존: `equilibrium_change_threshold/warmup_sec`.

(후일 fixup 15n 에서 5-state 학생 결정 진화 — §13 학생 평형 결정 메커니즘 참조.)

### 반응형 1280 breakpoint (fixup 15c)

직전 fixup 11+12 integrated 의 1024/768 break point — 1024~1279 폭 (일반 노트북) 대응 X. canvas 800 + sidebar 200 + cards 280 합산 1280+ → overflow.

**자세**:
- 1024~1279px media query (sidebar 200→180, sim flex+max-width, cards 280→260).
- canvas max-width 800px + aspect-ratio 800/480 (auto-shrink, p5 internal 무변경).
- card min-height (card 220 / tp 280 / counter 140).

### T 입력 잠금 + 시작 가드 (fixup 15b, 후일 Dalton 16a 재사용)

직전 fixup 14 T 입력 = 입력 버튼/Enter 확정 단 확정 후 input 활성 그대로 → 학생 실수 입력 가능성. 시작 버튼 활성 시점 모호.

**자세**:
- `tConfirmed` flag (UI scope) — 페이지 로드 직후 false.
- `applyTemperature` 마지막에 잠금 (input/preset disabled, 버튼 라벨 "입력" → "수정").
- `unlockTemperature` 신규: 잠금 해제 + 라벨 복원.
- T 카드 가드 영역 (`vapor-t-guard`): "온도를 입력하세요" 빨강 / 빈 녹색.
- `validate()` `tConfirmed AND` 통합: `btnStart.disabled = !tConfirmed || !liquidOk`.
- `btnReset.click` 안 `unlockTemperature` 호출.

**페이지 간 패턴 재사용**: 후일 Dalton 16a V_A/V_B 입력 확정 = vapor 15b 패턴 100% 재사용 (vAConfirmed/vBConfirmed 독립 flag). 검증 자산 재활용 가치.

### 화살표 매칭 4단계 진화 → 매칭 폐기 (fixup 15a v1~v4)

직전 fixup 11 화살표 매칭 상쇄 (즉시 splice) — 학생 인지 한계. v1~v3 시도 후 사용자 의도 = 단순 시각 (학생이 직접 보이는 화살표 수 = 사건 빈도).

**4단계 진화**:
- **v1** (`5e7034f`): 매칭 즉시 splice → 0.3s fade 전환. rate ema prime 첫 5 tick 평균.
- **v1 redo** (`e92bd95`): instant splice 회귀 (fixup 11 동일). unmatched hold 1.0 → 1.5s.
- **v2** (`fa0a889`): splice 폐기, 모든 사건 push + frame loop 안 head-vs-head FIFO 매칭. cond 화살표 visible 보장.
- **v3** (`f81ef27`): natural fade 폐기, match-only soft fade 0.3s + max cap 50/dir + T-change fade 0.5s.
- **v4** (`ed43bc1`, **최종**): 매칭 logic 통째 폐기. 단순 자연 fade only (`flash_duration_sec=1.0, flash_hold_sec=0.5`).

**v4 최종 결정**: `_addFlash` 단순 push (매칭 / max cap 모두 폐기). `drawFlashes` = hold 0.5s + linear fade 1.0s. 양쪽 독립 fade. T 변경 시 화살표 손대지 X.

**학생 인지** = 동시 visible 화살표 수 = 사건 빈도 비례 (양쪽 동시 visible = 빈도 균형). 시작 시 위 ≈ 3.5개, 평형 시 양쪽 ≈ 3.5개씩. 매칭 logic = 학생 인지 단순화 의도였으나 cond 가시성 손실 / max cap 인공 등 부작용 누적.

(4 단계 모두 검증 후 단순 회귀 = 최선. 진화 단계 자체가 의사결정 가치.)

### Rate 워밍업 + T 입력 확정 패턴 (fixup 14)

사용자 검증: 시작 직후 evap rate 6.0 → 시간 따라 3.5 로 감소 (정상은 evap 일정 명세).

**원인 진단** (CC):
- 첫 1초 적분 시 Poisson σ ≈ √8.8 ≈ ±2.97 사건 → visible-equiv ±1.19 → raw 6.0 은 +2σ 부근 (5% 확률).
- fixup 9 EMA prime 이 잡음값 그대로 박음 → τ_EMA = 10초 → 30~40초 후 정상값 도달.
- fixup 9 의 워밍업 lag (시작 0 → 평균값) 차단 의도가 부작용으로 잡음 prime → lag 방향만 바뀜.

**Fix — 옵션 (a) 첫 N tick 폐기** (CC 권장 채택):
- `_maybeTickRateAndLog` 안 EMA prime 직전:
  ```js
  const warmupTicks = this.cfg.rate_warmup_ticks ?? 2;
  if (this.rateHistory.length < warmupTicks) {
      this.rateHistory.push({ evap_raw, cond_raw, evap_ema: null, cond_ema: null });
      // 카운터 reset + lastStatsT 갱신 후 early return
  }
  ```
- 첫 2 tick raw 만 누적 (3초 평균 σ √3 감소 후 prime → 잡음 ±0.69 로 감소).
- 3번째 tick 부터 EMA prime + 정상 평활.
- params.json: `rate_warmup_ticks: 2` 신규.
- 워밍업 동안 `evapEMA / condEMA = null` → main.js readout `"—"` 표시 + ratio cell zone "zero".
- rate 그래프 plot: `evap_ema/cond_ema null` skip (firstIdx 부터 moveTo).
- 평형 검출 (ratio 기반) 워밍업 동안 자동 대기 (evapEMA null 시 ratio null).

**T 입력 확정 패턴** (사용자 추가):
- 직접 입력 (number input) → `is-dirty` state 만 표시 (input border 주황 + 입력 버튼 강조).
- 입력 버튼 click 또는 Enter 키 → 확정 (`applyTemperature`) + 시뮬 응답 + dirty 해제.
- 프리셋 button click → 즉시 input.value 동기화 + 확정 (빠른 선택).
- 학생 인지: 타이핑 중에는 시뮬 반응 X → 매 keystroke 부담 회피.

**vapor.js 헤더 docstring 갱신**:
- fixup 14 활성 명세 (워밍업, 잡음 prime 회피) + 폐기 항목 누적 (시작 직후 EMA prime 잡음 박힘 — fixup 9 부작용).

### 평형 판정 통일 — ratio 기반 단일 metric (fixup 13)

직전 fixup 8~9 의 P_internal 변화율 기반 평형 판정 폐기.
사용자 검증: rate 그래프 ★ 표지 + 비율 카드 색 모순 (★ 표시인데 비율 0.88 주황) → 두 모듈 다른 logic.

**신규 평형 판정**:
- ratio = condEMA / evapEMA 가 [`equilibrium_ratio_min`, `equilibrium_ratio_max`] = [0.9, 1.1] band 안 5초 (`equilibrium_hold_sec`) 유지 → 평형 도달.
- band 외 진입 시 startIdx reset (sticky 도달 후는 보존).

**모든 평형 표지 동일 조건 트리거**:
- 비율 카드 third cell zone 색 ("eq" 녹색, fixup 11 ratio band 동일).
- rate 그래프 ★ vertical line (`equilibriumReached` + `equilibriumIdx` 기반).
- 시뮬 캔버스 헤더 "평형 도달 ★" 배지 (fixup 13 mock 활성).

**mock 평형 배지 hidden 결정 폐기** (fixup 9 비공개 결정 일부 폐기):
- `vapor-equilibrium-badge` 의 `vapor-real-only hidden` 제거 → mock 모드 활성.
- "평형 비도달 / 평형 근접 / 평형 도달 ★" 텍스트 표시.
- 단일 metric (ratio) 기반이므로 모순 X (직전 P_internal 모순 회피).

**P 카드 + 측정점 표 비공개 유지** (정공법 회귀 흐름):
- P 카드 mock placeholder 그대로.
- `vapor-real-only` 측정점 표 그대로 hidden.

**equilibriumPercent getter 갱신**:
- ratio 기반 (1.0 일 때 100%, band 외 일수록 감소).
- 직전 `_lastRelChange` 기반 폐기.

**P_internal 변화율 코드 보존** (real 모드 재사용 가능):
- `_pressureSmoothed`, `_pressureSmoothedPrev`, `_lastRelChange` 보존.
- `equilibrium_change_threshold`, `equilibrium_warmup_sec` 보존 (real 모드에서 P_measured 변화율 기반 별도 판정 활용 여지).

**vapor.js 헤더 docstring 갱신**:
- fixup 13 활성 명세 + 폐기 항목 누적 (P_internal 변화율 평형 판정).

### T number input + 반응형 + fixup 11/12 통합 검증 (fixup 11+12 integrated)

CC 진단 (직전 fixup 11 화살표 매칭 + fixup 12 T+P 카드 통합 모두 적용 확인) 후 사용자 추가 합의:

**T 입력 = number input + 5 프리셋** (셀렉트 폐기):
- 학생 임의 T 직접 입력 가능 (소수점 허용, `step="0.1"`).
- 5 프리셋 (25/35/45/55/65) 빠른 선택 보조 (button click → input.value 동기화).
- input `change` + `blur` 이벤트:
  - `parseFloat(value)` → NaN / `< 0` / `> 100` 시 fallback (직전 유효값 `lastValidT` 또는 25).
  - 유효 시 `lastValidT` 갱신 + `world.setTemperature(T)` 호출.
  - 프리셋 정확 일치 시만 active 표시, 그 외 모두 inactive (소수점 입력 시 active 0개).
- 학습 동기: 학교 실험에서 5 프리셋 외 T (예: 32.5°C) 측정 가능성 확보.

**화면 반응형** (1024px / 768px 브레이크포인트):
- 데스크탑 (>1024px): 가로 3열 (제어 / 시뮬 / 카드) — 기본 layout 그대로.
- 태블릿 (768~1023px): `vapor-top-row` flex-wrap → 사이드바 + 시뮬 가로 / 카드 row wrap (50% × 2).
- 모바일 (<768px): 모든 영역 세로 stack, 사이드바 width 100%, 시뮬 100%, 카드 column.
- `vapor-mode-toggle` (4 버튼) 모바일 시 2-col 유지.
- `vapor-rate-canvas` max-width 100% (모바일 폭 적응).
- 보일/돌턴 페이지 미디어 쿼리 패턴 참조.

**fixup 11 화살표 매칭 적용 검증** (직전 commit `027bd41` 점검):
- `vapor.js:_addFlash` 안 매칭 로직 (`findIndex(f => f.dir === opposite)`) 확인.
- 추가 코드 변경 X.

**fixup 12 T+P 카드 통합 적용 검증** (직전 commit `2471cf2` 점검):
- `vapor-card-tp` / `vapor-tp-temp-mock` / `vapor-tp-pressure-mock` DOM 구조 확인.
- 본 fixup 13 에서 select → number input 교체만 적용.

**vapor.js 헤더 docstring 갱신**:
- fixup 13 활성 명세 (T number input, 반응형) + 폐기 항목 누적 (T 셀렉트).

### T + P 카드 통합 (mock 입력 / real 표시 자연 전환, fixup 12)

CC 진단 (T 컨트롤 위치 시뮬 아래 분리 + P 카드 placeholder 분리 → 우측 상단 통합) 후 사용자 합의:

**카드 구조** (`vapor-card-tp`):
- T 영역: mock 입력 (셀렉트 + 5 프리셋 버튼 grid) / real 표시 (큰 숫자 + °C).
- 구분선 (`.vapor-tp-divider`).
- P 영역: mock placeholder ("측정 모드 활성 후 표시") / real 큰 숫자 + 막대 + 이론 비교.
- DOM 보존 + `vapor-real-only` class 분기 → Phase 6.3+ 진입 시 hidden 토글로 자연 전환.

**시뮬 아래 T 컨트롤 폐기**:
- 직전 T 슬라이더 + 5 프리셋 버튼 영역 통째 제거.
- 시뮬 캔버스 아래 = 시뮬만 + 헤더 (시간 + 평형 배지) 보존.
- 시뮬 캔버스 height 자유도 ↑ (CSS 자동 fit).

**핸들러 위치 이동** (main.js):
- `dom.tempSlider / tempCurrent / tempPresets` 폐기 → `dom.tSelect / tPresets` 신규.
- 셀렉트 `change` + 버튼 `click` 양방향 동기화 (`applyTemperature` 1군데 호출).
- 버튼 active 토글 + setTemperature 호출 로직 보존.

**학생 인지** (Johnstone 3수준 정합):
- 우측 상단 = "센서 영역" — 실측 데이터 자리 (T + P 같은 카드).
- mock 모드: T 입력으로 시뮬 구동, P 비공개 (정공법 회귀 흐름 일관).
- real 모드 (Phase 6.3+): T 실측 + P 실측 자동 표시.

**vapor.js 헤더 docstring 갱신**:
- fixup 12 활성 명세 + 폐기 항목 누적 (시뮬 아래 T 컨트롤, vapor-card-pvap).

### P 카드 원복 + ratio 위치 이동 + base 튜닝 + 화살표 매칭 (fixup 11)

CC 진단 (A 평형 도달 시간 ~70초로 학교 실험 정합 X / B P 카드 placeholder 복귀 + ratio third cell 이식 / D base 튜닝 시 균형 조정 / F 화살표 매칭 상쇄) 후 사용자 합의:

**P 카드 원복** (fixup 8 placeholder 패턴):
- mock 모드에서 학생 가시 P 카드 비공개 (정공법 회귀 흐름 일관).
- real 모드 (Phase 6.3+) 진입 시 실측 P_vap + T 표시 (`vapor-real-only` div 보존).
- 직전 fixup 10 ratio 카드 (P 카드 placeholder 활용) 폐기, 본 fixup 11 에서 third cell 로 이식.

**rate 카드 third cell — 응축/증발 비율** (G-옵션 1):
- 평형도 % cell 완전 폐기 (직전 fixup 9 hidden 상태였음, fixup 11 third cell 자체 비율로 교체).
- 비율 텍스트 (`condEMA / evapEMA`) + zone 색 분기 (zero/low/mid/eq/over).
- third cell 폭 ~85px → 텍스트 + 색이 단순 + 학생 인지 적정.
- 1.0 평형 인지 = 녹색 도달 (zone "eq"). 1.0 marker / 막대 / axis 모두 폐기 (zone 색으로 충분).

**base 튜닝 + 균형 조정** (D6 권장):
- `base_evap_rate_per_particle_per_sec`: 0.025 → 0.010 (사용자 5분 평형 명시 정합).
- `ghost_gas_visible_ratio`: 0.2 → 0.4 (base ↓ 보강, 시각 사건 부족 회피).
- `rate_graph_initial_x_sec`: 60 → 180 (자동 스케일 발동 줄임, 학교 실험 시간 정합).
- `pressure_per_visible_gas_kPa`: 0.03 → 0.06 (P plateau 의미 동일, real 모드 진입 시 무관).
- 사이드 효과: 평형 visible gas plateau 약 30개, 동시 강조 ~6~8개, 잡음 √(1/0.4) 1.58배 상승 (rate 곡선 EMA 흡수).

**화살표 매칭 상쇄** (F 옵션 1):
- `_addFlash` 안 위·아래 큐 1쌍 즉시 캔슬 (위치 무관).
- 신규 사건 시 반대 dir 큐 검사 → 1+개면 양쪽 캔슬 (제거 + spawn 안 함). 0개면 정상 spawn.
- transient (evap >> cond): cond 큐 0 → 위 화살표 다수 → "증발 우세" 시각.
- 평형 (evap ≈ cond): 매칭 빈번 → 화살표 거의 X → "균형" 시각.
- 색 강조 (노랑/핑크) 별도 큐 — 사건 자체 가시화 보존.
- rate 그래프 정량 절댓값 보존 (`_evapWin` / `_condWin` 카운터 매칭 영향 X).
- 학습 계층 3단계: 색 (사건) + 화살표 (빈도 차) + rate (정량).
- 코드 +6줄 (단순 큐 매칭). pending 큐 / 비동기 타이머 / fade 캔슬 효과 X (옵션 2 / 옵션 b 기각).

**vapor.js 헤더 docstring 갱신**:
- fixup 11 활성 명세 + 폐기 항목 누적 (`vapor-card-ratio` 큰 카드 + 막대 + marker + axis, `vapor-eq-percent` DOM).

### 응축/증발 비율 + UI 통일 + 잔재 정리 (fixup 10)

CC 진단 (D3 setTemperature reset 누락 / F1-a liquid_jitter dead branch / G mock 학습 단서 부재 / H 사이드바 UI 변종) 후 사용자 합의:

**응축/증발 비율 카드** (G 채택):
- mock 학생 가시 단서 부재 (★ + 평형도 % 비공개) → 직관적 학습 단서 신설.
- 기존 P 카드 placeholder slot 활용 (`vapor-card-ratio`): 큰 숫자 (`condEMA / evapEMA`, 0~1.5 범위) + 가로 막대 + 1.0 marker line.
- zone 색 (CSS data-zone): zero (회색) / low (slate) / mid (주황) / eq (초록, 0.9~1.1) / over (파랑).
- 평형 도달 시각 = 막대가 1.0 marker 에 정확히 도달 (응축 = 증발).
- Phase 6.3+ real 모드 진입 시 ratio 카드 → P_vap 카드로 복귀 (real-only div 보존).

**사이드바 UI 통일 (보일·돌턴 패턴)** (H 채택):
- vertical block field (`.vapor-field`): label 위, input 아래 — 보일·돌턴 페이지와 통일.
- 측정 모드 = 4-button toggle grid (`.vapor-mode-btn`, `is-active` state) — 미래 ws/real/vernier 진입 자연.
- guard-note 색 분기: `data-state="ok"` (초록) / `data-state="error"` (빨강).
- mmol 환산값 = 별도 `vapor-info-panel` section (실험 설정과 시각 분리).
- typography 통일 (보일·돌턴 패턴 재사용).

**setTemperature reset 보강** (D3 채택):
- 직전: T 변경 시 `_emaPrimed` / `_pressureSmoothedPrev` 미리셋 → evap 곡선 10초 lag (이전 EMA 잔존) + relChange jump (P_smoothed 누적값 초기화 누락).
- 신규: `setTemperature()` 안 `_emaPrimed = false` + `_pressureSmoothedPrev = null` 추가.
- 결과: T 변경 직후 evap 곡선 자연 step transition + 평형 검출 false positive 차단.

**liquid_jitter dead branch 제거** (F1-a 채택):
- `params.json` 에서 `liquid_jitter_amp_px` 키 (=0, 사용 X) 제거.
- `vapor.js` 에서 `const liquidJitter = cfg.liquid_jitter_amp_px ?? 0;` 제거.
- liquidLattice 입자 객체에서 `amp` / `phase` 필드 제거 (정적 격자 = `{x0, y0, x, y}` 만).
- `update()` 안 `for (const m of this.liquidLattice) { if (m.amp > 0) {...} }` 분기 제거 (dead code, amp 필드 부재로 항상 false).
- 비고: 정적 격자 = 교과서 정합 (액체상 응집 가시화), jitter 는 직관 위반 (액체 = 진동 흔들림 인상).

**vapor.js 헤더 docstring 갱신**:
- fixup 10 활성 명세 추가 (응축/증발 비율 카드, setTemperature reset).
- 폐기 항목 누적 (liquid_jitter_amp_px config + lattice amp/phase 필드 + update() 분기).

### 정공법 회귀 완성 (fixup 9)

CC 진단 (★ 배지 false positive + 평형도 % 17% 널뜀, 두 모듈 비동기 사용) 후 사용자 합의:

**평형 자동 감지 mock 학생 가시 비공개** (γ 채택):
- ★ 배지 (시뮬 캔버스 헤더) 와 평형도 % cell (rate 카드) 모두 `<* class="vapor-real-only" hidden>` 으로 wrap.
- 시뮬 캔버스 헤더 = 시간 표시만.
- rate 카드 = 두 rate 숫자 (증발/응축) + 곡선 + "두 곡선이 만나는 시점 = 정성적 평형" 안내문.
- **내부 계산 보존** (`equilibriumReached`, `equilibriumPercent`, `_pressureSmoothed` 등) — Phase 6.3+ 실센서 진입 시 P_internal → P_measured 입력 교체로 자연 활성.
- 학생 학습 = rate 두 곡선 만남 시각 (정성적). 정량 평형 판정은 실측 도착 후.

**evap 곡선 EMA prime** (H-α 채택):
- 직전: α=0.1 + 초기 0 → 시간상수 10초 → 곡선 0~30s 동안 점진 증가 (artifact, 사용자 직관 위반).
- 신규: 첫 tick 에서 `evapEMA = evapRaw, condEMA = condRaw, _emaPrimed = true`. 후속 tick 만 EMA 적용.
- 결과: 시작 직후 evap 수평선 (사용자 직관 정합 — 표면 일정 + T 일정 → 사건 빈도 일정).
- cond 곡선은 그대로 (시작 0, 점진 증가 — 가스 밀도 ↑ 자연 결과).

**사이드바 너비 고정** (G-α + G-β):
- `.vapor-control-narrow` 에 `width/min-width/max-width: 200px` + `box-sizing: content-box` + `overflow-x: hidden` 명시 — flex item 의 `min-width: auto` 기본 동작 회피, content overflow 시 expand X.
- `.vapor-guard-note` 에 `min-height: 24px` + `word-break: keep-all` + `overflow-wrap: break-word` — 텍스트 등장/사라짐 시 height 점프 X, 긴 텍스트 wrap.
- V_liquid 변경 시 사이드바 width / 시뮬 캔버스 폭 흔들림 차단.

**잔재 정리** (CC 진단 A1, A2):
- `vapor.js` 헤더 docstring 전면 rewrite — fixup 9 활성 명세 + 폐기 항목 누적 history.
- `equilibriumStatus` getter 제거 (main.js 사용 X dead code).
- `pressure_kpa_per_gas_particle` / `pressure_kpa_max_for_bar` / `p_vap_ema_alpha` fallback 제거 (각각 `pressure_per_visible_gas_kPa` / `pressure_gauge_max_kPa` / `p_internal_ema_alpha` 로 rename 후 호환 fallback 으로 남김 → 정리).

### 정공법 회귀 (fixup 8) — 시뮬은 미시 가시화만

본 프로젝트 핵심 철학 ("학생 가시 = 실측, 시뮬 = 미시 가시화") 정합. 시뮬 P 정량 정합 시도 폐기.

**Calibration 폐기**:
- `pressure_to_evap_calibration` 키 삭제.
- `evap_rate(T) = base × exp(E_a × (1 - T_ref/T))` — 단순 Boltzmann factor 만.
- 시뮬 P plateau 가 P_eq(T) 와 정합 안 해도 OK (정량 비교는 실측 도착 후).

**학생 가시 P 카드 = mock 모드 비공개**:
- vapor.html `vapor-card-pvap` 안 placeholder ("측정 모드 활성 후 표시").
- 기존 P 큰 숫자 + 막대 + 이론 비교 DOM 은 `vapor-real-only` div 로 wrap + `hidden` 속성.
- Phase 6.3+ 실센서/Vernier 모드 진입 시 hidden 해제 → 실측 P 표시.

**측정점 표 / P-T 그래프 = mock 모드 비공개**:
- vapor.html `vapor-measurement-region` 안 placeholder ("실측 모드 활성 후 사용 가능").
- 기존 측정점 표 + P-T 캔버스 DOM 은 `vapor-real-only` div 로 wrap.
- mock 단계 학습 활동 = 시뮬 사건 관찰 (입자, flash, 화살표, 색 강조). 정량 측정 X.

**평형 감지 = 시뮬 내부 P 변화율 (P_internal)**:
- P_internal = (visible_gas + ghost_gas) × 0.1 × pressure_per_visible_gas (ghost 결합 통계로 잡음 흡수).
- P_internal_EMA 매 frame (alpha=`p_internal_ema_alpha`=0.05).
- 매 1초 `|dP/dt| / P` < `equilibrium_change_threshold` (=0.02 = 2%/s) 가 `equilibrium_hold_sec` (=5초) 지속 + warmup (=10초) 후 → 평형 도달.
- 평형도 % = `(1 - relChange / threshold) × 100`, 0~100% 클램프.
- real 모드 진입 시: P_internal → P_measured 입력 교체, 평형 감지 모듈 재사용.

**색 강조 형광 (노랑/핑크)**:
- 막 등장 가시 가스 = 노랑 #FCD34D 전체 색, 1.5초 hold + 0.5초 fade. stroke 4.5 px + glow blur 25.
- 막 응결 격자 = 핑크 #F472B6 전체 색, 1.5초 hold + 0.5초 fade. stroke 4.5 px + glow blur 25 + 외곽 펄스 (반경 r+1 → 24 px, 1초).
- 직전 청 stroke / 주황 ring 폐기 — 더 확연한 시각 강조 (학생 시선 자연 유도).

### Ghost 입자 — 통계 안정성 (fixup 7, 보일 패턴 재사용)

기체 입자 ~50 → 통계 잡음 (Poisson 상대 오차 ~14%) → 평형도 % 널뜀.
보일 시뮬에서 사용한 ghost 패턴 도입:

**구조**:
- 가시 표면 80 (렌더 O) + ghost 표면 800 (렌더 X) = 880 입자 모두 Boltzmann 게이트.
- 매 evap 시 visible_ratio=0.1 로 visible vs ghost 분기:
  - prob 10% → visible 가스 (flash + birth highlight + 충돌)
  - prob 90% → ghost 가스 (충돌 X — O(N²) 부담 회피, 단순 물리만)
- 응축: visible/ghost 모두 KE_gas < E_capture 게이트. visible 만 flash + cond ring.

**통계 결합 (잡음 감소)**:
- 압력: `P = (visible_gas + ghost_gas) × 0.1 × pressure_per_visible_gas`
  → visible-equivalent 표시값 (학생 시각 정합) + 결합 통계로 잡음 √0.1 ≈ 0.32× (~3.16× 감소).
- Rate: `rate_displayed = (visible_evap + ghost_evap) × 0.1 / elapsed_sec` → 동일 효과.

**P_EMA 매 frame 평활** (`p_vap_ema_alpha`=0.05):
- 매 frame `P_smoothed = α × P + (1-α) × P_smoothed_prev` (50fps × α=0.05 → 시간상수 0.4s, 빠른 평활).
- 평형도 = `|P_EMA - P_eq(T)| / P_eq` (잡음 X, 한번 95% 도달 후 안정 유지).

**학습 가치**:
- 학생 시각: 변화 X (visible 가스만 보임, ghost 투명).
- 통계: 평형도 안정 (95%+ 도달 후 잡음 X), rate 곡선 부드러움, plateau P 정확.

### 거시 보정 + 미시 사건 하이브리드 (fixup 6)

사용자 통찰: 평형 판정은 거시 (P 기반, 잡음 X). 시뮬 사건은 미시 (Boltzmann 게이트, 학습 단서 보존). 둘을 분리한 하이브리드.

**평형도 판정 = 거시 (P 기반)**:
- 직전: |evap_ema − cond_ema| / max(evap, cond) — rate 잡음에 흔들림.
- 신규: |P_smoothed − P_eq(T)| / P_eq(T) < 0.05 가 5초 지속 + P_smoothed > 0.5·P_eq.
- P_smoothed = 매 1초 EMA (`pressure_ema_alpha`=0.1) 로 잡음 흡수.
- P_eq(T) = `liquids[액체].p_vap_table_celsius_to_kpa` 보간.
- 학생 시각: 한번 95% 도달하면 입자 수 변동에도 평형도 거의 일정.

**시뮬 사건 = 미시 (Boltzmann 게이트, 변경 X)**:
- evap = 매 frame Poisson per particle (`base × exp(E_a × (1 − T_ref/T)) × calibration`).
- cond = KE_gas < E_capture 결정적 게이트.
- 학습 단서: 막 등장 청 테두리 / 막 응축 주황 ring / flash + 화살표 그대로.

**base rate 거시 보정** (`pressure_to_evap_calibration`, default 1.0):
- Boltzmann factor 가 T 의존성 자동 처리 (`exp(-E_a/kT) ∝ P_eq(T)`).
- 실제 plateau 가 P_eq(T) 와 5%+ 어긋나면 calibration multiplicative factor 로 조정.
- 후속 fixup 에서 검증 시 plateau 측정 후 정밀 칼리브.

### Rate 그래프 누적 시간축 (fixup 6)

직전: sliding window 60초 → 평형 도달 시 transient 부분 스크롤 아웃.
신규: 시작 t=0 부터 누적, x축 자동 스케일.
- 처음 60초 이내: x축 0 ~ 60s 표시 (빈 영역 포함).
- 60초 이후: x축 0 ~ current_sec, 전체 timeline 압축.
- max_time_sec = 1800 (30분 cap).
- 한 화면에 transient + plateau 동시 시각.

### 캔버스 크기 강제 고정 (fixup 6)

V_liquid 변경 시에도 캔버스 외곽 크기 일정 (CSS `vapor-canvas-container { width: 800px; height: 480px; flex: 0 0 auto; }` + `vapor-sim-region { flex: 0 0 auto; width: 824px; }`).
액체 영역 (격자 입자) 만 `liquidH = box.h × V_liquid/V_flask` 로 비율 변동.

### Phase 6.1-b finalization + 6.2 부분 통합 (3 영역 + T)

**3 영역 화면 (Johnstone 3수준 매핑)**:
- 영역 1 (시뮬 + T): sub-micro — 분자 수준 사건 관찰
- 영역 2 (P 게이지 + rate + 카운터 카드): macro + 속도론
- 영역 3 (측정점 표 + P-T 그래프): symbolic

학생 인지 흐름: T 설정 → 시뮬 관찰 → 평형 P 기록 → 데이터 누적 → 그래프 분석 → 관계 발견.

**T 통합 (Boltzmann factor)**:
- evap_rate(T) = `base_evap_rate_per_particle_per_sec` × exp(`E_a_normalized` × (1 − T_ref_K / T_K))
- T_ref = 25°C 기준 (`reference_T_celsius`).
- 칼리브: base = 0.025 (T_ref 에서 plateau ~50, P~3 kPa), E_a = 18.3 (실측 비율 정합).
- T 변경 시 시뮬 리셋 X — 입자 그대로, evap rate 만 갱신, 새 plateau 자연 도달.
- T 슬라이더 25–65°C 연속 + 5 프리셋 버튼 (25/35/45/55/65°C).
- 사용자 spec 의 base=0.05, E_a=1.5 는 검증 체크리스트(P 비율 ~3) 와 수학 불일치 → 검증 우선시한 칼리브 값 적용. 이론 비교는 `liquids.water.p_vap_table_celsius_to_kpa` 실측 표 lookup 으로 별도 표시.

**평형 자동 감지 (relative threshold)**:
- |evap_ema − cond_ema| / max(evap, cond) < 0.05 가 5초 유지 + evap_ema > 1.0/s.
- 평형 도달 시 `_equilibriumReachedAtSec` 절대 시간 기록.
- 시뮬 헤더에 평형 배지 (비도달 / 근접 / 도달).
- 영역 2 평형 P 카드: P_vap 큰 숫자 + 막대 + "이론 X.X kPa · 도달 YYYs".

**측정점 표 + P-T 그래프 (영역 3)**:
- "평형 P 기록" 버튼 — 평형 상태 시에만 활성. 클릭 시 (T, P, t_도달, P_이론) 행 추가.
- 측정점 행별 삭제 버튼.
- P-T 그래프 (HTML Canvas, 380×240): 회색 점선 = 이론 곡선 (실측 표), 파란 점 = 측정값.
- ≥ `pt_graph_min_points_for_curve` (=4) 시 측정점 연결 직선.
- ln P vs 1/T 토글 (univ) 은 6.5 후속.

**시각 finalization (fixup 5 누적)**:
- 액체 격자 #1E40AF + opacity 0.92.
- 표면 입자 opacity 0.55.
- 막 등장 기체 청 stroke 3.5 → 0.5 px / 2.5초 페이드.
- 응축 표면 격자 주황 ring 3.5 px / 2.5초 페이드.
- evap/cond flash 18 → 2 px / 1.0초 + 화살표 40 px × 3.5 px (cond 화살표 표면 위 30px → 표면, 액체 묻힘 회피).

### 시각 균형 — 사건 가시성 finalized (fixup 5)

5+ 회 검증 후 시각 균형 finalized. 사용자 4 비판 1:1 매핑:

(1) **rate 그래프 들쭉날쭉** → 평활 강화:
- `rate_ema_alpha` 0.3 → 0.1 (효과적 윈도우 ~3 → ~10 샘플)
- `rate_calc_window_sec` = 3.0 신규: 매 1초 raw rate 직접 EMA 대신, 최근 3초 raw rate 평균 후 EMA 적용
- `rate_window_sec` = 60 (그래프 시간축, fixup 4 의 180 폐기 — 사용자 명시)
- 결과: 1초 단위 Poisson 노이즈 흡수, 부드러운 곡선

(2) **막 나온/들어간 입자 강조 부족** → 진한 테두리 (사용자 제안):
- 기체 입자 spawn 시 `birth_time = performance.now()` 기록.
- `gas_birth_highlight_duration_sec` = 2.0 동안 청 #2563EB 테두리, stroke 2.5 → 0.5 px 선형 보간 페이드.
- 응축 시 표면 격자 위치(가장 가까운 surface 열 snap)에 `condense_highlight_duration_sec` = 2.0 주황 #EA580C ring (반경 = r + 1, stroke 2.5 px 페이드).
- 학생 인지: "막 나온 기체 = 청 테두리, 막 들어온 위치 = 주황 ring".

(3) **응축 화살표 액체 묻힘** → 화살표 위치 변경:
- 직전: tail 표면, tip 표면 + arrowLen (액체 안쪽).
- 신규: tail 표면 위 30 px (기체 영역), tip 표면 살짝 위. 액체에 묻히지 X.
- `cond_flash_color` #EA580C → #DC2626 (진한 빨강) — 시각 강조.

(4) **액체 격자 시각 너무 강함** → 격자 톤 다운:
- `liquid_color` #1E3A8A → #1E40AF (약간 밝게).
- `liquid_opacity` = 0.92 신규 (alpha 235).
- 격자 시각 강도 약화 → flash, 테두리, 화살표 등 다른 사건 시각화 묻히지 X.

학습 효과:
- 청 테두리 (막 나온 기체) + 주황 ring (막 들어온 위치) 동시 또는 교차로 보임 = "양방향 사건이 동시 진행 중" 직관.
- rate 부드러운 곡선 → "두 속도가 점진적으로 만남" 인지 보장.

### 시간 척도 — 학교 실험 정합 (fixup 4)

평형 도달 = 2~3분. 학생 수업 시간 흐름 정합. 너무 빠르면(30초) 학생이 사건의 점진성을 인지할 시간 부족, 너무 느리면(10분) 수업 흐름 끊김.

키 값:
- `evap_rate_per_particle_per_sec` = 0.025 (95 surface × 0.025 ≈ 2.4/s 평균 탈출).
- gas plateau ≈ 50 (gas lifetime ~25s).
- 평형 도달 ~120~180s.

압력 단위 매핑:
- `pressure_kpa_per_gas_particle` = 0.06 → plateau gas 50 → **3.0 kPa**.
- 25°C 물 평형 증기압 실측 ≈ **3.17 kPa** 정합 (학생이 교과서 값과 일치 인지 가능).
- `pressure_kpa_max_for_bar` = 8 (3 kPa = 38% 막대, 가시성 확보).

T 변경 (Phase 6.2~):
- `evap_rate_per_particle_per_sec` 자체를 T 함수로 변경 (Boltzmann factor 직접 도입 X — KE 시뮬 폐기 철학 그대로).
- gas_spawn_KE 평균도 T 따라 비례 (선택).
- 결과: T 상승 시 plateau 입자 수 ↑ → 압력 ↑.

### 시각 효과 — 사건 인지 강화 (fixup 4)

- **표면 입자 반투명** (`surface_opacity` = 0.55): 액체 격자(불투명)와 시각 차별. 학생이 "표면 = 위상 경계, 격자 = 액체 본체" 직관 분리.
- **사건 flash + 화살표** (0.8s 페이드, 12 → 4 px):
  - 증발 = 청 #2563EB 원 + **위 방향** 화살표 (30 px). 표면 입자 위치에서 발생.
  - 응축 = 주황 #EA580C 원 + **아래 방향** 화살표 (30 px). 기체-표면 충돌 위치에서 발생.
  - 화살표 끝 작은 삼각형 화살촉.
- **경과 시간 표시** (`vapor-elapsed-time`): "M분 SS초". 학생이 평형 도달까지 걸린 시간 직접 읽기 가능 — 학교 실험 시간 흐름 인지.

이 4 요소(반투명 / flash 원 / 화살표 / 경과 시간)는 학습 효과 측면에서 다음 역할:
- 반투명 → 위상 분리 직관
- 화살표 → "어느 방향으로 위상 변화" 명시 (좌우 대칭이 아니라 vertical 대칭으로 학습)
- 경과 시간 → "평형은 시간이 걸리는 과정" 인지 (즉시 X)

rate 그래프 y_max 5 (낮은 rate 정합), 평형 임계 0.5/s + min_evap 1.5/s (조기 trigger 회피), 슬라이딩 윈도우 180s (전체 timeline 가시).

### 비동기 Poisson 사건 모델 (직전 1초 동기 게이트 폐기)

직전 (Boltzmann 게이트) 모델 한계 — 사용자 검증 2 비판:
- (1) 1초 단위 KE 재샘플링 + 일괄 게이트 → 매 1초 시점에 탈출 사건 동시 발생 → "대포 펄스" 시각 인위.
- (2) 1초 동안 모든 표면 입자 KE 동시 갱신 → 표면 색이 1초마다 일제 변경, 균질하게 깜빡거림.

사용자 통찰: **"평균 속력만 일정하면 됨"**. KE 변수의 물리 게이트 역할을 폐기하고, 사건 확률만 관리하면 충분.

신규 모델:
- 매 frame 각 표면 입자 독립 평가: `random() < evap_rate_per_particle_per_sec × dt` → 탈출.
- 통계 = Poisson 분포 (시점·입자 무작위 분산, 대포 X).
- KE 변수 = 시각용 색 매핑만. smooth random walk:
  - `KE_target` 매 ~2초 마다 새로 MB 샘플 (각 입자 비동기, 평균 ± 50% 무작위 주기).
  - 매 frame `KE = KE + (KE_target - KE) × smooth_factor + small_noise`.
  - 1초 펄스 X, 부드러운 색 변화.
- gas spawn KE = `[gas_spawn_KE_min, gas_spawn_KE_max]` uniform 샘플 (표면 시각 KE 와 무관 — KE 시뮬 자체 폐기 철학 준수).
- T 변경 (Phase 6.2~) = `evap_rate_per_particle_per_sec` 자체를 T 함수로 (Boltzmann factor 직접 도입 안 함, base_rate 가 T 의존).

폐기 키: `kT_surface`, `E_escape`, `surface_KE_resample_sec`.
신규 키: `evap_rate_per_particle_per_sec` (=0.2), `surface_KE_visual_smooth_factor` (=0.05), `surface_KE_visual_target_change_sec` (=2.0), `gas_spawn_KE_min/max` (=2.0/4.0).
유지 키: `E_capture` (응축 임계, KE 의존 그대로), 색 매핑 (`color_KE_min/max_for_HSB`), gas 물리 (`gas_velocity_damping`, `gas_gravity`, `ceiling_KE_retention`), flash queue.

### Boltzmann 게이트 (직전 균등 확률 모델 폐기) — 폐기됨, 비동기 Poisson 으로 대체

직전 모델 (균등 확률 `p_evap_per_sec_per_particle`) 한계 — 사용자 검증 4 비판 중 핵심:
- 어느 표면 입자든 동일 확률로 탈출 → KE 정보 X.
- 학생 인지 X: "왜 이 입자가 탈출했나" 의 답이 "운".
- 학습 목표 ③ (분자 운동 분포·MB 꼬리) 누락.

신규: 표면 입자에 KE 변수 + Boltzmann 게이트
- 매 `surface_KE_resample_sec` 마다 MB 분포에서 KE 새로 샘플링 (정규분포 근사 mean=kT, stddev=kT/√2, max(0, ·)).
- `KE > E_escape` (= ~3 kT) 면 결정적 탈출 (확률 X).
- 표면 입자 색 = KE HSB lerp (`color_KE_slow` → `color_KE_fast`) — 시각으로 "빠른 분자만 탈출" 인지.

자리 보충 (사용자 비판 (3)):
- 탈출 시 같은 자리에 즉시 새 SurfaceParticle (KE 재샘플링).
- 격자 자리 항상 가득 (직전 명세 그대로).
- 학생 인지: "분자 하나 나가고 안에서 새로 올라옴".

기체 색·속도 fixup (사용자 비판 (1)(2)):
- KE 자연 단위 → px/s 속도 변환 분리 (`gas_speed_scale`, KE=1 → 약 70 px/s).
- 직전 결함: KE=4 자연 단위를 그대로 px/s 로 사용 → 7 px/s 정지처럼 보임.
- KE HSB 색은 KE 자연 단위 기준 (`color_KE_min/max_for_HSB`) — 충돌로 KE 분포 다양화 → 색도 다양.

입자 크기 통일 (사용자 비판 (5)):
- liquid lattice·surface·gas 모두 `r=4`. 직전: liquid r=9, gas r=3.5 — 학생 인지 결함 ("기체 분자가 더 작은가?" 오개념 유발).
- 통일 후: 분자는 같은 종이며 위상만 다르다는 사실 직관적.
- 격자 N 자동 재계산 (cellSize=8 → cols≈97, surface≈97, lattice≈800 @ V_liquid/V_flask=0.2).

### 학습 핵심 — rate 비대칭 가시화 (본 시뮬의 raison d'être)

본 시뮬의 학습 가치 = "왜 평형이 성립하는가" 의 분자 수준 해명. 정답은:

> 증발 속도는 시간 불변 (표면 입자 수 × MB 꼬리 둘 다 시간 무관). 응축 속도는 0 에서 시작해 점진 증가 (기체 밀도 증가 → 표면 충돌 빈도 증가). 두 속도가 만나는 순간이 평형.

이 비대칭 — **"evap 줄어든 게 아니라 cond 가 evap 까지 따라온 것"** — 을 학생이 직접 볼 수 있게 함이 본 시뮬의 raison d'être. 흔한 오개념 ("평형 = 증발 멈춤") 은 이 비대칭을 시각화 안 하면 거의 자동으로 발생.

구현 — 캔버스 하단 80px `RateMiniGraph`:
- y축: rate (입자/s, EMA), 0 ~ `rate_y_max` (=30) 자동 cap.
- x축: 최근 `rate_window_sec` (=60) 초 슬라이딩 윈도우.
- 곡선 2개:
  - 증발 (`rate_color_evap`, 청 #2563EB): 거의 평탄한 수평선.
  - 응축 (`rate_color_cond`, 주황 #EA580C): 0 출발 → 우상향 → 증발선과 만남.
- 두 곡선 사이 반투명 채움 — 비평형 영역 (Δrate) 시각화. 평형 시 면적 → 0.
- EMA 평활화 (`rate_ema_alpha` = 0.3) — 1초 raw 의 노이즈 흡수.
- 평형 검출: |evap_ema − cond_ema| < `equilibrium_threshold_per_sec` (=1.0) 가 `equilibrium_hold_sec` (=5) 초 지속 + `evap_ema > equilibrium_min_evap_per_sec` (=1.0). 만족 시 점선 vertical line + "평형 도달" 라벨.

사이드 패널 보조 정보 (학습 핵심 강화):
- 압력 게이지 P (`pressure_kpa_per_gas_particle` × N_gas, 약식 프록시) + 가로 막대.
- "표면 입자 수: XX (일정)" — 강조 텍스트로 시간 불변성 가시화.
- "기체 입자 수: XX (변동)" — 평형 도달까지 점진 증가 가시화.
- 평형 상태 텍스트 — "비평형 / 근접 / 평형" (3 단계).

학습 목표 매핑:
- ① 평형 동적 본질 → rate 그래프에서 평형 후에도 evap·cond 모두 양수 유지로 직접 확인.
- ② 평형 ≠ 정지 → "기체 입자 수 변동" 표시 + 입자 자체가 계속 움직임.
- ③ 분자 수준 인과 → 표면 입자 KE HSB 색 + Boltzmann 게이트 (별도 §).
- ④ 양방향 접근 → 본 step 외, 후속 step 에서 응축 출발 시나리오로 검증.

### 핵심 시각화 원칙 (본 시뮬의 raison d'être)

"증발/응축 차이가 잘 보임 + 결국 두 속도가 같아짐" 이 모든 시각화 결정의 기준점. 가시성 우선.

**증발/응축 차별화**:
- 색: 증발 = 청색, 응축 = 주황색
- 방향 트레일: 증발 = 위쪽, 응축 = 아래쪽
- flash 잔상 ≈ 150 ms

**rate 그래프 수렴 시각화**:
- 두 곡선 사이 반투명 면적 채움 — 평형 시 면적 → 0 으로 수렴
- 평형도 % 게이지: amber → green, Δrate 기반
- 평형 도달 표지: vertical line + 토스트
- transient / plateau 음영 구분

**params.json 키**: `flash_duration_ms`, `trail_length`, `equilibrium_threshold`, `evap_color`, `cond_color`

### 가시화·통계 우선순위 (MVP 단계 매핑)

| # | 항목 | 단계 |
|---|---|---|
| 1 | 입자 자체 + 액체/기체 영역 분리 | 6.1 |
| 2 | 증발/응축 입자 실시간 강조 (flash) | 6.1 |
| 3 | 입자 색 KE 매핑 (보일 HSB 패턴) | 6.1 |
| 4 | 누적 증발수·응축수 카운터 | 6.1 |
| 5 | 증발 속도·응축 속도 (rate, EMA) | 6.1 |
| 6 | 평형도 지표 `1 - \|Δrate\|/max` | 6.1 |
| 7 | 압력 게이지 + P-t 그래프 | 6.1 |
| 8 | 수조 T 표시 + 시뮬 결합 | 6.2 |
| 9 | 측정점 (T, P_vap) 표 + 자동/수동 캡처 | 6.2 |
| 10 | 평형 도달 알림 (rate 차이 임계 + 유지 시간) | 6.2 |
| 11 | MB 분포 히스토그램 + 탈출 임계선 (high 이상) | 6.3 |
| 12 | ln P vs 1/T 그래프 (univ) | 6.4 |
| 13 | 일시정지 + 단일 입자 추적 | 6.5 |
| 14 | 시뮬 속도 제어 (slow/normal/fast) | 6.5 |
| 15 | 양방향 접근 비교 모드 (X+Y 동시) | 6.5 |
| 16 | 물질 종류 변경 (분자간 힘 비교) | 6.5 (통합 후) |

---

## 7. 4 모드 분기 (보일·돌턴 패턴 재사용)

| 모드 | 신호원 수 | 시간 동기 |
|---|---|---|
| mock | 1 (내부) | 단일 tick에서 (P, T) 동시 생성 |
| ws | 1 (에뮬레이터) | 한 패킷에 (P, T) 동시 송출 |
| real | 1 (ESP32 v1.2 dual-channel) | 단일 패킷, sample-aligned |
| vernier | **2 (GDX-PS + GDX-TMP)** | latest-value latching |

**vernier dual-device 시간 동기**: 압력 패킷 도착 시점을 측정 tick으로 삼고, T는 직전 도착값 사용. 증기압 timescale(수십 초~분)에서 BLE drift 무시 가능.

**아키텍처 영향 (`web/js/serial.js` / `web/js/vernier.js`)**:
- 현행 클래스: `VernierBridgeSensorSource` — 단일 디바이스 가정. Phase 5.9 시점 vernier.js 에 단일 enabled 센서·`ch:0` 고정·`kPa` 단위 하드코딩으로 구현됨.
- 옵션 1 채택: 신규 `VernierDualSensorSource` (가칭, 6.4 진입 시 최종 명명) 내부에 두 godirect 디바이스 캡슐화. 기존 `VernierBridgeSensorSource` 와 별도 클래스로 분리 (boyle/dalton 호출부 영향 회피). 외부 인터페이스는 단일 source처럼.
- 출력 포맷은 `{P, T, t}` channel array로 통일. 후일 SensorComposer 도입 여지 보존.

**배제된 대안**: 옵션 2 (SensorComposer 일반화) — vapor 외 사용처 불명확. YAGNI.

---

## 8. AI 튜터 통합 (D-(4)/(5) 패턴 재사용)

- `tutor.js` factory에 `vapor` 컨텍스트 추가
- 학생 측정 데이터 anchored — 측정점 표 (T, P_vap)를 system prompt에 주입
- 4 모드 분기별 데이터 신뢰도 안내 (mock=시뮬, real=실측 등)
- 소크라테스식 가드 — D-(5) 패턴 그대로

---

## 9. MVP 단계 (Phase 6.x 분할)

| Phase | 범위 | 검증 |
|---|---|---|
| **6.0** | 설계 문서 + CC 점검 보고. 코드 변경 0. 본 문서 commit. | (없음) |
| **6.1** | 시뮬 + mock (P 채널만, T는 슬라이더). 동적 평형 시각화. | 평형 도달, 증발/응축 곡선 수렴, 증발/응축 색·방향 차별화 가시성, rate 두 곡선 + 사이 면적 채움 → 평형 시 면적 → 0 시각 확인 |
| **6.2** | T mock 추가 + 자동 보정 모듈 (P_total → P_vap, 실측 처리·mock 비활성, §4.5). T 변화 → plateau 이동. | T 단계 변화 시 plateau 이동 정합 |
| **6.3** | 펌웨어 v1.2 (DS18B20 채널 추가). 실물 P+T 통합. ws 모드 dual 채널 에뮬. | 실물 dual stream, ws 동시 송출 |
| **6.4** | Vernier dual-device 모드. AI 튜터 분기 + system prompt anchoring. | 시간 동기, 튜터 응답 anchored |

후속:
- 6.5: 발견 활동 통합 UI — β 세기 성질 + α 액체 종류 비교 (동일 비교 화면 패턴)
- 6.6: 학생 수준 검증
- 6.7: README 정합화 + 추가 액체 옵션 (에탄올·메탄올 등 확장)

---

## 10. 검증 항목 (개발 중)

- 시뮬: 평형 도달 (증발 속도 = 응축 속도)
- T 변화 → 증기압 변화 정합 (Clausius-Clapeyron)
- 입력 V_flask·V_liquid 변화 시 화면 입자 수 일정 유지, "1 입자 = X mol" 갱신
- 학생 측정 데이터 → AI 튜터 system prompt 반영
- 4 모드 분기 동작
- 안전: 시뮬 압력 폭주 가드 (params.json `pressure_max_kPa`)

---

## 11. 결정 기록

| 결정 | 근거 | 배제된 대안 |
|---|---|---|
| 셋업 = 삼각플라스크 + 수조 | T 제어 단순, 안전(밀폐 폭주 회피), Johnstone 3수준 직결 | 시린지 + 가열(안전 부담), 단순 시린지(T 제어 곤란) |
| 학습 목표 4개 (동적 평형 중심) | 영재교육 핵심 개념 부합. T-P 관계가 자연스럽게 따라옴 | 끓는점 중심(B; "증기압" 명목성↓), 휘발성 중심(C; 복잡도 과대) |
| V_flask·V_liquid 입력 + 자동 스케일 | 세기 성질 발견 활동 트리거. 시각 고정으로 조건 비교 용이 | 고정값 사용 (탐구 활동 차단) |
| V_flask 프리셋 100/250/500 mL | 실험실 규격 정합, 검증 부담↓ | 자유 입력 (수치 검증 비용) |
| V_liquid 상한 = 0.5·V_flask | 기체상 충분 확보, 액체 넘침 방지 | 자유 입력 (이상 케이스 다수) |
| 입력 시점 = 시작 전 1회 + 잠금 | 측정 데이터와 시뮬 상태 어긋남 방지 | 도중 수정 (상태 정합성 부담) |
| Vernier dual-device 시간 동기 = latching | 증기압 timescale에서 충분, 구현 단순 | timestamped interpolation (오버엔지니어링) |
| 신규 `VernierDualSensorSource` (가칭) 캡슐화 — 기존 `VernierBridgeSensorSource` 와 분리 | YAGNI, 단일 인터페이스 유지 / boyle·dalton 호출부 영향 회피 | SensorComposer 일반화 (사용처 불명확), 기존 클래스 일반화 (단일 디바이스 호출부 영향) |
| 액체 = 물 (MVP) | 안전, 익숙도, 데이터 검증 용이 | 에탄올 (가연성, 후속) |
| 세기 성질 발견 활동은 후속 | MVP에 입력 UI만 노출해도 자발 발견 가능. 명시 가이드는 6.5 | MVP에 정식 학습 활동 포함 (범위 비대) |
| 외부 시뮬 API 배제, 자체 구현 유지 | "시뮬은 미시 인과 가시화" 철학과 외부 API의 black box 성격 충돌. 보일·돌턴 자체 구현 자산(입자·충돌·압력·EMA) 검증 완료. 입자 ~700개 규모는 자체로 충분. | matter.js / p2.js (도입 동기 약함, 위상 통과 자체 구현 필요), 클라우드 SaaS (실시간성 부재), PhET 임베드 (센서·튜터 통합 불가), AI 시뮬 (검증 불가) |
| 위상 통과 = KE 임계 + 표면 근접 + 확률 게이트 | 미시 인과 가시화 철학 직결. 학생이 "빠른 분자가 탈출" 시각 인지 가능. 단순 hard cutoff 은 step function 이라 동역학 부자연. 표면 근접 조건은 액체 한가운데 입자가 갑자기 점프하는 비물리 회피. | 확률만 (Boltzmann factor; 시각 메커니즘 은폐), MB 꼬리 적분 (입자별 시뮬 무의미화) |
| 응집력 = 약 중력 + 표면 stick | 보일 시뮬 입자·충돌 코드 그대로 재활용. 중력만으로 액체 sedimentation 자연 발생. 학생 모델(액체는 아래)과 직관 일치. | Lennard-Jones (N² 부하, transient 길어짐), 영역 가정만 (자연스러운 위상 전환 불가, 인공적), 가짜 인력 (튜닝 파라미터 증가) |
| 카운터 = rate + EMA, 누적은 sub-panel | "동적 평형 = 두 속도가 같음" 가시화에 rate 가 직결. 누적은 평형 시 두 곡선이 평행해질 뿐(slope 비교 필요), rate 는 두 값이 같은 y 에서 만남. 보일 EMA 패턴 재사용. | 누적 only (해석 부담 큼), 즉시 카운트 (노이즈 과다) |
| 액체 종류 (α) + 액체 양 (β) 비교 활동을 6.5 로 통합 | 두 항목 모두 "탐구·발견 활동" 성격. UI 패턴 (설정 변경 → 비교) 유사. 분리 처리는 코드·학습 흐름 중복 단절. | 분리 유지 (β=6.5, α=6.7) |
| 자동 보정 (옵션 A), 학생 가시 = P_vap 만 (§4.5) | 본 시뮬 핵심은 동적 평형 가시화. 압력 분해 학습은 별 활동으로 분리. 단순화로 학생 인지 부담↓. | 옵션 B 학생 직접 분해 (시뮬 학습 흐름 분리), 옵션 C 셋 다 표시 (화면 복잡도↑) |
| Schroeder 2015 LJ MD base 채택 (vapor 시뮬) | 정통 LJ 12-6 + Velocity Verlet + cell list O(N) 검증 (AJP 83 210-218, arXiv 1502.06169). N=수백 50fps. MIT 라이선스. 직전 자체 시도들 (piecewise LJ-like / 응집영역 / 표면추상화 / 자유낙하 / 격자) 모두 실패한 안정 응집 문제 해소. | 자체 LJ 재구현 (검증 비용↑·튜닝 사이클 다수), 외부 가속도장 (분자간 인력 자연 정합성 손실), 사건 추상화 (학생 인지 어색), 격자 (고체 인상) |
| 응축/증발 비율 카드 (mock 학습 단서, fixup 10) | ★ 배지 + 평형도 % 비공개 후 학생 단서 부재 해소. 직관적 비율 표시 (1.0 = 평형) + zone 색 + 1.0 marker. P 카드 placeholder slot 재활용으로 layout shift X. | 평형도 % 단독 노출 (false positive 위험 + 의미 모호), 사건 카운터만 (rate 곡선과 중복) |
| 사이드바 UI = 보일·돌턴 패턴 통일 (fixup 10) | 페이지 간 일관성 확보, 학생 인지 부담↓. vertical block field + button mode toggle + guard-note 색 분기. | 보일·돌턴과 별개 디자인 유지 (UI 변종, 학습 흐름 단절) |
| setTemperature 시 EMA / dP 누적값 리셋 (fixup 10) | T 변경은 시뮬 동적 상태 reset 의미. EMA 잔존 → 곡선 lag, dP 누적 잔존 → 평형 검출 false positive. | 부분 reset (애매한 잔존 상태 — 디버그 어려움) |
| liquid_jitter dead branch 제거 (fixup 10) | params.json `liquid_jitter_amp_px = 0` (사용 X) + lattice amp/phase 필드 + update() 분기 = 모두 dead code. 정적 격자 = 교과서 정합 (액체상 응집), jitter 는 직관 위반. | 키 보존 (옵션 미래 활성 여지 — YAGNI) |
| P 카드 원복 (fixup 11, mock placeholder, real 모드 활성 자연 전환) | 정공법 회귀 흐름 일관 — 학생 가시 P 는 실측 도달 후 활성. fixup 10 ratio 카드 (P 카드 placeholder 활용) 시도 → 학생 단서는 third cell 로 충분, 큰 카드 시각 자원 P_vap 으로 예약. | ratio 카드 큰 카드 유지 (P_vap real 진입 시 layout 재구성 필요), P 카드 mock 활성 (정량 정합 시도 폐기 철학 위반) |
| 비율 표시 = rate 카드 third cell + zone 색 (fixup 11, 옵션 1) | 폭 ~85px → 텍스트 + 색 분기 단순도 ◎. 평형 인지 = 녹색 도달 (직관). 1.0 marker / 막대 / axis 시각 자원 third cell 에 비좁음. | 인라인 50px 막대 (옵션 2, 폭 빡빡), underline 표지 (옵션 3, 옵션 1 보다 시각 부담 ↑) |
| base_evap_rate 0.010 (fixup 11, 학교 실험 시간 정합) + 균형 조정 패키지 | 사용자 명시 5분 평형 정합. 시간상수 τ ≈ 50초 → 평형 도달 ~4~5분. 균형 조정 (ratio 0.4, rate 시간축 180s, P 단위 2배) 으로 시각 사건 부족 / 자동 스케일 빈발 / P plateau 의미 변동 동시 회피. | 0.025 유지 (학교 시간 정합 X), 0.012 (사이드 효과 적당하나 사용자 명시 5분 정합 살짝 모자람) |
| 화살표 매칭 상쇄 (fixup 11, 즉시 매칭 / 위치 무관 / 즉시 사라짐) | 학습 계층 3단계 (색=사건, 화살표=빈도 차, rate=정량) 구분 명확화. 코드 +6줄, 시각 임팩트 큼. transient 위 화살표 다수 → 평형 거의 X = 학생 직관 정합. | 대기 후 매칭 (옵션 2, 비동기 타이머 복잡, 학생 인지 부자연), 위치 가까운 쌍 우선 (O(N×M) 효과 미미), 0.3초 fade 캔슬 (옵션 b, mock 정성 인지 단계 정합성 ↓) |
| T + P 카드 통합 (fixup 12, mock 입력 / real 표시 자연 전환) | 우측 상단 = "센서 영역" Johnstone 3수준 정합. DOM 보존 + class 분기로 Phase 6.3+ 자연 전환. mock T 입력 + P placeholder 동거, real 진입 시 둘 다 활성 — 학생 인지 일관. | 카드 분리 유지 (T 시뮬 아래 + P 우측 상단, 시각 자원 분산), real 모드만 통합 (mock layout 동선 ↑) |
| 시뮬 아래 T 컨트롤 폐기 (fixup 12, 시각 정리) | 시뮬 캔버스 아래 = 시뮬 + 헤더 (시간/배지) 만으로 단순. T 컨트롤 우측 카드 안 셀렉트 + 5 프리셋 grid (보일/돌턴 패턴 재사용) 로 일관. 시뮬 height 자유도 ↑. | 슬라이더 보존 (T 연속 입력 — 학교 실험에서 5 프리셋 충분, fixup 11 base 0.010 정합), 시뮬 아래 + 카드 안 둘 다 (UI 중복) |
| T 입력 = number input (fixup 11+12 integrated, 셀렉트 폐기) | 학생 임의 T 직접 입력 가능 (소수점 허용, 예: 32.5°C). 5 프리셋 보조로 빠른 선택. parseFloat + 범위 외 (NaN, < 0, > 100) fallback (직전 유효값 또는 25). 학교 실험에서 측정값 그대로 입력 시나리오 정합. | 셀렉트 5 옵션 (직전 fixup 12, 학생 임의 T 입력 차단), 슬라이더 (시뮬 아래 폐기 — fixup 12 결정 일관) |
| 화면 반응형 (fixup 11+12 integrated, 1024/768 브레이크포인트) | 데스크탑 (>1024) 가로 3열, 태블릿 (768~1023) 사이드바 + 시뮬 가로 / 카드 row wrap, 모바일 (<768) 모든 영역 세로 stack. 보일/돌턴 페이지 미디어 쿼리 패턴 재사용. | 데스크탑 전용 (모바일 broken layout), 단일 브레이크포인트 (태블릿 어색) |
| 평형 판정 = ratio 0.9~1.1 5초 유지 (fixup 13, 단일 metric) | 직전 P_internal 변화율 (★ 표지) + ratio band (zone 색) 두 모듈 모순 (★ 표시인데 비율 0.88 주황) 회피. ratio 단일 metric 으로 세 표지 (배지/★/zone) 동일 트리거 → 학생 인지 일관. P_internal 변화율 코드 보존 (real 모드 재사용 여지). | P_internal 변화율 유지 (모순 잔존), 두 metric AND 조건 (어느 하나 false 시 평형 미도달, 노이즈 잡힘) |
| mock 평형 배지 활성 (fixup 13, fixup 9 비공개 결정 일부 폐기) | 단일 metric 모순 회피 후 표지 일관 → 비공개 이유 (모순 우려) 소멸. 학생 학습 단서 풍부화 (배지/★/zone 세 표지). P 카드 + 측정점 표는 비공개 유지 (정공법 회귀 흐름 — 정량 측정은 실측 도착 후). | 배지 비공개 유지 (학생 단서 부족), 모든 mock 비공개 결정 폐기 (P 카드/측정점도 활성 — 정공법 회귀 핵심 위배) |
| Rate 워밍업 = 첫 N tick 폐기 (fixup 14, 옵션 a) | 시작 직후 1초 적분 raw 의 Poisson 잡음 (±2σ ≈ 6.0) 이 EMA prime 박힘 → 30초 lag (fixup 9 부작용). 첫 2 tick raw 누적만 → 3초 평균 σ √3 감소 후 prime → 잡음 ±0.69 로 정상값 근접. 첫 2초 그래프/readout `—` 표시 (실 센서 워밍업 정합). | 옵션 (b) rate_calc_window 5초 확장 (첫 1초 잡음 그대로 — 효과 부분), 옵션 (c) Adaptive α (잡음 prime 잔존 절반), 옵션 (e) Incremental α (시각 부자연 — 단조 수렴 곡선) |
| T 직접 입력 = 입력 버튼/Enter 확정 (fixup 14, 사용자 추가) | 학생 타이핑 중 (예: 32.5 → 32 → 3 단계별 입력) 매 keystroke 시뮬 반응은 부담. 확정 패턴 = 학생 인지 명확. 프리셋 즉시 반영은 빠른 선택 보존. dirty state 시각 (border 주황) = "확정 필요" 단서. | 매 change/blur 즉시 (직전 fixup 11+12 integrated, 학생 부담 + 의도 불명), debounce 500ms (반응 지연 학생 인지 부자연) |
| 화살표 매칭 폐기 → 자연 fade only (fixup 15a v4, 4단계 진화 종결) | v1~v3 매칭 진화 모두 부작용 누적 (cond 가시성 손실 / max cap 인공). 단순 push + hold 0.5s + linear fade 1.0s = 양쪽 독립 fade. 학생 인지 = 동시 visible 화살표 수 = 사건 빈도. | v1 매칭 즉시 splice + fade, v2 frame loop FIFO 매칭, v3 match-only soft fade + max cap (모두 부작용 누적) |
| T 입력 잠금 [입력]/[수정] 토글 (fixup 15b) | 직전 fixup 14 확정 후 input 활성 → 학생 실수 가능성. 잠금 = 시각 단서 명확. unlockTemperature = 명시 [수정] 클릭. 후일 Dalton 16a V_A/V_B 입력 확정 = 본 패턴 100% 재사용 (페이지 간 패턴 재사용 가치). | 잠금 X (실수 가능), 자동 잠금 (학생 의도 외) |
| 평형 hysteresis 4-state (fixup 15d, fixup 13 sticky 폐기) | sticky 평형 = 도달 후 이탈 추적 X → 학생 인지 혼선. enter [0.9, 1.1] / exit [0.85, 1.15] hysteresis = 잡음 보호 + 명확한 상태 전환. strict re-entry = 사실 정합 (재도달 = 새 평형). EMA τ=20s + hold 10s = 잡음 √2배 흡수. | sticky 평형 보존 (인지 혼선), 단일 zone (잡음 흔들림), Kalman filter (오버엔지니어링) |
| 평형 5-state machine + 학생 결정 (fixup 15n, dual-layer 회귀 핵심) | dual-layer 회복 (시뮬 가시화 + 학생 측정 결정 활동). detected (시뮬 자동 hold 10s) ≠ confirmed (학생 명시 [확정] 클릭). `world.confirmEquilibrium()` 신규 메서드. 본 프로젝트 정공법 회귀 — 측정 = 학생 결정, 시뮬 자동 판정 폐기. 평형 진화 5단계 끝 (fixup 6 P 거시 → 8 P_internal → 13 ratio → 15d 4-state → 15n 5-state). § 13 참조. | fixup 13 단일 metric (sticky), fixup 15d 4-state (자동 reached, 학생 활동 X), 모두 시뮬 자동 한정 → 학생 측정 활동 손실 |
| T 변경 시 EMA 보존 (fixup 15e, prime 의도 시작 시점 한정) | 직전 setTemperature reset → T 변경 시 evap 곡선 0 폭락 + 13.9 spike (prime 평균 + 잡음 결함). prime intent = 시작 시점 한정 (warmup lag block, EMA=0 → 정상값). T 변경 시 EMA 이미 정상값 → α=0.05 자연 수렴 (~60초). EMA prime 4단계 진화 마무리. | reset 보존 (0 폭락 / 13.9 spike), 새 prime 알고리즘 (복잡도 ↑) |
| P 영역 mock hidden → 부활 (fixup 15f → 15j, 단일 측정값 모드별 source 분기) | 15f mock placeholder 중복 (사이드바 모드 토글 동일 안내) + 비대칭 (~744 → ~636) → hidden. 15h 유지 (시뮬 중심 단순화). 15j 부활 — 사용자 의도 "시뮬일 때는 시뮬값" + measurement 인프라 무비용 (existing getter + recordEquilibrium + drawPTGraph) → hidden wrap 제거만으로 활성. **단일 측정값 + 모드별 source 분기 철학** (mock=시뮬값, real=실측값). | 시뮬 / 실측 별도 카드 (학생 인지 단절), 모든 측정 비공개 (정량 학습 활동 손실) |
| 학습 목표 카드 + counter 카드 즉시 폐기 (fixup 15g → 15h) | 15g 학습 목표 카드 (Johnstone 거시/입자/기호) + counter 카드 신규 → 15h 즉시 통째 폐기. 시뮬 입자 시각화 = 본 프로젝트 핵심, 시뮬 width ↑ 가 학습 가치 직접 효과. 학습 목표 카드 자리 = 시뮬 자리. 의사결정 즉시 reversal raw 자세 보존 (논문 1차 자료). | 학습 목표 카드 보존 (시뮬 width 손실), 모델 좌표 변경 (regression 위험) |
| 사이드바 → top-control 가로 변환 + CSS scaling (fixup 15h, 모델 좌표 보존) | vapor 시뮬 width 가 핵심 → 사이드바 폭 = 시뮬 width 손실. canvas display 800 → 1100 (CSS scaling 1.375×, 모델 좌표 800×480 보존). top-control 2-row = 화면 위에서 한 번에 시각. **CSS scaling 으로 모델 좌표 보존 = regression 격리** (후일 15k 1.625× 재사용). | 사이드바 보존 (시뮬 width 손실), 모델 좌표 변경 (regression 위험), 사이드바 narrow (시각 부담) |
| 시뮬 시각 확대 = CSS scaling + visible ratio 1.75× (fixup 15k) | 사용자 비판 "빈 공간 많음" → CSS scaling 1.625× + visible_ratio 0.4 → 0.7 (visible 입자 1.75× ↑). pressure_per_visible_gas_kPa 0.06 → 0.034 (P 값 보존). **트레이드오프**: ghost 통계 √N 잡음 흡수 효과 일부 손실 (학습 가치 우선). 사용자 직접 번복 패턴 (Claude 추천 → 사용자 신규 의도 = visible ratio 0.7 보존). | A 단독 (sparse 부분 해소), E 단독 (확대 효과 X), 모델 좌표 변경 (regression 위험), 입자 ↑ 일괄 (성능 부담) |
| 가스 입자 수 부활 (fixup 15p, 부분 reversal 종결) | 직전 fixup 15g counter 카드 신규 → 15h 폐기 → mock 정량 인지 단서 부재. T+P 카드 P 영역 하단 inline (별도 카드 X). small text + tabular-nums. 가스 입자 수 = 증기압 직접 source. 부분 reversal 패턴 — 카드 자체 폐기는 보존, 정보 자체는 부활. | 별도 카드 부활 (15g 회귀, 화면 부담), footer (시각 약함) |
| P 영역 그래픽화 = SVG 압력계 + LCD 시계 + 입자 막대 (fixup 15s, Johnstone 3수준 통합) | 사용자 비판 "비어보임" + 사용자 명시 "동그란 아날로그 압력계 + 전자시계 형태". P 영역 좌우 55:45. 좌 SVG 반원 압력계 / 우 상단 LCD 풍 전자시계 / 우 하단 입자 수 막대. **Johnstone 3수준 통합 시각화** — 시뮬 미시 (캔버스) + 측정 도구 거시 (압력계+시계) + rate 그래프 기호. P 영역 8단계 진화 끝 (fixup 6→8→10→11→12→15f→15j→15s). | 단일 측정값 보존 (시각 빈약), 디지털 표시만 (시각 단조), animation (학생 인지 부담) |
| Dalton V_A/V_B 입력 확정 = vapor 15b 패턴 재사용 (fixup 16a, 페이지 간 패턴 재사용) | 사용자 비판 "Enter 모를 수 있으니" → 명시 [입력] 버튼. vapor 15b 검증 자산 100% 재사용 (vAConfirmed/vBConfirmed 독립 flag). default 50/50 visible 단 미확정 (학생 명시 [입력] 강제). 페이지 간 패턴 재사용 첫 사례 — 검증 자산 재활용 가치. | blur 자동 보존 (사용자 비판 X), Enter only (마우스 학생 부담), 단일 flag (V_A/V_B 동시 확정 강제) |
| vapor AI 튜터 통합 = tutor.js factory 재사용 (fixup 17a, Phase 6.4 예약 실행) | tutor.js Phase 6.4 예약 docstring (Phase 6.1-a b3972b3 선언) → 실행 시점. tutor.js 자체 변경 0 (factory + 공통 logic 그대로). vaporConfig 신설 (학습 목표 4 + 절대 원칙 12 + 시뮬 시각 단서 활용). 페이지 간 UX 일관성 (boyle/particles/dalton/vapor 동일). § 14 참조. | 별도 vapor-tutor.js (factory 미사용, 코드 중복), AI 튜터 보류 (Phase 6.4 예약 시점) |
| 시스템 @media 1599 → 1199 + flex 부모 정공법 (fixup 17d, 시스템 차원 본질 발견) | 17b flex 부모 시도 적응형 미작동 + 17c dalton fixed 복제 가림 재발 → 사용자 본질 진단 의뢰 → @media 1599 룰 = boyle/particles/vapor 모든 가림 본질 발견. 1199 축소 + 캔버스 max-width 1279→1599 확장 + flex 부모 재현. ≥1200 flex 자동 축소 / <1200 fixed overlay drawer. silent regression 패턴 + agent 한계 명시 (CC 진단 누락). § 15 참조. | 1599 보존 (가림 미해결), 통째 제거 (좁은 폭 canvas 손실), vapor 만 1599 예외 (시스템 일관성 X), dalton wrap (grid risk) |
| INDEX vapor 카드 = Phase 6 dual-layer 학습 흐름 (fixup 17e) | INDEX 카드 4 → 5. boyle 다음 위치 (Phase 6 dual-layer 정공법 + 평형 학습 확장). 4 라벨 (MBL/Simulation/AI/Arduino, 사용자 명시). vapor.png 사용자 캡처 (placeholder 회피). § 17 참조. | dalton 다음 (학습 흐름 X), 라벨 보수 (Phase 6.3 예정 미반영) |
| 4 페이지 헤더 통일 = CAST prefix + Phase/fixup (fixup 17f, 개발용 in-progress) | DOM 통일 (`<nav class="page-nav">` + `<h1 class="page-title">`). CSS .page-nav flex + .page-title 신설. .dalton-page-utilities 단독 기능 격리 보존. 학생 대상 X, 완료 시 제거 의도 (`<h1>` 한 줄 제거 단순). § 16 참조. | dalton 패턴 단독 (boyle/particles 누락), span 보존 (semantic 약함), CAST prefix 폐기 (브랜드 일관성 손실) |
| dead code 보수 정리 = 신중 모드 4-등급 (fixup 17g-1, codebase healthy) | 사용자 명시 "잘되고 있는 코드 지워버릴 가능성 방지" → 4-등급 분류 (A 즉시 / B 의심 / C 보존 / D 합의). 균등 진단 (4 페이지 + INDEX) 결과 codebase healthy — 등급 A 단 2건 (.vapor-learning-note + .experiment-status). 등급 B/C/D 모두 보존. 분할 시퀀스 (17g-2/3 보류). § 18 참조. | 폐기 적극 (regression 위험), 모든 보존 (잔재 누적), 일괄 처리 (잘못된 폐기 발견 어려움) |

---

## 12. CC 첫 점검 작업 (Phase 6.0)

본 문서 commit 직후 CC가 다음 3개 점검:

1. `web/js/serial.js` `VernierSensorSource` 현재 구조 — 단일 디바이스 가정 강도 확인
2. godirect-js (또는 `@vernier/godirect`) 동시 다중 디바이스 핸들 지원 여부
3. `docs/13-multi-channel-interface.md` — dual channel 설계 기재 여부. 있으면 본 문서가 보강 트리거, 없으면 docs/13 신규 추가 검토

점검 결과는 `docs/10-dev-journal.md` Phase 6 첫 항목으로 기록.

---

## Schroeder MD base 출처 + 라이선스 (sub-step B-1)

**출처**: Daniel V. Schroeder, "Interactive molecular dynamics," *American Journal of Physics* **83**(3), 210–218 (2015). arXiv:1502.06169 [physics.ed-ph]. Web: <https://physics.weber.edu/schroeder/md/InteractiveMD.html>.

**라이선스 본문 발췌** (`InteractiveMD.html` HTML comment 헤더, sub-step B-1 fetch 검증):

> Copyright 2013-2014, Daniel V. Schroeder
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated data and documentation (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND ...
>
> Except as contained in this notice, the name of the author shall not be used in advertising or otherwise to promote the sale, use or other dealings in this Software without prior written authorization.

표준 MIT License + name endorsement 추가 조항. 본 프로젝트 (교육·학술) 사용 적합 — copyright notice 포함만 필수, 광고 용도 X.

**확인된 코드 메타** (sub-step B-1):
- `InteractiveMD.html` 1962 lines (풀버전). `MDv0.html` 597 lines, `MolecularDynamics.html` 220 lines.
- 핵심 함수: `init` (631) / `simulate` (657) / `doStep` (675, Velocity Verlet) / `computeAccelerations` (715, LJ 12-6) / `computeStats` (882) / `updateTandP` (899) / `addAtoms` (1479).
- 외부 의존: `articlepresets.js` (preset 데이터 — 우리 케이스에 불필요, 제외).
- LJ 함수 본문 (`computeAccelerations` line 766–770): `attract = (1/r²)³`, `repel = attract²`, `potentialE = 4(repel-attract) - pEatCutoff`, `fOverR = 24(2·repel - attract)/r²` — 표준 LJ 12-6.
- Cell list O(N): `N ≥ 100` AND `boxWidth ≥ 4·forceCutoff` 조건에서 자동 활성. linked list + neighborOffset 5개 cell.
- 추가 발견: `fixedList[]` (벽처럼 동작 분자), `fixedTList[]` (Andersen 열역학 — Box-Muller polar 로 T 고정 분자 v 재할당, 5·dt 확률).

**우리 변형 영역 체크리스트** (sub-step B-2 ~ B-5):
- [B-2] LJ 12-6 + Verlet 본체 포팅 + p5 instance mode wrapping. 액체 박스 영역 분할 (사방 강한 반발, 위 경계 통과 가능). Schroeder UI (presets/sliders/save·load) 제거.
- [B-3] 색 자동 매핑 (이웃 수 또는 위치 + KE 기반).
- [B-4] 증발/응축 사건 카운터 + rate 미니 그래프.
- [B-5] 학생 가시 패널 (P, T, 측정점 표) + 자동 보정 (§4.5) + 4 모드 분기 (mock/ws/real/vernier).
- 모든 변형 부분은 `web/js/vapor.js` 헤더 주석에 명시 (라이선스 attribution 포함).

**sub-step B-2 진입 조건**: 본 sub-section commit 후 사용자 승인.

---

## 13. 학생 평형 결정 메커니즘 — 5-state machine + dual-layer 정공법 (Phase 6.1-b fixup 15n)

**dual-layer 회귀 핵심**: 시뮬 자동 평형 판정 (Phase 6.1-b fixup 15d hysteresis 4-state) → 학생 명시 [확정] 버튼 (fixup 15n 5-state machine). 본 프로젝트 정공법 = 측정 = 학생 결정. 시뮬 = 단서 가시화 (자동 판정 폐기).

### 5-state machine 명세

| 상태 | 전이 조건 | 시각 표시 |
|---|---|---|
| **none** | 초기 / 시뮬 시작 / T 변경 직후 | 회색 배지 "평형 비도달" |
| **near** | ratio ∈ [0.9, 1.1] 진입, hold 미달 | 노랑 배지 "평형 근접" |
| **detected** | ratio ∈ [0.9, 1.1] hold 10초 통과 (시뮬 자동) | 옅은 녹 배지 "평형 도달 (확정 가능)" + #dcfce7 |
| **confirmed** | 학생 [평형 확정] 버튼 클릭 | 진한 녹 배지 "평형 확정" + bold + #86efac |
| **exited** | ratio 이탈 (zone [0.85, 1.15] 외) | 주황 배지 "평형 이탈" |

전이 자세:
- none → near: ratio 진입 (단순 zone 검사).
- near → detected: ratio hold 10초 (`equilibrium_hold_sec`) 유지.
- detected → confirmed: **학생 명시 [확정] 클릭** (자동 전이 X).
- confirmed → none: T 변경 (새 실험 조건, 학생 명시 [확정] 무효화).
- detected → exited: ratio zone [0.85, 1.15] 이탈 (hysteresis).
- exited → near: ratio 재진입 (`_everReachedEquilibrium=false` strict re-entry).

**핵심**: detected ≠ confirmed. 시뮬 자동 detected = "여기가 평형으로 보입니다" 시각 단서. 학생 confirmed = "평형으로 결정합니다" 측정 활동.

### `world.confirmEquilibrium()` 메서드

```js
world.confirmEquilibrium() {
    if (this._equilibriumState !== "detected") return;  // 자동 호출 차단
    this.equilibriumIdx = this._rateGraphData.length - 1;
    this._equilibriumReachedAtSec = this.elapsedSec;
    this._equilibriumState = "confirmed";
}
```

학생 [평형 확정] 버튼 클릭 → `world.confirmEquilibrium()` 호출. idx + reachedAtSec 학생 결정 시점 set. P-T 그래프 기록 (`drawPTGraph`) 동시 실행.

### 파라미터

| 키 | 값 | 의미 |
|---|---|---|
| `equilibrium_ratio_min/max` | [0.9, 1.1] | enter zone (near → detected hold 시작) |
| `equilibrium_exit_ratio_min/max` | [0.85, 1.15] | exit zone (hysteresis, detected/confirmed 보호) |
| `equilibrium_hold_sec` | 10.0 | near → detected 전이 조건 |
| `rate_ema_alpha` | 0.05 | EMA 평활 계수 (τ=20s, 잡음 흡수 √2배) |

### dual-layer 회귀 정공법 (논문 인용 자세)

**Johnstone 3수준 통합**:
- 거시 (실측): real 모드 (Phase 6.3+) Vernier P 센서 측정.
- 미시 (시뮬): vapor 캔버스 입자 시각화.
- 기호 (rate 그래프): 두 곡선 만남 = 정성적 평형.

**dual-layer**: 시뮬 단서 (detected) + 학생 결정 (confirmed) = 측정 = 학생 결정 (정공법). 시뮬 자동 판정 폐기 = 학생 측정 활동 보존.

**평형 진화 5단계 끝**: fixup 6 P 거시 → fixup 8 P_internal 변화율 → fixup 13 ratio 단일 → fixup 15d hysteresis 4-state → **fixup 15n 5-state 학생 결정**. 일지 17h-1c 참조.

### 패턴 재사용

vapor 15b T 입력 확정 ([입력]/[수정] 토글, `tConfirmed` flag) → Dalton 16a V_A/V_B 입력 확정 (vAConfirmed/vBConfirmed 독립 flag) = 페이지 간 패턴 재사용 첫 사례.

vapor 15n 5-state machine + 학생 [확정] 버튼 = 후일 다른 시뮬 (Phase 6.5 액체 종류 비교, Phase 6.7 추가 액체 옵션) 학생 측정 활동 패턴 재사용 가능.

---

## 14. AI 튜터 통합 — vapor (Phase 6.4 fixup 17a 실행)

**Phase 6.4 예약 실행**: `tutor.js` 헤더 docstring (Phase 6.1-a b3972b3 선언 — "Phase 6.4 예약: vapor 도 본 factory 사용 예정") → fixup 17a 실행. tutor.js 자체 변경 0 (factory + 공통 logic 그대로). 페이지 간 UX 일관성 (boyle/particles/dalton/vapor 동일).

§8 (4 모드 분기) cross-ref + 본 § 신설 = AI 튜터 통합 자세 명시.

### vaporConfig 명세

```js
const vaporConfig = {
    simName: "vapor",
    sidebarSelector: "#ai-sidebar",
    tabIds: ["1", "2", "3", "4", "free"],
    metaTabId: "4",
    closeConfig: { /* default prompt */ },
    reportEnabled: false,
    getQuestionText: vaporGetQuestionText,
    buildSystemPrompt: vaporBuildSystemPrompt,
    buildDataContext: () => { /* T / P / 평형 5-state / measurementPoints */ },
    onLevelDetect: (level) => { /* 학생 수준 자동 감지 */ },
};
window.PchemTutorModule.createTutor(vaporConfig);
vaporTutor.init();   // ← fixup 17b 누락 수정 (silent regression 본질)
```

### VAPOR_LEVEL_GUIDES (4 수준)

- **elem (초등)**: 입자 운동 직관 + 액체↔기체 변화 정성 설명.
- **middle (중등)**: 동적 평형 개념 + 온도 의존성 정성 설명.
- **high (고등)**: 클라우지우스-클라페롱 식 정성 + 평형 정량 (P_eq(T) 함수).
- **univ (대학)**: ln P vs 1/T 직선 + ΔH_vap 도출.

### VAPOR_QUESTION_TEXT (4 수준 × 5 탭 = 20)

5 탭 = Q1 (동적 평형) / Q2 (T 효과) / Q3 (시뮬 vs 이론) / Q4 (메타 질문 자동 생성) / free (자유 질문).

### vaporBuildSystemPrompt

- **학습 목표 4 핵심**: 동적 평형 / T 효과 / 밀폐 평형 / 시뮬 vs 이론.
- **절대 원칙 12** (Phase 5.7 Hybrid wrapper 패턴 정합).
- **시뮬 시각 단서 활용 권장**:
  - rate 그래프 두 곡선 만남 (정성적 평형, fixup 7~14 진화).
  - 압력계 + LCD 시계 + 입자 막대 (fixup 15s Johnstone 3수준 통합).
  - 평형 5-state 배지 (fixup 15n).
  - 화살표 자연 fade (fixup 15a v4 사건 빈도 시각).
  - 형광 색 (fixup 8 노랑 #FCD34D + 핑크 #F472B6 사건 강조).

### buildDataContext (실시간 시뮬 상태)

| 키 | 출처 |
|---|---|
| T_celsius | tInput.value |
| P_kPa | world.pressureKPa (mock=시뮬값, real=실측값, 단일 측정값 모드별 source 분기) |
| V_flask / V_liquid / V_gas | 사이드바 입력 |
| liquidType | 사이드바 셀렉트 (현재 water 만, Phase 6.7 ethanol/methanol 예정) |
| equilibriumState | none/near/detected/confirmed/exited (fixup 15n 5-state) |
| equilibriumDetected / equilibriumConfirmed | boolean getter |
| measurementPoints | recordEquilibrium 누적 |
| mode | "mock" (Phase 6.3+ ws/real/vernier 예약) |

### 4 데이터 소스 분기 (Phase 6.3 예약)

`mode` 키 = 현재 "mock" 만. Phase 6.3+ 진입 시:
- `ws` (에뮬레이터): WebSocket emulator 통합.
- `real` (ESP32 실센서): SerialSensorSource (`web/js/serial.js`).
- `vernier` (BLE 실센서): VernierBridgeSensorSource (`web/js/vernier.js`).

각 모드 진입 시 `world.pressureMeasured` (또는 SensorSource source 직접) 교체. AI 튜터 buildDataContext 무변경 (`P_kPa` 출처만 자동 분기).

---

## 15. 시스템 layout — @media 1199 분기 + flex 부모 정공법 (Phase 6.4 fixup 17b/17c/17d)

**시스템 차원 본질 발견**: vapor 단독 fixup (17b/17c) 모두 미작동 → 4 페이지 균등 진단 → @media 1599 룰 = 모든 가림 문제 시스템 차원 원인. 사이드바 layout 4단계 진화 (17a→17b→17c→17d).

### @media 1599 룰 본질 (Phase 5.4 추정 도입)

`style.css:2336-2362` 안:

```css
@media (max-width: 1599px) {
    #ai-sidebar, #adv-ai-sidebar {
        position: fixed;
        top: 74px; right: 0;
        width: 380px;
        transform: translateX(0);
        transition: transform 0.3s ease;
    }
}
```

→ <1600px viewport 자동 fixed overlay slide-in 전환 → boyle/particles 사이드바도 main 자동 축소 X (silent fail). 사용자 viewport <1600 추정 → vapor 17b flex 부모 무력화.

### fixup 17d 본질 해결

**(1) @media 1599 → 1199 축소** (line 2336):
- ≥1200 flex 자동 축소 (적응형 정공법).
- <1200 fixed overlay 보존 (좁은 폭 canvas 시각, 1599 룰 의도 절반 유지).

**(2) 캔버스 max-width:100% 룰 1279 → 1599 확장**:
- 1200~1599 flex 축소 시 캔버스 정합 (overflow 회피).

**(3) vapor flex 부모 재현** (boyle #basic-mode 패턴 정확 복제):
```html
<div id="vapor-page-wrap" style="display:flex; gap:16px;">
    <main id="vapor-main-container" style="flex:1; min-width:0;">
        <div id="vapor-layout-v2">...</div>
    </main>
    <aside id="ai-sidebar" style="flex-basis:380px; flex-shrink:0;">...</aside>
</div>
```

vapor-layout-v2 max-width 1900 (15l 정책) 보존.

**(4) vapor 17c CSS 폐기**:
- `body[data-page="vapor"] .ai-sidebar { position:fixed }` (dalton 패턴 복제) 폐기.
- vapor 전용 `.vapor-page-wrap / .vapor-main-container` flex 룰 신설.

### 4 페이지 적용

- **vapor / boyle / particles 일괄**: 동일 flex 부모 패턴 (페이지 간 일관성).
- **dalton 제외**: 별도 grid layout (`#dalton-mode.dalton-layout grid-template-columns: 320px 1fr 1.4fr`) 보유. AI 사이드바 별도 fixed 룰 (`body[data-page="dalton"] .ai-sidebar position:fixed`). grid wrap risk 격리 + 사용자 비판 X.

### 사이드바 layout 4단계 진화 (의사결정 history)

| 단계 | commit | 자세 | 결과 |
|---|---|---|---|
| **17a** | f0acb06 | vapor AI 튜터 통합. vaporTutor.init() 호출 누락 | silent regression — 모든 핸들러 미바인딩 |
| **17b** | 753b723 | (1) init() 1줄 추가 (regression 수정) + (2) flex 부모 시도 | init() 정상 단 flex 부모 적응형 미작동 (CC 진단 누락 = 1599 룰 인지 X) |
| **17c** | 27fb45d | flex 부모 rollback + dalton fixed 패턴 복제 (옵션 B) | 사용자 비판 "시뮬 가림" 재발 (vapor 시뮬 폭 vs dalton 차이 무인지) |
| **17d** | e9459c1 | 시스템 본질 발견 (1599 룰) + 정공법 회귀 | 본질 해결 |

### silent regression 패턴 (visible 에러 X, UI 무반응 silent fail)

fixup 17b 진단 시 발견 — `vaporTutor.init()` 1줄 누락. factory `init()` = settings 토글 / 탭 / 입력창 / level-model select 핸들러 바인딩 진입점. 누락 → 모든 핸들러 미바인딩 silent fail. visible 에러 X (console 무로그). dalton:3492 `daltonTutor.init()` 패턴 비교로 발견.

**향후 진단 자세**: factory 패턴 사용 시 init() 호출 누락 = 우선 검사 항목.

### agent 한계 명시 (CC 진단 누락 인정)

fixup 17b/17c 진단 시 vapor 단독 검토로 시스템 차원 룰 (@media 1599) 미발견. fixup 17d body 명시:

> "vapor 17b 미작동 본질 = 1599 룰 무인지 (CC 진단 누락 인정)"

agent 진단 = 단일 페이지 내 패턴 일관성 검토에 강함, system 차원 cross-page 룰 검토에 약함. **사용자 본질 진단 의뢰 (4 페이지 균등) → 시스템 차원 원인 발견** = 사용자 + agent 협업 패턴 정합. 향후 진단 자세 개선.

### "표면 해결 → 본질 해결" 정공법 패턴

17b → 17c → 17d 진화 = 표면 시도 (flex 부모 / dalton 복제) 모두 시스템 차원 룰에 무력화 → 본질 진단 후 정공법 회귀. 패턴:
- 사용자 비판 발생 → 표면 해결 시도.
- 표면 해결 실패 → 사용자 본질 진단 의뢰 (균등 점검).
- 본질 발견 → 시스템 차원 변경 + 정공법 회귀.

---

## 16. 4 페이지 헤더 통일 — 개발용 in-progress 표시 (Phase 6.4 fixup 17f)

**개발용 in-progress 표시**: 학생 대상 X. 완료 시 제거 의도 (`<h1 class="page-title">` 한 줄 제거 단순). 현재 = 개발자 / 검증 시 페이지 진행 상태 시각 단서.

### DOM 통일 (`<nav class="page-nav">` + `<h1 class="page-title">`)

- **boyle / particles**: `<h1>` 신규 추가 (직전 홈 버튼만).
- **dalton**: `<h1 class="dalton-page-title">` → `<h1 class="page-title">` (class rename + 텍스트 갱신).
- **vapor**: `<span class="nav-title">` → `<h1 class="page-title">` (semantic 강화 + 형식 정합).

### CSS 통일

- `.page-nav` flex / align-items / gap 추가 (직전 padding/border만).
- `.page-title` 신설 (flex:1 / font-size 1.2rem / color #1e293b).
- `.dalton-nav / .dalton-page-title` 룰 폐기 (page-nav 통합).
- **`.dalton-page-utilities` 보존** (단독 기능 격리: 단위 atm/kPa 토글 + CSV 다운로드).

### 4 페이지 헤더 텍스트 (형식: `CAST — [학습 주제] — Phase X fixup Y (요약)`)

- boyle: `CAST — 보일의 법칙 — Phase 5.9 D (Vernier 통합)`.
- particles: `CAST — 입자운동론 탐구 — Phase 5.7 트랙 6-b (Hybrid)`.
- dalton: `CAST — 돌턴의 부분압력 — Phase 6.1-b fixup 16a (부피 입력 확정)`.
- vapor: `CAST — 증기압력의 동적 평형 — Phase 6.4 fixup 17d (system layout)`.

CAST = Chemistry AI-assisted Simulation & MBL Tools (INDEX 푸터 명시).

---

## 17. INDEX 진입 카드 — Phase 6 dual-layer 학습 흐름 (Phase 6.4 fixup 17e)

INDEX 페이지 (`web/index.html`) 진입 카드 4 → 5 (vapor 추가).

### 카드 자세

- **위치**: boyle 다음 (Phase 6 dual-layer 학습 흐름 정합 — boyle dual-layer 정공법 + 평형 학습 확장).
- **href**: `vapor.html`.
- **class**: `experiment-card available`.
- **thumbnail**: `assets/img/vapor.png` (사용자 캡처, 파일명 jpg → png 정합 보정).
- **alt**: "증기압 시뮬레이션 화면".
- **라벨 4개**: MBL / Simulation / AI / Arduino (boyle/dalton 패턴 정확 복제).
- **title**: "증기압력의 동적 평형".
- **subject**: "액체↔기체 동적 평형과 온도 의존성".
- **description**: "밀폐 플라스크 안 액체↔기체 입자 사건을 시각화하고, 증발↔응축 비율로 동적 평형의 의미를 탐구합니다.".

### Phase 6 dual-layer 학습 흐름 (boyle → vapor)

- boyle 압력 측정 (단일 변수, dual-layer 정공법) → vapor 압력 + 상변화 (다변수, 평형 학습).
- 4 라벨 일관 (MBL/Sim/AI/Arduino) = 학습 흐름 시각 정합.

---

## 18. dead code 정리 부록 — 신중 모드 4-등급 분류 (Phase 6.4 fixup 17g-1)

**누적 24 fixup 후 dead code 점검**. 사용자 명시 "잘되고 있는 코드 지워버릴 가능성 방지" → 신중 모드 우선.

### 4-등급 분류

| 등급 | 자세 | 처리 |
|---|---|---|
| **A** (즉시 삭제 안전) | HTML/JS 무참조 (grep 0). 직접 폐기 commit history 명시 후 잔재 | 즉시 폐기 |
| **B** (의심) | grep 1~2건 + 동적 생성 / template literal 가능성. 향후 사용 의도 미확인 | 보존 (사용자 합의 후 처리) |
| **C** (보존 권장) | 동적 생성 / 콘솔 디버깅 / 의사결정 history docstring (논문 1차 자료) | 보존 |
| **D** (사용자 합의 필요) | TODO/FIXME, params.json 키, console.log 디버깅 등 의도 의문 | 보존 (사용자 합의 후 처리) |

### 균등 진단 결과 (4 페이지 + INDEX) — codebase healthy

| 페이지 | 등급 A | 등급 B | 등급 C | 등급 D |
|---|---|---|---|---|
| boyle | 0 | 0 | 다수 (활성 인프라) | 0 |
| particles | 0 | 0 | 다수 (활성) | 0 |
| dalton | 0 | 0 | 다수 (활성) | 0 |
| vapor | 0 (HTML) | 0 | 다수 (활성 + 미래 Phase 6.3 인프라) | 0 |
| index | 0 (HTML) | 1 (.experiment-card.disabled) | 다수 | 0 |
| 공통 (CSS) | **2** | 0 | 6 (의사결정 history 주석) | 0 |
| 공통 (JS) | 0 | 0 | 다수 (legacy + 활성) | 2 (디버깅 console.log) |

### fixup 17g-1 폐기 (등급 A 2건만)

- `style.css` `.vapor-learning-note` 룰 폐기 (9 줄, 15h 학습 목표 카드 잔재).
- `index.html` inline `<style>` `.experiment-status` 룰 폐기 (12 줄, INDEX 4 카드 무사용).

### 분할 시퀀스 (보수 처리)

- **17g-1 단독**: 등급 A 2건 (즉시 삭제 안전).
- **17g-2 보류**: 등급 B (.experiment-card.disabled, 미래 disabled 카드 인프라 가능) — 사용자 합의 후 처리.
- **17g-3 보류**: 등급 D (console.log 디버깅, 개발 단계 가치) — 사용자 의도 명확화 후 처리.

**누적 24 fixup 검증 결과 codebase healthy** = Phase 6 finalization 단계 검증 자산.

---

## 99. 핸드오프 메모 (갱신 — Phase 6.4 fixup 17g-1 + 일지 17h-2 시점)

- 직전 작업 commit: `2f4ccfe` (일지 17h-1d Phase 6.4 fixup 17a~17g-1 append)
- 본 트랙 브랜치: `phase6-vapor-design` (main 분기)
- 본 문서 commit 메시지 예정: `docs(vapor-design): fixup 15a~17g-1 reflect + §13~§18 신설 — update (fixup 17h-2)`
- 본 문서 작성일: 2026-05-09 (Phase 6.0 작성). 갱신일: 2026-05-09 (fixup 14 시점 / fixup 17g-1 + 17h-2 시점, 누적 갱신).
- **Phase 6.1-b finalization 종료** + **Phase 6.4 진행** (vapor AI 튜터 통합 + 시스템 layout + 헤더 통일 + dead code 정리).
- 다음 단계:
  - **Phase 6.3** ws/real/vernier 활성화 (vapor 4 데이터 소스 분기 활성).
  - **Phase 6.5** 액체 종류 비교 활동 (β + α 동일 비교 화면, water 외 ethanol 추가).
  - **Phase 6.6** 학생 수준 검증 + README 정합.
  - **Phase 6.7** README 정합 + 추가 액체 옵션 (메탄올 등 확장).
- **이전 §13 핸드오프** (Phase 6.0 작성 시점, 2026-05-09):
  - 직전 작업 commit: `5e3f4b0` (tutor-D-series, docs(ai-tutor) §4.6.5~8).
  - 본 문서 commit 메시지: `docs(design): vapor pressure design draft — Phase 6.0`.
  - (보존 — Phase 6.0 baseline 시점 자세 논문 1차 자료 가치.)
