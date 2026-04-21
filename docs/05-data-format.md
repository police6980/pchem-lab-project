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

실험 종료 시 CSV 파일로 저장, 학생/교사가 분석 가능.

### 파일명 규칙

```
<experiment>_<YYYYMMDD>_<HHMMSS>_<student-id-optional>.csv
```

예: `boyle_20260501_143025.csv`, `charles_20260501_145533_studentA.csv`

### 보일 법칙 CSV

```csv
timestamp_ms,sensor_pressure_kPa,volume_mL,ideal_prediction_kPa,deviation_kPa,event
0,101.3,50.0,101.3,0.0,start
200,101.4,50.0,101.3,0.1,
400,101.3,50.0,101.3,0.0,
600,105.2,48.0,105.5,-0.3,volume_changed
...
12500,253.1,20.0,253.25,-0.15,volume_changed
13000,253.0,20.0,253.25,-0.25,
...
30000,,,,,end
```

**필드 설명**:
- `timestamp_ms`: 실험 시작 이후 경과 시간
- `sensor_pressure_kPa`: 센서 측정 절대압 (대기압 보정 후)
- `volume_mL`: 학생이 입력한 현재 부피
- `ideal_prediction_kPa`: 이상기체 법칙 예측값
- `deviation_kPa`: 센서값 - 예측값
- `event`: 특정 이벤트 표시 (start, volume_changed, end 등)

### 샤를 법칙 CSV

```csv
timestamp_ms,sensor_temperature_celsius,sensor_temperature_K,simulation_volume_mL,target_volume_mL,charles_prediction_mL,event
0,22.3,295.45,60.0,60.0,60.0,start
1000,22.3,295.45,60.0,60.0,60.0,
5000,35.6,308.75,60.5,62.7,62.7,placed_in_warm_water
10000,48.2,321.35,62.8,65.3,65.3,
20000,58.4,331.55,65.5,67.3,67.3,
30000,58.7,331.85,67.2,67.4,67.4,equilibrium_near
...
```

### 공통 이벤트 로그 (별도 파일)

`events_<timestamp>.csv`:
```csv
timestamp_ms,event_type,description
0,experiment_start,"Boyle experiment started"
500,initial_condition_set,"V0=50mL, P0=101.3kPa, T0=295.45K"
3200,student_input,"Volume changed to 40mL"
8500,ai_tutor_question,"Why does pressure increase?"
8600,ai_tutor_response,"Think about particle collisions..."
```

### 대화 로그 (LLM 상호작용)

`chat_<timestamp>.json`:
```json
[
  {
    "timestamp_ms": 8500,
    "role": "context",
    "content": "<시뮬레이션 상태 JSON>"
  },
  {
    "timestamp_ms": 8600,
    "role": "student",
    "content": "왜 압력이 갑자기 높아지죠?"
  },
  {
    "timestamp_ms": 9100,
    "role": "tutor",
    "content": "부피가 줄어들었는데 입자 수는 그대로죠. 지금 화면에서 입자가 벽에 부딪히는 빈도를 한번 관찰해볼까요?"
  }
]
```

---

## 설정 파일 포맷

### simulation.json

`web/config/simulation.json`:

```json
{
  "particle": {
    "default_count": 250,
    "render_radius": 4,
    "velocity_distribution": "maxwell-boltzmann"
  },
  "convergence": {
    "velocity_tau_seconds": 0.05,
    "volume_tau_seconds": 0.5
  },
  "smoothing": {
    "pressure_window_size": 5,
    "temperature_window_size": 10,
    "pH_window_size": 5
  },
  "visualization": {
    "show_velocity_color": true,
    "show_collision_flash": true,
    "box_aspect_ratio": 1.5
  },
  "reference": {
    "temperature_K": 293.15,
    "pressure_kPa": 101.3
  }
}
```

### experiments.json

실험별 상수 (Ka, 반데르발스 계수 등):

```json
{
  "boyle": {
    "default_syringe_volume_mL": 50,
    "max_pressure_kPa": 1000
  },
  "charles": {
    "default_chamber_volume_mL": 60,
    "default_syringe_volume_mL": 10
  },
  "gases": {
    "air": {
      "vdw_a": 1.4,
      "vdw_b": 0.039
    },
    "CO2": {
      "vdw_a": 3.64,
      "vdw_b": 0.0427
    }
  }
}
```

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
