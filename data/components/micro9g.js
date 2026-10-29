// Micro servo; local origin is the shaft pivot near the case end.
function drawMicro9g({ box, cylinder, label, color, node, purpose }) {
  box([6, -12, 0], [23, 20, 12], color, false);
  cylinder([0, -1, 0], 3, 6, "#d4b66d", true);
  box([9, 3, 0], [24, 3, 6], "#dce4eb", true);
  if (node?.continuous && purpose !== "physics") box([5, 7, 0], [6, 0.6, 1.5], "#ffe08a", true);
  label([0, 18, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 9, real: true }; },
  ...servoComponentBehavior,
  // Provisional watts; replace with measured or datasheet values.
  getPower() { return { min: 0.1, max: 1 }; },
  group: "Servos", objectType: "Servo", model: "micro",
  choice: "micro",
  label: "Servo: SG90", order: 20, defaults:
  {
    model: "micro", type: "SG90",
    shopProductId: "servo-sg90"
  }, draw: drawMicro9g
});
