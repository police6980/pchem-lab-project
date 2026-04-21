// Web Serial API communication with ESP32 firmware

class SensorSource {
    constructor() {
        this._callbacks = [];
    }

    onData(callback) {
        this._callbacks.push(callback);
    }

    _emit(data) {
        for (const cb of this._callbacks) {
            cb(data);
        }
    }

    start() {
        throw new Error("SensorSource.start() must be implemented by subclass");
    }

    stop() {
        throw new Error("SensorSource.stop() must be implemented by subclass");
    }
}

class MockSensorSource extends SensorSource {
    constructor(initialPressure = 101.3) {
        super();
        this._pressure = initialPressure;
        this._interval = null;
        this._noiseSigma = 0.1;
    }

    setPressure(value) {
        this._pressure = value;
    }

    start() {
        if (this._interval !== null) return;
        this._interval = setInterval(() => {
            const noisy = this._pressure + this._gaussianNoise() * this._noiseSigma;
            this._emit({
                sensor: "pressure",
                value: noisy,
                unit: "kPa",
                timestamp: performance.now()
            });
        }, 50);
    }

    stop() {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    _gaussianNoise() {
        // Box-Muller: two uniforms -> one standard-normal sample
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}
