// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b fixup, KE + Boltzmann 게이트)
//
// 사용자 4 비판 1:1 매핑:
//   (1) 기체 단색 빨강 → 색 매핑은 KE 자연 단위 기준, 충돌로 다양화
//   (2) 기체 정지 → speedScale 별도 (KE → px/s 변환), 자유 비행 검증
//   (3) 표면 자리 보충 시각 X → 탈출 시 즉시 새 SurfaceParticle (다른 색)
//   (4) Boltzmann 분율 누락 → SurfaceParticle KE 변수 + 매 1초 MB 샘플링
//                              + KE > E_escape 결정적 탈출 (확률 X)
//
// 모델 (직전 정적 격자 + 표면 동적 그대로 + KE 추가):
//   · Liquid lattice = 정적 격자 (가득 보장)
//   · SurfaceParticle = KE 변수, 매 1초 MB 재샘플링, 게이트 평가
//   · GasParticle = KE 보존, 자유 비행 + hard sphere + KE HSB 색
//
// 폐기 (직전 균등 확률 모델):
//   · p_evap_per_sec / p_condense_per_hit 균등 확률 → KE 정보 없음, 학습 결함
//
// docs/17 §6 정직한 한계 참조.
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

        this.box = {
            x: VAPOR_MARGIN_PX,
            y: VAPOR_MARGIN_PX,
            w: this.canvasW - 2 * VAPOR_MARGIN_PX,
            h: this.canvasH - 2 * VAPOR_MARGIN_PX,
        };

        const ratio = vLiquidMl / vFlaskMl;
        const liquidH = this.box.h * ratio;
        this.liquidTopY = this.box.y + this.box.h - liquidH;

        const r = cfg.molecule_radius_px ?? 9;
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
        this.gasRadius = cfg.gas_particle_radius_px ?? 3.5;
        this.gasSpeedScale = cfg.gas_speed_scale ?? 50;  // KE → px/s 변환

        // 사건 누적
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();
        this._resampleAccum = 0;

        // mmol 계산
        this.N_total = this.liquidLattice.length + this.surfaceParticles.length;
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

        // 2) Surface 좌우 진동 (KE 와 별개)
        for (const sp of this.surfaceParticles) {
            sp.x = sp.x0 + sp.amp * Math.cos(2 * Math.PI * tSec + sp.phase);
        }

        // 3) Gas 자유 비행 + 충돌 + 벽 반사
        this._updateGas(cap);

        // 4) Surface KE 재샘플링 + Boltzmann 게이트 (매 surface_KE_resample_sec)
        this._resampleAccum += cap;
        const resampleT = this.cfg.surface_KE_resample_sec ?? 1.0;
        if (this._resampleAccum >= resampleT) {
            this._resampleAccum = 0;
            this._resampleSurfaceAndGate();
        }

        // 5) 응축 게이트
        this._evalCondensation();

        // 6) stats
        this._maybeLogStats();
    }

    _updateGas(dt) {
        const r = this.gasRadius;
        const z = this.box;
        const left = z.x + r, right = z.x + z.w - r;
        const top = z.y + r, bottom = z.y + z.h - r;
        for (const g of this.gasParticles) {
            g.x += g.vx * dt;
            g.y += g.vy * dt;
            if (g.x < left  && g.vx < 0) g.vx = -g.vx;
            if (g.x > right && g.vx > 0) g.vx = -g.vx;
            if (g.y < top   && g.vy < 0) g.vy = -g.vy;
            if (g.y > bottom && g.vy > 0) g.vy = -g.vy;
            if (g.x < left)        g.x = left;
            else if (g.x > right)  g.x = right;
            if (g.y < top)         g.y = top;
            else if (g.y > bottom) g.y = bottom;
        }
        // hard sphere 충돌 (등질량 impulse)
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
                // 탈출 — 같은 자리, KE 보존
                this._spawnGasFromSurface(sp);
                // 즉시 새 surface (자리 보충 보장 — 사용자 비판 (3))
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
        // 위쪽 ±π/8 무작위 각도 (캔버스 y ↓ 좌표라 angle ≈ -π/2 → vy < 0 = 위)
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);
        this.gasParticles.push({
            x: sp.x, y: sp.y - this.gasRadius - 1,
            vx, vy,
            ke_at_birth: sp.ke,  // 디버그용
        });
        this._evapWin++;
    }

    _evalCondensation() {
        const E_capture = this.cfg.E_capture ?? 0.5;
        const speedScale = this.gasSpeedScale;
        const ssq = speedScale * speedScale;
        const liquidTop = this.liquidTopY;
        const remain = [];
        for (const g of this.gasParticles) {
            if (g.vy > 0 && g.y >= liquidTop - 5) {
                const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
                if (ke < E_capture) {
                    this._condWin++;
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

    _maybeLogStats() {
        const now = performance.now();
        const elapsed = now - this._lastStatsT;
        if (elapsed < 1000) return;
        const scale = 1000 / elapsed;
        const evap = (this._evapWin * scale).toFixed(1);
        const cond = (this._condWin * scale).toFixed(1);
        let dbg = "";
        if (this.gasParticles.length > 0) {
            const g0 = this.gasParticles[0];
            const ssq = this.gasSpeedScale * this.gasSpeedScale;
            const ke0 = 0.5 * (g0.vx * g0.vx + g0.vy * g0.vy) / ssq;
            dbg = ` · gas[0]: x=${g0.x.toFixed(0)} y=${g0.y.toFixed(0)} vx=${g0.vx.toFixed(0)} vy=${g0.vy.toFixed(0)} KE=${ke0.toFixed(2)}`;
        }
        console.log(`[Vapor] textbook+KE · evap=${evap}/s · cond=${cond}/s · gas=${this.gasParticles.length} · L=${this.liquidLattice.length} · S=${this.surfaceParticles.length}${dbg}`);
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

        // Liquid lattice — 단색
        p.fill(liquidColor);
        for (const m of this.liquidLattice) {
            p.circle(m.x, m.y, r * 2);
        }

        // Surface — KE 색 (사용자 비판 (4): "빠른 분자만 빨강" 시각)
        for (const sp of this.surfaceParticles) {
            p.fill(vaporColorFromKE(p, sp.ke, slow, fast, keMin, keMax));
            p.circle(sp.x, sp.y, r * 2);
        }

        // Gas — KE 색. KE 자연 단위 (speedScale 적용 전)
        const gasR = this.gasRadius;
        const ssq = this.gasSpeedScale * this.gasSpeedScale;
        for (const g of this.gasParticles) {
            const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
            p.fill(vaporColorFromKE(p, ke, slow, fast, keMin, keMax));
            p.circle(g.x, g.y, gasR * 2);
        }
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
        };
    };
    return new p5(sketch, container);
}
