/*
 * Phase 3 펌웨어 에뮬레이터 (Step 3-3)
 *
 * 실제 ESP32 + BMP280 펌웨어 (firmware/boyle/boyle.ino) 의
 * Node.js 포팅본. v1.1 프로토콜 JSON을 WebSocket으로 전송.
 *
 * 현재 단계: hello + 데이터 프레임 주기 전송 + CLI 키 조작.
 *   - ↑↓: ±10 kPa, ←→: ±1 kPa, r: 리셋, q: 종료
 *   - 범위 81~400 kPa (박스 기하 하한 + 학생 손 압축 현실적 상한)
 *
 * 실행: npm start  (또는  node emulator.js)
 */

import { WebSocketServer } from 'ws';
import * as readline from 'readline';

const PORT      = 8787;
const REPORT_MS = 200;   // 5Hz
const PA_MIN    = 81_000;    // 81 kPa — 박스 시각화 하한(BOX_MAX_WIDTH=880) 과 일치
const PA_MAX    = 400_000;   // 400 kPa — 학생 손 압축 현실적 상한 (실센서 1.6MPa 범위 내 안전)
const PA_RESET  = 101_325;   // 표준 대기압

// 공유 상태 — 모든 연결 클라이언트에 동일하게 적용
const state = {
  sensor    : 'BMP280',
  firmware  : '1.1.0-emulator',
  pressurePa: PA_RESET,
  tempC     : 25.0,
  p0        : null,          // calib 수신 시 현재 pressurePa 로 설정
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
  if      (key.name === 'up')    delta = +10_000;   // +10 kPa
  else if (key.name === 'down')  delta = -10_000;   // -10 kPa
  else if (key.name === 'right') delta = +1_000;    // +1 kPa
  else if (key.name === 'left')  delta = -1_000;    // -1 kPa
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
  const p0str = state.p0 !== null ? `  p0=${state.p0} Pa` : '';
  process.stdout.write(
    `\r[emulator] p=${state.pressurePa} Pa  T=${state.tempC}°C${p0str}  (↑↓±10kPa ←→±1kPa r=리셋 q=종료)  `
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

  let interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) sendData(ws);
  }, REPORT_MS);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.log(`\n[emulator] ← 파싱 실패: ${data.toString().slice(0, 50)}`);
      return;
    }

    // ping 은 빈번하므로 로그에서 제외 (조용한 keep-alive)
    if (msg.t !== 'ping') {
      console.log(`\n[emulator] ← 수신: ${JSON.stringify(msg)}`);
    }

    switch (msg.t) {
      case 'ping':
        // keep-alive — 응답 없음 (펌웨어와 동일)
        break;

      case 'calib': {
        state.p0 = state.pressurePa;
        ws.send(JSON.stringify({ t: 'c', p0: state.p0 }));
        console.log(`[emulator] → calib ACK: p0=${state.p0} Pa`);
        break;
      }

      case 'cfg': {
        const rate = Number(msg.rate);
        if (Number.isFinite(rate) && rate >= 50 && rate <= 5000) {
          clearInterval(interval);
          interval = setInterval(() => {
            if (ws.readyState === ws.OPEN) sendData(ws);
          }, rate);
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
