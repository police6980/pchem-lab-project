// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b'' 하이브리드 액체 모델)
//
// 액체상 모델: 빽빽한 무작위 분포 + 자유 이동 + 저 KE.
//   - 격자·진동 모델 폐기 (고체 인상 회피, docs/17 §6 결정)
//   - 균일 중력으로 자연 sedimentation
//   - 표면 근처 입자 시각 강조 — 탈출 후보군 시선 유도
//
// 기체상 모델: 보일 자유 비행 + impulse exchange + KE 색 매핑.
//
// 위상 통과 (증발/응축):
//   - 액→기: KE > E_escape AND 표면 근처 AND random() < p_evap
//   - 기→액: 표면 충돌 AND KE < E_stick AND random() < p_condense
//   - 사건 시 색별 flash + 트레일
//
// 미포함 (후속): 카운터/rate 그래프 (6.1-d), 모드 분기 (6.2~6.4),
// AI 튜터 (6.4).
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

class LiquidParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
        this.radius = 6;       // drawParticles 시 cfg 로 override
        this.isSurface = false;
    }

    update(dt, zone, gravityPx) {
        this.vy += gravityPx * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const r = this.radius;
        const left = zone.x + r, right = zone.x + zone.w - r;
        const top = zone.y + r, bottom = zone.y + zone.h - r;
        if (this.x < left  && this.vx < 0) this.vx = -this.vx;
        if (this.x > right && this.vx > 0) this.vx = -this.vx;
        if (this.y < top   && this.vy < 0) this.vy = -this.vy;
        if (this.y > bottom && this.vy > 0) this.vy = -this.vy * 0.5; // 바닥 반발 약화 (sedimentation)
        if (this.x < left)        this.x = left;
        else if (this.x > right)  this.x = right;
        if (this.y < top)         this.y = top;
        else if (this.y > bottom) this.y = bottom;
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
        this.vy += gravityPx * dt;
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
// 액체상은 빽빽해 충돌 빈번 → spatial hashing 도입은 성능 저하 시 후속.
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

// flash — 위상 통과 사건 시 색 잔상 + 트레일
class VaporFlash {
    constructor(x, y, rgb, dirY, ttlMs) {
        this.x = x;
        this.y = y;
        this.rgb = rgb;        // {r,g,b}
        this.dirY = dirY;      // -1 (증발/위) | +1 (응축/아래)
        this.ttl = ttlMs;
        this.maxTtl = ttlMs;
    }
    update(dtMs) {
        this.ttl -= dtMs;
        // 잔상이 살짝 진행 방향으로 이동 → 트레일 인상
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

        // V_liquid : V_gas 비율로 영역 분할
        const innerW = this.canvasW - 2 * VAPOR_MARGIN_PX;
        const innerH = this.canvasH - 2 * VAPOR_MARGIN_PX;
        const liquidH = innerH * (vLiquidMl / vFlaskMl);
        const gasH = innerH - liquidH;
        this.surfaceY = VAPOR_MARGIN_PX + gasH;
        this.gasZone    = { x: VAPOR_MARGIN_PX, y: VAPOR_MARGIN_PX, w: innerW, h: gasH };
        this.liquidZone = { x: VAPOR_MARGIN_PX, y: this.surfaceY,  w: innerW, h: liquidH };

        // 초기 상태: 액체 N 개 + 기체 진공 (0)
        this.liquidParticles = [];
        this.gasParticles = [];
        this.flashes = [];

        const Nl = cfg.N_particles_liquid;
        const sgScale = cfg.speed_scale_gas;
        const slScale = sgScale * (cfg.liquid_speed_scale ?? 0.2);
        for (let i = 0; i < Nl; i++) {
            const x = this.liquidZone.x + Math.random() * this.liquidZone.w;
            const y = this.liquidZone.y + Math.random() * this.liquidZone.h;
            const [vx, vy] = vaporMBVelocity(slScale);
            this.liquidParticles.push(new LiquidParticle(x, y, vx, vy));
        }

        // gravity — cfg.gravity (정규화) × 1000 → px/s²
        this.gravityPx = (cfg.gravity ?? 0.05) * 1000;

        // 색 캐시
        this._evapRgb = vaporHexToRgb(cfg.evap_color || "#3B82F6");
        this._condRgb = vaporHexToRgb(cfg.cond_color || "#F59E0B");

        // 통계 (1초 윈도우)
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);
        const dtMs = cap * 1000;

        // 1) 운동
        for (const p of this.liquidParticles) p.update(cap, this.liquidZone, this.gravityPx);
        for (const p of this.gasParticles)    p.update(cap, this.gasZone,    this.gravityPx);

        // 2) 충돌
        vaporResolveCollisions(this.liquidParticles);
        vaporResolveCollisions(this.gasParticles);

        // 3) 표면 강조 마킹 (액체 입자 isSurface)
        const surfBand = this.cfg.surface_band_px ?? 12;
        for (const p of this.liquidParticles) {
            const distFromSurface = p.y - this.surfaceY;  // 표면이 위, 액체는 아래
            p.isSurface = (distFromSurface >= 0 && distFromSurface <= surfBand);
        }

        // 4) 위상 통과
        this._evaluateTransitions();

        // 5) flash 진행
        for (const f of this.flashes) f.update(dtMs);
        this.flashes = this.flashes.filter(f => f.isAlive());

        // 6) 통계 출력 (1초 간격)
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

        // 증발: 액체 표면 입자 + KE > E_escape + p_evap
        const remainLiquid = [];
        for (const lp of this.liquidParticles) {
            const ke = 0.5 * (lp.vx * lp.vx + lp.vy * lp.vy);
            if (lp.isSurface && ke > E_escape && Math.random() < p_evap
                && this.gasParticles.length < gasMax * 3) {
                // 기체 신규 — 표면 위쪽으로 발사
                const gx = lp.x;
                const gy = this.surfaceY - GAS_PARTICLE_RADIUS - 1;
                const gvx = lp.vx;
                const gvy = -Math.abs(lp.vy) - 30;
                this.gasParticles.push(new GasParticle(gx, gy, gvx, gvy));
                this.flashes.push(new VaporFlash(lp.x, this.surfaceY, this._evapRgb, -1, flashTtl));
                this._evapWin++;
                continue;
            }
            remainLiquid.push(lp);
        }
        this.liquidParticles = remainLiquid;

        // 응축: 기체 표면 충돌 + 아래로 이동 + KE < E_stick + p_condense
        const remainGas = [];
        for (const gp of this.gasParticles) {
            const ke = gp.kineticEnergy();
            const distAboveSurface = this.surfaceY - gp.y;
            const nearSurface = (distAboveSurface >= 0 && distAboveSurface <= 6 && gp.vy > 0);
            if (nearSurface && ke < E_stick && Math.random() < p_condense) {
                const nx = this.liquidZone.x + Math.random() * this.liquidZone.w;
                const ny = this.liquidZone.y + Math.random() * this.liquidZone.h;
                const nvx = (Math.random() - 0.5) * 4;
                const nvy = (Math.random() - 0.5) * 4;
                this.liquidParticles.push(new LiquidParticle(nx, ny, nvx, nvy));
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
            console.log(`[Vapor] evap=${evapRate}/s · cond=${condRate}/s · L=${this.liquidParticles.length} · G=${this.gasParticles.length}`);
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
        // 액체 영역 (하부) — 연한 청 배경
        p.noStroke();
        p.fill(225, 238, 250);
        p.rect(this.liquidZone.x, this.liquidZone.y, this.liquidZone.w, this.liquidZone.h);
        p.noFill();
        p.stroke(160, 195, 230);
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
        const radL = cfg.liquid_particle_radius_px ?? 6;
        const radS = cfg.surface_particle_radius_px ?? 8;
        const liquidBase = p.color(cfg.liquid_color_base || "#1E40AF");
        const liquidSurf = p.color(cfg.liquid_surface_color || "#2563EB");

        p.noStroke();
        // 액체 — 표면 근처는 강조
        for (const lp of this.liquidParticles) {
            if (lp.isSurface) {
                p.fill(liquidSurf);
                p.circle(lp.x, lp.y, radS);
            } else {
                p.fill(liquidBase);
                p.circle(lp.x, lp.y, radL);
            }
        }

        // 기체 — KE 단순 lerp (느림=연청 ↔ 빠름=빨강). 보일 HSB 의 단순화 버전.
        const refKE = 0.5 * Math.pow(cfg.speed_scale_gas ?? 80, 2);
        const slow = p.color("#60A5FA");
        const fast = p.color("#EF4444");
        for (const gp of this.gasParticles) {
            const ratio = Math.min(gp.kineticEnergy() / refKE, 1.5);
            const t = Math.min(ratio / 1.2, 1);
            p.fill(p.lerpColor(slow, fast, t));
            p.circle(gp.x, gp.y, GAS_PARTICLE_RADIUS * 2);
        }

        // flash + 트레일 (단순 3 점)
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
