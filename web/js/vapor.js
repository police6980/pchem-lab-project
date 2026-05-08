// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b sub-step 1, 응집 영역 모델)
//
// 핵심 원칙 (LJ 폐기 후 신규):
//   · 분자 200 개 항상 가시. 사라지지 않음. 같은 풀.
//   · 분자간 인력 X. 분자-분자 hard sphere 반발만 (overlap 방지).
//   · 응집 영역 (박스 하부) 에 외부 끌어당김 가속도장.
//   · 영역 가장자리 + 영역 밖 분자에 +y 가속도 (영역 안으로 끌어당김).
//   · 분자 KE > escape_threshold_KE 시 끌어당김 무력화 → 탈출 (증발).
//   · 자유 비행 분자가 영역 진입 → 끌어당김에 잡힘 (응축).
//
// 분자 phase 플래그 X. 색만 위치 기반 자동:
//   · y >= zoneTopY (영역 안): 진청 단색 #1E3A8A
//   · y <  zoneTopY (영역 밖): KE HSB lerp (느림 청 → 빠름 적)
//
// LJ-like 모델 폐기 사유: N=200 학교 시뮬에서 안정 응집 실패 (분자
// 균등 분포 = 그냥 기체). 자연 정합성 일부 손실 대신 시각 결과 단순 달성.
// 학습 인지에 미치는 차이 없음 (docs/17 §6 정직한 한계 참조).
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
        this.mass = 1.0;
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy);
    }
}

// Hard sphere 반발 — d < 2r 시 normal 방향 impulse + 위치 분리. 인력 X.
function vaporResolveCollisions(molecules, radius) {
    const minD = 2 * radius;
    const minD2 = minD * minD;
    const n = molecules.length;
    for (let i = 0; i < n; i++) {
        const a = molecules[i];
        for (let j = i + 1; j < n; j++) {
            const b = molecules[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2 && d2 > 1e-9) {
                const d = Math.sqrt(d2);
                const nx = dx / d, ny = dy / d;
                const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
                const vn = dvx * nx + dvy * ny;
                if (vn < 0) {
                    const j = -vn;
                    a.vx -= j * nx; a.vy -= j * ny;
                    b.vx += j * nx; b.vy += j * ny;
                    const overlap = (minD - d) * 0.5;
                    a.x -= nx * overlap; a.y -= ny * overlap;
                    b.x += nx * overlap; b.y += ny * overlap;
                }
            }
        }
    }
}

// 분자 무작위 배치 — 최소 거리 2r overlap 회피
function vaporPlaceMolecules(zone, count, minDist, mbScale) {
    const placed = [];
    const minDist2 = minDist * minDist;
    let attempts = 0;
    const maxAttempts = count * 200;
    while (placed.length < count && attempts < maxAttempts) {
        const x = zone.x + Math.random() * zone.w;
        const y = zone.y + Math.random() * zone.h;
        let ok = true;
        for (const m of placed) {
            const dx = m.x - x;
            const dy = m.y - y;
            if (dx * dx + dy * dy < minDist2) { ok = false; break; }
        }
        if (ok) {
            const [vx, vy] = vaporMBVelocity(mbScale);
            placed.push(new Molecule(x, y, vx, vy));
        }
        attempts++;
    }
    if (placed.length < count) {
        console.warn(`[Vapor] 분자 배치: ${placed.length}/${count} 만 배치됨 (영역 좁음). minDist=${minDist.toFixed(2)}px`);
    }
    return placed;
}

