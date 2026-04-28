# 14. 캘리브레이션 후처리 파이프라인 명세

**문서 목적**: 영점(zero) 보정의 전체 경로를 정의하고, 보일 측 미완성 부분(p0 ACK만 수신, 데이터 적용 없음)을 동시에 해결하는 설계.

**마지막 업데이트**: 2026-04-27 (Phase 5.4 Step I-pre-3).

---

## 1. 현재 상태 (보일 — phase3-real-sensor)

```
[사용자 클릭 🎯] → sendCalib()
    → 펌웨어/에뮬레이터: state.p0 = 현재 pressurePa
    → ACK: {"t":"c","p0":101325}
    → protocol.js: emitEvent("calibrated", 101.3)
    → UI: "p₀ = 101.3 kPa" 표시
    → ⛔ 끝. 데이터 프레임에서 p0를 빼는 코드 없음.
```

**문제**: 캘리브 값을 기록만 하고 실제 보정에 사용하지 않음.

---

## 2. 보정 전략 선택

### 선택지

| 전략 | 설명 | 장단점 |
|------|------|--------|
| A. 펌웨어 측 보정 | 펌웨어가 `p0` 저장 후 `p - p0 + 101325` 전송 | 정확하지만 펌웨어 복잡도 증가, 에뮬레이터와 실 펌웨어 동기 필요 |
| B. 브라우저 측 보정 | 파서/매니저에서 `data.value -= (p0 - 101.3)` | 펌웨어 변경 불필요, 로직 한 곳 집중 |
| **C. 하이브리드** | 펌웨어는 raw 전송 유지, 브라우저에서 보정 + 원본 보존 | **채택** |

### 채택: 전략 C — 브라우저 측 보정, 원본 보존

**근거**:
- 펌웨어는 단순할수록 안정적 (MCU 리소스 절약)
- 에뮬레이터·실 펌웨어 간 프로토콜 동일성 유지 용이
- 교육 맥락: 학생에게 "보정 전/후" 차이를 보여주는 것도 학습 가치
- raw 값 보존 → CSV 로그에 보정 전 원본 기록 가능

---

## 3. 보정 파이프라인 설계

→ `params.json` 측 신규 키 (calibration 영구 저장 등) 검토 (TBD — Step I 측정 후 결정) = `docs/15-params-config-guide.md` §8.

### 3.1 데이터 흐름

```
펌웨어 raw p (Pa)
    ↓
protocol.js: p/1000 → kPa (기존)
    ↓
data frame: { ..., value: rawKPa, ch: 0 }
    ↓
SensorManager 보정 레이어 (신규)
    ↓
    ├─ calibrated value: rawKPa - offset[ch]
    ├─ raw value 보존: data.raw_kPa = rawKPa
    ↓
소비자 (main.js / dalton UI)
```

### 3.2 보정 모델

**Zero offset 보정** (1차):

```
offset[ch] = p0[ch] - P_atm
calibrated = raw - offset[ch]
```

- `p0[ch]`: 캘리브 시점의 raw 압력 (kPa)
- `P_atm`: 표준 대기압 기준값 (101.325 kPa, 또는 사용자 지정)
- 캘리브 시점에 센서가 대기압 노출 상태여야 함 (절차 가이드 필요)

**예시**: 센서가 대기압에서 102.1 kPa 를 읽음
- `p0 = 102.1`, `P_atm = 101.3`
- `offset = 102.1 - 101.3 = 0.8`
- 이후 `raw = 205.0` → `calibrated = 205.0 - 0.8 = 204.2`

**Span 보정 (현 단계 미구현)**:

DFRobot SEN0257 은 공장 캘리브 출하이므로 span 보정은 불필요.
추후 센서 노후화 시 2점 보정(zero + reference) 도입 가능하나 Phase 5.4 범위 외.

### 3.3 SensorManager 보정 레이어 구현 위치

```js
// createSensorManager 내부
const calibOffsets = {};  // { [ch]: offset_kPa }

function applyCalibration(data) {
    const ch = data.ch ?? 0;
    const offset = calibOffsets[ch] ?? 0;
    return {
        ...data,
        raw_kPa: data.value,          // 원본 보존
        value: data.value - offset,   // 보정값으로 교체
    };
}

// onData 등록 시 보정 레이어 삽입
source.onData(rawData => {
    const calibrated = applyCalibration(rawData);
    for (const cb of this._dataCallbacks) cb(calibrated);
});

// calibrated 이벤트 수신 시 offset 갱신
source.on("calibrated", (payload) => {
    const ch = (typeof payload === "object") ? payload.ch : 0;
    const p0 = (typeof payload === "object") ? payload.p0kPa : payload;
    calibOffsets[ch] = p0 - P_ATM;
});
```

---

## 4. 채널별 독립 캘리브

### 돌턴 시나리오

1. 실험 시작 전, 주사기 A·B 모두 대기에 개방
2. 사용자가 "ch 0 캘리브" → B 센서 영점 설정
3. 사용자가 "ch 1 캘리브" → A 센서 영점 설정
4. 또는 "전체 캘리브" → 양쪽 동시

### UI 흐름

```
[🎯 전체 캘리브]  → sendCalib()        → 펌웨어: 모든 ch p0 설정 → ACK × N
[🎯 ch0 캘리브]   → sendCalib(0)       → 펌웨어: ch0만 → ACK × 1
[🎯 ch1 캘리브]   → sendCalib(1)       → 펌웨어: ch1만 → ACK × 1
```

### 캘리브 상태 표시 (채널별)

```
ch 0 (B-receiver): p₀ = 101.3 kPa ✓
ch 1 (A-injector): p₀ = 101.5 kPa ✓
```

미캘리브 채널은 `"미보정"` 표시 + 주의 아이콘.

---

## 5. CSV 로그 반영

### 보정 전/후 동시 기록

```csv
timestamp,ch,raw_kPa,calibrated_kPa,T_celsius
12345,0,102.1,101.3,25.0
12345,1,101.8,101.3,25.0
```

교육 맥락: "센서 raw 값과 보정 값이 왜 다른가?"를 탐구 소재로 활용 가능.

---

## 6. 보일 측 미완성 해결 방안

보일 실험(`web/js/main.js`) 에도 동일 보정 파이프라인 적용:

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| `sensorManager.onData` 수신값 | raw (보정 없음) | 보정 완료값 (`value`), 원본 (`raw_kPa`) |
| 캘리브 클릭 효과 | UI 표시만 | `calibOffsets[0]` 갱신 → 이후 데이터 자동 보정 |
| 추가 코드 | 없음 | 없음 (manager 내부 처리, 소비자 코드 변경 불필요) |

기존 보일 코드가 `data.value`를 읽는 부분은 변경 없이 보정된 값을 자동으로 받게 됨.

---

## 7. 구현 순서

1. `createSensorManager` 에 `calibOffsets` + `applyCalibration` 추가
2. `"calibrated"` 이벤트 핸들러에서 offset 갱신
3. `MockSensorSource.sendCalib()` 에서 채널별 p0 emit
4. `protocol.js` — `"t":"c"` 에 `ch` 파싱 추가
5. 에뮬레이터 — `"calib"` 에 `ch` 처리 추가
6. UI — 캘리브 상태 채널별 표시
7. CSV logger — raw/calibrated 컬럼 추가
