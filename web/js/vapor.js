// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b sub-step 1)
//             LJ-like 분자간 인력 모델 — 자연 응집·표면·증발·응축
//
// 핵심 원칙:
//   · 분자에 phase 플래그 X. 액체/기체는 위치·이웃 수의 자연 결과.
//   · 모든 분자 동일 크기·동일 운동 방정식.
//   · LJ-like piecewise 인력 + cutoff 만으로 모든 거동 발생.
//   · 사건 확률 / KE 임계 상수 X. 인력 함수 + 초기 KE 분포만 튜닝.
//
// Sub-step 1 범위 (본 commit):
//   · Molecule 클래스 + LJ-like 힘 계산 (O(N²))
//   · Semi-implicit Euler 적분
//   · 박스 사방 벽 반사 + 약한 중력
//   · 200 분자 박스 하부 무작위 배치 (overlap r_eq 회피)
//   · 자연 응집 클러스터 형성 검증
//
// 미포함 (sub-step 2~5):
//   · 본격 증발/응축 가시화 (sub-step 2~3)
//   · 색 차별화 (이웃 수 기반, sub-step 4)
//   · rate 그래프·평형도 (sub-step 5)
//   · 표면 가시화·교과서 정합 추가 단서 (후속)
//
// 이전 모델 (사건 추상화·표면 분자·영역 진동·자유 이동+중력) 전면 폐기.
// =============================================================

const VAPOR_DT_CAP = 0.05;
const VAPOR_MARGIN_PX = 12;

function vaporBoxMullerStandardNormal() {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function vaporMBVelocity(speedScale) {
    const u = vaporBoxMullerStandardNormal();
    const v = vaporBoxMullerStandardNormal();
    return [u * speedScale, v * speedScale];
}

class Molecule {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.fx = 0;
        this.fy = 0;
        this.mass = 1.0;
    }
}

// LJ-like piecewise (사용자 명세):
//   d < r_eq           : fmag = -k_repel * (r_eq - d) / r_eq        (반발, 음수)
//   r_eq <= d < cutoff : fmag = +k_attract * (1 - (d - r_eq) / (cutoff - r_eq))  (인력, 양수)
//   d >= cutoff        : 0
// fmag 양수 = a 가 b 방향으로 끌림 (n = (b - a)/|b - a|).
function vaporComputeForces(molecules, cfg) {
    const r       = cfg.molecule_radius_px;
    const r_eq    = cfg.r_eq_factor   * r;
    const cutoff  = cfg.cutoff_factor * r;
    const k_repel    = cfg.k_repel;
    const k_attract  = cfg.k_attract;
    const cutoff2 = cutoff * cutoff;
    const denom_attract = (cutoff - r_eq);

    for (const m of molecules) { m.fx = 0; m.fy = 0; }

    const n = molecules.length;
    for (let i = 0; i < n; i++) {
        const a = molecules[i];
        for (let j = i + 1; j < n; j++) {
            const b = molecules[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= cutoff2 || d2 < 1e-9) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;

            let fmag;
            if (d < r_eq) {
                fmag = -k_repel * (r_eq - d) / r_eq;
            } else {
                const t = (d - r_eq) / denom_attract;
                fmag = +k_attract * (1 - t);
            }

            a.fx += fmag * nx;
            a.fy += fmag * ny;
            b.fx -= fmag * nx;
            b.fy -= fmag * ny;
        }
    }
}

// 분자 무작위 배치 — overlap r_eq 회피 (rejection sampling)
function vaporPlaceMolecules(zone, count, r_eq, mbScale) {
    const placed = [];
    const r_eq2 = r_eq * r_eq;
    let attempts = 0;
    const maxAttempts = count * 200;
    while (placed.length < count && attempts < maxAttempts) {
        const x = zone.x + Math.random() * zone.w;
        const y = zone.y + Math.random() * zone.h;
        let ok = true;
        for (const m of placed) {
            const dx = m.x - x;
            const dy = m.y - y;
            if (dx * dx + dy * dy < r_eq2) { ok = false; break; }
        }
        if (ok) {
            const [vx, vy] = vaporMBVelocity(mbScale);
            placed.push(new Molecule(x, y, vx, vy));
        }
        attempts++;
    }
    if (placed.length < count) {
        console.warn(`[Vapor] 분자 배치: ${placed.length}/${count} 만 배치됨 (overlap 가드 한계 — V_liquid 영역 좁음). r_eq=${r_eq.toFixed(2)}px`);
    }
    return placed;
}

