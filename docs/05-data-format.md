# 05. 데이터 포맷 명세

**문서 목적**: 펌웨어-브라우저 간 통신, 시뮬레이션 내부 상태, CSV 로그 파일의 데이터 포맷을 정의한다.

---

## 펌웨어 → 브라우저 (시리얼 통신)

### 전송 방식

- 프로토콜: Serial (USB-CDC), 115200 baud
- 형식: JSON, 한 줄에 하나의 측정값
- 줄바꿈 문자(`\n`)로 구분
- 한글 불필요, ASCII 범위 내

### 기본 포맷

```json
{"sensor": "<센서종류>", "value": <숫자>, "unit": "<단위>", "timestamp": <밀리초>}
```

### 필드 정의

| 필드 | 타입 | 설명 | 예시 |
|---|---|---|---|
| `sensor` | 문자열 | 센서 종류 식별자 | `"pressure"`, `"temperature"`, `"pH"` |
| `value` | 숫자 | 측정값 (스무딩 후) | `103.5`, `25.3`, `7.12` |
| `unit` | 문자열 | 단위 | `"kPa"`, `"celsius"`, `"pH"` |
| `timestamp` | 정수 | 펌웨어 기동 이후 경과 밀리초 | `12345` |

### 실전 예시

**보일 장비 (압력만)**:
```
{"sensor":"pressure","value":101.3,"unit":"kPa","timestamp":1234}
{"sensor":"pressure","value":101.5,"unit":"kPa","timestamp":1434}
{"sensor":"pressure","value":105.2,"unit":"kPa","timestamp":1634}
```

**샤를 장비 (온도만)**:
```
{"sensor":"temperature","value":22.3,"unit":"celsius","timestamp":2000}
{"sensor":"temperature","value":22.5,"unit":"celsius","timestamp":3000}
{"sensor":"temperature","value":25.8,"unit":"celsius","timestamp":4000}
```

**추후 산염기 (pH + 온도 동시)**:
```
{"sensor":"pH","value":3.42,"unit":"pH","timestamp":5000}
{"sensor":"temperature","value":24.1,"unit":"celsius","timestamp":5050}
```

### 에러 처리

- 파싱 실패 시: 해당 라인 무시, 로그에 warning 기록
- 값이 합리적 범위를 벗어날 경우: UI에 경고 표시 (예: 온도 -100°C 등)

---

## 시뮬레이션 내부 상태 (JSON)

시뮬레이션 상태를 덤프하거나 LLM에 전달할 때 쓰는 포맷.

### 보일 법칙

```json
{
  "experiment": "boyle",
  "timestamp_ms": 123456,
  "sensor": {
    "pressure_kPa": 126.5,
    "temperature_celsius": 22.3
  },
  "state": {
    "volume_mL": 40.0,
    "volume_input_by": "student",
    "particle_count": 250,
    "box_width_px": 200,
    "box_height_px": 150
  },
  "predictions": {
    "ideal_gas_pressure_kPa": 126.25,
    "deviation_kPa": 0.25
  },
  "initial_conditions": {
    "P0_kPa": 101.3,
    "V0_mL": 50.0,
    "T0_K": 295.45
  }
}
```

### 샤를 법칙

```json
{
  "experiment": "charles",
  "timestamp_ms": 234567,
  "sensor": {
    "temperature_celsius": 45.2,
    "temperature_K": 318.35
  },
  "state": {
    "volume_current_mL": 63.5,
    "volume_target_mL": 64.2,
    "particle_count": 250,
    "mean_speed_ratio": 1.043,
    "convergence_progress": 0.92
  },
  "predictions": {
    "charles_law_volume_mL": 64.25
  },
  "initial_conditions": {
    "T0_K": 295.45,
    "V0_mL": 60.0,
    "P_constant_kPa": 101.3
  }
}
```

---

## CSV 로그 포맷

세션 데이터를 두 종류 CSV로 분리해 저장한다.

| 파일 | 내용 | 헤더 언어 |
|---|---|---|
| **측정점 로그** | 학생이 `[기록]` 버튼으로 남긴 (P, V) 쌍 | 한글 (학생 분석 친화) |
| **연속 세션 로그** | 250 ms 간격 시뮬레이션 내부 상태 | 영문 snake_case (기계 처리 친화) |

### 공통 규칙

