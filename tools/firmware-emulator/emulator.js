/*
 * 펌웨어 에뮬레이터 — v1.2 멀티채널 지원
 *
 * 실제 ESP32 + DFRobot Gravity 1.6MPa 펌웨어의 Node.js 포팅본.
 * v1.2 프로토콜 JSON을 WebSocket으로 전송.
 *
 * 모드:
 *   node emulator.js              → 보일 (ch 0 단일)
 *   node emulator.js --mode dalton → 돌턴 (ch 0 B-receiver + ch 1 A-injector)
 *
 * 보일 키 조작:
 *   ↑↓: ch0 ±10 kPa, ←→: ch0 ±1 kPa, r: 리셋, q: 종료
 *
 * 돌턴 추가 키:
 *   w/s: ch1 ±10 kPa, a/d: ch1 ±1 kPa
 *   i: 주입 시뮬 (ch1→ch0, A→B 기체 이동)
 *
 * 노이즈 시나리오 (Phase 5.4 A-1, 실물 SEN0257 패턴 시뮬):
 *   n: off → quiet → normal → harsh → off 순환 토글
 *   1: off (raw)  2: quiet (σ=0.5kPa)
 *   3: normal (σ=2kPa + drift)  4: harsh (σ=5kPa + drift + spike + clip)
 *   기본 'off' — 기존 raw 동작 보존 (opt-in)
 *
 * 범위 81~400 kPa. 실행: npm start (또는 node emulator.js)
 */

import { WebSocketServer } from 'ws';
import * as readline from 'readline';

/* ── 설정 ──────────────────────────────────────────── */

const PORT      = 8787;
const REPORT_MS = 200;   // 5Hz
const PA_MIN    = 81_000;
const PA_MAX    = 400_000;
const PA_RESET  = 101_325;

/* ── 노이즈 시나리오 (Phase 5.4 A-1) ─────────────────
 * 실물 SEN0257 추정 σ=2~4 kPa 패턴 시뮬. 기본 'off'.
 * normal preset = 실물 대응. harsh = spike + clip 검증용. */

const NOISE_PRESETS = {
  off:    { sigmaPa: 0,    drift: false, spike: false, clip: false, label: 'raw (노이즈 없음)' },
  quiet:  { sigmaPa: 500,  drift: false, spike: false, clip: false, label: 'σ=0.5 kPa' },
  normal: { sigmaPa: 2000, drift: true,  spike: false, clip: false, label: 'σ=2 kPa + drift' },
  harsh:  { sigmaPa: 5000, drift: true,  spike: true,  clip: true,  label: 'σ=5 kPa + drift + spike + clip' },
};
const NOISE_ORDER = ['off', 'quiet', 'normal', 'harsh'];
const SPIKE_PROB  = 0.02;     // Bernoulli — 200ms tick 당 2% (30초 평균 3회)
const SPIKE_SIGMA = 50_000;   // ±50 kPa
const DRIFT_SIGMA = 5;        // Pa 단위. tick 당 std = 5 * (200/1000) = 1 Pa
const DRIFT_LIMIT = 2_000;    // ±2 kPa clamp
const CLIP_MIN    = 81_000;   // 0.81 bar (PA_MIN 일치)
const CLIP_MAX    = 1_600_000;// 1.6 MPa (센서 한계)

let noiseMode = 'off';
let driftPa   = 0;

const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1] || 'boyle'
  : 'boyle';

// --noise <preset> CLI 인자 — 시작 시 noiseMode 설정 (시나리오 자동화용)
if (process.argv.includes('--noise')) {
  const preset = process.argv[process.argv.indexOf('--noise') + 1];
  if (NOISE_ORDER.includes(preset)) {
    noiseMode = preset;
  } else {
    console.error(`[emulator] --noise: 알 수 없는 preset "${preset}". 허용: ${NOISE_ORDER.join('/')}`);
    process.exit(2);
  }
}

const IS_DALTON = MODE === 'dalton';

/* ── 채널 상태 ─────────────────────────────────────── */

const channels = [
  { ch: 0, sensor: 'DFRobot-1.6MPa', label: 'B-receiver', pressurePa: PA_RESET, tempC: 25.0, p0: null },
];

