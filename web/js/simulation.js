// Particle system, box geometry, physics update loop

const BOX_INITIAL_X = 100;
const BOX_INITIAL_Y = 100;
const BOX_INITIAL_WIDTH = 400;
const BOX_INITIAL_HEIGHT = 300;
const DEFAULT_SPEED_SCALE = 120;
const DT_CAP = 0.05;

function boxMullerStandardNormal() {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

class Particle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = 1.0;
    }

    update(dt, box) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const right = box.x + box.width;
        const bottom = box.y + box.height;

        let collision = null;
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

        // Only trigger a collision if the particle is both outside the wall
        // AND moving into it. The velocity-direction check prevents spurious
        // collisions when the box shrinks faster than the particle can move.
        if (this.x < box.x && this.vx < 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vx), speed };
            this.vx = -this.vx;
        } else if (this.x > right && this.vx > 0) {
            collision = { isPiston: true, momentumTransfer: 2 * this.mass * Math.abs(this.vx), speed };
            this.vx = -this.vx;
        } else if (this.y < box.y && this.vy < 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vy), speed };
            this.vy = -this.vy;
        } else if (this.y > bottom && this.vy > 0) {
            collision = { isPiston: false, momentumTransfer: 2 * this.mass * Math.abs(this.vy), speed };
            this.vy = -this.vy;
        }

        if (this.x < box.x) this.x = box.x;
        else if (this.x > right) this.x = right;
        if (this.y < box.y) this.y = box.y;
        else if (this.y > bottom) this.y = bottom;

        return collision;
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
        this.targetWidth = targetArea / this.height;
    }
}

class ParticleSystem {
    constructor(particleCount, box, initialSpeedScale = DEFAULT_SPEED_SCALE) {
        this.box = box;
        this.particles = [];
        for (let i = 0; i < particleCount; i++) {
            const x = box.x + Math.random() * box.width;
            const y = box.y + Math.random() * box.height;
            const vx = boxMullerStandardNormal() * initialSpeedScale;
            const vy = boxMullerStandardNormal() * initialSpeedScale;
            this.particles.push(new Particle(x, y, vx, vy));
        }
        this._initialAvgSpeed = this.getAverageSpeed();
        this.lastPistonCollisions = [];
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
    }

    getAverageSpeed() {
        if (this.particles.length === 0) return 0;
        let sumSq = 0;
        for (const p of this.particles) {
            sumSq += p.vx * p.vx + p.vy * p.vy;
        }
        return Math.sqrt(sumSq / this.particles.length);
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
        for (const p of this.particles) {
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed >= maxSpeed) continue;
            const idx = Math.floor(speed / binWidth);
            if (idx >= 0 && idx < binCount) bins[idx].count++;
        }
        return bins;
    }

    getPistonCollisionCount() {
        return this.lastPistonCollisions.length;
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
