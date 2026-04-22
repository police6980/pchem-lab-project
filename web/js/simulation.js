// Particle system, box geometry, physics update loop

const BOX_INITIAL_X = 40;
const BOX_INITIAL_Y = 55;
const BOX_INITIAL_WIDTH = 600;
const BOX_INITIAL_HEIGHT = 250;
const DEFAULT_SPEED_SCALE = 120;
const DT_CAP = 0.05;
// Tuned with particle_count=300 so steady-state overlap stays under ~15 pairs/frame.
// Overlap scales ~ N^2 * r^2, so both knobs move together when retuning density.
const PARTICLE_RADIUS = 2.5;
const BOX_MIN_WIDTH = 200;
const BOX_MAX_WIDTH = 760;

function boxMullerStandardNormal() {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

class Particle {
    constructor(x, y, vx, vy, radius = PARTICLE_RADIUS) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
        this.radius = radius;
    }

    update(dt, box) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const r = this.radius;
        const left = box.x + r;
        const right = box.x + box.width - r;
        const top = box.y + r;
        const bottom = box.y + box.height - r;

        let collision = null;
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

        // Only trigger a collision if the particle is both outside the wall
        // AND moving into it. The velocity-direction check prevents spurious
        // collisions when the box shrinks faster than the particle can move.
        if (this.x < left && this.vx < 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vx), speed };
            this.vx = -this.vx;
        } else if (this.x > right && this.vx > 0) {
            collision = { isPiston: true, momentumTransfer: 2 * this.mass * Math.abs(this.vx), speed };
            this.vx = -this.vx;
        } else if (this.y < top && this.vy < 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vy), speed };
            this.vy = -this.vy;
        } else if (this.y > bottom && this.vy > 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vy), speed };
            this.vy = -this.vy;
        }

        if (this.x < left) this.x = left;
        else if (this.x > right) this.x = right;
        if (this.y < top) this.y = top;
        else if (this.y > bottom) this.y = bottom;

        if (collision) {
            collision.x = this.x;
            collision.y = this.y;
        }
        return collision;
    }
}

class GhostParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
    }

    update(dt, box) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        let pistonHit = false;
        if (this.x < box.x && this.vx < 0) {
            this.vx = -this.vx;
            this.x = box.x;
        } else if (this.x > box.x + box.width && this.vx > 0) {
            this.vx = -this.vx;
            this.x = box.x + box.width;
            pistonHit = true;
        }
        if (this.y < box.y && this.vy < 0) {
            this.vy = -this.vy;
            this.y = box.y;
        } else if (this.y > box.y + box.height && this.vy > 0) {
            this.vy = -this.vy;
            this.y = box.y + box.height;
        }
        return pistonHit;
    }
}

class Box {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.targetWidth = width;
    }

    update(dt, volumeTauSec) {
        this.width += (this.targetWidth - this.width) * (dt / volumeTauSec);
    }

    getPistonLength() {
        return this.height;
    }

    getArea() {
        return this.width * this.height;
    }

    setTargetFromPressure(currentP, P0, V0) {
        const targetArea = P0 * V0 / currentP;
        let targetWidth = targetArea / this.height;
        // Layout guard: renderer's CYLINDER_RIGHT is computed from BOX_MAX_WIDTH,
        // so this cap is what keeps the piston travel inside the cylinder shell.
        targetWidth = Math.max(BOX_MIN_WIDTH, Math.min(BOX_MAX_WIDTH, targetWidth));
        this.targetWidth = targetWidth;
    }
}

