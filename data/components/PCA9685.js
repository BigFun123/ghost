// Stylized 16-channel breakout. Illustrative dimensions in millimetres,
// not a mounting template. Power estimates exclude the attached servos.
function drawPCA9685({ box, label }) {
  box([0, 0, 0], [62, 1.6, 25], "#356fa3", false);
  box([0, 1.8, -3], [7, 2, 7], "#242b30", false);
  // Sixteen three-pin servo headers: signal, power and ground.
  for (let channel = 0; channel < 16; channel++) {
    const x = (channel - 7.5) * 2.54;
    box([x, 2, 7], [2.5, 2.4, 7.6], "#242b30", false);
    for (let row = 0; row < 3; row++) {
      box([x, 5, 4.46 + row * 2.54], [0.65, 3.6, 0.65], "#d3bb75", false);
    }
  }
  // External servo power terminal and I2C headers at either end.
  box([0, 3.8, -7], [10, 6, 8], "#43834b", false);
  for (const x of [-2.5, 2.5]) box([x, 7, -7], [2.5, 0.4, 3], "#b7bec4", false);


  for (const x of [-28, 28]) {
    box([x, 2, 0], [2.5, 2.4, 15.2], "#242b30", false);
    for (let pin = 0; pin < 6; pin++) {
      box([x, 5, (pin - 2.5) * 2.54], [0.65, 3.6, 0.65], "#d3bb75", false);
    }
  }
  label([0, 12, 0]);
}

componentRegistry.register({
  numericSettings: { i2cAddress: { default: 64, min: 64, max: 119 } },
  validate(node) {
    if (!Number.isInteger(node.i2cAddress)) throw new Error("I²C address must be an integer from 0x40 to 0x77.");
  },
  renderSettings({ node, host, editing, change, controllerAddressChanged }) {
    const group = document.createElement("div");
    group.className = "setup-transform-group";
    const label = document.createElement("label");
    label.textContent = "I²C address";
    const input = document.createElement("input");
    input.type = "text";
    input.value = "0x" + (node.i2cAddress ?? 64).toString(16);
    input.disabled = !editing;
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("change", () => {
      const address = Number(input.value.trim());
      try {
        if (!Number.isInteger(address) || address < 64 || address > 119) throw new Error("Enter an I²C address from 0x40 to 0x77.");
        controllerAddressChanged(node, address);
        input.value = "0x" + address.toString(16);
        change();
      } catch (error) {
        input.setCustomValidity(error.message);
        input.reportValidity();
      }
    });
    label.append(input);
    const hint = document.createElement("small");
    hint.textContent = "Updates servos using this address. Save robot and reboot to apply.";
    group.append(label, hint);
    host.append(group);
  },
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 12, real: true }; },
  capabilities: ["servoController"],
  // Provisional board-only watts; replace with measured values if available.
  getPower() { return { min: 0.01, max: 0.1 }; },
  group: "Controllers", objectType: "PCA9685 Servo Controller", order: 65,
  defaults: { shopProductId: "PCA9685" }, draw: drawPCA9685
});
