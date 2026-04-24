# 05. 데이터 포맷 명세

**문서 목적**: 펌웨어-브라우저 간 통신, 시뮬레이션 내부 상태, CSV 로그 파일의 데이터 포맷을 정의한다.

**마지막 업데이트**: 2026-04-24 (v1.1 wire 포맷 실제 구현과 정합화 — Pa 정수, 센서명/FW 라벨, calib ACK 단위, cfg rate 범위)

---

## 펌웨어 ↔ 브라우저 (시리얼 통신)

### 전송 방식

- 프로토콜: Serial (USB-CDC), 115200 baud
- 형식: JSON, 한 줄에 하나의 메시지
- 줄바꿈 문자(`\n`)로 구분
- 한글 불필요, ASCII 범위 내

프로토콜은 두 개 버전이 공존한다. 레거시 펌웨어(단방향, 데이터 전용) 호환을 위해 **v1.0**을 유지하며, **v1.1**부터 타입 필드 `t`를 도입해 양방향·다중 메시지 타입을 지원한다. 신규 펌웨어는 v1.1 권장.

---

### v1.0 (레거시) — 단일 포맷, 펌웨어 → 브라우저

**기본 포맷**

```json
{"sensor": "<센서종류>", "value": <숫자>, "unit": "<단위>", "timestamp": <밀리초>}
```

**필드 정의**

| 필드 | 타입 | 설명 | 예시 |
|---|---|---|---|
| `sensor` | 문자열 | 센서 종류 식별자 | `"pressure"`, `"temperature"`, `"pH"` |
| `value` | 숫자 | 측정값 (스무딩 후) | `103.5`, `25.3`, `7.12` |
| `unit` | 문자열 | 단위 | `"kPa"`, `"celsius"`, `"pH"` |
| `timestamp` | 정수 | 펌웨어 기동 이후 경과 밀리초 | `12345` |

**실전 예시**

보일 장비 (압력만):
```
{"sensor":"pressure","value":101.3,"unit":"kPa","timestamp":1234}
{"sensor":"pressure","value":101.5,"unit":"kPa","timestamp":1434}
{"sensor":"pressure","value":105.2,"unit":"kPa","timestamp":1634}
```

샤를 장비 (온도만):
```
{"sensor":"temperature","value":22.3,"unit":"celsius","timestamp":2000}
{"sensor":"temperature","value":22.5,"unit":"celsius","timestamp":3000}
{"sensor":"temperature","value":25.8,"unit":"celsius","timestamp":4000}
```

산염기 (pH + 온도 동시):
```
{"sensor":"pH","value":3.42,"unit":"pH","timestamp":5000}
{"sensor":"temperature","value":24.1,"unit":"celsius","timestamp":5050}
```

**에러 처리**

- 파싱 실패 시: 해당 라인 무시, 로그에 warning 기록
- 값이 합리적 범위를 벗어날 경우: UI에 경고 표시 (예: 온도 -100°C 등)
- v1.0에는 펌웨어→브라우저 방향만 존재. 캘리브레이션·설정 등 역방향 제어 없음.

---

### v1.1 — 타입 필드 `t` 도입 (양방향)

메시지 식별자 `t`를 최상위에 두고, 타입별로 서로 다른 페이로드를 싣는다. 브라우저는 `t` 값에 따라 라우팅하며, 알 수 없는 `t`는 무시하고 경고 로그만 남긴다.

**단위 규약 (정식)**: v1.1 선로(wire)는 **압력을 Pa 정수**, 온도는 `°C` float, 시간은 ms 정수로 싣는다(정수 연산이 펌웨어에 유리 + 소수 오차 제거). 브라우저 측 공통 파서(`web/js/protocol.js`)가 `p/1000` 으로 kPa 환산해 UI·로그에 전달. 시뮬레이션/측정 기록 내부 단위는 기존대로 **kPa / °C / mL**. v1.0 레거시 포맷(`sensor/value/unit/timestamp`, kPa float)도 파서가 수용하지만 신규 펌웨어는 v1.1 필수.

#### 펌웨어 → 브라우저

**(1) `"t":"d"` — 데이터 프레임** (정식, Pa 정수)

```json
{"t":"d","p":101325,"T":25.0,"ts":12345}
```

| 필드 | 타입 | 단위 | 설명 |
|---|---|---|---|
| `t`  | string  | — | `"d"` 고정 |
| `p`  | integer | Pa | 압력 정수 (현재 펌웨어 0 ~ 1,600,000, 에뮬레이터 81,000 ~ 400,000) |
| `T`  | number  | °C | 온도 float (펌웨어 현재 25.0 고정, 별도 온도센서 도입 시 실제값) |
| `ts` | integer | ms | 펌웨어 부팅 이후 경과 밀리초 |

주기적 측정값 스트림. 기본 주기 200 ms (5 Hz), `cfg` 메시지로 조정 가능.

**(1b) 레거시 데이터 프레임 (v1.0 호환)** — 파서 수용, 신규 펌웨어는 사용 금지

