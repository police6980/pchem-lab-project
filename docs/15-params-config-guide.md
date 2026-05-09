# 15. params 설정 가이드

> `web/config/params.json` + 코드 고정 상수 + `dalton.gases` 정의의 단일 권위 문서. **현재 값 + 의미 + 갱신 흐름** 위주. 의사결정 근거 (왜 이 값인가) 는 docs/04 / docs/11 / docs/10 cross-ref.

---

## 1. 목적·범위

본 문서가 다루는 것:
- `web/config/params.json` 의 모든 키 — 현재 값, 의미, 영향 받는 코드, 갱신 시점
- `web/js/main.js` 의 `SCENE` 상수 (돌턴 시각 좌표) — 코드 고정 사실 명시
- `dalton.gases` 5 종 (air/co2/he/n2/o2) — 분자량·speedFactor·color 의 의미 + 추가 가스 절차
- 실물 센서 도착 후 `dalton.sensor` / 캘리브 상수 갱신 흐름

본 문서가 다루지 **않는** 것:
- 보일 측 코드 하드코딩 상수 (`DT_CAP` / `DEFAULT_SPEED_SCALE` / `BOX_MIN_WIDTH` 등) → `docs/04-simulation-physics.md` §11.2 권위
- 시뮬 물리 결정 근거 (왜 `volume_tau=0.5s`, 왜 `speedFactor=1/√(M/29)`) → `docs/04` §3·§11
- 캘리브레이션 파이프라인 전체 → `docs/14-calibration-pipeline.md` (전략 C — 브라우저 측 보정)
- 실물 도착 시 절차서 → `docs/19-real-sensor-integration-checklist.md` §6 (영점·스팬)
- A-1 노이즈 시나리오 모드 (off/quiet/normal/harsh) → `tools/firmware-emulator/README.md` §4
- 전체 아키텍처 / 모듈 구성 / 데이터 흐름 / sensor 시스템 통합 → `docs/03-software-architecture.md`

---

## 2. 파일 구조

```
web/config/params.json
├─ <top-level 공통>          # 보일·입자운동·돌턴 공통 키 (보일 측 권위 = docs/04 §11.1)
│  ├─ particle_count, ghost_count
│  ├─ velocity_tau_seconds, volume_tau_seconds
│  ├─ pressure/temperature/collision_smooth_window_sec   (유보)
│  ├─ flash_duration_sec, flash_initial_alpha
│  ├─ v_max_color_factor
│  ├─ initial_pressure_kPa, initial_volume_mL, initial_temperature_K
│  ├─ piston_face
│  └─ baseline_gas_width_px, baseline_volume_mL
└─ dalton                    # 돌턴 전용
   ├─ gases                  # 5 종 (air/co2/he/n2/o2) × { label, M, speedFactor, color }
   ├─ syringe_a, syringe_b   # { v_min, v_max, v_default, default_gas }
   ├─ debounce_ms
   ├─ stabilization_sec
   ├─ injection_animation_sec
   └─ sensor                 # ★★★ Phase 5.4 외부화 (5 상수, 실물 캘리브 대비)
      ├─ ema_alpha
      ├─ particle_update_threshold_kpa
      ├─ mock_interval_ms
      ├─ mock_noise_sigma_kpa
      └─ safety_timeout_extra_ms
```

로딩 — `web/js/main.js:3641` `await fetch("config/params.json").then(r => r.json())` (보일·입자운동·돌턴 공통). 돌턴은 추가로 `cfg = params.dalton` 로 sub-tree 사용 (`main.js:796`).

---

## 3. boyle 섹션

별도 sub-tree 없음. **보일 페이지는 top-level 공통 키만 사용** (`initial_pressure_kPa`, `particle_count`, `ghost_count`, `velocity_tau_seconds`, `flash_duration_sec`, `v_max_color_factor`, `baseline_gas_width_px`, `baseline_volume_mL` 등).

각 키의 의미·영향 코드 — `docs/04-simulation-physics.md` §11.1 표 권위. 본 문서는 중복 회피.

