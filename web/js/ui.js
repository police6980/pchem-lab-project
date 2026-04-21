// Numeric panel, record button, measurement popup, data table

function createDevPressureSlider(onChange) {
    const container = document.createElement("div");
    container.id = "dev-pressure-slider";

    const label = document.createElement("label");
    label.textContent = "[DEV MODE] 압력:";
    label.htmlFor = "dev-pressure-range";

    const sliderWrap = document.createElement("div");
    sliderWrap.className = "slider-wrap";

    const input = document.createElement("input");
    input.type = "range";
    input.id = "dev-pressure-range";
    input.min = "81";
    input.max = "230";
    input.step = "0.1";
    input.value = "101.3";

    const rangeHint = document.createElement("div");
    rangeHint.className = "range-hint";
    rangeHint.textContent = "81 ~ 230 kPa";

    sliderWrap.appendChild(input);
    sliderWrap.appendChild(rangeHint);

    const valueDisplay = document.createElement("span");
    valueDisplay.className = "dev-pressure-value";
    valueDisplay.textContent = `${parseFloat(input.value).toFixed(1)} kPa`;

    input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        valueDisplay.textContent = `${v.toFixed(1)} kPa`;
        onChange(v);
    });

    container.appendChild(label);
    container.appendChild(sliderWrap);
    container.appendChild(valueDisplay);
    document.querySelector(".control-row-actuators").appendChild(container);

    return container;
}

function createInfoPanel() {
    const panel = document.createElement("div");
    panel.id = "info-panel";

    const measured = document.createElement("div");
    measured.className = "info-section";
    measured.innerHTML = `
        <div class="info-section-title">실측</div>
        <div class="info-row"><span class="info-label">온도</span><span class="info-value" id="info-temp">—</span></div>
        <div class="info-row"><span class="info-label">압력</span><span class="info-value" id="info-pressure">—</span></div>
    `;

    const simulated = document.createElement("div");
    simulated.className = "info-section";
    simulated.innerHTML = `
        <div class="info-section-title">시뮬레이션</div>
        <div class="info-row"><span class="info-label">평균 속도</span><span class="info-value" id="info-speed">—</span></div>
        <div class="info-row"><span class="info-label">피스톤 충돌</span><span class="info-value" id="info-hits">측정 중...</span></div>
        <div class="info-row"><span class="info-label">평균 운동에너지</span><span class="info-value" id="info-kinetic">—</span></div>
    `;

    panel.appendChild(measured);
    panel.appendChild(simulated);
    document.getElementById("info-panel-area").appendChild(panel);

    return panel;
}

function formatValueWithUnit(value, digits, unit) {
    const formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
    return `${formatted} <span class="info-unit">${unit}</span>`;
}

function updateInfoPanel(data) {
    if (data.temp_K !== undefined) {
        const celsius = (data.temp_K - 273.15).toFixed(0);
        document.getElementById("info-temp").innerHTML =
            `${data.temp_K.toFixed(0)} <span class="info-unit">K</span>` +
            ` <span class="info-unit">(${celsius}°C)</span>`;
    }
    if (data.pressure_kPa !== undefined) {
        document.getElementById("info-pressure").innerHTML =
            formatValueWithUnit(data.pressure_kPa, 1, "kPa");
    }
    if (data.avgSpeed !== undefined) {
        if (data.avgSpeedTheory !== undefined) {
            document.getElementById("info-speed").innerHTML =
                `${data.avgSpeed.toFixed(0)} <span class="info-unit">px/s</span>` +
                ` <span class="info-unit">(이론 ~${data.avgSpeedTheory.toFixed(0)})</span>`;
        } else {
            document.getElementById("info-speed").innerHTML =
                formatValueWithUnit(data.avgSpeed, 0, "px/s");
        }
    }
    if (data.hitsPerSec !== undefined) {
        document.getElementById("info-hits").innerHTML =
            formatValueWithUnit(data.hitsPerSec, 0, "회/초");
    }
    if (data.kineticEnergy !== undefined) {
        if (data.kineticEnergyTheory !== undefined) {
            document.getElementById("info-kinetic").innerHTML =
                `${data.kineticEnergy.toLocaleString("en-US", { maximumFractionDigits: 0 })} <span class="info-unit">a.u.</span>` +
                ` <span class="info-unit">(이론 ~${data.kineticEnergyTheory.toLocaleString("en-US", { maximumFractionDigits: 0 })})</span>`;
        } else {
            document.getElementById("info-kinetic").innerHTML =
                formatValueWithUnit(data.kineticEnergy, 0, "a.u.");
        }
    }
}

