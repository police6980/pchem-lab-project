# 13. SensorSource 멀티채널 인터페이스 설계

**문서 목적**: 단일채널 SensorSource 추상화를 멀티채널로 확장하는 SW 설계 명세.

**마지막 업데이트**: 2026-04-27 (Phase 5.4 commit iv).

**설계 원칙**:
- 기존 보일 코드 변경 최소화 (ch 필드 추가만, 기존 콜백 시그니처 유지)
- 채널 필터링은 소비자(caller) 선택, SensorSource 자체는 모든 데이터 relay
- manager 패턴 유지 (mock/ws/real 모드 전환 + 콜백 재배선)

---

## 1. 데이터 프레임 확장

### 현재 (v1.1)

```js
// onData 콜백이 받는 객체
{ sensor: "pressure", value: 101.3, unit: "kPa", timestamp: 12345 }
```

### 변경 (v1.2)

```js
// ch 필드 추가. 생략 시 0 (하위 호환).
{ sensor: "pressure", value: 101.3, unit: "kPa", timestamp: 12345, ch: 0 }
{ sensor: "pressure", value: 203.4, unit: "kPa", timestamp: 12345, ch: 1 }
```

**변경점**: `ch` 프로퍼티 하나 추가. 기존 소비자는 `ch`를 무시하면 그대로 동작.

---

## 2. SensorSource 추상 클래스 변경

```js
class SensorSource {
    // 기존 — 변경 없음
    onData(callback)          // cb({ sensor, value, unit, timestamp, ch })
    on(type, callback)        // "connect" | "disconnect" | "calibrated" | "error"
    connect() / disconnect()
    sendCalib()               // → sendCalib(ch?)  시그니처 확장
    sendConfig(rateMs)

    // 신규
    getChannels()             // → [{ch, sensor, label}] 또는 null (v1.1)
}
```

| 메서드 | 변경 | 설명 |
|--------|------|------|
| `onData(cb)` | 프레임에 `ch` 추가 | 콜백 시그니처는 동일, 객체에 필드 하나 추가 |
| `sendCalib(ch?)` | 인자 추가 (optional) | 생략 시 전체 채널 |
| `getChannels()` | 신규 | hello 수신 후 채널 목록 반환 |
| `on("connect", cb)` | payload 확장 | `info.channels` 배열 추가 (v1.2일 때) |

---

## 3. 구현 클래스별 변경

### MockSensorSource

```js
class MockSensorSource extends SensorSource {
    constructor(config) {
        // config.channels = [{ch: 0, pressure: 101.3}, {ch: 1, pressure: 101.3}]
        // 생략 시 [{ch: 0, pressure: 101.3}] (보일 호환)
    }
    setPressure(value, ch = 0)   // ch 파라미터 추가
}
```

- 채널별 독립 압력 값 유지
- 각 채널 독립 노이즈 생성
- 단일 setInterval 에서 모든 채널 순회 emit

### WebSocketSensorSource

- `parseV11Line` 이 `ch` 를 프레임에 포함시키므로 별도 변경 불필요
- `getChannels()`: hello 수신 시 `info.channels` 저장 후 반환

### WebSerialSensorSource

- 동일 — `parseV11Line` 공유

---

## 4. createSensorManager 확장

```js
function createSensorManager(config) {
    const manager = {
        // 기존 API — 변경 없음
        source, mode,
        setMode(mode),
        onData(cb),
        on(type, cb),
        sendCalib(),
        sendConfig(rateMs),

        // 신규 API
        onChannelData(ch, cb),    // 특정 채널만 필터링하여 전달
        sendCalibChannel(ch),     // 특정 채널 캘리브
        getChannels(),            // source.getChannels() 프록시
    };
    return manager;
}
```

### `onChannelData(ch, cb)` 구현

```js
onChannelData(ch, cb) {
    const filtered = (data) => {
        if ((data.ch ?? 0) === ch) cb(data);
    };
    this._dataCallbacks.push(filtered);
    if (this.source) this.source.onData(filtered);
}
```

