// Entry point - boot and overall orchestration

// Responsive Step 1 — pre-collapse both sidebars on narrow viewports so
// they don't flash visible before the user sees the drawer UI. Runs at
// defer-script execution time (before DOMContentLoaded, before first paint).
const _narrowViewport = window.innerWidth < 1600;
document.body.classList.toggle("sidebar-collapsed", _narrowViewport);
document.body.classList.toggle("adv-sidebar-collapsed", _narrowViewport);

// Playback controls — shared global state across basic/advanced tabs.
// dt scaling is applied at update-loop entry only; physics code (simulation.js,
// renderer.js) is untouched. 2x is deferred because simulation.js:185 clamps
// dt at DT_CAP=0.05, which would silently cancel a 2x multiplier.
let speedMultiplier = 1;   // 0.25 / 0.5 / 1
let isPaused = false;

const REFERENCE_TEMP_K = 298.15;
const REFERENCE_V_ML = 50;
const REFERENCE_P_KPA = 101.3;
const REFERENCE_RMS = DEFAULT_SPEED_SCALE * Math.sqrt(2);   // 2D M-B RMS at REFERENCE_TEMP_K
const REFERENCE_KE = 0.5 * REFERENCE_RMS * REFERENCE_RMS;
const TRANSITION_TAU = 0.3;

// 5초 주기 진단 로그(평균 속도·FPS·오버랩 등)의 on/off 플래그.
// 수업 배포용 기본 false — 학생 DevTools Console 에 잡음 안 찍힘.
// 개발 중 성능 튜닝·물리 검증 필요 시 true 로 잠시 바꾼다.
const DEBUG_DIAGNOSTICS = false;