```json
{"t":"d","sensor":"pressure","value":101.3,"unit":"kPa","timestamp":12345}
```

또는 `t` 필드 없는 v1.0 원본. `protocol.js` 가 `msg.p` 부재 시 `msg.value` 로 폴백해 호환. 새 펌웨어가 이 포맷을 내보낼 이유는 없으며, 장기적으로 제거 대상.

**(2) `"t":"s"` — 상태/연결** (hello + heartbeat)

```json
{"t":"s","sensor":"DFRobot-1.6MPa","fw":"1.1.0-real"}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `sensor` | 문자열 | 센서 모델명. 현재 실물·에뮬레이터 모두 `"DFRobot-1.6MPa"` 로 통일 (구분은 `fw` 라벨로). 타 장비 예: `"DS18B20"` (온도) 등 |
| `fw` | 문자열 | 펌웨어 버전. 실물 `"1.1.0-real"`, 에뮬레이터 `"1.1.0-emulator"` 로 실물/가상 구분 |

연결 직후 최초 1회 전송 (hello 핸드셰이크). 이후 30 초 주기 heartbeat 선택 사항(현 구현 미전송). 브라우저는 이 메시지로 연결 성공 판정 및 센서 라벨 표시.

**(3) `"t":"c"` — 캘리브레이션 ACK**

```json
{"t":"c","p0":101325}
```

| 필드 | 타입 | 단위 | 설명 |
|---|---|---|---|
| `p0` | integer | Pa | 영점 보정 후 기준 압력 (데이터 프레임 `p` 와 동일 단위) |

브라우저의 `"t":"calib"` 요청에 대한 응답. `protocol.js` 가 `p0 / 1000` 으로 kPa 환산해 UI에 `p₀ = 101.3 kPa` 로 표시. 캘리브레이션 성공 시에만 ACK 전송.

**(4) `"t":"e"` — 에러**

```json
{"t":"e","msg":"overflow"}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `msg` | 문자열 | 짧은 에러 식별자. 예: `"overflow"`, `"sensor_disconnected"`, `"nvs_fail"` |

센서·I²C·플래시 등 펌웨어 측 오류. 브라우저는 UI에 경고 표시.

#### 브라우저 → 펌웨어

**(1) `{"t":"ping"}` — keep-alive**

```json
{"t":"ping"}
```

브라우저 `WebSerialSensorSource` / `WebSocketSensorSource` 가 2 초 주기로 송신. 현재 구현은 펌웨어·에뮬레이터가 **무응답 소비** (TCP/시리얼 keep-alive 역할만). 원래 설계 의도는 응답으로 `"t":"s"` 재송신이었으나 현 단계에선 불필요해 생략 — 이후 heartbeat 필요 시 도입.

**(2) `{"t":"calib"}` — 캘리브레이션 요청**

```json
{"t":"calib"}
```

영점 보정 개시. 펌웨어(실물)·에뮬레이터 모두 수신 시 현재 측정 압력을 `p0`(Pa 정수)으로 저장하고 `"t":"c"` ACK 로 응답.

**(3) `{"t":"cfg","rate":200}` — 리포트 주기 설정**

```json
{"t":"cfg","rate":200}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `rate` | 정수 | 데이터 프레임 송신 주기 (ms). 유효 범위 **50 ~ 5000 ms** |

수신 측은 `rate` 저장 후 새 주기로 `"t":"d"` 송신. 범위 밖 값은 무시하고 기존 주기 유지 + 경고 로그. 별도 ACK 없음 (조용한 적용).

#### 버전 협상

연결 직후 펌웨어가 `"t":"s"` 를 먼저 보내면 브라우저는 v1.1로 판정. `sensor` 필드만 단독으로 오는 데이터가 먼저 도착하면 v1.0 모드로 폴백. 같은 연결 내 두 버전 혼용 금지.

---

## 시뮬레이션 내부 상태 (JSON)

시뮬레이션 상태를 덤프하거나 AI 튜터 컨텍스트로 전송할 때 쓰는 포맷. Phase 2-B(AI 튜터 실 API 연동) 완료 이후 `buildDataContext()` 기반으로 대화 컨텍스트에 포함된다.

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
    "particle_count": 300,
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
    "particle_count": 300,
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

### 분석 보고서 CSV (Part 3.5 확정)

측정점이 3개 이상일 때 `#section-analysis`의 **[분석 보고서 저장]** 버튼으로 단일 파일 다운로드. `buildAnalysisCSV()`가 생성. 단일 CSV 안에 **주석 헤더(`# == ... ==`)로 분리된 다중 섹션** 구조.

**파일명**:
```
boyle_analysis_<YYYY-MM-DD>_<HH-MM-SS>.csv
```

