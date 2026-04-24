# 04. 시뮬레이션 물리 규칙

**문서 목적**: 시뮬레이션의 물리 모델, 박스 기하, 충돌 규칙, 시각화 규칙, 측정 UX 규칙을 정의한다. 구현의 기준이 된다.

---

## 1. 핵심 설계 철학

**"센서 측정값은 시뮬레이션의 1차 물리량(속도)에 즉시 반영하고, 2차 물리량(부피 등)은 물리적 인과 과정을 보여주며 지연 수렴한다."**

공식의 결과값을 즉시 반영하는 것이 아니라, 학생이 **인과 과정을 시각적으로 관찰**할 수 있도록 시간 전개를 설계한다. Johnstone 삼원 모형(macro / sub-micro / symbolic)의 sub-micro 계층을 구체화하는 역할.

**부가 원칙**:
- 물리 정확성 < 교육적 명료성. 단, 이상기체 법칙·Charles 법칙·equipartition은 **강제로** 성립하도록 설계 (오차 < 0.5%).
- 입자 간 충돌의 반데르발스 편차(고밀도 PV +16%)는 의도하지 않은 부산물로 보존 (v2 교육 활용 여지).

---

## 2. 입자 모델

### 2.1 실제 입자 (시각)

- 클래스: `Particle { x, y, vx, vy, mass, radius }`
- 개수: `particle_count = 300`
- 반지름: `PARTICLE_RADIUS = 2.5 px`, 질량 1.0

초기 위치 박스 내 랜덤, 속도 Box-Muller × `DEFAULT_SPEED_SCALE = 120`:
```js
vx = boxMullerStandardNormal() * 120;
vy = boxMullerStandardNormal() * 120;
```

### 2.2 유령 입자 (통계)

- 클래스: `GhostParticle { x, y, vx, vy }` (반지름·질량 없음)
- 개수: 2700, 렌더 안 됨
- 벽 탄성 반사만, 입자 간 상호작용 없음
- 히스토그램 샘플 풀 확장용 (총 3000 샘플)

### 2.3 Maxwell-Boltzmann 속도 통계

2D M-B 관계:
- Mode = σ
- Mean = σ√(π/2) ≈ 1.253σ
- RMS = σ√2 ≈ 1.414σ

기준 T=298.15K에서 σ=120 → RMS ≈ **169.7 px/s**. `getAverageSpeed()` = RMS 반환.

**이론 기준값** (숫자 패널 병기용):
```
REFERENCE_RMS = DEFAULT_SPEED_SCALE × √2   ≈ 169.7
REFERENCE_KE  = ½ × REFERENCE_RMS²          ≈ 14400
v_theory(T)   = REFERENCE_RMS × √(T / REFERENCE_TEMP_K)
KE_theory(T)  = REFERENCE_KE × (T / REFERENCE_TEMP_K)
```

---

## 3. 박스 기하 (실린더 + 피스톤)

### 3.1 구조

주사기 실린더를 모방한 U자형:
- **왼쪽 벽**: 영구 고정. 해칭 패턴으로 "움직이지 않는 벽" 시각화
- **상·하 실린더 벽**: `CYLINDER_LEFT ~ CYLINDER_RIGHT` 고정 길이. 피스톤 후퇴 시에도 실린더 구조 유지
- **오른쪽은 오픈**: 실린더 끝에 수직 벽 없음. 피스톤 로드가 빠져나가는 쪽
- **피스톤**: 헤드(12px) + 로드(70×14) + 손잡이(6×32). 헤드 왼쪽 면이 기체 영역 우측 경계

### 3.2 좌표 상수 (renderer.js)

```
CYLINDER_LEFT   = BOX_INITIAL_X = 40
CYLINDER_TOP    = BOX_INITIAL_Y = 55
CYLINDER_BOTTOM = 55 + 250 = 305
CYLINDER_RIGHT  = 40 + BOX_MAX_WIDTH + 10 = 810
```