if (IS_DALTON) {
  channels.push(
    { ch: 1, sensor: 'DFRobot-1.6MPa', label: 'A-injector', pressurePa: PA_RESET, tempC: 25.0, p0: null },
  );
}

const firmware = IS_DALTON ? '1.2.0-emulator' : '1.2.0-emulator';
const startedAt = Date.now();

/* ── 유틸 ──────────────────────────────────────────── */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getCh(idx) {
  return channels.find(c => c.ch === idx) || channels[0];
}

function gaussian(mean, std) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

function tickDrift() {
  if (!NOISE_PRESETS[noiseMode].drift) return;
  driftPa = clamp(driftPa + gaussian(0, DRIFT_SIGMA) * (REPORT_MS / 1000), -DRIFT_LIMIT, DRIFT_LIMIT);
}

function applyNoise(rawPa) {
  const preset = NOISE_PRESETS[noiseMode];
  if (noiseMode === 'off') return rawPa;
  let p = rawPa;
  if (preset.drift) p += driftPa;
  if (preset.spike && Math.random() < SPIKE_PROB) p += gaussian(0, SPIKE_SIGMA);
  if (preset.sigmaPa > 0) p += gaussian(0, preset.sigmaPa);
  if (preset.clip) p = clamp(p, CLIP_MIN, CLIP_MAX);
  return Math.round(p);
}

/* ── 프로토콜 메시지 생성 ──────────────────────────── */

function makeHello() {
  const msg = { t: 's', sensor: channels[0].sensor, fw: firmware };
  if (channels.length > 1) {
    msg.channels = channels.map(c => ({ ch: c.ch, sensor: c.sensor, label: c.label }));
  }
  return JSON.stringify(msg);
}

function makeData(ch) {
  const reportedPa = applyNoise(ch.pressurePa);
  const msg = { t: 'd', p: reportedPa, T: ch.tempC, ts: Date.now() - startedAt };
  if (channels.length > 1) msg.ch = ch.ch;
  return JSON.stringify(msg);
}

function sendAllData(ws) {
  tickDrift();  // 채널 공통 drift 1회 갱신 (200ms tick)
  for (const ch of channels) {
    if (ws.readyState === ws.OPEN) ws.send(makeData(ch));
  }
}

/* ── CLI 키 입력 ────────────────────────────────────── */

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if (!key) return;

  // ch 0 (B) — 화살표
  let delta0 = 0;
  if      (key.name === 'up')    delta0 = +10_000;
  else if (key.name === 'down')  delta0 = -10_000;
  else if (key.name === 'right') delta0 = +1_000;
  else if (key.name === 'left')  delta0 = -1_000;

  if (delta0 !== 0) {
    const c = getCh(0);
    c.pressurePa = clamp(c.pressurePa + delta0, PA_MIN, PA_MAX);
    printState();
    return;
  }

  // ch 1 (A) — w/s/a/d (돌턴 전용)
  if (IS_DALTON) {
    let delta1 = 0;
    if      (key.name === 'w') delta1 = +10_000;
    else if (key.name === 's') delta1 = -10_000;
    else if (key.name === 'd') delta1 = +1_000;
    else if (key.name === 'a') delta1 = -1_000;

    if (delta1 !== 0) {
      const c = getCh(1);
      c.pressurePa = clamp(c.pressurePa + delta1, PA_MIN, PA_MAX);
      printState();
      return;
    }

    // i: 주입 시뮬 — ch1(A) 기체를 ch0(B)로 이동
    if (key.name === 'i') {
      simulateInjection();
      return;
    }
  }

  // 공통 키
  if (key.name === 'r') {
    for (const c of channels) c.pressurePa = PA_RESET;
    driftPa = 0;  // 리셋 시 drift 도 함께 0
    printState();
    return;
  }
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    console.log('\n[emulator] 종료');
    process.exit(0);
  }

  // 노이즈 모드 — 'n' 토글, '1'~'4' preset 직접 선택
  if (key.name === 'n') {
    const i = NOISE_ORDER.indexOf(noiseMode);
    noiseMode = NOISE_ORDER[(i + 1) % NOISE_ORDER.length];
    if (noiseMode === 'off') driftPa = 0;
    printState();
    return;
  }
  const presetByKey = { '1': 'off', '2': 'quiet', '3': 'normal', '4': 'harsh' };
  if (presetByKey[key.name]) {
    noiseMode = presetByKey[key.name];
    if (noiseMode === 'off') driftPa = 0;
    printState();
    return;
  }
});