기존 `onData(cb)` 는 **모든 채널** 데이터를 전달 (하위 호환).
`onChannelData(ch, cb)` 는 **특정 채널만** 필터링.

---

## 5. 실험별 사용 패턴

### 보일 (기존 코드 — 변경 없음)

```js
const sensorManager = createSensorManager({ initialPressure: 101.3 });
sensorManager.onData(data => {
    smoothedP = data.value;  // ch 무시, 단일 채널이므로 항상 ch=0
});
```

### 돌턴 (신규)

```js
const sensorManager = createSensorManager({
    channels: [
        { ch: 0, pressure: 101.3, label: "B-receiver" },
        { ch: 1, pressure: 101.3, label: "A-injector" },
    ]
});

// 채널별 구독 (입문 가이드 — 단순화 예시)
sensorManager.onChannelData(0, data => {
    daltonState.pressureB = data.value;  // 주사기 B (수용측)
});
sensorManager.onChannelData(1, data => {
    daltonState.pressureA = data.value;  // 주사기 A (능동측)
});
```

> **실제 콜백 흐름은 §8~§11 참조.** 위 예시는 시그니처만 보여줌. 실 구현 (`web/js/main.js:964–987`) 은 다음을 추가로 포함:
> - mock 모드 가드 (`if (mode === "mock") return;`) — mock 본체는 sim 자체 갱신
> - EMA 평활 후 `pressureASensor` / `pressureBSensor` 갱신 (상세 §10)
> - `updateChLive(ch, value)` raw kPa 표시 (상세 §9)
> - `pressureFrozen` 가드 (상세 §11)
> - `updatePressureReadouts()` 게이지 stage 분기 호출 (상세 §8)
> - `maybeUpdateParticleTarget(side)` 입자 수 target 재계산 (상세 §10)

---

## 6. 이벤트 확장

### `"connect"` 이벤트 payload

```js
// v1.1 (기존)
{ version: "1.1", sensor: "DFRobot-1.6MPa", fw: "1.1.0-emulator" }

// v1.2 (확장)
{ version: "1.2", sensor: "DFRobot-1.6MPa", fw: "1.2.0-emulator",
  channels: [
    { ch: 0, sensor: "DFRobot-1.6MPa", label: "B-receiver" },
    { ch: 1, sensor: "DFRobot-1.6MPa", label: "A-injector" }
  ]
}
```

### `"calibrated"` 이벤트 payload

```js
// v1.1 (기존): p0kPa (숫자)
101.3

// v1.2 (확장): { ch, p0kPa }
{ ch: 0, p0kPa: 101.3 }
```

소비자는 `typeof payload === "number"` 로 v1.1/v1.2 분기 가능.

---

## 7. 돌턴 sensor-panel UI 방향

보일의 `#sensor-panel`을 기반으로 돌턴용 확장:

| 보일 패널 | 돌턴 패널 |
|-----------|-----------|
| 모드 토글 (mock/ws/real) 1개 | 동일 — 1개 (양쪽 센서 동시 전환) |
| 상태 표시 1줄 | 채널별 상태 2줄 (ch0 B, ch1 A) |
| 캘리브 버튼 1개 | 채널별 캘리브 2개 + 전체 캘리브 1개 |
| 압력 표시 | 게이지 A, B + ch live raw 라벨 + 압력 확정 토글 (상세 §8~§11) |

모드 전환은 **단일 동작**으로 양쪽 채널 동시 전환 (센서 2개가 같은 MCU에 연결).

---

## 8. 게이지 라우팅 — stage × 모드 분기

**위치**: `web/js/main.js:1244–1296` (`updatePressureReadouts`)

게이지 입력값은 stage (`daltonState.stage`) 와 모드 (`daltonSensorManager.mode`) 의 곱으로 분기. mock 본체는 시뮬레이션이 `pressureBSensor` 를 갱신하고, ws/real 은 `onChannelData` 콜백이 EMA 평활값을 `pressureASensor` / `pressureBSensor` 에 대입 (§10 참조).