Box 객체는 **기체 영역만** 추적:
```
box.x      = 40 (영구 고정, CYLINDER_LEFT와 일치)
box.width  = 동적 (200 ~ 760)
box.height = 250 (고정)
pistonX    = box.x + box.width     // 피스톤 헤드 왼쪽 면
```

### 3.3 폭 cap

```
BOX_MIN_WIDTH = 200   // 극단 압력에서도 시각 공간 확보
BOX_MAX_WIDTH = 760   // 레이아웃 보호 (CYLINDER_RIGHT - BOX_INITIAL_X - 10)
```

`setTargetFromPressure`가 계산한 targetWidth를 cap 범위로 clamp. 슬라이더 하한 **81 kPa**은 cap 영역을 회피하는 설정 (81 kPa에서 targetWidth ≈ 750 < 760).

---

## 4. 충돌 규칙

### 4.1 입자-벽 충돌 (Particle.update)

매 프레임 이동 후 경계 검사:
- 왼쪽: `p.x - r < box.x && p.vx < 0` → vx 반전
- 오른쪽(피스톤): `p.x + r > box.x + box.width && p.vx > 0` → vx 반전, `isPiston: true`
- 상·하: y, vy에 동일 패턴

**속도 방향 가드**: 박스 급격 수축 시 이미 안쪽 향하는 입자에 가짜 반사 막음.  
**반지름 고려**: 경계는 `box.x + r`, `box.x + box.width - r`. 입자 표면이 벽에 닿을 때 반사.  
**위치 클램프**: 반사 후 위치를 경계 안쪽으로 보정 (부동소수점 오차 방지).

### 4.2 강제 수습 (clampParticlesIntoBox)

박스 폭이 `volume_tau`로 수렴하는 동안 피스톤이 입자보다 빠르게 들어올 수 있음. `box.update` 뒤에 별도 패스로 실행:
```
for each particle:
    if p.x + r > box.x + box.width:
        p.x = box.x + box.width - r
        if p.vx > 0: p.vx = -p.vx   // 밖을 향할 때만 반사
```

드물게 "피스톤이 입자를 밀고 들어옴"을 표현. 유령 입자도 동일 처리.

### 4.3 입자 간 탄성 충돌 (v1 포함)

**O(N²) 법선 임펄스 교환** (`_resolveParticleCollisions`):

```
for i < j in particles:
    dx, dy = p_j - p_i
    if (dx² + dy²) >= (r_i + r_j)²: continue   // 겹치지 않음

    pairCount++
    dist = √(dx² + dy²)
    n = (dx/dist, dy/dist)                      // 법선 (i → j)

    // 위치 보정 (겹침 절반씩)
    overlap = (r_i + r_j) - dist
    p_i -= n × overlap/2
    p_j += n × overlap/2

    // 상대 속도 법선 성분
    v_rel = p_i.v - p_j.v
    v_n = v_rel · n
    if v_n <= 0: continue                        // 이미 분리 중

    // 등질량 탄성 임펄스
    impulse = v_n × n
    p_i.v -= impulse
    p_j.v += impulse
```

특성:
- 등질량 → 법선 방향 속도 성분 swap, 접선 성분 불변
- 에너지 보존 (이론상 정확)
- 완전 겹침(dist < 1e-9)은 `n = (1, 0)` 기본값
- N=300 → 44,850 쌍/tick, V8 JIT에서 ≈0.5-1ms (60fps 예산 내)
- **유령 입자는 미참여** (실제 입자끼리만)

**부산물**: 고밀도 극단 조건에서 PV 편차 +16% (반데르발스 b항 효과). v2 교육 활용 가능.

### 4.4 피스톤 전용 충돌 집계

`Particle.update` 반환:
```
{ isPiston: bool, momentumTransfer, speed, x, y }
```

