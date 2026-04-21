// p5.js drawing - particles, flashes, histogram, HSB color mapping

const CANVAS_WIDTH = 1100;
const CANVAS_HEIGHT = 500;

const HIST_BIN_COUNT = 40;
const HIST_X = 600;
const HIST_Y = 100;
const HIST_W = 400;
const HIST_H = 300;
const HIST_TIME_ALPHA = 0.03;

// 5-point [0.1, 0.2, 0.4, 0.2, 0.1] kernel for interior bins.
// i=1 and i=n-2 fall back to 3-point [0.25, 0.5, 0.25] (one neighbor short).
// i=0 and i=n-1 stay raw (no neighbors on one side).
function spatialSmooth(bins) {
    const out = bins.map(b => ({ ...b }));
    const n = bins.length;
    if (n >= 3) {
        out[1].count =
            0.25 * bins[0].count + 0.5 * bins[1].count + 0.25 * bins[2].count;
        out[n - 2].count =
            0.25 * bins[n - 3].count + 0.5 * bins[n - 2].count + 0.25 * bins[n - 1].count;
    }
    for (let i = 2; i < n - 2; i++) {
        out[i].count =
            0.1 * bins[i - 2].count +
            0.2 * bins[i - 1].count +
            0.4 * bins[i].count +
            0.2 * bins[i + 1].count +
            0.1 * bins[i + 2].count;
    }
    return out;
}

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

    // Snapshot the initial Maxwell-Boltzmann distribution as the reference
    // baseline. Kept unchanged so distribution shifts (heating in Charles)
    // read as deviation from this outline rather than against a moving axis.
    // Spatial-smoothed once so it visually matches the smoothed current bars.
    const initialBins = spatialSmooth(
        particleSystem.getVelocityHistogram(HIST_BIN_COUNT, vMaxColor)
    );
    let initialMaxCount = 0;
    for (const b of initialBins) {
        if (b.count > initialMaxCount) initialMaxCount = b.count;
    }

    // Time-averaged raw bins. Warms up from the first frame onward.
    let smoothedBins = null;

    function drawBins(p, bins, options) {
        const binW = HIST_W / bins.length;
        if (options.isReference) {
            p.noFill();
            p.stroke(0, 0, 50, 180);
            p.strokeWeight(1.5);
            p.beginShape();
            for (let i = 0; i < bins.length; i++) {
                const barH = initialMaxCount > 0
                    ? Math.min(bins[i].count / initialMaxCount, 1) * HIST_H
                    : 0;
                const centerX = HIST_X + (i + 0.5) * binW;
                const topY = HIST_Y + HIST_H - barH;
                p.vertex(centerX, topY);
            }
            p.endShape();
        } else {
            p.noStroke();
            for (let i = 0; i < bins.length; i++) {
                const bin = bins[i];
                const barH = initialMaxCount > 0
                    ? Math.min(bin.count / initialMaxCount, 1) * HIST_H
                    : 0;
                if (barH <= 0) continue;
                const binCenter = (bin.binMin + bin.binMax) / 2;
                const ratio = Math.min(binCenter / vMaxColor, 1.0);
                const hue = computeHueFromSpeed(binCenter);
                const sat = 40 + 60 * ratio;
                const bri = 70 + 30 * ratio;
                p.fill(hue, sat, bri);
                const barWidth = binW * 0.5;
                const barX = HIST_X + i * binW + (binW - barWidth) / 2;
                p.rect(barX, HIST_Y + HIST_H - barH, barWidth, barH);
            }
        }
    }

    function drawHistogram(p, currentBins) {
        p.noFill();
        p.stroke(0, 0, 85);
        p.strokeWeight(1);
        p.rect(HIST_X, HIST_Y, HIST_W, HIST_H);

        drawBins(p, currentBins, { isReference: false });

        // Initial-distribution reference outline. Hidden in Boyle (isothermal,
        // distribution never shifts), but restore when Charles lands — the
        // outline is where the rightward shift becomes legible.
        // drawBins(p, initialBins, { isReference: true });
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

            const rawBins = particleSystem.getVelocityHistogram(HIST_BIN_COUNT, vMaxColor);
            if (smoothedBins === null) {
                smoothedBins = rawBins.map(b => ({ ...b }));
            } else {
                for (let i = 0; i < rawBins.length; i++) {
                    smoothedBins[i].count =
                        HIST_TIME_ALPHA * rawBins[i].count +
                        (1 - HIST_TIME_ALPHA) * smoothedBins[i].count;
                }
            }
            const displayBins = spatialSmooth(smoothedBins);
            drawHistogram(p, displayBins);
        };
    };

    return new p5(sketch, document.body);
}
