// Web Serial API communication with ESP32 firmware — v1.2 멀티채널 지원

const P_ATM_KPA = 101.325;  // 표준 대기압 (캘리브 기준값)

// ── ws/real outlier 가드 (Phase 5.4) ─────────────────────
// NaN / undefined → silent drop. 음수 → 이전 유효값 유지 (없으면 drop).
// saturation ≥ 1600 → clip. spike → 3-sample median filter.
// mock 영향 X (σ=0.1 kPa → 가드 발동 확률 0). silent — UI 알림 X.
const GUARD_NEGATIVE_THRESHOLD_KPA = 0;
const GUARD_SATURATION_KPA         = 1600;
const GUARD_MEDIAN_WINDOW          = 3;
const GUARD_WARN_INTERVAL_MS       = 1000;

function median3(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

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

    async sendCalib(ch) { /* no-op by default */ }
    async sendConfig(rateMs) { /* no-op by default */ }
    getChannels() { return null; }
}

class MockSensorSource extends SensorSource {
    constructor(config = {}) {
        super();
        // config: number (하위 호환) 또는 { channels, intervalMs?, noiseSigma? }
        if (typeof config === "number") {
            this._channels = [{ ch: 0, pressure: config, label: "default" }];
        } else if (config.channels) {
            this._channels = config.channels.map(c => ({
                ch: c.ch ?? 0,
                pressure: c.pressure ?? 101.3,
                label: c.label ?? `ch${c.ch ?? 0}`,
            }));
        } else {
            this._channels = [{ ch: 0, pressure: config.initialPressure ?? 101.3, label: "default" }];
        }
        this._interval = null;
        // Phase 5.4 commit iv (e-4): params.dalton.sensor 외부화 (caller 가 전달)
        this._intervalMs = (typeof config === "object" && config.intervalMs != null) ? config.intervalMs : 50;
        this._noiseSigma = (typeof config === "object" && config.noiseSigma != null) ? config.noiseSigma : 0.1;
        this.connected = false;
    }

    setPressure(value, ch = 0) {
        const c = this._channels.find(x => x.ch === ch);
        if (c) c.pressure = value;
    }

    // Phase 5.4 commit iii: 일원화 — 시뮬 본체에서 매 frame 호출.
    // interval 우회, 즉시 1회 emit. 노이즈 추가 X (mock deterministic 보존).
    // 노이즈는 interval 경로 (_startInterval) 에서만 적용.
    setPressureImmediate(value, ch = 0) {
        const c = this._channels.find(x => x.ch === ch);
        if (c) c.pressure = value;
        this._emit({
            sensor: "pressure",
            value: value,
            unit: "kPa",
            timestamp: performance.now(),
            ch: ch,
        });
    }

