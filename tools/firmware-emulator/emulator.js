/*
 * Phase 3 펌웨어 에뮬레이터 (Step 3-3)
 *
 * 실제 ESP32 + BMP280 펌웨어 (firmware/boyle/boyle.ino) 의
 * Node.js 포팅본. v1.1 프로토콜 JSON을 WebSocket으로 전송.
 *
 * 현재 단계: hello + 데이터 프레임 주기 전송 + CLI 키 조작.
 *   - ↑↓: ±1000 Pa, ←→: ±100 Pa, r: 리셋, q: 종료
 *   - 브라우저 수신(WebSocketSensorSource)은 Step 3-4에서 구현
 *
 * 실행: npm start  (또는  node emulator.js)
 */

import { WebSocketServer } from 'ws';
import * as readline from 'readline';

const PORT      = 8787;
const REPORT_MS = 200;   // 5Hz
const PA_MIN    = 50_000;
const PA_MAX    = 200_000;
const PA_RESET  = 101_325;

// 공유 상태 — 모든 연결 클라이언트에 동일하게 적용
const state = {
  sensor    : 'BMP280',
  firmware  : '1.1.0-emulator',
  pressurePa: PA_RESET,
  tempC     : 25.0,
  startedAt : Date.now(),
};

/* ── 유틸 ──────────────────────────────────────────── */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sendHello(ws) {
  ws.send(JSON.stringify({ t: 's', sensor: state.sensor, fw: state.firmware }));
}

function sendData(ws) {
  ws.send(JSON.stringify({
    t  : 'd',
    p  : state.pressurePa,
    T  : state.tempC,
    ts : Date.now() - state.startedAt,
  }));
}

function broadcastData() {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) sendData(client);
  }
}

/* ── CLI 키 입력 ────────────────────────────────────── */

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if (!key) return;

  let delta = 0;
  if      (key.name === 'up')    delta = +1000;
  else if (key.name === 'down')  delta = -1000;
  else if (key.name === 'right') delta = +100;
  else if (key.name === 'left')  delta = -100;
  else if (key.name === 'r')     { state.pressurePa = PA_RESET; printState(); return; }
  else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    console.log('\n[emulator] 종료');
    process.exit(0);
  }

  if (delta !== 0) {
    state.pressurePa = clamp(state.pressurePa + delta, PA_MIN, PA_MAX);
    printState();
  }
});

function printState() {
  process.stdout.write(
    `\r[emulator] p=${state.pressurePa} Pa  T=${state.tempC}°C  (↑↓±1000 ←→±100 r=리셋 q=종료)  `
  );
}

/* ── WebSocket 서버 ─────────────────────────────────── */

const wss = new WebSocketServer({ port: PORT });

console.log(`[emulator] WebSocket 서버 대기 중 → ws://localhost:${PORT}`);
printState();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`\n[emulator] ▶ 연결됨 (${ip})`);

  sendHello(ws);

  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) sendData(ws);
  }, REPORT_MS);

  ws.on('message', (data) => {
    console.log(`\n[emulator] ← 수신: ${data.toString()}`);
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
