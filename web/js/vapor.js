// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b sub-step B-2 final fixup 3)
//
// 직전 fixup 2 검증: (1) 1초 동시 평가 → 대포 펄스, (2) 균질 표면 색.
// 사용자 통찰 — "평균 속력만 일정하면 됨". KE 시뮬 자체 폐기, 사건 확률만 관리.
//
// 모델 변경:
//   · 폐기: KE 변수 기반 결정적 게이트 + 1초 동기 재샘플
//   · 신규: 비동기 Poisson 사건 모델 (매 frame 독립 평가)
//     - random() < evap_rate_per_particle_per_sec × dt → 탈출
//     - 통계: Poisson 분포 자동 (대포 X)
//   · KE 변수 = 시각용 색 매핑만. smooth random walk + 노이즈
//     (1초 펄스 X, 부드러운 색 변화)
//   · gas spawn KE = 사건 발생 시 [gas_spawn_KE_min, max] uniform 샘플
//     (표면 시각 KE 와 무관 — KE 시뮬 자체 폐기 철학 준수)
//
// 유지:
//   · gas 물리 (중력 + 약한 점성 + 천장 KE 손실)
//   · 응축 게이트 (KE_gas < E_capture, 매 frame)
//   · flash queue (evap 청 / cond 주황 1초 페이드)
//   · RateMiniGraph (학습 핵심)
//
// 학습 핵심 (raison d'être):
//   · evap = 일정 (Poisson 평균 = base_rate × 표면 입자 수, 시간 불변)
//   · cond = 점진 증가 (기체 밀도 ↑ → 표면 충돌 ↑)
//   · 평형 = 두 속도 만남 (evap 줄어든 게 아님)
//
// docs/17 §6 "비동기 Poisson 사건 모델" 참조.
// =============================================================

const VAPOR_DT_CAP = 0.05;
const VAPOR_MARGIN_PX = 12;

// ── MB KE 샘플링 — 정규분포 근사 (mean=kT, stddev=kT/√2, max(0, .)) ──
function vaporSampleMBKE(kT) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, kT + z * kT / Math.SQRT2);
}

// ── KE → 색 (느림 진청 → 빠름 적, 단순 lerp) ──
function vaporColorFromKE(p, ke, slowColor, fastColor, keMin, keMax) {
    const t = Math.max(0, Math.min(1, (ke - keMin) / (keMax - keMin)));
    return p.lerpColor(slowColor, fastColor, t);
}