추가 권위 항목 (docs/04 표시):
- `flash_initial_alpha = 120` — 현 구현은 180 하드코딩 (params.json 값 미반영, dead 가능성)
- `initial_volume_mL = 30.0` — 유기 필드, 현 구현 미사용

→ 본 두 항목은 cleanup 후보 (별 작업).

---

## 4. dalton 섹션

`params.dalton` (`main.js:796` `cfg = params.dalton`).

### 4.1 sensor — ★★★ Phase 5.4 외부화 5 상수

**위치**: `web/config/params.json` `dalton.sensor`. **외부화 commit**: eaa524f. **소비**: `web/js/main.js:1505-1506`, `web/js/serial.js:60-61`.

| 키 | 현재 값 | 의미 | 영향 |
|---|---|---|---|
| `ema_alpha` | 0.2 | ws/real 모드 EMA 가중치 (`emaP_X = α·new + (1-α)·prev`) | `main.js:1505` `EMA_ALPHA`, `main.js:967/978` 적용. 시정수 ≈ 5 sample (1초 @ 5 Hz) |
| `particle_update_threshold_kpa` | 2.0 | particle target 갱신 임계값 (\|ema-last\| < 임계값 시 무시) | `main.js:1506` `PARTICLE_UPDATE_THRESHOLD_KPA`, `main.js:1570`. 작은 변동에서 시각 깜박임 회피 |
| `mock_interval_ms` | 50 | mock SensorSource interval emit 주기 (ms) | `serial.js:60` `_intervalMs`, `serial.js:87` `setInterval`. 기본 20 Hz |
| `mock_noise_sigma_kpa` | 0.1 | mock interval emit 가우시안 σ (kPa) | `serial.js:61` `_noiseSigma`, `serial.js:89`. mock 결정론 가까움 |
| `safety_timeout_extra_ms` | 1000 | 주입 애니메이션 안전 timeout 여유 (ms) | `main.js:2147` `safetyTimeoutMs = totalTimeoutMs + extra` |

**실물 도착 후 조정 가능성** (TBD — 실측 후 결정):
- `ema_alpha`: 실물 노이즈 σ ↑ → α ↓ (더 강한 평활). baseline.js 측정 결과 의존.
- `particle_update_threshold_kpa`: 실물 σ 가 quiet preset (500 Pa = 0.5 kPa) 보다 크면 임계값 ↑ 검토.
- `mock_*` 2 상수: 실물 영향 X (mock 전용). 변경 불필요.
- `safety_timeout_extra_ms`: 실물 영향 X (시뮬 본체 애니메이션).

### 4.2 syringe_a / syringe_b

| 키 | a 기본 | b 기본 | 의미 |
|---|---|---|---|
| `v_min` | 10 | 10 | 슬라이더 최소 mL |
| `v_max` | 100 | 100 | 슬라이더 최대 mL |
| `v_default` | 50 | 50 | 페이지 진입 시 기본 mL |
| `default_gas` | `"air"` | `"co2"` | 페이지 진입 시 선택된 가스 키 (gases sub-tree 의 키 참조) |

소비 — `main.js:812-824` (daltonState 초기화), `main.js:2800-2804` (입력 검증), `main.js:3418-3423` (select 채우기).

### 4.3 기타 dalton 상수

| 키 | 현재 값 | 의미 | 영향 |
|---|---|---|---|
| `debounce_ms` | 300 | 슬라이더 입력 debounce (ms) | `main.js:3494` |
| `stabilization_sec` | 5 | 주입 후 평형 카운트다운 (초) | `main.js:2700/2815` |
| `injection_animation_sec` | 3 | 주입 애니메이션 길이 (초) | `main.js:2145/2365`. `safetyTimeoutMs` 계산 base |

---

## 5. particles 섹션

별도 sub-tree 없음. **입자운동 페이지도 보일과 동일 top-level 공통 키 사용** (`particle_count`, `ghost_count`, `velocity_tau_seconds` 등).

가스 종류 (He/N₂/Ar/CO₂) 와 조작 가능 변수 (V/T/N) 는 `web/particles.html` + `main.js` 입자운동 분기에 하드코딩. params.json 별도 키 X.

---

## 5.5 vapor 섹션 (Phase 6.0~6.4 누적)