// 기본 실험(boyle.html) 초기화 래퍼. DOMContentLoaded 에서
// body.dataset.page 값이 "boyle" 이면 호출. 본문은 원래의 DOMContentLoaded
// 핸들러 내용 그대로 — 페이지 분기를 추가하기 위해 함수로 감싸기만 했다.
async function initBasicApp(params) {
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
        if (isPaused) return;
        const scaledDt = dt * speedMultiplier;
        system.update(scaledDt);
        box.update(scaledDt, params.volume_tau_seconds);
        system.clampParticlesIntoBox();
        const tickHits = system.getTotalPistonCollisionCount();
        pistonHitsAccumulator += tickHits;
        continuousHitsAccumulator += tickHits;

        if (transitionStartTime !== null) {
            currentSpeedRatio += (targetSpeedRatio - currentSpeedRatio) * (scaledDt / TRANSITION_TAU);

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
        getCurrentMode:      () => sensorManager.mode,
    });

    setInterval(() => {
        // Normalize to simulation time: wall-clock rate is proportional to
        // speedMultiplier, so divide it out to show a physics-invariant value.
        const rawHitsPerSec = continuousHitsAccumulator / (CONTINUOUS_SAMPLE_INTERVAL_MS / 1000);
        const hitsPerSec = speedMultiplier > 0 ? rawHitsPerSec / speedMultiplier : rawHitsPerSec;
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
        getCurrentMode: () => sensorManager.mode,
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

    // 5초 주기 진단 로그 — DEBUG_DIAGNOSTICS 플래그로 완전 제어.
    // 플래그가 false 면 setInterval 자체를 안 걸어 getAndResetFrameCount/
    // getAndResetOverlapPairCount 등 불필요 계산·누적기 리셋도 피한다.
    if (DEBUG_DIAGNOSTICS) {
        setInterval(() => {
            const hitsPer5s = pistonHitsAccumulator;
            const hitsPerSec = hitsPer5s / 5;
            pistonHitsAccumulator = 0;

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
    }

    // Playback controls — wire speed buttons + pause across both tabs.
    // querySelectorAll spans both basic and advanced DOM so state stays
    // synchronized via CSS `.active` class on every click.
    document.querySelectorAll(".playback-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const newSpeed = parseFloat(btn.dataset.speed);
            speedMultiplier = newSpeed;
            document.querySelectorAll(".playback-btn").forEach(b => {
                b.classList.toggle("active", parseFloat(b.dataset.speed) === newSpeed);
            });
        });
    });
    document.querySelectorAll(".pause-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            isPaused = !isPaused;
            document.querySelectorAll(".pause-btn").forEach(b => {
                b.classList.toggle("active", isPaused);
                b.textContent = isPaused ? "▶" : "⏸";
            });
            // Advanced record button has no stabilization-driven setter,
            // so pause state is the only gate here. Basic record button is
            // managed by ui.js's updateRecordButtonState (runs every 50ms)
            // which reads isPaused via the shared script scope.
            const advRecordBtn = document.getElementById("adv-btn-record");
            if (advRecordBtn) advRecordBtn.disabled = isPaused;
        });
    });
}

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
        const pKpa = computeAdvPressure();
        const pAtm = kPaToAtm(pKpa);
        pressValue.textContent = `${pKpa.toFixed(1)} kPa (${pAtm.toFixed(2)} atm)`;
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
        const mmol = particlesToMmol(n);
        partValue.textContent = `${n}개 (${mmol.toFixed(2)} mmol)`;
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

    // Main uses basic-mode native resolution (1000×360). Tracker uses a
    // smaller native canvas and p.scale to shrink drawing — same pattern as
    // basic renders, just with an extra scale factor. No canvas.style() or
    // CSS width:100%/height:auto — those caused the rendering issues.
    const ADV_TRACKER_CANVAS_W = 400;
    const ADV_TRACKER_CANVAS_H = 144;                // preserves 1000:360 aspect
    const ADV_TRACKER_SCALE = ADV_TRACKER_CANVAS_W / SIM_CANVAS_WIDTH;  // 0.4
    const ADV_TRAIL_LEN = 45;

    let hitsAccumulator = 0;
    let advFlashes = [];

    // Main sim sketch — pattern mirrors basic renderer's simSketch exactly.
    const simSketch = (p) => {
        p.setup = () => {
            p.createCanvas(SIM_CANVAS_WIDTH, SIM_CANVAS_HEIGHT);
            p.colorMode(p.HSB, 360, 100, 100, 255);
            p.background(0, 0, 98);
        };
        p.draw = () => {
            const dt = Math.min((p.deltaTime || 0) / 1000, 0.05);
            if (isPaused) return;
            const scaledDt = dt * speedMultiplier;

            box.update(scaledDt, params.volume_tau_seconds);
            system.update(scaledDt);
            system.clampParticlesIntoBox();
            hitsAccumulator += system.getTotalPistonCollisionCount();

            // Flash on every piston hit (right wall), same as basic mode.
            for (const c of system.getLastPistonCollisions()) {
                const ratio = Math.min(c.speed / ADV_VMAX_COLOR, 1.0);
                const hue = 240 - 240 * ratio;
                advFlashes.push(new Flash(c.x, c.y, c.momentumTransfer, hue, params.flash_duration_sec));
            }
            for (const f of advFlashes) f.update(scaledDt);
            advFlashes = advFlashes.filter(f => !f.isDead());

            p.background(0, 0, 98);
            drawCylinderShell(p);
            drawPiston(p, box.x + box.width);
            drawParticlesHSB(p, system.getParticles(), ADV_VMAX_COLOR);
            for (const f of advFlashes) f.draw(p);
        };
    };

    // Tracker sketch — smaller native canvas (400×144) + p.scale(0.4) so the
    // cylinder still uses world coords (CYLINDER_* constants) but fits a
    // compact panel. Same clean pattern as basic, plus one scale factor.
    const trackerSketch = (p) => {
        let trail = [];
        let lastTrackedRef = null;

        p.setup = () => {
            p.createCanvas(ADV_TRACKER_CANVAS_W, ADV_TRACKER_CANVAS_H);
            p.colorMode(p.HSB, 360, 100, 100, 255);
            p.background(0, 0, 98);
        };
        p.draw = () => {
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

            p.push();
            p.scale(ADV_TRACKER_SCALE);

            drawCylinderShell(p);
            drawPiston(p, box.x + box.width);
            drawParticlesHSB(p, particles.slice(1), ADV_VMAX_COLOR, 40);

            // Trail polyline — speed-based HSB colour, alpha fades from
            // oldest (low) to newest (high). Thicker at world scale since
            // p.scale shrinks it.
            if (trail.length >= 2) {
                p.noFill();
                p.strokeWeight(7);
                for (let i = 1; i < trail.length; i++) {
                    const t = i / (trail.length - 1);
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

            // Tracked particle — HSB color + dark outline + 3× radius.
            const ratio = Math.min(trackedSpeed / ADV_VMAX_COLOR, 1.0);
            const hue = 240 - 240 * ratio;
            const sat = 40 + 60 * ratio;
            const bri = 70 + 30 * ratio;
            p.stroke(0, 0, 20);
            p.strokeWeight(5);
            p.fill(hue, sat, bri);
            p.circle(tracked.x, tracked.y, tracked.radius * 6);

            p.pop();
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
            p.createCanvas(ADV_HIST_CANVAS_W, ADV_HIST_CANVAS_H);
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
        // Normalize to simulation time (see basic-mode tick for rationale).
        const rawHitsPerSec = hitsAccumulator / 0.25;
        const hitsPerSec = speedMultiplier > 0 ? rawHitsPerSec / speedMultiplier : rawHitsPerSec;
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

    // --- Tracked-particle speed gauge (100 ms refresh) ---
    // Bar length = v_tracked / ADV_V_MAX_X (same scale as the histogram x-axis
    // so the gauge position is directly comparable). Bar colour uses the
    // basic-mode HSB ratio keyed to ADV_VMAX_COLOR. The dark vertical mark
    // shows where the overall mean speed sits on the same scale.
    const gaugeFillEl   = document.getElementById("adv-gauge-bar-fill");
    const gaugeMeanEl   = document.getElementById("adv-gauge-mean-mark");
    const gaugeCurEl    = document.getElementById("adv-gauge-current");
    const gaugeMeanValEl = document.getElementById("adv-gauge-mean-value");
    setInterval(() => {
        const ps = system.getParticles();
        if (ps.length === 0) return;
        const tracked = ps[0];
        const trackedSpeed = Math.sqrt(tracked.vx * tracked.vx + tracked.vy * tracked.vy);
        const meanSpeed = system.getAverageSpeed();
        const curPct = Math.min(trackedSpeed / ADV_V_MAX_X, 1) * 100;
        const meanPct = Math.min(meanSpeed / ADV_V_MAX_X, 1) * 100;
        const ratio = Math.min(trackedSpeed / ADV_VMAX_COLOR, 1);
        const hue = 240 - 240 * ratio;
        const sat = 40 + 60 * ratio;
        const bri = 70 + 30 * ratio;
        gaugeFillEl.style.width = `${curPct.toFixed(1)}%`;
        gaugeFillEl.style.background = `hsl(${hue}, ${sat}%, ${bri - 30}%)`;
        gaugeMeanEl.style.left = `${meanPct.toFixed(1)}%`;
        gaugeCurEl.textContent = `${trackedSpeed.toFixed(0)} px/s`;
        gaugeMeanValEl.textContent = `${meanSpeed.toFixed(0)} px/s`;
    }, 100);

    // Pattern matches basic renderer: pass the parent element directly so
    // p5 appends the canvas there — no canvas.parent() / canvas.style()
    // fight afterwards.
    const simP5 = new p5(simSketch, document.getElementById("adv-sim-canvas-container"));
    const trackerP5 = new p5(trackerSketch, document.getElementById("adv-tracker-canvas-container"));
    const histP5 = new p5(histSketch, document.getElementById("adv-histogram-area"));

    return {
        refreshTutor: () => advTutor.refresh(),
        pause: () => { simP5.noLoop(); trackerP5.noLoop(); histP5.noLoop(); },
        resume: () => { simP5.loop(); trackerP5.loop(); histP5.loop(); },
    };
}

// ============================================================
// Phase 5 — Dalton Experiment (돌턴의 부분압력)
// ============================================================
// dalton.html 의 진입점. 디스패처가 body.dataset.page === "dalton" 일 때 호출.
// Step B-1: params.dalton 로드, daltonState 객체, 이벤트 바인딩(슬라이더·숫자·select·단위 토글).
// 후속 Step 에서 확장:
//   Step B-2: 이론값 박스 실시간 업데이트, 압력 표시 동적화
//   Step B-3: 버튼 상태 머신 (IDLE → INJECTING → INJECTED → CONFIRMED)
//   Step C~E: 시뮬 엔진 (DaltonScene) 연결, 순차 주입 애니메이션
//   Step F~G: 부분압력 계산, 3값 병기, 안정화 카운트다운, CSV
//   Step H: AI 튜터 단계 동기화 프롬프트
//   Step I: 센서 연동 (에뮬레이터 / Web Serial)
function initDaltonApp(params) {
    const cfg = params.dalton;
    if (!cfg) {
        console.error("[Dalton] params.dalton 없음. config/params.json 확인 필요.");
        return;
    }

    // 개발 편의: true 로 바꾸면 state 변경 시 콘솔 로그 출력.
    // 프로덕션에서는 false 유지.
    const DEBUG_DALTON = false;

    // ─────────────────────────────────────────────────────────
    // daltonState — closure 내 중앙 상태 객체
    // Step B-2, B-3 에서 필드 확장 예정 (stage, records, pressureMeasured 등)
    // ─────────────────────────────────────────────────────────
    const daltonState = {
        syringeA: {
            gas:    cfg.syringe_a.default_gas,  // 'air'
            volume: cfg.syringe_a.v_default,    // 100 (mL)
        },
        syringeB: {
            gas:    cfg.syringe_b.default_gas,  // 'co2'
            volume: cfg.syringe_b.v_default,    // 100 (mL)
        },
        // 주사기 B 센서 측정값 (atm 기준, 내부 계산용).
        // 시뮬 모드에서는 1.00 고정 (주입 전 상태 = 대기압).
        // 실센서 모드(Step I) 에서 실제 수신값으로 덮어씀.
        // 결정 7: 주입 전 주사기 A 압력 = 이 값을 그대로 복사 표시.
        pressureBSensor: 1.00,
        // 주입 완료 후 측정된 P_total (atm). INJECTED/CONFIRMED 에서만 유효.
        // IDLE/INJECTING 에서는 null. Step B-3 에서는 시뮬값 대신 이론값 그대로.
        // Step C/F 에서 실제 시뮬 결과값으로 대체.
        pressureBMeasured: null,
        displayUnit: "atm",  // 'atm' | 'kPa'
        stage: "IDLE",       // IDLE | INJECTING | INJECTED | CONFIRMED
        // Step B-3 애니메이션·카운트다운 abort 제어용.
        // [초기화] 클릭 시 abortCurrentFlow=true 로 설정 → 진행 중 async flow 가 중단.
        abortCurrentFlow: false,
        // 활성 setInterval ID (카운트다운용). 초기화 시 clearInterval.
        countdownIntervalId: null,
        // 기록 일련번호 (1부터 증가). [확인] 클릭 시 ++
        recordsCount: 0,
    };

    // 외부 디버깅 편의: 브라우저 콘솔에서 window.daltonState 확인 가능
    window.daltonState = daltonState;

    // ─────────────────────────────────────────────────────────
    // DOM 참조 — 필요 시점에 한 번 조회
    // ─────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const dom = {
        // 주사기 A
        gasASelect:    $("dalton-gas-a"),
        volumeANumber: $("dalton-volume-a-number"),
        pressureA:     $("dalton-pressure-a"),
        pressureAHint: $("dalton-pressure-a-hint"),
        gaugeA:        $("dalton-gauge-a"),
        gaugeWarningA: $("dalton-gauge-warning-a"),

        // 주사기 B
        gasBSelect:    $("dalton-gas-b"),
        volumeBNumber: $("dalton-volume-b-number"),
        pressureB:     $("dalton-pressure-b"),
        pressureBHint: $("dalton-pressure-b-hint"),
        gaugeB:        $("dalton-gauge-b"),
        gaugeWarningB: $("dalton-gauge-warning-b"),

        // 이론값
        theoryBefore: $("dalton-theory-before"),
        theoryAfter:  $("dalton-theory-after"),

        // 단위 토글 (dalton.html 에 id="dalton-unit-toggle")
        unitToggle: $("dalton-unit-toggle"),

        // 버튼
        btnInject:  $("dalton-btn-inject"),
        btnConfirm: $("dalton-btn-confirm"),
        btnReset:   $("dalton-btn-reset"),

        // 안정화 인디케이터 (Step A 에서 준비된 placeholder)
        stabilization: $("dalton-stabilization"),
        stabCountdown: $("dalton-stab-countdown"),

        // 기록 테이블
        recordsTbody:  $("dalton-records"),
        recordsEmpty:  $("dalton-records-empty"),
        recordsToggle: $("dalton-records-toggle"),
        recordsBody:   $("dalton-records-body"),
    };

    // 참조 누락 경고 (개발 편의)
    for (const [key, el] of Object.entries(dom)) {
        if (!el) console.warn(`[Dalton] DOM 참조 누락: ${key}`);
    }

    // ─────────────────────────────────────────────────────────
    // 단위 포맷 헬퍼 — atm(내부) → 표시 문자열
    // atm: 소수 둘째 자리. kPa: 소수 첫째 자리 (일반적 관행).
    // ─────────────────────────────────────────────────────────
    function formatPressure(atmVal) {
        if (daltonState.displayUnit === "kPa") {
            return `${atmToKPa(atmVal).toFixed(1)} kPa`;
        }
        return `${atmVal.toFixed(2)} atm`;
    }

    // ─────────────────────────────────────────────────────────
    // 이론값 계산 + 박스 갱신
    // 주입 전: 항상 1.00 atm (= 대기압, 고정)
    // 주입 후: P_total = (V_A/V_B + 1) × 1.00 atm
    // 단위 토글 시 자동 재포맷.
    // ─────────────────────────────────────────────────────────
    function updateTheoryBox() {
        const V_A = daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        const theoryBeforeAtm = 1.00;
        const theoryAfterAtm  = (V_A / V_B + 1) * 1.00;

        if (dom.theoryBefore) dom.theoryBefore.textContent = formatPressure(theoryBeforeAtm);
        if (dom.theoryAfter)  dom.theoryAfter.textContent  = formatPressure(theoryAfterAtm);
    }

    // ─────────────────────────────────────────────────────────
    // 압력 readout 갱신
    // - 주사기 B: pressureBSensor 값을 현재 단위로 표시 (센서 실측값 자리).
    // - 주사기 A: 결정 7 정책
    //   . IDLE/INJECTING: B 센서값 그대로 복사, hint = "(B와 동일, 대기압)"
    //   . INJECTED/CONFIRMED: "—" 비표시, hint 숨김 (B-3 stage 전환 시 본격 분기)
    // 현재 B-2 시점에서는 stage 가 항상 IDLE 이므로 A는 늘 복사 모드.
    // ─────────────────────────────────────────────────────────
    function updatePressureReadouts() {
        const sensorAtm = daltonState.pressureBSensor;

        // 주사기 B: 센서값 표시
        if (dom.pressureB) dom.pressureB.textContent = formatPressure(sensorAtm);
        // B hint 는 현재 "(센서 실측)" 고정 (시뮬 모드에서도 동일 표기)

        // 주사기 A: stage 별 분기
        const stage = daltonState.stage;
        if (stage === "IDLE" || stage === "INJECTING") {
            if (dom.pressureA) dom.pressureA.textContent = formatPressure(sensorAtm);
            if (dom.pressureAHint) {
                dom.pressureAHint.textContent = "(B와 동일, 대기압)";
                dom.pressureAHint.style.display = "";
            }
        } else {
            // INJECTED / CONFIRMED: A 는 비어있음
            if (dom.pressureA) dom.pressureA.textContent = "—";
            if (dom.pressureAHint) {
                dom.pressureAHint.textContent = "";
                dom.pressureAHint.style.display = "none";
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // 게이지 정적 렌더 (한 번만 호출). 배경 호·색상 호·눈금·바늘 SVG 생성.
    // 바늘 회전·색상 변환은 명세 2 (updateGauges) 에서 별도 처리.
    // ─────────────────────────────────────────────────────────
    function renderGaugeStatic(svgEl) {
        if (!svgEl) return;

        // 반원 게이지 좌표계: viewBox 160×100, 중심 (80, 90), 반지름 70
        const cx = 80, cy = 90, r = 70;

        // 극좌표 → SVG 좌표 (angle: 0 = 우측 3시, 180 = 좌측 9시, 시계 반대)
        function polar(angle) {
            const rad = (180 - angle) * Math.PI / 180;
            return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
        }
        function arcPath(startAngle, endAngle) {
            const s = polar(startAngle);
            const e = polar(endAngle);
            const largeArc = (endAngle - startAngle) <= 180 ? 0 : 1;
            return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
        }

        // 0~3 atm = 0~108도 (3/5 × 180), 3~5 atm = 108~180도
        const blueArc = arcPath(0, 108);
        const yellowArc = arcPath(108, 180);

        // 눈금 (0, 1, 2, 3, 4, 5)
        const ticks = [];
        for (let i = 0; i <= 5; i++) {
            const angle = (i / 5) * 180;
            const inner = polar(angle);
            const outerR = r + 6;
            const outerRad = (180 - angle) * Math.PI / 180;
            const outer = { x: cx + outerR * Math.cos(outerRad), y: cy - outerR * Math.sin(outerRad) };
            const labelR = r + 14;
            const labelPos = { x: cx + labelR * Math.cos(outerRad), y: cy - labelR * Math.sin(outerRad) };
            ticks.push({ inner, outer, label: String(i), labelPos });
        }

        const ticksMarkup = ticks.map(t => `
            <line x1="${t.inner.x.toFixed(2)}" y1="${t.inner.y.toFixed(2)}" x2="${t.outer.x.toFixed(2)}" y2="${t.outer.y.toFixed(2)}" stroke="#6b7280" stroke-width="1.5"/>
            <text x="${t.labelPos.x.toFixed(2)}" y="${(t.labelPos.y + 3).toFixed(2)}" text-anchor="middle" font-size="9" fill="#4b5563" font-family="system-ui">${t.label}</text>
        `).join('');

        const redDot = polar(180);

        svgEl.innerHTML = `
            <path d="${arcPath(0, 180)}" fill="none" stroke="#e5e7eb" stroke-width="14" stroke-linecap="butt"/>
            <path d="${blueArc}" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="butt"/>
            <path d="${yellowArc}" fill="none" stroke="#f59e0b" stroke-width="10" stroke-linecap="butt"/>
            <circle cx="${redDot.x.toFixed(2)}" cy="${redDot.y.toFixed(2)}" r="4" fill="#dc2626"/>
            ${ticksMarkup}
            <g class="dalton-gauge-needle" transform="rotate(-90 ${cx} ${cy})">
                <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 8}" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round"/>
            </g>
            <circle cx="${cx}" cy="${cy}" r="5" fill="#1f2937"/>
            <circle cx="${cx}" cy="${cy}" r="2" fill="#fff"/>
        `;
    }

    // ─────────────────────────────────────────────────────────
    // 상태 머신 전환 — stage 변경 + 버튼 disabled 제어 + readout 재갱신
    //
    // 전환 허용 테이블:
    //   IDLE       → INJECTING (주입 시작)
    //   INJECTING  → INJECTED (3초 애니메이션 완료)
    //   INJECTING  → IDLE (초기화 abort)
    //   INJECTED   → CONFIRMED (안정화 완료 + 확인 클릭)
    //   INJECTED   → IDLE (초기화)
    //   CONFIRMED  → IDLE (초기화)
    // ─────────────────────────────────────────────────────────
    function setStage(newStage) {
        daltonState.stage = newStage;

        // 버튼 disabled 일괄 제어
        if (dom.btnInject)  dom.btnInject.disabled  = (newStage !== "IDLE");
        if (dom.btnConfirm) dom.btnConfirm.disabled = (newStage !== "INJECTED");
        // reset 은 INJECTING 중에만 잠시 비활성 — abort 로직이 race condition
        // 가능성 있어 보수적으로. 실사용에서는 INJECTING 중에도 허용해도 됨.
        // 여기서는 학생이 3초 애니메이션 중 초기화 연타하는 걸 방지.
        if (dom.btnReset)   dom.btnReset.disabled   = false;

        // 숫자 입력·select 도 실험 진행 중에는 비활성
        const lockInputs = (newStage !== "IDLE");
        if (dom.gasASelect)     dom.gasASelect.disabled     = lockInputs;
        if (dom.gasBSelect)     dom.gasBSelect.disabled     = lockInputs;
        if (dom.volumeANumber)  dom.volumeANumber.disabled  = lockInputs;
        if (dom.volumeBNumber)  dom.volumeBNumber.disabled  = lockInputs;

        // 압력 readout 재갱신 (stage 분기 반영)
        updatePressureReadouts();
    }

    // ─────────────────────────────────────────────────────────
    // [주입 시작] — async 흐름
    // IDLE → INJECTING → (3초 대기) → INJECTED → 안정화 카운트다운 시작
    //
    // abort 처리: startInjection 진행 중 [초기화] 클릭 시
    // daltonState.abortCurrentFlow = true 로 바뀌고, 다음 await 이후 분기에서
    // 반환. setStage 는 초기화 핸들러가 이미 IDLE 로 돌림.
    // ─────────────────────────────────────────────────────────
    async function startInjection() {
        if (daltonState.stage !== "IDLE") return;  // 이중 클릭 방어
        daltonState.abortCurrentFlow = false;
        setStage("INJECTING");

        // 3초 주입 애니메이션 (Step E 에서 실제 피스톤 애니메이션 연결,
        // 여기서는 시간 대기만)
        await sleep(cfg.injection_animation_sec * 1000);
        if (daltonState.abortCurrentFlow) return;

        // 주입 완료 시뮬 계산: P_total = (V_A/V_B + 1) × 1 atm
        // Step C/F 에서 실제 입자 기반 계산으로 대체.
        const V_A = daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        const theoryAfterAtm = (V_A / V_B + 1) * 1.00;
        daltonState.pressureBMeasured = theoryAfterAtm;
        daltonState.pressureBSensor   = theoryAfterAtm;  // 시뮬 모드: 센서값도 이론값 동일

        setStage("INJECTED");

        // 5초 안정화 카운트다운
        await startStabilization();
    }

    // ─────────────────────────────────────────────────────────
    // 안정화 카운트다운 — 5초 동안 "5·4·3·2·1" 갱신, 완료 시 [확인] 활성화
    // (setStage(INJECTED) 가 이미 btnConfirm 을 활성으로 세팅하지만,
    //  카운트다운 중에는 안정화 인디만 보여주는 UX)
    // ─────────────────────────────────────────────────────────
    async function startStabilization() {
        let remaining = cfg.stabilization_sec;

        // 인디케이터 노출 + 초기 값
        if (dom.stabilization) dom.stabilization.classList.remove("hidden");
        if (dom.stabCountdown) dom.stabCountdown.textContent = String(remaining);

        // 카운트다운 동안 확인 버튼은 일단 비활성 (안정화 완료까지 기다림)
        if (dom.btnConfirm) dom.btnConfirm.disabled = true;

        return new Promise((resolve) => {
            daltonState.countdownIntervalId = setInterval(() => {
                if (daltonState.abortCurrentFlow) {
                    clearInterval(daltonState.countdownIntervalId);
                    daltonState.countdownIntervalId = null;
                    resolve();
                    return;
                }
                remaining -= 1;
                if (remaining > 0) {
                    if (dom.stabCountdown) dom.stabCountdown.textContent = String(remaining);
                } else {
                    clearInterval(daltonState.countdownIntervalId);
                    daltonState.countdownIntervalId = null;
                    if (dom.stabilization) dom.stabilization.classList.add("hidden");
                    if (dom.btnConfirm) dom.btnConfirm.disabled = false;
                    resolve();
                }
            }, 1000);
        });
    }

    // ─────────────────────────────────────────────────────────
    // [확인] — INJECTED → CONFIRMED, 기록 추가
    // ─────────────────────────────────────────────────────────
    function confirmMeasurement() {
        if (daltonState.stage !== "INJECTED") return;
        addRecord();
        setStage("CONFIRMED");
    }

    // ─────────────────────────────────────────────────────────
    // [초기화] — 어느 stage 에서든 IDLE 복귀
    // - stage = IDLE
    // - V_A, V_B 는 유지 (학생 편의, 반복 실험)
    // - pressureBMeasured = null
    // - 카운트다운·애니메이션 abort
    // - 안정화 인디케이터 숨김
    // ─────────────────────────────────────────────────────────
    function resetExperiment() {
        // 진행 중 async flow 중단 신호
        daltonState.abortCurrentFlow = true;
        if (daltonState.countdownIntervalId !== null) {
            clearInterval(daltonState.countdownIntervalId);
            daltonState.countdownIntervalId = null;
        }

        daltonState.pressureBMeasured = null;
        daltonState.pressureBSensor   = 1.00;  // 시뮬 기본값 복귀

        if (dom.stabilization) dom.stabilization.classList.add("hidden");
        if (dom.stabCountdown) dom.stabCountdown.textContent = String(cfg.stabilization_sec);

        setStage("IDLE");
    }

    // ─────────────────────────────────────────────────────────
    // 기록 추가 — tbody 에 <tr> append
    // B-3 범위: 회차·V_A·V_B·P(이론)·시간 5컬럼만 실데이터.
    // 나머지 5컬럼 (단계·모드·P(시뮬)·P(실측)·오차%) 은 "—" placeholder.
    // Step F·G·I 에서 각 placeholder 실데이터로 채울 예정.
    // ─────────────────────────────────────────────────────────
    function addRecord() {
        if (!dom.recordsTbody) return;

        daltonState.recordsCount += 1;
        const n = daltonState.recordsCount;
        const V_A = daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        const theoryAtm = (V_A / V_B + 1) * 1.00;
        const timeStr = new Date().toLocaleTimeString("ko-KR", { hour12: false });

        // 10컬럼 순서: 회차·단계·V_A·V_B·모드·P(이론)·P(시뮬)·P(실측)·오차%·시간
        // (설계서 §10.5 기준, thead 와 일관성 유지. V_fixed 는 2영역 모델 전환 후 제거)
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${n}</td>
            <td>—</td>
            <td>${V_A}</td>
            <td>${V_B}</td>
            <td>—</td>
            <td>${formatPressure(theoryAtm)}</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
            <td>${timeStr}</td>
        `;
        dom.recordsTbody.appendChild(tr);

        // 첫 기록: 빈 상태 안내 숨김 + accordion 자동 열기
        if (n === 1) {
            if (dom.recordsEmpty) dom.recordsEmpty.classList.add("hidden");
            if (dom.recordsBody)  dom.recordsBody.classList.remove("hidden");
            // accordion 토글 버튼의 aria-expanded / 화살표는 Step A 의 핸들러에 맡김
            // 여기서는 body 만 펼침
        }
    }

    // ─────────────────────────────────────────────────────────
    // 기체 select 채우기 (params.dalton.gases 기반)
    // ─────────────────────────────────────────────────────────
    function populateGasSelect(selectEl, selectedKey) {
        if (!selectEl) return;
        selectEl.innerHTML = "";
        for (const [key, g] of Object.entries(cfg.gases)) {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = `${g.label} (${g.M})`;
            if (key === selectedKey) opt.selected = true;
            selectEl.appendChild(opt);
        }
    }
    populateGasSelect(dom.gasASelect, daltonState.syringeA.gas);
    populateGasSelect(dom.gasBSelect, daltonState.syringeB.gas);

    // ─────────────────────────────────────────────────────────
    // 이벤트 바인딩
    // Step B-2 에서 이론값·압력 업데이트 로직 추가 예정 (현재는 상태 갱신 + 로그만)
    // ─────────────────────────────────────────────────────────
    const onStateChange = debounce(() => {
        updateTheoryBox();
        updatePressureReadouts();

        if (DEBUG_DALTON) {
            console.log("[Dalton] state changed", {
                gasA: daltonState.syringeA.gas,
                V_A: daltonState.syringeA.volume,
                gasB: daltonState.syringeB.gas,
                V_B: daltonState.syringeB.volume,
                unit: daltonState.displayUnit,
                stage: daltonState.stage,
            });
        }
    }, cfg.debounce_ms);

    // 주사기 A — 기체 select
    dom.gasASelect?.addEventListener("change", (e) => {
        daltonState.syringeA.gas = e.target.value;
        onStateChange();
    });

    // 주사기 B — 기체 select
    dom.gasBSelect?.addEventListener("change", (e) => {
        daltonState.syringeB.gas = e.target.value;
        onStateChange();
    });

    // 주사기 A·B — 숫자 입력 전용 공통 helper
    // 설계서 2696628 반영: 슬라이더 제거, A·B 둘 다 숫자 박스 Enter/blur 시
    // clamp 후 state 반영. 타이핑 중 즉시 반영하지 않음(중간값 혼란 방지).
    function applyVolume(syringeKey, rawValue) {
        const limits = cfg[`syringe_${syringeKey}`]; // syringe_a / syringe_b
        const clamped = Math.max(limits.v_min, Math.min(limits.v_max, rawValue));
        daltonState[`syringe${syringeKey.toUpperCase()}`].volume = clamped;
        // 숫자 박스 값 재반영 (clamp 결과)
        const input = (syringeKey === "a") ? dom.volumeANumber : dom.volumeBNumber;
        if (input) input.value = clamped;
        onStateChange();
    }

    function bindVolumeNumberInput(syringeKey) {
        const input = (syringeKey === "a") ? dom.volumeANumber : dom.volumeBNumber;
        if (!input) return;
        const commit = () => {
            const raw = parseFloat(input.value);
            if (Number.isFinite(raw)) {
                applyVolume(syringeKey, raw);
            } else {
                // NaN 등 비정상 값 → 직전 상태값으로 복구
                const stateKey = (syringeKey === "a") ? "syringeA" : "syringeB";
                input.value = daltonState[stateKey].volume;
            }
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
                input.blur();
            }
        });
    }
    bindVolumeNumberInput("a");
    bindVolumeNumberInput("b");

    // 단위 토글 버튼
    dom.unitToggle?.addEventListener("click", () => {
        daltonState.displayUnit = (daltonState.displayUnit === "atm") ? "kPa" : "atm";
        if (dom.unitToggle) dom.unitToggle.textContent = `단위: ${daltonState.displayUnit}`;
        // Step B-2 에서 모든 readout 재포맷
        onStateChange();
    });

    // ─────────────────────────────────────────────────────────
    // 버튼 이벤트 바인딩 (Step B-3)
    // ─────────────────────────────────────────────────────────
    dom.btnInject?.addEventListener("click", () => {
        // async 반환값은 무시 (fire-and-forget). 내부에서 abort 플래그로 흐름 제어.
        startInjection();
    });
    dom.btnConfirm?.addEventListener("click", () => {
        confirmMeasurement();
    });
    dom.btnReset?.addEventListener("click", () => {
        resetExperiment();
    });

    // ─────────────────────────────────────────────────────────
    // 초기 상태 1회 적용 (숫자 박스·이론값·압력 readout 동기)
    // ─────────────────────────────────────────────────────────
    if (dom.volumeANumber) {
        dom.volumeANumber.value = daltonState.syringeA.volume;
    }
    if (dom.volumeBNumber) {
        dom.volumeBNumber.value = daltonState.syringeB.volume;
    }
    if (dom.unitToggle) {
        dom.unitToggle.textContent = `단위: ${daltonState.displayUnit}`;
    }
    // 이론값·압력 박스 초기 동기 (비디바운스, 즉시 1회 호출)
    updateTheoryBox();
    updatePressureReadouts();

    // 게이지 SVG 정적 렌더 (배경 호·눈금·바늘 0 위치). 명세 2 에서 압력값 반영 회전 추가.
    renderGaugeStatic(dom.gaugeA);
    renderGaugeStatic(dom.gaugeB);

    // 초기 stage 를 명시적으로 IDLE 로 세팅 — 버튼 disabled 일관성 확보
    // (HTML 에 이미 btn-confirm 만 disabled 로 돼 있지만, setStage 를 한 번 호출해
    //  모든 요소가 IDLE 상태와 일치하도록 보장)
    setStage("IDLE");

    console.log("[Dalton] initDaltonApp B-3 완료. 상태 머신 + 버튼 + 기록 가동.");
}

// 페이지 디스패처 — body.dataset.page 값으로 어느 초기화를 실행할지 결정.
// boyle.html(기본 실험)은 data-page="boyle", particles.html(입자운동론)은
// data-page="particles", dalton.html(돌턴 부분압력)은 data-page="dalton".
// 랜딩(index.html)은 이 main.js 를 로드하지 않는다.
document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());
    const page = document.body.dataset.page;
    if (page === "particles") {
        initAdvancedMode(params);
    } else if (page === "dalton") {
        initDaltonApp(params);
    } else {
        // 기본값: boyle (data-page 미지정 시 하위 호환)
        await initBasicApp(params);
    }
});