`ParticleSystem.update`에서 `isPiston: true`인 충돌만 `lastPistonCollisions` 배열에 누적. 이 배열이 **충돌 섬광 생성** + **진단 로그 / 연속 로그의 piston_collisions_per_s** 소스.

---

## 5. 시간 축 처리

### 5.1 프레임 기반 업데이트

- 60 Hz (p5.js `requestAnimationFrame`)
- 각 프레임 `dt = p.deltaTime / 1000` (ms → s)
- `DT_CAP = 0.05 s` 상한 (탭 비활성 후 큰 dt 방지)

### 5.2 지수 수렴 공식

```
current += (target - current) × (dt / tau)
```

63% 수렴 시간 = tau, 99% ≈ 4.6·tau.

### 5.3 시정수 정리

| 이름 | 값 | 용도 |
|---|---|---|
| `volume_tau_seconds` | 0.5 s | 박스 폭 → targetWidth |
| `velocity_tau_seconds` | 0.05 s | (샤를 확장 시) |
| `TRANSITION_TAU` | 0.3 s | 온도 변경 시 속도 전이 |
| EWMA α_P | 0.1 @ 20Hz | smoothedP 센서 스무딩 (≈475 ms) |
| `HIST_TIME_ALPHA` | 0.03 @ 60Hz | 히스토그램 시간 평활 (≈550 ms) |

### 5.4 재생 속도 제어 (Phase 4.6, `feature/responsive-canvas`)

물리 코드(Particle, Box, ParticleSystem)를 건드리지 않고 시각적 재생 속도만 조절:

**원칙**: dt는 update 루프 **진입점에서만** 스케일링. 내부 물리는 원래 dt 의미 그대로 받음.
```
기본 페이지(boyle.html) (main.js:79-101):
  raw dt = min(deltaTime/1000, 0.05)         // renderer.js에서 계산
  if (isPaused) return;                       // early-return
  scaledDt = dt * speedMultiplier             // 0.25 / 0.5 / 1
  system.update(scaledDt)
  box.update(scaledDt, volume_tau_seconds)
  currentSpeedRatio += ... * (scaledDt / TRANSITION_TAU)

심화 페이지(particles.html) (main.js:494-517): 동일 + Flash.update(scaledDt)
```

**불변성**:
- 내부 `vx, vy` 값 그대로 — 속도 게이지·히스토그램 x축은 배율 무관
- 평균 속도 `v̄`, 평균 KE, 온도 K, 압력 kPa 전부 불변 (물리량은 시간 흐름과 독립)
- 피스톤 충돌 주파수 `f₁` (시뮬 시간 기준)도 불변

**배율이 영향 주는 것**:
- wall-clock 대비 입자 이동 속도 (시각적으로 느려/빨라 보임)
- wall-clock 기준 측정: 그대로 두면 `hitsPerSec_wall = k × f₁`로 편향됨
  - 보정: main.js:167, 706에서 `/ speedMultiplier` 적용 → sim-time 기준 `f₁` 복원
  - 라벨 `"충돌/s (시뮬 시간)"`로 명시

**2x 배율 미지원 이유**: `simulation.js:185`의 `if (dt > DT_CAP) dt = DT_CAP;` (DT_CAP=0.05)가 `dt × 2 = 0.1`을 다시 0.05로 잘라버림. sub-step(한 프레임 updateFn 2회 호출) 방식 필요 — 후속 작업.

**CFL 안전성**: 현재 3σ 이동거리 최대 ≈ 51px/frame (심화 He 500°C 기준 1x), 박스 최소 폭 180px 대비 여유. 0.5x/0.25x는 이동거리 감소 방향이라 항상 안전.

---

## 6. 보일 법칙 (현 구현)

### 6.1 데이터 흐름

```
슬라이더 압력
    ↓
Mock 센서 (20Hz + Gaussian σ=0.1 kPa)
    ↓
smoothedP (EWMA α=0.1)
    ↓
box.setTargetFromPressure(smoothedP, P0, V0_current)
    ↓
box.update(dt, volume_tau) — tau=0.5s 지수 수렴
    ↓
box.width 변화 → 입자 반사 위치 + 밀도 자연 변화
```