| stage | mock — P_A 게이지 | mock — P_B 게이지 | ws/real — P_A 게이지 | ws/real — P_B 게이지 |
|-------|-------------------|-------------------|----------------------|----------------------|
| `IDLE` | `pressureBSensor` (Phase 5.3 패턴) | `pressureBSensor` | `pressureASensor` | `pressureBSensor` |
| `INJECTING` | "—" (V_A → 0, 비평형) | `pressureBSensor` (sim 진행률 동기) | "—" (V_A → 0, 비평형) | "—" (실측 출처 없음) |
| `STABILIZING` | "—" (V_A=0) | `pressureBSensor` | "—" (V_A=0) | `pressureBSensor` |
| `INJECTED` / `CONFIRMED` | "—" (V_A=0) | `pressureBSensor` | "—" (V_A=0) | `pressureBSensor` |

### 표시 정책 근거

- **V_A=0 → P_A "—"**: STABILIZING 이후 주사기 A 부피 0 (입자 모두 B 로 이동). "측정 가능한 압력" 자체가 없으므로 "—". 양쪽 모드 공통.
- **INJECTING 양쪽 모드 P_A "—"**: V_A 가 0 으로 가는 도중이라 동일 사유. 단위 라벨도 "" (빈 문자열) 처리.
- **INJECTING ws/real P_B "—"** (Q1 결정): 실측 출처 없는 시점에서 시뮬 보간 표시 시 측정 의미 약화 → "—" 가 정직. 결정 1 ("ws/real 실측 우선") 원칙 유지.
- **INJECTING mock P_B = `pressureBSensor`**: Phase 5.3 의 5 초 주입 동안 P_B 상승 시각화는 학습 자산 (주입 = 압력 증가 직관). sim 본체가 진행률 기반으로 `pressureBSensor` 갱신. Q1 적용 시 손실되므로 보존.
- **STABILIZING / INJECTED / CONFIRMED 모두 P_B = `pressureBSensor`**: 평형값. mock 은 sim 본체, ws/real 은 EMA 평활값.

> **연관 진단**: commit `8eeaea2` 에서 `updatePressureReadouts` 의 게이지 입력 변수 분리 시 stage 분기 보존 누락 → mock+IDLE 에서 P_A 게이지 stale (P_A=3.94 / P_B=2.96 회귀). commit `4ea6a65` 에서 위 표 4 분기로 복원. 일지 Phase 5.4 진단 블록 참조.

---

## 9. ch live 라벨 — raw kPa 실시간 표시

**위치**: `web/js/main.js:989–992` (`updateChLive`), `964–987` (콜백 호출), `1121–1122` (disconnect 초기화)

게이지 표시값과 별도로 **각 채널의 raw kPa 값** 을 항상 표시하는 라벨. 학생이 평활/freeze/stage 분기와 무관하게 센서 원시 동작을 관찰 가능.

```js
function updateChLive(ch, kPa) {
    const el = ch === 0 ? dom.ch0Live : dom.ch1Live;
    if (el) el.textContent = `${kPa.toFixed(1)} kPa`;
}
```

### 갱신 정책

| 상황 | ch live 라벨 동작 |
|------|------------------|
| ws/real `onChannelData` 수신 | EMA 적용 **전** raw 값으로 즉시 갱신 |
| `pressureFrozen = true` | **계속 갱신** (freeze 와 무관 — raw 데이터 인지 보장) |
| stage 무관 | 모든 stage 에서 동일하게 갱신 |
| `disconnect` 이벤트 | "—" 로 초기화 |
| mock 모드 | 갱신 X (mock 본체는 sim 본체가 처리) |

ch live 라벨은 게이지 ↔ raw 데이터 분리 학습의 핵심 — 게이지가 "—" 표시여도 학생은 ch live 에서 센서가 정상 동작 중임을 확인 가능.

---

## 10. 입자 수 일관성 정책

**위치**: `web/js/main.js:1497–1601`

