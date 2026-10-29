// Dimensions are in millimetres.
function drawAluminiumPanel50({ box, label }) {
  box([0, 0, 0], [50, 2, 50], "#aebbc5", false);
  label([0, 6, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 13.5, real: true }; },
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Hardware", objectType: "Aluminium Panel 50x50 mm", order: 70, draw: drawAluminiumPanel50 });