### 6.2 이상기체 법칙 강제

시뮬레이션은 **충돌 빈도에서 압력을 도출하지 않는다**. 대신 법칙을 명시적으로 부과:

```
V_baseline(T) = REFERENCE_V_ML × (T / REFERENCE_TEMP_K)       // Charles 법칙
V0_current    = V_baseline_area_at_current_T                   // 픽셀² 단위
targetArea    = P0 × V0_current / currentP                     // Isothermal
targetWidth   = clamp(targetArea / height, BOX_MIN_WIDTH, BOX_MAX_WIDTH)
```

결과: 임의의 (P, T) 조합에서 이상기체 법칙 `PV/T = const` **자동 성립**. 측정 편차는 **안정화 미달 + 센서 노이즈**에서만 발생 (안정화 + 1초 이동평균 적용 시 < 0.5%).

### 6.3 부피 환산 (표시용)

```
V_mL = box.width / baseline_gas_width_px × baseline_volume_mL
     = box.width / 600 × 50
```

- `baseline_gas_width_px = 600`, `baseline_volume_mL = 50` (params.json, 기준 T=298.15K 기준값)
- 온도 변경 시 box.width 자체가 변하므로 V_mL도 자동 스케일 반영

### 6.4 단위 병기 표시 정책 (Phase 4.6, `feature/responsive-canvas`)

교육적 이해도를 높이기 위해 UI 표시 레이어에서 대체 단위를 **병기**. **내부 상태·물리 계산은 기존 단위(kPa, 입자수, mL, K) 그대로 유지**.

**압력**:
```
atm = kPa / 101.325
표시: "101.3 kPa (1.00 atm)"
```
- 심화 페이지(particles.html) 실시간 압력 패널(`main.js:407`)과 info 패널(`ui.js:205, 1725`)에 적용
- `computeAdvPressure()`의 반환값은 여전히 kPa, `setTargetFromPressure`도 kPa 입력

**물질량** (심화 페이지(particles.html) 전용):
```
n₀ = P₀V₀ / (R·T₀)
   = (101.325 kPa × 0.050 L) / (8.31446 kPa·L·mol⁻¹·K⁻¹ × 298.15 K)
   ≈ 2.044 mmol           (300 입자 기준)
mmol = N × 0.006815     (입자당 mmol 계수)
표시: "300개 (2.04 mmol)"
```
- 심화 페이지(particles.html) 입자수 슬라이더 값(`main.js:420`)에만 적용
- 기본 페이지(boyle.html)는 입자수 UI 노출 없음 → 영향 없음
- 기체 종류 무관 (이상기체 전제, `ADV_GAS_MASSES`는 속도 스케일 `√(m_ref/m)`에만 영향)

**자가 일관성 검증**:
- 학생이 병기값(atm·mmol·mL·K)으로 `PV = nRT` 수작업 검증 시 R = 0.0815 ~ 0.0822 L·atm·mol⁻¹·K⁻¹
- 이론값 0.08206 대비 **최대 오차 0.63%** (극단 영역 0.06 atm·0.34 mmol·173.15 K), 일반 영역 <0.2%
- toFixed(2) 반올림 누적 오차가 교육 실험 허용치(통상 2~3%) 대비 충분히 작음

**의도적으로 kPa 유지되는 경로** (후속 동기화 가능):
- AI 프롬프트 컨텍스트 (`ai-tutor.js:583, 607, 750`)
- CSV 헤더 (`main.js:123-125`, 측정·연속 로그)
- 그래프 축 라벨 (`ui.js:435, 439, 554, 558`)
- 측정표 컬럼 (`ui.js:275-276, 2033-2035`)
- HTML 정적 라벨 (`index.html:179, 191`)
- 센서 원시 입력 (`smoothedP`, `sensorManager` 전 경로)

