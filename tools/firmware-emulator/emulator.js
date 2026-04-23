/*
 * Phase 3 펌웨어 에뮬레이터 (Step 3-2)
 *
 * 실제 ESP32 + BMP280 펌웨어 (firmware/boyle/boyle.ino) 의
 * Node.js 포팅본. v1.1 프로토콜 JSON을 WebSocket으로 전송.
 *
 * 현재 단계: hello + 데이터 프레임 주기 전송 (고정값).
 *   - 조작 인터페이스는 Step 3-3에서 추가 예정
 *
 * 실행: npm start  (또는  node emulator.js)
 */

import { WebSocketServer } from 'ws';

const PORT = 8787;
const REPORT_MS = 200;  // 5Hz (실제 펌웨어와 동일)

// 펌웨어 상태 (나중에 Step 3-3에서 조작 가능해짐)
const state = {
  sensor: 'BMP280',
  firmware: '1.1.0-emulator',
  pressurePa: 101325,   // 표준 대기압, 고정
  tempC: 25.0,           // 고정
  startedAt: Date.now(),
};

function sendHello(ws) {
  ws.send(JSON.stringify({
    t: 's',
    sensor: state.sensor,
    fw: state.firmware,
  }));
}

function sendData(ws) {
  const ts = Date.now() - state.startedAt;
  ws.send(JSON.stringify({
    t: 'd',
    p: state.pressurePa,
    T: state.tempC,
    ts: ts,
  }));
}

const wss = new WebSocketServer({ port: PORT });

console.log(`[emulator] WebSocket 서버 대기 중 → ws://localhost:${PORT}`);
console.log(`[emulator] 초기 상태: p=${state.pressurePa}Pa, T=${state.tempC}°C, ${REPORT_MS}ms 주기`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[emulator] ▶ 연결됨 (${ip})`);

  // 최초 hello
  sendHello(ws);

  // 주기적 데이터 프레임 전송
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      sendData(ws);
    }
  }, REPORT_MS);

  ws.on('message', (data) => {
    console.log(`[emulator] ← 수신: ${data.toString()}`);
    // Step 3-3에서 ping/calib/cfg 처리 추가 예정
  });

  ws.on('close', () => {
    clearInterval(interval);  // 메모리 누수 방지
    console.log('[emulator] ■ 연결 종료');
  });

  ws.on('error', (err) => {
    clearInterval(interval);
    console.error('[emulator] 에러:', err.message);
  });
});
