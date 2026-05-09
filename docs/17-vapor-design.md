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

## 13. 핸드오프 메모

- 직전 작업 commit: `5e3f4b0` (tutor-D-series, docs(ai-tutor) §4.6.5~8)
- 본 트랙 브랜치: `phase6-vapor-design` (main 분기)
- 본 문서 commit 메시지 예정: `docs(design): vapor pressure design draft — Phase 6.0`
- 본 문서 작성일: 2026-05-09
