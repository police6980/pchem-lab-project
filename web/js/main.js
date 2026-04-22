// Entry point - boot and overall orchestration

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

    const sensorManager = createSensorManager(params.initial_pressure_kPa);
    createDevPressureSlider(v => {
        setSessionStart();
        // Slider only affects the mock source; in real mode it's orphaned.
        if (typeof sensorManager.source?.setPressure === "function") {
            sensorManager.source.setPressure(v);
        }
    });
    sensorManager.onData(data => {
        smoothedP += (data.value - smoothedP) * 0.1;
        box.setTargetFromPressure(smoothedP, P0, V0_current);
        updateInfoPanel({ pressure_kPa: smoothedP });
    });
    initSensorPanel(sensorManager);
    sensorManager.setMode("mock");

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
        const tickHits = system.getTotalPistonCollisionCount();
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

// ============================================================
// Advanced mode — mirrors basic mode's layout and reuses its drawing
// primitives (drawCylinderShell / drawPiston / drawParticlesHSB from
// renderer.js, createAdvInfoPanel / updateAdvInfoPanel from ui.js).
// Histogram math is rewritten per spec with FIXED x-range and y-scale.
// ============================================================

// Canvas / box geometry — matches basic (SIM_CANVAS_WIDTH etc. live in renderer.js).
const ADV_PX_PER_ML = 9;             // V=80 mL → 720 px wide; fits CYLINDER_RIGHT=810.
const ADV_V0_ML = 50;
const ADV_INITIAL_PARTICLES = 300;
const ADV_INITIAL_CELSIUS = 25;
const ADV_TEMP_MIN = -100;
const ADV_TEMP_MAX = 500;
const ADV_REFERENCE_TEMP_K = 298.15;
const ADV_REFERENCE_GAS_MASS = 28;   // N₂ — matches DEFAULT_SPEED_SCALE baseline.
const ADV_GAS_MASSES = { He: 4, N2: 28, Ar: 40, CO2: 44 };

// Histogram layout — matches basic mode (HIST_CANVAS_WIDTH/HEIGHT = 560/260)
// so the histogram area + info panel can sit side-by-side in a flex row
// inside the advanced-mode main container (which is already narrowed by the
// 380px AI sidebar).
const ADV_HIST_CANVAS_W = HIST_CANVAS_WIDTH;   // 560
const ADV_HIST_CANVAS_H = HIST_CANVAS_HEIGHT;  // 260
const ADV_HIST_X = 36;                         // left margin for y-axis count labels
const ADV_HIST_Y = 5;
const ADV_HIST_W = ADV_HIST_CANVAS_W - ADV_HIST_X - 5;     // 519
const ADV_HIST_H = ADV_HIST_CANVAS_H - ADV_HIST_Y - 10;    // 245
const ADV_HIST_BINS = 40;

// Histogram axes are BOTH fixed so temperature / gas changes read as the
// distribution moving and spreading, not as the plot rescaling around it.
//
//   x-axis: 0 → 4·σ_max, where σ_max is the fastest reachable state
//           (He at ADV_TEMP_MAX). 4σ captures the full tail.
//   y-axis: probability density / (theoretical peak at current σ).
//           The theoretical peak of 2-D Maxwell-Boltzmann is (1/σ)·e^(-0.5)
//           at v=σ, so this ratio is always 1 at the peak regardless of
//           state. Bars fluctuate around the curve; the curve itself never
//           moves vertically.
const ADV_SIGMA_MAX = DEFAULT_SPEED_SCALE
    * Math.sqrt(ADV_REFERENCE_GAS_MASS / ADV_GAS_MASSES.He)
    * Math.sqrt((ADV_TEMP_MAX + 273.15) / ADV_REFERENCE_TEMP_K);
const ADV_V_MAX_X = 5.5 * ADV_SIGMA_MAX;
const ADV_BIN_WIDTH = ADV_V_MAX_X / ADV_HIST_BINS;
const ADV_HIST_Y_HEADROOM = 1.2;   // bars above the theoretical peak get 20% room

