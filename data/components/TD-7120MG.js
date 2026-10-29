// Standard servo; local origin is the metal shaft pivot near the case end.
function drawTD7120({ box, cylinder, label, color, node, purpose }) {
  box([12, -20, 0], [40, 40, 20], color, false);
  cylinder([0, 1, 0], 4, 6, "#d4b66d", true);
  cylinder([0, 3, 0], 9, 3, "#dce4eb", true);
  cylinder([0, -43, 0], 9, 3, "#dce4eb", true);
  // Coaxial plastic support nub on the opposite face.
  cylinder([0, -42, 0], 4, 4, "#202a33", false);
  if (node?.continuous && purpose !== "physics") box([5, 5, 0], [6, 0.6, 1.5], "#ffe08a", true);
  label([0, 18, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 60, real: true }; },
  ...servoComponentBehavior,
  // User-supplied ratings; intermediate currents are linearly interpolated estimates.
  // Default supply is 4.8 V. Set powerVoltageVolts to the actual servo supply.
  getPower(component = {}) {
    const voltage = component.powerVoltageVolts ?? 4.8;
    const low = Math.max(0, Math.min(1, (voltage - 4.8) / 2.4));
    const high = Math.max(0, Math.min(1, (voltage - 7.2) / 1.2));
    const idleCurrentAmps = 0.04; // Upper estimate for the quoted <40 mA idle current.
    const runningCurrentAmps = 0.21 + 0.05 * low;
    const peakCurrentAmps = 2.1 + 0.6 * low + 0.6 * high;
    return {
      voltage, idleCurrentAmps, runningCurrentAmps, peakCurrentAmps,
      min: voltage * idleCurrentAmps, running: voltage * runningCurrentAmps, max: voltage * peakCurrentAmps
    };
  },
  group: "Servos", objectType: "Servo", model: "standard",
  choice: "standard",
  label: "Servo: TD-7120MG", order: 10,
  defaults: {
    model: "standard", type: "TD-7120MG",
    shopProductId: "TD-7120MG"
  }, draw: drawTD7120
});
