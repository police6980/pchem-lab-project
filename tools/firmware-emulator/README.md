# 펌웨어 에뮬레이터 (firmware-emulator)

ESP32 + DFRobot Gravity 1.6MPa 펌웨어의 Node.js 포팅본. WebSocket 으로 v1.2
프로토콜 JSON 송신 — 실물 없이 브라우저 `WebSocketSensorSource` 개발 / 디버깅
/ 회귀 검증.

**누가 보나**: sensor source 코드 작업자, 회귀 검증, 실물 도착 전 통합 테스트.

본 문서 = **에뮬레이터 단일 권위** (동작 / 키 / 노이즈). 영역별 관점은 §8 cross-ref.

---

## 1. 설치 + 실행

```bash
cd tools/firmware-emulator
npm install                        # 최초 1회 (ws 의존성)

npm start                          # 보일 모드 (단일 채널 ch0)
npm start -- --mode dalton         # 돌턴 모드 (ch0 + ch1)
# 또는 직접: node emulator.js [--mode dalton]
```

**서버**: `ws://localhost:8787`. 브라우저 `WebSocketSensorSource.DEFAULT_URL`
(`web/js/serial.js:331`) 와 hardcoded 일치. 종료: `q` 또는 `Ctrl+C`.

**의존성** (`package.json`): `ws@^8.20.0` 단 1개. 그 외 Node.js 표준 모듈
(`readline`, `WebSocketServer`) 만.

---

## 2. 모드 (boyle / dalton)

| 모드 | 채널 수 | 채널 구성 | 용도 |
|---|---|---|---|
| **boyle** (기본) | 1 | ch0 = `B-receiver` (label 은 dalton 과 공유) | 보일 시뮬 — 단일 압력 센서 |
| **dalton** (`--mode dalton`) | 2 | ch0 = `B-receiver` (수용측, P_total 측정) + ch1 = `A-injector` (능동측, P_A 모니터링) | 돌턴 부분압력 시뮬 — 주사기 A→B 주입 검증 |

**hello 메시지 차이** (`emulator.js:115-121` `makeHello()`):
- 보일: `{t:'s', sensor:'DFRobot-1.6MPa', fw:'1.2.0-emulator'}`
- 돌턴: 위 + `channels: [{ch:0, sensor, label:'B-receiver'}, {ch:1, sensor, label:'A-injector'}]`

브라우저 `protocol.js` (`parseV11Line`) 가 `channels` 필드 유무로 v1.1 / v1.2
자동 분기. 자세한 스키마는 `docs/12-protocol-v1.2.md`.

---

## 3. 키 바인딩

에뮬레이터 cmd 창 **포커스 상태에서만 키 입력 수신**. 브라우저나 다른 창에
포커스 시 키 무시.

### 압력 조작

| 키 | 보일 모드 | 돌턴 모드 |
|---|---|---|
| `↑` / `↓` | ch0 ±10 kPa | ch0 (B) ±10 kPa |
| `→` / `←` | ch0 ±1 kPa | ch0 (B) ±1 kPa |
| `w` / `s` | — | ch1 (A) ±10 kPa |
| `d` / `a` | — | ch1 (A) ±1 kPa |
| `i` | — | 주입 시뮬 — ch1 의 압력을 ch0 에 합산, ch1 = `PA_MIN` (81 kPa) |

압력 범위: `[81, 400]` kPa (`PA_MIN` ~ `PA_MAX`, `emulator.js:34-35`).

### 노이즈 시나리오 (★★★ 본 세션 신규)

| 키 | 동작 |
|---|---|
| `n` | 모드 토글 — `off` → `quiet` → `normal` → `harsh` → `off` 순환 |
| `1` | preset 직접 → `off` (raw) |
| `2` | preset 직접 → `quiet` (σ=0.5 kPa) |
| `3` | preset 직접 → `normal` (σ=2 kPa + drift) |
| `4` | preset 직접 → `harsh` (σ=5 kPa + drift + spike + clip) |

`off` 로 전환 시 누적 drift 자동 0. 상세는 §4.

### 공통

| 키 | 동작 |
|---|---|
| `r` | 모든 채널 101.325 kPa 리셋 + drift 0 (노이즈 모드는 유지) |
| `q` 또는 `Ctrl+C` | 에뮬 종료 |

---

## 4. 노이즈 시나리오

기본 `off` (raw 송신, 기존 동작 보존). opt-in 으로 4 preset 전환. 실물
DFRobot SEN0257 추정 σ=2~4 kPa 패턴 시뮬 — Phase 5.4 commit ffd191e.

### 4.1 preset 표

| preset | σ (Pa) | drift | spike | clip | label |
|---|---|---|---|---|---|
| `off`    | 0     | × | × | × | raw (노이즈 없음) |
| `quiet`  | 500   | × | × | × | σ=0.5 kPa |
| `normal` | 2,000 | ✓ | × | × | σ=2 kPa + drift |
| `harsh`  | 5,000 | ✓ | ✓ | ✓ | σ=5 kPa + drift + spike + clip |

