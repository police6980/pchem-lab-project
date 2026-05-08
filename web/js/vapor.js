// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b)
//
// 본 step 범위:
//   · 입자 클래스 (위치·속도·KE·렌더) — 보일 패턴 재사용
//   · 입자-벽 충돌, 입자-입자 충돌 (impulse exchange)
//   · 액체상·기체상 zone 박스 + 가상 표면
//   · p5 instance mode setup/draw 루프
//   · Maxwell-Boltzmann 초기 속도
//
// 미포함 (후속 step):
//   · 위상 통과 (증발/응축)·응집력(중력) — 6.1-c
//   · 카운터·rate·평형도 그래프 — 6.1-d
//   · 모드 분기 (mock/ws/real/vernier) — 6.2~6.4
//   · AI 튜터 통합 — 6.4
//
// 본 step 에서 입자는 액체상·기체상 zone 안에서만 운동. 통과 X.
// =============================================================

const VAPOR_PARTICLE_RADIUS = 2.5;
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

class VaporParticle {
    constructor(x, y, vx, vy, phase) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
        this.radius = VAPOR_PARTICLE_RADIUS;
        this.phase = phase; // "liquid" | "gas". 6.1-b 잠금. 6.1-c 부터 변경 가능.
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy);
    }

    // zone = { x, y, w, h }. 박스 안에서 벽 충돌 후 위치 클램프.
    update(dt, zone) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const r = this.radius;
        const left = zone.x + r, right = zone.x + zone.w - r;
        const top = zone.y + r, bottom = zone.y + zone.h - r;
        if (this.x < left  && this.vx < 0) this.vx = -this.vx;
        if (this.x > right && this.vx > 0) this.vx = -this.vx;
        if (this.y < top   && this.vy < 0) this.vy = -this.vy;
        if (this.y > bottom && this.vy > 0) this.vy = -this.vy;
        if (this.x < left)        this.x = left;
        else if (this.x > right)  this.x = right;
        if (this.y < top)         this.y = top;
        else if (this.y > bottom) this.y = bottom;
    }
}

// 입자-입자 탄성 충돌 (impulse exchange) — 동일 mass=1 가정.
// O(N²) 단순 구현. 본 step 입자 수 (~200 + 10) 에서 50fps 여유 충분.
// 향후 입자 수 증가 시 spatial hash 도입 검토.
function vaporResolveCollisions(particles) {
    const n = particles.length;
    for (let i = 0; i < n; i++) {
        const a = particles[i];
        for (let j = i + 1; j < n; j++) {
            const b = particles[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const minD = a.radius + b.radius;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < minD * minD && dist2 > 1e-9) {
                const dist = Math.sqrt(dist2);
                const nx = dx / dist, ny = dy / dist;
                const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
                const vn = dvx * nx + dvy * ny;
                if (vn < 0) {
                    // m_a = m_b = 1 → impulse j = -vn (등질량 단순화)
                    const j = -vn;
                    a.vx -= j * nx;
                    a.vy -= j * ny;
                    b.vx += j * nx;
                    b.vy += j * ny;
                    const overlap = (minD - dist) * 0.5;
                    a.x -= nx * overlap; a.y -= ny * overlap;
                    b.x += nx * overlap; b.y += ny * overlap;
                }
            }
        }
    }
}