function createMeasurementPanel({
    getP, getGasWidth, pixelsToML,
    setSessionStart, getSessionStart,
    getCurrentTempKelvin,
    exportContinuousCSV, getContinuousBufferSize, clearContinuousBuffer, resetSession,
    onDataChange, onResetAll,
}) {
    const readingBlock = document.createElement("div");
    readingBlock.id = "current-reading-block";
    readingBlock.innerHTML = `
        <span class="reading-group">
            <span class="reading-label">P</span>
            <span id="current-p" class="reading-value">—</span>
            <span class="reading-unit">kPa</span>
        </span>
        <span class="reading-group">
            <span class="reading-label">V</span>
            <input id="current-v" class="reading-input" type="number" step="0.1">
            <span class="reading-unit">mL</span>
        </span>
        <button id="btn-record">기록</button>
        <span id="btn-record-hint" class="record-hint">값 안정화 중…</span>
    `;
    document.querySelector(".control-row-actuators").appendChild(readingBlock);

    const panel = document.createElement("div");
    panel.id = "measurement-panel";
    panel.innerHTML = `
        <div class="section-head">
            <span class="section-title">측정 기록</span>
            <div class="section-actions">
                <button id="btn-export-measurements" disabled title="측정점을 먼저 기록하세요">측정점 CSV 저장</button>
                <button id="btn-export-continuous" disabled title="세션 시작 후 이용 가능">연속 로그 CSV 저장</button>
                <button id="btn-clear-all">전체 삭제</button>
            </div>
        </div>
        <table id="datapoints-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th class="num-col">P (kPa)</th>
                    <th class="num-col">V (mL)</th>
                    <th class="num-col">P·V</th>
                    <th></th>
                </tr>
            </thead>
            <tbody id="datapoints-tbody"></tbody>
        </table>
        <div id="measurement-summary" class="summary">측정점을 2개 이상 기록하세요</div>
    `;
    document.getElementById("section-measurements").appendChild(panel);

    const plotArea = document.createElement("div");
    plotArea.id = "pv-plot-area";
    plotArea.innerHTML = `
        <div class="plot-toggles">
            <label><input type="checkbox" id="toggle-connect-line"> 연결선</label>
            <label><input type="checkbox" id="toggle-theory-curve" disabled> 이론 곡선 (P·V = 일정)</label>
        </div>
        <div id="pv-plot-canvas-wrap"></div>
    `;
    document.getElementById("section-measurements").appendChild(plotArea);

    const vInput = document.getElementById("current-v");
    const currentPEl = document.getElementById("current-p");
    const tbody = document.getElementById("datapoints-tbody");
    const summary = document.getElementById("measurement-summary");

    let datapoints = [];
    let nextPointId = 1;
    let studentEdited = false;

    // Student input marks the field as owned by the student; auto-track pauses
    // until the next record or explicit reset. Blur alone does NOT re-enable
    // auto-track, so an accidental focus-then-click-away won't overwrite the
    // student's value.
    vInput.addEventListener("input", () => { studentEdited = true; });

    // === Stabilization detection ===
    const STABILIZATION_WINDOW = 20;          // 50ms × 20 = 1s
    const STABILIZATION_THRESHOLD = 0.005;    // 0.5%
    const pHistory = [];
    const widthHistory = [];
    let isStabilized = false;

    const sliderInput = document.getElementById("dev-pressure-range");
    if (sliderInput) {
        sliderInput.addEventListener("input", () => {
            pHistory.length = 0;
            widthHistory.length = 0;
            isStabilized = false;
        });
    }

    function pushSampleHistory() {
        pHistory.push(getP());
        widthHistory.push(getGasWidth());
        if (pHistory.length > STABILIZATION_WINDOW) pHistory.shift();
        if (widthHistory.length > STABILIZATION_WINDOW) widthHistory.shift();
    }

    function checkStabilized() {
        if (pHistory.length < STABILIZATION_WINDOW) return false;
        const pNow = pHistory[pHistory.length - 1];
        const pThen = pHistory[0];
        const wNow = widthHistory[widthHistory.length - 1];
        const wThen = widthHistory[0];
        if (pNow === 0 || wNow === 0) return false;
        const pRel = Math.abs(pNow - pThen) / pNow;
        const wRel = Math.abs(wNow - wThen) / wNow;
        return pRel < STABILIZATION_THRESHOLD && wRel < STABILIZATION_THRESHOLD;
    }

    function updateRecordButtonState() {
        const btn = document.getElementById("btn-record");
        const hint = document.getElementById("btn-record-hint");
        btn.disabled = !isStabilized;
        hint.style.visibility = isStabilized ? "hidden" : "visible";
    }

    // === PV scatter plot ===
    const PV_CANVAS_WIDTH = 380;
    const PV_CANVAS_HEIGHT = 280;
    const PV_MARGIN_LEFT = 48;
    const PV_MARGIN_RIGHT = 16;
    const PV_MARGIN_TOP = 16;
    const PV_MARGIN_BOTTOM = 36;
    const PV_X_MIN = 0;
    const PV_X_MAX = 60;
    const PV_Y_MIN = 60;
    const PV_Y_MAX = 250;
    const PV_INNER_LEFT = PV_MARGIN_LEFT;
    const PV_INNER_RIGHT = PV_CANVAS_WIDTH - PV_MARGIN_RIGHT;
    const PV_INNER_TOP = PV_MARGIN_TOP;
    const PV_INNER_BOTTOM = PV_CANVAS_HEIGHT - PV_MARGIN_BOTTOM;

    const pvX = (V) => PV_INNER_LEFT + (V - PV_X_MIN) / (PV_X_MAX - PV_X_MIN) * (PV_INNER_RIGHT - PV_INNER_LEFT);
    const pvY = (P) => PV_INNER_BOTTOM - (P - PV_Y_MIN) / (PV_Y_MAX - PV_Y_MIN) * (PV_INNER_BOTTOM - PV_INNER_TOP);

    let showConnectLine = false;
    let showTheoryCurve = false;

    const pvSketch = (p) => {
        p.setup = () => {
            p.createCanvas(PV_CANVAS_WIDTH, PV_CANVAS_HEIGHT);
            p.noLoop();
        };
        p.draw = () => {
            p.background(253);

            p.stroke(230);
            p.strokeWeight(1);
            for (let v = 10; v <= 60; v += 10) {
                p.line(pvX(v), pvY(PV_Y_MIN), pvX(v), pvY(PV_Y_MAX));
            }
            for (let q = 100; q <= 250; q += 50) {
                p.line(pvX(PV_X_MIN), pvY(q), pvX(PV_X_MAX), pvY(q));
            }

            p.stroke(80);
            p.strokeWeight(1);
            p.line(pvX(PV_X_MIN), pvY(PV_Y_MIN), pvX(PV_X_MIN), pvY(PV_Y_MAX));
            p.line(pvX(PV_X_MIN), pvY(PV_Y_MIN), pvX(PV_X_MAX), pvY(PV_Y_MIN));

            p.noStroke();
            p.fill(120);
            p.textSize(10);
            p.textAlign(p.CENTER, p.TOP);
            for (let v = 0; v <= 60; v += 10) p.text(v, pvX(v), pvY(PV_Y_MIN) + 4);
            p.textAlign(p.RIGHT, p.CENTER);
            for (let q = 100; q <= 250; q += 50) p.text(q, pvX(PV_X_MIN) - 5, pvY(q));

            p.fill(80);
            p.textSize(11);
            p.textAlign(p.CENTER, p.CENTER);
            p.text("V (mL)", (pvX(PV_X_MIN) + pvX(PV_X_MAX)) / 2, PV_CANVAS_HEIGHT - 14);
            p.push();
            p.translate(14, (pvY(PV_Y_MIN) + pvY(PV_Y_MAX)) / 2);
            p.rotate(-Math.PI / 2);
            p.text("P (kPa)", 0, 0);
            p.pop();

            if (datapoints.length === 0) {
                p.fill(160);
                p.textSize(12);
                p.textAlign(p.CENTER, p.CENTER);
                p.text("[기록] 버튼을 눌러\n측정점을 추가하세요",
                    (pvX(PV_X_MIN) + pvX(PV_X_MAX)) / 2,
                    (pvY(PV_Y_MIN) + pvY(PV_Y_MAX)) / 2);
                return;
            }

            if (showTheoryCurve && datapoints.length >= 2) {
                const k = datapoints.reduce((s, d) => s + d.P * d.V, 0) / datapoints.length;
                p.noFill();
                p.stroke(230, 100, 60, 150);
                p.strokeWeight(1);
                let inShape = false;
                for (let V = 0.5; V <= 60; V += 0.5) {
                    const P = k / V;
                    const inRange = P >= PV_Y_MIN && P <= PV_Y_MAX;
                    if (inRange) {
                        if (!inShape) { p.beginShape(); inShape = true; }
                        p.vertex(pvX(V), pvY(P));
                    } else if (inShape) {
                        p.endShape();
                        inShape = false;
                    }
                }
                if (inShape) p.endShape();
            }

            if (showConnectLine && datapoints.length >= 2) {
                const sorted = [...datapoints].sort((a, b) => a.V - b.V);
                p.noFill();
                p.stroke(100);
                p.strokeWeight(1.5);
                p.beginShape();
                for (const d of sorted) p.vertex(pvX(d.V), pvY(d.P));
                p.endShape();
            }

            p.textSize(9);
            for (const d of datapoints) {
                if (d.V < PV_X_MIN || d.V > PV_X_MAX) continue;
                if (d.P < PV_Y_MIN || d.P > PV_Y_MAX) continue;
                const px = pvX(d.V);
                const py = pvY(d.P);
                p.strokeWeight(1.5);
                p.stroke(40, 80, 180);
                p.fill(150, 190, 240);
                p.circle(px, py, 10);
                p.noStroke();
                p.fill(60);
                p.textAlign(p.LEFT, p.BOTTOM);
                p.text(d.id, px + 7, py - 5);
            }
        };
    };

    const pvP5Instance = new p5(pvSketch, document.getElementById("pv-plot-canvas-wrap"));

    function redrawPVPlot() {
        const cb = document.getElementById("toggle-theory-curve");
        if (datapoints.length < 2) {
            cb.disabled = true;
            if (cb.checked) { cb.checked = false; showTheoryCurve = false; }
        } else {
            cb.disabled = false;
        }
        pvP5Instance.redraw();
    }

    document.getElementById("toggle-connect-line").addEventListener("change", (e) => {
        showConnectLine = e.target.checked;
        redrawPVPlot();
    });
    document.getElementById("toggle-theory-curve").addEventListener("change", (e) => {
        showTheoryCurve = e.target.checked;
        redrawPVPlot();
    });

    // Initial draw so the empty state message is visible before any event.
    redrawPVPlot();

    function renderTable() {
        tbody.innerHTML = datapoints.map(d => `
            <tr>
                <td>${d.id}</td>
                <td class="num">${d.P.toFixed(1)}</td>
                <td class="num">${d.V.toFixed(1)}</td>
                <td class="num pv">${d.PV.toFixed(1)}</td>
                <td><button class="btn-delete" data-id="${d.id}">×</button></td>
            </tr>
        `).join("");
        tbody.querySelectorAll(".btn-delete").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.dataset.id, 10);
                datapoints = datapoints.filter(d => d.id !== id);
                renderTable();
                renderSummary();
                redrawPVPlot();
                updateExportButtonState();
                onDataChange && onDataChange();
            });
        });
    }

    function renderSummary() {
        if (datapoints.length < 2) {
            summary.textContent = "측정점을 2개 이상 기록하세요";
            return;
        }
        const meanPV = datapoints.reduce((s, d) => s + d.PV, 0) / datapoints.length;
        const maxDev = Math.max(...datapoints.map(d => Math.abs(d.PV - meanPV))) / meanPV * 100;
        summary.innerHTML =
            `측정점 <strong>${datapoints.length}개</strong>` +
            ` · 평균 P·V = <strong>${meanPV.toFixed(1)}</strong>` +
            ` · 편차 ±<strong>${maxDev.toFixed(1)}%</strong>`;
    }

    document.getElementById("btn-record").addEventListener("click", () => {
        if (!isStabilized) return;
        setSessionStart();

        // P: 1-second moving average. Smoothes sensor noise + guarantees the
        // pressure reading matches what the simulation settled on.
        const P = pHistory.reduce((s, v) => s + v, 0) / pHistory.length;

        // V: student override wins; otherwise average the piston position
        // (box.width) over the same window for phase consistency with P.
        let V;
        if (studentEdited) {
            V = parseFloat(vInput.value);
        } else {
            const avgWidth = widthHistory.reduce((s, v) => s + v, 0) / widthHistory.length;
            V = pixelsToML(avgWidth);
        }
        if (!isFinite(V)) return;

        datapoints.push({
            id: nextPointId++,
            P, V, PV: P * V,
            timestamp: Date.now(),
            tempK: getCurrentTempKelvin(),
        });
        renderTable();
        renderSummary();
        redrawPVPlot();
        updateExportButtonState();
        onDataChange && onDataChange();
        studentEdited = false;
    });

    document.getElementById("btn-clear-all").addEventListener("click", () => {
        const datapointsEmpty = datapoints.length === 0;
        const continuousEmpty = getContinuousBufferSize() === 0;
        if (datapointsEmpty && continuousEmpty) return;
        if (!window.confirm("측정점과 세션 로그를 모두 삭제합니다. 이미 다운로드한 파일은 영향 없습니다. 계속?")) return;
        datapoints = [];
        clearContinuousBuffer();
        resetSession();
        renderTable();
        renderSummary();
        redrawPVPlot();
        updateExportButtonState();
        onDataChange && onDataChange();
        onResetAll && onResetAll();
    });

    const exportMeasBtn = document.getElementById("btn-export-measurements");
    const exportContBtn = document.getElementById("btn-export-continuous");

    function updateExportButtonState() {
        exportMeasBtn.disabled = datapoints.length === 0;
        exportMeasBtn.title = datapoints.length === 0 ? "측정점을 먼저 기록하세요" : "";
        const contSize = getContinuousBufferSize();
        exportContBtn.disabled = contSize === 0;
        exportContBtn.title = contSize === 0 ? "세션 시작 후 이용 가능" : "";
    }

    function exportMeasurementsCSV() {
        if (datapoints.length === 0) return;
        const sessionStart = getSessionStart();
        const sessionIso = sessionStart !== null ? new Date(sessionStart).toISOString() : "";
        const headers = ["번호", "압력_kPa", "부피_mL", "P·V", "기록시각_ms", "세션시작시각_iso", "온도_K"];
        const rows = datapoints.map(d => [
            d.id,
            d.P.toFixed(1),
            d.V.toFixed(1),
            d.PV.toFixed(1),
            sessionStart !== null ? (d.timestamp - sessionStart) : "",
            sessionIso,
            d.tempK.toFixed(2),
        ]);
        const filename = `boyle_measurements_${formatTimestampForFilename(new Date())}.csv`;
        downloadCSV(filename, headers, rows);
    }

    exportMeasBtn.addEventListener("click", exportMeasurementsCSV);
    exportContBtn.addEventListener("click", exportContinuousCSV);

    vInput.value = pixelsToML(getGasWidth()).toFixed(1);
    currentPEl.textContent = getP().toFixed(1);

    setInterval(() => {
        currentPEl.textContent = getP().toFixed(1);
        if (!studentEdited) {
            vInput.value = pixelsToML(getGasWidth()).toFixed(1);
        }
        pushSampleHistory();
        isStabilized = checkStabilized();
        updateRecordButtonState();
        updateExportButtonState();
    }, 50);

    // === Dev helper: PV accuracy regression test ===
    // window.runPVAccuracyTest() from the browser console.
    async function runPVAccuracyTest() {
        const slider = document.getElementById("dev-pressure-range");
        const btn = document.getElementById("btn-record");
        if (!slider || !btn) {
            console.error("[PV test] Slider or record button not found");
            return;
        }

        const testPressures = [81, 100, 130, 160, 190, 220];
        const testIds = [];
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        console.log(`[PV test] Starting. Test pressures: ${testPressures.join(", ")} kPa`);

        for (const p of testPressures) {
            slider.value = String(p);
            slider.dispatchEvent(new Event("input"));

            const t0 = Date.now();
            while (btn.disabled && (Date.now() - t0) < 10000) {
                await sleep(100);
            }
            if (btn.disabled) {
                console.error(`[PV test] Stabilization timeout at ${p} kPa`);
                return;
            }

            const beforeLen = datapoints.length;
            btn.click();
            await sleep(60);
            if (datapoints.length !== beforeLen + 1) {
                console.error(`[PV test] Record failed at ${p} kPa`);
                return;
            }
            const last = datapoints[datapoints.length - 1];
            testIds.push(last.id);
            console.log(
                `[PV test] slider=${p} kPa → ` +
                `P=${last.P.toFixed(2)}, V=${last.V.toFixed(2)}, PV=${last.PV.toFixed(1)}`
            );
        }

        const testData = datapoints.filter(d => testIds.includes(d.id));
        const meanPV = testData.reduce((s, d) => s + d.PV, 0) / testData.length;
        const maxDevPct = Math.max(...testData.map(d => Math.abs(d.PV - meanPV))) / meanPV * 100;

        console.log(`[PV test] Mean PV = ${meanPV.toFixed(1)} · max deviation = ${maxDevPct.toFixed(2)}%`);
        if (maxDevPct > 2) {
            console.error(`[PV test] FAIL — deviation exceeds 2% threshold`);
        } else {
            console.log(`[PV test] PASS — within 2%`);
        }
    }

    window.runPVAccuracyTest = runPVAccuracyTest;

    return {
        getStabilized: () => isStabilized,
        getMeasurementCount: () => datapoints.length,
        getDatapoints: () => datapoints.slice(),
        clearMeasurements: () => {
            datapoints = [];
            renderTable();
            renderSummary();
            redrawPVPlot();
            updateExportButtonState();
            onDataChange && onDataChange();
        },
    };
}