/* ── 주입 시뮬레이션 (돌턴) ────────────────────────── */

function simulateInjection() {
  const chA = getCh(1);
  const chB = getCh(0);
  // 간단 모델: A 기체가 B로 이동 → B 압력 = B + A의 부분압
  // P_total = P_B_initial + P_A_initial (부분압력 법칙)
  const pAInitial = chA.pressurePa;
  chB.pressurePa = clamp(chB.pressurePa + pAInitial, PA_MIN, PA_MAX);
  chA.pressurePa = PA_MIN;  // A는 비어짐 (최저 압력)
  console.log(`\n[emulator] 주입 시뮬: A(${pAInitial} Pa) → B(${chB.pressurePa} Pa)`);
  printState();
}

/* ── 상태 표시 ─────────────────────────────────────── */

function printState() {
  const parts = channels.map(c => {
    const p0str = c.p0 !== null ? ` p0=${c.p0}` : '';
    return `ch${c.ch}(${c.label}): ${c.pressurePa} Pa${p0str}`;
  });

  const keys = IS_DALTON
    ? '↑↓←→:ch0  wsad:ch1  i:주입  n:노이즈(1-4)  r:리셋  q:종료'
    : '↑↓±10kPa ←→±1kPa  n:노이즈(1-4)  r:리셋  q:종료';

  const noiseStr = `noise:${noiseMode} [${NOISE_PRESETS[noiseMode].label}]`;

  process.stdout.write(`\r[emulator:${MODE}] ${parts.join(' | ')}  ${noiseStr}  (${keys})  `);
}

/* ── WebSocket 서버 ─────────────────────────────────── */

const wss = new WebSocketServer({ port: PORT });

console.log(`[emulator:${MODE}] WebSocket 서버 대기 중 → ws://localhost:${PORT}`);
console.log(`[emulator:${MODE}] 채널 ${channels.length}개: ${channels.map(c => `ch${c.ch} ${c.label}`).join(', ')}`);
printState();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`\n[emulator] ▶ 연결됨 (${ip})`);

  ws.send(makeHello());

  let interval = setInterval(() => sendAllData(ws), REPORT_MS);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.log(`\n[emulator] ← 파싱 실패: ${data.toString().slice(0, 50)}`);
      return;
    }

    if (msg.t !== 'ping') {
      console.log(`\n[emulator] ← 수신: ${JSON.stringify(msg)}`);
    }

    switch (msg.t) {
      case 'ping':
        break;

      case 'calib': {
        const targetCh = (typeof msg.ch === 'number') ? msg.ch : null;
        for (const c of channels) {
          if (targetCh !== null && c.ch !== targetCh) continue;
          c.p0 = c.pressurePa;
          ws.send(JSON.stringify({ t: 'c', ch: c.ch, p0: c.p0 }));
          console.log(`[emulator] → calib ACK: ch${c.ch} p0=${c.p0} Pa`);
        }
        break;
      }

      case 'cfg': {
        const rate = Number(msg.rate);
        if (Number.isFinite(rate) && rate >= 50 && rate <= 5000) {
          clearInterval(interval);
          interval = setInterval(() => sendAllData(ws), rate);
          console.log(`[emulator] → cfg: 주기 ${rate} ms 로 변경`);
        } else {
          console.log(`[emulator] → cfg 거부: rate=${msg.rate} (허용 50~5000)`);
        }
        break;
      }

      default:
        console.log(`[emulator] ← 알 수 없는 타입: ${msg.t}`);
    }

    printState();
  });

  ws.on('close', () => {
    clearInterval(interval);
    console.log('\n[emulator] ■ 연결 종료');
    printState();
  });

  ws.on('error', (err) => {
    clearInterval(interval);
    console.error('\n[emulator] 에러:', err.message);
  });
});