function initAdvancedMode(params) {
    const P0 = params.initial_pressure_kPa;

    // Color scale — pinned to the INITIAL state (N₂ at 25 °C), same convention
    // as basic mode's `vMaxColor = initialAvgSpeed × v_max_color_factor`.
    // This makes heating/lighter gases read as "redder particles" visually,
    // the same feedback the basic tab gives when the student raises T.
    const ADV_VMAX_COLOR =
        DEFAULT_SPEED_SCALE * Math.sqrt(2) * params.v_max_color_factor;

    let currentGasMass = ADV_GAS_MASSES.N2;
    let currentTempK = ADV_INITIAL_CELSIUS + 273.15;
    const currentSpeedScale = () =>
        DEFAULT_SPEED_SCALE
        * Math.sqrt(currentTempK / ADV_REFERENCE_TEMP_K)
        * Math.sqrt(ADV_REFERENCE_GAS_MASS / currentGasMass);
    const theoreticalSpeed = () => currentSpeedScale() * Math.sqrt(2);
    const theoreticalKE = () => {
        const s = currentSpeedScale();
        return 0.5 * 1.0 * 2 * s * s;  // <v²> = 2σ² for 2-D MB
    };

    const box = new Box(BOX_INITIAL_X, BOX_INITIAL_Y, ADV_V0_ML * ADV_PX_PER_ML, BOX_INITIAL_HEIGHT);
    // `system` is reassigned on particle-count changes; p5 closures read the
    // latest value each frame because they reference the outer `let` by name.
    let system = new ParticleSystem(ADV_INITIAL_PARTICLES, box, currentSpeedScale(), 0);

    // --- DOM refs ---
    const volSlider    = document.getElementById("adv-volume-slider");
    const volValue     = document.getElementById("adv-volume-value");
    const pressValue   = document.getElementById("adv-pressure-value");
    const partSlider   = document.getElementById("adv-particle-slider");
    const partValue    = document.getElementById("adv-particle-value");
    const gasSelect    = document.getElementById("adv-gas-select");
    const tempInput    = document.getElementById("adv-temp-custom-input");
    const tempSetBtn   = document.getElementById("adv-btn-temp-set");
    const tempCelEl    = document.getElementById("adv-temp-current-celsius");
    const tempKelEl    = document.getElementById("adv-temp-current-kelvin");
    const tempPresets  = document.querySelectorAll(".adv-temp-presets button");

    createAdvInfoPanel();

    // Snapshot of the current advanced-mode state. Used by both the
    // measurement panel (for a new row) and the AI tutor (for context).
    const getAdvState = () => {
        const V = parseFloat(volSlider.value);
        return {
            V_mL: V,
            P_kPa: computeAdvPressure(),
            tempK: currentTempK,
            particleCount: system.getParticles().length,
            gas: gasSelect.value,
            avgSpeed: system.getAverageSpeed(),
        };
    };

    // Measurement panel (PV/nT verification table + chart).
    const measPanel = createAdvMeasurementPanel({ getAdvState });

    // AI tutor sidebar — shares API key/level/model via sessionStorage with basic.
    // Datapoints are piped in so the tutor can reference recorded measurements
    // once the student has logged at least two points.
    const advTutor = createAdvAiTutor({
        getAdvState: () => {
            return {
                ...getAdvState(),
                datapoints: measPanel.getDatapoints(),
            };
        },
    });

    // Histogram header — prepended before p5 mounts so it sits above the canvas.
    const histHeader = document.createElement("div");
    histHeader.className = "adv-hist-header";
    histHeader.innerHTML = `실입자 수: <strong id="adv-hist-n">${ADV_INITIAL_PARTICLES}</strong>개`;
    document.getElementById("adv-histogram-area").appendChild(histHeader);
    const histNEl = document.getElementById("adv-hist-n");

    // --- Control handlers ---
    // Ideal-gas pressure: P = P₀ · (V₀/V) · (T/T₀) · (N/N₀).
    // N₀ = ADV_INITIAL_PARTICLES so the reference state (V₀, T₀, N₀, N₂)
    // reads P₀ exactly. Changing any of V / T / N is reflected immediately.
    function computeAdvPressure() {
        const V = parseFloat(volSlider.value);
        const N = parseInt(partSlider.value, 10);
        return P0
            * (ADV_V0_ML / V)
            * (currentTempK / ADV_REFERENCE_TEMP_K)
            * (N / ADV_INITIAL_PARTICLES);
    }
    function updatePressureReadout() {
        pressValue.textContent = `${computeAdvPressure().toFixed(1)} kPa`;
    }

    function applyVolume(V_mL) {
        box.targetWidth = V_mL * ADV_PX_PER_ML;
        volValue.textContent = `${V_mL.toFixed(0)} mL`;
        updatePressureReadout();
    }
    volSlider.addEventListener("input", () => applyVolume(parseFloat(volSlider.value)));
    applyVolume(ADV_V0_ML);

    partSlider.addEventListener("input", () => {
        const n = parseInt(partSlider.value, 10);
        partValue.textContent = `${n}개`;
        histNEl.textContent = n;
        // Rebuild instead of calling a setParticleCount method — keeps
        // simulation.js untouched and gets a correct, fresh MB draw.
        system = new ParticleSystem(n, box, currentSpeedScale(), 0);
        updatePressureReadout();
    });

    gasSelect.addEventListener("change", () => {
        const oldScale = currentSpeedScale();
        currentGasMass = ADV_GAS_MASSES[gasSelect.value];
        system.scaleVelocities(currentSpeedScale() / oldScale);
    });

    function applyTemperature(celsius) {
        const oldScale = currentSpeedScale();
        currentTempK = celsius + 273.15;
        system.scaleVelocities(currentSpeedScale() / oldScale);
        tempCelEl.textContent = celsius.toFixed(0);
        tempKelEl.textContent = currentTempK.toFixed(0);
        tempPresets.forEach(btn => {
            btn.classList.toggle("active", Math.abs(parseFloat(btn.dataset.celsius) - celsius) < 0.5);
        });
        updatePressureReadout();
    }
    tempPresets.forEach(btn => {
        btn.addEventListener("click", () => applyTemperature(parseFloat(btn.dataset.celsius)));
    });

    function validateTempInput() {
        const val = parseFloat(tempInput.value);
        const empty = tempInput.value === "";
        const valid = !isNaN(val) && val >= ADV_TEMP_MIN && val <= ADV_TEMP_MAX;
        tempInput.classList.toggle("invalid", !empty && !valid);
        tempSetBtn.disabled = !valid;
        return valid ? val : null;
    }
    tempInput.addEventListener("input", validateTempInput);
    tempInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = validateTempInput();
            if (val !== null) tempSetBtn.click();
        }
    });
    tempSetBtn.addEventListener("click", () => {
        const val = validateTempInput();
        if (val === null) return;
        applyTemperature(val);
        tempInput.value = "";
        validateTempInput();
    });

    // Main sim + single-particle tracker share the same ParticleSystem AND
    // the same native canvas resolution (1000×360). CSS flex ratios make the
    // tracker display narrower in the browser; the physics / box / particle
    // coordinates stay identical so there's no risk of aspect-ratio drift or
    // off-by-one scaling. `canvas.style()` enforces width:100% to override
    // p5's default inline sizing.
    const ADV_SIM_CANVAS_W = SIM_CANVAS_WIDTH;    // 1000
    const ADV_SIM_CANVAS_H = SIM_CANVAS_HEIGHT;   // 360
    const ADV_TRAIL_LEN = 45;

    let hitsAccumulator = 0;
    let advFlashes = [];

    const simSketch = (p) => {
        p.setup = () => {
            const canvas = p.createCanvas(ADV_SIM_CANVAS_W, ADV_SIM_CANVAS_H);
            canvas.parent("adv-sim-canvas-container");
            // Override p5's inline width/height so the canvas honours the
            // flex:7 container width instead of stretching to 1000 px.
            canvas.style("width", "100%");
            canvas.style("height", "auto");
            p.colorMode(p.HSB, 360, 100, 100, 255);
        };
        p.draw = () => {
            // Clear FIRST, before any physics or draws, so there's no chance
            // the previous frame's pixels leak through (e.g. if the browser
            // keeps the canvas buffer due to `preserveDrawingBuffer`).
            p.clear();
            p.background(0, 0, 98);

            const dt = Math.min((p.deltaTime || 0) / 1000, 0.05);

            box.update(dt, params.volume_tau_seconds);
            system.update(dt);
            system.clampParticlesIntoBox();
            hitsAccumulator += system.getTotalPistonCollisionCount();

            // Flash on every piston hit (right wall), same as basic mode.
            for (const c of system.getLastPistonCollisions()) {
                const ratio = Math.min(c.speed / ADV_VMAX_COLOR, 1.0);
                const hue = 240 - 240 * ratio;
                advFlashes.push(new Flash(c.x, c.y, c.momentumTransfer, hue, params.flash_duration_sec));
            }
            for (const f of advFlashes) f.update(dt);
            advFlashes = advFlashes.filter(f => !f.isDead());

            drawCylinderShell(p);
            drawPiston(p, box.x + box.width);
            drawParticlesHSB(p, system.getParticles(), ADV_VMAX_COLOR);
            for (const f of advFlashes) f.draw(p);
        };
    };

    // Tracker sketch — isolates particles[0]'s trajectory. Same native
    // 1000×360 canvas as main, same world coords, no p.scale — just CSS
    // down-sizes the displayed canvas via the narrower flex column. The
    // trail resets when the system is rebuilt (object identity swap on
    // particle-count change).
    const trackerSketch = (p) => {
        let trail = [];
        let lastTrackedRef = null;

        p.setup = () => {
            const canvas = p.createCanvas(ADV_SIM_CANVAS_W, ADV_SIM_CANVAS_H);
            canvas.parent("adv-tracker-canvas-container");
            canvas.style("width", "100%");
            canvas.style("height", "auto");
            p.colorMode(p.HSB, 360, 100, 100, 255);
        };
        p.draw = () => {
            // Clear + paint background FIRST, every frame, unconditionally.
            // Without this, the trail polyline (and prior faded particles)
            // could linger when preserveDrawingBuffer is on.
            p.clear();
            p.background(0, 0, 98);

            const particles = system.getParticles();
            if (particles.length === 0) return;

            const tracked = particles[0];
            const trackedSpeed = Math.sqrt(tracked.vx * tracked.vx + tracked.vy * tracked.vy);
            if (tracked !== lastTrackedRef) {
                trail = [];
                lastTrackedRef = tracked;
            }
            // Store speed alongside position so each trail segment can be
            // coloured by the speed it had at that moment.
            trail.push({ x: tracked.x, y: tracked.y, speed: trackedSpeed });
            if (trail.length > ADV_TRAIL_LEN) trail.shift();

            // Cylinder + piston (same helpers — no flashes on this view).
            drawCylinderShell(p);
            drawPiston(p, box.x + box.width);

            // Faded background particles (skip index 0 — drawn highlighted below).
            drawParticlesHSB(p, particles.slice(1), ADV_VMAX_COLOR, 40);

            // Trail polyline — speed-based HSB colour, alpha fades from
            // oldest (low) to newest (high).
            if (trail.length >= 2) {
                p.noFill();
                p.strokeWeight(3);
                for (let i = 1; i < trail.length; i++) {
                    const t = i / (trail.length - 1);  // 0 at oldest → 1 at newest
                    const tr = trail[i];
                    const r = Math.min(tr.speed / ADV_VMAX_COLOR, 1.0);
                    const hue = 240 - 240 * r;
                    const sat = 40 + 60 * r;
                    const bri = 70 + 30 * r;
                    const alpha = 30 + 200 * t;
                    p.stroke(hue, sat, bri, alpha);
                    p.line(trail[i - 1].x, trail[i - 1].y, tr.x, tr.y);
                }
            }

            // Tracked particle — same HSB formula as the general drawParticles
            // call, but with 3× radius and a dark outline so it reads as the
            // highlighted one.
            const ratio = Math.min(trackedSpeed / ADV_VMAX_COLOR, 1.0);
            const hue = 240 - 240 * ratio;
            const sat = 40 + 60 * ratio;
            const bri = 70 + 30 * ratio;
            p.stroke(0, 0, 20);
            p.strokeWeight(2);
            p.fill(hue, sat, bri);
            p.circle(tracked.x, tracked.y, tracked.radius * 6);
        };
    };

    // --- Histogram sketch — peak-normalized, fixed axes, no EMA ---
    //
    // Math:
    //   p(v)           = (v/σ²)·exp(-v²/(2σ²))              2-D M-B density
    //   peak_p(σ)      = (1/σ)·exp(-0.5)                    at v = σ
    //   empirical_p(i) = count[i] / (N · BIN_WIDTH)         per bin
    //   normalized(i)  = empirical_p(i) / peak_p(σ)         ≈ 1 at the peak
    //
    // The y-axis shows `normalized` with 20% headroom (so bars that
    // momentarily exceed 1.0 stay on-canvas). The theory curve computed from
    // the same σ always peaks at exactly 1.0, so it never moves vertically.
    const histSketch = (p) => {
        p.setup = () => {
            const canvas = p.createCanvas(ADV_HIST_CANVAS_W, ADV_HIST_CANVAS_H);
            canvas.parent("adv-histogram-area");
            p.colorMode(p.HSB, 360, 100, 100, 255);
            p.textFont("ui-monospace, monospace");
        };
        p.draw = () => {
            p.background(0, 0, 98);

            const N = system.getParticles().length;
            const sigma = currentSpeedScale();
            if (N === 0 || sigma <= 0) return;

            const theoreticalPeak = (1 / sigma) * Math.exp(-0.5);
            const yFromNorm = (norm) =>
                ADV_HIST_Y + ADV_HIST_H * (1 - Math.min(norm, ADV_HIST_Y_HEADROOM) / ADV_HIST_Y_HEADROOM);

            // Bars — raw each frame (no EMA); fluctuation size is the point.
            // Speed-based HSB color (basic-mode formula via binCenter/vMaxColor).
            const rawBins = system.getVelocityHistogram(ADV_HIST_BINS, ADV_V_MAX_X);
            const binPxW = ADV_HIST_W / ADV_HIST_BINS;
            p.noStroke();
            for (let i = 0; i < rawBins.length; i++) {
                const empiricalDensity = rawBins[i].count / (N * ADV_BIN_WIDTH);
                const normalized = empiricalDensity / theoreticalPeak;
                const yTop = yFromNorm(normalized);
                const h = ADV_HIST_Y + ADV_HIST_H - yTop;
                if (h <= 0) continue;

                const binCenter = (rawBins[i].binMin + rawBins[i].binMax) / 2;
                const cRatio = Math.min(binCenter / ADV_VMAX_COLOR, 1.0);
                const hue = 240 - 240 * cRatio;
                const sat = 40 + 60 * cRatio;
                const bri = 70 + 30 * cRatio;
                p.fill(hue, sat, bri, 200);
                p.rect(ADV_HIST_X + i * binPxW, yTop, binPxW - 1, h);
            }

            // Theoretical 2-D Rayleigh — peak always sits at y=1.0.
            p.noFill();
            p.stroke(0, 0, 30, 220);
            p.strokeWeight(2);
            p.beginShape();
            for (let i = 0; i <= 200; i++) {
                const v = (i / 200) * ADV_V_MAX_X;
                const pv = (v / (sigma * sigma)) * Math.exp(-v * v / (2 * sigma * sigma));
                const normalized = pv / theoreticalPeak;
                const x = ADV_HIST_X + (v / ADV_V_MAX_X) * ADV_HIST_W;
                p.vertex(x, yFromNorm(normalized));
            }
            p.endShape();

            // y-axis ticks at the physically meaningful values 0 / 0.5 / 1.0
            // (the theoretical peak position). 1.0 label sits at 1/1.2 = 83%
            // of the plot height so the 20% headroom shows above it.
            p.noStroke();
            p.fill(0, 0, 35);
            p.textSize(11);
            p.textAlign(p.RIGHT, p.CENTER);
            for (const v of [0, 0.5, 1.0]) {
                p.text(v.toFixed(1), ADV_HIST_X - 6, yFromNorm(v));
            }
        };
    };

    // --- Info panel refresh (basic mode's cadence: hits every 250ms, stats 1s) ---
    let smoothedHitsPerSec = 0;
    setInterval(() => {
        const hitsPerSec = hitsAccumulator / 0.25;
        hitsAccumulator = 0;
        smoothedHitsPerSec += (hitsPerSec - smoothedHitsPerSec) * 0.15;
        updateAdvInfoPanel({
            temp_K: currentTempK,
            pressure_kPa: computeAdvPressure(),
            hitsPerSec: smoothedHitsPerSec,
        });
    }, 250);

    setInterval(() => {
        updateAdvInfoPanel({
            avgSpeed: system.getAverageSpeed(),
            avgSpeedTheory: theoreticalSpeed(),
            kineticEnergy: system.getAverageKineticEnergy(),
            kineticEnergyTheory: theoreticalKE(),
        });
    }, 1000);

    const simP5 = new p5(simSketch);
    const trackerP5 = new p5(trackerSketch);
    const histP5 = new p5(histSketch);

    return {
        refreshTutor: () => advTutor.refresh(),
        pause: () => { simP5.noLoop(); trackerP5.noLoop(); histP5.noLoop(); },
        resume: () => { simP5.loop(); trackerP5.loop(); histP5.loop(); },
    };
}

// Tab switching — lazy init on first advanced-mode tab click.
document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());
    let advancedApi = null;
    initModeTabs({
        onSwitch: (mode) => {
            if (mode === "advanced") {
                if (!advancedApi) {
                    advancedApi = initAdvancedMode(params);
                } else {
                    advancedApi.resume();
                    // Re-check API-key availability in case the student set
                    // it in basic mode after advanced was first opened.
                    advancedApi.refreshTutor();
                }
            } else if (advancedApi) {
                advancedApi.pause();
            }
        },
    });
});
