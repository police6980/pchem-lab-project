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
            volume: cfg.syringe_a.v_default,    // 100 (mL) — 논리 V (즉시 변경)
            targetVolume:    cfg.syringe_a.v_default,    // V 변경 직후 즉시 갱신 (논리 target)
            displayedVolume: cfg.syringe_a.v_default,    // 매 frame lerp — 시각 표현용
        },
        syringeB: {
            gas:    cfg.syringe_b.default_gas,  // 'co2'
            volume: cfg.syringe_b.v_default,    // 100 (mL) — 논리 V (즉시 변경)
            targetVolume:    cfg.syringe_b.v_default,
            displayedVolume: cfg.syringe_b.v_default,
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
        pressureAUnit: $("dalton-pressure-a-unit"),
        gaugeA:        $("dalton-gauge-a"),
        gaugeWarningA: $("dalton-gauge-warning-a"),

        // 주사기 B
        gasBSelect:    $("dalton-gas-b"),
        volumeBNumber: $("dalton-volume-b-number"),
        pressureB:     $("dalton-pressure-b"),
        pressureBUnit: $("dalton-pressure-b-unit"),
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
        // 압력 readout LCD 박스용 — 숫자만 반환 (단위는 별도 span 에서 처리)
        if (daltonState.displayUnit === "kPa") {
            return atmToKPa(atmVal).toFixed(1);
        }
        return atmVal.toFixed(2);
    }

    function getPressureUnit() {
        // 단위 텍스트 — 압력 readout 단위 span 용
        return daltonState.displayUnit === "kPa" ? "kPa" : "atm";
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
        const unit = getPressureUnit();

        if (dom.theoryBefore) dom.theoryBefore.textContent = `${formatPressure(theoryBeforeAtm)} ${unit}`;
        if (dom.theoryAfter)  dom.theoryAfter.textContent  = `${formatPressure(theoryAfterAtm)} ${unit}`;
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
        const unit = getPressureUnit();

        // 주사기 B: 센서값 표시 (숫자 + 단위 + 게이지 바늘 + 경고)
        if (dom.pressureB) dom.pressureB.textContent = formatPressure(sensorAtm);
        if (dom.pressureBUnit) dom.pressureBUnit.textContent = unit;
        updateGauge(dom.gaugeB, sensorAtm, dom.gaugeWarningB);

        // 주사기 A: stage 별 분기 (결정 7 정책: INJECTED 이후 A 는 "—" 표시)
        const stage = daltonState.stage;
        if (stage === "IDLE" || stage === "INJECTING") {
            if (dom.pressureA) dom.pressureA.textContent = formatPressure(sensorAtm);
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = unit;
            updateGauge(dom.gaugeA, sensorAtm, dom.gaugeWarningA);  // B 와 동일 (대기압 또는 주입 중)
        } else {
            // INJECTED / CONFIRMED: A 는 비어있음 → 디지털 '—', 게이지 0 위치
            if (dom.pressureA) dom.pressureA.textContent = "—";
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = "";
            updateGauge(dom.gaugeA, 0, dom.gaugeWarningA);  // 0 atm 이라 경고 자동 hidden
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
            <text x="${t.labelPos.x.toFixed(2)}" y="${(t.labelPos.y + 3).toFixed(2)}" text-anchor="middle" font-size="14" fill="#4b5563" font-family="system-ui">${t.label}</text>
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
    // 압력값 (atm) → 게이지 바늘 회전 각도 (도)
    // 매핑: 0 atm → -90도 (좌측 9시), 2.5 atm → 0도 (12시), 5 atm → +90도 (우측 3시)
    // 5 atm 초과 시: +90 고정 (명세 3/4 의 경고 처리와 일관)
    // ─────────────────────────────────────────────────────────
    function pressureToAngle(atmVal) {
        const clamped = Math.min(Math.max(atmVal, 0), 5);
        return (clamped / 5) * 180 - 90;
    }

    // ─────────────────────────────────────────────────────────
    // 단일 게이지 바늘 회전 갱신
    // svgEl: 대상 SVG 엘리먼트 (dom.gaugeA / gaugeB)
    // atmVal: 표시할 압력 (atm 단위)
    // ─────────────────────────────────────────────────────────
    function updateGauge(svgEl, atmVal, warningEl) {
        if (!svgEl) return;
        const needle = svgEl.querySelector('.dalton-gauge-needle');
        if (!needle) return;

        // 1. 회전 (회전 중심 cx=80, cy=90 — renderGaugeStatic 좌표계와 일치)
        const angle = pressureToAngle(atmVal);
        needle.setAttribute('transform', `rotate(${angle.toFixed(2)} 80 90)`);

        // 2. 색상 분기 (5 atm 초과 시 빨강)
        const line = needle.querySelector('line');
        if (line) {
            line.setAttribute('stroke', atmVal > 5 ? '#dc2626' : '#1f2937');
        }

        // 3. 경고 텍스트 표시/숨김 (warningEl 제공된 경우)
        if (warningEl) {
            if (atmVal > 5) {
                warningEl.removeAttribute('hidden');
            } else {
                warningEl.setAttribute('hidden', '');
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // DaltonScene 시각 상수 (Step C-1 v3 — 세로 시린지 + U자 연결)
    //
    // 좌표: 1000×600. 시린지 A 좌·B 우, 본체는 세로 (높이 420),
    // 피스톤은 위에서 아래로 이동. 두 시린지 하단 노즐을 ㄷ자 튜브로 연결.
    // 부피 V (mL) → 피스톤 Y 위치 선형 매핑 (V_min=10 → 바닥 근처,
    // V_max=100 → 천장 근처). hatching 없음 — 시린지에 고정벽 메타포 부적합.
    // 컬러: HSB 모드 (보일/particles 와 통일). 가스색은 회색조 옅은 톤.
    // ─────────────────────────────────────────────────────────
    const SCENE = {
        canvasW: 1160,              // 게이지 overlay 공간 추가 확장 (좌·우 여유 200px) — v3 마무리 v4
        canvasH: 600,
        // 시린지 공통 치수
        bodyW: 320,                 // 본체 폭 (입자 운동 가시성 확보 위해 추가 확장 — v3 마무리)
        bodyTop: 30,                // 본체 상단 Y (피스톤 봉 짧게 — v3 마무리)
        bodyBottom: 480,            // 본체 하단 Y (노즐 출구 직전)
        bodyHeightPx: 450,          // = bodyBottom 480 - bodyTop 30
        wallStrokeWeight: 1.5,      // 본체 외곽선
        // 시린지 A (좌)
        syringeA: {
            centerX: 360,
            bodyLeft: 200,
            bodyRight: 520,
        },
        // 시린지 B (우)
        syringeB: {
            centerX: 800,
            bodyLeft: 640,
            bodyRight: 960,
        },
        // 노즐 출구 (시린지 본체 하단의 좁은 통로)
        nozzleW: 24,                // 노즐 폭
        nozzleTop: 480,
        nozzleBottom: 520,          // ㄷ자 튜브 수평선 시작 Y
        // ㄷ자 튜브 (두 시린지 하단을 연결)
        tubeY: 520,                 // 수평 튜브 윗면 Y
        tubeH: 20,                  // 수평 튜브 두께
        // 피스톤 (위쪽으로 손잡이가 빠져나옴)
        pistonHeadH: 14,            // 피스톤 면 두께 (가로 직사각형)
        pistonShaftW: 18,           // 손잡이 봉 폭 (세로)
        pistonCapW: 60,             // 단캡 폭 (가로)
        pistonCapH: 12,             // 단캡 두께
        pistonCapTopMargin: 10,     // 캔버스 상단 ↔ 단캡 간격
        // 부피 ↔ 피스톤 Y 매핑 파라미터
        volumeMin: 10,              // mL
        volumeMax: 100,             // mL
        // 가스색 (HSB) — 본체 채움용 옅은 톤
        gasColors: {
            air: [210, 8, 96],
            co2: [140, 10, 95],
            n2:  [220, 6, 96],
            o2:  [260, 8, 96],
            he:  [50, 10, 96],
        },
        // 입자 관련 (Step C-2)
        particleSpeedScale: 90,     // 보일 120 보다 축소 — 박스 작음에 맞춤
        particleRadius: 2.5,        // simulation.js PARTICLE_RADIUS 와 동일
        boxMargin: 2,               // drawSyringe 의 fill margin 과 동기
        boxMinHeight: 30,           // V_min 시 box.height 음수 방지
        particleCountPerSyringe: 60, // 시린지당 고정 (V 변경 시 재생성 불필요 — Step C-2 보강)
        volumeLerpFactor: 0.15,     // displayedVolume 보간율 (매 frame 15% 접근, 약 0.13초 도달) — Step C-2 통합
        // 주입 애니메이션 (Step C-3)
        injectionStaggerSec: 2.0,   // 입자별 출발 시점 0~2초 무작위 분산
        injectionDurationSec: 1.5,  // 입자 1개의 이주 소요 시간 (waypoint 통과)
        // Step C-3 v3 — 5 region 물리 안정성·자연 흐름 강화
        physicsSubstepMaxDtSec: 0.005,  // 한 substep max dt = 5ms (region 다중 통과 방지)
        injectionDriftAccelPx: 600,     // 주입 중 drift force (px/s²) — R2/R3/R4 에 압력 차이 시각화
    };

    // 부피 → 피스톤 면의 Y 좌표 (본체 안쪽)
    function volumeToPistonY(volumeMl) {
        const ratio = (volumeMl - SCENE.volumeMin) / (SCENE.volumeMax - SCENE.volumeMin);
        const clamped = Math.max(0, Math.min(1, ratio));
        // V_max=100 → bodyTop+10 (위), V_min=10 → bodyBottom-10 (아래)
        return SCENE.bodyBottom - 10 - clamped * (SCENE.bodyHeightPx - 20);
    }

    // ─────────────────────────────────────────────────────────
    // 가스 데이터 헬퍼 (Step C-2)
    // params.json dalton.gases[gasKey] = { label, M, speedFactor, color }
    // ─────────────────────────────────────────────────────────
    function getGasData(gasKey) {
        const gases = (cfg.gases) || {};
        return gases[gasKey] || gases.air || { speedFactor: 1.0, color: "#888888" };
    }

    function getGasColor(p, gasKey) {
        const c = SCENE.gasColors[gasKey] || SCENE.gasColors.air;
        return p.color(c[0], c[1], c[2]);
    }

    // ─────────────────────────────────────────────────────────
    // 입자 시스템 (Step C-2)
    // 시린지 A·B 각 1개의 ParticleSystem 인스턴스. 박스는 단순 객체.
    // V·gas 변경 시 통째 재생성 (rebuildParticleSystem).
    // ─────────────────────────────────────────────────────────
    // 박스: 단순 좌표 객체. displayedVolume 기반 매 frame 재계산.
    const boxA = { x: 0, y: 0, width: 0, height: 0 };
    const boxB = { x: 0, y: 0, width: 0, height: 0 };
    // 5 region 물리 모드: 단일 allParticles array. systemA/B 폐기 (Step C-3 v2)
    let allParticles = [];

    function computeBox(syr, volumeMl) {
        const pistonY = volumeToPistonY(volumeMl);
        const m = SCENE.boxMargin;
        const x = syr.bodyLeft + m;
        const y = pistonY + SCENE.pistonHeadH;
        const width = SCENE.bodyW - 2 * m;
        const height = Math.max(SCENE.boxMinHeight, SCENE.bodyBottom - y);
        return { x, y, width, height };
    }

    // 좌표 → region 번호 (1~5) 또는 null (비정상)
    // R1: A 박스, R2: A 노즐 통로, R3: 수평 튜브, R4: B 노즐 통로, R5: B 박스
    function getRegion(x, y) {
        if (y <= SCENE.bodyBottom) {
            // 박스 영역 (R1 또는 R5)
            if (x >= SCENE.syringeA.bodyLeft && x <= SCENE.syringeA.bodyRight) return 1;
            if (x >= SCENE.syringeB.bodyLeft && x <= SCENE.syringeB.bodyRight) return 5;
            return null;
        }
        if (y <= SCENE.tubeY) {
            // 노즐 통로 (R2 또는 R4)
            const aL = SCENE.syringeA.centerX - SCENE.nozzleW / 2;
            const aR = SCENE.syringeA.centerX + SCENE.nozzleW / 2;
            if (x >= aL && x <= aR) return 2;
            const bL = SCENE.syringeB.centerX - SCENE.nozzleW / 2;
            const bR = SCENE.syringeB.centerX + SCENE.nozzleW / 2;
            if (x >= bL && x <= bR) return 4;
            return null;
        }
        if (y <= SCENE.tubeY + SCENE.tubeH) return 3;  // 수평 튜브
        return null;
    }

    // 5 region 물리 update — 입자 좌표 적분 + region 별 외곽 벽 충돌
    // Step C-3 v3: substep 분할 (region 다중 통과 방지)
    function physicsStep(dt) {
        const maxSub = SCENE.physicsSubstepMaxDtSec;
        const subSteps = Math.max(1, Math.ceil(dt / maxSub));
        const subDt = dt / subSteps;
        for (let s = 0; s < subSteps; s++) {
            physicsSubstep(subDt);
        }
    }

    // 단일 substep — drift force + region 별 충돌 + null 회수
    function physicsSubstep(dt) {
        const r = SCENE.particleRadius;
        const r1Top    = boxA.y;
        const r1Bottom = SCENE.bodyBottom;
        const r1Left   = SCENE.syringeA.bodyLeft;
        const r1Right  = SCENE.syringeA.bodyRight;
        const r2Left   = SCENE.syringeA.centerX - SCENE.nozzleW / 2;
        const r2Right  = SCENE.syringeA.centerX + SCENE.nozzleW / 2;
        const r3Top    = SCENE.tubeY;
        const r3Bottom = SCENE.tubeY + SCENE.tubeH;
        const r3Left   = r2Left;
        const r3Right  = SCENE.syringeB.centerX + SCENE.nozzleW / 2;
        const r4Left   = SCENE.syringeB.centerX - SCENE.nozzleW / 2;
        const r4Right  = SCENE.syringeB.centerX + SCENE.nozzleW / 2;
        const r5Top    = boxB.y;
        const r5Bottom = SCENE.bodyBottom;
        const r5Left   = SCENE.syringeB.bodyLeft;
        const r5Right  = SCENE.syringeB.bodyRight;

        // 주입 중일 때만 drift accel 활성 (압력 차이 시각화)
        const driftAccel = injectionPistonAnimating ? SCENE.injectionDriftAccelPx : 0;

        for (const p of allParticles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            const region = getRegion(p.x, p.y);

            // drift force (주입 중 R2/R3/R4 만)
            if (driftAccel > 0) {
                if (region === 2)      p.vy += driftAccel * dt;       // R2: 아래로 (R1→R3)
                else if (region === 3) p.vx += driftAccel * dt;       // R3: 오른쪽으로
                else if (region === 4) p.vy += -driftAccel * dt;      // R4: 위로 (R3→R5)
            }

            if (region === 1) {
                if (p.x - r < r1Left)  { p.x = r1Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r1Right) { p.x = r1Right - r; if (p.vx > 0) p.vx = -p.vx; }
                if (p.y - r < r1Top)   { p.y = r1Top + r;   if (p.vy < 0) p.vy = -p.vy; }
                if (p.y + r > r1Bottom && (p.x < r2Left || p.x > r2Right)) {
                    p.y = r1Bottom - r;
                    if (p.vy > 0) p.vy = -p.vy;
                }
            } else if (region === 2) {
                if (p.x - r < r2Left)  { p.x = r2Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r2Right) { p.x = r2Right - r; if (p.vx > 0) p.vx = -p.vx; }
            } else if (region === 3) {
                if (p.y - r < r3Top)    { p.y = r3Top + r;    if (p.vy < 0) p.vy = -p.vy; }
                if (p.y + r > r3Bottom) { p.y = r3Bottom - r; if (p.vy > 0) p.vy = -p.vy; }
                if (p.x - r < r3Left)   { p.x = r3Left + r;   if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r3Right)  { p.x = r3Right - r;  if (p.vx > 0) p.vx = -p.vx; }
            } else if (region === 4) {
                if (p.x - r < r4Left)  { p.x = r4Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r4Right) { p.x = r4Right - r; if (p.vx > 0) p.vx = -p.vx; }
            } else if (region === 5) {
                if (p.x - r < r5Left)  { p.x = r5Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r5Right) { p.x = r5Right - r; if (p.vx > 0) p.vx = -p.vx; }
                if (p.y - r < r5Top)   { p.y = r5Top + r;   if (p.vy < 0) p.vy = -p.vy; }
                if (p.y + r > r5Bottom && (p.x < r4Left || p.x > r4Right)) {
                    p.y = r5Bottom - r;
                    if (p.vy > 0) p.vy = -p.vy;
                }
            } else {
                // null region — 빈 공간 영역별 회수 (Step C-3 v3 강화)
                rescueParticleFromNull(p, r,
                    r1Top, r1Left, r1Right, r2Left, r2Right,
                    r3Top, r3Bottom, r3Left, r3Right,
                    r4Left, r4Right, r5Top, r5Left, r5Right);
            }
        }
    }

    // null region 입자 회수 — 좌표 기반 가까운 region 으로 강제 이주
    function rescueParticleFromNull(p, r,
        r1Top, r1Left, r1Right, r2Left, r2Right,
        r3Top, r3Bottom, r3Left, r3Right,
        r4Left, r4Right, r5Top, r5Left, r5Right) {
        const bodyBottom = SCENE.bodyBottom;
        const tubeY = SCENE.tubeY;
        const tubeBot = tubeY + SCENE.tubeH;

        if (p.y < bodyBottom) {
            // 박스 라인 — x 로 가까운 박스 결정
            if (p.x < (r2Right + r4Left) / 2) {
                p.x = Math.max(r1Left + r, Math.min(r1Right - r, p.x));
                p.y = Math.max(r1Top + r, Math.min(bodyBottom - r, p.y));
            } else {
                p.x = Math.max(r5Left + r, Math.min(r5Right - r, p.x));
                p.y = Math.max(r5Top + r, Math.min(bodyBottom - r, p.y));
            }
        } else if (p.y < tubeY) {
            // 노즐 통로 라인 — x 로 가까운 노즐 결정
            if (p.x < (r2Right + r4Left) / 2) {
                p.x = Math.max(r2Left + r, Math.min(r2Right - r, p.x));
            } else {
                p.x = Math.max(r4Left + r, Math.min(r4Right - r, p.x));
            }
            p.y = Math.max(bodyBottom + r, Math.min(tubeY - r, p.y));
        } else if (p.y <= tubeBot) {
            // R3 라인 — x clamp
            p.x = Math.max(r3Left + r, Math.min(r3Right - r, p.x));
            p.y = Math.max(tubeY + r, Math.min(tubeBot - r, p.y));
        } else {
            // 튜브 아래 — R3 안으로
            p.x = Math.max(r3Left + r, Math.min(r3Right - r, p.x));
            p.y = tubeBot - r;
            if (p.vy > 0) p.vy = -p.vy;
        }
    }

    // 박스 갱신 — displayedVolume 기반 매 frame 호출 (단순 직접 갱신)
    function updateBox(box, syr, displayedVolumeMl) {
        const next = computeBox(syr, displayedVolumeMl);
        box.x = next.x;
        box.y = next.y;
        box.width = next.width;
        box.height = next.height;
    }

    // 매 frame 호출 — daltonState 의 displayedVolume 을 targetVolume 으로 lerp
    function lerpDisplayedVolumes() {
        const k = SCENE.volumeLerpFactor;
        const sA = daltonState.syringeA;
        const sB = daltonState.syringeB;
        sA.displayedVolume += (sA.targetVolume - sA.displayedVolume) * k;
        sB.displayedVolume += (sB.targetVolume - sB.displayedVolume) * k;
    }

    function rebuildParticleSystem(syringeKey) {
        const isA = syringeKey === "A";
        const syr = isA ? SCENE.syringeA : SCENE.syringeB;
        const volumeMl = isA ? daltonState.syringeA.volume : daltonState.syringeB.volume;
        const gasKey = isA ? daltonState.syringeA.gas : daltonState.syringeB.gas;
        const box = isA ? boxA : boxB;
        const targetRegion = isA ? 1 : 5;  // R1 또는 R5

        // 재생성 시 박스 즉시 갱신
        updateBox(box, syr, volumeMl);

        // 해당 region (R1 또는 R5) 안 기존 입자 제거
        allParticles = allParticles.filter((p) => getRegion(p.x, p.y) !== targetRegion);

        // 입자 수 고정 (Step C-2 보강) — V 변경 시 재생성 불필요
        const particleCount = SCENE.particleCountPerSyringe;
        const gasData = getGasData(gasKey);
        const speedScale = SCENE.particleSpeedScale * (gasData.speedFactor || 1.0);

        // 입자 생성: 박스 안 임의 위치 + 정규분포 속도 (Box-Muller)
        for (let i = 0; i < particleCount; i++) {
            const x = box.x + Math.random() * box.width;
            const y = box.y + Math.random() * box.height;
            const u1 = Math.max(0.0001, Math.random());
            const u2 = Math.random();
            const angle = u2 * Math.PI * 2;
            const mag = Math.sqrt(-2 * Math.log(u1)) * speedScale;
            const vx = mag * Math.cos(angle);
            const vy = mag * Math.sin(angle);
            const particle = new Particle(x, y, vx, vy, SCENE.particleRadius);
            particle.gasKey = gasKey;
            allParticles.push(particle);
        }
    }

    function rebuildAllSystems() {
        rebuildParticleSystem("A");
        rebuildParticleSystem("B");
    }

    // ─────────────────────────────────────────────────────────
    // 주입 애니메이션 (Step C-3)
    // ─────────────────────────────────────────────────────────

    // Step C-3 v2: getInjectionWaypoints / interpolateWaypoints 폐기 — 5 region 물리 모드는 waypoint 사용 안 함

    // Step C-3 v2: migratingParticles / injectionAnimationActive 폐기 — 5 region 모드에서 단일 allParticles 로 통합
    let injectionPistonAnimating = false;  // A 의 V 50→0 보간 중 (drawDaltonScene 에서 displayedVolume 직접 덮어쓰기)

    // 주입 애니메이션 시작 — 5 region 물리 모드 (waypoint 폐기, 피스톤 압축으로 자연 흐름)
    // 반환: Promise (완료 또는 abort 시 resolve)
    async function runInjectionAnimation() {
        // Step C-3 피스톤 애니: A 의 V 점진 감소 시작
        daltonState.syringeA.injectionStartVolume = daltonState.syringeA.displayedVolume;
        daltonState.syringeA.injectionStartTime = performance.now();
        injectionPistonAnimating = true;

        // 입자는 그대로 둠 (피스톤 압축으로 자연스럽게 R1 → R2 → R3 → R4 → R5 이주)
        // 매 frame physicsStep 이 입자 운동·충돌 처리.
        // 이 함수는 finalize 조건 (시간 + 상태) 까지 대기.

        const totalTimeoutMs = (cfg.injection_animation_sec || 3) * 1000;
        const safetyTimeoutMs = totalTimeoutMs + 1000;  // +1초 여유
        const startTime = performance.now();

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (daltonState.abortCurrentFlow) {
                    clearInterval(checkInterval);
                    injectionPistonAnimating = false;  // abort 시 V 복구는 resetExperiment 가 처리
                    resolve();
                    return;
                }
                const elapsed = performance.now() - startTime;
                // R1~R4 입자 0개 + 시간 도달 시 정상 종료
                const r1to4Count = countParticlesInRegions([1, 2, 3, 4]);
                if (elapsed >= totalTimeoutMs && r1to4Count === 0) {
                    clearInterval(checkInterval);
                    finalizeInjectedVolume();
                    resolve();
                    return;
                }
                // safety timeout: 강제 R5 이주 후 종료
                if (elapsed >= safetyTimeoutMs) {
                    forceRemainingToR5();
                    clearInterval(checkInterval);
                    finalizeInjectedVolume();
                    resolve();
                    return;
                }
            }, 100);
        });
    }

    // 입자 array 에서 특정 region 들에 있는 입자 수 카운트
    function countParticlesInRegions(regions) {
        let count = 0;
        for (const p of allParticles) {
            if (regions.includes(getRegion(p.x, p.y))) count++;
        }
        return count;
    }

    // safety timeout 시 R1~R4 입자를 강제로 R5 안 임의 위치로 이주
    function forceRemainingToR5() {
        for (const p of allParticles) {
            const region = getRegion(p.x, p.y);
            if (region !== 5 && region !== null) {
                p.x = boxB.x + Math.random() * boxB.width;
                p.y = boxB.y + Math.random() * boxB.height;
            }
        }
    }

    // 주입 완료 시 A 의 V 를 0 으로 확정 (논리값·target·displayed 모두 동기)
    function finalizeInjectedVolume() {
        daltonState.syringeA.volume = 0;
        daltonState.syringeA.targetVolume = 0;
        daltonState.syringeA.displayedVolume = 0;
        injectionPistonAnimating = false;
    }

    // Step C-3 v2: deliverToSystemB / updateMigratingParticles / drawMigratingParticles 폐기 — 5 region 물리 모드로 대체

    // ─────────────────────────────────────────────────────────
    // DaltonScene p5 sketch (Step C-1 v3 — 세로 시린지 + U자 연결,
    // Step C-2 — 입자 시뮬레이션)
    // draw 루프 활성 (60fps). V·gas 변경 시 onStateChange 가 systemA/B 재생성.
    // ─────────────────────────────────────────────────────────
    const daltonSketch = (p) => {
        p.setup = () => {
            p.createCanvas(SCENE.canvasW, SCENE.canvasH);
            // HSB 모드 — 보일/particles 와 통일
            p.colorMode(p.HSB, 360, 100, 100, 255);
            // Step C-2: noLoop 제거 → draw 루프 활성 (~60fps)
            // 입자 시스템 초기화 (V·gas 기반 입자 수·속도)
            rebuildAllSystems();
            drawDaltonScene(p);  // 초기 1회 즉시 그림
        };
        p.draw = () => {
            drawDaltonScene(p);
        };
    };

    // 시린지 1개 그리기 (본체 외곽 + 노즐 출구 + 가스색 채움 + 피스톤)
    // syr: SCENE.syringeA 또는 SCENE.syringeB
    // gasKey: daltonState 의 gas 키
    // volumeMl: 현재 부피 (mL)
    function drawSyringe(p, syr, gasKey, displayedVolumeMl) {
        const pistonY = volumeToPistonY(displayedVolumeMl);

        // 1. 본체 안 가스색 채움 영역 (피스톤 면 ~ 본체 하단)
        p.noStroke();
        p.fill(getGasColor(p, gasKey));
        p.rect(syr.bodyLeft + 2, pistonY + SCENE.pistonHeadH, SCENE.bodyW - 4, SCENE.bodyBottom - (pistonY + SCENE.pistonHeadH));

        // 2. 본체 외곽선 (직사각형, 위는 열려있음)
        p.stroke(0, 0, 31);
        p.strokeWeight(SCENE.wallStrokeWeight);
        p.noFill();
        // 좌측 벽
        p.line(syr.bodyLeft, SCENE.bodyTop, syr.bodyLeft, SCENE.bodyBottom);
        // 우측 벽
        p.line(syr.bodyRight, SCENE.bodyTop, syr.bodyRight, SCENE.bodyBottom);
        // 하단 벽 (노즐 출구 영역만 빠짐)
        const nozzleLeft = syr.centerX - SCENE.nozzleW / 2;
        const nozzleRight = syr.centerX + SCENE.nozzleW / 2;
        p.line(syr.bodyLeft, SCENE.bodyBottom, nozzleLeft, SCENE.bodyBottom);
        p.line(nozzleRight, SCENE.bodyBottom, syr.bodyRight, SCENE.bodyBottom);
        // 노즐 좌·우 벽 (본체 하단에서 튜브 윗면까지 좁아짐)
        p.line(nozzleLeft, SCENE.bodyBottom, nozzleLeft, SCENE.tubeY);
        p.line(nozzleRight, SCENE.bodyBottom, nozzleRight, SCENE.tubeY);

        // 3. 피스톤 (3-rect: 면 + 봉 + 단캡)
        // 3-1. 피스톤 면 (가로 직사각형, 본체 안)
        p.noStroke();
        p.fill(0, 0, 48);
        p.rect(syr.bodyLeft + 2, pistonY, SCENE.bodyW - 4, SCENE.pistonHeadH);
        // 3-2. 손잡이 봉 (세로, 피스톤 면에서 위로 빠져나옴)
        p.fill(0, 0, 62);
        const shaftX = syr.centerX - SCENE.pistonShaftW / 2;
        const shaftTop = SCENE.pistonCapTopMargin + SCENE.pistonCapH;
        p.rect(shaftX, shaftTop, SCENE.pistonShaftW, pistonY - shaftTop);
        // 3-3. 단캡 (가로, 봉 맨 위)
        p.fill(0, 0, 42);
        const capX = syr.centerX - SCENE.pistonCapW / 2;
        p.rect(capX, SCENE.pistonCapTopMargin, SCENE.pistonCapW, SCENE.pistonCapH);
    }

    // ㄷ자 튜브 (두 시린지 하단 연결: A 노즐 출구 → 수평 튜브 → B 노즐 출구)
    function drawConnectorTube(p) {
        const tubeFill = p.color(0, 0, 70);
        const tubeStroke = p.color(0, 0, 31);
        // 튜브 좌측 끝 (A 시린지 노즐 출구 위치) ~ 우측 끝 (B 시린지 노즐 출구 위치)
        const xLeft = SCENE.syringeA.centerX - SCENE.nozzleW / 2;
        const xRight = SCENE.syringeB.centerX + SCENE.nozzleW / 2;
        // 수평 튜브
        p.noStroke();
        p.fill(tubeFill);
        p.rect(xLeft, SCENE.tubeY, xRight - xLeft, SCENE.tubeH);
        // 외곽선
        p.stroke(tubeStroke);
        p.strokeWeight(SCENE.wallStrokeWeight);
        p.noFill();
        p.rect(xLeft, SCENE.tubeY, xRight - xLeft, SCENE.tubeH);
    }

    function drawDaltonScene(p) {
        // 배경 (HSB 거의 흰색)
        p.background(0, 0, 98);

        // displayedVolume 보간 (매 frame, 모든 시각 요소가 이 값 참조 — Step C-2 통합)
        lerpDisplayedVolumes();

        // Step C-3 피스톤 애니: 주입 중 A 의 displayedVolume 을 직접 덮어쓰기 (lerp 결과 무시)
        if (injectionPistonAnimating) {
            const sA = daltonState.syringeA;
            const elapsed = performance.now() - sA.injectionStartTime;
            const totalMs = (cfg.injection_animation_sec || 3) * 1000;
            const progress = Math.min(1, elapsed / totalMs);
            sA.displayedVolume = sA.injectionStartVolume * (1 - progress);
        }

        // 시린지 A (좌)
        drawSyringe(p, SCENE.syringeA, daltonState.syringeA.gas, daltonState.syringeA.displayedVolume);
        // 시린지 B (우)
        drawSyringe(p, SCENE.syringeB, daltonState.syringeB.gas, daltonState.syringeB.displayedVolume);
        // ㄷ자 튜브 (시린지 하단 연결)
        drawConnectorTube(p);

        // ─────────────────────────────────────────────────────────
        // Step C-3 v2: 5 region 물리 — 박스 갱신 → physicsStep → 단일 그리기
        // ─────────────────────────────────────────────────────────
        if (allParticles.length > 0) {
            const dt = Math.min((p.deltaTime || 0) / 1000, 0.05);

            // 박스 갱신 (displayedVolume 기반 매 frame 재계산)
            updateBox(boxA, SCENE.syringeA, daltonState.syringeA.displayedVolume);
            updateBox(boxB, SCENE.syringeB, daltonState.syringeB.displayedVolume);

            // 5 region 물리 update (입자 좌표 적분 + region 별 외곽 벽 충돌)
            physicsStep(dt);

            // 입자별 gasKey 로 색 결정 — 단일 호출
            drawParticlesByGas(p, allParticles, daltonState.syringeA.gas);
        }
    }

    // 입자 그리기 — 가스별 RGB 색 (params.json dalton.gases[gasKey].color)
    // p5 가 HSB 모드여도 hex 문자열을 자동 변환해 fill 처리
    // 입자별 gasKey 우선 (Step C-3 — 주입 후 B 안에 두 가스 공존). 없으면 defaultGasKey 사용.
    function drawParticlesByGas(p, particles, defaultGasKey) {
        p.noStroke();
        for (const particle of particles) {
            const gasKey = particle.gasKey || defaultGasKey;
            const gasData = getGasData(gasKey);
            p.fill(p.color(gasData.color || "#888888"));
            p.circle(particle.x, particle.y, particle.radius * 2);
        }
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
        // Step C-3: sleep → 입자 이주 애니메이션 (A 입자 60개 → 노즐 → 튜브 → B)
        await runInjectionAnimation();
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

        // Step C-3 v2: 입자 정리 + 시스템 재생성 (A 60 / B 60 복구)
        injectionPistonAnimating = false;  // 피스톤 애니 정리 (Step C-3 piston / v2)
        // Step C-3 피스톤 애니 보강: input UI 값에서 V 복구 (주입 완료로 V=0 확정된 경우 대비)
        const rawA = parseFloat(dom.volumeANumber?.value);
        const rawB = parseFloat(dom.volumeBNumber?.value);
        const vA = Number.isFinite(rawA)
            ? Math.max(cfg.syringe_a.v_min, Math.min(cfg.syringe_a.v_max, rawA))
            : cfg.syringe_a.v_default;
        const vB = Number.isFinite(rawB)
            ? Math.max(cfg.syringe_b.v_min, Math.min(cfg.syringe_b.v_max, rawB))
            : cfg.syringe_b.v_default;
        daltonState.syringeA.volume = vA;
        daltonState.syringeA.targetVolume = vA;
        daltonState.syringeA.displayedVolume = vA;
        daltonState.syringeB.volume = vB;
        daltonState.syringeB.targetVolume = vB;
        daltonState.syringeB.displayedVolume = vB;
        rebuildParticleSystem("A");
        rebuildParticleSystem("B");

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
            <td>${formatPressure(theoryAtm)} ${getPressureUnit()}</td>
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
    // Step C-2: gas 변경 추적 — gas 만 변경 시 재생성, V 만 변경 시 targetVolume 갱신
    let lastGasA = daltonState.syringeA.gas;
    let lastGasB = daltonState.syringeB.gas;

    const onStateChange = debounce(() => {
        updateTheoryBox();
        updatePressureReadouts();

        // gas 변경 시 재생성 (입자 색·속도 변경 위해, displayedVolume 도 즉시 동기)
        const gasChangedA = daltonState.syringeA.gas !== lastGasA;
        const gasChangedB = daltonState.syringeB.gas !== lastGasB;
        if (gasChangedA) {
            daltonState.syringeA.displayedVolume = daltonState.syringeA.volume;  // 즉시 동기
            rebuildParticleSystem("A");
            lastGasA = daltonState.syringeA.gas;
        }
        if (gasChangedB) {
            daltonState.syringeB.displayedVolume = daltonState.syringeB.volume;
            rebuildParticleSystem("B");
            lastGasB = daltonState.syringeB.gas;
        }

        // V 변경은 targetVolume 만 갱신 (매 frame lerpDisplayedVolumes 로 부드럽게 도달)
        daltonState.syringeA.targetVolume = daltonState.syringeA.volume;
        daltonState.syringeB.targetVolume = daltonState.syringeB.volume;

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
    // 게이지 SVG 정적 렌더 먼저 (배경 호·눈금·바늘 SVG 생성).
    // 그 다음 압력 readout (updatePressureReadouts) 가 바늘 회전까지 일괄 갱신.
    renderGaugeStatic(dom.gaugeA);
    renderGaugeStatic(dom.gaugeB);

    // 이론값·압력 박스 초기 동기 (비디바운스, 즉시 1회 호출)
    updateTheoryBox();
    updatePressureReadouts();

    // DaltonScene p5 sketch 부착 (Step C-1: 정적 그림)
    const sceneParent = document.getElementById("dalton-canvas-wrap");
    let daltonP5 = null;
    if (sceneParent) {
        daltonP5 = new p5(daltonSketch, sceneParent);
    } else if (DEBUG_DALTON) {
        console.warn("[Dalton] dalton-canvas-wrap not found — p5 sketch skipped");
    }

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
