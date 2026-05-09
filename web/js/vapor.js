// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b final, 교과서 정합 모델)
//
// 핵심 (Phase 6.1-b 5+회 시도 끝의 결론):
//   · 액체 내부 = 정적 격자 (시뮬 X, 위치 고정)
//   · 표면 한 줄 = 동적 (좌우 진동 + 확률 탈출 게이트)
//   · 기체 = 자유 비행 (LJ X, hard sphere + 벽 반사 + 응축 게이트)
//   · 명시 확률 사건 (탈출 / 응축)
//
// 폐기된 자체 시도 (모두 "가득 차있는 액체" 보장 실패 또는 시각 결함):
//   - 격자 + 진동 (고체 인상)
//   - 자유 이동 + 중력 only (모든 입자 바닥에 깔림)
//   - 표면 분자 + 띠 / 옵션 Z (fake animation)
//   - LJ-like piecewise (응집 실패)
//   - 응집 영역 + 외부 가속도장 (자연 정합 X)
//   - Schroeder LJ + Verlet (응집 풀려 듬성듬성 + 클러스터 떠오름)
//
// 본 모델은 분자 동역학 시뮬 X. 학습 목표 (동적 평형 가시화) 달성에 필요한
// 최소 추상화. 사용자가 처음부터 명시한 "분자 운동 중요 X, 표면만 명확하게"
// 요구가 정답. docs/17 §6 정직한 한계 참조.
// =============================================================

const VAPOR_DT_CAP = 0.05;
const VAPOR_MARGIN_PX = 12;

