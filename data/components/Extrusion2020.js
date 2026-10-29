// Dimensions are in millimetres.
function drawAluminiumExtrusion({ box, label }) {
  // Stylized 2020 profile with four longitudinal slots, extending along local Y.
  box([0, 0, 0], [8, 100, 8], "#8e9da9", false);
  box([0, 0, 0], [14, 100, 2], "#aebbc5", false);
  box([0, 0, 0], [2, 100, 14], "#aebbc5", false);
  for (const x of [-7, 7]) {
    for (const z of [-7, 7]) box([x, 0, z], [6, 100, 6], "#bac6ce", false);
  }
  label([0, 56, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 55, real: true }; },
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Hardware", objectType: "Aluminium Extrusion 20x20x100 mm", order: 100, draw: drawAluminiumExtrusion });
