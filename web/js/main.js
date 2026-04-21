// Entry point - boot and overall orchestration

const USE_MOCK_SENSOR = true;

document.addEventListener("DOMContentLoaded", async () => {
    const params = await fetch("config/params.json").then(r => r.json());

    if (USE_MOCK_SENSOR) {
        const sensor = new MockSensorSource(params.initial_pressure_kPa);
        createDevPressureSlider(v => sensor.setPressure(v));
        sensor.onData(data => console.log(data));
        sensor.start();
    } else {
        console.warn("Real sensor not implemented yet");
    }
});