function createTemperatureControl({
    getCurrentCelsius, getMeasurementCount, getContinuousBufferSize, onCommit,
}) {
    const container = document.createElement("div");
    container.id = "temperature-control";
    container.innerHTML = `
        <span class="temp-label">온도:</span>
        <div class="temp-presets">
            <button data-celsius="0">0°C</button>
            <button data-celsius="25">25°C</button>
            <button data-celsius="50">50°C</button>
            <button data-celsius="77">77°C</button>
        </div>
        <div class="temp-custom">
            <input type="number" id="temp-custom-input" min="0" max="77" step="1" placeholder="°C">
            <button id="btn-temp-set" disabled>설정</button>
        </div>
        <span class="temp-current">현재: <strong id="temp-current-celsius">—</strong>°C / <strong id="temp-current-kelvin">—</strong>K</span>
        <span class="temp-feedback" id="temp-feedback"></span>
    `;
    document.querySelector(".control-row-temperature").appendChild(container);

    const customInput = document.getElementById("temp-custom-input");
    const setBtn = document.getElementById("btn-temp-set");
    const currCelEl = document.getElementById("temp-current-celsius");
    const currKelEl = document.getElementById("temp-current-kelvin");
    const feedbackEl = document.getElementById("temp-feedback");
    const presetBtns = container.querySelectorAll(".temp-presets button");

    function refreshCurrentDisplay() {
        const c = getCurrentCelsius();
        currCelEl.textContent = c.toFixed(0);
        currKelEl.textContent = (c + 273.15).toFixed(0);
        presetBtns.forEach(btn => {
            const preset = parseFloat(btn.dataset.celsius);
            btn.classList.toggle("active", Math.abs(preset - c) < 0.5);
        });
    }

    function validateCustom() {
        const val = parseFloat(customInput.value);
        const empty = customInput.value === "";
        const valid = !isNaN(val) && val >= 0 && val <= 77;
        customInput.classList.toggle("invalid", !empty && !valid);
        setBtn.disabled = !valid;
        return valid ? val : null;
    }

    let feedbackTimer = null;
    function showFeedback(celsius) {
        const k = celsius + 273.15;
        feedbackEl.textContent = `온도 설정: ${celsius.toFixed(0)}°C (${k.toFixed(0)}K)`;
        feedbackEl.classList.add("visible");
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => feedbackEl.classList.remove("visible"), 2000);
    }

    function requestChange(newCelsius) {
        const current = getCurrentCelsius();
        if (Math.abs(newCelsius - current) < 0.1) return;

        const mCount = getMeasurementCount();
        const contSize = getContinuousBufferSize();
        const hasData = mCount > 0 || contSize > 0;

        if (hasData) {
            const msg =
                `온도를 ${current.toFixed(0)}°C에서 ${newCelsius.toFixed(0)}°C로 변경합니다.\n` +
                `기존 측정점 ${mCount}개와 세션 로그가 삭제됩니다.\n` +
                `이미 저장한 CSV 파일은 영향 없습니다.\n계속하시겠습니까?`;
            if (!window.confirm(msg)) return;
        }

        onCommit(newCelsius);
        refreshCurrentDisplay();
        showFeedback(newCelsius);
    }

    presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            requestChange(parseFloat(btn.dataset.celsius));
        });
    });

    customInput.addEventListener("input", validateCustom);
    customInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = validateCustom();
            if (val !== null) setBtn.click();
        }
    });

    setBtn.addEventListener("click", () => {
        const val = validateCustom();
        if (val === null) return;
        requestChange(val);
        customInput.value = "";
        validateCustom();
    });

    refreshCurrentDisplay();
}

