// Numeric panel, record button, measurement popup, data table

function createDevPressureSlider(onChange) {
    const container = document.createElement("div");
    container.id = "dev-pressure-slider";

    const label = document.createElement("label");
    label.textContent = "[DEV MODE] 압력:";
    label.htmlFor = "dev-pressure-range";

    const input = document.createElement("input");
    input.type = "range";
    input.id = "dev-pressure-range";
    input.min = "50";
    input.max = "300";
    input.step = "0.1";
    input.value = "101.3";

    const valueDisplay = document.createElement("span");
    valueDisplay.className = "dev-pressure-value";
    valueDisplay.textContent = `${parseFloat(input.value).toFixed(1)} kPa`;

    input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        valueDisplay.textContent = `${v.toFixed(1)} kPa`;
        onChange(v);
    });

    container.appendChild(label);
    container.appendChild(input);
    container.appendChild(valueDisplay);
    document.body.prepend(container);

    return container;
}