**원칙**: raw 단위는 물리 코드의 단일 진실 공급원(single source of truth). 표시만 다국어 라벨처럼 병기.

---

## 7. 샤를 법칙 (현 구조: 보일 프레임 내 온도 설정)

### 7.1 설계 개요

독립 샤를 실험 대신 **보일 프레임 내 온도 조절**로 구현. 학생이 `[온도 설정]` UI에서 0/25/50/77°C 프리셋 또는 커스텀 값 커밋.

### 7.2 온도 변경 처리 (main.js onCommit)

1. 진행 중 전이가 있으면 snap (`oldTempK` = 이전 목표)
2. `currentTempCelsius = newCelsius` 업데이트
3. `renderer.snapshotHistogramForGhost()` — 이전 분포 캡처
4. `targetSpeedRatio = √(newTempK / oldTempK)`
5. `currentSpeedRatio = 1, lastAppliedRatio = 1, transitionStartTime = now`
6. `recomputeV0Current()` → V_baseline(T) 갱신
7. `box.setTargetFromPressure(smoothedP, P0, V0_current)` — 박스 target 갱신
8. `updateInfoPanel({ temp_K })` 온도 표시 갱신
9. `measApi.clearMeasurements()`, `continuousBuffer.length = 0`, `sessionStartMs = null`
10. `analysisApi.clear()` — 분석 섹션 초기화 + 사이드바 대화(`aiConversations` 4개 세션) `resetAllConversations()`로 일괄 리셋

### 7.3 속도 전이 애니메이션 (매 프레임 updateFn)

```
if transitionStartTime !== null:
    currentSpeedRatio += (target - current) × (dt / TRANSITION_TAU)  // TAU=0.3s

    elapsed = now - transitionStartTime
    relError = |target - current| / target
    if elapsed > 10s OR relError < 0.001:
        currentSpeedRatio = targetSpeedRatio
        transitionStartTime = null

    frameRatio = currentSpeedRatio / lastAppliedRatio
    system.scaleVelocities(frameRatio)            // 실입자 + 유령 모두
    lastAppliedRatio = currentSpeedRatio
```

특성:
- 누적 곱 방식 (부동소수점 드리프트는 snap으로 제거)
- 5τ ≈ 1.5s에 99% 수렴
- 실입자 + 유령 입자 **모두** 스케일 → 히스토그램 샘플도 함께 이동

### 7.4 Equipartition 검증

25°C (298.15K) → 77°C (350.15K) 온도 상승 후:
- RMS 속력 172 → 184 (√(350.15/298.15) = 1.084 배)
- 평균 KE 14796 → 16908 (비율 1.143 ≈ 350.15/298.15) ✓

---

## 8. 시각화 규칙

### 8.1 HSB 속도 색상 (입자·섬광 공유)

**vMaxColor 고정**:
```
vMaxColor = getInitialAverageSpeed() × v_max_color_factor
         = 169.7 × 2.0 = 339.4 px/s
```

페이지 로드 시 **1회 고정**, 온도 변경 시에도 재계산 안 함 → 온도 상승이 "전체적으로 붉어짐"으로 자연 시각화.

입자 색 (RGB 모드 대신 HSB):
```
ratio = min(speed / vMaxColor, 1)
hue = 240 − 240·ratio       // 파랑(240°) → 빨강(0°)
sat = 40 + 60·ratio          // 40% → 100%
bri = 70 + 30·ratio          // 70% → 100%
```

### 8.2 피스톤 충돌 섬광 (Flash 클래스)

각 피스톤 충돌에서 `new Flash(x, y, momentumTransfer, computeHueFromSpeed(speed))`:
```
baseRadius = 2 + strength × 0.015              // 운동량 비례
lifetime   = flash_duration_sec (0.12s)
```

매 프레임 drawing:
```
t = age / lifetime
alpha  = 180 × (1 − t)                         // 페이드아웃
radius = baseRadius × (1 + t × 0.2)            // 살짝 확대
fill(hue, 60, 100, alpha)
circle(x, y, radius × 2)
```