function createAnalysisPanel({
    getDatapoints,
    getCurrentTempCelsius,
    getCurrentTempKelvin,
    getSessionStart,
}) {
    const section = document.getElementById("section-analysis");
    section.innerHTML = `
        <h2>📊 실험 분석</h2>
        <div class="analysis-summary">
            <h3>이번 세션 요약</h3>
            <dl>
                <dt>온도</dt>           <dd><span id="analysis-temp">—</span></dd>
                <dt>측정점 개수</dt>      <dd><span id="analysis-count">—</span></dd>
                <dt>평균 P·V</dt>         <dd><span id="analysis-meanpv">—</span></dd>
                <dt>최대 편차</dt>        <dd><span id="analysis-maxdev">—</span></dd>
                <dt>기록 소요 시간</dt>    <dd><span id="analysis-duration">—</span></dd>
            </dl>
        </div>
        <div class="analysis-verification">
            <h3>🔬 보일 법칙 검증</h3>
            <p class="verdict" id="analysis-verdict">—</p>
            <div id="pv-bars-canvas-wrap"></div>
        </div>
        <div class="analysis-export">
            <button id="btn-export-analysis">분석 보고서 저장</button>
        </div>
    `;

    const MIN_DATAPOINTS = 3;
    const PV_BARS_WIDTH = 400;
    const PV_BARS_HEIGHT = 180;
    const PV_BARS_PAD = { left: 40, right: 10, top: 20, bottom: 30 };

    // === AI tutor constants ===
    const SESSION_KEY_API = "pchem_api_key";
    const SESSION_KEY_LEVEL = "pchem_ai_level";
    const SESSION_KEY_MODEL = "pchem_ai_model";

    // Prices confirmed 2026-04 against platform.claude.com/docs pricing.
    // Opus 4.7 is $5/$25 per MTok (not $15/$75 of the older generation).
    const MODEL_PRICING = {
        "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
        "claude-opus-4-7":   { inputPerMTok: 5, outputPerMTok: 25 },
    };
    const USD_TO_KRW = 1400;

    let apiKey = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const LEVEL_GUIDES = {
        middle: "중학교 2-3학년 영재학급 학생. 기본 분자 운동론은 알지만 깊은 통계역학은 모름. 친근한 톤, 어려운 용어 설명 동반.",
        high: "고등학교 영재학급 학생. 이상기체 상태방정식, 간단한 통계역학 개념 가능. 과학적 엄밀성 유지하되 학생 사고를 존중.",
        univ: "대학교 일반화학/물리화학 초기 학생. 맥스웰-볼츠만 분포, 반데르발스 방정식 수준 개념 사용 가능.",
    };

    const QUESTION_FOCUS = {
        1: "Q1은 거시 관찰(P·V 일정)을 미시 메커니즘(입자 운동)으로 설명하도록 유도. 학생 답변이 피상적이면 '입자가 벽에 부딪히는 빈도·강도'와 '부피 변화의 관계' 방향으로 질문으로 확장.",
        2: "Q2는 관찰한 규칙을 극단 조건에 외삽하도록 유도. 이상기체와 실제 기체의 차이(반데르발스 편차) 언급 가능. 학생이 단순 계산만 했으면 '모델의 한계'로 사고 확장 유도.",
        3: "Q3는 다음 실험 설계. 학생이 제안한 조건의 과학적 의미를 확장. 샤를 법칙, 게이뤼삭 법칙, 이상기체 법칙 등 관련 개념 자연스럽게 소개 가능.",
    };

    const QUESTION_TEXT = {
        1: "측정점마다 P·V 값이 거의 일정하게 나왔습니다. 이런 관계가 성립하는 이유를 기체 입자의 움직임으로 설명해보세요.",
        2: "만약 압력을 400 kPa까지 올려 측정하면 부피는 어떻게 될지 예측해보세요. 이런 극단적 조건에서도 같은 규칙이 성립할까요? 그 이유는?",
        3: "다음 실험에서 바꿔보고 싶은 조건이 있다면 무엇인가요?",
    };

    function formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        if (totalSec < 60) return `${totalSec}초`;
        const minutes = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return `${minutes}분 ${secs}초`;
    }

    function computeVerdict(maxDevPct) {
        if (maxDevPct <= 2) {
            return { cls: "good", text: `✓ 보일 법칙 성립 (편차 ${maxDevPct.toFixed(1)}%, 훌륭한 측정)` };
        } else if (maxDevPct <= 5) {
            return { cls: "good", text: `✓ 보일 법칙 성립 (편차 ${maxDevPct.toFixed(1)}%, 적절한 측정)` };
        } else if (maxDevPct <= 10) {
            return { cls: "warn", text: `△ 부분적으로 성립 (편차 ${maxDevPct.toFixed(1)}%, 일부 측정점 재검토 필요)` };
        } else {
            return { cls: "bad", text: `✗ 편차 큼 (편차 ${maxDevPct.toFixed(1)}%, 안정화 대기 후 재측정 권장)` };
        }
    }

    const pvBarsSketch = (p) => {
        p.setup = () => {
            p.createCanvas(PV_BARS_WIDTH, PV_BARS_HEIGHT);
            p.textFont("system-ui");
            p.noLoop();
        };

        p.draw = () => {
            p.background(255);
            const data = getDatapoints();
            if (data.length < MIN_DATAPOINTS) return;

            const innerLeft = PV_BARS_PAD.left;
            const innerRight = p.width - PV_BARS_PAD.right;
            const innerTop = PV_BARS_PAD.top;
            const innerBottom = p.height - PV_BARS_PAD.bottom;

            const mean = data.reduce((s, d) => s + d.PV, 0) / data.length;
            const maxAbsDev = Math.max(...data.map(d => Math.abs(d.PV - mean)));
            const span = Math.max(maxAbsDev * 1.2, mean * 0.01);
            const yMin = mean - span;
            const yMax = mean + span;

            const yToPx = (v) =>
                innerBottom - (v - yMin) / (yMax - yMin) * (innerBottom - innerTop);

            p.stroke(120);
            p.strokeWeight(1);
            p.line(innerLeft, innerTop, innerLeft, innerBottom);
            p.line(innerLeft, innerBottom, innerRight, innerBottom);

            p.noStroke();
            p.fill(120);
            p.textSize(9);
            p.textAlign(p.RIGHT, p.CENTER);
            [yMin, mean, yMax].forEach(v => {
                p.text(v.toFixed(0), innerLeft - 4, yToPx(v));
            });

            const meanY = yToPx(mean);
            p.stroke(170);
            p.strokeWeight(1);
            p.drawingContext.setLineDash([4, 3]);
            p.line(innerLeft, meanY, innerRight, meanY);
            p.drawingContext.setLineDash([]);
            p.noStroke();
            p.fill(130);
            p.textSize(9);
            p.textAlign(p.LEFT, p.BOTTOM);
            p.text(`평균 ${mean.toFixed(1)}`, innerLeft + 4, meanY - 2);

            const slotWidth = (innerRight - innerLeft) / data.length;
            const barWidth = slotWidth * 0.7;

            data.forEach((d, i) => {
                const devPct = mean > 0 ? Math.abs(d.PV - mean) / mean * 100 : 0;
                let fill;
                if (devPct <= 2) fill = [76, 175, 80];
                else if (devPct <= 5) fill = [255, 152, 0];
                else fill = [231, 76, 60];

                const barX = innerLeft + i * slotWidth + (slotWidth - barWidth) / 2;
                const valueY = yToPx(d.PV);

                p.noStroke();
                p.fill(fill[0], fill[1], fill[2]);
                p.rect(barX, valueY, barWidth, innerBottom - valueY);

                p.fill(80);
                p.textAlign(p.CENTER, p.BOTTOM);
                p.textSize(9);
                p.text(d.PV.toFixed(0), barX + barWidth / 2, valueY - 2);

                p.fill(130);
                p.textAlign(p.CENTER, p.TOP);
                p.text(d.id, barX + barWidth / 2, innerBottom + 4);
            });

            p.fill(100);
            p.textAlign(p.CENTER, p.TOP);
            p.textSize(10);
            p.text("측정점 번호", (innerLeft + innerRight) / 2, innerBottom + 16);
        };
    };

    const pvBarsP5 = new p5(pvBarsSketch,
        document.getElementById("pv-bars-canvas-wrap"));

    function refresh() {
        const data = getDatapoints();
        if (typeof updateTabAvailability === "function") {
            updateTabAvailability(data.length);
        }
        if (data.length < MIN_DATAPOINTS) {
            section.classList.add("hidden");
            return;
        }
        section.classList.remove("hidden");

        const meanPV = data.reduce((s, d) => s + d.PV, 0) / data.length;
        const maxDevPct = Math.max(...data.map(d => Math.abs(d.PV - meanPV))) / meanPV * 100;
        const durationMs = data[data.length - 1].timestamp - data[0].timestamp;

        const celsius = getCurrentTempCelsius();
        const kelvin = getCurrentTempKelvin();

        document.getElementById("analysis-temp").textContent =
            `${celsius.toFixed(0)}°C (${kelvin.toFixed(0)} K)`;
        document.getElementById("analysis-count").textContent = `${data.length}개`;
        document.getElementById("analysis-meanpv").textContent =
            `${meanPV.toFixed(1)} kPa·mL`;
        document.getElementById("analysis-maxdev").textContent =
            `±${maxDevPct.toFixed(1)}%`;
        document.getElementById("analysis-duration").textContent =
            formatDuration(durationMs);

        const verdictEl = document.getElementById("analysis-verdict");
        verdictEl.classList.remove("good", "warn", "bad");
        const { cls, text } = computeVerdict(maxDevPct);
        verdictEl.classList.add(cls);
        verdictEl.textContent = text;

        pvBarsP5.redraw();
    }

    // === AI tutor helpers ===

    function maskKey(key) {
        if (!key || key.length < 24) return key;
        return key.slice(0, 20) + "..." + key.slice(-4);
    }

    function showKeyStatus(cls, text) {
        const el = document.getElementById("key-status");
        el.className = "key-status " + cls;
        el.textContent = text;
    }

    function computeCost(model, inputTokens, outputTokens) {
        const pricing = MODEL_PRICING[model];
        if (!pricing) return 0;
        const usd = (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1e6;
        return Math.round(usd * USD_TO_KRW);
    }

    function updateUsageDisplay() {
        document.getElementById("tokens-used").textContent =
            (totalInputTokens + totalOutputTokens).toLocaleString("en-US");
        const model = document.getElementById("ai-model").value;
        const cost = computeCost(model, totalInputTokens, totalOutputTokens);
        document.getElementById("cost-estimate").textContent = cost;
        if (typeof triggerCostWarning === "function") triggerCostWarning(cost);
    }

    function formatApiError(status, message) {
        switch (status) {
            case 401: return "API 키가 유효하지 않습니다. 다시 확인해주세요.";
            case 429: return "요청이 많습니다. 잠시 후 다시 시도해주세요.";
            case 529: return "서버가 혼잡합니다. 잠시 후 다시 시도해주세요.";
            case 0:   return "네트워크 연결을 확인해주세요.";
            default:  return `오류 ${status}: ${message}`;
        }
    }

    function loadAISettings() {
        const storedKey = sessionStorage.getItem(SESSION_KEY_API);
        if (storedKey) {
            apiKey = storedKey;
            const keyInput = document.getElementById("ai-api-key");
            keyInput.value = maskKey(storedKey);
            keyInput.dataset.masked = "true";
            showKeyStatus("saved", "✓ 저장됨 (재검증하려면 다시 누르세요)");
        }
        const storedLevel = sessionStorage.getItem(SESSION_KEY_LEVEL);
        if (storedLevel) document.getElementById("ai-student-level").value = storedLevel;
        const storedModel = sessionStorage.getItem(SESSION_KEY_MODEL);
        if (storedModel) document.getElementById("ai-model").value = storedModel;
    }

    async function verifyKey() {
        const keyInput = document.getElementById("ai-api-key");
        const rawValue = keyInput.dataset.masked === "true" ? apiKey : keyInput.value.trim();
        if (!rawValue || !rawValue.startsWith("sk-ant-")) {
            showKeyStatus("error", "✗ 키 형식이 올바르지 않습니다 (sk-ant-...으로 시작)");
            return;
        }
        showKeyStatus("verifying", "⋯ 검증 중…");
        try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": rawValue,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                    "anthropic-dangerous-direct-browser-access": "true",
                },
                body: JSON.stringify({
                    model: "claude-haiku-4-5",
                    max_tokens: 5,
                    messages: [{ role: "user", content: "hi" }],
                }),
            });
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                const msg = (data.error && data.error.message) || resp.statusText;
                showKeyStatus("error", `✗ ${formatApiError(resp.status, msg)}`);
                return;
            }
            apiKey = rawValue;
            sessionStorage.setItem(SESSION_KEY_API, rawValue);
            keyInput.value = maskKey(rawValue);
            keyInput.dataset.masked = "true";
            showKeyStatus("success", "✓ 검증됨");
            if (typeof updateInputAvailability === "function") updateInputAvailability();
        } catch (err) {
            showKeyStatus("error", `✗ ${formatApiError(0, err.message)}`);
        }
    }

    function clearKey() {
        apiKey = null;
        sessionStorage.removeItem(SESSION_KEY_API);
        const keyInput = document.getElementById("ai-api-key");
        keyInput.value = "";
        delete keyInput.dataset.masked;
        showKeyStatus("", "");
        if (typeof updateInputAvailability === "function") updateInputAvailability();
    }

    function buildDataContext() {
        const data = getDatapoints();
        const mean = data.reduce((s, d) => s + d.PV, 0) / data.length;
        const maxDevPct = Math.max(...data.map(d => Math.abs(d.PV - mean))) / mean * 100;
        return {
            tempC: getCurrentTempCelsius().toFixed(0),
            tempK: getCurrentTempKelvin().toFixed(2),
            N: data.length,
            meanPV: mean.toFixed(1),
            maxDev: maxDevPct.toFixed(1),
            points: data.map(d => ({
                num: d.id,
                P: d.P.toFixed(1),
                V: d.V.toFixed(1),
                PV: d.PV.toFixed(1),
            })),
        };
    }

    function buildSystemPrompt(level, questionNum) {
        const focusLine = questionNum === "free"
            ? `자유 질문 모드. 학생이 묻는 것에 직접 답해도 되지만, 답 뒤에 한 단계 더 깊은 탐구 방향을 한 문장 덧붙일 것. 오개념 발견 시 직접 교정하지 말고 실험으로 확인할 방법을 제시. 400자 이내.`
            : `현재 질문의 교육적 의도: ${QUESTION_FOCUS[questionNum]}`;

        return `당신은 영재 과학교육 튜터입니다.

대상 학생: ${LEVEL_GUIDES[level]}

현재 탐구 주제: 보일 법칙 (P·V = 일정, 등온 조건)
${focusLine}

절대 원칙:
1. 학생이 아직 생각하지 못한 답을 직접 알려주지 마세요. 학생의 답변을 인정하고 한 단계 더 깊은 질문을 던지세요.
2. 학생 답변의 구체적 표현을 인용하며 피드백하세요. 일반론 금지.
3. 학생 데이터의 구체 숫자를 언급하며 연결하세요.
4. 격려하되 과찬 금지. 틀린 부분은 명확히 짚되 비난 금지.
5. 250자 이내 (자유 모드는 400자 이내). 한 번의 피드백에 한 가지 핵심 확장만.
6. 마지막에 학생이 더 생각해볼 질문 1개 제시.
7. 대화형이므로 결론 짓지 말고 다음 생각으로 이어지는 질문으로 마무리.
8. 3~4턴 이상 진행 시 자연스럽게 학생이 답에 다가가도록 수렴.

한국어로 답변하세요.`;
    }

    function buildUserPrompt(questionNum, answer, ctx) {
        const pointsText = ctx.points.map(p =>
            `  ${p.num}번: P=${p.P}kPa, V=${p.V}mL, P·V=${p.PV}`
        ).join("\n");
        return `[실험 데이터]
온도: ${ctx.tempC}°C (${ctx.tempK}K)
측정점: ${ctx.N}개
평균 P·V: ${ctx.meanPV} kPa·mL
최대 편차: ${ctx.maxDev}%

측정점 상세:
${pointsText}

[질문]
${QUESTION_TEXT[questionNum]}

[학생 답변]
${answer}

위 학생 답변에 대해 영재 교육 튜터로서 피드백해주세요.`;
    }

    function buildAnalysisCSV() {
        const data = getDatapoints();
        if (data.length === 0) return null;

        const celsius = getCurrentTempCelsius();
        const kelvin = getCurrentTempKelvin();
        const mean = data.reduce((s, d) => s + d.PV, 0) / data.length;
        const maxDevPct = Math.max(...data.map(d => Math.abs(d.PV - mean))) / mean * 100;
        const durationMs = data[data.length - 1].timestamp - data[0].timestamp;
        const { text: verdict } = computeVerdict(maxDevPct);
        const sessionStart = getSessionStart();
        const sessionIso = sessionStart ? new Date(sessionStart).toISOString() : "";
        const nowIso = new Date().toISOString();

        const lines = [];
        lines.push("# 보일 법칙 실험 분석 보고서");
        lines.push(`# 저장 시각: ${nowIso}`);
        lines.push(`# 세션 시작: ${sessionIso}`);
        lines.push("");

        lines.push("# == 실험 조건 ==");
        lines.push("항목,값");
        lines.push(`온도_섭씨,${celsius.toFixed(1)}`);
        lines.push(`온도_켈빈,${kelvin.toFixed(2)}`);
        lines.push(`기준_압력_kPa,${REFERENCE_P_KPA.toFixed(1)}`);
        lines.push(`기준_부피_mL,${REFERENCE_V_ML.toFixed(1)}`);
        lines.push("");

        lines.push("# == 요약 통계 ==");
        lines.push("항목,값");
        lines.push(`측정점_개수,${data.length}`);
        lines.push(`평균_PV,${mean.toFixed(1)}`);
        lines.push(`최대_편차_퍼센트,${maxDevPct.toFixed(2)}`);
        lines.push(`기록_소요_시간_초,${Math.floor(durationMs / 1000)}`);
        lines.push(`법칙_검증_판정,${csvEscape(verdict)}`);
        lines.push("");

        lines.push("# == 측정점 ==");
        lines.push("번호,압력_kPa,부피_mL,P·V,편차_퍼센트,기록시각_ms,온도_K");
        data.forEach(d => {
            const dev = mean > 0 ? (d.PV - mean) / mean * 100 : 0;
            const elapsedMs = sessionStart ? (d.timestamp - sessionStart) : "";
            lines.push([
                d.id,
                d.P.toFixed(1),
                d.V.toFixed(1),
                d.PV.toFixed(1),
                dev.toFixed(3),
                elapsedMs,
                d.tempK.toFixed(2),
            ].join(","));
        });
        lines.push("");

        const hasAnyConversation = ["1", "2", "3", "free"].some(
            q => aiConversations[q] && aiConversations[q].messages.length > 0
        );
        if (hasAnyConversation) {
            lines.push("# == AI 튜터 대화 ==");
            lines.push("주제,순번,역할,내용,모델,토큰입력,토큰출력");
            ["1", "2", "3", "free"].forEach(q => {
                const conv = aiConversations[q];
                if (!conv || !conv.messages.length) return;
                const topic = q === "free" ? "자유" : `Q${q}`;
                conv.messages.forEach((msg, i) => {
                    const isAssistant = msg.role === "assistant";
                    const model = isAssistant ? (msg.model || "") : "";
                    const tIn   = isAssistant ? (msg.tokensIn ?? "") : "";
                    const tOut  = isAssistant ? (msg.tokensOut ?? "") : "";
                    lines.push([
                        topic,
                        i + 1,
                        msg.role,
                        csvEscape(msg.content),
                        model,
                        tIn,
                        tOut,
                    ].join(","));
                });
            });
        }

        return lines.join("\n");
    }

    document.getElementById("btn-export-analysis").addEventListener("click", () => {
        const content = buildAnalysisCSV();
        if (content === null) return;
        const filename = `boyle_analysis_${formatTimestampForFilename(new Date())}.csv`;
        downloadRawCSV(filename, content);
    });

    // === AI tutor event wiring ===
    document.getElementById("btn-verify-key").addEventListener("click", verifyKey);
    document.getElementById("btn-clear-key").addEventListener("click", clearKey);

    const keyInputEl = document.getElementById("ai-api-key");
    keyInputEl.addEventListener("focus", (e) => {
        if (e.target.dataset.masked === "true" && apiKey) {
            e.target.value = apiKey;
            delete e.target.dataset.masked;
        }
    });
    keyInputEl.addEventListener("blur", (e) => {
        if (apiKey && e.target.value === apiKey) {
            e.target.value = maskKey(apiKey);
            e.target.dataset.masked = "true";
        }
    });

    document.getElementById("ai-student-level").addEventListener("change", (e) => {
        sessionStorage.setItem(SESSION_KEY_LEVEL, e.target.value);
    });
    document.getElementById("ai-model").addEventListener("change", (e) => {
        sessionStorage.setItem(SESSION_KEY_MODEL, e.target.value);
        updateUsageDisplay();
    });

    loadAISettings();
    updateUsageDisplay();

    // Expose API surface for ai-tutor.js (which runs in its own <script> scope
    // and cannot access createAnalysisPanel closure directly).
    window.PchemTutor = {
        getApiKey: () => sessionStorage.getItem(SESSION_KEY_API),
        getModel:  () => sessionStorage.getItem(SESSION_KEY_MODEL) || "claude-sonnet-4-6",
        getLevel:  () => sessionStorage.getItem(SESSION_KEY_LEVEL) || "high",
        USD_TO_KRW,
        MODEL_PRICING,
        QUESTION_TEXT,
        buildSystemPrompt,
        buildUserPrompt,
        buildDataContext,
        addTokens: (inputTok, outputTok) => {
            totalInputTokens  += inputTok;
            totalOutputTokens += outputTok;
            updateUsageDisplay();
        },
    };

    function clear() {
        if (typeof resetAllConversations === "function") resetAllConversations();
        refresh();
    }

    refresh();

    return { refresh, clear };
}