**전체 구조**:
```
# 보일 법칙 실험 분석 보고서
# 저장 시각: <ISO>
# 세션 시작: <ISO>

# == 실험 조건 ==
항목,값
온도_섭씨,<값>
온도_켈빈,<값>
기준_압력_kPa,101.3
기준_부피_mL,50.0

# == 요약 통계 ==
항목,값
측정점_개수,<N>
평균_PV,<값>
최대_편차_퍼센트,<값>
기록_소요_시간_초,<값>
법칙_검증_판정,<문자열>

# == 측정점 ==
번호,압력_kPa,부피_mL,P·V,편차_퍼센트,기록시각_ms,온도_K
<측정점 행들>

# == AI 튜터 대화 ==            ← 대화가 1개 이상 있을 때만 포함
주제,순번,역할,내용,모델,토큰입력,토큰출력
<대화 메시지 행들>
```

**§ "AI 튜터 대화" 필드 정의**:

| 필드 | 타입 | 설명 |
|---|---|---|
| `주제` | 문자열 | `"Q1"` · `"Q2"` · `"Q3"` · `"자유"` |
| `순번` | 정수 | 해당 주제 내 메시지 순서 (1부터) |
| `역할` | 문자열 | `"user"` (학생) · `"assistant"` (AI) |
| `내용` | 문자열 | 메시지 본문 (CSV 이스케이프 적용 — 쌍따옴표·쉼표·줄바꿈 포함 시 `"..."` 인용) |
| `모델` | 문자열 | assistant 메시지에만 값 (예: `claude-sonnet-4-6`, `dummy-mode`). user 메시지는 공란 |
| `토큰입력` | 정수 | assistant 메시지만 |
| `토큰출력` | 정수 | assistant 메시지만 |

출력 순서: Q1 → Q2 → Q3 → 자유. 각 주제 안에서는 메시지 순서(시간순).

**예시**:
```
# == AI 튜터 대화 ==
주제,순번,역할,내용,모델,토큰입력,토큰출력
Q1,1,user,"부피가 줄면 입자들이 벽에 부딪히는 횟수가 많아져서...",,,
Q1,2,assistant,"**좋은 관찰이에요.** 한 걸음 더 들어가볼까요?...",claude-sonnet-4-6,280,195
자유,1,user,"입자 색깔이 왜 다른가요?",,,
자유,2,assistant,"속도를 HSB로 매핑했어요...",claude-sonnet-4-6,215,180
```

**주의**:
- 현재(Part 3.5)는 AI 응답이 `dummy-mode` 모델의 더미. **실 Anthropic 응답은 Phase 2-B 완료 후부터 포함됨**
- 대화 히스토리는 sessionStorage가 아닌 **메모리 내 `aiConversations`에만 존재** — 페이지 새로고침 시 손실
- `[전체 삭제]` / 온도 변경 시 `resetAllConversations()`로 일괄 초기화 (CSV로 저장하지 않은 대화는 사라짐)

### 샤를·산염기 CSV (v1.1 이후)

샤를 법칙과 산염기 실험도 동일한 두-파일 스킴을 따른다. 각 실험 구현 시 이 문서에 해당 실험의 측정점/연속 로그 헤더를 추가한다.

설계 의도 (잠정):
- **샤를 측정점 로그**: `번호, 온도_K, 부피_mL, V/T, 기록시각_ms, 세션시작시각_iso`
- **샤를 연속 세션 로그**: `timestamp_ms, T_K, V_mL, box_width_px, mean_speed_px_per_s, wall_collisions_per_s, stabilized`
- **산염기 측정점 로그**: `번호, pH, 부피_mL, 기록시각_ms, 세션시작시각_iso` (또는 pKa 관련 파생값 추가)

### AI 튜터 대화 로그 (Part 3.5 부분 구현)

**상태**: 대화 UI 및 CSV 저장 형식은 Part 3.5에서 구현됨. 대화는 위 **§분석 보고서 CSV** 의 `# == AI 튜터 대화 ==` 섹션으로 통합 저장된다 — 별도 `chat_*.json` 파일을 만들지 않는다. 실제 Anthropic API 호출 교체는 Phase 2-B에서 완료됨.

### 이벤트 로그 (v2, 미구현)

Phase 6 교사 대시보드 도입 시:
- `events_<YYYY-MM-DD>_<HH-MM-SS>.csv`: 단계 전환, 튜터 개입, 학생 입력 등 이벤트 타임라인
- 포맷은 해당 Phase 설계 시 확정

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

## 확정 / 미결정

**확정 (Part 3.5):**
- AI 제공자: **Anthropic Claude** (BYOK 패턴, 브라우저 직접 호출, `anthropic-dangerous-direct-browser-access` 헤더)
- API 키 저장: **sessionStorage** (`pchem_api_key`) — 메모리·탭 스코프, 탭 종료 시 소실
- 대화 저장 방식: 메모리 내 `aiConversations` 객체(4 세션), CSV는 분석 보고서에 통합

**미결정:**
- AI API 요청/응답 상세 포맷: Phase 2-B에서 확정 완료. 상세는 `docs/07-ai-tutor.md` 참조
- 산염기 실험 센서 데이터: 산염기 설계 완료 시 추가
- 교사 대시보드 이벤트 로그 포맷: Phase 6