### 8.3 속도 히스토그램

- **bin 개수**: `HIST_BIN_COUNT = 40`
- **x축 범위**: `0 ~ vMaxColor` (고정)
- **y축 스케일**: `initialMaxCount` (페이지 로드 시 1회 측정, 고정)
- **샘플 소스**: 실입자 + 유령 입자 (3000 샘플)
- **오버플로 drop**: `speed >= vMaxColor` 샘플은 드롭 (꼬리 clip)

**스무딩 2중**:
1. 시간 EMA: α = 0.03 @ 60Hz (τ ≈ 550 ms)
2. 공간 5-point 커널 `[0.1, 0.2, 0.4, 0.2, 0.1]`, 경계는 3-point fallback

**막대**: bin 중심 정렬, `barWidth = binW × 0.12` (얇음), 공유 HSB 색상.

### 8.4 이론 M-B 곡선 오버레이

`getAverageSpeed()` (RMS) 기반:
```
σ = RMS / √2                              // 2D M-B mode parameter
density(v) = v × exp(−v²/(2σ²))
scale = 현재 총 count / rawDensitySum     // 막대 총합과 맞춤
```

bin 중심점 polyline 연결. 온도 변경 시 σ 재계산 → 곡선 자연 이동.

### 8.5 이전 온도 ghost 오버레이

`renderer.snapshotHistogramForGhost()`가 `smoothedBins` 복사본을 `previousTempBins`에 저장.

`drawHistogram` 렌더 순서:
1. 현재 막대 (HSB 채움)
2. 이전 분포 polyline (반투명 회색 1.5px, 알파 130)
3. 이론 M-B 곡선 (짙은 폴리라인 1.5px)

토글 2개 (기본 둘 다 ON): **"이전 온도 분포"**, **"이론 곡선 (맥스웰-볼츠만)"**.

---

## 9. 측정 UX 규칙

### 9.1 안정화 감지

50ms setInterval (20Hz)에서 버퍼 유지:
- `pHistory` (smoothedP, window=20, = 1초)
- `widthHistory` (box.width, window=20)

판정:
```
isStabilized = (|pNow − pThen| / pNow < 0.005) AND
               (|wNow − wThen| / wNow < 0.005)
```

**리셋 트리거**: 슬라이더 `input` 이벤트 → 두 버퍼 비움 → 즉시 unstabilized 상태.

### 9.2 [기록] 버튼 제어

`isStabilized === false`일 때:
- 버튼 `disabled` 속성 활성
- 옆에 "값 안정화 중…" 힌트 (visibility 토글로 공간 예약)

안정화되면 버튼 활성. 슬라이더 조작 후 ≈3~4초에 재활성화.

### 9.3 기록 시 1초 이동평균

```
P_recorded = mean(pHistory)
V_recorded = mean(widthHistory) → pixelsToML
```

**학생 V 편집 override**: vInput의 편집 감지 플래그(`studentEdited = true`)가 있으면 학생 입력값 그대로 저장.

### 9.4 세션 시작 시점

`sessionStartMs = null` 초기. 다음 중 **먼저 발생**하는 이벤트에서 `Date.now()`:
- 슬라이더 `input` (onChange 콜백 내부)
- [기록] 버튼 클릭

`[전체 삭제]` 또는 온도 변경 시 null 리셋 → 다음 상호작용에서 새 세션.

### 9.5 연속 로그 샘플링

`sessionStartMs !== null`인 동안 250ms setInterval에서 스냅샷:
```
{ timestamp_ms, P_kPa, V_mL, box_width_px, mean_speed_px_per_s,
  piston_collisions_per_s, stabilized, temperature_K }
```

버퍼 상한 **10000 행** (≈ 42분). 초과 시 shift + `console.warn` 1회.

### 9.6 분석 섹션 표시 조건

