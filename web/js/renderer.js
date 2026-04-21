// p5.js drawing - particles, flashes, histogram, HSB color mapping

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;

let frameCounter = 0;

function getAndResetFrameCount() {
    const count = frameCounter;
    frameCounter = 0;
    return count;
}

function createRenderer(box, particleSystem, updateFn) {
    const sketch = (p) => {
        p.setup = () => {
            p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
            p.background(250);
        };

        p.draw = () => {
            const dt = Math.min((p.deltaTime || 0) / 1000, 0.05);
            updateFn(dt);
            frameCounter++;

            p.background(250);

            p.noFill();
            p.stroke(80, 80, 80);
            p.strokeWeight(1);
            p.rect(box.x, box.y, box.width, box.height);

            p.strokeWeight(3);
            p.line(
                box.x + box.width, box.y,
                box.x + box.width, box.y + box.height
            );

            p.noStroke();
            p.fill(120, 120, 120);
            const particles = particleSystem.getParticles();
            for (const particle of particles) {
                p.circle(particle.x, particle.y, 6);
            }
        };
    };

    return new p5(sketch, document.body);
}