**위치**: `web/config/params.json` line 51-220 안 `vapor` sub-tree. Phase 6.1-a (commit `b3972b3`) placeholder 신설 → Phase 6.1-b finalization fixup 1~14 + 15a~15t 누적 변경 (값 튜닝 / 키 신규·폐기 사이클).

**카테고리별 키 표** (현재 값 + 의미 + 변경 history):

### 5.5.1 기본 설정

| 키 | 값 | 의미 |
|---|---|---|
| `V_flask_presets_mL` | `[100, 250, 500]` | 플라스크 부피 프리셋 |
| `V_flask_default_mL` | 250 | 페이지 진입 default |
| `V_liquid_default_mL` | 50 | 액체 부피 default |

### 5.5.2 캔버스 (모델 좌표 보존, fixup 15h/15k CSS scaling)

| 키 | 값 | 의미 |
|---|---|---|
| `canvas_width_px` | 800 | 모델 좌표 (CSS scaling 1.625× 후 display 1300, fixup 15k) |
| `canvas_height_px` | 480 | 동일 |
| `rate_canvas_width_px` | 256 | rate 그래프 캔버스 (fixup 15l max-width 100% 표시) |
| `rate_canvas_height_px` | 140 | 동일 |

### 5.5.3 분자 시각 + 표면

| 키 | 값 | 변경 history |
|---|---|---|
| `molecule_radius_px` | 4 | (fixup 04da132 입자 크기 통일 — liquid/surface/gas 모두 r=4) |
| `gas_particle_radius_px` | 4 | 동일 |
| `liquid_color` | `#1E40AF` | (fixup 8 정공법 회귀 — 반투명 단색) |
| `liquid_opacity` | 0.92 | 동일 |
| `surface_jitter_amp_px` | 2 | 표면 sinusoidal 진폭 |
| `surface_opacity` | 0.55 | (fixup 4 반투명 — 액체 격자 불투명과 시각 차별) |

### 5.5.4 온도 + 사건 게이트 (fixup 6/8/9/14/15a/15e EMA prime 진화)

| 키 | 값 | 변경 history |
|---|---|---|
| `T_default_celsius` | 25 | 페이지 진입 default |
| `T_min_celsius` | 25 | 학교 실험 정합 |
| `T_max_celsius` | 65 | 동일 |
| `T_presets_celsius` | `[25, 35, 45, 55, 65]` | 5 프리셋 |
| `reference_T_celsius` | 25 | Boltzmann factor T_ref |
| `base_evap_rate_per_particle_per_sec` | 0.010 | (fixup 11 0.025 → 0.010, 5분 평형 학교 시간 정합) |
| `E_a_normalized` | 18.3 | Boltzmann factor 활성화 에너지 |
| `E_capture` | 2.5 | 응축 게이트 |

### 5.5.5 Ghost particle (fixup 7 보일 패턴 재사용 + fixup 15k 트레이드오프)

| 키 | 값 | 변경 history |
|---|---|---|
| `ghost_surface_count` | 800 | (fixup 7 통계 √N 흡수, visible 80 + ghost 800 = 880) |
| `ghost_gas_visible_ratio` | **0.7** | (fixup 7 0.1 → fixup 10 0.2 → fixup 11 0.4 → fixup 15k 0.7. ghost 통계 흡수 손실 vs 시각 사건 풍부 트레이드오프) |

### 5.5.6 색 + 형광 (fixup 8 형광 노랑/핑크 + fixup 15o 가스 색 단일화)

| 키 | 값 | 변경 history |
|---|---|---|
| `color_KE_slow` | `#1E3A8A` | 표면 KE 매핑 slow |
| `color_KE_fast` | `#DC2626` | 표면 KE 매핑 fast |
| `color_KE_min/max_for_HSB` | 0/5 | KE → HSB lerp 범위 |
| **`gas_color`** | **`#60a5fa`** | (fixup 15o 신규 — 단일 색, KE 매핑 폐기) |
| `gas_birth_color_fluorescent` | `#FCD34D` | (fixup 8 신규 — 노랑) |
| `condense_grid_color_fluorescent` | `#F472B6` | (fixup 8 신규 — 핑크) |
| `*_hold_sec` / `*_fade_sec` | 1.5 / 0.5 | (fixup 8 형광 1.5초 hold + 0.5초 fade) |
| `*_stroke_px` | 4.5 | 형광 stroke 두께 |
| `*_glow_blur_px` | 25 | 형광 glow blur |
| `condense_pulse_radius_max_px` | 24 | (fixup 8 응결 외곽 펄스) |
| `condense_pulse_duration_sec` | 1.0 | 동일 |

