# 13. SensorSource 멀티채널 인터페이스 설계

**문서 목적**: 단일채널 SensorSource 추상화를 멀티채널로 확장하는 SW 설계 명세.

**마지막 업데이트**: 2026-04-27 (Phase 5.4 Step I-pre-2).

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

// 채널별 구독
sensorManager.onChannelData(0, data => {
    daltonState.pressureB = data.value;  // 주사기 B (수용측)
});
sensorManager.onChannelData(1, data => {
    daltonState.pressureA = data.value;  // 주사기 A (능동측)
});
```

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
| 압력 표시 | 게이지 A, B 에 이미 반영됨 (기존 돌턴 UI) |

모드 전환은 **단일 동작**으로 양쪽 채널 동시 전환 (센서 2개가 같은 MCU에 연결).
