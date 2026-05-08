// Vernier Go Direct (BLE) bridge — godirect-js UMD CDN 의존.
// 단일 enabled 센서를 SensorSource frame shape (kPa)로 변환해 _emit.
// 멀티채널·캘리브·재연결은 1차 검증 범위 외.

class VernierBridgeSensorSource extends SensorSource {
    constructor() {
        super();
        this._device = null;
        this._sensor = null;
        this._onValueChanged = null;
        this.connected = false;
    }

    async connect() {
        // 가드 1: UMD 로드 확인 (defer script 미로딩 / CDN 차단 / 이름 mismatch 대비).
        const gd = window.godirect ?? window.GoDirect ?? window.goDirect;
        if (!gd || typeof gd.selectDevice !== "function") {
            throw new Error(
                "godirect-js UMD가 로드되지 않았습니다. " +
                "index <head>의 unpkg script 태그와 네트워크 차단 여부를 확인하세요. " +
                "(window 노출 이름: godirect / GoDirect / goDirect 중 하나여야 함)"
            );
        }

        // 가드 2: Web Bluetooth 지원 확인.
        if (!navigator.bluetooth) {
            throw new Error(
                "Web Bluetooth 미지원 브라우저입니다. Chrome 또는 Edge에서 실행하세요. " +
                "iOS Safari, Firefox는 지원되지 않습니다."
            );
        }

        const device = await gd.selectDevice();
        const sensor = device.sensors.find(s => s.enabled) ?? device.sensors[0];
        if (!sensor) {
            try { await device.close(); } catch (_) {}
            throw new Error("Vernier device에 사용 가능한 센서가 없습니다.");
        }

        // 단위 검증 — 다운스트림이 kPa 하드코딩이라 silent bug 방지.
        if (sensor.unit !== "kPa") {
            try { await device.close(); } catch (_) {}
            throw new Error(
                `Vernier 센서 단위가 'kPa'가 아닙니다 (실제: '${sensor.unit}'). ` +
                `이 시뮬레이션은 kPa 전용입니다.`
            );
        }

        this._onValueChanged = (s) => {
            this._emit({
                sensor: "pressure",
                value: s.value,
                unit: "kPa",
                timestamp: performance.now(),
                ch: 0,
                raw: { vernierName: s.name, vernierUnit: s.unit },
            });
        };
        sensor.on("value-changed", this._onValueChanged);

        device.start(100);  // 10 Hz, GDX-GP 50 Hz max 한도 내.

        this._device = device;
        this._sensor = sensor;
        this.connected = true;
        this._emitEvent("connect", {
            version: "vernier",
            sensor: device.name || sensor.name || "Vernier GDX",
            fw: null,
        });
    }

    async disconnect() {
        if (!this.connected) return;
        this.connected = false;
        try {
            if (this._sensor && this._onValueChanged) {
                // godirect Sensor API: off(eventName, handler) — 가드로 try.
                if (typeof this._sensor.off === "function") {
                    this._sensor.off("value-changed", this._onValueChanged);
                }
            }
        } catch (_) {}
        try { await this._device?.close(); } catch (_) {}
        this._device = null;
        this._sensor = null;
        this._onValueChanged = null;
        this._emitEvent("disconnect");
    }
}