// =============================================================
// VaporWorld — 응집 영역 + 외부 끌어당김 가속도장
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

        // 응집 영역 = 박스 하부, V_liquid:V_gas 비율
        const liquidH = innerH * (vLiquidMl / vFlaskMl);
        this.zoneTopY = VAPOR_MARGIN_PX + (innerH - liquidH);

        // 초기 배치 — 응집 영역 안 무작위
        const initZone = {
            x: VAPOR_MARGIN_PX,
            y: this.zoneTopY,
            w: innerW,
            h: liquidH,
        };
        const r = cfg.molecule_radius_px;
        const speedScale = Math.sqrt((cfg.mb_init_temp_K ?? 280) / 300) * 30;
        this.molecules = vaporPlaceMolecules(initZone, cfg.N_molecules, 2 * r, speedScale);

        this._lastStatsT = performance.now();
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);

        const cfg = this.cfg;
        const gy           = cfg.g_y ?? 0.05;
        const yPullWeak    = cfg.y_pull_weak ?? 0.1;
        const yPullStrong  = cfg.y_pull_strong ?? 0.3;
        const pullMargin   = cfg.pull_margin_px ?? 30;
        const escapeKE     = cfg.escape_threshold_KE ?? 4.0;
        const zoneTop      = this.zoneTopY;

        // 1) 외력 계산 + 적분 (semi-implicit Euler)
        for (const m of this.molecules) {
            // 균일 중력
            let ay = gy;
            // 응집 영역 끌어당김 — KE 가드
            const ke = m.kineticEnergy();
            if (ke <= escapeKE) {
                if (m.y >= zoneTop) {
                    ay += yPullStrong;
                } else if (m.y >= zoneTop - pullMargin) {
                    ay += yPullWeak;
                }
            }
            // KE > escapeKE: 끌어당김 무력화 (탈출 가능)

            m.vy += ay * cap;
            m.x  += m.vx * cap;
            m.y  += m.vy * cap;
        }

        // 2) 분자-분자 hard sphere 반발 (인력 X)
        vaporResolveCollisions(this.molecules, cfg.molecule_radius_px);

        // 3) 박스 사방 벽 반사 + 위치 클램프
        const r = cfg.molecule_radius_px;
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

        // 4) stats
        this._maybeLogStats();
    }

    _maybeLogStats() {
        const now = performance.now();
        if (now - this._lastStatsT < 1000) return;
        let inZone = 0, outZone = 0;
        for (const m of this.molecules) {
            if (m.y >= this.zoneTopY) inZone++;
            else outZone++;
        }
        console.log(`[Vapor] sub-step 1 (cohesion zone) · in_zone=${inZone} · out_zone=${outZone}`);
        this._lastStatsT = now;
    }

    drawWalls(p) {
        // 박스 사방 테두리
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        const z = this.fullZone;
        p.rect(z.x, z.y, z.w, z.h);

        // 응집 영역 위 경계 — 점선 (학생 시각 단서)
        p.stroke(120, 150, 200, 140);
        p.strokeWeight(1);
        if (p.drawingContext && typeof p.drawingContext.setLineDash === "function") {
            p.drawingContext.setLineDash([4, 4]);
            p.line(z.x, this.zoneTopY, z.x + z.w, this.zoneTopY);
            p.drawingContext.setLineDash([]);
        } else {
            p.line(z.x, this.zoneTopY, z.x + z.w, this.zoneTopY);
        }
    }

    drawMolecules(p) {
        const r2 = (this.cfg.molecule_radius_px ?? 3.5) * 2;
        const liquidColor = p.color(this.cfg.molecule_color_liquid || "#1E3A8A");
        const slow = p.color("#60A5FA");
        const fast = p.color("#EF4444");
        // refKE — mb_init_temp_K 기준 평균 KE 의 4 배에서 fully fast 색
        const refSpeed = Math.sqrt((this.cfg.mb_init_temp_K ?? 280) / 300) * 30;
        const refKE = 0.5 * refSpeed * refSpeed;
        const fastKE = refKE * 4;

        p.noStroke();
        for (const m of this.molecules) {
            if (m.y >= this.zoneTopY) {
                p.fill(liquidColor);
            } else {
                const ke = m.kineticEnergy();
                const t = Math.min(ke / fastKE, 1);
                p.fill(p.lerpColor(slow, fast, t));
            }
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
