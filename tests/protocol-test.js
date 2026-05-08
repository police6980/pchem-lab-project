// Phase 5.6: protocol.js parseV11Line 단위 검증 (Node.js node:test)
//
// 권위 = web/js/protocol.js (browser <script> 로드 + 전역 함수).
// 본 테스트는 함수 본체를 자립형으로 복사 (sensor-guard-test 패턴).
// 변경 시 양쪽 동기화 필수.
//
// 실행: node --test tests/protocol-test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────
// 함수 복사 (web/js/protocol.js)
// ─────────────────────────────────────────────────────────

function parseV11Line(line, emitData, emitEvent) {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch (_) {
        emitEvent("error", `parse failed: ${line.slice(0, 80)}`);
        return { handled: true, isHello: false };
    }
    if (typeof msg.t === "string") {
        switch (msg.t) {
            case "d": {
                const value = (typeof msg.p === "number")
                    ? msg.p / 1000
                    : (typeof msg.value === "number" ? msg.value : null);
                emitData({
                    sensor: msg.sensor || "pressure",
                    value,
                    unit: "kPa",
                    timestamp: (typeof msg.ts === "number") ? msg.ts : 0,
                    ch: (typeof msg.ch === "number") ? msg.ch : 0,
                    raw: msg,
                });
                return { handled: true, isHello: false };
            }
            case "s": {
                const version = Array.isArray(msg.channels) ? "1.2" : "1.1";
                emitEvent("connect", {
                    version,
                    sensor: msg.sensor || null,
                    fw: msg.fw || null,
                    channels: msg.channels || null,
                });
                return { handled: true, isHello: true };
            }
            case "c": {
                const p0kPa = (typeof msg.p0 === "number") ? msg.p0 / 1000 : null;
                const ch = (typeof msg.ch === "number") ? msg.ch : 0;
                emitEvent("calibrated", { ch, p0kPa });
                return { handled: true, isHello: false };
            }
            case "e": {
                const payload = { msg: msg.msg || "unknown firmware error" };
                if (typeof msg.ch === "number") payload.ch = msg.ch;
                emitEvent("error", payload);
                return { handled: true, isHello: false };
            }
            default:
                return { handled: true, isHello: false };
        }
    }
    if (typeof msg.sensor === "string" && typeof msg.value === "number") {
        msg.ch = 0;
        emitData(msg);
        return { handled: true, isHello: false };
    }
    emitEvent("error", `malformed line: ${line.slice(0, 80)}`);
    return { handled: true, isHello: false };
}

// 헬퍼 — 캡처 mock
function capture() {
    const data = [];
    const events = [];
    return {
        emitData: (d) => data.push(d),
        emitEvent: (type, payload) => events.push({ type, payload }),
        data,
        events,
    };
}

// ─────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────

test('데이터 프레임 (t=d) — Pa → kPa 변환 + ch 기본 0', () => {
    const c = capture();
    const r = parseV11Line('{"t":"d","p":101325,"T":25.0,"ts":12345}', c.emitData, c.emitEvent);
    assert.deepEqual(r, { handled: true, isHello: false });
    assert.strictEqual(c.data.length, 1);
    assert.strictEqual(c.data[0].value, 101.325);
    assert.strictEqual(c.data[0].unit, 'kPa');
    assert.strictEqual(c.data[0].ch, 0);
    assert.strictEqual(c.data[0].timestamp, 12345);
});

test('데이터 프레임 — ch 명시 시 그대로 (멀티채널 v1.2)', () => {
    const c = capture();
    parseV11Line('{"t":"d","p":200000,"T":25.1,"ts":12345,"ch":1}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data[0].ch, 1);
    assert.strictEqual(c.data[0].value, 200);
});

test('hello (t=s) — channels 배열 있음 → v1.2', () => {
    const c = capture();
    const r = parseV11Line(
        '{"t":"s","sensor":"DFRobot-1.6MPa","fw":"1.2.0-emulator","channels":[{"ch":0},{"ch":1}]}',
        c.emitData, c.emitEvent
    );
    assert.strictEqual(r.isHello, true);
    assert.strictEqual(c.events.length, 1);
    assert.strictEqual(c.events[0].type, 'connect');
    assert.strictEqual(c.events[0].payload.version, '1.2');
    assert.strictEqual(c.events[0].payload.channels.length, 2);
});

test('hello — channels 없으면 v1.1 (단일 채널)', () => {
    const c = capture();
    parseV11Line('{"t":"s","sensor":"DFRobot","fw":"1.1.0"}', c.emitData, c.emitEvent);
    assert.strictEqual(c.events[0].payload.version, '1.1');
    assert.strictEqual(c.events[0].payload.channels, null);
});

test('calib ACK (t=c) — Pa → kPa 변환 + ch 분리', () => {
    const c = capture();
    parseV11Line('{"t":"c","p0":101325,"ch":0}', c.emitData, c.emitEvent);
    assert.strictEqual(c.events[0].type, 'calibrated');
    assert.strictEqual(c.events[0].payload.p0kPa, 101.325);
    assert.strictEqual(c.events[0].payload.ch, 0);
});

test('error (t=e) — msg + ch payload', () => {
    const c = capture();
    parseV11Line('{"t":"e","ch":1,"msg":"sensor_disconnected"}', c.emitData, c.emitEvent);
    assert.strictEqual(c.events[0].type, 'error');
    assert.strictEqual(c.events[0].payload.msg, 'sensor_disconnected');
    assert.strictEqual(c.events[0].payload.ch, 1);
});

test('JSON parse 실패 — error event + 본문 잘라서 보고', () => {
    const c = capture();
    const r = parseV11Line('{"t":"d","p":101', c.emitData, c.emitEvent);
    assert.strictEqual(r.handled, true);
    assert.strictEqual(c.events[0].type, 'error');
    assert.match(c.events[0].payload, /^parse failed:/);
});

test('미지 타입 (t=x) — handled true / isHello false / data emit X', () => {
    const c = capture();
    parseV11Line('{"t":"x","foo":1}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data.length, 0);
});

test('v1.0 fallback — t 없고 sensor + value 만', () => {
    const c = capture();
    parseV11Line('{"sensor":"pressure","value":150.5}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data.length, 1);
    assert.strictEqual(c.data[0].value, 150.5);
    assert.strictEqual(c.data[0].ch, 0);
});

test('malformed — t 없고 sensor / value 도 없음', () => {
    const c = capture();
    parseV11Line('{"random":"data"}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data.length, 0);
    assert.strictEqual(c.events[0].type, 'error');
    assert.match(c.events[0].payload, /^malformed line:/);
});

test('데이터 프레임 — p 누락 + value 있음 fallback', () => {
    const c = capture();
    parseV11Line('{"t":"d","value":99.5,"ts":1}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data[0].value, 99.5);
});

test('데이터 프레임 — p 도 value 도 누락 → value null', () => {
    const c = capture();
    parseV11Line('{"t":"d","ts":1}', c.emitData, c.emitEvent);
    assert.strictEqual(c.data[0].value, null);
});