- 문자 인코딩: UTF-8, 파일 맨 앞에 BOM `﻿` 삽입 (엑셀 한글 헤더 정상 표시)
- 구분자: 쉼표
- 줄바꿈: `\n`
- 인용 부호 없음 (현재 필드에 쉼표 포함 없음)

### 파일명

```
boyle_measurements_<YYYY-MM-DD>_<HH-MM-SS>.csv
boyle_continuous_<YYYY-MM-DD>_<HH-MM-SS>.csv
```

타임스탬프는 다운로드 버튼 클릭 시각의 로컬 시간. 같은 세션에서 나온 두 파일은 측정점 로그의 `세션시작시각_iso` 열로 식별.

### 세션 시작 시점

- `sessionStartMs` 초기값 `null`
- 다음 중 **먼저 발생**하는 이벤트에서 `Date.now()`로 세팅:
  - 압력 슬라이더 조작 (향후 실센서 첫 측정값 수신)
  - `[기록]` 버튼 클릭
- `[전체 삭제]`에서 `null`로 리셋 → 다음 상호작용에서 새 세션 시작
- 세션 시작 전에는 연속 로그 버퍼에 아무것도 쌓이지 않음

### 측정점 로그 — 헤더와 필드

```
번호,압력_kPa,부피_mL,P·V,기록시각_ms,세션시작시각_iso,온도_K
```

- `번호`: 고유 id (표의 `#` 열과 일치). 삭제 후에도 번호 재배정 없음.
- `압력_kPa`: 기록 시점 직전 1 초의 `smoothedP` 이동평균
- `부피_mL`: 기록 시점 직전 1 초의 `box.width` 이동평균 → `pixelsToML` 환산. 단, 학생이 V 입력 필드를 편집했으면 학생 값 그대로.
- `P·V`: 압력 × 부피
- `기록시각_ms`: `Date.now() - sessionStartMs`
- `세션시작시각_iso`: ISO 8601. 모든 행 동일 (세션 식별자).
- `온도_K`: 기록 시점의 `currentTempKelvin()`. 온도 변경 시 datapoints 전체 초기화되므로 한 파일 내 모든 행이 같은 값.

예시:
```
번호,압력_kPa,부피_mL,P·V,기록시각_ms,세션시작시각_iso,온도_K
1,101.3,50.0,5065.0,12500,2026-04-21T06:30:15.123Z,298.15
2,130.5,38.8,5063.4,34200,2026-04-21T06:30:15.123Z,298.15
```

### 연속 세션 로그 — 헤더와 필드

```
timestamp_ms,P_kPa,V_mL,box_width_px,mean_speed_px_per_s,piston_collisions_per_s,stabilized,temperature_K
```

- `timestamp_ms`: 세션 시작부터 경과 ms
- `P_kPa`: 샘플링 시점의 `smoothedP` (실시간)
- `V_mL`: `pixelsToML(box.width)`
- `box_width_px`: `box.width` 원값
- `mean_speed_px_per_s`: 실제 입자 RMS 속력 (`system.getAverageSpeed()`)
- `piston_collisions_per_s`: 직전 250 ms의 피스톤 충돌 빈도 (초당 환산)
- `stabilized`: 해당 시점의 안정화 플래그 (`true`/`false`). 슬라이더 조작 중 `false`, 1 초 안정 후 `true`.
- `temperature_K`: 샘플링 시점의 `currentTempKelvin()`. 온도 변경 시 연속 로그 전체 초기화되므로 한 파일 내 같은 값.

예시:
```
timestamp_ms,P_kPa,V_mL,box_width_px,mean_speed_px_per_s,piston_collisions_per_s,stabilized,temperature_K
250,101.30,50.00,600.0,172.1,85.0,true,298.15
500,101.30,50.00,600.0,171.9,84.5,true,298.15
12750,125.34,40.12,481.4,172.3,110.8,false,298.15
13000,127.00,39.85,478.2,172.1,112.3,true,298.15
```

### 연속 로그 버퍼 관리

- 메모리 내 배열. 상한 **10 000 행** (≈ 42 분 상당).
- 초과 시 가장 오래된 행부터 `shift`, 콘솔에 1회 경고.
- 경고 플래그는 `[전체 삭제]`에서 함께 리셋.

### 샤를·산염기 CSV (v1.1 이후)

