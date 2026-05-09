// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b sub-step B-2 final fixup 2)
//
// 5 사용자 비판 + 학습 핵심 + plateau 보정:
//   (1) 기체 단색 빨강 → KE 자연단위 lerp 색
//   (2) 기체 정지 → gas_speed_scale 분리 (KE → px/s)
//   (3) 표면 자리 보충 X → 탈출 시 즉시 새 SurfaceParticle
//   (4) Boltzmann 분율 누락 → KE 변수 + 매 1초 MB 재샘플 + 결정적 게이트
//   (5) 입자 크기 미통일 → liquid/gas 모두 r=4
//   (6) plateau ~5~10 너무 낮음 → E_escape 1.2 + E_capture 2.5 + 약한 중력
//                               + 천장 KE 손실 → plateau ~50~80 목표
//   (7) 응축 사건 시각화 부족 → flash queue (evap 청 / cond 주황 1초 페이드)
//
// 학습 핵심 (raison d'être):
//   · evap = 일정 (MB 분포 × 표면 입자 수, 두 항 다 시간 불변)
//   · cond = 점진 증가 (기체 밀도 ↑ → 표면 충돌 ↑)
//   · 평형 = "evap 줄어든 게 아니라 cond 가 evap 까지 따라온 것"
//   → 캔버스 하단 80px RateMiniGraph 로 두 곡선 동시 가시화
//   → flash queue 로 사건 빈도 직관 인지
//
// docs/17 §6 참조.
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

        // ── SurfaceParticle (KE 변수, 매 1초 MB 재샘플) ──
        const surfaceJitter = cfg.surface_jitter_amp_px ?? 2;
        const kT = cfg.kT_surface ?? 1.0;
        this.surfaceParticles = [];
        for (let cx = 0; cx < cols; cx++) {
            const x0 = this.box.x + (cx + 0.5) * cellSize;
            const y0 = this.box.y + this.box.h - (surfaceRowIdx + 0.5) * cellSize;
            this.surfaceParticles.push(this._makeSurfaceParticle(x0, y0, surfaceJitter, kT));
        }

        // ── Gas (시작 0, 증발만으로 생성) ──
        this.gasParticles = [];
        this.gasRadius = cfg.gas_particle_radius_px ?? 4;
        this.gasSpeedScale = cfg.gas_speed_scale ?? 50;
        this.gasDamping = cfg.gas_velocity_damping ?? 0.9995;
        this.gasGravity = cfg.gas_gravity ?? 0.0005;
        this.ceilingKERetention = cfg.ceiling_KE_retention ?? 0.85;

        // ── Flash queue (사용자 비판 (7): 사건 시각화 강화) ──
        this.flashes = [];

        // 사건 누적
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();
        this._resampleAccum = 0;

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
    get equilibriumStatus() {
        if (this.equilibriumReached) return "평형";
        if (this.equilibriumStartIdx != null) return "근접";
        return "비평형";
    }

    _makeSurfaceParticle(x0, y0, jitterAmp, kT) {
        return {
            x0, y0,
            x: x0, y: y0,
            phase: Math.random() * Math.PI * 2,
            amp: jitterAmp,
            ke: vaporSampleMBKE(kT),
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

        // 2) Surface 좌우 진동 (KE 와 별개, 시각적 활기)
        for (const sp of this.surfaceParticles) {
            sp.x = sp.x0 + sp.amp * Math.cos(2 * Math.PI * tSec + sp.phase);
        }

        // 3) Gas 자유 비행 + 충돌 + 벽 반사
        this._updateGas(cap);

        // 4) Surface KE 재샘플링 + Boltzmann 게이트
        this._resampleAccum += cap;
        const resampleT = this.cfg.surface_KE_resample_sec ?? 1.0;
        if (this._resampleAccum >= resampleT) {
            this._resampleAccum = 0;
            this._resampleSurfaceAndGate();
        }

        // 5) 응축 게이트
        this._evalCondensation();

        // 6) 매 1초: rate 샘플 + stats log
        this._maybeTickRateAndLog();
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

    // 매 surface_KE_resample_sec 마다: 모든 surface 입자 KE 새로 MB 샘플링.
    // KE > E_escape 면 결정적 탈출 → GasParticle 신규 + 즉시 새 SurfaceParticle.
    _resampleSurfaceAndGate() {
        const kT = this.cfg.kT_surface ?? 1.0;
        const E_escape = this.cfg.E_escape ?? 3.0;
        const jitterAmp = this.cfg.surface_jitter_amp_px ?? 2;
        const newSurface = [];
        for (const sp of this.surfaceParticles) {
            sp.ke = vaporSampleMBKE(kT);
            if (sp.ke > E_escape) {
                this._spawnGasFromSurface(sp);
                newSurface.push(this._makeSurfaceParticle(sp.x0, sp.y0, jitterAmp, kT));
            } else {
                newSurface.push(sp);
            }
        }
        this.surfaceParticles = newSurface;
    }

    _spawnGasFromSurface(sp) {
        const speedScale = this.gasSpeedScale;
        const speed = Math.sqrt(2 * sp.ke) * speedScale;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);
        this.gasParticles.push({
            x: sp.x, y: sp.y - this.gasRadius - 1,
            vx, vy,
            ke_at_birth: sp.ke,
        });
        this._evapWin++;
        this._addFlash(sp.x, sp.y, this.cfg.evap_flash_color || "#2563EB");
    }

    _addFlash(x, y, colorStr) {
        this.flashes.push({
            x, y, color: colorStr,
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
                    this._addFlash(g.x, liquidTop, condColor);
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
        const evapRaw = this._evapWin / elapsedSec;
        const condRaw = this._condWin / elapsedSec;

        // EMA
        const alpha = this.cfg.rate_ema_alpha ?? 0.3;
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
        const liquidColor = p.color(cfg.liquid_color || "#1E3A8A");
        const slow = p.color(cfg.color_KE_slow || "#1E3A8A");
        const fast = p.color(cfg.color_KE_fast || "#DC2626");
        const keMin = cfg.color_KE_min_for_HSB ?? 0.0;
        const keMax = cfg.color_KE_max_for_HSB ?? 5.0;

        p.noStroke();

        p.fill(liquidColor);
        for (const m of this.liquidLattice) {
            p.circle(m.x, m.y, r * 2);
        }

        for (const sp of this.surfaceParticles) {
            p.fill(vaporColorFromKE(p, sp.ke, slow, fast, keMin, keMax));
            p.circle(sp.x, sp.y, r * 2);
        }

        const gasR = this.gasRadius;
        const ssq = this.gasSpeedScale * this.gasSpeedScale;
        for (const g of this.gasParticles) {
            const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
            p.fill(vaporColorFromKE(p, ke, slow, fast, keMin, keMax));
            p.circle(g.x, g.y, gasR * 2);
        }
    }

    // ── Flash queue 렌더 (1초 페이드, 12 → 6 px) ──
    drawFlashes(p) {
        const cfg = this.cfg;
        const duration = (cfg.flash_duration_sec ?? 1.0) * 1000;
        const rStart = cfg.flash_radius_start_px ?? 12;
        const rEnd = cfg.flash_radius_end_px ?? 6;
        const now = performance.now();
        const remain = [];
        p.noFill();
        p.strokeWeight(2);
        for (const f of this.flashes) {
            const elapsed = now - f.t_start;
            if (elapsed >= duration) continue;
            const t = elapsed / duration;
            const r = rStart + (rEnd - rStart) * t;
            const alpha = (1 - t) * 220;
            const col = p.color(f.color);
            col.setAlpha(alpha);
            p.stroke(col);
            p.circle(f.x, f.y, r * 2);
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
            world.drawFlashes(p);
            world.drawRateGraph(p);
        };
    };
    return new p5(sketch, container);
}
