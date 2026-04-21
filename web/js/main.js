// Entry point - boot and overall orchestration

const USE_MOCK_SENSOR = true;

document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());

    const box = new Box(BOX_INITIAL_X, BOX_INITIAL_Y, BOX_INITIAL_WIDTH, BOX_INITIAL_HEIGHT);
    const system = new ParticleSystem(params.particle_count, box, DEFAULT_SPEED_SCALE);
    const V0 = box.getArea();
    const P0 = params.initial_pressure_kPa;
    let smoothedP = P0;

    if (USE_MOCK_SENSOR) {
        const sensor = new MockSensorSource(params.initial_pressure_kPa);
        createDevPressureSlider(v => sensor.setPressure(v));
        sensor.onData(data => {
            smoothedP += (data.value - smoothedP) * 0.1;
            box.setTargetFromPressure(smoothedP, P0, V0);
        });
        sensor.start();
    } else {
        console.warn("Real sensor not implemented yet");
    }

    let pistonHitsAccumulator = 0;
    createRenderer(box, system, (dt) => {
        system.update(dt);
        box.update(dt, params.volume_tau_seconds);
        pistonHitsAccumulator += system.getPistonCollisionCount();
    });

    setInterval(() => {
        const hitsPer5s = pistonHitsAccumulator;
        const hitsPerSec = hitsPer5s / 5;
        pistonHitsAccumulator = 0;

        const frames = getAndResetFrameCount();
        const fps = frames / 5;
        const overlapTotal = system.getAndResetOverlapPairCount();
        const overlapAvg = frames > 0 ? overlapTotal / frames : 0;

        const avgSpeed = system.getAverageSpeed();
        const initialSpeed = system.getInitialAverageSpeed();
        const speedRel = avgSpeed / initialSpeed;
        const widthRel = box.width / BOX_INITIAL_WIDTH;
        const particleCount = system.getParticles().length;
        console.log(
            `Avg speed: ${avgSpeed.toFixed(1)} (×${speedRel.toFixed(2)}), ` +
            `Box width: ${box.width.toFixed(0)} (×${widthRel.toFixed(2)}), ` +
            `Particles: ${particleCount}, ` +
            `Piston hits (last 5s): ${hitsPer5s} (≈${hitsPerSec.toFixed(0)}/s), ` +
            `FPS: ${fps.toFixed(1)}, ` +
            `Overlap pairs (avg): ${overlapAvg.toFixed(1)} /frame`
        );
    }, 5000);
});