class ParticleSystem {
    constructor(particleCount, box, initialSpeedScale = DEFAULT_SPEED_SCALE, ghostCount = 2700, particleRadius = PARTICLE_RADIUS) {
        this.box = box;
        this.particles = [];
        for (let i = 0; i < particleCount; i++) {
            const x = box.x + particleRadius + Math.random() * (box.width - 2 * particleRadius);
            const y = box.y + particleRadius + Math.random() * (box.height - 2 * particleRadius);
            const vx = boxMullerStandardNormal() * initialSpeedScale;
            const vy = boxMullerStandardNormal() * initialSpeedScale;
            this.particles.push(new Particle(x, y, vx, vy, particleRadius));
        }

        // Statistics-only pool. Same Maxwell-Boltzmann draw as real particles,
        // no radius, no inter-particle collisions, never rendered. Boosts the
        // histogram sample count without visual clutter.
        this.ghosts = [];
        for (let i = 0; i < ghostCount; i++) {
            const x = box.x + Math.random() * box.width;
            const y = box.y + Math.random() * box.height;
            const vx = boxMullerStandardNormal() * initialSpeedScale;
            const vy = boxMullerStandardNormal() * initialSpeedScale;
            this.ghosts.push(new GhostParticle(x, y, vx, vy));
        }

        this.lastPistonCollisions = [];
        this._ghostPistonHits = 0;
        this._overlapPairCount = 0;

        // Random placement may leave pairs overlapping. Resolve them before
        // physics starts. Cap iterations so a stuck cluster can't hang boot.
        for (let i = 0; i < 10; i++) {
            if (this._resolveParticleCollisions() === 0) break;
        }
        this._overlapPairCount = 0;

        // Tighter RMS estimate: average across particles + ghosts (3000 samples)
        // instead of 300. Anchors the renderer's color scale near the true M-B.
        let sumSq = 0;
        const total = this.particles.length + this.ghosts.length;
        for (const p of this.particles) sumSq += p.vx * p.vx + p.vy * p.vy;
        for (const g of this.ghosts) sumSq += g.vx * g.vx + g.vy * g.vy;
        this._initialAvgSpeed = total > 0 ? Math.sqrt(sumSq / total) : 0;
    }

    update(dt) {
        if (dt > DT_CAP) dt = DT_CAP;
        this.lastPistonCollisions = [];
        for (const p of this.particles) {
            const col = p.update(dt, this.box);
            if (col && col.isPiston) {
                this.lastPistonCollisions.push(col);
            }
        }
        this._overlapPairCount += this._resolveParticleCollisions();

        let ghostHits = 0;
        for (const g of this.ghosts) {
            if (g.update(dt, this.box)) ghostHits++;
        }
        this._ghostPistonHits = ghostHits;
    }

    // Called after Box.update shrinks the box. The per-tick wall logic only
    // reflects particles that are outside AND moving further out; a particle
    // left stranded outside a newly-shrunk piston while moving inward would
    // otherwise cross the box again unhindered. This pass rescues them.
    clampParticlesIntoBox() {
        const r = PARTICLE_RADIUS;
        const left = this.box.x;
        const right = this.box.x + this.box.width;
        const top = this.box.y;
        const bottom = this.box.y + this.box.height;

        for (const p of this.particles) {
            if (p.x - r < left) {
                p.x = left + r;
                if (p.vx < 0) p.vx = -p.vx;
            }
            if (p.x + r > right) {
                p.x = right - r;
                if (p.vx > 0) p.vx = -p.vx;
            }
            if (p.y - r < top) {
                p.y = top + r;
                if (p.vy < 0) p.vy = -p.vy;
            }
            if (p.y + r > bottom) {
                p.y = bottom - r;
                if (p.vy > 0) p.vy = -p.vy;
            }
        }

        for (const g of this.ghosts) {
            if (g.x < left) { g.x = left; if (g.vx < 0) g.vx = -g.vx; }
            if (g.x > right) { g.x = right; if (g.vx > 0) g.vx = -g.vx; }
            if (g.y < top) { g.y = top; if (g.vy < 0) g.vy = -g.vy; }
            if (g.y > bottom) { g.y = bottom; if (g.vy > 0) g.vy = -g.vy; }
        }
    }