상수 정의: `emulator.js:42-54` (`NOISE_PRESETS`, `SPIKE_PROB=0.02`,
`SPIKE_SIGMA=50_000`, `DRIFT_SIGMA=5`, `DRIFT_LIMIT=2_000`,
`CLIP_MIN=81_000`, `CLIP_MAX=1_600_000`).

### 4.2 적용 순서 (`applyNoise:102-111`)

```
raw → +driftPa → +spike(if Bernoulli 2%) → +gaussian(σ) → clip([81k, 1.6M])
```

각 단계는 preset flag 가 true 일 때만 적용. `off` 는 즉시 raw 반환.

### 4.3 모델 세부

- **drift** (`tickDrift:97-100`): random walk. tick (200 ms) 당 `gaussian(0, 5 Pa) × 0.2 = std 1 Pa` 누적, `[-2k, +2k Pa]` clamp. `r` 또는 `off` 전환 시 0. 실물 온도 / aging 변화의 비선형 누적성 반영.
- **spike**: tick 마다 Bernoulli(p=0.02) → 30 초 평균 3 회. 진폭 `gaussian(0, 50 kPa)`, 1 sample 지속. 전기 noise / USB cable interference 시뮬.
- **clip**: `[81, 1600] kPa`. PA_MIN ~ 센서 한계 (1.6 MPa). 음수 / saturation 양쪽 가드.

### 4.4 사용 시나리오

| 시나리오 | preset | 이유 |
|---|---|---|
| 학생 시연 / 강의 | `off` | raw — 학습 명확성. 노이즈 인지 부하 회피 |
| 회귀 검증 (개발) | `quiet` | σ=0.5 kPa. EMA / 임계값 / particle target 노이즈 민감성. spike X = 결정론에 가까움 |
| 실물 도착 견고성 | `normal` / `harsh` | `normal` = SEN0257 추정 σ=2~4 kPa. `harsh` = worst case 가드 검증 |

---

## 5. cfg / calib ACK

브라우저 → 에뮬 수신 메시지 (`emulator.js:257-292`).

| 메시지 | 처리 | ACK |
|---|---|---|
| `{"t":"calib","ch":?}` | 대상 ch 의 `c.p0 = c.pressurePa` 저장. ch 생략 시 모든 ch | `{"t":"c","ch":N,"p0":101325}` ch 마다 1회 |
| `{"t":"cfg","rate":N}` | `setInterval` 재설정. 50~5000 ms 범위, 외 거부 | ❌ 미구현 (console log only). 후속 옵션 D 에서 고려 |
| `{"t":"ping"}` | 무시 (verbose log skip). keep-alive 용 | X |

**캘리브 파이프라인**: `docs/14-calibration-pipeline.md`. 에뮬은 raw 저장 +
ACK 만, 실제 보정 (`raw - offset`) 은 브라우저 측 (전략 C —
`web/js/serial.js:503-510`).

---

## 6. 시나리오 추가법 (개발자)

신규 키 / preset / 모드 추가 시 아래 패턴 따름.

### 6.1 새 키 추가

`process.stdin.on('keypress', ...)` (`emulator.js:142-208`) 콜백에 분기.
모드별 분기는 `if (IS_DALTON)` 가드. 처리 후 `printState() + return`.

```js
if (key.name === 't') {                    // 'T' = ch0 온도 ±1°C
  const c = getCh(0);
  c.tempC = clamp(c.tempC + (key.shift ? -1 : 1), 0, 50);
  printState(); return;
}
```

### 6.2 새 노이즈 preset 추가

5 필드 (`sigmaPa`, `drift`, `spike`, `clip`, `label`) 정의 + 3 위치 갱신.
spike / clip 모델은 정의됨 — flag toggle 만.

```js
const NOISE_PRESETS = { /* 기존 4 + */ custom: { sigmaPa: 1500, drift: true, spike: false, clip: false, label: 'σ=1.5 + drift' } };
const NOISE_ORDER   = ['off', 'quiet', 'normal', 'harsh', 'custom'];
const presetByKey   = { '1':'off','2':'quiet','3':'normal','4':'harsh','5':'custom' };
```

### 6.3 새 시나리오 모드 추가 (옵션 B 미리 보기)

JSON 시나리오 자동 재생 — 옵션 B 후속의 골격. 패턴: state 변수 + 시작 키 +
`sendAllData` 직전 tick 함수.

```js
import * as fs from 'fs';
let scenarioMode = null;  // { steps:[{t_ms, ch, pressurePa}], idx, startedAt }

// 키 콜백
if (key.name === 's') {
  const data = JSON.parse(fs.readFileSync('scenarios/leak.json', 'utf8'));
  scenarioMode = { steps: data.steps, idx: 0, startedAt: Date.now() };
  return;
}

// sendAllData 직전 호출
function tickScenario() {
  if (!scenarioMode) return;
  const elapsed = Date.now() - scenarioMode.startedAt;
  while (scenarioMode.idx < scenarioMode.steps.length &&
         scenarioMode.steps[scenarioMode.idx].t_ms <= elapsed) {
    const s = scenarioMode.steps[scenarioMode.idx++];
    getCh(s.ch).pressurePa = s.pressurePa;
  }
}
```