// =============================================================
// VaporWorld — 단일 fullZone (영역 분할 X). 액체/기체 자연 발생.
// =============================================================
class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;

        const innerW = this.canvasW - 2 * VAPOR_MARGIN_PX;
        const innerH = this.canvasH - 2 * VAPOR_MARGIN_PX;
        this.fullZone = { x: VAPOR_MARGIN_PX, y: VAPOR_MARGIN_PX, w: innerW, h: innerH };

        // 초기 분자 배치는 V_liquid : V_flask 비율로 박스 하부 영역에 한정 (응집 출발점)
        const liquidH = innerH * (vLiquidMl / vFlaskMl);
        const initZone = {
            x: VAPOR_MARGIN_PX,
            y: VAPOR_MARGIN_PX + (innerH - liquidH),
            w: innerW,
            h: liquidH,
        };

        // 초기 속도 — MB. 액체 거동 위해 mb_init_temp_K 낮게.
        // speedScale 단위: px/s. T=300K 기준 30 px/s 로 정규화.
        const speedScale = Math.sqrt((cfg.mb_init_temp_K ?? 280) / 300) * 30;
        const r = cfg.molecule_radius_px;
        const r_eq = cfg.r_eq_factor * r;

        this.molecules = vaporPlaceMolecules(initZone, cfg.N_molecules, r_eq, speedScale);

        this._lastStatsT = performance.now();
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);

        // 1) 힘 계산 (LJ-like piecewise)
        vaporComputeForces(this.molecules, this.cfg);

        // 2) 적분 (semi-implicit Euler) + 약한 중력
        const gy = this.cfg.gravity_y ?? 0.05;
        for (const m of this.molecules) {
            m.vx += (m.fx / m.mass) * cap;
            m.vy += (m.fy / m.mass + gy) * cap;
            m.x  += m.vx * cap;
            m.y  += m.vy * cap;
        }

        // 3) 박스 사방 벽 반사 + 위치 클램프
        const r = this.cfg.molecule_radius_px;
        const z = this.fullZone;
        const left = z.x + r, right = z.x + z.w - r;
        const top = z.y + r,  bottom = z.y + z.h - r;
        for (const m of this.molecules) {
            if (m.x < left  && m.vx < 0) m.vx = -m.vx;
            if (m.x > right && m.vx > 0) m.vx = -m.vx;
            if (m.y < top   && m.vy < 0) m.vy = -m.vy;
            if (m.y > bottom && m.vy > 0) m.vy = -m.vy;
            if (m.x < left)        m.x = left;
            else if (m.x > right)  m.x = right;
            if (m.y < top)         m.y = top;
            else if (m.y > bottom) m.y = bottom;
        }

        // 4) stats — 이웃 수 ≥ 4 인 분자 = clustered (1초 간격)
        this._maybeLogStats();
    }

    _maybeLogStats() {
        const now = performance.now();
        if (now - this._lastStatsT < 1000) return;
        const cutoff = this.cfg.cutoff_factor * this.cfg.molecule_radius_px;
        const cutoff2 = cutoff * cutoff;
        const n = this.molecules.length;
        let clustered = 0;
        for (let i = 0; i < n; i++) {
            let neighbors = 0;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const dx = this.molecules[i].x - this.molecules[j].x;
                const dy = this.molecules[i].y - this.molecules[j].y;
                if (dx * dx + dy * dy < cutoff2) {
                    neighbors++;
                    if (neighbors >= 4) break;
                }
            }
            if (neighbors >= 4) clustered++;
        }
        const free = n - clustered;
        console.log(`[Vapor] sub-step 1 · N=${n} · clustered(neighbors≥4)=${clustered} · free=${free}`);
        this._lastStatsT = now;
    }

    drawWalls(p) {
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        const z = this.fullZone;
        p.rect(z.x, z.y, z.w, z.h);
    }

    drawMolecules(p) {
        p.noStroke();
        p.fill(p.color(this.cfg.molecule_color || "#1E3A8A"));
        const r2 = (this.cfg.molecule_radius_px ?? 3.5) * 2;
        for (const m of this.molecules) {
            p.circle(m.x, m.y, r2);
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