### 5.5.7 화살표 (fixup 15a v4 — 매칭 폐기 + 자연 fade only)

| 키 | 값 | 변경 history |
|---|---|---|
| `evap_flash_color` | `#2563EB` | 위 화살표 (청) |
| `cond_flash_color` | `#DC2626` | 아래 화살표 (주황) — fixup 4 도입 |
| `flash_duration_sec` | 1.0 | 자연 fade |
| `flash_hold_sec` | 0.5 | hold 후 linear fade |
| `flash_arrow_length_px` | 40 | (fixup 5 30 → 40) |
| `flash_arrow_thickness_px` | 3.5 | 동일 |

(fixup 15a v1~v3 매칭 진화 시도 → v4 자연 fade only. `flash_arrow_match_*` 키 모두 폐기.)

### 5.5.8 가스 동역학

| 키 | 값 | 의미 |
|---|---|---|
| `gas_speed_scale` | 50 | KE 자연 단위 → px/s |
| `gas_velocity_damping` | 0.9995 | 마찰 |
| `gas_gravity` | 0.0005 | 약 중력 (fixup 4 추가) |
| `ceiling_KE_retention` | 0.85 | 천장 충돌 KE 보존 |

### 5.5.9 Rate 그래프 + EMA (fixup 11/13/14/15a/15e 진화)

| 키 | 값 | 변경 history |
|---|---|---|
| `rate_graph_initial_x_sec` | 180 | (fixup 11 60 → 180, 학교 시간 척도) |
| `rate_graph_max_time_sec` | 1800 | x축 자동 스케일 cap |
| `rate_calc_window_sec` | 3.0 | sliding window |
| `rate_warmup_ticks` | **2** | (fixup 14 신규 — Poisson 잡음 prime 박힘 회피, 첫 N tick 폐기) |
| `rate_ema_prime_avg_ticks` | 5 | (fixup 15a v1 신규 — fixup 15e 시작 시점 한정) |
| `rate_ema_alpha` | **0.05** | (fixup 15d 0.1 → 0.05, τ=10s → 20s 잡음 √2배 흡수) |
| `rate_color_evap` | `#2563EB` | 청 |
| `rate_color_cond` | `#EA580C` | 주황 |
| `rate_y_min` | 1.0 | 자동 스케일 최소 |
| `rate_y_auto_scale_factor` | 1.2 | 자동 스케일 비율 |

### 5.5.10 평형 5-state (fixup 13/15d/15n 진화)

| 키 | 값 | 변경 history |
|---|---|---|
| `equilibrium_ratio_min` | 0.9 | enter zone (near → detected hold 시작) |
| `equilibrium_ratio_max` | 1.1 | 동일 |
| `equilibrium_exit_ratio_min` | 0.85 | (fixup 15d hysteresis exit zone) |
| `equilibrium_exit_ratio_max` | 1.15 | 동일 |
| `equilibrium_hold_sec` | **10.0** | (fixup 15d 5 → 10, 잡음 √2배 흡수 정합) |
| `equilibrium_change_threshold` | 0.02 | (fixup 8 P_internal 변화율, real 모드 재사용 보존) |
| `equilibrium_warmup_sec` | 10 | (fixup 8 워밍업) |
| `p_internal_ema_alpha` | 0.05 | P_internal EMA |

5-state machine = `none / near / detected / confirmed / exited`. `confirmed` = 학생 [확정] 클릭 (fixup 15n dual-layer 정공법). 자세 = `docs/17-vapor-design.md` §13.

### 5.5.11 압력 게이지 (fixup 15s 그래픽화 + fixup 15k 비례 조정)