// =============================================================
// VaporWorld — 시뮬 상태 보유. p5 instance 가 update / draw 호출.
// =============================================================
class VaporWorld {
    constructor(vaporParams, vFlaskMl, vLiquidMl) {
        this.cfg = vaporParams;
        this.canvasW = vaporParams.canvas_width_px;
        this.canvasH = vaporParams.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;
        this.vGasMl = vFlaskMl - vLiquidMl;

        // V_liquid : V_gas 비율로 영역 분할. 액체 = 하부, 기체 = 상부.
        const innerW = this.canvasW - 2 * VAPOR_MARGIN_PX;
        const innerH = this.canvasH - 2 * VAPOR_MARGIN_PX;
        const liquidH = innerH * (vLiquidMl / vFlaskMl);
        const gasH = innerH - liquidH;
        this.surfaceY = VAPOR_MARGIN_PX + gasH;
        this.gasZone    = { x: VAPOR_MARGIN_PX, y: VAPOR_MARGIN_PX, w: innerW, h: gasH };
        this.liquidZone = { x: VAPOR_MARGIN_PX, y: this.surfaceY,  w: innerW, h: liquidH };

        // 입자 초기화 — MB 분포.
        this.gasParticles = [];
        this.liquidParticles = [];
        const Ng = vaporParams.N_particles_gas_init;
        const Nl = vaporParams.N_particles_liquid;
        const sg = vaporParams.speed_scale_gas;
        const sl = vaporParams.speed_scale_liquid;

        for (let i = 0; i < Ng; i++) {
            const px = this.gasZone.x + Math.random() * this.gasZone.w;
            const py = this.gasZone.y + Math.random() * this.gasZone.h;
            const [vx, vy] = vaporMBVelocity(sg);
            this.gasParticles.push(new VaporParticle(px, py, vx, vy, "gas"));
        }
        for (let i = 0; i < Nl; i++) {
            const px = this.liquidZone.x + Math.random() * this.liquidZone.w;
            const py = this.liquidZone.y + Math.random() * this.liquidZone.h;
            const [vx, vy] = vaporMBVelocity(sl);
            this.liquidParticles.push(new VaporParticle(px, py, vx, vy, "liquid"));
        }
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);
        for (const p of this.gasParticles)    p.update(cap, this.gasZone);
        for (const p of this.liquidParticles) p.update(cap, this.liquidZone);
        vaporResolveCollisions(this.gasParticles);
        vaporResolveCollisions(this.liquidParticles);
    }

    drawZones(p) {
        // 기체 영역 (상부) — 외곽선만
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(this.gasZone.x, this.gasZone.y, this.gasZone.w, this.gasZone.h);
        // 액체 영역 (하부) — 연한 청색 배경 + 외곽
        p.noStroke();
        p.fill(225, 238, 250);
        p.rect(this.liquidZone.x, this.liquidZone.y, this.liquidZone.w, this.liquidZone.h);
        p.noFill();
        p.stroke(160, 195, 230);
        p.rect(this.liquidZone.x, this.liquidZone.y, this.liquidZone.w, this.liquidZone.h);
        // 가상 표면 — 점선 (액-기 경계 가시화)
        const surfColor = p.color(this.cfg.surface_color || "#3B82F6");
        p.stroke(surfColor);
        p.strokeWeight(2);
        if (p.drawingContext && typeof p.drawingContext.setLineDash === "function") {
            p.drawingContext.setLineDash([8, 5]);
            p.line(this.gasZone.x, this.surfaceY, this.gasZone.x + this.gasZone.w, this.surfaceY);
            p.drawingContext.setLineDash([]);
        } else {
            p.line(this.gasZone.x, this.surfaceY, this.gasZone.x + this.gasZone.w, this.surfaceY);
        }
    }

    drawParticles(p) {
        const liquidColor = p.color(this.cfg.liquid_color_base || "#1E40AF");
        const gasColor    = p.color(this.cfg.gas_color_base    || "#60A5FA");
        p.noStroke();
        p.fill(gasColor);
        for (const part of this.gasParticles) {
            p.circle(part.x, part.y, part.radius * 2);
        }
        p.fill(liquidColor);
        for (const part of this.liquidParticles) {
            p.circle(part.x, part.y, part.radius * 2);
        }
    }
}

// =============================================================
// p5 instance mount — vapor.html 의 컨테이너 div 에 캔버스 부착.
// 반환값으로 instance 핸들 노출 (리셋 시 .remove() 호출).
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
            world.drawZones(p);
            world.drawParticles(p);
        };
    };
    return new p5(sketch, container);
}
