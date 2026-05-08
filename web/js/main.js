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
    window._sensorManager = sensorManager; // DEBUG: cfg/calib 콘솔 검증용 (Phase 3 RX 처리 검증)

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

    // Phase 5.5: 가스 비교 — 변경 직전 스냅샷 + 평균속도 비율 표시 (Graham 법칙 직관 학습)
    let prevGasSnapshot = null;
    const gasComparisonEl = document.createElement("div");
    gasComparisonEl.id = "adv-gas-comparison";
    gasComparisonEl.style.cssText = "margin-top:8px;padding:6px 10px;background:#f3f4f6;border-radius:4px;font-size:0.85em;color:#374151;display:none;";
    gasSelect.parentElement?.appendChild(gasComparisonEl);

    gasSelect.addEventListener("change", () => {
        const oldScale = currentSpeedScale();
        const oldGas = Object.keys(ADV_GAS_MASSES).find(k => ADV_GAS_MASSES[k] === currentGasMass) || "?";
        const oldAvgSpeed = system.getAverageSpeed();
        const oldM = currentGasMass;

        currentGasMass = ADV_GAS_MASSES[gasSelect.value];
        system.scaleVelocities(currentSpeedScale() / oldScale);

        const newGas = gasSelect.value;
        const newM = currentGasMass;
        const newAvgSpeed = system.getAverageSpeed();
        prevGasSnapshot = { gas: oldGas, avgSpeed: oldAvgSpeed, M: oldM };

        // Graham 법칙 — v̄_new / v̄_old = √(M_old / M_new)
        const expectedRatio = Math.sqrt(oldM / newM);
        const actualRatio = oldAvgSpeed > 0 ? newAvgSpeed / oldAvgSpeed : 0;
        gasComparisonEl.style.display = "block";
        gasComparisonEl.innerHTML =
            `<strong>가스 비교 (Graham)</strong>: ${oldGas} (M=${oldM}) → ${newGas} (M=${newM})<br>` +
            `v̄ 비율 측정 = ${actualRatio.toFixed(3)} · 이론 √(${oldM}/${newM}) = ${expectedRatio.toFixed(3)}`;
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
            // Step C-3 v10: P_A 점진 감소 계산용 초기값 (방어 — runInjectionAnimation 시 갱신)
            injectionStartVolume: cfg.syringe_a.v_default,
            injectionStartTime: 0,
        },
        syringeB: {
            gas:    cfg.syringe_b.default_gas,  // 'co2'
            volume: cfg.syringe_b.v_default,    // 100 (mL) — 논리 V (즉시 변경)
            targetVolume:    cfg.syringe_b.v_default,
            displayedVolume: cfg.syringe_b.v_default,
        },
        // 주사기 A·B 센서 측정값 (atm 기준, 내부 계산용).
        // 시뮬 모드에서는 1.00 고정 (주입 전 상태 = 대기압).
        // ws/real 모드(Phase 5.4) 에서 실제 수신값으로 덮어씀.
        pressureASensor: 1.00,
        pressureBSensor: 1.00,
        // Phase 5.4: EMA 평활 + 입자 수 일관성
        emaP_A_kPa: 101.325,
        emaP_B_kPa: 101.325,
        lastUpdatedP_A_kPa: 101.325,
        lastUpdatedP_B_kPa: 101.325,
        targetParticles_A: null,
        targetParticles_B: null,
        pressureFrozen: false,
        frozenP_A_kPa: null,
        frozenP_B_kPa: null,
        displayUnit: "atm",  // 'atm' | 'kPa'
        stage: "IDLE",       // IDLE | INJECTING | INJECTED | CONFIRMED
        // Step B-3 애니메이션·카운트다운 abort 제어용.
        // [초기화] 클릭 시 abortCurrentFlow=true 로 설정 → 진행 중 async flow 가 중단.
        abortCurrentFlow: false,
        // 활성 setInterval ID (카운트다운용). 초기화 시 clearInterval.
        countdownIntervalId: null,
        // 기록 일련번호 (1부터 증가). [확인] 클릭 시 ++
        recordsCount: 0,
        // Step C-3 v14: 가스별 입자 표시 가시성 (false 시 alpha 0.4)
        gasVisibility: { air: true, co2: true, n2: true, o2: true, he: true },
        // Step F: 측정 기록 array (그래프 + CSV 위함)
        measurementRecords: [],
        // Step F: V_A_initial 캐시 (startInjection 에서 저장, addRecord 에서 사용)
        // (V_A 가 finalize 후 0 으로 변경되므로 직접 사용 시 theoryAtm 계산 오류)
        V_A_initial_cached: null,
        gasA_cached: null,  // 부분 압력 계산 시 어느 가스가 A 였는지 보존
        pressureBInitial_cached: null,  // Phase 5.3: 주입 전 P_B 보존 (평형값으로 변하기 전, n_B 산출용)
        comparisonSelected: [],         // Phase 5.3 기능 4: 비교 선택 record.n 배열 (FIFO 최대 2)
        // Phase 5.9: Vernier 모드 전용 substate. 기존 stage 와 분리 — Vernier 활성 시 daltonState.stage 는 IDLE 고정.
        // stage: IDLE | INJECTING | STABILIZING | READY_TO_CAPTURE | CAPTURED
        vernier: {
            stage: "IDLE",
            P_initial_kPa: null,
            P_total_kPa: null,
            V_A_current_mL: null,    // 작업 4: 매 GDX 프레임 역산 결과 보존 (T 소거 식: V_A' = P_initial·(V_A+V_B)/P_current − V_B)
            _lastGuardWarnTime: 0,   // 작업 4: 가드 경고 rate-limit (10 Hz 송신 로그 폭주 방지)
        },
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
        theoryN:      $("dalton-theory-n"),

        // 단위 토글 (dalton.html 에 id="dalton-unit-toggle")
        unitToggle: $("dalton-unit-toggle"),

        // 버튼
        btnInject:  $("dalton-btn-inject"),
        btnConfirm: $("dalton-btn-confirm"),
        btnReset:   $("dalton-btn-reset"),
        // Step G: CSV 다운로드 (HTML 의 id="dalton-csv-download" 가 기존 ID)
        btnCsv:     $("dalton-csv-download"),

        // 안정화 인디케이터 (Step A 에서 준비된 placeholder)
        stabilization: $("dalton-stabilization"),
        stabCountdown: $("dalton-stab-countdown"),
        // Step C-3 v14
        partialPressureList: $("dalton-partial-pressure-list"),
        // Step F
        chartWrap: $("dalton-chart-wrap"),

        // 기록 테이블
        recordsTbody:  $("dalton-records"),
        recordsEmpty:  $("dalton-records-empty"),

        // Phase 5.3 기능 4: 비교 모드
        comparisonResult: $("dalton-comparison-result"),
        comparisonBody:   $("dalton-comparison-body"),

        // Phase 5.4: 센서 패널
        sensorPanel:       $("dalton-sensor-panel"),
        btnModeMock:       $("dalton-btn-mode-mock"),
        btnModeWs:         $("dalton-btn-mode-ws"),
        btnModeReal:       $("dalton-btn-mode-real"),
        realControls:      $("dalton-sensor-real-controls"),
        wsControls:        $("dalton-sensor-ws-controls"),
        btnSerialConnect:  $("dalton-btn-serial-connect"),
        btnSerialDisconnect: $("dalton-btn-serial-disconnect"),
        serialStatus:      $("dalton-serial-status"),
        wsStatus:          $("dalton-ws-status"),
        channelStatus:     $("dalton-channel-status"),
        ch0Sensor:         $("dalton-ch0-sensor"),
        ch0Live:           $("dalton-ch0-live"),
        ch0Calib:          $("dalton-ch0-calib"),
        btnCalibCh0:       $("dalton-btn-calib-ch0"),
        ch1Sensor:         $("dalton-ch1-sensor"),
        ch1Live:           $("dalton-ch1-live"),
        ch1Calib:          $("dalton-ch1-calib"),
        btnCalibCh1:       $("dalton-btn-calib-ch1"),
        btnCalibAll:       $("dalton-btn-calib-all"),
        btnPressureFreeze: $("dalton-btn-pressure-freeze"),
        sensorError:       $("dalton-sensor-error"),

        // Phase 5.9: Vernier 모드 DOM
        btnModeVernier:        $("dalton-btn-mode-vernier"),
        vernierControls:       $("dalton-sensor-vernier-controls"),
        btnVernierConnect:     $("dalton-btn-vernier-connect"),
        btnVernierDisconnect:  $("dalton-btn-vernier-disconnect"),
        vernierStatus:         $("dalton-vernier-status"),
        vernierSensorLabel:    $("dalton-vernier-sensor-label"),
        btnVernierMeasure:     $("dalton-btn-vernier-measure"),
        vernierStageText:      $("dalton-vernier-stage-text"),
        ch1Row:                document.querySelector('.dalton-ch-row[data-ch="1"]'),
    };

    // 참조 누락 경고 (개발 편의)
    for (const [key, el] of Object.entries(dom)) {
        if (!el) console.warn(`[Dalton] DOM 참조 누락: ${key}`);
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5.4: 돌턴 센서 매니저 (멀티채널 v1.2)
    // ─────────────────────────────────────────────────────────
    const daltonSensorManager = createSensorManager({
        initialPressure: 101.3,
        channels: [
            { ch: 0, pressure: 101.3, label: "B-receiver" },
            { ch: 1, pressure: 101.3, label: "A-injector" },
        ],
        // Phase 5.4 commit iv (e-4): mock 외부화 옵션 (params.dalton.sensor)
        mockIntervalMs: cfg.sensor?.mock_interval_ms,
        mockNoiseSigma: cfg.sensor?.mock_noise_sigma_kpa,
    });

    // 채널별 데이터 구독 — Phase 5.4 commit iii: mock / ws/real 단일 경로 일원화.
    // mock 모드: EMA α=1 (즉시 반영), 임계값 우회 (forceThreshold=true). 시뮬 본체가 setPressureImmediate emit.
    // ws/real 모드: EMA α=0.2, 임계값 2 kPa, freeze 가드 (기존 동작 유지).
    daltonSensorManager.onChannelData(0, (data) => {
        const isMock = daltonSensorManager.mode === "mock";
        const isVernier = daltonSensorManager.mode === "vernier";
        daltonState.emaP_B_kPa = isMock ? data.value : applyEMA(daltonState.emaP_B_kPa, data.value);
        updateChLive(0, data.value);

        if (daltonState.pressureFrozen) return;

        daltonState.pressureBSensor = daltonState.emaP_B_kPa / 101.325;
        updatePressureReadouts();
        // Phase 5.9: Vernier 모드는 결합 시스템 압력 → B-receiver 입자 시뮬에 연동하지 않음.
        if (isVernier) {
            // 작업 4: INJECTING 중에만 V_A' 역산 + plunger targetVolume 갱신.
            // 다른 stage (IDLE/STABILIZING/READY_TO_CAPTURE/CAPTURED) 는 마지막 값 freeze.
            if (daltonState.vernier.stage === "INJECTING") {
                const vAprime = computeVernierVA(daltonState.emaP_B_kPa);
                if (vAprime != null) {
                    daltonState.vernier.V_A_current_mL = vAprime;
                    daltonState.syringeA.targetVolume = vAprime;
                    // displayedVolume 은 lerpDisplayedVolumes() 가 매 프레임 보간 → 시각 부드러움
                }
            }
            return;
        }
        maybeUpdateParticleTarget("B", false, isMock);
    });

    // Phase 5.9 작업 4: Vernier V_A' 역산 (T 소거 식)
    //   V_A' = P_initial·(V_A + V_B) / P_current − V_B
    // 가드: P_initial null / P_current 0·null·NaN / V_B 0 → 갱신 skip (null 반환)
    // 클램프: V_A' < 0 → 0, V_A' > V_A_initial → V_A_initial. 클램프 시 1초 cooldown 으로 console.warn.
    function computeVernierVA(P_current_kPa) {
        const v = daltonState.vernier;
        const P_initial = v.P_initial_kPa;
        if (P_initial == null) return null;
        if (P_current_kPa == null || !isFinite(P_current_kPa) || P_current_kPa <= 0) return null;

        const V_A_initial = daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        if (V_B <= 0) return null;

        let vAprime = P_initial * (V_A_initial + V_B) / P_current_kPa - V_B;

        // 가드 1: V_A' < 0 (과압) — clamp 0
        if (vAprime < 0) {
            warnVernierGuard(`V_A' 음수 (과압): ${vAprime.toFixed(2)} mL → 0 으로 clamp (P_current=${P_current_kPa.toFixed(2)} kPa)`);
            vAprime = 0;
        }
        // 가드 2: V_A' > V_A_initial (저압, 비현실) — clamp V_A_initial
        else if (vAprime > V_A_initial) {
            warnVernierGuard(`V_A' 과량 (저압): ${vAprime.toFixed(2)} mL → ${V_A_initial} 으로 clamp (P_current=${P_current_kPa.toFixed(2)} kPa)`);
            vAprime = V_A_initial;
        }
        return vAprime;
    }

    function warnVernierGuard(msg) {
        const now = Date.now();
        if (now - daltonState.vernier._lastGuardWarnTime >= 1000) {
            console.warn(`[Vernier guard] ${msg}`);
            daltonState.vernier._lastGuardWarnTime = now;
        }
    }
    daltonSensorManager.onChannelData(1, (data) => {
        const isMock = daltonSensorManager.mode === "mock";
        daltonState.emaP_A_kPa = isMock ? data.value : applyEMA(daltonState.emaP_A_kPa, data.value);
        updateChLive(1, data.value);

        if (daltonState.pressureFrozen) return;

        daltonState.pressureASensor = daltonState.emaP_A_kPa / 101.325;
        updatePressureReadouts();
        maybeUpdateParticleTarget("A", false, isMock);
    });

    function updateChLive(ch, kPa) {
        const el = ch === 0 ? dom.ch0Live : dom.ch1Live;
        if (el) el.textContent = `${kPa.toFixed(1)} kPa`;
    }

    // 센서 패널 UI 바인딩
    (function initDaltonSensorPanel() {
        if (!dom.btnModeMock) return;  // DOM 없으면 skip

        const webSerialSupported = "serial" in navigator;
        if (!webSerialSupported && dom.btnModeReal) {
            dom.btnModeReal.disabled = true;
            dom.btnModeReal.title = "Chrome/Edge에서만 지원됩니다";
        }

        // Phase 5.9: Web Bluetooth 미지원 시 Vernier 비활성
        if (dom.btnModeVernier && !navigator.bluetooth) {
            dom.btnModeVernier.disabled = true;
            dom.btnModeVernier.title = "Web Bluetooth 미지원 (Chrome/Edge 필요)";
        }

        function setModeUI(mode) {
            dom.btnModeMock?.classList.toggle("active", mode === "mock");
            dom.btnModeWs?.classList.toggle("active", mode === "ws");
            dom.btnModeReal?.classList.toggle("active", mode === "real");
            dom.btnModeVernier?.classList.toggle("active", mode === "vernier");
            dom.realControls?.classList.toggle("hidden", mode !== "real");
            dom.wsControls?.classList.toggle("hidden", mode !== "ws");
            dom.vernierControls?.classList.toggle("hidden", mode !== "vernier");
            dom.channelStatus?.classList.toggle("hidden", mode === "mock");
            // Phase 5.9: ch1 행은 Vernier 모드에서 숨김 (단일 채널만 사용)
            dom.ch1Row?.classList.toggle("hidden", mode === "vernier");

            // Phase 5.9: Vernier 모드 한정 UI 토글
            const isVernier = mode === "vernier";
            dom.btnInject?.classList.toggle("hidden", isVernier);
            dom.btnConfirm?.classList.toggle("hidden", isVernier);
            dom.btnVernierMeasure?.classList.toggle("hidden", !isVernier);
            dom.vernierStageText?.classList.toggle("hidden", !isVernier);
            // 압력 확정 버튼은 Vernier 에서 의미 모호 → 숨김
            dom.btnPressureFreeze?.classList.toggle("hidden", isVernier);
        }

        function resetRealUI() {
            if (dom.serialStatus) {
                dom.serialStatus.textContent = "연결 안 됨";
                dom.serialStatus.className = "status-disconnected";
            }
            dom.btnSerialConnect?.classList.remove("hidden");
            dom.btnSerialDisconnect?.classList.add("hidden");
            resetCalibUI();
        }

        function resetCalibUI() {
            if (dom.ch0Calib) dom.ch0Calib.textContent = "미보정";
            if (dom.ch1Calib) dom.ch1Calib.textContent = "미보정";
            if (dom.btnCalibCh0) dom.btnCalibCh0.disabled = true;
            if (dom.btnCalibCh1) dom.btnCalibCh1.disabled = true;
            if (dom.btnCalibAll) dom.btnCalibAll.disabled = true;
        }

        // Phase 5.9: Vernier 컨트롤 UI 리셋 (real 패턴 미러)
        function resetVernierUI() {
            if (dom.vernierStatus) {
                dom.vernierStatus.textContent = "연결 안 됨";
                dom.vernierStatus.className = "status-disconnected";
            }
            if (dom.vernierSensorLabel) dom.vernierSensorLabel.textContent = "";
            dom.btnVernierConnect?.classList.remove("hidden");
            dom.btnVernierDisconnect?.classList.add("hidden");
        }

        function enableCalibButtons() {
            if (dom.btnCalibCh0) dom.btnCalibCh0.disabled = false;
            if (dom.btnCalibCh1) dom.btnCalibCh1.disabled = false;
            if (dom.btnCalibAll) dom.btnCalibAll.disabled = false;
        }

        function updateChannelLabels(info) {
            const chs = info?.channels;
            if (chs && Array.isArray(chs)) {
                for (const c of chs) {
                    if (c.ch === 0 && dom.ch0Sensor) dom.ch0Sensor.textContent = c.label || c.sensor || "";
                    if (c.ch === 1 && dom.ch1Sensor) dom.ch1Sensor.textContent = c.label || c.sensor || "";
                }
            }
        }

        function showError(msg) {
            if (dom.sensorError) {
                dom.sensorError.textContent = msg ? `⚠ ${msg}` : "";
                if (msg) setTimeout(() => {
                    if (dom.sensorError.textContent === `⚠ ${msg}`) dom.sensorError.textContent = "";
                }, 5000);
            }
        }

        // 모드 토글 클릭
        // Phase 5.9 작업 4: Vernier 이탈 시 plunger targetVolume 복구 (학생 입력 V_A 로 복귀)
        function restorePlungerFromVernier() {
            if (daltonSensorManager.mode === "vernier") {
                daltonState.syringeA.targetVolume = daltonState.syringeA.volume;
            }
        }

        dom.btnModeMock?.addEventListener("click", () => {
            if (daltonSensorManager.mode === "mock" && daltonSensorManager.source?.connected) return;
            restorePlungerFromVernier();
            setModeUI("mock");
            resetCalibUI();
            daltonState.pressureFrozen = false;
            daltonState.frozenP_A_kPa = null;
            daltonState.frozenP_B_kPa = null;
            updatePressureFreezeUI();
            daltonSensorManager.setMode("mock");
        });

        dom.btnModeWs?.addEventListener("click", () => {
            if (daltonSensorManager.mode === "ws" && daltonSensorManager.source?.connected) return;
            restorePlungerFromVernier();
            setModeUI("ws");
            if (dom.wsStatus) { dom.wsStatus.textContent = "연결 중..."; dom.wsStatus.className = "status-connecting"; }
            daltonSensorManager.setMode("ws").catch(() => {
                if (dom.wsStatus) { dom.wsStatus.textContent = "연결 실패"; dom.wsStatus.className = "status-error"; }
            });
        });

        dom.btnModeReal?.addEventListener("click", () => {
            if (dom.btnModeReal.disabled) return;
            if (daltonSensorManager.mode === "real" && daltonSensorManager.source?.connected) return;
            restorePlungerFromVernier();
            setModeUI("real");
            resetRealUI();
            daltonSensorManager.setMode("real");
        });

        // Phase 5.9: Vernier 모드 진입
        dom.btnModeVernier?.addEventListener("click", () => {
            if (dom.btnModeVernier.disabled) return;
            if (daltonSensorManager.mode === "vernier" && daltonSensorManager.source?.connected) return;
            setModeUI("vernier");
            resetVernierUI();
            // Vernier substate 초기화 + 단계 머신 IDLE 리셋
            daltonState.vernier.stage = "IDLE";
            daltonState.vernier.P_initial_kPa = null;
            daltonState.vernier.P_total_kPa = null;
            daltonState.vernier.V_A_current_mL = null;
            // 작업 4: Vernier 진입 시 plunger 위치 = 학생이 사전 입력한 V_A 그대로
            daltonState.syringeA.targetVolume = daltonState.syringeA.volume;
            setVernierStage("IDLE");
            daltonSensorManager.setMode("vernier");
        });

        // Real 모드: 포트 연결/해제
        dom.btnSerialConnect?.addEventListener("click", () => {
            daltonSensorManager.source?.connect().catch(err => {
                if (dom.serialStatus) { dom.serialStatus.textContent = "연결 실패"; dom.serialStatus.className = "status-error"; }
                showError(err.message || err);
            });
        });
        dom.btnSerialDisconnect?.addEventListener("click", () => daltonSensorManager.source?.disconnect());

        // Phase 5.9: Vernier 모드 연결/해제 — BLE selectDevice 는 user gesture 안에서만 동작
        dom.btnVernierConnect?.addEventListener("click", () => {
            daltonSensorManager.source?.connect().catch(err => {
                if (dom.vernierStatus) { dom.vernierStatus.textContent = "연결 실패"; dom.vernierStatus.className = "status-error"; }
                showError(err.message || err);
            });
        });
        dom.btnVernierDisconnect?.addEventListener("click", () => daltonSensorManager.source?.disconnect());

        // 캘리브 버튼
        dom.btnCalibCh0?.addEventListener("click", () => daltonSensorManager.sendCalib(0));
        dom.btnCalibCh1?.addEventListener("click", () => daltonSensorManager.sendCalib(1));
        dom.btnCalibAll?.addEventListener("click", () => daltonSensorManager.sendCalib());

        // 이벤트 구독
        daltonSensorManager.on("connect", (info) => {
            if (info?.version === "mock") return;
            // Phase 5.9: Vernier 는 multi-channel 라벨·캘리브 흐름 사용 안 함
            if (info?.version === "vernier") {
                if (dom.vernierStatus) { dom.vernierStatus.textContent = "● 연결됨"; dom.vernierStatus.className = "status-connected"; }
                if (dom.vernierSensorLabel) dom.vernierSensorLabel.textContent = info?.sensor || "Vernier GDX";
                dom.btnVernierConnect?.classList.add("hidden");
                dom.btnVernierDisconnect?.classList.remove("hidden");
                return;
            }
            updateChannelLabels(info);
            enableCalibButtons();
            updatePressureFreezeUI();
            if (daltonSensorManager.mode === "ws") {
                if (dom.wsStatus) { dom.wsStatus.textContent = "● 연결됨"; dom.wsStatus.className = "status-connected"; }
            } else if (daltonSensorManager.mode === "real") {
                if (dom.serialStatus) { dom.serialStatus.textContent = "● 연결됨"; dom.serialStatus.className = "status-connected"; }
                dom.btnSerialConnect?.classList.add("hidden");
                dom.btnSerialDisconnect?.classList.remove("hidden");
            }
        });

        daltonSensorManager.on("disconnect", () => {
            if (daltonSensorManager.mode === "ws") {
                if (dom.wsStatus) { dom.wsStatus.textContent = "연결 끊김"; dom.wsStatus.className = "status-disconnected"; }
            } else if (daltonSensorManager.mode === "real") {
                resetRealUI();
            } else if (daltonSensorManager.mode === "vernier") {
                resetVernierUI();
            }
            resetCalibUI();
            if (dom.ch0Live) dom.ch0Live.textContent = "—";
            if (dom.ch1Live) dom.ch1Live.textContent = "—";
            // Phase 5.4: EMA / target / freeze 초기화
            daltonState.emaP_A_kPa = 101.325;
            daltonState.emaP_B_kPa = 101.325;
            daltonState.lastUpdatedP_A_kPa = 101.325;
            daltonState.lastUpdatedP_B_kPa = 101.325;
            daltonState.targetParticles_A = null;
            daltonState.targetParticles_B = null;
            daltonState.pressureFrozen = false;
            daltonState.frozenP_A_kPa = null;
            daltonState.frozenP_B_kPa = null;
            updatePressureFreezeUI();
        });

        daltonSensorManager.on("calibrated", (payload) => {
            const ch = (typeof payload === "object" && payload !== null) ? (payload.ch ?? 0) : 0;
            const p0 = (typeof payload === "object" && payload !== null) ? payload.p0kPa : payload;
            const label = `p₀ = ${Number(p0).toFixed(1)} kPa`;
            if (ch === 0 && dom.ch0Calib) dom.ch0Calib.textContent = label;
            if (ch === 1 && dom.ch1Calib) dom.ch1Calib.textContent = label;
        });

        daltonSensorManager.on("error", (payload) => {
            const msg = (typeof payload === "object" && payload !== null) ? payload.msg : payload;
            showError(msg);
        });

        // 압력 확정 버튼 바인딩
        dom.btnPressureFreeze?.addEventListener("click", togglePressureFreeze);

        // 초기 모드: mock
        daltonSensorManager.setMode("mock");
    })();

    // ─────────────────────────────────────────────────────────
    // Phase 5.4: 압력 확정 토글
    // ─────────────────────────────────────────────────────────
    function togglePressureFreeze() {
        const stage = daltonState.stage;
        if (stage !== "IDLE" && stage !== "STABILIZING") return;
        if (daltonSensorManager.mode === "mock") return;
        if (!daltonSensorManager.source?.connected) return;

        if (daltonState.pressureFrozen) {
            daltonState.pressureFrozen = false;
            daltonState.frozenP_A_kPa = null;
            daltonState.frozenP_B_kPa = null;
        } else {
            maybeUpdateParticleTarget("A", true);
            maybeUpdateParticleTarget("B", true);
            daltonState.frozenP_A_kPa = daltonState.emaP_A_kPa;
            daltonState.frozenP_B_kPa = daltonState.emaP_B_kPa;
            daltonState.pressureFrozen = true;
        }
        updatePressureFreezeUI();
    }

    function updatePressureFreezeUI() {
        const btn = dom.btnPressureFreeze;
        if (!btn) return;

        const stage = daltonState.stage;
        const enabled =
            (stage === "IDLE" || stage === "STABILIZING") &&
            daltonSensorManager.mode !== "mock" &&
            !!daltonSensorManager.source?.connected;

        btn.disabled = !enabled;
        btn.textContent = daltonState.pressureFrozen ? "🔓 확정 해제" : "🔒 압력 확정";
        btn.classList.toggle("dalton-frozen", daltonState.pressureFrozen);
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
        // 분자 수 n_total — 단일 산출 함수 (IDLE 시점만 의미 있음, INJECTING 이후 슬라이더 lock)
        if (dom.theoryN) {
            const n_A_now = computeMoleCount(1.00, daltonState.syringeA.volume);
            const n_B_now = computeMoleCount(daltonState.pressureBSensor, daltonState.syringeB.volume);
            dom.theoryN.textContent = `${n_A_now + n_B_now}`;
        }
    }

    // ─────────────────────────────────────────────────────────
    // 압력 readout 갱신
    // Phase 5.4: P_A = pressureASensor, P_B = pressureBSensor 분리.
    // mock 모드: 시뮬 본체�� 두 값을 직접 갱신.
    // ws/real 모드: onChannelData 콜백이 센서값으로 갱신.
    // stage 별 표시 정책:
    //   IDLE: A·B 모두 센서값 표시
    //   INJECTING: A "—" (비평형), B 진행률 동기
    //   STABILIZING~CONFIRMED: A "—", B 센서값
    // ─────────────────────────────────────────────────────────
    function updatePressureReadouts() {
        const stage = daltonState.stage;
        const unit = getPressureUnit();
        const isMock = daltonSensorManager.mode === "mock";
        const pBatm = daltonState.pressureBSensor;

        if (stage === "IDLE") {
            // mock: P_A = P_B = pBatm (Phase 5.3 패턴). ws/real: 각 채널 실측.
            const pA = isMock ? pBatm : daltonState.pressureASensor;
            if (dom.pressureA) dom.pressureA.textContent = formatPressure(pA);
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = unit;
            updateGauge(dom.gaugeA, pA, dom.gaugeWarningA);
            if (dom.pressureB) dom.pressureB.textContent = formatPressure(pBatm);
            if (dom.pressureBUnit) dom.pressureBUnit.textContent = unit;
            updateGauge(dom.gaugeB, pBatm, dom.gaugeWarningB);
        } else if (stage === "INJECTING") {
            // P_A "—" (비평형). P_B: mock=진행률 동기, ws/real="—"
            if (dom.pressureA) dom.pressureA.textContent = "—";
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = "";
            updateGauge(dom.gaugeA, 1.00, dom.gaugeWarningA);
            if (isMock) {
                if (dom.pressureB) dom.pressureB.textContent = formatPressure(pBatm);
                if (dom.pressureBUnit) dom.pressureBUnit.textContent = unit;
                updateGauge(dom.gaugeB, pBatm, dom.gaugeWarningB);
            } else {
                if (dom.pressureB) dom.pressureB.textContent = "—";
                if (dom.pressureBUnit) dom.pressureBUnit.textContent = "";
                updateGauge(dom.gaugeB, 1.00, dom.gaugeWarningB);
            }
        } else if (stage === "STABILIZING") {
            // P_A "—" (V_A=0). P_B = 평형값.
            if (dom.pressureA) dom.pressureA.textContent = "—";
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = "";
            updateGauge(dom.gaugeA, 0, dom.gaugeWarningA);
            if (dom.pressureB) dom.pressureB.textContent = formatPressure(pBatm);
            if (dom.pressureBUnit) dom.pressureBUnit.textContent = unit;
            updateGauge(dom.gaugeB, pBatm, dom.gaugeWarningB);
        } else {
            // INJECTED / CONFIRMED: P_A "—" (V_A=0), P_B = 평형값
            if (dom.pressureA) dom.pressureA.textContent = "—";
            if (dom.pressureAUnit) dom.pressureAUnit.textContent = "";
            updateGauge(dom.gaugeA, 0, dom.gaugeWarningA);
            if (dom.pressureB) dom.pressureB.textContent = formatPressure(pBatm);
            if (dom.pressureBUnit) dom.pressureBUnit.textContent = unit;
            updateGauge(dom.gaugeB, pBatm, dom.gaugeWarningB);
            updatePartialPressureList();
        }
        // INJECTED/CONFIRMED 외 — list 숨김
        if (stage !== "INJECTED" && stage !== "CONFIRMED") {
            const list = dom.partialPressureList;
            if (list) list.hidden = true;
        }
    }

    // Step C-3 v14: 부분 압력 list 동적 갱신
    function updatePartialPressureList() {
        const list = dom.partialPressureList;
        if (!list) return;
        const totalAtm = daltonState.pressureBSensor;
        const counts = countR5ParticlesByGas();
        const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);
        if (totalCount === 0) {
            list.hidden = true;
            return;
        }
        list.hidden = false;
        const lines = [];
        const gasOrder = Object.keys(counts).sort();
        for (const gasKey of gasOrder) {
            const gasData = getGasData(gasKey);
            const ratio = counts[gasKey] / totalCount;
            const partialAtm = ratio * totalAtm;
            const visible = daltonState.gasVisibility?.[gasKey] !== false;
            const hiddenClass = visible ? "" : " gas-hidden";
            const label = gasData.label || gasKey;
            const color = gasData.color || "#888888";
            const unit = getPressureUnit();
            lines.push(
                `<label class="dalton-partial-pressure-line${hiddenClass}" data-gas="${gasKey}">` +
                `<input type="checkbox" class="dalton-partial-pressure-checkbox" data-gas="${gasKey}" ${visible ? "checked" : ""} style="accent-color:${color}">` +
                `<span class="dalton-partial-pressure-label">${label}</span>` +
                `<span class="dalton-partial-pressure-value">${formatPressure(partialAtm)} ${unit}</span>` +
                `</label>`
            );
        }
        list.innerHTML = lines.join("");
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
        particleRadius: 3.0,        // Step C-3 v8: 2.5 → 3.0 (입자 가시성 ↑)
        boxMargin: 2,               // drawSyringe 의 fill margin 과 동기
        boxMinHeight: 30,           // V_min 시 box.height 음수 방지
        volumeLerpFactor: 0.15,     // displayedVolume 보간율 (매 frame 15% 접근, 약 0.13초 도달) — Step C-2 통합
        // Step C-3 v3 — 5 region 물리 안정성 (substep)
        physicsSubstepMaxDtSec: 0.005,  // 한 substep max dt = 5ms (region 다중 통과 방지)
    };

    // 분자 수 단일 산출 함수 — 이상기체 n ∝ P × V (T 일정 가정, 학습용 정규화 단위)
    // 1 atm·mL = 1 분자 단위. 시각 입자 / 측정 row / 좌측 패널 모두 이 함수 사용.
    function computeMoleCount(pressureAtm, volumeMl) {
        return Math.round(pressureAtm * volumeMl);
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5.4: EMA 평활 + 점진적 입자 수 보정
    // ─────────────────────────────────────────────────────────
    // Phase 5.4 commit iv (e-4): 5 상수 외부화 — params.dalton.sensor (실물 캘리브 대비)
    const EMA_ALPHA = cfg.sensor?.ema_alpha ?? 0.2;
    const PARTICLE_UPDATE_THRESHOLD_KPA = cfg.sensor?.particle_update_threshold_kpa ?? 2.0;
    const PARTICLE_STEP_PER_FRAME = 2;

    function applyEMA(prev, next) {
        return EMA_ALPHA * next + (1 - EMA_ALPHA) * prev;
    }

    // 입자 수 헬퍼 — region 기반
    function getParticleCountInSyringe(side) {
        return countParticlesInRegions(side === "A" ? [1] : [5]);
    }

    function addParticleToSyringe(side) {
        const isA = side === "A";
        const box = isA ? boxA : boxB;
        const gasKey = isA ? daltonState.syringeA.gas : daltonState.syringeB.gas;
        const gasData = getGasData(gasKey);
        const speedScale = SCENE.particleSpeedScale * (gasData.speedFactor || 1.0);
        const r = SCENE.particleRadius;
        const safeW = Math.max(0, box.width - 2 * r);
        const safeH = Math.max(0, box.height - 2 * r);
        if (safeW <= 0 || safeH <= 0) return;

        for (let attempt = 0; attempt < 5; attempt++) {
            const x = box.x + r + Math.random() * safeW;
            const y = box.y + r + Math.random() * safeH;
            const targetRegion = isA ? 1 : 5;
            if (getRegion(x, y) !== targetRegion) continue;
            const u1 = Math.max(0.0001, Math.random());
            const angle = Math.random() * Math.PI * 2;
            const mag = Math.sqrt(-2 * Math.log(u1)) * speedScale;
            const p = new Particle(x, y, mag * Math.cos(angle), mag * Math.sin(angle), r);
            p.gasKey = gasKey;
            p.M = gasData.M || 1;
            allParticles.push(p);
            return;
        }
    }

    function removeParticleFromSyringe(side) {
        const targetRegion = side === "A" ? 1 : 5;
        const candidates = [];
        for (let i = allParticles.length - 1; i >= 0; i--) {
            if (getRegion(allParticles[i].x, allParticles[i].y) === targetRegion) {
                candidates.push(i);
            }
        }
        if (candidates.length === 0) return;
        const idx = candidates[Math.floor(Math.random() * candidates.length)];
        allParticles.splice(idx, 1);
    }

    // Phase 5.4 commit iii: forceThreshold 신규 — 임계값만 우회 (stage / freeze 검사 유지).
    // force=true (기존) 는 stage / freeze / 임계값 모두 우회 — 기록 시점 / freeze 시점 한정.
    function maybeUpdateParticleTarget(side, force = false, forceThreshold = false) {
        const stage = daltonState.stage;
        if (!force && stage !== "IDLE" && stage !== "STABILIZING") return;
        if (!force && daltonState.pressureFrozen) return;

        const emaKey = side === "A" ? "emaP_A_kPa" : "emaP_B_kPa";
        const lastKey = side === "A" ? "lastUpdatedP_A_kPa" : "lastUpdatedP_B_kPa";
        const ema = daltonState[emaKey];
        const last = daltonState[lastKey];

        if (!force && !forceThreshold && Math.abs(ema - last) < PARTICLE_UPDATE_THRESHOLD_KPA) return;

        const volumeMl = side === "A" ? daltonState.syringeA.volume : daltonState.syringeB.volume;
        const emaAtm = ema / 101.325;
        const nTarget = computeMoleCount(emaAtm, volumeMl);

        const targetKey = side === "A" ? "targetParticles_A" : "targetParticles_B";
        daltonState[targetKey] = nTarget;
        daltonState[lastKey] = ema;
    }

    function stepParticleCounts() {
        const stage = daltonState.stage;
        if (stage !== "IDLE" && stage !== "STABILIZING") return;
        if (daltonState.pressureFrozen) return;

        for (const side of ["A", "B"]) {
            const targetKey = side === "A" ? "targetParticles_A" : "targetParticles_B";
            const target = daltonState[targetKey];
            if (target == null) return;

            const current = getParticleCountInSyringe(side);
            const diff = target - current;
            if (diff === 0) continue;

            const step = Math.sign(diff) * Math.min(PARTICLE_STEP_PER_FRAME, Math.abs(diff));
            if (step > 0) {
                for (let i = 0; i < step; i++) addParticleToSyringe(side);
            } else {
                for (let i = 0; i < -step; i++) removeParticleFromSyringe(side);
            }
        }
    }

    // 부피 → 피스톤 면의 Y 좌표 (본체 안쪽)
    // Phase 5.3 정정 v5 (X1): 정확 비례 매핑.
    // V=10 → 박스 ≈ 45 px (실제 10%), V=100 → 박스 = 450 px (100%) — 시각 비율 = 실제 V 비율 일치 (학습 정합).
    // 끼임은 computeBox 의 Math.max 제거 (정정 v4) + 입자 생성 안전 마진 (정정 v5) 으로 차단.
    function volumeToPistonY(volumeMl) {
        const V_max = SCENE.volumeMax;
        const clamped = Math.max(0, Math.min(V_max, volumeMl));
        const boxHeight = (clamped / V_max) * SCENE.bodyHeightPx;
        return SCENE.bodyBottom - boxHeight;
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
    let allParticles = [];  // 5 region 물리 모드: 단일 array

    function computeBox(syr, volumeMl) {
        const pistonY = volumeToPistonY(volumeMl);
        const m = SCENE.boxMargin;
        const x = syr.bodyLeft + m;
        const y = pistonY + SCENE.pistonHeadH;
        const width = SCENE.bodyW - 2 * m;
        // Phase 5.3 정정 v4: volumeToPistonY 의 0.20 보장 매핑으로 height 항상 양수 (V_min 시 ≈ 76 px)
        const height = SCENE.bodyBottom - y;
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

    // Phase 5.4: getRegion null 미끄러짐 대응 — 좌표 기반 R1 시각 영역 검사.
    // 입자간 충돌 위치 corrective 단계에서 boundary 부동소수점 오차 발생 시
    // startInjectionTransfer splice 누락 + finalize safety net 검출용.
    function isParticleInSyringeABox(p) {
        const eps = 2;
        return p.x >= SCENE.syringeA.bodyLeft - eps
            && p.x <= SCENE.syringeA.bodyRight + eps
            && p.y >= SCENE.bodyTop - eps
            && p.y <= SCENE.bodyBottom + eps;
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

    // ─────────────────────────────────────────────────────────
    // Phase 5.3: 입자간 탄성 충돌 — spatial hash O(N) + 1D 탄성 충돌 (질량 다른 경우 정확 식)
    // ─────────────────────────────────────────────────────────
    const COLLISION_GRID_SIZE = SCENE.particleRadius * 4;  // 격자 = 직경 × 2 = 12 px
    // Phase 5.4: corrective clamp 안전 마진 — boundary 정확 정착 stuck 차단 (R1, R5 모두)
    const BOUNDARY_EPSILON = 0.5;

    function buildSpatialHash(particles) {
        const hash = new Map();  // key = "gx,gy", value = [particle, ...]
        for (const p of particles) {
            const gx = Math.floor(p.x / COLLISION_GRID_SIZE);
            const gy = Math.floor(p.y / COLLISION_GRID_SIZE);
            const key = `${gx},${gy}`;
            if (!hash.has(key)) hash.set(key, []);
            hash.get(key).push(p);
        }
        return hash;
    }

    function getNearbyParticles(p, hash) {
        const gx = Math.floor(p.x / COLLISION_GRID_SIZE);
        const gy = Math.floor(p.y / COLLISION_GRID_SIZE);
        const result = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = `${gx + dx},${gy + dy}`;
                const cell = hash.get(key);
                if (cell) result.push(...cell);
            }
        }
        return result;
    }

    // Phase 5.3 정정 (재): 입자의 현재 region 에 해당하는 박스 4 변 좌표 반환
    // R1 → 시린지 A 박스, R5 → 시린지 B 박스. 그 외 region (2/3/4) → null (충돌 처리 X)
    function getRegionBoxLimits(p) {
        const r = p.radius;
        const reg = getRegion(p.x, p.y);
        if (reg === 1) {
            return {
                left:   SCENE.syringeA.bodyLeft + r,
                right:  SCENE.syringeA.bodyRight - r,
                top:    volumeToPistonY(daltonState.syringeA.displayedVolume) + SCENE.pistonHeadH + r,
                bottom: SCENE.bodyBottom - r,
            };
        } else if (reg === 5) {
            return {
                left:   SCENE.syringeB.bodyLeft + r,
                right:  SCENE.syringeB.bodyRight - r,
                top:    volumeToPistonY(daltonState.syringeB.displayedVolume) + SCENE.pistonHeadH + r,
                bottom: SCENE.bodyBottom - r,
            };
        }
        return null;
    }

    // 1D 탄성 충돌 (m1, m2 다른 경우 정확 식) + 위치 분리 (positional correction)
    function resolveCollision(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distSq = dx * dx + dy * dy;
        const minDist = p1.radius + p2.radius;
        if (distSq >= minDist * minDist || distSq < 1e-9) return false;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        // Phase 5.3 정정 (W4-simple): 위치 분리량을 박스 안 한정 — 박스 밖으로 나가는 양은 다음 frame 자연 분리
        const overlap = minDist - dist;
        const m1 = p1.M || 1;
        const m2 = p2.M || 1;
        const totalMass = m1 + m2;

        // 정상 분리량 (벡터)
        let dx1 = -nx * overlap * (m2 / totalMass);
        let dy1 = -ny * overlap * (m2 / totalMass);
        let dx2 =  nx * overlap * (m1 / totalMass);
        let dy2 =  ny * overlap * (m1 / totalMass);

        // 박스 한계 사전 검사 (region 기반 — R1/R5 만, R3/R4 는 null)
        const limit1 = getRegionBoxLimits(p1);
        const limit2 = getRegionBoxLimits(p2);

        // Phase 5.4: clamp 시 BOUNDARY_EPSILON 안전 마진 — boundary 정확 정착 stuck 차단
        if (limit1) {
            const newX1 = p1.x + dx1, newY1 = p1.y + dy1;
            if (newX1 < limit1.left)   dx1 = (limit1.left   + BOUNDARY_EPSILON) - p1.x;
            if (newX1 > limit1.right)  dx1 = (limit1.right  - BOUNDARY_EPSILON) - p1.x;
            if (newY1 < limit1.top)    dy1 = (limit1.top    + BOUNDARY_EPSILON) - p1.y;
            if (newY1 > limit1.bottom) dy1 = (limit1.bottom - BOUNDARY_EPSILON) - p1.y;
        }
        if (limit2) {
            const newX2 = p2.x + dx2, newY2 = p2.y + dy2;
            if (newX2 < limit2.left)   dx2 = (limit2.left   + BOUNDARY_EPSILON) - p2.x;
            if (newX2 > limit2.right)  dx2 = (limit2.right  - BOUNDARY_EPSILON) - p2.x;
            if (newY2 < limit2.top)    dy2 = (limit2.top    + BOUNDARY_EPSILON) - p2.y;
            if (newY2 > limit2.bottom) dy2 = (limit2.bottom - BOUNDARY_EPSILON) - p2.y;
        }

        p1.x += dx1;
        p1.y += dy1;
        p2.x += dx2;
        p2.y += dy2;

        // 상대 속도의 법선 성분
        const dvx = p2.vx - p1.vx;
        const dvy = p2.vy - p1.vy;
        const vRelN = dvx * nx + dvy * ny;
        if (vRelN > 0) return false;  // 이미 분리 중 — 다시 충돌 처리 X

        // 1D 탄성 충돌 충격량: J = -2 × vRelN / (1/m1 + 1/m2)
        const J = (-2 * vRelN) / (1 / m1 + 1 / m2);
        p1.vx -= (J * nx) / m1;
        p1.vy -= (J * ny) / m1;
        p2.vx += (J * nx) / m2;
        p2.vy += (J * ny) / m2;

        return true;
    }

    // Phase 5.3 정정 v4: R3/R4 비정상 진입 입자를 가까운 박스 안 임의 위치로 복귀
    // x 좌표 + gasKey 보조로 가까운 박스 결정 (텔레포트는 INJECTING 한정)
    function rescueParticleToHomeRegion(p) {
        const r = p.radius;
        const r1Limits = {
            left:   SCENE.syringeA.bodyLeft + r,
            right:  SCENE.syringeA.bodyRight - r,
            top:    volumeToPistonY(daltonState.syringeA.displayedVolume) + SCENE.pistonHeadH + r,
            bottom: SCENE.bodyBottom - r,
        };
        const r5Limits = {
            left:   SCENE.syringeB.bodyLeft + r,
            right:  SCENE.syringeB.bodyRight - r,
            top:    volumeToPistonY(daltonState.syringeB.displayedVolume) + SCENE.pistonHeadH + r,
            bottom: SCENE.bodyBottom - r,
        };
        const r1Center = (r1Limits.left + r1Limits.right) / 2;
        const r5Center = (r5Limits.left + r5Limits.right) / 2;
        const distToR1 = Math.abs(p.x - r1Center);
        const distToR5 = Math.abs(p.x - r5Center);
        const targetLimits = (distToR1 < distToR5) ? r1Limits : r5Limits;
        p.x = targetLimits.left + Math.random() * (targetLimits.right - targetLimits.left);
        p.y = targetLimits.top + Math.random() * (targetLimits.bottom - targetLimits.top);
        // 속도 보존 (운동량 영향 X)
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

        for (const p of allParticles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            const region = getRegion(p.x, p.y);

            if (region === 1) {
                // R1 입자는 주입 시작 시 pending 으로 옮겨지므로 일반적으로 분기 진입 없음
                // — 초기 상태 (대기 / 평형) 의 R1 입자만 처리.
                if (p.x - r < r1Left)  { p.x = r1Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r1Right) { p.x = r1Right - r; if (p.vx > 0) p.vx = -p.vx; }
                // 일반 top wall 충돌만 (대기 상태 brownian)
                if (p.y - r < r1Top) {
                    p.y = r1Top + r;
                    if (p.vy < 0) p.vy = -p.vy;
                }
                // Step C-3 v12: IDLE 시 R2 진입 영역에서도 bottom 차단
                //               (입자 자동 R5 이주 방지). 주입 중에만 R2 통과 허용.
                const blockR2Entry = !injectionPistonAnimating;
                if (p.y + r > r1Bottom) {
                    if (blockR2Entry || (p.x < r2Left || p.x > r2Right)) {
                        p.y = r1Bottom - r;
                        if (p.vy > 0) p.vy = -p.vy;
                    }
                }
            } else if (region === 2) {
                // Step C-3 v6: R2 진입 자체가 없음 (R1 입자가 pending 으로 옮겨짐). 보험 충돌만 유지.
                if (p.x - r < r2Left)  { p.x = r2Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r2Right) { p.x = r2Right - r; if (p.vx > 0) p.vx = -p.vx; }
            } else if (region === 3 || region === 4) {
                // Phase 5.3 정정 v4: 텔레포트는 INJECTING stage 에서만 발동
                // IDLE/STABILIZING/INJECTED/CONFIRMED 시 R3/R4 진입 = 비정상 (박스 외부 침범)
                // → 가까운 박스 (R1 또는 R5) 안전 위치로 복귀
                if (daltonState.stage === "INJECTING") {
                    teleportToR5NozzleEntry(p);
                } else {
                    rescueParticleToHomeRegion(p);
                }
            } else if (region === 5) {
                if (p.x - r < r5Left)  { p.x = r5Left + r;  if (p.vx < 0) p.vx = -p.vx; }
                if (p.x + r > r5Right) { p.x = r5Right - r; if (p.vx > 0) p.vx = -p.vx; }
                if (p.y - r < r5Top)   { p.y = r5Top + r;   if (p.vy < 0) p.vy = -p.vy; }
                // Step C-3 v12: R5 의 bottom 영구 차단 (R4 영역 포함).
                //               B 입자가 R4 통과 → 텔레포트로 다시 R5 진입하는 순환 차단.
                if (p.y + r > r5Bottom) {
                    p.y = r5Bottom - r;
                    if (p.vy > 0) p.vy = -p.vy;
                }
            } else {
                // null region — 빈 공간 영역별 회수 (Step C-3 v3 강화)
                // Phase 5.4: INJECTING 중 null 검출 1 회 warn (H1 진단 대응)
                if (daltonState.stage === "INJECTING" && !daltonState._nullRegionWarned) {
                    daltonState._nullRegionWarned = true;
                    console.warn(`[Dalton] WARN: null region particle 검출 (INJECTING 중) at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
                }
                rescueParticleFromNull(p, r,
                    r1Top, r1Left, r1Right, r2Left, r2Right,
                    r3Top, r3Bottom, r3Left, r3Right,
                    r4Left, r4Right, r5Top, r5Left, r5Right);
            }
        }

        // Phase 5.3: 입자간 탄성 충돌 — R1 + R5 만 처리 (R2/R3/R4 는 텔레포트 모드라 입자 거의 없음)
        // spatial hash 로 인접 셀 (3×3=9 칸) 만 검사 → O(N) 평균
        const collidableParticles = [];
        for (const p of allParticles) {
            const reg = getRegion(p.x, p.y);
            if (reg === 1 || reg === 5) collidableParticles.push(p);
        }
        // 임시 인덱스 부여 — indexOf O(N) 회피
        for (let i = 0; i < collidableParticles.length; i++) {
            collidableParticles[i]._idx = i;
        }
        const hash = buildSpatialHash(collidableParticles);
        for (let i = 0; i < collidableParticles.length; i++) {
            const p1 = collidableParticles[i];
            const p1Region = getRegion(p1.x, p1.y);
            const nearby = getNearbyParticles(p1, hash);
            for (const p2 of nearby) {
                if (p2._idx <= p1._idx) continue;  // 중복 처리 방지 (i < j 만)
                // 같은 region 끼리만 충돌 (R1 ↔ R5 거리 큼, 어차피 충돌 X)
                if (getRegion(p2.x, p2.y) !== p1Region) continue;
                resolveCollision(p1, p2);
            }
        }
    }

    // Step C-3 v6: 주입 시작 시 R1 입자를 pending 으로 옮김 (시각 비표시)
    function startInjectionTransfer() {
        pendingTransferParticles = [];
        releasedCount = 0;
        daltonState._nullRegionWarned = false;
        // R1 안 입자를 모두 pending 으로 splice (allParticles 에서 제거)
        // Phase 5.4: getRegion null 미끄러짐 대응 — 좌표 기반 검사 (isParticleInSyringeABox) 추가
        for (let i = allParticles.length - 1; i >= 0; i--) {
            const p = allParticles[i];
            if (getRegion(p.x, p.y) === 1 || isParticleInSyringeABox(p)) {
                pendingTransferParticles.push(allParticles.splice(i, 1)[0]);
            }
        }
        if (DEBUG_DALTON) {
            const pendingCount = pendingTransferParticles.length;
            const nullCount = allParticles.filter((q) => getRegion(q.x, q.y) === null).length;
            console.log(`[Dalton] INJECTING start — pending: ${pendingCount}, allParticles 잔여 null: ${nullCount}`);
        }
    }

    // Step C-3 v6: 매 frame 피스톤 진행률에 비례해 pending → R5 분출
    // Step C-3 v7: 분출 누적 수 비례 게이지 P_B 점진 갱신
    function updateInjectionTransfer() {
        if (!injectionPistonAnimating) return;
        const sA = daltonState.syringeA;
        const total = pendingTransferParticles.length + releasedCount;
        if (total === 0) return;
        // 진행률 0~1 (피스톤 하강 비율)
        const startV = sA.injectionStartVolume;
        const progress = startV > 0 ? (1 - sA.displayedVolume / startV) : 1;
        const targetReleased = Math.floor(total * Math.max(0, Math.min(1, progress)));
        // pending 에서 한 개씩 꺼내 R5 분출 (releasedCount 가 targetReleased 까지)
        while (releasedCount < targetReleased && pendingTransferParticles.length > 0) {
            const p = pendingTransferParticles.shift();
            teleportToR5NozzleEntry(p);
            allParticles.push(p);
            releasedCount++;
        }
        // Step F 정정 (재): P_B 진행률 동기 복원 — 사용자 요청
        // (B 측은 분자 들어오면서 입자 수 비례 압력 증가 교육적 효과)
        // 기존 progress 변수는 피스톤 진행률 — 분출 진행률은 별도 계산 (releasedCount / total)
        // Phase 5.4 commit iii: mock 만 setPressureImmediate (매 frame, 60 Hz).
        // ws/real 은 시뮬 보간 X — stage 분기 ("—") 로 표시 처리.
        const V_A_initial = sA.injectionStartVolume;
        const V_B = daltonState.syringeB.volume;
        const theoryAfterAtm = V_B > 0 ? (V_A_initial / V_B + 1) * 1.00 : 1.00;
        const progress2 = total > 0 ? Math.max(0, Math.min(1, releasedCount / total)) : 0;
        if (daltonSensorManager.mode === "mock" && daltonSensorManager.source) {
            const P_B_kPa = (1.00 + progress2 * (theoryAfterAtm - 1.00)) * 101.325;
            daltonSensorManager.source.setPressureImmediate(P_B_kPa, 0);
            // setPressureImmediate → onChannelData(0) → pressureBSensor + updatePressureReadouts
        }
    }

    // Step C-3 v5: B 노즐 출구에서 자연스럽게 분출 — R5 안 임의 위치 대신 노즐 입구 (R5 bottom) 에서 위로 분출
    // 호출처: (1) R2 통과 텔레포트, (2) R1 강제 이주 (boxA.height < 50), (3) R3/R4 보험 텔레포트
    function teleportToR5NozzleEntry(p) {
        const r = SCENE.particleRadius;
        // 노즐 폭 안에서 약간 분산 (±60% 노즐 폭 안)
        p.x = SCENE.syringeB.centerX + (Math.random() - 0.5) * SCENE.nozzleW * 0.6;
        // R5 bottom 바로 위 (노즐 입구) — bodyBottom 에서 r 만큼 위
        p.y = SCENE.bodyBottom - r;
        // 위로 분출: 기존 속도 크기 보존, 방향만 위쪽 ± 30° 으로
        const speed = Math.max(50, Math.sqrt(p.vx * p.vx + p.vy * p.vy));
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3);  // -90° ± 30°
        p.vx = speed * Math.cos(angle);
        p.vy = speed * Math.sin(angle);
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

        // 입자 수 = 분자 수 (Phase 5.3: Step C-2 결정 번복 — V 비례)
        // A: P_initial = 1.00 (대기압), V = syringeA.volume 현재값
        // B: P_initial = pressureBSensor (IDLE 시점 = 사용자 설정 또는 평형 후 cached 값)
        //    단 INJECTING 이후 호출되면 안 됨 (rebuildParticleSystem 호출 위치는 IDLE 한정)
        const P_initial = isA ? 1.00 : daltonState.pressureBSensor;
        const V_for_count = isA ? daltonState.syringeA.volume : daltonState.syringeB.volume;
        const particleCount = computeMoleCount(P_initial, V_for_count);
        const gasData = getGasData(gasKey);
        const speedScale = SCENE.particleSpeedScale * (gasData.speedFactor || 1.0);

        // 입자 생성: 박스 안 임의 위치 + 정규분포 속도 (Box-Muller)
        // Phase 5.3 정정 v5: radius 안전 마진 — V=10 박스 작을 때 입자가 벽 침범 회피
        const r = SCENE.particleRadius;
        const safeWidth = Math.max(0, box.width - 2 * r);
        const safeHeight = Math.max(0, box.height - 2 * r);
        for (let i = 0; i < particleCount; i++) {
            const x = box.x + r + Math.random() * safeWidth;
            const y = box.y + r + Math.random() * safeHeight;
            const u1 = Math.max(0.0001, Math.random());
            const u2 = Math.random();
            const angle = u2 * Math.PI * 2;
            const mag = Math.sqrt(-2 * Math.log(u1)) * speedScale;
            const vx = mag * Math.cos(angle);
            const vy = mag * Math.sin(angle);
            const particle = new Particle(x, y, vx, vy, SCENE.particleRadius);
            particle.gasKey = gasKey;
            particle.M = gasData.M || 1;  // Phase 5.3: 입자간 충돌 운동량 교환용 (돌턴 한정 — simulation.js mass=1 보존)
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

    let injectionPistonAnimating = false;  // A 의 V 50→0 보간 중 (drawDaltonScene 에서 displayedVolume 직접 덮어쓰기)
    // Step C-3 v6: 피스톤 동기 분출 — A 입자가 즉시 pending 으로 옮겨지고 진행률에 따라 B 분출
    let pendingTransferParticles = [];  // 주입 시작 시 R1 입자가 옮겨질 array (시각 비표시)
    let releasedCount = 0;              // 이번 주입에서 B 로 분출된 입자 수 (누적)

    // 주입 애니메이션 시작 — 5 region 물리 모드 (waypoint 폐기, 피스톤 압축으로 자연 흐름)
    // 반환: Promise (완료 또는 abort 시 resolve)
    async function runInjectionAnimation() {
        // Step C-3 피스톤 애니: A 의 V 점진 감소 시작
        daltonState.syringeA.injectionStartVolume = daltonState.syringeA.displayedVolume;
        daltonState.syringeA.injectionStartTime = performance.now();
        injectionPistonAnimating = true;

        // Step C-3 v6: A 입자를 pending 으로 즉시 옮김 (시각 비표시).
        // 매 frame updateInjectionTransfer 가 피스톤 진행률에 따라 B 노즐 출구로 분출
        startInjectionTransfer();

        const totalTimeoutMs = (cfg.injection_animation_sec || 3) * 1000;
        // Phase 5.4 commit iv (e-4): safety 여유 외부화 (기본 1000 ms)
        const safetyTimeoutMs = totalTimeoutMs + (cfg.sensor?.safety_timeout_extra_ms ?? 1000);
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
                // Step C-3 v6: pending 분출 완료 + 시간 도달 시 finalize
                const pendingLeft = pendingTransferParticles.length;
                const r1r2Count = countParticlesInRegions([1, 2]);
                if (elapsed >= totalTimeoutMs && pendingLeft === 0 && r1r2Count === 0) {
                    clearInterval(checkInterval);
                    finalizeInjectedVolume();
                    resolve();
                    return;
                }
                // safety timeout: pending 잔여 강제 분출 + 강제 R5 이주
                if (elapsed >= safetyTimeoutMs) {
                    while (pendingTransferParticles.length > 0) {
                        const p = pendingTransferParticles.shift();
                        teleportToR5NozzleEntry(p);
                        allParticles.push(p);
                        releasedCount++;
                    }
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

    // Step C-3 v14: R5 안 가스별 입자 수 카운트 (부분 압력 계산용)
    // 반환: { air: 60, co2: 60, ... } (R5 region 만)
    function countR5ParticlesByGas() {
        const counts = {};
        for (const p of allParticles) {
            if (getRegion(p.x, p.y) !== 5) continue;
            const key = p.gasKey || "unknown";
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }

    // safety timeout 시 R1~R4 입자를 강제로 R5 안 임의 위치로 이주
    function forceRemainingToR5() {
        let count = 0;
        for (const p of allParticles) {
            const region = getRegion(p.x, p.y);
            // Phase 5.4: null region 도 이주 대상 포함 (다중 안전망 — H1 진단 대응)
            if (region !== 5) {
                p.x = boxB.x + Math.random() * boxB.width;
                p.y = boxB.y + Math.random() * boxB.height;
                count++;
            }
        }
        if (count > 0) {
            console.warn(`[Dalton] WARN: safety timeout 발동 — R5 강제 이주: ${count}개`);
        }
    }

    // 주입 완료 시 A 의 V 를 0 으로 확정 (논리값·target·displayed 모두 동기)
    function finalizeInjectedVolume() {
        // Phase 5.4: safety net — R1 잔여 입자 강제 R5 이동 (H1 진단 대응)
        const r1Remainder = [];
        for (let i = allParticles.length - 1; i >= 0; i--) {
            const p = allParticles[i];
            if (getRegion(p.x, p.y) === 1 || isParticleInSyringeABox(p)) {
                r1Remainder.push(p);
                allParticles.splice(i, 1);
            }
        }
        if (r1Remainder.length > 0) {
            console.warn(`[Dalton] finalize — R1 잔여 ${r1Remainder.length}개 강제 R5 이동`);
            for (const p of r1Remainder) {
                teleportToR5NozzleEntry(p);
                allParticles.push(p);
            }
        } else if (DEBUG_DALTON) {
            console.log(`[Dalton] finalize — R1 잔여 없음 (정상 분출)`);
        }
        daltonState._nullRegionWarned = false;

        daltonState.syringeA.volume = 0;
        daltonState.syringeA.targetVolume = 0;
        daltonState.syringeA.displayedVolume = 0;
        injectionPistonAnimating = false;
        // Step F 정정: finalize 시점에 평형 압력 확정 (INJECTED stage 진입 후 표시됨)
        // V_A_initial_cached + 현재 V_B 로 이론 평형 압력 재계산
        // Phase 5.4 commit iii: mock 은 setPressureImmediate 경유, ws/real 은 직접 set
        const V_A_initial = daltonState.V_A_initial_cached || 0;
        const V_B = daltonState.syringeB.volume;
        const theoryAfterAtm = V_B > 0 ? (V_A_initial / V_B + 1) * 1.00 : 1.00;
        if (daltonSensorManager.mode === "mock" && daltonSensorManager.source) {
            daltonSensorManager.source.setPressureImmediate(theoryAfterAtm * 101.325, 0);
        } else {
            daltonState.pressureBSensor = theoryAfterAtm;
        }
    }

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
        // Phase 5.4: V=0 시 피스톤이 본체 바닥 침범 차단 (시각 안전 — 학술 의미 보존)
        const pistonY = Math.min(
            volumeToPistonY(displayedVolumeMl),
            SCENE.bodyBottom - SCENE.pistonHeadH
        );

        // 1. 본체 안 가스색 채움 영역 (피스톤 면 ~ 본체 하단)
        // Step C-3 v8 → v12 → v13: 마진 2 → 6 → 3 → 0 (외벽 stroke 안쪽까지 완전 채움)
        p.noStroke();
        p.fill(getGasColor(p, gasKey));
        p.rect(syr.bodyLeft, pistonY + SCENE.pistonHeadH, SCENE.bodyW, SCENE.bodyBottom - (pistonY + SCENE.pistonHeadH));

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
        // Step C-3 v14: 노즐 좌·우 벽은 drawConnectorTube 가 처리 (ㄷ자 통합)

        // 3. 피스톤 (3-rect: 면 + 봉 + 단캡)
        // 3-1. 피스톤 면 (가로 직사각형, 본체 안)
        // Step C-3 v8 → v12 → v13: 마진 2 → 6 → 3 → 0 (외벽 stroke 안쪽까지 완전 채움)
        p.noStroke();
        p.fill(0, 0, 48);
        p.rect(syr.bodyLeft, pistonY, SCENE.bodyW, SCENE.pistonHeadH);
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
        // Step C-3 v14: ㄷ자 통합 — 좌 노즐 통로 + 수평 튜브 + 우 노즐 통로 (단일 함수에서 자연 연결)
        const tubeFill = p.color(0, 0, 92);
        const aLeft = SCENE.syringeA.centerX - SCENE.nozzleW / 2;
        const aRight = SCENE.syringeA.centerX + SCENE.nozzleW / 2;
        const bLeft = SCENE.syringeB.centerX - SCENE.nozzleW / 2;
        const bRight = SCENE.syringeB.centerX + SCENE.nozzleW / 2;
        // Step C-3 v15: 노즐 top 을 본체 외벽 stroke 바깥쪽까지로 (실린더 침범 방지)
        const nozzleTopY = SCENE.bodyBottom + SCENE.wallStrokeWeight / 2;
        const adjustedNozzleH = SCENE.tubeY - nozzleTopY;
        p.noStroke();
        p.fill(tubeFill);
        // 좌 노즐 통로 (수직)
        p.rect(aLeft, nozzleTopY, SCENE.nozzleW, adjustedNozzleH);
        // 수평 튜브
        p.rect(aLeft, SCENE.tubeY, bRight - aLeft, SCENE.tubeH);
        // 우 노즐 통로 (수직)
        p.rect(bLeft, nozzleTopY, SCENE.nozzleW, adjustedNozzleH);
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
            // Step C-3 v6: 피스톤 진행률에 따라 pending → B 분출
            updateInjectionTransfer();
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

            // Phase 5.4: 점진적 입자 수 보정 (ws/real 모드, IDLE/STABILIZING)
            stepParticleCounts();

            // 5 region 물리 update (입자 좌표 적분 + region 별 외곽 벽 충돌)
            physicsStep(dt);

            // Phase 5.4: R5 stuck 진단 로그 — 1 초/회 (DEBUG_DALTON 게이팅)
            if (DEBUG_DALTON && p.frameCount % 60 === 0) {
                const SLOW_THRESHOLD_PX_PER_SEC = 1.0;
                const slowR5Count = allParticles.filter((q) =>
                    getRegion(q.x, q.y) === 5
                    && Math.hypot(q.vx, q.vy) < SLOW_THRESHOLD_PX_PER_SEC
                ).length;
                if (slowR5Count > 0) {
                    console.log(`[Dalton] R5 slow particles: ${slowR5Count}`);
                }
            }

            // 입자별 gasKey 로 색 결정 — 단일 호출
            drawParticlesByGas(p, allParticles, daltonState.syringeA.gas);
        }
    }

    // 입자 그리기 — 가스별 RGB 색 (params.json dalton.gases[gasKey].color)
    // p5 가 HSB 모드여도 hex 문자열을 자동 변환해 fill 처리
    // 입자별 gasKey 우선 (Step C-3 — 주입 후 B 안에 두 가스 공존). 없으면 defaultGasKey 사용.
    // Step C-3 v14: gasVisibility 보고 흐릿 처리 (alpha 0.4 → HSB 모드 102/255)
    function drawParticlesByGas(p, particles, defaultGasKey) {
        p.noStroke();
        for (const particle of particles) {
            const gasKey = particle.gasKey || defaultGasKey;
            const gasData = getGasData(gasKey);
            const visible = daltonState.gasVisibility?.[gasKey] !== false;
            const c = p.color(gasData.color || "#888888");
            // Step C-3 v15 + v16: 흐림 더 강화 — 0.4 → 0.15 → 0.08
            c.setAlpha(visible ? 255 : 20);
            p.fill(c);
            p.circle(particle.x, particle.y, particle.radius * 2);
        }
    }

    // Step F: 그래프 시계열 — p5 sketch (noLoop, 측정 추가 시 redraw)
    let daltonChartP5Instance = null;

    function daltonChartSketch(p) {
        const W = 800;
        const H = 280;
        const padding = { top: 30, right: 30, bottom: 50, left: 60 };

        // Step F 정정 (재): 카드 폭 추적 위함 — setup + windowResized 공유 헬퍼
        function getTargetWidth() {
            const wrap = document.getElementById("dalton-chart-wrap");
            if (!wrap) return W;
            const wrapW = Math.max(wrap.clientWidth - 32, 320);  // padding 16×2 차감, 최소 320
            return Math.min(wrapW, W);  // 최대 W (=800)
        }

        p.setup = function () {
            // 첫 setup 시 chart-wrap 이 hidden 일 수 있음 → getTargetWidth() 가 320 반환
            // ResizeObserver 가 unhide 시점에 자동 재조정
            const canvas = p.createCanvas(getTargetWidth(), H);
            canvas.parent("dalton-chart-wrap");
            p.noLoop();

            // Step F 정정 (재): 카드 폭 변화 (unhide / window resize) 자동 감지
            const wrap = document.getElementById("dalton-chart-wrap");
            if (wrap && typeof ResizeObserver !== "undefined") {
                const resizeObserver = new ResizeObserver(() => {
                    const targetW = getTargetWidth();
                    if (targetW !== p.width) {
                        p.resizeCanvas(targetW, H);
                        p.redraw();
                    }
                });
                resizeObserver.observe(wrap);
            }
        };

        p.windowResized = function () {
            p.resizeCanvas(getTargetWidth(), H);
            p.redraw();
        };

        p.draw = function () {
            p.background(255);
            const records = daltonState.measurementRecords;
            // Step F finishing: records 0개 시에도 axes + tick + 라벨 표시 (placeholder)

            // 좌표 영역
            const plotX = padding.left;
            const plotY = padding.top;
            const plotW = p.width - padding.left - padding.right;
            const plotH = H - padding.top - padding.bottom;

            // 막대 폭 + 간격
            const N = records.length;
            const minBars = 5;  // 최소 5 막대 폭 기준
            const slotCount = Math.max(N, minBars);
            const slotW = plotW / slotCount;
            const barW = slotW * 0.6;
            const barOffset = (slotW - barW) / 2;

            // Y 범위 — records 0개 시 default 3 atm
            let maxP = 0;
            for (const r of records) maxP = Math.max(maxP, r.P_total);
            const yMin = 0;
            const yMax = N > 0 ? Math.max(maxP + 0.5, 3.0) : 3.0;

            // 좌표 변환 헬퍼
            const yToPx = (y) => plotY + plotH - (y - yMin) / (yMax - yMin) * plotH;

            // axes
            p.stroke(0, 0, 30);
            p.strokeWeight(1);
            p.line(plotX, plotY, plotX, plotY + plotH);              // Y axis
            p.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);  // X axis

            // X tick (회차)
            p.fill(0, 0, 30);
            p.noStroke();
            p.textSize(11);
            p.textAlign(p.CENTER, p.TOP);
            for (let i = 0; i < slotCount; i++) {
                const slotX = plotX + i * slotW + slotW / 2;
                const label = i < N ? records[i].n : (i + 1);
                p.fill(0, 0, i < N ? 30 : 75);  // 데이터 있는 회차 짙게
                p.text(label, slotX, plotY + plotH + 6);
            }

            // Y tick (압력)
            p.textAlign(p.RIGHT, p.CENTER);
            p.fill(0, 0, 30);
            const yTicks = 5;
            for (let i = 0; i <= yTicks; i++) {
                const yVal = yMin + (yMax - yMin) * i / yTicks;
                const py = yToPx(yVal);
                p.text(yVal.toFixed(1), plotX - 8, py);
                p.stroke(0, 0, 90);
                p.line(plotX - 4, py, plotX, py);
                p.noStroke();
            }
            // 축 라벨
            p.textAlign(p.CENTER, p.BOTTOM);
            p.textSize(12);
            p.text("회차", plotX + plotW / 2, H - 8);
            p.push();
            p.translate(16, plotY + plotH / 2);
            p.rotate(-p.HALF_PI);
            p.text("압력 (atm)", 0, 0);
            p.pop();

            // Step F finishing: records 0개 시 placeholder text + return (막대·범례 생략)
            if (N === 0) {
                p.textAlign(p.CENTER, p.CENTER);
                p.textSize(13);
                p.fill(0, 0, 60);
                p.text("측정 후 결과가 여기 표시됩니다", plotX + plotW / 2, plotY + plotH / 2);
                return;
            }

            // 막대 그리기 (각 회차)
            p.textSize(10);
            for (let i = 0; i < N; i++) {
                const r = records[i];
                const slotX = plotX + i * slotW;
                const barX = slotX + barOffset;
                const baseY = yToPx(0);

                // 가스 A (P_A) — 막대 하단
                const gasAColor = (r.gasA && cfg.gases[r.gasA]) ? cfg.gases[r.gasA].color : "#1F2937";
                const airTopY = yToPx(r.P_A);
                p.fill(gasAColor);
                p.noStroke();
                p.rect(barX, airTopY, barW, baseY - airTopY);

                // 가스 B (P_B) — 막대 상단 (P_A 위에 stack)
                const gasBColor = (r.gasB && cfg.gases[r.gasB]) ? cfg.gases[r.gasB].color : "#27AE60";
                const co2TopY = yToPx(r.P_A + r.P_B);  // = P_total
                p.fill(gasBColor);
                p.rect(barX, co2TopY, barW, airTopY - co2TopY);

                // P_total 값 막대 위 표기
                p.fill(0, 0, 20);
                p.textAlign(p.CENTER, p.BOTTOM);
                p.text(r.P_total.toFixed(2), barX + barW / 2, co2TopY - 2);
            }

            // 범례 (우상단)
            p.textAlign(p.LEFT, p.CENTER);
            p.textSize(11);
            const legendX = plotX + plotW - 110;
            const legendY = plotY + 10;

            // Phase 5.4: records 의 unique 가스 종류로 동적 범례 생성
            // 등장 순 — gasB 먼저 (막대 stack 상단), 그 다음 gasA (하단). 범례 위→아래 일관.
            const uniqueGases = new Map();  // gasKey → { color, label }
            for (const r of records) {
                if (r.gasB && !uniqueGases.has(r.gasB)) {
                    const def = cfg.gases[r.gasB] || {};
                    uniqueGases.set(r.gasB, { color: def.color || "#27AE60", label: def.label || r.gasB });
                }
            }
            for (const r of records) {
                if (r.gasA && !uniqueGases.has(r.gasA)) {
                    const def = cfg.gases[r.gasA] || {};
                    uniqueGases.set(r.gasA, { color: def.color || "#1F2937", label: def.label || r.gasA });
                }
            }

            let legendIdx = 0;
            for (const [, def] of uniqueGases) {
                const itemY = legendY + legendIdx * 18;
                p.fill(def.color);
                p.noStroke();
                p.rect(legendX, itemY - 5, 12, 12);
                p.fill(0, 0, 20);
                p.text(def.label, legendX + 18, itemY + 1);
                legendIdx++;
            }
        };
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
        // Phase 5.4: 압력 확정 자동 해제 (IDLE/STABILIZING 외 진입 시)
        if (daltonState.pressureFrozen &&
            newStage !== "IDLE" && newStage !== "STABILIZING") {
            daltonState.pressureFrozen = false;
            daltonState.frozenP_A_kPa = null;
            daltonState.frozenP_B_kPa = null;
        }

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
        updatePressureFreezeUI();
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5.9: Vernier 모드 단계 머신
    // 5상태: IDLE | INJECTING | STABILIZING | READY_TO_CAPTURE | CAPTURED
    // 자동 전환 (INJECTING → STABILIZING → READY_TO_CAPTURE) 은 작업 5 (안정화 감지) 에서 추가.
    // 현재는 측정 버튼 2회 (IDLE→INJECTING, READY_TO_CAPTURE→CAPTURED) 만 wired,
    // 중간 상태는 디버그 helper window._advanceVernier() 로 수동 진행.
    // ─────────────────────────────────────────────────────────
    const VERNIER_STAGE_TEXT = {
        IDLE:               "초기 상태 — 측정 버튼을 눌러 시작 압력을 기록하세요",
        INJECTING:          "주입 중 — 손 뗀 후 안정화될 때까지 기다리세요",
        STABILIZING:        "안정화 중...",
        READY_TO_CAPTURE:   "안정 도달 — 측정 버튼을 눌러 평형 압력을 기록하세요",
        CAPTURED:           "기록 완료. V_A' 실측값을 입력하세요",
    };

    function setVernierStage(newStage) {
        daltonState.vernier.stage = newStage;
        // 측정 버튼 활성 조건: IDLE (1번째 캡처) 또는 READY_TO_CAPTURE (2번째 캡처) 만
        const measureEnabled = (newStage === "IDLE" || newStage === "READY_TO_CAPTURE");
        if (dom.btnVernierMeasure) {
            dom.btnVernierMeasure.disabled = !measureEnabled;
            // READY_TO_CAPTURE 시 시각 강조 (CSS .ready 클래스)
            dom.btnVernierMeasure.classList.toggle("ready", newStage === "READY_TO_CAPTURE");
        }
        // 단계 표시 텍스트
        if (dom.vernierStageText) {
            dom.vernierStageText.textContent = VERNIER_STAGE_TEXT[newStage] || "";
        }
        // 사전 입력 잠금: IDLE 외에는 V_A·V_B·gas 잠금 (학생이 실험 중 변경 못하게)
        const lockInputs = (newStage !== "IDLE");
        if (dom.gasASelect)     dom.gasASelect.disabled    = lockInputs;
        if (dom.gasBSelect)     dom.gasBSelect.disabled    = lockInputs;
        if (dom.volumeANumber)  dom.volumeANumber.disabled = lockInputs;
        if (dom.volumeBNumber)  dom.volumeBNumber.disabled = lockInputs;
    }

    // Phase 5.9: 디버그 helper — INJECTING → STABILIZING → READY_TO_CAPTURE 수동 진행.
    // 작업 5 (자동 안정화 감지 |dP/dt| < 0.1 kPa/s 3초 유지) 완료 후 제거.
    window._advanceVernier = function() {
        const cur = daltonState.vernier.stage;
        const next = {
            IDLE:             "INJECTING",
            INJECTING:        "STABILIZING",
            STABILIZING:      "READY_TO_CAPTURE",
            READY_TO_CAPTURE: "CAPTURED",
            CAPTURED:         "IDLE",
        }[cur];
        if (!next) return console.warn("[Vernier debug] unknown stage:", cur);
        setVernierStage(next);
        console.log(`[Vernier debug] ${cur} → ${next}`);
        return next;
    };

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

        // Step C-3 v9: V_A 와 theoryAfterAtm 을 주입 시작 전 캐시
        // (finalize 후 V_A=0 으로 변경되므로 0/V_B+1=1 으로 잘못 계산되는 문제 해결)
        const V_A_initial = daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        const theoryAfterAtm = V_B > 0 ? (V_A_initial / V_B + 1) * 1.00 : 1.00;
        // Step F: addRecord 에서 사용 (V_A_initial 보존)
        daltonState.V_A_initial_cached = V_A_initial;
        daltonState.gasA_cached = daltonState.syringeA.gas;
        // Phase 5.3: 주입 전 P_B 보존 (평형값으로 변하기 전 — n_B 산출용)
        daltonState.pressureBInitial_cached = daltonState.pressureBSensor;

        setStage("INJECTING");

        // Step C-3: 입자 이주 애니메이션 (A 입자 60개 → 노즐 → 튜브 → B)
        // finalizeInjectedVolume() 안에서 pressureBSensor = theoryAfterAtm 설정 (Step F 정정)
        await runInjectionAnimation();
        if (daltonState.abortCurrentFlow) return;

        // Step F 정정: 안정화 동안 비평형 — STABILIZING stage 도입
        // (LCD "—" 유지, 5초 후 INJECTED 진입 시점에 평형 표시)
        setStage("STABILIZING");
        await startStabilization();
        if (daltonState.abortCurrentFlow) return;

        // Step F 정정: 안정화 완료 — 평형 도달, INJECTED 진입
        // (setStage 마지막의 updatePressureReadouts() 자동 호출 → P_B 정상 표시)
        setStage("INJECTED");
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
        // Phase 5.4: 기록 시점 입자 수 강제 갱신 (비-freeze 시)
        if (daltonSensorManager.mode !== "mock" && !daltonState.pressureFrozen) {
            maybeUpdateParticleTarget("A", true);
            maybeUpdateParticleTarget("B", true);
        }
        addRecord();
        setStage("CONFIRMED");
    }

    // ─────────────────────────────────────────────────────────
    // [초기화] — 어느 stage 에서든 IDLE 복귀
    // - stage = IDLE
    // - V_A, V_B 는 유지 (학생 편의, 반복 실험)
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

        // Phase 5.4 commit iii: mock 은 setPressureImmediate 경유 (mock source 내부 _channels 동기),
        // ws/real 은 직접 set (다음 onChannelData 수신 전까지 fallback).
        if (daltonSensorManager.mode === "mock" && daltonSensorManager.source) {
            daltonSensorManager.source.setPressureImmediate(101.325, 0);
            daltonSensorManager.source.setPressureImmediate(101.325, 1);
        } else {
            daltonState.pressureASensor = 1.00;
            daltonState.pressureBSensor = 1.00;
        }
        // Phase 5.4: EMA / target / freeze 초기화
        daltonState.emaP_A_kPa = 101.325;
        daltonState.emaP_B_kPa = 101.325;
        daltonState.lastUpdatedP_A_kPa = 101.325;
        daltonState.lastUpdatedP_B_kPa = 101.325;
        daltonState.targetParticles_A = null;
        daltonState.targetParticles_B = null;
        daltonState.pressureFrozen = false;
        daltonState.frozenP_A_kPa = null;
        daltonState.frozenP_B_kPa = null;
        // Phase 5.3 정정: cache 미초기화 정합 (다음 측정 영향 회피)
        daltonState.V_A_initial_cached      = null;
        daltonState.gasA_cached             = null;
        daltonState.pressureBInitial_cached = null;
        // Phase 5.3 기능 4: 비교 상태 초기화 (record 자체는 유지 — 학생 편의 정책)
        daltonState.comparisonSelected = [];
        if (dom.comparisonResult) dom.comparisonResult.classList.add("hidden");
        if (dom.comparisonBody) dom.comparisonBody.innerHTML = "";
        if (dom.recordsTbody) {
            const checkboxes = dom.recordsTbody.querySelectorAll("input.compare-checkbox");
            checkboxes.forEach((cb) => { cb.checked = false; });
        }

        // Step C-3 v2: 입자 정리 + 시스템 재생성 (A 60 / B 60 복구)
        injectionPistonAnimating = false;  // 피스톤 애니 정리 (Step C-3 piston / v2)
        pendingTransferParticles = [];     // Step C-3 v6: 주입 중 abort 시 pending 정리
        releasedCount = 0;                 // Step C-3 v6: 다음 주입을 위해 0 으로
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

        // Phase 5.9: Vernier substate 도 IDLE 로 리셋
        daltonState.vernier.P_initial_kPa = null;
        daltonState.vernier.P_total_kPa = null;
        if (daltonSensorManager.mode === "vernier") {
            setVernierStage("IDLE");
        }

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
        // Step F: V_A_initial_cached 사용 (V_A=0 버그 회피)
        const V_A_initial = daltonState.V_A_initial_cached !== null
            ? daltonState.V_A_initial_cached
            : daltonState.syringeA.volume;
        const V_B = daltonState.syringeB.volume;
        const theoryAtm = V_B > 0 ? (V_A_initial / V_B + 1) * 1.00 : 1.00;
        const P_total = daltonState.pressureBSensor;
        // Step F: 부분 압력 계산 (R5 안 가스별 입자 수 비율 × P_total)
        const counts = countR5ParticlesByGas();
        const totalCount = Object.values(counts).reduce((s, c) => s + c, 0);
        const gasA = daltonState.gasA_cached || daltonState.syringeA.gas;
        const gasB = daltonState.syringeB.gas;
        const P_A_partial = totalCount > 0 ? (counts[gasA] || 0) / totalCount * P_total : 0;
        const P_B_partial = totalCount > 0 ? (counts[gasB] || 0) / totalCount * P_total : 0;
        const timeStr = new Date().toLocaleTimeString("ko-KR", { hour12: false });
        const unit = getPressureUnit();

        // 분자 수 — 단일 산출 함수 + 주입 전 값 (보존량)
        const n_A = computeMoleCount(1.00, V_A_initial);
        const n_B = computeMoleCount(daltonState.pressureBInitial_cached, V_B);
        const n_total = n_A + n_B;

        // record array (그래프 + CSV 위함)
        const record = {
            n: n,
            V_A_initial: V_A_initial,
            V_B: V_B,
            theoryAtm: theoryAtm,
            P_total: P_total,
            P_A: P_A_partial,
            P_B: P_B_partial,
            gasA: gasA,
            gasB: gasB,
            n_A: n_A,
            n_B: n_B,
            n_total: n_total,
            time: timeStr,
        };
        daltonState.measurementRecords.push(record);

        // 10컬럼 순서: 회차·V_A·V_B·P(이론)·P(시뮬)·P_A·P_B·n_A·n_B·n_total
        // (timeStr 은 record array 에 보존, CSV 위함)
        const tr = document.createElement("tr");
        tr.dataset.recordN = n;  // Phase 5.4: 행 식별 (삭제 시 사용)
        tr.innerHTML = `
            <td class="compare-cell"><input type="checkbox" class="compare-checkbox" data-record-n="${n}"></td>
            <td>${n}</td>
            <td>${V_A_initial}</td>
            <td>${V_B}</td>
            <td>${formatPressure(theoryAtm)} ${unit}</td>
            <td>${formatPressure(P_total)} ${unit}</td>
            <td>${formatPressure(P_A_partial)} ${unit}</td>
            <td>${formatPressure(P_B_partial)} ${unit}</td>
            <td>${n_A}</td>
            <td>${n_B}</td>
            <td>${n_total}</td>
            <td class="delete-cell"><button type="button" class="record-delete-btn" data-record-n="${n}" title="회차 ${n} 삭제">🗑️</button></td>
        `;
        dom.recordsTbody.appendChild(tr);

        // 첫 기록 시 "아직 기록된 측정이 없습니다" 안내만 숨김
        if (n === 1) {
            if (dom.recordsEmpty) dom.recordsEmpty.classList.add("hidden");
        }

        // Step F finishing: chart-wrap 은 페이지 로드 시부터 표시 — redraw 만
        if (daltonChartP5Instance) {
            daltonChartP5Instance.redraw();
        }
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5.3 기능 4: 비교 모드 (FIFO 최대 2 row 선택 + 차이 분석)
    // ─────────────────────────────────────────────────────────
    function setupComparisonHandler() {
        if (!dom.recordsTbody) return;
        dom.recordsTbody.addEventListener("change", (e) => {
            const target = e.target;
            if (!target.classList.contains("compare-checkbox")) return;
            const recordN = parseInt(target.dataset.recordN, 10);
            handleComparisonToggle(recordN, target.checked);
        });
    }

    // Phase 5.4: 측정 기록 행 삭제 (event delegation + confirm)
    function setupRecordDeleteHandler() {
        if (!dom.recordsTbody) return;
        dom.recordsTbody.addEventListener("click", (e) => {
            const btn = e.target.closest(".record-delete-btn");
            if (!btn) return;
            const recordN = parseInt(btn.dataset.recordN, 10);
            if (!Number.isFinite(recordN)) return;
            if (!confirm(`회차 ${recordN} 측정 기록을 삭제할까요?`)) return;
            deleteRecord(recordN);
        });
    }

    function deleteRecord(recordN) {
        // 1. measurementRecords 배열에서 제거 (회차 번호는 유지 — F1)
        const idx = daltonState.measurementRecords.findIndex((r) => r.n === recordN);
        if (idx < 0) return;
        daltonState.measurementRecords.splice(idx, 1);

        // 2. 표 tr 제거
        const tr = dom.recordsTbody.querySelector(`tr[data-record-n="${recordN}"]`);
        if (tr) tr.remove();

        // 3. 비교 모드 — 삭제된 record 가 선택 중이면 해제
        const compIdx = daltonState.comparisonSelected.indexOf(recordN);
        if (compIdx >= 0) {
            daltonState.comparisonSelected.splice(compIdx, 1);
            renderComparisonResult();  // 비교 영역 갱신 (1개 이하면 hide)
        }

        // 4. 그래프 갱신 (G1: 빈 회차 자리 유지 — daltonChartSketch 가 record.n 으로 x 축 매핑)
        if (daltonChartP5Instance) {
            daltonChartP5Instance.redraw();
        }

        // 5. 표 비었을 때 empty 메시지 표시
        if (daltonState.measurementRecords.length === 0) {
            if (dom.recordsEmpty) dom.recordsEmpty.classList.remove("hidden");
        }
    }

    function handleComparisonToggle(recordN, isChecked) {
        const selected = daltonState.comparisonSelected;

        if (isChecked) {
            // 추가. 이미 2개면 가장 옛 (selected[0]) 자동 해제 (FIFO)
            if (selected.length >= 2) {
                const removedN = selected.shift();
                const removedCheckbox = dom.recordsTbody.querySelector(
                    `input.compare-checkbox[data-record-n="${removedN}"]`
                );
                if (removedCheckbox) removedCheckbox.checked = false;
            }
            selected.push(recordN);
        } else {
            const idx = selected.indexOf(recordN);
            if (idx >= 0) selected.splice(idx, 1);
        }

        renderComparisonResult();
    }

    // 비교 분석 — 정적 규칙 (4 변수 + 배수 + 해석)
    function computeComparison(rec1, rec2) {
        const ratio = (a, b) => (b === 0 ? null : a / b);
        const fmtRatio = (r) => {
            if (r === null) return "—";
            if (Math.abs(r - 1) < 0.01) return "변화 없음";
            return `${r.toFixed(2)}배`;
        };

        const vA = { from: rec1.V_A_initial, to: rec2.V_A_initial, ratio: ratio(rec2.V_A_initial, rec1.V_A_initial) };
        const vB = { from: rec1.V_B, to: rec2.V_B, ratio: ratio(rec2.V_B, rec1.V_B) };
        const pT = { from: rec1.P_total, to: rec2.P_total, ratio: ratio(rec2.P_total, rec1.P_total) };
        const nT = { from: rec1.n_total, to: rec2.n_total, ratio: ratio(rec2.n_total, rec1.n_total) };

        // 해석 — V_A / V_B 변화 패턴 분기
        let interp = "";
        const vBSame = vB.ratio !== null && Math.abs(vB.ratio - 1) < 0.01;
        const vASame = vA.ratio !== null && Math.abs(vA.ratio - 1) < 0.01;

        if (vBSame && !vASame) {
            interp = `V<sub>B</sub> 일정, V<sub>A</sub> 가 ${fmtRatio(vA.ratio)} 변화 → 분자 수 (n<sub>total</sub>) 와 압력 (P<sub>total</sub>) 모두 ${fmtRatio(nT.ratio)} 변화. <br>(V<sub>B</sub> 일정 시 P<sub>total</sub> ∝ n<sub>total</sub> — 돌턴 법칙 핵심)`;
        } else if (vASame && !vBSame) {
            interp = `V<sub>A</sub> 일정, V<sub>B</sub> 가 ${fmtRatio(vB.ratio)} 변화 → 분자 수 보존이지만 부피 변화로 압력은 ${fmtRatio(pT.ratio)} 변화. <br>(n 일정 시 P ∝ 1/V — 보일 법칙 적용)`;
        } else if (vASame && vBSame) {
            interp = "두 측정 조건 동일 (V<sub>A</sub>, V<sub>B</sub> 변화 없음). 시뮬레이션 재현성 확인 가능.";
        } else {
            interp = `V<sub>A</sub>, V<sub>B</sub> 모두 변화. 압력 변화 = ${fmtRatio(pT.ratio)}, 분자 수 변화 = ${fmtRatio(nT.ratio)}. <br>(P<sub>total</sub> = n<sub>total</sub> / V<sub>B</sub> 관계로 두 효과 합성)`;
        }

        return { vA, vB, pT, nT, interp };
    }

    function renderComparisonResult() {
        const selected = daltonState.comparisonSelected;
        const records = daltonState.measurementRecords;

        if (selected.length !== 2) {
            if (dom.comparisonResult) dom.comparisonResult.classList.add("hidden");
            return;
        }

        const [n1, n2] = selected;
        const rec1 = records.find((r) => r.n === n1);
        const rec2 = records.find((r) => r.n === n2);
        if (!rec1 || !rec2) {
            if (dom.comparisonResult) dom.comparisonResult.classList.add("hidden");
            return;
        }

        const cmp = computeComparison(rec1, rec2);
        const unit = daltonState.displayUnit || "atm";

        const html = `
            <table>
                <tr><th>변수</th><th>회차 ${n1}</th><th>→</th><th>회차 ${n2}</th><th>배수</th></tr>
                <tr><td>V<sub>A</sub></td><td>${cmp.vA.from} mL</td><td>→</td><td>${cmp.vA.to} mL</td><td>${cmp.vA.ratio.toFixed(2)}배</td></tr>
                <tr><td>V<sub>B</sub></td><td>${cmp.vB.from} mL</td><td>→</td><td>${cmp.vB.to} mL</td><td>${cmp.vB.ratio.toFixed(2)}배</td></tr>
                <tr><td>P<sub>total</sub></td><td>${cmp.pT.from.toFixed(2)} ${unit}</td><td>→</td><td>${cmp.pT.to.toFixed(2)} ${unit}</td><td>${cmp.pT.ratio.toFixed(2)}배</td></tr>
                <tr><td>n<sub>total</sub></td><td>${cmp.nT.from}</td><td>→</td><td>${cmp.nT.to}</td><td>${cmp.nT.ratio.toFixed(2)}배</td></tr>
            </table>
            <div class="interpretation">→ ${cmp.interp}</div>
        `;

        if (dom.comparisonBody) dom.comparisonBody.innerHTML = html;
        if (dom.comparisonResult) dom.comparisonResult.classList.remove("hidden");
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5.7 트랙 6-c: AI 튜터 — createTutor 통합 모듈 wrapper
    // 기존 createDaltonTutor (330줄) 삭제 — daltonConfig + createTutor 단일 호출.
    // 결정: Q-A closeConfig=null (현행 보존), Q-B metaTabId="4" 활성 (Q4 fix), Q-C autoQuestionTabIds=[]
    // daltonState 의존 read-only 2점 (records / comparisonSelected) — buildDataContext callback 경유.
    // ─────────────────────────────────────────────────────────
    const DALTON_LEVEL_GUIDES = {
        elem:   "초등학생. 가스 분자를 공이나 구슬에 비유. 수식 없이 직관적 이미지로만. 친근 톤, 격려 많이.",
        middle: "중학교 영재학급. 기본 분자 운동론 이해. 친근 톤, 어려운 용어 설명 동반.",
        high:   "고등학교 영재학급. 이상기체 상태방정식, 통계역학 기초 가능. 엄밀성 + 학생 사고 존중.",
        univ:   "대학 일반화학. 맥스웰-볼츠만 분포, 반데르발스 방정식 수준 가능.",
    };

    // R1: Q1~Q4 ↔ 학습 목표 1, 2, 동적, 4 매핑 (16 질문 차등)
    const DALTON_QUESTION_TEXT = {
        elem: {
            1: "주사기 두 개를 합치기 전과 후, 가스 분자 수는 어떻게 변할까요? 표의 n_A, n_B, n_total 을 직접 세보세요.",
            2: "두 가스가 섞이면 각 가스가 만드는 압력은 어떻게 될까요? 표의 P_A, P_B 를 보며 생각해보세요.",
            3: "다음 측정에서 V_A 를 두 배로 하면 P_total 도 두 배가 될까요? 이유는?",
            4: "📊 [질문 생성] 버튼을 눌러 내 데이터에 맞는 질문을 받아보세요.",
        },
        middle: {
            1: "두 시린지 결합 전후 분자 수 변화를 표의 n_A, n_B, n_total 로 확인하세요. 분자가 사라지지 않는다면 무엇이 변할까요?",
            2: "각 가스의 부분 압력 (P_A, P_B) 이 어떻게 결정되는지 표의 V_A, V_B 와 비교해보세요.",
            3: "P_total 과 부분 압력의 합을 비교해보세요. 어떤 관계가 보이나요?",
            4: "📊 [질문 생성] 버튼을 눌러 내 데이터에 맞는 탐구 질문을 받아보세요.",
        },
        high: {
            1: "주입 전후 분자 수 (n) 가 보존된다고 가정할 때, 부피 변화 시 압력은 어떻게 변할까요? PV=nRT 로 설명해보세요.",
            2: "부분 압력의 비율과 분자 수의 비율을 비교해보세요. 돌턴 법칙이 어떻게 표현되나요?",
            3: "측정값 P_total (시뮬) 과 이론값 P(이론) 을 비교해보세요. 차이가 있다면 그 원인은?",
            4: "📊 [질문 생성] 버튼을 눌러 내 데이터에 맞는 심화 질문을 받아보세요.",
        },
        univ: {
            1: "이상기체 가정 하 분자 수 보존을 PV=nRT 와 결합해 P_total 을 V_A, V_B, T 로 유도하세요.",
            2: "돌턴 법칙 P_total = ΣP_i 의 가정 (이상기체, 비반응성) 을 명시하고, 실제 기체에서 어긋날 조건을 논하세요.",
            3: "측정값과 이론값의 차이를 통계적으로 분석하고, 시뮬레이션 모델의 한계를 논하세요.",
            4: "📊 [질문 생성] 버튼을 눌러 내 데이터에 맞는 정량 분석 질문을 받아보세요.",
        },
    };

    function daltonGetQuestionText(level, qid) {
        if (qid === "free") return "💬 자유 질문 모드";
        return DALTON_QUESTION_TEXT[level]?.[qid] || "";
    }

    // F1: 비교 모드 통합 — ctx.comparisonSelected 2개면 두 row 데이터 자동 주입
    // (기존 createDaltonTutor.buildSystemPrompt 본문 그대로 — daltonState 직접 참조 → ctx 인자 경유)
    function daltonBuildSystemPrompt(level, qid, ctx) {
        const records = ctx.records || [];
        const recentRecords = records.slice(-3);
        const comparisonNs = ctx.comparisonSelected || [];
        const comparisonRecs = comparisonNs.length === 2
            ? comparisonNs.map((n) => records.find((r) => r.n === n)).filter(Boolean)
            : [];

        let dataContext = "";
        if (comparisonRecs.length === 2) {
            dataContext = `\n[비교 중인 두 측정 (학생이 비교 모드 체크)]\n` + comparisonRecs.map((r) =>
                `- 회차 ${r.n}: V_A=${r.V_A_initial}, V_B=${r.V_B}, P_total=${r.P_total.toFixed(2)} atm, P_A=${r.P_A.toFixed(2)} atm, P_B=${r.P_B.toFixed(2)} atm, n_A=${r.n_A}, n_B=${r.n_B}, n_total=${r.n_total}, gas_A=${r.gasA}, gas_B=${r.gasB}`
            ).join("\n");
        } else if (recentRecords.length > 0) {
            dataContext = `\n[최근 측정 ${recentRecords.length}개]\n` + recentRecords.map((r) =>
                `- 회차 ${r.n}: V_A=${r.V_A_initial}, V_B=${r.V_B}, P_total=${r.P_total.toFixed(2)} atm, P_A=${r.P_A.toFixed(2)} atm, P_B=${r.P_B.toFixed(2)} atm, n_A=${r.n_A}, n_B=${r.n_B}, n_total=${r.n_total}, gas_A=${r.gasA}, gas_B=${r.gasB}`
            ).join("\n");
        } else {
            dataContext = "\n[측정 기록 없음 — 학생이 아직 [확인] 버튼을 누르지 않았습니다.]";
        }

        // Phase 5.9 트랙 D-(3): 데이터 소스 분기 신설 (Boyle ui.js:1754-1789 패턴 미러링).
        // mock/ws/real/vernier 4종 분기 + Vernier 운용 시나리오 본문.
        const mode = ctx.mode || "mock";
        const isVernier = (mode === "vernier");

        // 현재 시린지 부피 — 모든 모드 공통
        const volumeLine = `\n[현재 시린지 부피] V_A=${ctx.V_A} mL, V_B=${ctx.V_B} mL`;

        // Vernier substate — vernier 모드 한정. null → "미측정" 한국어화, stage 는 영문 보존.
        let vernierBlock = "";
        if (isVernier && ctx.vernier) {
            const v = ctx.vernier;
            const fmtP = (n) => (n === null || n === undefined) ? "미측정" : `${n.toFixed(2)} kPa`;
            const fmtV = (n) => (n === null || n === undefined) ? "미측정" : `${n.toFixed(1)} mL`;
            vernierBlock = `\n[Vernier 측정 진행 상태] stage=${v.stage}, P_initial=${fmtP(v.P_initial_kPa)}, P_total=${fmtP(v.P_total_kPa)}, V_A_current=${fmtV(v.V_A_current_mL)}`;
        }

        // 비교 모드 + vernier 동시 안내 (두 블록 모두 표시 + 1줄 우선순위 가이드)
        const dualNoteLine = (comparisonRecs.length === 2 && isVernier)
            ? "\n학생이 비교 모드를 체크하고 동시에 Vernier 측정 진행 중입니다. 비교 분석을 우선하되, 진행 중인 측정도 인지해 답하세요."
            : "";

        const focusLine = qid === "free"
            ? "현재 모드: 자유 질문 — 학생 질문에 부분 압력 법칙 / 분자 수 / 시뮬 데이터와 연결해 답변. 400자 이내."
            : `현재 탐구 질문: ${DALTON_QUESTION_TEXT[level]?.[qid] || ""}`;

        // 데이터 소스 라벨 + 분기 가이드 (Boyle 패턴 미러링, 4종)
        const dataSourceLabel =
            mode === "real"    ? "실물 센서 (ESP32 + 압력 센서)"
          : mode === "vernier" ? "Vernier GDX-GP (상용 BLE 압력 센서)"
          : mode === "ws"      ? "펌웨어 에뮬레이터 (개발용 가짜 센서)"
          :                      "시뮬레이션 (입자 시뮬, P 직접 산출)";

        const sensorGuide = mode === "real"
            ? `[데이터 소스 고려사항]\n현재는 **실물 센서** (ESP32 + 압력 센서) 환경: 측정 오차·기밀 불량·온도 드리프트 등 실험 현실 요인을 질문/피드백에 적극 반영. 학생이 시린지 눈금을 직접 읽었다는 전제로 오차 원인 탐구를 유도.`
            : mode === "vernier"
            ? `[데이터 소스 고려사항]\n현재는 **Vernier GDX-GP** (상용 BLE 압력 센서, ±3 kPa 검정 정확도) + **콕 결합 셋업** (3-way 콕은 A·B 연결 위치 고정, GDX는 측정 포트). 측정 단계 = 1번 클릭으로 결합 시스템 초기 P_initial 캡처 → 학생이 A 시린지 누름 → 평형 후 2번 클릭으로 P_total 캡처. **1센서 운용 한계**: P_A·P_B 동시 측정 불가, 시작·끝 두 점만 의미 있음 — Dalton 법칙 검증은 평형 P_total 비교로 진행. V_A_current 는 V_A' = P_initial·(V_A+V_B)/P_current − V_B 역산으로 학생 누름 정도 실시간 추정. 이론값: P_total = P_initial·(V_A+V_B)/V_B.`
            : mode === "ws"
            ? `[데이터 소스 고려사항]\n현재는 **펌웨어 에뮬레이터** (가짜 센서) 환경: 실험 노이즈는 없으나 학생이 시린지 눈금을 직접 입력. 측정 절차를 묻는 질문은 가능하되 측정 오차·드리프트 해석은 지양.`
            : `[데이터 소스 고려사항]\n현재는 **시뮬레이션** 환경: 이상기체 법칙이 정확히 성립하는 조건이므로 이론 중심 탐구. 분자 수 보존·부분 압력 가산성을 입자 시각으로 직접 확인 가능. "실험으로 검증하려면 어떻게 측정해야 할까?" 같은 확장 질문으로 현실과 연결 유도.`;

        return `당신은 영재 과학교육 튜터입니다.
대상 학생: ${DALTON_LEVEL_GUIDES[level] || DALTON_LEVEL_GUIDES.high}
현재 탐구 주제: 돌턴의 부분 압력 법칙 (P_total = P_A + P_B = ΣP_i, 동일 부피·온도, 비반응성 가스)
[데이터 소스] ${dataSourceLabel}

${focusLine}
${dataContext}${volumeLine}${vernierBlock}${dualNoteLine}

${sensorGuide}

학습 목표 4 핵심:
1. 분자 수 보존 — 주입 전후 n_A, n_B, n_total 모두 불변. 분자는 사라지지 않음.
2. 부분 압력 = (n_가스 / n_total) × P_total — 돌턴 법칙 핵심 표현.
3. 전체 압력 = 부분 압력의 합 (P_total = P_A + P_B). 가산성.
4. 시뮬 ↔ 이론 일치 — V·P 비례 (PV=nRT). 측정값 P(시뮬) 과 이론값 P(이론) 비교.
(Graham 법칙 — 학생이 분자 속도 / 분자량 차이 질문 시만 다룰 것)

절대 원칙:
1. 학생이 아직 생각하지 못한 답을 직접 알려주지 마세요. 답변을 인정하고 한 단계 더 깊은 질문을 던지세요.
2. 학생 답변의 구체적 표현을 인용하며 피드백. 일반론 금지.
3. 학생 데이터의 구체 숫자 언급하며 연결.
4. 격려하되 과찬 금지. 틀린 부분 명확히 짚되 비난 금지.
5. 250자 이내 (자유 모드 400자). 한 피드백에 한 핵심만.
6. 마지막에 학생이 더 생각해볼 질문 1개 제시.
7. 결론 짓지 말고 다음 생각으로 이어지는 질문으로 마무리.
8. 3~4턴 이상 진행 시 자연스럽게 답에 다가가도록 수렴.
9. 오개념 발견 시 직접 교정 X — "잠깐, [학생 표현]이라고 하셨는데, [반례 상황]에서도 그럴까요?" 형식으로 의문 제기.
10. 대화 내용으로 학생 수준 판단. 설정과 다르다고 확신 시 응답 마지막 줄에 [[LEVEL:middle]] / [[LEVEL:high]] / [[LEVEL:univ]] 추가.

한국어로 답변하세요.`;
    }

    function initDaltonTutor() {
        if (!window.PchemTutorModule) {
            console.error("[dalton tutor] PchemTutorModule 미로드 — tutor.js script 누락?");
            return;
        }

        const daltonConfig = {
            simName: "dalton",
            sidebarSelector: "#ai-sidebar",
            tabIds: ["1", "2", "3", "4", "free"],
            metaTabId: "4",                   // Q-B: Q4 메타 활성 (깨진 placeholder fix)
            autoQuestionTabIds: [],           // Q-C: 자동 질문 X (현행 보존)
            // Q-A 재결정 (A2): boyle 패턴 채택 — AI 요약 활성. default prompt 사용.
            // 사용자 의도 = [✓ 대화 마무리] → AI 2~3줄 요약 → 입력창 비활성 + 버튼 hidden.
            closeConfig: { /* 기본 prompt 사용 */ },
            reportEnabled: false,             // dalton 보고서 X
            getQuestionText:   daltonGetQuestionText,
            buildSystemPrompt: daltonBuildSystemPrompt,
            buildDataContext:  () => ({
                mode: daltonSensorManager.mode,   // "mock" | "ws" | "real" | "vernier"
                records: daltonState.measurementRecords,
                comparisonSelected: daltonState.comparisonSelected,
                V_A: daltonState.syringeA.volume,
                V_B: daltonState.syringeB.volume,
                // vernier 모드 한정 substate (다른 모드에선 daltonBuildSystemPrompt 가 미표시)
                vernier: {
                    stage:          daltonState.vernier.stage,
                    P_initial_kPa:  daltonState.vernier.P_initial_kPa,
                    P_total_kPa:    daltonState.vernier.P_total_kPa,
                    V_A_current_mL: daltonState.vernier.V_A_current_mL,
                },
            }),
            onLevelDetect: (level) => {
                console.log(`[dalton tutor] 학생 수준 자동 감지: ${level}`);
            },
        };

        const daltonTutor = window.PchemTutorModule.createTutor(daltonConfig);
        if (!daltonTutor) {
            console.error("[dalton tutor] createTutor 실패");
            return;
        }
        window.PchemDaltonTutor = daltonTutor;

        // Q-B: Q4 [질문 생성] 버튼 — metaTabId="4" 활성 시 default empty state 가 #btn-generate-q4 동적 렌더
        document.addEventListener("click", (e) => {
            if (e.target?.closest?.("#btn-generate-q4")) {
                daltonTutor.generateMetaQuestion();
            }
        });

        // Q-A 재결정 (A2): btn-close-q → closeConversation (boyle 패턴 — AI 요약).
        const closeBtn = document.getElementById("btn-close-q");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => daltonTutor.closeConversation());
        }

        daltonTutor.init();
    }

    // ─────────────────────────────────────────────────────────
    // Step G: 측정 기록을 CSV header + rows 로 변환
    // (logger.js 의 module-level downloadCSV / formatTimestampForFilename 재사용 — 보일·입자운동과 패턴 일관)
    // ─────────────────────────────────────────────────────────
    function recordsToCSVData() {
        const records = daltonState.measurementRecords;
        if (!records || records.length === 0) return null;

        // 11 컬럼 — 측정 기록 테이블 10 + 시간 (분석용, 단위 atm 고정)
        const header = ["회차", "V_A", "V_B", "P(이론)_atm", "P(시뮬)_atm", "P(A)_atm", "P(B)_atm", "n_A", "n_B", "n_total", "시간"];
        const rows = records.map(r => [
            r.n,
            r.V_A_initial,
            r.V_B,
            r.theoryAtm.toFixed(2),
            r.P_total.toFixed(2),
            r.P_A.toFixed(2),
            r.P_B.toFixed(2),
            r.n_A,
            r.n_B,
            r.n_total,
            r.time,
        ]);
        return { header, rows };
    }

    // Step G: CSV 파일 다운로드 (logger.js 의 downloadCSV 재사용)
    function exportRecordsCSV() {
        const data = recordsToCSVData();
        if (!data) {
            alert("측정 기록이 없습니다. 먼저 측정을 진행해 주세요.");
            return;
        }
        const filename = `dalton_${formatTimestampForFilename(new Date())}.csv`;
        downloadCSV(filename, data.header, data.rows);
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
    // Phase 5.3: V 변경 시에도 재생성 (시각 입자 = 분자 수 — Step C-2 결정 번복)
    let lastGasA = daltonState.syringeA.gas;
    let lastGasB = daltonState.syringeB.gas;
    let lastV_A = daltonState.syringeA.volume;
    let lastV_B = daltonState.syringeB.volume;

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
            lastV_A = daltonState.syringeA.volume;  // V 도 동기 (V 트리거 중복 호출 회피)
        }
        if (gasChangedB) {
            daltonState.syringeB.displayedVolume = daltonState.syringeB.volume;
            rebuildParticleSystem("B");
            lastGasB = daltonState.syringeB.gas;
            lastV_B = daltonState.syringeB.volume;
        }

        // Phase 5.3: V 변경 시 재생성 (시각 입자 = 분자 수 V 비례)
        const vChangedA = daltonState.syringeA.volume !== lastV_A;
        const vChangedB = daltonState.syringeB.volume !== lastV_B;
        if (vChangedA) {
            // Phase 5.3 정정: displayedVolume 즉시 동기 (gas 분기와 일관 — 박스 lerp 중 입자 깔림 방지)
            daltonState.syringeA.displayedVolume = daltonState.syringeA.volume;
            rebuildParticleSystem("A");
            lastV_A = daltonState.syringeA.volume;
        }
        if (vChangedB) {
            daltonState.syringeB.displayedVolume = daltonState.syringeB.volume;
            rebuildParticleSystem("B");
            lastV_B = daltonState.syringeB.volume;
        }

        // V 변경 시 targetVolume 도 갱신 (매 frame lerpDisplayedVolumes 로 부드럽게 도달)
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
        // Phase 5.9: Vernier 모드는 학생이 실물 plunger 를 누름 → 자동 주입 애니메이션 비활성
        if (daltonSensorManager.mode === "vernier") return;
        // async 반환값은 무시 (fire-and-forget). 내부에서 abort 플래그로 흐름 제어.
        startInjection();
    });
    dom.btnConfirm?.addEventListener("click", () => {
        confirmMeasurement();
    });
    // Phase 5.9: Vernier 모드 측정 버튼 — 단계별 분기
    dom.btnVernierMeasure?.addEventListener("click", () => {
        if (daltonSensorManager.mode !== "vernier") return;
        const stage = daltonState.vernier.stage;
        if (stage === "IDLE") {
            // 1번째 캡처: 결합 시스템 초기 압력 (대기압)
            daltonState.vernier.P_initial_kPa = daltonState.emaP_B_kPa;
            console.log(`[Vernier] P_initial captured: ${daltonState.vernier.P_initial_kPa.toFixed(2)} kPa`);
            setVernierStage("INJECTING");
        } else if (stage === "READY_TO_CAPTURE") {
            // 2번째 캡처: 평형 압력 P_total
            daltonState.vernier.P_total_kPa = daltonState.emaP_B_kPa;
            console.log(`[Vernier] P_total captured: ${daltonState.vernier.P_total_kPa.toFixed(2)} kPa`);
            setVernierStage("CAPTURED");
        }
        // 다른 stage 에선 버튼이 disabled 라 도달 안 함 (방어).
    });
    dom.btnReset?.addEventListener("click", () => {
        resetExperiment();
    });
    // Step G: CSV 다운로드 버튼
    dom.btnCsv?.addEventListener("click", exportRecordsCSV);

    // Step C-3 v15: 부분 압력 라인 안 체크박스 change → 가스 가시성 토글
    if (dom.partialPressureList) {
        dom.partialPressureList.addEventListener("change", (event) => {
            const checkbox = event.target.closest(".dalton-partial-pressure-checkbox");
            if (!checkbox) return;
            const gasKey = checkbox.dataset.gas;
            if (!gasKey) return;
            if (!daltonState.gasVisibility) daltonState.gasVisibility = {};
            daltonState.gasVisibility[gasKey] = checkbox.checked;
            updatePartialPressureList();
        });
    }

    // Phase 5.3 기능 4: 비교 모드 — tbody 의 체크박스 change delegation 등록 (init 1회)
    setupComparisonHandler();

    // Phase 5.4: 측정 기록 행 삭제 핸들러 (init 1회)
    setupRecordDeleteHandler();

    // Phase 5.7 트랙 6-c: AI 튜터 — createTutor(daltonConfig) wrapper
    initDaltonTutor();

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

    // Step F: 그래프 sketch 부착 (noLoop, addRecord 시 redraw)
    const chartParent = document.getElementById("dalton-chart-wrap");
    if (chartParent) {
        daltonChartP5Instance = new p5(daltonChartSketch, chartParent);
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