`datapoints.length >= 3`일 때 `#section-analysis` 가시 (`.hidden` 제거). 2개 이하로 줄면 숨김.

`[전체 삭제]` / 온도 변경 시엔 사이드바 AI 튜터 대화(4개 세션)도 함께 초기화 (`analysisApi.clear()` → `resetAllConversations()`). 성찰 textarea는 Part 3.5에서 제거되어 더 이상 존재하지 않음.

### 9.7 AI 튜터 사이드바 연계

측정점 누적과 분석 결과는 우측 AI 튜터 사이드바(구조·UI 상세는 `docs/03-software-architecture.md` §4.3 참조)와 연동된다. `datapoints.length >= 3` 시점부터 사이드바의 성찰 탭 Q1/Q2/Q3이 활성화되며(자유 탭은 상시), 학생은 대화를 통해 관찰 결과를 언어화하는 탐구 단계로 진입한다.

물리 관점에서 중요한 것은 **측정 사이클의 귀환점**이 여기서 끝난다는 점 — 시뮬레이터·센서·측정 UI가 정량 데이터를 완성하고, 그 데이터가 대화의 컨텍스트로 이어진다. 따라서 `aiConversations`는 측정 세션의 논리적 연장이며, 세션 초기화(전체 삭제·온도 변경) 시 함께 리셋되는 것이 일관적이다.

---

## 10. 산염기 실험 (설계 예정)

pH 센서 기반 이온화 시각화는 추후 별도 문서에서 정의. 예상 구조:
- 센서 pH 즉시 반영
- 이온 개수 분포는 Ka 값으로 계산 (강산: 완전 이온화, 약산: 부분 이온화)
- 평형 상태 전이는 지수 수렴으로 시각화
- 온도 변화 시 평형 이동(르샤틀리에): 수렴 과정이 시간 지연으로 표현

---

## 11. 튜닝 가능 파라미터

### 11.1 `web/config/params.json`

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `particle_count` | 300 | 실제 입자 수 (시각·물리) |
| `ghost_count` | 2700 | 유령 입자 수 (통계 전용) |
| `velocity_tau_seconds` | 0.05 | 입자 속도 수렴 (샤를 확장용) |
| `volume_tau_seconds` | 0.5 | 박스 폭 지수 수렴 |
| `pressure_smooth_window_sec` | 0.3 | (유보) |
| `temperature_smooth_window_sec` | 2.0 | (유보) |
| `collision_smooth_window_sec` | 1.0 | (유보) |
| `flash_duration_sec` | 0.12 | 피스톤 섬광 지속 |
| `flash_initial_alpha` | 120 | (현 구현은 180 하드코딩) |
| `v_max_color_factor` | 2.0 | vMaxColor = RMS × factor |
| `initial_pressure_kPa` | 101.3 | 기준 압력 P₀ |
| `initial_volume_mL` | 30.0 | (유기 필드, 현 구현 미사용) |
| `initial_temperature_K` | 298.15 | 기준 온도 (UI 기본값 25°C에 대응) |
| `baseline_gas_width_px` | 600 | pixelsToML 변환 기준 폭 |
| `baseline_volume_mL` | 50 | pixelsToML 변환 기준 부피 |

### 11.2 코드 내 상수