class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;

        const margin = VAPOR_MARGIN_PX;
        this.box = {
            x: margin,
            y: margin,
            w: this.canvasW - 2 * margin,
            h: this.canvasH - 2 * margin,
        };

        // V_liquid 영역 — 박스 하부, V_liquid : V_flask 비율
        const ratio = vLiquidMl / vFlaskMl;
        const liquidH = this.box.h * ratio;
        this.liquidTopY = this.box.y + this.box.h - liquidH;  // 캔버스 좌표 (y ↓)

        // 격자 셀 크기 = 2 × radius
        const r = cfg.molecule_radius_px ?? 9;
        this.r = r;
        const cellSize = 2 * r;
        const cols = Math.max(1, Math.floor(this.box.w / cellSize));

        // 표면 한 줄을 위해 격자 위 한 줄을 SurfaceParticle 자리로 분리
        const totalRowsAvailable = Math.max(1, Math.floor(liquidH / cellSize));
        const liquidRows = Math.max(0, totalRowsAvailable - 1);
        const surfaceRowIdx = liquidRows;  // 격자 가장 위 줄

        // ── Liquid lattice (정적 또는 미세 진동) ──
        this.liquidLattice = [];
        const liquidJitter = cfg.liquid_jitter_amp_px ?? 0;
        for (let cy = 0; cy < liquidRows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const x0 = this.box.x + (cx + 0.5) * cellSize;
                const y0 = this.box.y + this.box.h - (cy + 0.5) * cellSize;  // 박스 바닥부터 위로
                this.liquidLattice.push({
                    x0, y0,
                    x: x0, y: y0,
                    phase: Math.random() * Math.PI * 2,
                    amp: liquidJitter,
                });
            }
        }

        // ── Surface particles (격자 위 한 줄, 좌우 진동) ──
        this.surfaceParticles = [];
        const surfaceJitter = cfg.surface_jitter_amp_px ?? 2;
        for (let cx = 0; cx < cols; cx++) {
            const x0 = this.box.x + (cx + 0.5) * cellSize;
            const y0 = this.box.y + this.box.h - (surfaceRowIdx + 0.5) * cellSize;
            this.surfaceParticles.push({
                x0, y0,
                x: x0, y: y0,
                phase: Math.random() * Math.PI * 2,
                amp: surfaceJitter,
            });
        }

        // ── Gas particles (시작 0, 증발로만 생성) ──
        this.gasParticles = [];
        this.gasRadius = cfg.gas_particle_radius_px ?? 3.5;

        // ── 사건 누적 (1초 윈도우) ──
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();

        // mmol 계산용 — 액체 격자 + 표면 입자 합
        this.N_total = this.liquidLattice.length + this.surfaceParticles.length;
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

        // 2) Surface 좌우 진동
        for (const sp of this.surfaceParticles) {
            sp.x = sp.x0 + sp.amp * Math.cos(2 * Math.PI * tSec + sp.phase);
            // y 그대로
        }

        // 3) Gas 자유 비행 + 충돌 + 벽 반사
        this._updateGas(cap);

        // 4) 표면 → 기체 사건 (확률 게이트)
        this._evalEvaporation(cap);

        // 5) 응축 게이트 (gas 표면 도달)
        this._evalCondensation();

        // 6) stats 1초 간격
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
            // 박스 사방 hard wall
            if (g.x < left  && g.vx < 0) g.vx = -g.vx;
            if (g.x > right && g.vx > 0) g.vx = -g.vx;
            if (g.y < top   && g.vy < 0) g.vy = -g.vy;
            if (g.y > bottom && g.vy > 0) g.vy = -g.vy;
            if (g.x < left)        g.x = left;
            else if (g.x > right)  g.x = right;
            if (g.y < top)         g.y = top;
            else if (g.y > bottom) g.y = bottom;
        }
        // hard sphere 분자-분자 충돌 (등질량 impulse)
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

    _evalEvaporation(dt) {
        // 매 surface 입자마다 dt 동안 p_evap_per_sec * dt 확률로 탈출
        const pPerStep = (this.cfg.p_evap_per_sec_per_particle ?? 0.02) * dt;
        const initKE = this.cfg.gas_init_KE ?? 4.0;
        const speed = Math.sqrt(2 * initKE);
        for (const sp of this.surfaceParticles) {
            if (Math.random() < pPerStep) {
                // 위 방향 ±π/8 무작위 각도로 발사
                const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
                const vx = speed * Math.cos(angle);
                const vy = speed * Math.sin(angle); // angle ≈ -π/2 → vy 음수 (캔버스 y ↓ 위쪽)
                this.gasParticles.push({
                    x: sp.x,
                    y: sp.y - this.gasRadius - 1,
                    vx, vy,
                });
                this._evapWin++;
                // 표면 입자는 사라지지 않음 (사용자 명세)
            }
        }
    }

    _evalCondensation() {
        const pCond = this.cfg.p_condense_per_hit ?? 0.5;
        const liquidTop = this.liquidTopY;
        const remain = [];
        for (const g of this.gasParticles) {
            if (g.vy > 0 && g.y >= liquidTop - 5) {
                if (Math.random() < pCond) {
                    // 응축 — 사라짐 (표면 격자 풀에는 영향 X, 격자 항상 가득)
                    this._condWin++;
                    continue;
                } else {
                    // 위로 반사
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
        console.log(`[Vapor] textbook · evap=${evap}/s · cond=${cond}/s · gas=${this.gasParticles.length} · L=${this.liquidLattice.length} · S=${this.surfaceParticles.length}`);
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = now;
    }

    drawWalls(p) {
        // 박스 사방 테두리
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(this.box.x, this.box.y, this.box.w, this.box.h);

        // V_liquid 영역 위 경계 점선
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
        const surfaceColor = p.color(cfg.surface_color || "#1E3A8A");

        p.noStroke();

        // Liquid lattice
        p.fill(liquidColor);
        for (const m of this.liquidLattice) {
            p.circle(m.x, m.y, r * 2);
        }

        // Surface 한 줄
        p.fill(surfaceColor);
        for (const sp of this.surfaceParticles) {
            p.circle(sp.x, sp.y, r * 2);
        }

        // Gas — KE HSB lerp (느림 청 → 빠름 적)
        const gasR = this.gasRadius;
        const slow = p.color("#60A5FA");
        const fast = p.color("#EF4444");
        const refKE = (cfg.gas_init_KE ?? 4.0) * 1.5;  // refKE 기준
        for (const g of this.gasParticles) {
            const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy);
            const t = Math.min(ke / refKE, 1);
            p.fill(p.lerpColor(slow, fast, t));
            p.circle(g.x, g.y, gasR * 2);
        }
    }
}

// =============================================================
// p5 instance mount — vapor.html #vapor-canvas-container 부착
// =============================================================
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