| 키 | 값 | 변경 history |
|---|---|---|
| `pressure_per_visible_gas_kPa` | **0.034** | (fixup 11 0.06 → fixup 15k 0.034 — visible_ratio 0.7 비례 조정, P 값 보존) |
| `pressure_gauge_max_kPa` | 30 | SVG 반원 압력계 max (fixup 15s) |

### 5.5.12 P-T 그래프

| 키 | 값 | 의미 |
|---|---|---|
| `pt_graph_canvas_width_px` | 380 | 측정점 영역 P-T 그래프 |
| `pt_graph_canvas_height_px` | 240 | 동일 |
| `pt_graph_T_min_celsius` | 20 | x축 |
| `pt_graph_T_max_celsius` | 70 | 동일 |
| `pt_graph_P_min_kpa` | 0 | y축 |
| `pt_graph_P_max_kpa` | 35 | 동일 |
| `pt_graph_min_points_for_curve` | 4 | (≥4 점 측정 후 곡선 연결) |

### 5.5.13 liquids.water sub-tree

| 키 | 의미 |
|---|---|
| `liquids.water.label` | "물 (H₂O)" |
| `liquids.water.p_vap_table_celsius_to_kpa` | 보간 표 (실제 물 증기압, 실측 비교 단서) |

(향후 Phase 6.7 ethanol/methanol 등 확장 — `liquids.ethanol`, `liquids.methanol` sub-tree 추가.)

### 5.5.14 폐기 키 (이력 보존)

- `pressure_to_evap_calibration` — fixup 6 도입, fixup 8 즉시 폐기 (정공법 회귀, 시뮬 P 정량 정합 시도 폐기).
- `kT_surface / E_escape / surface_KE_resample_sec` — Boltzmann 결정적 게이트 (fixup 직전), fixup 9070994 비동기 Poisson per-frame 으로 대체 폐기.
- `liquid_jitter_amp_px` — fixup 10 dead branch 제거.
- `flash_arrow_match_*` 키 — fixup 15a v1~v3 매칭 진화, v4 자연 fade only 로 모두 폐기.

cross-ref `docs/17-vapor-design.md` §6 (시뮬 명세 fixup 15+ 17 sub-section, 각 키 변경 결정 자세) + §11 결정 표 (fixup 1~17g-1 누적 53 행).

---

## 6. SCENE 좌표 상수 (코드 고정)

**돌턴 시각 좌표는 외부화 안 됨**. `web/js/main.js:1440-1493` `const SCENE = { ... }` 코드 고정.

| 그룹 | 키 | 값 | 비고 |
|---|---|---|---|
| 캔버스 | `canvasW`, `canvasH` | 1160, 600 | 게이지 overlay 공간 포함 (v3 마무리 v4 확장) |
| 본체 공통 | `bodyW`, `bodyTop`, `bodyBottom`, `bodyHeightPx` | 320, 30, 480, 450 | 본체 폭·상단·하단·높이 |
| 시린지 A | `syringeA.{centerX, bodyLeft, bodyRight}` | 360, 200, 520 | 좌측 |
| 시린지 B | `syringeB.{centerX, bodyLeft, bodyRight}` | 800, 640, 960 | 우측 |
| 노즐 | `nozzleW`, `nozzleTop`, `nozzleBottom` | 24, 480, 520 | 시린지 본체 ↔ ㄷ자 튜브 연결 |
| ㄷ자 튜브 | `tubeY`, `tubeH` | 520, 20 | 두 시린지 하단 연결 수평 |
| 피스톤 | `pistonHeadH/ShaftW/CapW/CapH/CapTopMargin` | 14/18/60/12/10 | 피스톤 모양 |
| 부피↔Y | `volumeMin`, `volumeMax` | 10, 100 (mL) | params.json `dalton.syringe_*.v_min/v_max` 와 일치 |
| 가스색 (UI fill) | `gasColors[air/co2/n2/o2/he]` | HSB tuple | params.json `dalton.gases[*].color` 와 별개 — 본체 채움용 옅은 톤 |
| 입자 | `particleSpeedScale` | 90 | 보일은 120 (코드 분리). 박스 작음에 맞춤 |
| 입자 | `particleRadius` | 3.0 | v8 에서 2.5 → 3.0 (가시성 ↑) |
| 박스 가드 | `boxMargin`, `boxMinHeight` | 2, 30 | drawSyringe fill margin 동기 / V_min 시 음수 방지 |
| 보간 | `volumeLerpFactor` | 0.15 | displayedVolume 매 frame 15% 접근 (≈0.13초 도달) |
| 물리 안정성 | `physicsSubstepMaxDtSec` | 0.005 | substep max dt = 5 ms (region 다중 통과 방지) |

