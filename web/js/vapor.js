// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b''' option Z — 표면 추상화)
//
// 액체 모델 (옵션 Z):
//   · 액체 박스 = 정적 영역, 반투명 진청 채움. 내부 입자 렌더 X.
//   · 표면 띠 안에 SurfaceParticle 만 가시화 (~40 개). 약한 KE.
//   · 중력 X — 분자간 인력이 중력보다 훨씬 강한 것이 액체 (직전
//     6.1-b'' 자유낙하 모델 결함, docs/17 §6 결정).
//
// 기체 모델: 자유 비행 + impulse exchange + 사방 벽 튕김. KE 색 lerp.
//
// 위상 통과:
//   · 액→기 (증발): 표면 입자 위 경계 도달 + KE > E_escape +
//     random() < p_evap → 사라지고 GasParticle 신규 발사.
//     조건 미충족 시 위 경계에서 튕김.
//   · 기→액 (응축): 기체 표면선 부근 + 아래로 이동 + KE < E_stick +
//     random() < p_condense → 사라지고 SurfaceParticle 신규
//     (표면 띠 안 무작위).
//
// 표면 풀 floor 가드: SurfaceParticle 수 0 까지 떨어지지 않도록
// 증발 평가 시 가드 (N_surface_particles 가 floor 역할).
// =============================================================

const VAPOR_DT_CAP = 0.05;
const VAPOR_MARGIN_PX = 12;
const GAS_PARTICLE_RADIUS = 2.5;

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

function vaporHexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return { r: 60, g: 60, b: 60 };
    return {
        r: parseInt(m[1].slice(0, 2), 16),
        g: parseInt(m[1].slice(2, 4), 16),
        b: parseInt(m[1].slice(4, 6), 16),
    };
}

class SurfaceParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
        this.radius = 6; // VaporWorld 가 cfg.surface_particle_radius_px 로 override
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy);
    }

    // band = {x, y, w, h}. 좌/우/아래만 튕김. 위 경계 처리는 호출자.
    update(dt, band) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const r = this.radius;
        const left = band.x + r, right = band.x + band.w - r;
        const bottom = band.y + band.h - r;
        if (this.x < left  && this.vx < 0) this.vx = -this.vx;
        if (this.x > right && this.vx > 0) this.vx = -this.vx;
        if (this.y > bottom && this.vy > 0) this.vy = -this.vy;
        if (this.x < left)        this.x = left;
        else if (this.x > right)  this.x = right;
        if (this.y > bottom)      this.y = bottom;
        // 위 경계 미처리 — VaporWorld._evaluateTransitions 가 KE 평가 후 탈출/튕김.
    }
}

class GasParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
        this.radius = GAS_PARTICLE_RADIUS;
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy);
    }

    update(dt, zone, gravityPx) {
        if (gravityPx) this.vy += gravityPx * dt;
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

// 입자-입자 탄성 충돌 (impulse exchange) — 등질량 단순화. O(N²).
// 본 모델에서 기체상에만 적용 (표면 입자 충돌 미적용 — option Z).
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
                    const j = -vn;
                    a.vx -= j * nx; a.vy -= j * ny;
                    b.vx += j * nx; b.vy += j * ny;
                    const overlap = (minD - dist) * 0.5;
                    a.x -= nx * overlap; a.y -= ny * overlap;
                    b.x += nx * overlap; b.y += ny * overlap;
                }
            }
        }
    }
}

class VaporFlash {
    constructor(x, y, rgb, dirY, ttlMs) {
        this.x = x;
        this.y = y;
        this.rgb = rgb;
        this.dirY = dirY;
        this.ttl = ttlMs;
        this.maxTtl = ttlMs;
    }
    update(dtMs) {
        this.ttl -= dtMs;
        this.y += this.dirY * 0.04 * dtMs;
    }
    isAlive() { return this.ttl > 0; }
}

