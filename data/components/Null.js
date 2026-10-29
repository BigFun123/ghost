function drawNull() {}
componentRegistry.register({
  // Physical constraint anchor with nominal mass, even though it has no geometry.
  getPhysics() { return { massGrams: 1, real: true }; },
  capabilities: ["constraints"],
  // Passive component: no electrical power consumption.
  getPower() { return { min: 0, max: 0 }; },
  group: "Scene", objectType: "Null", order: 50, draw: drawNull });
