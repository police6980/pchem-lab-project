// Web Serial API communication with ESP32 firmware

class SensorSource {
    constructor() {
        this._callbacks = [];
        this._eventHandlers = {};
    }

    onData(callback) {
        this._callbacks.push(callback);
    }

    on(type, callback) {
        if (!this._eventHandlers[type]) this._eventHandlers[type] = [];
        this._eventHandlers[type].push(callback);
    }

    _emit(data) {
        for (const cb of this._callbacks) cb(data);
    }

    _emitEvent(type, payload) {
        const handlers = this._eventHandlers[type];
        if (!handlers) return;
        for (const cb of handlers) cb(payload);
    }

    async connect() {
        throw new Error("SensorSource.connect() must be implemented by subclass");
    }

    async disconnect() {
        throw new Error("SensorSource.disconnect() must be implemented by subclass");
    }

    async sendCalib() { /* no-op by default */ }
    async sendConfig(rateMs) { /* no-op by default */ }
}

class MockSensorSource extends SensorSource {
    constructor(initialPressure = 101.3) {
        super();
        this._pressure = initialPressure;
        this._interval = null;
        this._intervalMs = 50;
        this._noiseSigma = 0.1;
        this.connected = false;
    }

    setPressure(value) {
        this._pressure = value;
    }

    _startInterval() {
        if (this._interval !== null) return;
        this._interval = setInterval(() => {
            const noisy = this._pressure + this._gaussianNoise() * this._noiseSigma;
            this._emit({
                sensor: "pressure",
                value: noisy,
                unit: "kPa",
                timestamp: performance.now()
            });
        }, this._intervalMs);
    }