| 이름 | 값 | 위치 | 설명 |
|---|---|---|---|
| `DT_CAP` | 0.05 | simulation.js | 프레임 dt 상한 |
| `DEFAULT_SPEED_SCALE` | 120 | simulation.js | M-B σ (기준 T) |
| `PARTICLE_RADIUS` | 2.5 | simulation.js | 입자 반지름 |
| `BOX_MIN_WIDTH` / `MAX_WIDTH` | 200 / 760 | simulation.js | 폭 cap |
| `BOX_INITIAL_X/Y/WIDTH/HEIGHT` | 40 / 55 / 600 / 250 | simulation.js | 초기 기하 |
| `CYLINDER_LEFT/TOP/BOTTOM/RIGHT` | 40 / 55 / 305 / 810 | renderer.js | 실린더 외곽 |
| `SIM_CANVAS_WIDTH/HEIGHT` | 900 / 360 | renderer.js | 시뮬 캔버스 |
| `HIST_CANVAS_WIDTH/HEIGHT` | 560 / 260 | renderer.js | 히스토그램 캔버스 |
| `HIST_BIN_COUNT` | 40 | renderer.js | 히스토그램 bin |
| `HIST_TIME_ALPHA` | 0.03 | renderer.js | 시간 EMA α |
| `REFERENCE_TEMP_K` | 298.15 | main.js | 기준 온도 |
| `REFERENCE_V_ML` | 50 | main.js | 기준 부피 |
| `REFERENCE_P_KPA` | 101.3 | main.js | 기준 압력 |
| `REFERENCE_RMS` | ≈ 169.7 | main.js | DEFAULT_SPEED_SCALE × √2 |
| `REFERENCE_KE` | ≈ 14400 | main.js | 0.5 × REFERENCE_RMS² |
| `TRANSITION_TAU` | 0.3 | main.js | 온도 전이 시정수 |
| `STABILIZATION_WINDOW` | 20 | ui.js | 50ms × 20 = 1초 |
| `STABILIZATION_THRESHOLD` | 0.005 | ui.js | 0.5% 상대 변화 |
| `CONTINUOUS_MAX_ROWS` | 10000 | main.js | 연속 로그 상한 |
| `CONTINUOUS_SAMPLE_INTERVAL_MS` | 250 | main.js | 연속 로그 샘플 주기 |

---

## 12. 구현 체크리스트

### v1 필수 기능 (완료)

- [x] Particle 클래스 (맥스웰-볼츠만 초기 속도)
- [x] GhostParticle 클래스 (통계 전용 2700개)
- [x] ParticleSystem (update / scaleVelocities / clampParticlesIntoBox)
- [x] Box 클래스 + setTargetFromPressure + MIN/MAX cap
- [x] 벽 탄성 반사 (반지름 + 속도 방향 가드)
- [x] 피스톤 전용 충돌 집계
- [x] 입자 간 탄성 충돌 (O(N²) 법선 임펄스) — **v2에서 v1으로 승격**
- [x] 강제 수습 패스 (clampParticlesIntoBox)
- [x] 속도 전이 애니메이션 (TRANSITION_TAU=0.3s + snap)
- [x] V_baseline(T) = V₀ · T/T_ref 동적 재계산
- [x] 지수 수렴 유틸 + 프레임 레이트 독립 dt 처리
- [x] `params.json` 로딩
- [x] p5.js 렌더러 — 실린더 U자형 + 피스톤(헤드/로드/손잡이)
- [x] HSB 속도 색상 + 충돌 섬광 (운동량 비례, 입자 색 상속)
- [x] 속도 히스토그램 (40 bin, 3000 샘플, 2중 스무딩)
- [x] 이론 M-B 곡선 오버레이
- [x] 이전 온도 ghost 오버레이
- [x] 안정화 감지 + 1초 이동평균 기록
- [x] 세션 시작 트리거 + 연속 로그 250ms 샘플링

### v1.1 이후

- [ ] 샤를 법칙 전용 장비 (에어챔버 + DS18B20 온도 센서)
- [ ] 실 온도 센서 수신 (MockTemperatureSensor + 실센서)

### v2 확장 가능

- [ ] 반데르발스 편차 교육적 활용 (고밀도 PV 편차 명시적 표시)
- [ ] 부피 자동 측정 (선형 포텐셔미터)
- [ ] 3D 시뮬레이션 (트레이드오프 검토)
- [ ] 입자 간 충돌 공간 분할 (Spatial Hash) — 고입자수 최적화
- [ ] 물리 엔진 기반 정밀 시뮬레이션 (외부 라이브러리)
