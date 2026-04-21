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
                const hue = 240 - 240 * ratio;
                const sat = 40 + 60 * ratio;
                const bri = 70 + 30 * ratio;
                p.fill(hue, sat, bri);
                p.circle(particle.x, particle.y, particle.radius * 2);
            }
        };
    };

    return new p5(sketch, document.body);
}
