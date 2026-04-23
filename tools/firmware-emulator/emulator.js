/*
 * Phase 3 펌웨어 에뮬레이터 (스켈레톤)
 *
 * 실제 ESP32 + BMP280 펌웨어 (firmware/boyle/boyle.ino) 의
 * Node.js 포팅본. v1.1 프로토콜 JSON을 WebSocket으로 전송.
 *
 * 이번 단계: 연결 확인만. 데이터 프레임·조작은 후속 단계.
 *
 * 실행: npm start  (또는  node emulator.js)
 */

import { WebSocketServer } from 'ws';

const PORT = 8787;
const wss = new WebSocketServer({ port: PORT });

console.log(`[emulator] WebSocket 서버 대기 중 → ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[emulator] ▶ 연결됨 (${ip})`);

  // 연결되자마자 v1.1 hello 전송 (펌웨어 setup()과 동일한 동작)
  ws.send(JSON.stringify({
    t: 's',
    sensor: 'BMP280',
    fw: '1.1.0-emulator'
  }));

  ws.on('message', (data) => {
    console.log(`[emulator] ← 수신: ${data.toString()}`);
  });

  ws.on('close', () => {
    console.log('[emulator] ■ 연결 종료');
  });

  ws.on('error', (err) => {
    console.error('[emulator] 에러:', err.message);
  });
});
