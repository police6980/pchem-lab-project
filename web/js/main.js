// Entry point - boot and overall orchestration

const USE_MOCK_SENSOR = true;

const REFERENCE_TEMP_K = 298.15;
const REFERENCE_V_ML = 50;
const REFERENCE_P_KPA = 101.3;
const REFERENCE_RMS = DEFAULT_SPEED_SCALE * Math.sqrt(2);   // 2D M-B RMS at REFERENCE_TEMP_K
const REFERENCE_KE = 0.5 * REFERENCE_RMS * REFERENCE_RMS;
const TRANSITION_TAU = 0.3;

document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());

    const box = new Box(BOX_INITIAL_X, BOX_INITIAL_Y, BOX_INITIAL_WIDTH, BOX_INITIAL_HEIGHT);
    const system = new ParticleSystem(params.particle_count, box, DEFAULT_SPEED_SCALE, params.ghost_count);
    const V0_REFERENCE_AREA = box.getArea();
    let V0_current = V0_REFERENCE_AREA;
    const P0 = params.initial_pressure_kPa;
    let smoothedP = P0;
    let sessionStartMs = null;
    let currentTempCelsius = 25;
    const currentTempKelvin = () => currentTempCelsius + 273.15;
    const recomputeV0Current = () => {
        V0_current = V0_REFERENCE_AREA * currentTempKelvin() / REFERENCE_TEMP_K;
    };
    const theoreticalSpeed = () =>
        REFERENCE_RMS * Math.sqrt(currentTempKelvin() / REFERENCE_TEMP_K);
    const theoreticalKE = () =>
        REFERENCE_KE * (currentTempKelvin() / REFERENCE_TEMP_K);

    // Velocity transition state (Step 3 of T-change smoothing).
    let targetSpeedRatio = 1;
    let currentSpeedRatio = 1;
    let lastAppliedRatio = 1;
    let transitionStartTime = null;
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
            box.setTargetFromPressure(smoothedP, P0, V0_current);
            updateInfoPanel({ pressure_kPa: smoothedP });
        });
        sensor.start();
    } else {
        console.warn("Real sensor not implemented yet");
    }

    let pistonHitsAccumulator = 0;
    // Snapshot of the values currently shown in the info panel. Measurement
    // table reads these via getAvgSpeed/getCollisionsPerSec so the numbers
    // stored on record are identical to what the student sees on screen.
    let lastDisplayAvgSpeed = 0;
    let lastDisplayHitsPerSec = 0;
    // EMA-smoothed hitsPerSec for display. Updated every 250ms from raw
    // continuous-log samples. α=0.15 gives τ≈1.5s — strong smoothing to
    // suppress Poisson jitter (~14% per 250ms sample with 300 particles),
    // response time aligned with the 2s stabilization window.
    let smoothedHitsPerSec = 0;
    const renderer = createRenderer(box, system, params, (dt) => {
        system.update(dt);
        box.update(dt, params.volume_tau_seconds);
        system.clampParticlesIntoBox();
        const tickHits = system.getPistonCollisionCount();
        pistonHitsAccumulator += tickHits;
        continuousHitsAccumulator += tickHits;

        if (transitionStartTime !== null) {
            currentSpeedRatio += (targetSpeedRatio - currentSpeedRatio) * (dt / TRANSITION_TAU);

            const elapsed = (performance.now() - transitionStartTime) / 1000;
            const relError = Math.abs(targetSpeedRatio - currentSpeedRatio) / targetSpeedRatio;
            if (elapsed > 10 || relError < 0.001) {
                currentSpeedRatio = targetSpeedRatio;
                transitionStartTime = null;
            }

            const frameRatio = currentSpeedRatio / lastAppliedRatio;
            system.scaleVelocities(frameRatio);
            lastAppliedRatio = currentSpeedRatio;
        }
    });

    createInfoPanel();
    lastDisplayAvgSpeed = system.getAverageSpeed();
    updateInfoPanel({
        temp_K: currentTempKelvin(),
        avgSpeed: lastDisplayAvgSpeed,
        avgSpeedTheory: theoreticalSpeed(),
        kineticEnergy: system.getAverageKineticEnergy(),
        kineticEnergyTheory: theoreticalKE(),
    });

    const pixelsToML = (gasWidth) =>
        (gasWidth / params.baseline_gas_width_px) * params.baseline_volume_mL;

    let analysisApi = null;

    const measApi = createMeasurementPanel({
        getP: () => smoothedP,
        getGasWidth: () => box.width,
        pixelsToML,
        setSessionStart,
        getSessionStart: () => sessionStartMs,
        getCurrentTempKelvin: currentTempKelvin,
        onDataChange: () => { if (analysisApi) analysisApi.refresh(); },
        onResetAll: () => { if (analysisApi) analysisApi.clear(); },
        exportContinuousCSV: () => {
            if (continuousBuffer.length === 0) return;
            const headers = [
                "timestamp_ms", "P_kPa", "V_mL", "box_width_px",
                "mean_speed_px_per_s", "piston_collisions_per_s", "stabilized",
                "temperature_K",
            ];
            const rows = continuousBuffer.map(r => [
                r.timestamp_ms,
                r.P_kPa.toFixed(2),
                r.V_mL.toFixed(2),
                r.box_width_px.toFixed(1),
                r.mean_speed_px_per_s.toFixed(1),
                r.piston_collisions_per_s.toFixed(1),
                r.stabilized,
                r.temperature_K.toFixed(2),
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
        getAvgSpeed:        () => lastDisplayAvgSpeed,
        getCollisionsPerSec: () => lastDisplayHitsPerSec,
    });

    setInterval(() => {
        const hitsPerSec = continuousHitsAccumulator / (CONTINUOUS_SAMPLE_INTERVAL_MS / 1000);
        continuousHitsAccumulator = 0;
        smoothedHitsPerSec += (hitsPerSec - smoothedHitsPerSec) * 0.15;
        lastDisplayHitsPerSec = smoothedHitsPerSec;
        updateInfoPanel({ hitsPerSec: smoothedHitsPerSec });

        if (sessionStartMs === null) return;

        const row = {
            timestamp_ms: Date.now() - sessionStartMs,
            P_kPa: smoothedP,
            V_mL: pixelsToML(box.width),
            box_width_px: box.width,
            mean_speed_px_per_s: system.getAverageSpeed(),
            piston_collisions_per_s: hitsPerSec,
            stabilized: measApi.getStabilized(),
            temperature_K: currentTempKelvin(),
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

    analysisApi = createAnalysisPanel({
        getDatapoints: () => measApi.getDatapoints(),
        getCurrentTempCelsius: () => currentTempCelsius,
        getCurrentTempKelvin: currentTempKelvin,
        getSessionStart: () => sessionStartMs,
    });

    createTemperatureControl({
        getCurrentCelsius: () => currentTempCelsius,
        getMeasurementCount: () => measApi.getMeasurementCount(),
        getContinuousBufferSize: () => continuousBuffer.length,
        onCommit: (newCelsius) => {
            // Snap any in-flight transition so oldTempK reflects the real state.
            if (transitionStartTime !== null) {
                const frameRatio = targetSpeedRatio / lastAppliedRatio;
                system.scaleVelocities(frameRatio);
                transitionStartTime = null;
            }

            const oldTempK = currentTempKelvin();
            currentTempCelsius = newCelsius;
            const newTempK = currentTempKelvin();

            // Freeze the current histogram as ghost overlay before velocities shift.
            renderer.snapshotHistogramForGhost();

            // Smooth velocity transition toward new T (1s-ish).
            targetSpeedRatio = Math.sqrt(newTempK / oldTempK);
            currentSpeedRatio = 1;
            lastAppliedRatio = 1;
            transitionStartTime = performance.now();

            recomputeV0Current();
            box.setTargetFromPressure(smoothedP, P0, V0_current);

            updateInfoPanel({ temp_K: newTempK });
            measApi.clearMeasurements();
            continuousBuffer.length = 0;
            continuousOverflowWarned = false;
            sessionStartMs = null;
            analysisApi.clear();
        },
    });

    setInterval(() => {
        lastDisplayAvgSpeed = system.getAverageSpeed();
        updateInfoPanel({
            avgSpeed: lastDisplayAvgSpeed,
            avgSpeedTheory: theoreticalSpeed(),
            kineticEnergy: system.getAverageKineticEnergy(),
            kineticEnergyTheory: theoreticalKE(),
        });
    }, 1000);

    setInterval(() => {
        const hitsPer5s = pistonHitsAccumulator;
        const hitsPerSec = hitsPer5s / 5;
        pistonHitsAccumulator = 0;
        // Display + lastDisplayHitsPerSec are now owned by the 250ms tick
        // (EMA-smoothed). 5s value kept only for the diagnostic console log.

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