**외부화 검토** — 본 좌표들은 캔버스 + 본체 모양 디자인에 종속. 변경 시 대응 픽셀 좌표 다수 영향. 외부화 가치 낮음 (Phase 5.x 디자인 변경 시 일괄 갱신이 자연스러움).

`particleSpeedScale = 90` 만 외부화 후보 (실물 데이터 반영 시 조정 가능성). 단 현 단계 보존.

---

## 7. gases 정의

`params.dalton.gases` (`main.js:1617-1621` `getGasData(gasKey)`).

### 7.1 5 종 정의

| key | label | M (g/mol) | speedFactor | color | 비고 |
|---|---|---|---|---|---|
| `air` | 공기 | 29 | 1.00 | `#1F2937` | 기준값 (M_ref) |
| `co2` | CO₂ | 44 | 0.81 | `#27AE60` | 무거움 → 느림 |
| `he` | He | 4 | 2.69 | `#E74C3C` | 가벼움 → 빠름 |
| `n2` | N₂ | 28 | 1.02 | `#3498DB` | 공기 ≈ |
| `o2` | O₂ | 32 | 0.95 | `#E67E22` | 공기 ≈ |

**speedFactor 정의**: `1/√(M/29)` (Graham 법칙). 등온 평형 시 무거운 가스는 느리게 / 가벼운 가스는 빠르게 운동. 정확 일치 (소수 둘째 자리). 결정 근거 — `docs/04-simulation-physics.md` §3 §11.

### 7.2 소비 위치

| 위치 | 사용 |
|---|---|
| `main.js:1521-1539` `addParticleToSyringe` | `gasData.speedFactor` × `SCENE.particleSpeedScale` = 입자 초기 속도 σ. `particle.M = gasData.M` 부여 |
| `main.js:2412` 입자 그리기 | `gasData.color` (HEX) → 입자 RGB |
| `main.js:2558-2593` 측정 기록 | `cfg.gases[r.gasA/B].color` → 표·범례 색 |
| `main.js:3418-3423` select 채우기 | `for (key, g) in cfg.gases`: option 렌더 |

### 7.3 새 가스 추가 절차

1. `params.json` `dalton.gases` 에 신규 키 추가:
   ```json
   "ar": { "label": "Ar", "M": 40, "speedFactor": 0.85, "color": "#9B59B6" }
   ```
   `speedFactor = 1/√(M/29)` 정확 계산 (소수 둘째 자리). Ar 의 경우 = 1/√(40/29) ≈ 0.85.
2. `SCENE.gasColors` (`main.js:1478-1484`) 에 UI fill 색 (HSB) 추가 — 본체 채움 옅은 톤. 별도 색.
3. `web/dalton.html` 의 select option HTML 에 옵션 표시 — 단 `main.js:3423` 가 `cfg.gases` 순회로 자동 채움하므로 HTML 수동 추가 불필요 (확인 필요).
4. 회귀 검증 — 신규 가스로 주입 시뮬 / CSV 기록 / AI 튜터 컨텍스트 표시 확인.

---

## 8. 실물 도착 후 캘리브레이션 갱신 흐름

`docs/19-real-sensor-integration-checklist.md` §6 권위. 본 문서는 params.json 측 갱신 키만 명시.

**현재 상태**: 캘리브 결과 (`zeroPa`, `spanPa`, `spanKPa`) 는 params.json 에 별도 키 미정의. 캘리브레이션은 **런타임 sessionStorage** + **manager 측 zero offset** (`docs/14` §3 전략 C) 으로 처리. 영구 저장 X — 페이지 새로고침 시 재캘리브 필요.

