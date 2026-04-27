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

const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1] || 'boyle'
  : 'boyle';

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

/* ── 프로토콜 메시지 생성 ──────────────────────────── */

function makeHello() {
  const msg = { t: 's', sensor: channels[0].sensor, fw: firmware };
  if (channels.length > 1) {
    msg.channels = channels.map(c => ({ ch: c.ch, sensor: c.sensor, label: c.label }));
  }
  return JSON.stringify(msg);
}

function makeData(ch) {
  const msg = { t: 'd', p: ch.pressurePa, T: ch.tempC, ts: Date.now() - startedAt };
  if (channels.length > 1) msg.ch = ch.ch;
  return JSON.stringify(msg);
}

function sendAllData(ws) {
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
    printState();
    return;
  }
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    console.log('\n[emulator] 종료');
    process.exit(0);
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
    ? '↑↓←→:ch0  wsad:ch1  i:주입  r:리셋  q:종료'
    : '↑↓±10kPa ←→±1kPa  r:리셋  q:종료';

  process.stdout.write(`\r[emulator:${MODE}] ${parts.join(' | ')}  (${keys})  `);
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
