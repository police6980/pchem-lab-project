// Entry point - boot and overall orchestration

const USE_MOCK_SENSOR = true;

document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());

    const box = new Box(BOX_INITIAL_X, BOX_INITIAL_Y, BOX_INITIAL_WIDTH, BOX_INITIAL_HEIGHT);
    const system = new ParticleSystem(params.particle_count, box, DEFAULT_SPEED_SCALE, params.ghost_count);
    const V0 = box.getArea();
    const P0 = params.initial_pressure_kPa;
    let smoothedP = P0;
    let sessionStartMs = null;
    const setSessionStart = () => {
        if (sessionStartMs === null) sessionStartMs = Date.now();
    };

    const continuousBuffer = [];
    const CONTINUOUS_MAX_ROWS = 10000;
    const CONTINUOUS_SAMPLE_INTERVAL_MS = 250;
    let continuousHitsAccumulator = 0;
    let continuousOverflowWarned = false;

    if (USE_MOCK_SENSOR) {
        const sensor = new MockSensorSource(params.initial_pressure_kPa);
        createDevPressureSlider(v => {
            setSessionStart();
            sensor.setPressure(v);
        });
        sensor.onData(data => {
            smoothedP += (data.value - smoothedP) * 0.1;
            box.setTargetFromPressure(smoothedP, P0, V0);
            updateInfoPanel({ pressure_kPa: smoothedP });
        });
        sensor.start();
    } else {
        console.warn("Real sensor not implemented yet");
    }

    let pistonHitsAccumulator = 0;
    createRenderer(box, system, params, (dt) => {
        system.update(dt);
        box.update(dt, params.volume_tau_seconds);
        system.clampParticlesIntoBox();
        const tickHits = system.getPistonCollisionCount();
        pistonHitsAccumulator += tickHits;
        continuousHitsAccumulator += tickHits;
    });

    createInfoPanel();
    updateInfoPanel({
        temp_K: params.initial_temperature_K,
        avgSpeed: system.getAverageSpeed(),
        kineticEnergy: system.getAverageKineticEnergy(),
    });

    const pixelsToML = (gasWidth) =>
        (gasWidth / params.baseline_gas_width_px) * params.baseline_volume_mL;

    const measApi = createMeasurementPanel({
        getP: () => smoothedP,
        getGasWidth: () => box.width,
        pixelsToML,
        setSessionStart,
        getSessionStart: () => sessionStartMs,
        exportContinuousCSV: () => {
            if (continuousBuffer.length === 0) return;
            const headers = [
                "timestamp_ms", "P_kPa", "V_mL", "box_width_px",
                "mean_speed_px_per_s", "piston_collisions_per_s", "stabilized",
            ];
            const rows = continuousBuffer.map(r => [
                r.timestamp_ms,
                r.P_kPa.toFixed(2),
                r.V_mL.toFixed(2),
                r.box_width_px.toFixed(1),
                r.mean_speed_px_per_s.toFixed(1),
                r.piston_collisions_per_s.toFixed(1),
                r.stabilized,
            ]);
            const filename = `boyle_continuous_${formatTimestampForFilename(new Date())}.csv`;
            downloadCSV(filename, headers, rows);
        },
        getContinuousBufferSize: () => continuousBuffer.length,
        clearContinuousBuffer: () => {
            continuousBuffer.length = 0;
            continuousOverflowWarned = false;
        },
        resetSession: () => { sessionStartMs = null; },
    });

    setInterval(() => {
        if (sessionStartMs === null) return;

        const hitsPerSec = continuousHitsAccumulator / (CONTINUOUS_SAMPLE_INTERVAL_MS / 1000);
        continuousHitsAccumulator = 0;

        const row = {
            timestamp_ms: Date.now() - sessionStartMs,
            P_kPa: smoothedP,
            V_mL: pixelsToML(box.width),
            box_width_px: box.width,
            mean_speed_px_per_s: system.getAverageSpeed(),
            piston_collisions_per_s: hitsPerSec,
            stabilized: measApi.getStabilized(),
        };

        if (continuousBuffer.length >= CONTINUOUS_MAX_ROWS) {
            continuousBuffer.shift();
            if (!continuousOverflowWarned) {
                console.warn("[Continuous log] Buffer full (10000 rows). Dropping oldest samples.");
                continuousOverflowWarned = true;
            }
        }
        continuousBuffer.push(row);
    }, CONTINUOUS_SAMPLE_INTERVAL_MS);

    setInterval(() => {
        updateInfoPanel({
            avgSpeed: system.getAverageSpeed(),
            kineticEnergy: system.getAverageKineticEnergy(),
        });
    }, 1000);

    setInterval(() => {
        const hitsPer5s = pistonHitsAccumulator;
        const hitsPerSec = hitsPer5s / 5;
        pistonHitsAccumulator = 0;

        updateInfoPanel({ hitsPerSec });

        const frames = getAndResetFrameCount();
        const fps = frames / 5;
        const overlapTotal = system.getAndResetOverlapPairCount();
        const overlapAvg = frames > 0 ? overlapTotal / frames : 0;

        const avgSpeed = system.getAverageSpeed();
        const initialSpeed = system.getInitialAverageSpeed();
        const speedRel = avgSpeed / initialSpeed;
        const widthRel = box.width / BOX_INITIAL_WIDTH;
        const particleCount = system.getParticles().length;
        console.log(
            `Avg speed: ${avgSpeed.toFixed(1)} (×${speedRel.toFixed(2)}), ` +
            `Box width: ${box.width.toFixed(0)} (×${widthRel.toFixed(2)}), ` +
            `Particles: ${particleCount}, ` +
            `Piston hits (last 5s): ${hitsPer5s} (≈${hitsPerSec.toFixed(0)}/s), ` +
            `FPS: ${fps.toFixed(1)}, ` +
            `Overlap pairs (avg): ${overlapAvg.toFixed(1)} /frame`
        );
    }, 5000);
});