    _stopInterval() {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    async connect() {
        if (this.connected) return;
        this._startInterval();
        this.connected = true;
        this._emitEvent("connect", {
            version: "mock",
            sensor: "MockSensor",
            fw: "mock",
        });
    }

    async disconnect() {
        if (!this.connected) return;
        this._stopInterval();
        this.connected = false;
        this._emitEvent("disconnect");
    }

    async sendCalib() {
        // Fake calibration: use current pressure as the zero reference.
        this._emitEvent("calibrated", this._pressure);
    }

    async sendConfig(rateMs) {
        const r = Math.max(10, Math.min(2000, Number(rateMs) || 50));
        this._intervalMs = r;
        if (this.connected) {
            this._stopInterval();
            this._startInterval();
        }
    }

    _gaussianNoise() {
        // Box-Muller: two uniforms -> one standard-normal sample
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}

class WebSerialSensorSource extends SensorSource {
    static BAUD_RATE = 115200;
    static HELLO_TIMEOUT_MS = 3000;
    static PING_INTERVAL_MS = 2000;
    static LINE_BUFFER_MAX = 4096;

    constructor() {
        super();
        this._port = null;
        this._reader = null;
        this._writer = null;
        this._readLoopPromise = null;
        this._pingTimer = null;
        this._helloTimer = null;
        this._lineBuffer = "";
        this._decoder = new TextDecoder();
        this._encoder = new TextEncoder();

        this.connected = false;
        this.sensorLabel = null;
        this.firmwareVer = null;
        this.isV11 = false;
        this.p0 = null;
    }

    // Control events (connect / disconnect / calibrated / error) use the base
    // class's .on() / _emitEvent() channel. Data frames keep using onData /
    // _emit so MockSensor and WebSerial remain drop-in compatible for data
    // consumers.

    async connect() {
        if (!("serial" in navigator)) {
            throw new Error("Web Serial API가 지원되지 않는 브라우저입니다. Chrome/Edge 최신 버전을 사용하세요.");
        }

        try {
            this._port = await navigator.serial.requestPort();
        } catch (e) {
            if (e.name === "NotFoundError") return;   // user cancelled the picker
            throw e;
        }

        await this._port.open({ baudRate: WebSerialSensorSource.BAUD_RATE });
        this.connected = true;
        this._writer = this._port.writable.getWriter();
        this._reader = this._port.readable.getReader();

        this._readLoopPromise = this._readLoop();

        // v1.0 fallback: if no "t":"s" hello within the timeout, assume legacy.
        this._helloTimer = setTimeout(() => {
            if (!this.isV11 && this.connected) {
                this._emitEvent("connect", { version: "1.0", sensor: null, fw: null });
            }
        }, WebSerialSensorSource.HELLO_TIMEOUT_MS);

        // Keep-alive ping. v1.0 firmware silently ignores unknown lines, so
        // sending unconditionally is safe.
        this._pingTimer = setInterval(() => {
            this.sendPing().catch(err =>
                this._emitEvent("error", `ping failed: ${err.message || err}`)
            );
        }, WebSerialSensorSource.PING_INTERVAL_MS);
    }

    async disconnect() {
        this.connected = false;

        if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
        if (this._helloTimer) { clearTimeout(this._helloTimer); this._helloTimer = null; }

        if (this._reader) {
            try { await this._reader.cancel(); } catch (_) {}
            try { this._reader.releaseLock(); } catch (_) {}
            this._reader = null;
        }
        if (this._writer) {
            try { await this._writer.close(); } catch (_) {}
            try { this._writer.releaseLock(); } catch (_) {}
            this._writer = null;
        }
        if (this._readLoopPromise) {
            try { await this._readLoopPromise; } catch (_) {}
            this._readLoopPromise = null;
        }
        if (this._port) {
            try { await this._port.close(); } catch (_) {}
            this._port = null;
        }

        this.sensorLabel = null;
        this.firmwareVer = null;
        this.isV11 = false;
        this.p0 = null;
        this._lineBuffer = "";

        this._emitEvent("disconnect");
    }

    async _readLoop() {
        try {
            while (this.connected) {
                const { value, done } = await this._reader.read();
                if (done) break;
                this._processChunk(value);
            }
        } catch (err) {
            if (this.connected) {
                this._emitEvent("error", `read loop: ${err.message || err}`);
            }
        }
    }

    _processChunk(uint8Array) {
        this._lineBuffer += this._decoder.decode(uint8Array, { stream: true });

        if (this._lineBuffer.length > WebSerialSensorSource.LINE_BUFFER_MAX) {
            this._emitEvent("error", "line buffer overflow, reset");
            this._lineBuffer = "";
            return;
        }

        let idx;
        while ((idx = this._lineBuffer.indexOf("\n")) !== -1) {
            const line = this._lineBuffer.slice(0, idx).trim();
            this._lineBuffer = this._lineBuffer.slice(idx + 1);
            if (line) this._parseLine(line);
        }
    }

    _parseLine(line) {
        // Delegate to shared v1.1 parser (protocol.js). Hello handling needs
        // source-specific side effects (clear fallback timer, remember label),
        // so we capture it by intercepting the emitEvent channel.
        let helloInfo = null;
        const emitEvent = (type, payload) => {
            if (type === "connect" && payload && payload.version === "1.1") {
                helloInfo = payload;
            }
            this._emitEvent(type, payload);
        };
        const { isHello } = parseV11Line(
            line,
            (frame) => this._emit(frame),
            emitEvent
        );
        if (isHello) {
            this.isV11 = true;
            this.sensorLabel = helloInfo?.sensor || null;
            this.firmwareVer = helloInfo?.fw || null;
            if (this._helloTimer) {
                clearTimeout(this._helloTimer);
                this._helloTimer = null;
            }
        }
    }

    async _sendJson(obj) {
        if (!this._writer) throw new Error("not connected");
        await this._writer.write(this._encoder.encode(JSON.stringify(obj) + "\n"));
    }

    async sendPing() {
        return this._sendJson({ t: "ping" });
    }

    async sendCalib() {
        return this._sendJson({ t: "calib" });
    }

    async sendConfig(rateMs) {
        return this._sendJson({ t: "cfg", rate: rateMs });
    }
}

// WebSocketSensorSource — 개발용 펌웨어 에뮬레이터 연결
// (tools/firmware-emulator, ws://localhost:8787). v1.1 프로토콜은
// protocol.js 공통 파서로 처리해 WebSerial 경로와 동일한 의미론을 유지.
class WebSocketSensorSource extends SensorSource {
    static DEFAULT_URL = "ws://localhost:8787";
    static HELLO_TIMEOUT_MS = 3000;
    static PING_INTERVAL_MS = 2000;

    constructor(url = WebSocketSensorSource.DEFAULT_URL) {
        super();
        this._url = url;
        this._ws = null;
        this._pingTimer = null;
        this._helloTimer = null;
        this.connected = false;
        this.isV11 = false;
        this.sensorLabel = null;
        this.firmwareVer = null;
        this.p0 = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            try {
                this._ws = new WebSocket(this._url);
            } catch (e) {
                reject(new Error(`WebSocket 생성 실패: ${e.message || e}`));
                return;
            }

            this._helloTimer = setTimeout(() => {
                if (!this.isV11 && this.connected) {
                    this._emitEvent("connect", { version: "1.0", sensor: null, fw: null });
                }
            }, WebSocketSensorSource.HELLO_TIMEOUT_MS);

            this._ws.onopen = () => {
                this.connected = true;
                this._pingTimer = setInterval(() => {
                    this._sendJson({ t: "ping" });
                }, WebSocketSensorSource.PING_INTERVAL_MS);
                settled = true;
                resolve();
            };

            this._ws.onmessage = (event) => {
                const line = (typeof event.data === "string" ? event.data : "").trim();
                if (!line) return;
                let helloInfo = null;
                const emitEvent = (type, payload) => {
                    if (type === "connect" && payload && payload.version === "1.1") {
                        helloInfo = payload;
                    }
                    this._emitEvent(type, payload);
                };
                const { isHello } = parseV11Line(
                    line,
                    (frame) => this._emit(frame),
                    emitEvent
                );
                if (isHello) {
                    this.isV11 = true;
                    this.sensorLabel = helloInfo?.sensor || null;
                    this.firmwareVer = helloInfo?.fw || null;
                    if (this._helloTimer) {
                        clearTimeout(this._helloTimer);
                        this._helloTimer = null;
                    }
                }
            };

            this._ws.onclose = () => {
                const wasConnected = this.connected;
                this._clearTimers();
                this.connected = false;
                this._ws = null;
                if (wasConnected) this._emitEvent("disconnect");
            };

            this._ws.onerror = () => {
                this._clearTimers();
                const msg = `WebSocket 연결 실패 (${this._url})`;
                if (!settled) {
                    settled = true;
                    reject(new Error(msg));
                } else {
                    this._emitEvent("error", msg);
                }
            };
        });
    }

