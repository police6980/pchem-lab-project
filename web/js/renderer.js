// p5.js drawing - particles, flashes, histogram, HSB color mapping

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;

let frameCounter = 0;

function getAndResetFrameCount() {
    const count = frameCounter;
    frameCounter = 0;
    return count;
}

function createRenderer(box, particleSystem, params, updateFn) {
    // Fixed at start-up, never retuned. Distribution shift (e.g. heating) then
    // reads as visible color change instead of silent rescaling.
    const vMaxColor = particleSystem.getInitialAverageSpeed() * params.v_max_color_factor;
    const flashDuration = params.flash_duration_sec;
    const flashInitialAlpha = params.flash_initial_alpha;
    let flashes = [];

    function computeHueFromSpeed(speed) {
        const ratio = Math.min(speed / vMaxColor, 1.0);
        return 240 - 240 * ratio;
    }

    class Flash {
        constructor(x, y, strength, hue) {
            this.x = x;
            this.y = y;
            this.hue = hue;
            this.age = 0;
            this.lifetime = flashDuration;
            this.baseRadius = 2 + strength * 0.015;
        }

        update(dt) {
            this.age += dt;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        draw(p) {
            const t = this.age / this.lifetime;
            const alpha = 180 * (1 - t);
            const radius = this.baseRadius * (1 + t * 0.2);
            p.noStroke();
            p.fill(this.hue, 60, 100, alpha);
            p.circle(this.x, this.y, radius * 2);
        }
    }

    const sketch = (p) => {
        p.setup = () => {
            p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
            p.colorMode(p.HSB, 360, 100, 100, 255);
            p.background(0, 0, 98);
        };

        p.draw = () => {
            const dt = Math.min((p.deltaTime || 0) / 1000, 0.05);
            updateFn(dt);
            frameCounter++;

            const collisions = particleSystem.getLastPistonCollisions();
            for (const c of collisions) {
                flashes.push(new Flash(c.x, c.y, c.momentumTransfer, computeHueFromSpeed(c.speed)));
            }
            for (const f of flashes) f.update(dt);
            flashes = flashes.filter(f => !f.isDead());

            p.background(0, 0, 98);

            p.noFill();
            p.stroke(0, 0, 31);
            p.strokeWeight(1);
            p.rect(box.x, box.y, box.width, box.height);

            p.strokeWeight(3);
            p.line(
                box.x + box.width, box.y,
                box.x + box.width, box.y + box.height
            );

            p.noStroke();
            const particles = particleSystem.getParticles();
            for (const particle of particles) {
                const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
                const ratio = Math.min(speed / vMaxColor, 1.0);
                const hue = computeHueFromSpeed(speed);
                const sat = 40 + 60 * ratio;
                const bri = 70 + 30 * ratio;
                p.fill(hue, sat, bri);
                p.circle(particle.x, particle.y, particle.radius * 2);
            }

            for (const f of flashes) f.draw(p);
        };
    };

    return new p5(sketch, document.body);
}
