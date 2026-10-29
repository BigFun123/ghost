// Dimensions are in millimetres.
function drawAluminiumPanel100({ box, label }) {
  box([0, 0, 0], [50, 2, 100], "#aebbc5", false);
  label([0, 6, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 27, real: true }; },
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Hardware", objectType: "Aluminium Panel 50x100 mm", order: 80, draw: drawAluminiumPanel100 });
