// protocol.js — v1.2 시리얼 프로토콜 공통 파서
// WebSerialSensorSource · WebSocketSensorSource 양쪽이 공유한다.
// classic script(비-ESM) 로드를 가정 → 전역 함수 parseV11Line 노출.
//
// parseV11Line(line, emitData, emitEvent)
//   - line      : JSON 문자열 (개행 제거된 상태)
//   - emitData  : (frame) => void — SensorSource._emit 대응
//   - emitEvent : (type, payload) => void — SensorSource._emitEvent 대응
//   - returns   : { handled: boolean, isHello: boolean }
//
// v1.2: ch 필드로 멀티채널 지원. ch 없으면 0 (v1.1 하위 호환).
// 에뮬레이터/실 펌웨어는 압력을 Pa(정수)로 보내므로, 'd' 프레임에서
// Pa → kPa 변환을 여기서 일괄 처리한다 (기존 MockSensorSource/UI는 kPa 기준).

function parseV11Line(line, emitData, emitEvent) {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch (_) {
        emitEvent("error", `parse failed: ${line.slice(0, 80)}`);
        return { handled: true, isHello: false };
    }

    // v1.1/v1.2 타입 기반 라우팅
    if (typeof msg.t === "string") {
        switch (msg.t) {
            case "d": {
                const value = (typeof msg.p === "number")
                    ? msg.p / 1000                // Pa → kPa
                    : (typeof msg.value === "number" ? msg.value : null);
                emitData({
                    sensor: msg.sensor || "pressure",
                    value,
                    unit: "kPa",
                    timestamp: (typeof msg.ts === "number") ? msg.ts : performance.now(),
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
                console.warn(`[protocol] unknown message type: ${msg.t}`);
                return { handled: true, isHello: false };
        }
    }

    // v1.0 fallback: {sensor, value, unit, timestamp}
    if (typeof msg.sensor === "string" && typeof msg.value === "number") {
        msg.ch = 0;
        emitData(msg);
        return { handled: true, isHello: false };
    }

    emitEvent("error", `malformed line: ${line.slice(0, 80)}`);
    return { handled: true, isHello: false };
}