// =============================================================
// VaporWorld
// =============================================================
class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;
        this.vGasMl = vFlaskMl - vLiquidMl;

        // V_liquid : V_gas 비율 영역 분할
        const innerW = this.canvasW - 2 * VAPOR_MARGIN_PX;
        const innerH = this.canvasH - 2 * VAPOR_MARGIN_PX;
        const liquidH = innerH * (vLiquidMl / vFlaskMl);
        const gasH = innerH - liquidH;
        this.surfaceY = VAPOR_MARGIN_PX + gasH;
        this.gasZone    = { x: VAPOR_MARGIN_PX, y: VAPOR_MARGIN_PX, w: innerW, h: gasH };
        this.liquidZone = { x: VAPOR_MARGIN_PX, y: this.surfaceY,  w: innerW, h: liquidH };

        // 표면 띠 — 표면선 위/아래 절반씩 (총 surface_band_px)
        const band = cfg.surface_band_px ?? 12;
        this.surfaceBand = {
            x: VAPOR_MARGIN_PX,
            y: this.surfaceY - band / 2,
            w: innerW,
            h: band,
        };

        // 입자 초기화: 표면 입자 N 개, 기체 진공
        this.surfaceParticles = [];
        this.gasParticles = [];
        this.flashes = [];

        const Ns = cfg.N_surface_particles ?? 40;
        const sgScale = cfg.speed_scale_gas ?? 80;
        const ssScale = sgScale * (cfg.surface_speed_scale ?? 0.3);
        const sRad = cfg.surface_particle_radius_px ?? 6;
        for (let i = 0; i < Ns; i++) {
            const x = this.surfaceBand.x + Math.random() * this.surfaceBand.w;
            const y = this.surfaceBand.y + Math.random() * this.surfaceBand.h;
            const [vx, vy] = vaporMBVelocity(ssScale);
            const sp = new SurfaceParticle(x, y, vx, vy);
            sp.radius = sRad;
            this.surfaceParticles.push(sp);
        }

        // 기체 중력 — option Z 기본 0. params.json 에 설정 시만 반영.
        this.gravityPx = (cfg.gravity ?? 0) * 1000;

        this._evapRgb = vaporHexToRgb(cfg.evap_color || "#3B82F6");
        this._condRgb = vaporHexToRgb(cfg.cond_color || "#F59E0B");
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);
        const dtMs = cap * 1000;

        // 1) 표면 입자 운동 (좌/우/아래 튕김. 위는 _evaluateTransitions가 처리)
        for (const sp of this.surfaceParticles) sp.update(cap, this.surfaceBand);
        // 2) 기체 입자 운동
        for (const gp of this.gasParticles) gp.update(cap, this.gasZone, this.gravityPx);
        // 3) 충돌 — 기체만 (option Z: 표면 입자 충돌 미적용)
        vaporResolveCollisions(this.gasParticles);
        // 4) 위상 통과
        this._evaluateTransitions();
        // 5) flash 진행
        for (const f of this.flashes) f.update(dtMs);
        this.flashes = this.flashes.filter(f => f.isAlive());
        // 6) stats (1초 간격 console)
        this._maybeLogStats();
    }

    _evaluateTransitions() {
        const cfg = this.cfg;
        const E_escape = cfg.E_escape;
        const E_stick = cfg.E_stick;
        const p_evap = cfg.p_evap;
        const p_condense = cfg.p_condense;
        const flashTtl = cfg.flash_duration_ms ?? 150;
        const gasMax = cfg.N_particles_gas_max ?? 30;
        const surfaceFloor = 1; // 표면 풀 floor — 0 으로 떨어지지 않도록

        // 증발: 표면 입자 위 경계 도달 시점 평가
        const remain = [];
        const topY = this.surfaceBand.y;
        for (const sp of this.surfaceParticles) {
            const r = sp.radius;
            if (sp.y < topY + r && sp.vy < 0) {
                const ke = sp.kineticEnergy();
                const canEvap = ke > E_escape
                              && Math.random() < p_evap
                              && this.gasParticles.length < gasMax * 3
                              && this.surfaceParticles.length > surfaceFloor;
                if (canEvap) {
                    // 탈출 — 기체 신규
                    const gx = sp.x;
                    const gy = this.surfaceY - GAS_PARTICLE_RADIUS - 1;
                    const gvx = sp.vx;
                    const gvy = -Math.abs(sp.vy) - 30; // 위쪽 강제
                    this.gasParticles.push(new GasParticle(gx, gy, gvx, gvy));
                    this.flashes.push(new VaporFlash(sp.x, this.surfaceY, this._evapRgb, -1, flashTtl));
                    this._evapWin++;
                    continue; // 표면에서 제거
                }
                // 미충족 — 위 경계에서 튕김
                sp.vy = -sp.vy;
                sp.y = topY + r;
            }
            remain.push(sp);
        }
        this.surfaceParticles = remain;

        // 응축: 기체 표면선 부근 + 아래로 이동 + KE < E_stick
        const remainGas = [];
        for (const gp of this.gasParticles) {
            const ke = gp.kineticEnergy();
            const distAboveSurface = this.surfaceY - gp.y;
            const nearSurface = (distAboveSurface >= 0 && distAboveSurface <= 6 && gp.vy > 0);
            if (nearSurface && ke < E_stick && Math.random() < p_condense) {
                // 표면 입자 신규 (표면 띠 안 무작위 위치)
                const nx = this.surfaceBand.x + Math.random() * this.surfaceBand.w;
                const ny = this.surfaceBand.y + Math.random() * this.surfaceBand.h;
                const nvx = (Math.random() - 0.5) * 4;
                const nvy = (Math.random() - 0.5) * 4;
                const sp = new SurfaceParticle(nx, ny, nvx, nvy);
                sp.radius = this.cfg.surface_particle_radius_px ?? 6;
                this.surfaceParticles.push(sp);
                this.flashes.push(new VaporFlash(gp.x, this.surfaceY, this._condRgb, +1, flashTtl));
                this._condWin++;
                continue;
            }
            remainGas.push(gp);
        }
        this.gasParticles = remainGas;
    }

    _maybeLogStats() {
        const now = performance.now();
        const elapsed = now - this._lastStatsT;
        if (elapsed >= 1000) {
            const rateScale = 1000 / elapsed;
            const evapRate = (this._evapWin * rateScale).toFixed(1);
            const condRate = (this._condWin * rateScale).toFixed(1);
            console.log(`[Vapor] evap=${evapRate}/s · cond=${condRate}/s · S=${this.surfaceParticles.length} · G=${this.gasParticles.length}`);
            this._evapWin = 0;
            this._condWin = 0;
            this._lastStatsT = now;
        }
    }

    drawZones(p) {
        // 기체 영역 (상부) — 외곽선
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(this.gasZone.x, this.gasZone.y, this.gasZone.w, this.gasZone.h);
        // 액체 영역 (하부) — 반투명 채움 (option Z 핵심: 입자 안 그림)
        const fillStr = this.cfg.liquid_fill_color || "rgba(30, 64, 175, 0.3)";
        if (p.drawingContext) {
            p.drawingContext.fillStyle = fillStr;
            p.drawingContext.fillRect(this.liquidZone.x, this.liquidZone.y, this.liquidZone.w, this.liquidZone.h);
        }
        p.noFill();
        p.stroke(120, 150, 200);
        p.rect(this.liquidZone.x, this.liquidZone.y, this.liquidZone.w, this.liquidZone.h);

        // 가상 표면 — 점선
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
        const cfg = this.cfg;
        const sRad = cfg.surface_particle_radius_px ?? 6;
        const surfPColor = p.color(cfg.surface_particle_color || "#1E40AF");

        // 표면 입자 — 진청 단색
        p.noStroke();
        p.fill(surfPColor);
        for (const sp of this.surfaceParticles) {
            p.circle(sp.x, sp.y, sRad * 2);
        }

        // 기체 — KE lerp (느림=연청 ↔ 빠름=빨강)
        const refKE = 0.5 * Math.pow(cfg.speed_scale_gas ?? 80, 2);
        const slow = p.color("#60A5FA");
        const fast = p.color("#EF4444");
        for (const gp of this.gasParticles) {
            const ratio = Math.min(gp.kineticEnergy() / refKE, 1.5);
            const t = Math.min(ratio / 1.2, 1);
            p.fill(p.lerpColor(slow, fast, t));
            p.circle(gp.x, gp.y, GAS_PARTICLE_RADIUS * 2);
        }

        // flashes (트레일 3점)
        for (const f of this.flashes) {
            const a0 = 220 * (f.ttl / f.maxTtl);
            p.fill(f.rgb.r, f.rgb.g, f.rgb.b, a0);
            p.circle(f.x, f.y, 14);
            p.fill(f.rgb.r, f.rgb.g, f.rgb.b, a0 * 0.45);
            p.circle(f.x, f.y - f.dirY * 8,  10);
            p.fill(f.rgb.r, f.rgb.g, f.rgb.b, a0 * 0.20);
            p.circle(f.x, f.y - f.dirY * 16,  6);
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
            world.drawZones(p);
            world.drawParticles(p);
        };
    };
    return new p5(sketch, container);
}