    async disconnect() {
        this._clearTimers();
        if (this._ws) {
            try { this._ws.close(); } catch (_) {}
            this._ws = null;
        }
        if (this.connected) {
            this.connected = false;
            this._emitEvent("disconnect");
        }
        this.isV11 = false;
        this.sensorLabel = null;
        this.firmwareVer = null;
        this.p0 = null;
    }

    _clearTimers() {
        if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
        if (this._helloTimer) { clearTimeout(this._helloTimer); this._helloTimer = null; }
    }

    _sendJson(obj) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
        try { this._ws.send(JSON.stringify(obj)); } catch (_) {}
    }

    async sendPing()          { this._sendJson({ t: "ping" }); }
    async sendCalib()         { this._sendJson({ t: "calib" }); }
    async sendConfig(rateMs)  { this._sendJson({ t: "cfg", rate: rateMs }); }
}

// Manager wraps a swappable SensorSource. Persists onData / on(...) subscriptions
// across mode switches so consumers register once and don't need to re-wire
// callbacks when mock↔real toggles.
function createSensorManager(initialPressure = 101.3) {
    const manager = {
        source: null,
        mode: null,
        _dataCallbacks: [],
        _eventCallbacks: {},
        _initialPressure: initialPressure,

        async setMode(mode) {
            if (this.mode === mode) return;
            if (this.source) {
                try { await this.source.disconnect(); } catch (_) {}
            }

            if (mode === "real") {
                this.source = new WebSerialSensorSource();
            } else if (mode === "ws") {
                this.source = new WebSocketSensorSource();
            } else {
                this.source = new MockSensorSource(this._initialPressure);
            }
            this.mode = mode;

            // Re-attach persisted subscriptions to the new source.
            for (const cb of this._dataCallbacks) this.source.onData(cb);
            for (const [type, cbs] of Object.entries(this._eventCallbacks)) {
                for (const cb of cbs) this.source.on(type, cb);
            }

            if (mode === "mock") {
                // Mock connects immediately — no port picker.
                await this.source.connect();
            } else if (mode === "ws") {
                // WebSocket(에뮬레이터) — 사용자 제스처 불필요, 즉시 접속.
                // 접속 실패는 호출자(UI click handler .catch)가 받아서 처리.
                await this.source.connect();
            }
            // Real: wait for user to click [🔌 포트 연결].
        },

        onData(cb) {
            this._dataCallbacks.push(cb);
            if (this.source) this.source.onData(cb);
        },

        on(type, cb) {
            if (!this._eventCallbacks[type]) this._eventCallbacks[type] = [];
            this._eventCallbacks[type].push(cb);
            if (this.source) this.source.on(type, cb);
        },

        async sendCalib() {
            if (this.source) return this.source.sendCalib();
        },

        async sendConfig(rateMs) {
            if (this.source) return this.source.sendConfig(rateMs);
        },
    };
    return manager;
}