PV=nRT (T 일정 가정) 기반으로 **시각 입자 수 = 분자 수** 를 항상 정합. ws/real 모드의 노이즈가 직접 입자 수에 반영되면 깜박임 + 충돌 시뮬 (Phase 5.3 자산) 안정성 저하 → 4 단계 buffering.

### computeMoleCount 시그니처

```js
function computeMoleCount(pressureAtm, volumeMl) {
    return Math.round(pressureAtm * volumeMl);
}
```

학습용 정규화 단위: **1 atm·mL = 1 분자**. 시각 입자 / 측정 row / 좌측 패널 모두 이 함수 사용.

### 4 단계 buffering

| 단계 | 상수 | 효과 |
|------|------|------|
| EMA 평활 | `EMA_ALPHA = 0.2` (5 Hz × 5 ≈ 1 초 시간 상수) | onChannelData 수신값을 `emaP_A_kPa` / `emaP_B_kPa` 에 누적. 노이즈 제거. |
| 임계값 dead-band | `PARTICLE_UPDATE_THRESHOLD_KPA = 2.0` | `\|EMA - 마지막 갱신값\| < 2 kPa` 시 target 재계산 X. 미세 변동 무시. |
| 점진 보정 | `PARTICLE_STEP_PER_FRAME = 2` | 매 프레임 max 2 개씩 추가/제거. 시각 부드러움. |
| stage 차등 | `IDLE` / `STABILIZING` 만 갱신 | INJECTING (시뮬 보간 우선) / INJECTED·CONFIRMED (기록값 보호) 갱신 X |

### maybeUpdateParticleTarget(side, force)

EMA 와 `lastUpdatedP_*_kPa` 차이가 임계값 이상일 때 `targetParticles_*` 재계산. `force=true` 면 임계값/freeze 무시 (기록 시점, freeze 적용 시점 등).

```js
function maybeUpdateParticleTarget(side, force) {
    const stage = daltonState.stage;
    if (!force && stage !== "IDLE" && stage !== "STABILIZING") return;
    if (!force && daltonState.pressureFrozen) return;

    const ema = daltonState[side === "A" ? "emaP_A_kPa" : "emaP_B_kPa"];
    const last = daltonState[side === "A" ? "lastUpdatedP_A_kPa" : "lastUpdatedP_B_kPa"];
    if (!force && Math.abs(ema - last) < PARTICLE_UPDATE_THRESHOLD_KPA) return;

    const volumeMl = side === "A" ? daltonState.syringeA.volume : daltonState.syringeB.volume;
    const nTarget = computeMoleCount(ema / 101.325, volumeMl);
    daltonState[side === "A" ? "targetParticles_A" : "targetParticles_B"] = nTarget;
    daltonState[side === "A" ? "lastUpdatedP_A_kPa" : "lastUpdatedP_B_kPa"] = ema;
}
```

### stepParticleCounts()

매 프레임 호출. stage 차등 + freeze 가드 후 `targetParticles_*` 와 현재 입자 수 차이만큼 점진 보정 (max `PARTICLE_STEP_PER_FRAME`/프레임).

### 신규 헬퍼 3 개

| 헬퍼 | 책임 |
|------|------|
| `getParticleCountInSyringe(side)` | region [1] (A) 또는 region [5] (B) 의 입자 수 카운트 (`countParticlesInRegions`). |
| `addParticleToSyringe(side)` | safe 영역 (`safeW`, `safeH` 검사) + region 일치 검증 max 5 회 재시도 + 가스 종류 (`gasKey`, `M`) 일관 부여. |
| `removeParticleFromSyringe(side)` | target region 의 입자 후보 중 무작위 1개 제거. |

`rebuildParticleSystem` 매 프레임 호출은 시뮬 안정성 파괴 + spatial hash 재생성 부담 → 위 3 헬퍼로 점진 보정. 5-region 모델 + 입자간 충돌 시뮬과 호환.

---

## 11. 압력 확정 토글