    _resolveParticleCollisions() {
        const particles = this.particles;
        const n = particles.length;
        let pairCount = 0;

        for (let i = 0; i < n; i++) {
            const p1 = particles[i];
            for (let j = i + 1; j < n; j++) {
                const p2 = particles[j];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const rSum = p1.radius + p2.radius;
                const distSq = dx * dx + dy * dy;
                if (distSq >= rSum * rSum) continue;

                pairCount++;

                const dist = Math.sqrt(distSq);
                let nx, ny;
                if (dist < 1e-9) {
                    nx = 1; ny = 0;
                } else {
                    nx = dx / dist;
                    ny = dy / dist;
                }

                const half = (rSum - dist) * 0.5;
                p1.x -= nx * half;
                p1.y -= ny * half;
                p2.x += nx * half;
                p2.y += ny * half;

                const vRelX = p1.vx - p2.vx;
                const vRelY = p1.vy - p2.vy;
                const vn = vRelX * nx + vRelY * ny;
                if (vn <= 0) continue;

                const impulseX = vn * nx;
                const impulseY = vn * ny;
                p1.vx -= impulseX;
                p1.vy -= impulseY;
                p2.vx += impulseX;
                p2.vy += impulseY;
            }
        }

        return pairCount;
    }

    getAndResetOverlapPairCount() {
        const count = this._overlapPairCount;
        this._overlapPairCount = 0;
        return count;
    }

    getAverageSpeed() {
        if (this.particles.length === 0) return 0;
        let sumSq = 0;
        for (const p of this.particles) {
            sumSq += p.vx * p.vx + p.vy * p.vy;
        }
        return Math.sqrt(sumSq / this.particles.length);
    }

    scaleVelocities(ratio) {
        for (const p of this.particles) {
            p.vx *= ratio;
            p.vy *= ratio;
        }
        for (const g of this.ghosts) {
            g.vx *= ratio;
            g.vy *= ratio;
        }
    }

    // Rebuild both pools in place. speedScale must already reflect current
    // temperature — the caller is responsible for that, because this class
    // has no temperature concept of its own.
    setParticleCount(particleCount, ghostCount, speedScale) {
        const box = this.box;
        const r = PARTICLE_RADIUS;

        this.particles.length = 0;
        for (let i = 0; i < particleCount; i++) {
            const x = box.x + r + Math.random() * (box.width - 2 * r);
            const y = box.y + r + Math.random() * (box.height - 2 * r);
            const vx = boxMullerStandardNormal() * speedScale;
            const vy = boxMullerStandardNormal() * speedScale;
            this.particles.push(new Particle(x, y, vx, vy, r));
        }

        this.ghosts.length = 0;
        for (let i = 0; i < ghostCount; i++) {
            const x = box.x + Math.random() * box.width;
            const y = box.y + Math.random() * box.height;
            const vx = boxMullerStandardNormal() * speedScale;
            const vy = boxMullerStandardNormal() * speedScale;
            this.ghosts.push(new GhostParticle(x, y, vx, vy));
        }

        this.lastPistonCollisions = [];
        this._ghostPistonHits = 0;
        this._overlapPairCount = 0;

        for (let i = 0; i < 10; i++) {
            if (this._resolveParticleCollisions() === 0) break;
        }
        this._overlapPairCount = 0;
    }

    getAverageKineticEnergy() {
        if (this.particles.length === 0) return 0;
        let sumSq = 0;
        for (const p of this.particles) {
            sumSq += p.vx * p.vx + p.vy * p.vy;
        }
        const avgVSq = sumSq / this.particles.length;
        return 0.5 * 1.0 * avgVSq;
    }

    getInitialAverageSpeed() {
        return this._initialAvgSpeed;
    }

    getVelocityHistogram(binCount, maxSpeed) {
        const bins = [];
        const binWidth = maxSpeed / binCount;
        for (let i = 0; i < binCount; i++) {
            bins.push({
                binMin: i * binWidth,
                binMax: (i + 1) * binWidth,
                count: 0
            });
        }
        for (const source of [this.particles, this.ghosts]) {
            for (const p of source) {
                const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                if (speed >= maxSpeed) continue;
                const idx = Math.floor(speed / binWidth);
                if (idx >= 0 && idx < binCount) bins[idx].count++;
            }
        }
        return bins;
    }

    getPistonCollisionCount() {
        return this.lastPistonCollisions.length;
    }

    getTotalPistonCollisionCount() {
        return this.lastPistonCollisions.length + this._ghostPistonHits;
    }

    getLastPistonCollisions() {
        return this.lastPistonCollisions;
    }

    getTotalMomentumTransfer() {
        let sum = 0;
        for (const c of this.lastPistonCollisions) sum += c.momentumTransfer;
        return sum;
    }

    getParticles() {
        return this.particles;
    }
}
