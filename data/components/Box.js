// Dimensions are in millimetres.
function drawHardwareBox({ box, label }) {
  box([0, 0, 0], [50, 50, 50], "#778a9b", false);
  label([0, 30, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 100, real: true }; },
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Hardware", objectType: "Box 50 mm", order: 90, draw: drawHardwareBox });