---

## 7. 회귀 테스트 (옵션 A — 노이즈 통계)

A-1 노이즈 시나리오 (off / quiet / normal / harsh) 의 통계 회귀를 자동 검증.
시나리오 JSON 명세 + 실행기 → emulator 자동 spawn → baseline 측정 → judge → 종료 코드.

### 7.1 사용

```bash
# 단일 시나리오
node run-scenario.js scenarios/quiet-60s.json

# 일괄 (scenarios/*.json 모두)
node run-all.js
```

종료 코드 — 모두 pass=0 / 1개라도 fail=1. CI 친화.

### 7.2 시나리오 JSON schema

```json
{
  "name": "quiet-60s",
  "description": "...",
  "preset": "off" | "quiet" | "normal" | "harsh",
  "duration": 60,
  "channel": 0,
  "expect": {
    "sigma_max_pa": 750,            // stats.sigma <= 임계값
    "maxSpike_max_pa": 2500          // stats.maxSpike <= 임계값
  }
}
```

`expect` 안의 키만 검증 (생략 시 검증 X). drift 검증은 본 단계에서 X — head/tail 10% slice
artifact 가 60초 측정에서 큼 (long duration 별 작업).

### 7.3 현재 시나리오 4 종

| 파일 | preset | σ_max (Pa) | maxSpike_max (Pa) | 검증 의도 |
|---|---|---|---|---|
| `off-60s.json` | off | 1 | 1 | deterministic 확인 (시뮬 본체 raw) |
| `quiet-60s.json` | quiet | 750 | 2500 | preset σ=500 부합 |
| `normal-60s.json` | normal | 3000 | 10000 | preset σ=2000 + drift 흡수 |
| `harsh-60s.json` | harsh | 7500 | — | preset σ=5000. spike 검증 X (Bernoulli 의도) |

임계값 = preset σ × 1.5 안전 여유. false fail 발견 시 임계값 조정 (`scenarios/*.json` 직접 편집).

### 7.4 흐름 요약 (`run-scenario.js`)

1. 시나리오 JSON 로드
2. `child_process.spawn('node', [emulator.js, --mode dalton, --noise <preset>])` — `--noise` CLI 인자 (`emulator.js:60-69`)
3. emulator listen grace 800 ms 대기
4. `baseline.js` 의 `collect` import 재사용 → WebSocket 데이터 수집 (duration 초)
5. emulator kill (Windows 호환 — `kill()` + 3 s 후 `kill('SIGKILL')` fallback)
6. `baseline.js` 의 `computeStats` import 재사용 → σ / maxSpike / drift 계산
7. `judge(stats, expect)` → checks 배열 + pass 여부
8. stdout = JSON dump / stderr = PASS / FAIL 표시 + 종료 코드

### 7.5 신규 시나리오 추가

1. `scenarios/<name>.json` 신규 — 위 schema 따름
2. `node run-scenario.js scenarios/<name>.json` 단일 실행 → 임계값 적정성 확인
3. `run-all.js` 가 자동 포함 (scenarios/*.json glob)

다른 종류 (sequence replay / outlier 가드 검증) 는 §6.3 골격 + 별 단위 테스트 영역.

---

## 8. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 포트 8787 사용 중 | 종료 안 된 이전 에뮬 cmd 창 확인. 변경 시 `emulator.js:32` + `web/js/serial.js:331` **동시 수정** (hardcoded, 환경변수 미지원) |
| Win11 PowerShell 정책 오류 | cmd 창 사용 또는 `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` 또는 `node emulator.js` 직접 호출 |
| `npm install` 위치 오류 | 반드시 `tools/firmware-emulator/` 안. root 에서 시도 시 `node`, `npm`, `pchem-firmware-emulator@*` 0-byte 파일 (`.gitignore:26-29` 무시 처리) |
| 의존성 깨짐 의심 | `rm -rf node_modules && npm install` (Windows: `rmdir /s node_modules`) |
| 연결 끊김 (브라우저 ws disconnect) | 자동 재연결 X. 브라우저 모드 토글 다시 클릭 → `WebSocketSensorSource` 재생성 |
| 키보드 입력 안 받힘 | 에뮬 cmd 창 포커스 확인. pipe / redirect 환경 (`!isTTY`) 에서도 raw mode 진입 X |

---

## 9. cross-ref

- `docs/12-protocol-v1.2.md` — 프로토콜 명세 (메시지 타입 / Pa↔kPa / channels)
- `docs/14-calibration-pipeline.md` — 캘리브 전략 C (브라우저 측 보정)
- `docs/16-developer-onboarding.md` — 개발 환경 전반. 에뮬 §3.1+4.2 빠른 시작
- `firmware/README.md` — 실물 펌웨어 / Wokwi. v1.2 프로토콜 호환

본 README = 에뮬 동작 / 키 / 노이즈 권위. 위 docs 는 각 영역별 관점.