**도착 후 신규 키 검토 후보** (TBD — 실측 후 결정):
- `dalton.sensor.calibration.ch0.zero_pa` (영구 영점 — 페이지 진입 시 자동 적용 후보)
- `dalton.sensor.calibration.ch0.span_pa`, `span_kpa` (스팬 — DFRobot SEN0257 공장 캘리브 출하라 추가 확장 미사용 가능, `docs/14` §3.2)
- `dalton.sensor.calibration.ch1.*` (ch1 도 동일)

**의사결정 보류 사유**: 영구 저장 = 학생용 / 런타임 sessionStorage = 시연용. 둘 다 가치 있어 별도 결정 필요. Step I 측정 결과 + 사용 시나리오 합의 후 추가.

---

## 9. 변경 시 회귀 영향 범위

| 변경 키 | 영향 코드 | 회귀 검증 |
|---|---|---|
| top-level (`particle_count`, `ghost_count`, `*_tau_seconds`, `flash_*`, `v_max_color_factor`, `initial_*`, `baseline_*`) | `web/js/main.js`, `simulation.js`, `renderer.js` (보일·입자운동) | 보일 / 입자운동 페이지 — 시뮬 부드러움 / 박스 동기 / 히스토그램 변화 |
| `dalton.gases.*.M` | `main.js:1539` particle.M | 충돌 시 운동량 교환 정확성 — `docs/08-physics-validation.md` Graham 검증 |
| `dalton.gases.*.speedFactor` | `main.js:1523/1536/2096` 초기 속도 | M-B 분포 형태. `1/√(M/29)` 일치 검증 필수 |
| `dalton.gases.*.color` | `main.js:2412/2558/2587/2593` | 입자·표·범례 색 |
| `dalton.gases.*.label` | `main.js:1317/3418` | UI 표시명 |
| `dalton.syringe_*.v_min/v_max` | `main.js:2800-2804` 입력 검증, `SCENE.volumeMin/Max` 와 일치 필요 | 슬라이더 한계 + 시각 좌표 매핑 |
| `dalton.syringe_*.v_default` | `main.js:812-824` daltonState 초기화 | 페이지 진입 시 슬라이더 위치 |
| `dalton.syringe_*.default_gas` | `main.js:812/821` daltonState | 페이지 진입 시 선택된 가스 |
| `dalton.debounce_ms` | `main.js:3494` | 슬라이더 입력 debounce (UX) |
| `dalton.stabilization_sec` | `main.js:2700/2815` | 평형 카운트다운 (학습 흐름) |
| `dalton.injection_animation_sec` | `main.js:2145/2365` | 주입 애니메이션 + safety timeout base |
| **`dalton.sensor.ema_alpha`** ★★★ | `main.js:1505` `EMA_ALPHA` (ws/real 모드 EMA) | A-1 노이즈 quiet/normal/harsh 모드와 함께 검증 (baseline.js 측정 후) |
| **`dalton.sensor.particle_update_threshold_kpa`** ★★★ | `main.js:1506`/1570 | 입자 시각 깜박임 / 평활 trade-off |
| `dalton.sensor.mock_interval_ms` | `serial.js:60/87` mock interval | mock 모드만 영향 (ws/real 영향 X) |
| `dalton.sensor.mock_noise_sigma_kpa` | `serial.js:61/89` | mock 모드 노이즈 진폭 (ws/real 영향 X) |
| `dalton.sensor.safety_timeout_extra_ms` | `main.js:2147` | 주입 애니메이션 hang 가드 |
| `SCENE.*` (코드 고정) | `main.js:1440-1493` 직접 참조 곳 다수 | 본체 좌표 변경 시 캔버스 디자인 전체 재검토 |

**Phase 5.4 outlier 가드 상수** (`web/js/serial.js:5-15`) — 본 문서 외 (`tools/firmware-emulator/README.md` + 코드 cross-ref). `GUARD_NEGATIVE_THRESHOLD_KPA` / `GUARD_SATURATION_KPA` / `GUARD_MEDIAN_WINDOW` / `GUARD_WARN_INTERVAL_MS` — 외부화 X (실물 도착 후 조정 가치 낮음, 명백 invalid 가드).
