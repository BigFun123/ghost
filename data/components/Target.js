// A 10 mm diameter ball, built from fine circular slices using shared primitives.
function drawTarget({ cylinder, label }) {
  const radius = 5;
  const slices = 40;
  const height = radius * 2 / slices;
  for (let slice = 0; slice < slices; slice++) {
    const y = -radius + (slice + 0.5) * height;
    // Use the closest point to the equator so the overall diameter is exactly 10 mm.
    const edge = Math.max(0, Math.abs(y) - height / 2);
    cylinder([0, y, 0], Math.sqrt(radius * radius - edge * edge), height, "#ff1717", false, { outline: false });
  }
  label([0, 9, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 0, real: false }; },
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Scene", objectType: "Target", order: 55, draw: drawTarget });