class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;

        // ── 캔버스 분할: 위쪽 sim 영역 + 아래쪽 rate graph 영역 ──
        this.rateGraphH = cfg.rate_graph_height_px ?? 80;
        const simH = this.canvasH - this.rateGraphH;

        this.box = {
            x: VAPOR_MARGIN_PX,
            y: VAPOR_MARGIN_PX,
            w: this.canvasW - 2 * VAPOR_MARGIN_PX,
            h: simH - 2 * VAPOR_MARGIN_PX,
        };
        this.graphRect = {
            x: 0,
            y: simH,
            w: this.canvasW,
            h: this.rateGraphH,
        };

        const ratio = vLiquidMl / vFlaskMl;
        const liquidH = this.box.h * ratio;
        this.liquidTopY = this.box.y + this.box.h - liquidH;

        const r = cfg.molecule_radius_px ?? 4;
        this.r = r;
        const cellSize = 2 * r;
        const cols = Math.max(1, Math.floor(this.box.w / cellSize));

        const totalRows = Math.max(1, Math.floor(liquidH / cellSize));
        const liquidRows = Math.max(0, totalRows - 1);
        const surfaceRowIdx = liquidRows;

        // ── Liquid lattice (정적 또는 미세 진동) ──
        this.liquidLattice = [];
        const liquidJitter = cfg.liquid_jitter_amp_px ?? 0;
        for (let cy = 0; cy < liquidRows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const x0 = this.box.x + (cx + 0.5) * cellSize;
                const y0 = this.box.y + this.box.h - (cy + 0.5) * cellSize;
                this.liquidLattice.push({
                    x0, y0,
                    x: x0, y: y0,
                    phase: Math.random() * Math.PI * 2,
                    amp: liquidJitter,
                });
            }
        }

        // ── SurfaceParticle (KE = 시각용만, 비동기 Poisson 모델) ──
        // VISUAL_KT 는 시각 KE 분포 평균 (색 매핑용). 물리 게이트와 무관.
        const surfaceJitter = cfg.surface_jitter_amp_px ?? 2;
        this._visualKT = 1.0;
        this.surfaceParticles = [];
        for (let cx = 0; cx < cols; cx++) {
            const x0 = this.box.x + (cx + 0.5) * cellSize;
            const y0 = this.box.y + this.box.h - (surfaceRowIdx + 0.5) * cellSize;
            this.surfaceParticles.push(this._makeSurfaceParticle(x0, y0, surfaceJitter));
        }

        // ── Gas (시작 0, 증발만으로 생성) ──
        this.gasParticles = [];
        this.gasRadius = cfg.gas_particle_radius_px ?? 4;
        this.gasSpeedScale = cfg.gas_speed_scale ?? 50;
        this.gasDamping = cfg.gas_velocity_damping ?? 0.9995;
        this.gasGravity = cfg.gas_gravity ?? 0.0005;
        this.ceilingKERetention = cfg.ceiling_KE_retention ?? 0.85;

        // ── Flash queue (사건 시각화 — 원 + 화살표 0.8s 페이드) ──
        this.flashes = [];

        // ── Condense location markers (표면 격자에 주황 ring 2초) ──
        this.condenseHighlights = [];

        // 시뮬 경과 시간 (학교 실험 정합 표시용)
        this.startT = performance.now();

        // 사건 누적
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();

        // 3초 raw rate 평활 버퍼 (rate_calc_window_sec)
        this._rateRawEvapBuf = [];
        this._rateRawCondBuf = [];

        // ── Rate 추적 (학습 핵심) ──
        this.rateHistory = [];          // {evap_raw, cond_raw, evap_ema, cond_ema}
        this.evapEMA = 0;
        this.condEMA = 0;
        this.equilibriumStartIdx = null;
        this.equilibriumReached = false;
        this.equilibriumIdx = null;

        // mmol 계산
        this.N_total = this.liquidLattice.length + this.surfaceParticles.length;
    }

    // ── 외부 노출용 게터 (main.js DOM 갱신) ──
    get pressureKPa() {
        const k = this.cfg.pressure_kpa_per_gas_particle ?? 0.1;
        return this.gasParticles.length * k;
    }
    get pressureBarPct() {
        const max = this.cfg.pressure_kpa_max_for_bar ?? 30;
        return Math.min(100, (this.pressureKPa / max) * 100);
    }
    get surfaceCount() { return this.surfaceParticles.length; }
    get gasCount() { return this.gasParticles.length; }
    get elapsedSec() { return (performance.now() - this.startT) / 1000; }
    get elapsedFormatted() {
        const sec = Math.max(0, Math.floor(this.elapsedSec));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}분 ${String(s).padStart(2, "0")}초`;
    }
    get equilibriumStatus() {
        if (this.equilibriumReached) return "평형";
        if (this.equilibriumStartIdx != null) return "근접";
        return "비평형";
    }

    _makeSurfaceParticle(x0, y0, jitterAmp) {
        const ke = vaporSampleMBKE(this._visualKT);
        const targetChangeMs = (this.cfg.surface_KE_visual_target_change_sec ?? 2.0) * 1000;
        return {
            x0, y0,
            x: x0, y: y0,
            phase: Math.random() * Math.PI * 2,
            amp: jitterAmp,
            ke: ke,
            ke_target: ke,
            ke_target_next_change_t: performance.now() + Math.random() * targetChangeMs,
        };
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);
        const tSec = performance.now() / 1000;

        // 1) Liquid lattice 미세 진동 (amp=0 시 정적)
        for (const m of this.liquidLattice) {
            if (m.amp > 0) {
                m.x = m.x0 + m.amp * Math.cos(2 * Math.PI * tSec + m.phase);
                m.y = m.y0 + m.amp * Math.sin(2 * Math.PI * tSec + m.phase);
            }
        }

        // 2) Surface 매 frame: 위치 진동 + 시각 KE smooth update + Poisson 탈출 게이트
        this._updateSurfaceAndPoissonEvap(cap, tSec);

        // 3) Gas 자유 비행 + 충돌 + 벽 반사
        this._updateGas(cap);

        // 4) 응축 게이트
        this._evalCondensation();

        // 5) 매 1초: rate 샘플 + stats log
        this._maybeTickRateAndLog();
    }

    _updateSurfaceAndPoissonEvap(dt, tSec) {
        const cfg = this.cfg;
        const evapRate = cfg.evap_rate_per_particle_per_sec ?? 0.2;
        const pEvapPerFrame = evapRate * dt;
        const smoothFactor = cfg.surface_KE_visual_smooth_factor ?? 0.05;
        const targetChangeMs = (cfg.surface_KE_visual_target_change_sec ?? 2.0) * 1000;
        const jitter = cfg.surface_jitter_amp_px ?? 2;
        const visualKT = this._visualKT;
        const now = performance.now();

        for (let i = 0; i < this.surfaceParticles.length; i++) {
            const sp = this.surfaceParticles[i];

            // 위치 좌우 진동
            sp.x = sp.x0 + sp.amp * Math.cos(2 * Math.PI * tSec + sp.phase);

            // 시각 KE — 새 target 주기적 재샘플 + 매 frame ease + 미세 노이즈
            if (now >= sp.ke_target_next_change_t) {
                sp.ke_target = vaporSampleMBKE(visualKT);
                // 다음 주기는 target 평균 ± 50% 무작위 (전체 일제 변경 회피)
                sp.ke_target_next_change_t = now + targetChangeMs * (0.5 + Math.random());
            }
            sp.ke += (sp.ke_target - sp.ke) * smoothFactor + (Math.random() - 0.5) * 0.05;
            if (sp.ke < 0) sp.ke = 0;

            // Poisson 탈출 — 매 frame 독립 평가
            if (Math.random() < pEvapPerFrame) {
                this._spawnGasFromSurface(sp);
                this.surfaceParticles[i] = this._makeSurfaceParticle(sp.x0, sp.y0, jitter);
            }
        }
    }

    _updateGas(dt) {
        const r = this.gasRadius;
        const z = this.box;
        const left = z.x + r, right = z.x + z.w - r;
        const top = z.y + r, bottom = z.y + z.h - r;
        const dampingFactor = Math.pow(this.gasDamping, dt);  // dt-scaled
        const ceilingVScale = Math.sqrt(this.ceilingKERetention); // KE retention → v scale
        const gravity = this.gasGravity;
        for (const g of this.gasParticles) {
            // 약한 중력 (per frame)
            g.vy += gravity;
            // 약한 점성 (dt-scaled)
            g.vx *= dampingFactor;
            g.vy *= dampingFactor;
            // 위치 갱신
            g.x += g.vx * dt;
            g.y += g.vy * dt;
            // 좌우 벽 (탄성)
            if (g.x < left  && g.vx < 0) g.vx = -g.vx;
            if (g.x > right && g.vx > 0) g.vx = -g.vx;
            // 천장 (KE 손실 — 응축 후보 ↑)
            if (g.y < top   && g.vy < 0) {
                g.vy = -g.vy * ceilingVScale;
                g.vx *= ceilingVScale;
            }
            // 바닥 (탄성, 정상 조건에선 응축 게이트가 먼저 처리)
            if (g.y > bottom && g.vy > 0) g.vy = -g.vy;
            // clamp
            if (g.x < left)        g.x = left;
            else if (g.x > right)  g.x = right;
            if (g.y < top)         g.y = top;
            else if (g.y > bottom) g.y = bottom;
        }
        // hard sphere 충돌 (등질량 impulse) — KE 분포 다양화 (응축 가능성 ↑)
        const n = this.gasParticles.length;
        const minD = 2 * r;
        const minD2 = minD * minD;
        for (let i = 0; i < n; i++) {
            const a = this.gasParticles[i];
            for (let j = i + 1; j < n; j++) {
                const b = this.gasParticles[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < minD2 && d2 > 1e-9) {
                    const d = Math.sqrt(d2);
                    const nx = dx / d, ny = dy / d;
                    const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
                    const vn = dvx * nx + dvy * ny;
                    if (vn < 0) {
                        const j_imp = -vn;
                        a.vx -= j_imp * nx; a.vy -= j_imp * ny;
                        b.vx += j_imp * nx; b.vy += j_imp * ny;
                        const overlap = (minD - d) * 0.5;
                        a.x -= nx * overlap; a.y -= ny * overlap;
                        b.x += nx * overlap; b.y += ny * overlap;
                    }
                }
            }
        }
    }

    // Gas spawn — 표면 시각 KE 와 무관하게 [min, max] uniform 샘플
    // (사용자 통찰: KE 시뮬 폐기, 사건 확률만 관리)
    _spawnGasFromSurface(sp) {
        const speedScale = this.gasSpeedScale;
        const keMin = this.cfg.gas_spawn_KE_min ?? 2.0;
        const keMax = this.cfg.gas_spawn_KE_max ?? 4.0;
        const ke = keMin + Math.random() * (keMax - keMin);
        const speed = Math.sqrt(2 * ke) * speedScale;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);
        this.gasParticles.push({
            x: sp.x, y: sp.y - this.gasRadius - 1,
            vx, vy,
            ke_at_birth: ke,
            birth_time: performance.now(),
        });
        this._evapWin++;
        this._addFlash(sp.x, sp.y, this.cfg.evap_flash_color || "#2563EB", "up");
    }

    _addFlash(x, y, colorStr, dir) {
        this.flashes.push({
            x, y, color: colorStr,
            dir: dir || "up",  // "up" = 증발 (y 감소 방향), "down" = 응축
            t_start: performance.now(),
        });
    }

    _evalCondensation() {
        const E_capture = this.cfg.E_capture ?? 2.5;
        const speedScale = this.gasSpeedScale;
        const ssq = speedScale * speedScale;
        const liquidTop = this.liquidTopY;
        const condColor = this.cfg.cond_flash_color || "#EA580C";
        const remain = [];
        for (const g of this.gasParticles) {
            if (g.vy > 0 && g.y >= liquidTop - 5) {
                const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
                if (ke < E_capture) {
                    this._condWin++;
                    this._addFlash(g.x, liquidTop, condColor, "down");
                    // 표면 격자에 응축 위치 마커 (가장 가까운 surface 열에 snap)
                    const cellSize = 2 * this.r;
                    const colIdx = Math.floor((g.x - this.box.x) / cellSize);
                    const sp = this.surfaceParticles[
                        Math.max(0, Math.min(this.surfaceParticles.length - 1, colIdx))
                    ];
                    if (sp) {
                        this.condenseHighlights.push({
                            x: sp.x0, y: sp.y0,
                            t_start: performance.now(),
                        });
                    }
                    continue;
                } else {
                    g.vy = -g.vy;
                    g.y = liquidTop - 5;
                }
            }
            remain.push(g);
        }
        this.gasParticles = remain;
    }

    _maybeTickRateAndLog() {
        const now = performance.now();
        const elapsed = now - this._lastStatsT;
        if (elapsed < 1000) return;
        const elapsedSec = elapsed / 1000;
        const evap1s = this._evapWin / elapsedSec;
        const cond1s = this._condWin / elapsedSec;

        // 3초 rolling 평균 (rate_calc_window_sec) → 들쭉날쭉 평활
        const calcWin = Math.max(1, Math.round(this.cfg.rate_calc_window_sec ?? 3.0));
        this._rateRawEvapBuf.push(evap1s);
        this._rateRawCondBuf.push(cond1s);
        while (this._rateRawEvapBuf.length > calcWin) this._rateRawEvapBuf.shift();
        while (this._rateRawCondBuf.length > calcWin) this._rateRawCondBuf.shift();
        const evapRaw = this._rateRawEvapBuf.reduce((s, v) => s + v, 0) / this._rateRawEvapBuf.length;
        const condRaw = this._rateRawCondBuf.reduce((s, v) => s + v, 0) / this._rateRawCondBuf.length;

        // EMA (α 0.1, 추가 평활)
        const alpha = this.cfg.rate_ema_alpha ?? 0.1;
        this.evapEMA = alpha * evapRaw + (1 - alpha) * this.evapEMA;
        this.condEMA = alpha * condRaw + (1 - alpha) * this.condEMA;

        // 슬라이딩 윈도우
        this.rateHistory.push({
            evap_raw: evapRaw,
            cond_raw: condRaw,
            evap_ema: this.evapEMA,
            cond_ema: this.condEMA,
        });
        const windowSec = this.cfg.rate_window_sec ?? 60;
        while (this.rateHistory.length > windowSec) {
            this.rateHistory.shift();
            if (this.equilibriumStartIdx != null) this.equilibriumStartIdx -= 1;
            if (this.equilibriumIdx != null) this.equilibriumIdx -= 1;
        }

        // 평형 검출
        const threshold = this.cfg.equilibrium_threshold_per_sec ?? 1.0;
        const holdSec = this.cfg.equilibrium_hold_sec ?? 5;
        const minEvap = this.cfg.equilibrium_min_evap_per_sec ?? 1.0;
        const diff = Math.abs(this.evapEMA - this.condEMA);
        if (diff < threshold && this.evapEMA > minEvap) {
            if (this.equilibriumStartIdx == null) {
                this.equilibriumStartIdx = this.rateHistory.length - 1;
            } else if (!this.equilibriumReached) {
                const dwell = (this.rateHistory.length - 1) - this.equilibriumStartIdx;
                if (dwell >= holdSec) {
                    this.equilibriumReached = true;
                    this.equilibriumIdx = this.equilibriumStartIdx;
                }
            }
        } else if (diff >= threshold && !this.equilibriumReached) {
            this.equilibriumStartIdx = null;
        }

        // 콘솔
        let dbg = "";
        if (this.gasParticles.length > 0) {
            const g0 = this.gasParticles[0];
            const ssq = this.gasSpeedScale * this.gasSpeedScale;
            const ke0 = 0.5 * (g0.vx * g0.vx + g0.vy * g0.vy) / ssq;
            dbg = ` · gas[0] KE=${ke0.toFixed(2)}`;
        }
        const eqTag = this.equilibriumReached ? " · 평형 ★"
                    : this.equilibriumStartIdx != null ? " · 평형 근접"
                    : "";
        console.log(`[Vapor] evap=${evapRaw.toFixed(1)}/s (ema=${this.evapEMA.toFixed(1)}) · cond=${condRaw.toFixed(1)}/s (ema=${this.condEMA.toFixed(1)}) · gas=${this.gasParticles.length} · P=${this.pressureKPa.toFixed(1)}kPa${dbg}${eqTag}`);

        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = now;
    }

    drawWalls(p) {
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(this.box.x, this.box.y, this.box.w, this.box.h);

        p.stroke(120, 150, 200, 140);
        p.strokeWeight(1);
        if (p.drawingContext && typeof p.drawingContext.setLineDash === "function") {
            p.drawingContext.setLineDash([4, 4]);
            p.line(this.box.x, this.liquidTopY, this.box.x + this.box.w, this.liquidTopY);
            p.drawingContext.setLineDash([]);
        } else {
            p.line(this.box.x, this.liquidTopY, this.box.x + this.box.w, this.liquidTopY);
        }
    }

    drawMolecules(p) {
        const cfg = this.cfg;
        const r = this.r;
        const liquidColor = p.color(cfg.liquid_color || "#1E40AF");
        const liquidOpacity = cfg.liquid_opacity ?? 1.0;
        liquidColor.setAlpha(Math.max(0, Math.min(255, Math.round(liquidOpacity * 255))));
        const slow = p.color(cfg.color_KE_slow || "#1E3A8A");
        const fast = p.color(cfg.color_KE_fast || "#DC2626");
        const keMin = cfg.color_KE_min_for_HSB ?? 0.0;
        const keMax = cfg.color_KE_max_for_HSB ?? 5.0;

        // Liquid lattice (톤 다운된 단색 + opacity)
        p.noStroke();
        p.fill(liquidColor);
        for (const m of this.liquidLattice) {
            p.circle(m.x, m.y, r * 2);
        }

        // Surface particles (반투명, KE 색)
        const surfaceOpacity = cfg.surface_opacity ?? 0.55;
        const surfaceAlpha = Math.max(0, Math.min(255, Math.round(surfaceOpacity * 255)));
        for (const sp of this.surfaceParticles) {
            const col = vaporColorFromKE(p, sp.ke, slow, fast, keMin, keMax);
            col.setAlpha(surfaceAlpha);
            p.fill(col);
            p.circle(sp.x, sp.y, r * 2);
        }

        // Gas particles — 막 나온 입자는 청 테두리 강조 (2초 페이드)
        const gasR = this.gasRadius;
        const ssq = this.gasSpeedScale * this.gasSpeedScale;
        const birthDur = (cfg.gas_birth_highlight_duration_sec ?? 2.0) * 1000;
        const strokeStart = cfg.gas_birth_stroke_start_px ?? 2.5;
        const strokeEnd = cfg.gas_birth_stroke_end_px ?? 0.5;
        const birthColorStr = cfg.gas_birth_highlight_color || "#2563EB";
        const now = performance.now();
        for (const g of this.gasParticles) {
            const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
            p.fill(vaporColorFromKE(p, ke, slow, fast, keMin, keMax));
            const ageMs = now - (g.birth_time || 0);
            if (ageMs < birthDur) {
                const t = ageMs / birthDur;
                const sw = strokeStart + (strokeEnd - strokeStart) * t;
                const stCol = p.color(birthColorStr);
                stCol.setAlpha((1 - t) * 255);
                p.stroke(stCol);
                p.strokeWeight(sw);
            } else {
                p.noStroke();
            }
            p.circle(g.x, g.y, gasR * 2);
        }
        p.noStroke();
    }

    // ── Condense location markers (표면 격자에 주황 ring 2초 페이드) ──
    drawCondenseHighlights(p) {
        const cfg = this.cfg;
        const duration = (cfg.condense_highlight_duration_sec ?? 2.0) * 1000;
        const sw = cfg.condense_highlight_stroke_px ?? 2.5;
        const colorStr = cfg.condense_highlight_color || "#EA580C";
        const ringR = this.r + 1;
        const now = performance.now();
        const remain = [];
        p.noFill();
        for (const ch of this.condenseHighlights) {
            const elapsed = now - ch.t_start;
            if (elapsed >= duration) continue;
            const t = elapsed / duration;
            const alpha = (1 - t) * 255;
            const col = p.color(colorStr);
            col.setAlpha(alpha);
            p.stroke(col);
            p.strokeWeight(sw);
            p.circle(ch.x, ch.y, ringR * 2);
            remain.push(ch);
        }
        this.condenseHighlights = remain;
    }

    // ── Flash queue 렌더 (원 + 화살표, 0.8s 페이드, 12 → 4 px) ──
    drawFlashes(p) {
        const cfg = this.cfg;
        const duration = (cfg.flash_duration_sec ?? 0.8) * 1000;
        const rStart = cfg.flash_radius_start_px ?? 12;
        const rEnd = cfg.flash_radius_end_px ?? 4;
        const arrowLen = cfg.flash_arrow_length_px ?? 30;
        const arrowThick = cfg.flash_arrow_thickness_px ?? 2.5;
        const now = performance.now();
        const remain = [];
        for (const f of this.flashes) {
            const elapsed = now - f.t_start;
            if (elapsed >= duration) continue;
            const t = elapsed / duration;
            const r = rStart + (rEnd - rStart) * t;
            const alpha = (1 - t) * 255;
            const col = p.color(f.color);
            col.setAlpha(alpha);

            // 원 (펄스 페이드)
            p.noFill();
            p.stroke(col);
            p.strokeWeight(2);
            p.circle(f.x, f.y, r * 2);

            // 화살표
            //   up   (증발): tail 표면, tip 위 (기체 영역으로)
            //   down (응축): tail 표면 위 30 px (기체 영역), tip 표면 살짝 위
            //                → 액체에 묻히지 X (사용자 비판 (3))
            let tail, tip;
            if (f.dir === "down") {
                tail = f.y - arrowLen;
                tip = f.y - 1;
            } else {
                tail = f.y;
                tip = f.y - arrowLen;
            }
            p.strokeWeight(arrowThick);
            p.line(f.x, tail, f.x, tip);

            // 화살촉 (작은 삼각형, apex = tip)
            p.noStroke();
            const fillCol = p.color(f.color);
            fillCol.setAlpha(alpha);
            p.fill(fillCol);
            const headSize = 5;
            // up: apex 위, base 아래 / down: apex 아래, base 위
            const baseY = f.dir === "down" ? tip - headSize : tip + headSize;
            p.triangle(f.x, tip, f.x - headSize * 0.7, baseY, f.x + headSize * 0.7, baseY);

            remain.push(f);
        }
        this.flashes = remain;
    }

    // ── RateMiniGraph (학습 핵심: evap=일정, cond=점진 증가, 평형=만남) ──
    drawRateGraph(p) {
        const cfg = this.cfg;
        const gr = this.graphRect;
        const evapColor = cfg.rate_color_evap || "#2563EB";
        const condColor = cfg.rate_color_cond || "#EA580C";
        const yMax = cfg.rate_y_max ?? 30;
        const windowSec = cfg.rate_window_sec ?? 60;

        // 배경 + 보더
        p.noStroke();
        p.fill(248, 250, 252);
        p.rect(gr.x, gr.y, gr.w, gr.h);
        p.noFill();
        p.stroke(220);
        p.strokeWeight(1);
        p.line(gr.x, gr.y, gr.x + gr.w, gr.y);

        const padL = 8, padR = 8, padT = 18, padB = 6;
        const innerX = gr.x + padL;
        const innerY = gr.y + padT;
        const innerW = gr.w - padL - padR;
        const innerH = gr.h - padT - padB;

        // y축 보조선 (yMax/2)
        p.stroke(230);
        p.strokeWeight(1);
        p.line(innerX, innerY + innerH / 2, innerX + innerW, innerY + innerH / 2);

        // 범례
        p.noStroke();
        p.fill(evapColor);
        p.rect(gr.x + 8, gr.y + 5, 10, 4);
        p.fill(50);
        p.textSize(11);
        p.textAlign(p.LEFT, p.TOP);
        p.text("증발", gr.x + 22, gr.y + 3);

        p.fill(condColor);
        p.rect(gr.x + 56, gr.y + 5, 10, 4);
        p.fill(50);
        p.text("응축", gr.x + 70, gr.y + 3);

        p.fill(120);
        p.textSize(10);
        p.text("rate (입자/s, EMA)", gr.x + 110, gr.y + 4);

        // 데이터 부족 시 안내
        if (this.rateHistory.length < 1) {
            p.fill(150);
            p.textAlign(p.RIGHT, p.TOP);
            p.text("데이터 수집 중...", gr.x + gr.w - 8, gr.y + 4);
            return;
        }

        const n = this.rateHistory.length;
        const denom = Math.max(1, windowSec - 1);
        const mapX = (i) => innerX + (innerW * i) / denom;
        const mapY = (rate) => innerY + innerH - (innerH * Math.min(rate, yMax)) / yMax;

        // 두 곡선 사이 fill (cond < evap 인 비평형 영역 강조)
        p.noStroke();
        const fillC = p.color(condColor);
        fillC.setAlpha(40);
        p.fill(fillC);
        p.beginShape();
        for (let i = 0; i < n; i++) p.vertex(mapX(i), mapY(this.rateHistory[i].evap_ema));
        for (let i = n - 1; i >= 0; i--) p.vertex(mapX(i), mapY(this.rateHistory[i].cond_ema));
        p.endShape(p.CLOSE);

        // Evap 곡선
        p.noFill();
        p.stroke(evapColor);
        p.strokeWeight(2);
        p.beginShape();
        for (let i = 0; i < n; i++) p.vertex(mapX(i), mapY(this.rateHistory[i].evap_ema));
        p.endShape();

        // Cond 곡선
        p.stroke(condColor);
        p.beginShape();
        for (let i = 0; i < n; i++) p.vertex(mapX(i), mapY(this.rateHistory[i].cond_ema));
        p.endShape();

        // 평형 선
        if (this.equilibriumReached && this.equilibriumIdx != null && this.equilibriumIdx >= 0) {
            const ex = mapX(this.equilibriumIdx);
            p.stroke(40, 160, 80);
            p.strokeWeight(1);
            if (p.drawingContext && p.drawingContext.setLineDash) {
                p.drawingContext.setLineDash([4, 4]);
            }
            p.line(ex, innerY, ex, innerY + innerH);
            if (p.drawingContext && p.drawingContext.setLineDash) {
                p.drawingContext.setLineDash([]);
            }
            p.noStroke();
            p.fill(40, 160, 80);
            p.textSize(10);
            p.textAlign(p.LEFT, p.TOP);
            p.text("평형 도달", ex + 4, innerY + 2);
        }

        // y 라벨
        p.noStroke();
        p.fill(160);
        p.textSize(9);
        p.textAlign(p.RIGHT, p.TOP);
        p.text(`${yMax}`, gr.x + gr.w - 4, innerY - 2);
        p.textAlign(p.RIGHT, p.BOTTOM);
        p.text("0", gr.x + gr.w - 4, innerY + innerH + 2);
    }
}

function mountVaporSketch(world, container) {
    const sketch = (p) => {
        let lastT = performance.now();
        p.setup = () => {
            p.createCanvas(world.canvasW, world.canvasH);
            p.frameRate(50);
        };
        p.draw = () => {
            const now = performance.now();
            const dt = Math.min((now - lastT) / 1000, VAPOR_DT_CAP);
            lastT = now;
            world.update(dt);
            p.background(248, 250, 252);
            world.drawWalls(p);
            world.drawMolecules(p);
            world.drawCondenseHighlights(p);
            world.drawFlashes(p);
            world.drawRateGraph(p);
        };
    };
    return new p5(sketch, container);
}