**위치**: `web/js/main.js:1159–1192` (`togglePressureFreeze`, `updatePressureFreezeUI`), `1100–1112` (connect 핸들러), `1114–1134` (disconnect 핸들러)

노이즈 있는 측정값에서 "측정 시점 = 어느 값" 의 학생 판단 학습 + 라이브 데이터로 시뮬이 계속 변하는 분석 혼란 방지.

### 동작 명세

| 항목 | 명세 |
|------|------|
| 버튼 | `#btn-pressure-freeze` (단일 토글, 양쪽 동시 freeze) |
| 활성 조건 | (`stage === "IDLE"` \|\| `stage === "STABILIZING"`) **AND** `mode !== "mock"` **AND** `source.connected === true` |
| freeze 동작 | `pressureFrozen = true`, `frozenP_A_kPa = emaP_A_kPa`, `frozenP_B_kPa = emaP_B_kPa`. 게이지 + 입자 수 정지. ch live 라벨은 계속 갱신 (§9). |
| 토글 표시 | 라벨 "🔓 확정 해제" / "🔒 압력 확정" + `.dalton-frozen` 클래스 |
| 자동 해제 | stage 전환 시 (INJECTING / INJECTED / CONFIRMED 진입) `pressureFrozen = false` 강제 |
| 수동 해제 | 같은 버튼 재클릭 시 freeze 상태 토글 |
| 호출 지점 (UI 갱신) | setMode / setStage / connect / disconnect / 리셋 / 초기화 |

### connect 시 updatePressureFreezeUI 호출 (fc1cedc 교훈)

`daltonSensorManager.on("connect", ...)` 핸들러 (line 1100–1112) 에서 `enableCalibButtons()` 와 함께 `updatePressureFreezeUI()` 필수 호출. 누락 시 ws 연결 후 압력 확정 버튼이 stage 전환 전까지 disabled 유지 (commit `fc1cedc` 에서 1 줄 fix).

> **체크리스트**: 새 stage/mode-dependent UI 컴포넌트 추가 시 — setMode / setStage / **connect** / disconnect / 리셋 / 초기화 6 지점 호출 점검 필수.

### disconnect 시 freeze 초기화

`disconnect` 핸들러에서 `pressureFrozen = false` + `frozenP_*_kPa = null` + EMA / target 초기화. ch live 라벨 "—" 초기화.

---

## 12. docs/14 cross-reference — 캘리브 적용 시점

**위치**: `docs/14-calibration-pipeline.md` 참조. 본 문서 (docs/13) 와의 경계.

### 책임 분리

| 책임 | 위치 | 비고 |
|------|------|------|
| 캘리브 offset 측정 (`p₀`) | 펌웨어 / WebSocket emulator | `sendCalib(ch?)` → `calibrated` 이벤트 |
| offset 적용 (`value -= p₀`) | **manager 단** — `onChannelData` 콜백 도달 **전** | docs/14 명세 |
| 보정값 → daltonState | `onChannelData` 콜백 (이 문서 §5, §10) | EMA 평활 입력값은 이미 보정된 값 |

소비자 (main.js) 는 보정 적용을 직접 신경쓰지 않음 — `onChannelData` 가 받는 `value` 가 이미 보정된 값이라는 것이 사용 계약.

### "미보정" 라벨 vs ch live 라벨

UI 상 두 라벨이 분리:

| 라벨 | DOM | 표시 내용 | 갱신 시점 |
|------|-----|-----------|-----------|
| 미보정 / `p₀=...` | `#dalton-ch{0,1}-calib` | 캘리브 상태 ("미보정" 또는 `p₀ = X.X kPa`) | `calibrated` 이벤트 수신 시 |
| ch live | `#dalton-ch{0,1}-live` | 보정된 raw kPa (EMA 미적용) | `onChannelData` 매 수신 시 (§9) |

학생 관점: 캘리브 라벨 = "현재 영점 기준값", ch live 라벨 = "현재 측정값". 두 값을 분리 표시하여 캘리브 동작 자체를 학습 가능.