샤를 법칙과 산염기 실험도 동일한 두-파일 스킴을 따른다. 각 실험 구현 시 이 문서에 해당 실험의 측정점/연속 로그 헤더를 추가한다.

설계 의도 (잠정):
- **샤를 측정점 로그**: `번호, 온도_K, 부피_mL, V/T, 기록시각_ms, 세션시작시각_iso`
- **샤를 연속 세션 로그**: `timestamp_ms, T_K, V_mL, box_width_px, mean_speed_px_per_s, wall_collisions_per_s, stabilized`
- **산염기 측정점 로그**: `번호, pH, 부피_mL, 기록시각_ms, 세션시작시각_iso` (또는 pKa 관련 파생값 추가)

### 이벤트 로그 / LLM 대화 로그 (v2)

LLM 튜터 도입 시:
- `events_<YYYY-MM-DD>_<HH-MM-SS>.csv`: 단계 전환, 튜터 개입, 학생 입력 등 이벤트
- `chat_<YYYY-MM-DD>_<HH-MM-SS>.json`: LLM 턴별 대화 내역

v2 설계 시 상세 정의.

---

## 설정 파일 포맷

### params.json (현 구현)

`web/config/params.json` — 단일 평탄 구조. 원래 설계의 `simulation.json` + `experiments.json` 계층 분리는 v1.1 이후로 유보.

```json
{
    "particle_count": 300,
    "ghost_count": 2700,
    "velocity_tau_seconds": 0.05,
    "volume_tau_seconds": 0.5,
    "pressure_smooth_window_sec": 0.3,
    "temperature_smooth_window_sec": 2.0,
    "collision_smooth_window_sec": 1.0,
    "flash_duration_sec": 0.12,
    "flash_initial_alpha": 120,
    "v_max_color_factor": 2.0,
    "initial_pressure_kPa": 101.3,
    "initial_volume_mL": 30.0,
    "initial_temperature_K": 298.15,
    "piston_face": "right",
    "baseline_gas_width_px": 600,
    "baseline_volume_mL": 50
}
```

**필드 분류**:

| 분류 | 필드 | 용도 |
|---|---|---|
| 시뮬 입자 | `particle_count`, `ghost_count` | 실입자 / 유령 입자 개수 |
| 시정수 | `velocity_tau_seconds`, `volume_tau_seconds` | 지수 수렴 속도 |
| 스무딩 (유보) | `pressure_smooth_window_sec`, `temperature_smooth_window_sec`, `collision_smooth_window_sec` | 미사용 |
| 시각화 | `flash_duration_sec`, `flash_initial_alpha`, `v_max_color_factor` | 섬광·색상 |
| 초기값 | `initial_pressure_kPa`, `initial_temperature_K` | 기준 P₀, T₀ |
| 부피 환산 | `baseline_gas_width_px`, `baseline_volume_mL` | pixelsToML |
| 유기 | `initial_volume_mL`, `piston_face`, `flash_initial_alpha` | 현 구현 미사용, 레거시 또는 재활용 대기 |

**코드 내 상수**와의 분담: UI·물리 구조 관련 값은 `simulation.js` / `renderer.js` / `main.js` 모듈 상수로 두고, params.json은 **초기값·튜닝 가능 수치**만 담는다. 상세 매핑은 `04-simulation-physics.md` §11 참고.

### 실험별 상수 (v1.1+)

샤를·산염기 실험 추가 시 `experiments.json` 도입 계획:
- 샤를: `default_chamber_volume_mL`, `default_syringe_volume_mL`
- 산염기: Ka 값, pH 범위
- 반데르발스 계수 (기체별): v2 교육 활용 시

---

## 단위 규약

모든 코드에서 다음 단위를 표준으로 쓴다:

- 압력: **kPa** (절대압)
- 온도: 계산용 **K**, 표시용 **°C**
- 부피: **mL**
- 시간: 내부 **ms**, 표시 **s**
- 각도: **radian** (내부), **degree** (표시)

단위 혼동 방지를 위해 변수명에 단위 명시 권장:
- 좋은 예: `temperature_K`, `pressure_kPa`, `volume_mL`
- 나쁜 예: `temperature`, `p`, `v`

---

## 미결정 사항

- LLM API 요청/응답 포맷: `07-llm-tutor.md` (추후)
- 산염기 실험 센서 데이터: 산염기 설계 완료 시 추가