    _startInterval() {
        if (this._interval !== null) return;
        this._interval = setInterval(() => {
            for (const c of this._channels) {
                const noisy = c.pressure + this._gaussianNoise() * this._noiseSigma;
                this._emit({
                    sensor: "pressure",
                    value: noisy,
                    unit: "kPa",
                    timestamp: performance.now(),
                    ch: c.ch,
                });
            }
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
        const info = { version: "mock", sensor: "MockSensor", fw: "mock" };
        if (this._channels.length > 1) {
            info.channels = this._channels.map(c => ({ ch: c.ch, sensor: "MockSensor", label: c.label }));
        }
        this._emitEvent("connect", info);
    }

    async disconnect() {
        if (!this.connected) return;
        this._stopInterval();
        this.connected = false;
        this._emitEvent("disconnect");
    }

    async sendCalib(ch) {
        if (typeof ch === "number") {
            const c = this._channels.find(x => x.ch === ch);
            if (c) this._emitEvent("calibrated", { ch: c.ch, p0kPa: c.pressure });
        } else {
            for (const c of this._channels) {
                this._emitEvent("calibrated", { ch: c.ch, p0kPa: c.pressure });
            }
        }
    }

    async sendConfig(rateMs) {
        const r = Math.max(10, Math.min(2000, Number(rateMs) || 50));
        this._intervalMs = r;
        if (this.connected) {
            this._stopInterval();
            this._startInterval();
        }
    }

    getChannels() {
        return this._channels.map(c => ({ ch: c.ch, sensor: "MockSensor", label: c.label }));
    }

    _gaussianNoise() {
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
        this._channels = null;
        this.p0 = null;
    }

    async connect() {
        if (!("serial" in navigator)) {
            throw new Error("Web Serial API가 지원되지 않는 브라우저입니다. Chrome/Edge 최신 버전을 사용하���요.");
        }

        try {
            this._port = await navigator.serial.requestPort();
        } catch (e) {
            if (e.name === "NotFoundError") return;
            throw e;
        }

        await this._port.open({ baudRate: WebSerialSensorSource.BAUD_RATE });
        this.connected = true;
        this._writer = this._port.writable.getWriter();
        this._reader = this._port.readable.getReader();

        this._readLoopPromise = this._readLoop();

        this._helloTimer = setTimeout(() => {
            if (!this.isV11 && this.connected) {
                this._emitEvent("connect", { version: "1.0", sensor: null, fw: null });
            }
        }, WebSerialSensorSource.HELLO_TIMEOUT_MS);

        this._pingTimer = setInterval(() => {
            this.sendPing().catch(err =>
                this._emitEvent("error", { msg: `ping failed: ${err.message || err}` })
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
        this._channels = null;
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
                this._emitEvent("error", { msg: `read loop: ${err.message || err}` });
            }
        }
    }

    _processChunk(uint8Array) {
        this._lineBuffer += this._decoder.decode(uint8Array, { stream: true });

        if (this._lineBuffer.length > WebSerialSensorSource.LINE_BUFFER_MAX) {
            this._emitEvent("error", { msg: "line buffer overflow, reset" });
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
        let helloInfo = null;
        const emitEvent = (type, payload) => {
            if (type === "connect" && payload &&
                (payload.version === "1.1" || payload.version === "1.2")) {
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
            this._channels = helloInfo?.channels || null;
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

    async sendCalib(ch) {
        const msg = { t: "calib" };
        if (typeof ch === "number") msg.ch = ch;
        return this._sendJson(msg);
    }

    async sendConfig(rateMs) {
        return this._sendJson({ t: "cfg", rate: rateMs });
    }

    getChannels() { return this._channels; }
}

// WebSocketSensorSource — 개발용 펌웨어 에뮬레이터 연결
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
        this._channels = null;
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
                    if (type === "connect" && payload &&
                        (payload.version === "1.1" || payload.version === "1.2")) {
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
                    this._channels = helloInfo?.channels || null;
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
                    this._emitEvent("error", { msg });
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
        this._channels = null;
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
    async sendCalib(ch) {
        const msg = { t: "calib" };
        if (typeof ch === "number") msg.ch = ch;
        this._sendJson(msg);
    }
    async sendConfig(rateMs)  { this._sendJson({ t: "cfg", rate: rateMs }); }
    getChannels() { return this._channels; }
}

// Manager wraps a swappable SensorSource with calibration pipeline.
// Persists onData / on(...) subscriptions across mode switches.
// v1.2: 멀티채널 지원 + 캘리브 후처리 (zero offset).
function createSensorManager(config = 101.3) {
    // config: number (하위 호환) 또는 { initialPressure, channels: [...], mockIntervalMs?, mockNoiseSigma? }
    const isLegacy = typeof config === "number";
    const initialPressure = isLegacy ? config : (config.initialPressure ?? 101.3);
    const channelConfig = isLegacy ? null : (config.channels || null);
    // Phase 5.4 commit iv (e-4): MockSensorSource 외부화 옵션 pass-through
    const mockIntervalMs = isLegacy ? null : (config.mockIntervalMs ?? null);
    const mockNoiseSigma = isLegacy ? null : (config.mockNoiseSigma ?? null);

    const manager = {
        source: null,
        mode: null,
        _dataCallbacks: [],
        _channelCallbacks: {},   // { [ch]: [cb, ...] }
        _eventCallbacks: {},
        _calibOffsets: {},       // { [ch]: offset_kPa }
        _initialPressure: initialPressure,
        _channelConfig: channelConfig,
        // Phase 5.4: outlier 가드 state (채널별)
        _lastValidValue: {},     // { [ch]: lastValidKPa }
        _medianBuffer: {},       // { [ch]: [v1, v2, v3] }
        _lastWarnTime: {},       // { [ch_type]: timestampMs }

        _rateLimitedWarn(ch, type, msg) {
            const key = `${ch}_${type}`;
            const now = Date.now();
            const last = this._lastWarnTime[key] || 0;
            if (now - last >= GUARD_WARN_INTERVAL_MS) {
                console.warn(`[outlier guard] ${msg}`);
                this._lastWarnTime[key] = now;
            }
        },

        // 가드 → 캘리브 순서 (clean 값에 캘리브). 반환 null = silent drop.
        _applyOutlierGuard(rawData) {
            const ch = rawData.ch ?? 0;

            // 1. NaN / undefined / null — silent drop
            if (rawData.value == null || isNaN(rawData.value)) {
                return null;
            }

            // 2. 음수 (≤ 0 kPa) — 이전 유효값 유지, 없으면 drop
            if (rawData.value <= GUARD_NEGATIVE_THRESHOLD_KPA) {
                this._rateLimitedWarn(ch, "negative",
                    `ch${ch} 음수 reject: ${rawData.value.toFixed(2)} kPa`);
                if (this._lastValidValue[ch] != null) {
                    rawData.value = this._lastValidValue[ch];
                } else {
                    return null;
                }
            }

            // 3. saturation (≥ 1600 kPa) clip
            if (rawData.value >= GUARD_SATURATION_KPA) {
                this._rateLimitedWarn(ch, "saturation",
                    `ch${ch} saturation clip: ${rawData.value.toFixed(2)} → ${GUARD_SATURATION_KPA} kPa`);
                rawData.value = GUARD_SATURATION_KPA;
            }

            // 4. median(3) spike filter
            if (!this._medianBuffer[ch]) this._medianBuffer[ch] = [];
            this._medianBuffer[ch].push(rawData.value);
            if (this._medianBuffer[ch].length > GUARD_MEDIAN_WINDOW) {
                this._medianBuffer[ch].shift();
            }
            if (this._medianBuffer[ch].length === GUARD_MEDIAN_WINDOW) {
                rawData.value = median3(this._medianBuffer[ch]);
            }

            // 5. 마지막 유효값 갱신
            this._lastValidValue[ch] = rawData.value;
            return rawData;
        },

        _applyCalibration(data) {
            const ch = data.ch ?? 0;
            const offset = this._calibOffsets[ch] ?? 0;
            if (offset === 0) return data;
            return {
                ...data,
                raw_kPa: data.value,
                value: data.value - offset,
            };
        },

        _dispatchData(rawData) {
            const guarded = this._applyOutlierGuard(rawData);
            if (guarded == null) return;  // silent drop
            const data = this._applyCalibration(guarded);
            for (const cb of this._dataCallbacks) cb(data);
            const ch = data.ch ?? 0;
            const chCbs = this._channelCallbacks[ch];
            if (chCbs) {
                for (const cb of chCbs) cb(data);
            }
        },

        _handleCalibrated(payload) {
            // v1.2: { ch, p0kPa }  v1.1 호환: number
            const ch = (typeof payload === "object" && payload !== null) ? (payload.ch ?? 0) : 0;
            const p0 = (typeof payload === "object" && payload !== null) ? payload.p0kPa : payload;
            if (typeof p0 === "number") {
                this._calibOffsets[ch] = p0 - P_ATM_KPA;
            }
        },

        async setMode(mode) {
            if (this.mode === mode && this.source?.connected) return;
            if (this.source) {
                try { await this.source.disconnect(); } catch (_) {}
            }

            if (mode === "real") {
                this.source = new WebSerialSensorSource();
            } else if (mode === "ws") {
                this.source = new WebSocketSensorSource();
            } else {
                // Phase 5.4 commit iv (e-4): mockIntervalMs / mockNoiseSigma 전달
                const mockOpts = {};
                if (mockIntervalMs != null) mockOpts.intervalMs = mockIntervalMs;
                if (mockNoiseSigma != null) mockOpts.noiseSigma = mockNoiseSigma;
                this.source = channelConfig
                    ? new MockSensorSource({ channels: channelConfig, ...mockOpts })
                    : new MockSensorSource(typeof this._initialPressure === "number"
                        ? this._initialPressure
                        : { initialPressure: this._initialPressure, ...mockOpts });
            }
            this.mode = mode;
            this._calibOffsets = {};
            // Phase 5.4: 모드 전환 시 outlier 가드 state 리셋 (이전 잔재 방지)
            this._lastValidValue = {};
            this._medianBuffer = {};
            this._lastWarnTime = {};

            // Data callbacks: route through calibration pipeline
            this.source.onData((rawData) => this._dispatchData(rawData));

            // Intercept calibrated events for offset computation
            this.source.on("calibrated", (payload) => this._handleCalibrated(payload));

            // Re-attach persisted event subscriptions (except calibrated, handled above)
            for (const [type, cbs] of Object.entries(this._eventCallbacks)) {
                for (const cb of cbs) this.source.on(type, cb);
            }

            if (mode === "mock") {
                await this.source.connect();
            } else if (mode === "ws") {
                await this.source.connect();
            }
            // Real: wait for user to click [🔌 포트 연결].
        },

        // 모든 채널 데이터 수신 (보일 하위 호환)
        onData(cb) {
            this._dataCallbacks.push(cb);
        },

        // 특정 채널만 필터링하여 수신
        onChannelData(ch, cb) {
            if (!this._channelCallbacks[ch]) this._channelCallbacks[ch] = [];
            this._channelCallbacks[ch].push(cb);
        },

        on(type, cb) {
            if (!this._eventCallbacks[type]) this._eventCallbacks[type] = [];
            this._eventCallbacks[type].push(cb);
            if (this.source) this.source.on(type, cb);
        },

        async sendCalib(ch) {
            if (this.source) return this.source.sendCalib(ch);
        },

        async sendConfig(rateMs) {
            if (this.source) return this.source.sendConfig(rateMs);
        },

        getChannels() {
            return this.source?.getChannels() || null;
        },

        getCalibOffset(ch = 0) {
            return this._calibOffsets[ch] ?? 0;
        },

        isCalibrated(ch = 0) {
            return ch in this._calibOffsets;
        },
    };
    return manager;
}
