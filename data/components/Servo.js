// Shared servo mechanics. Models supply their own geometry and electrical ratings.
const servoComponentBehavior = {
  capabilities: ["actuator"],
  fixedSide({ parent, registry }) {
    return registry.hasCapability(parent ?? {}, "shaftMount") ? "shaft" : "body";
  },
  parentSide({ parent, nodes, registry }) {
    return registry.attachment(nodes, nodes.indexOf(parent)).fixedSide === "shaft" ? "body" : "shaft";
  },
  localPoseRotation({ node, shaft, fixedSide }) {
    const angle = node.continuous ? node.spinAngle : node.angle;
    return [0, fixedSide === "shaft" ? (shaft ? 0 : 90 - angle) : (shaft ? angle - 90 : 0), 0];
  }
};

// A transform-only attachment point; the owning servo renders both pieces.
componentRegistry.register({
  objectType: "Servo Shaft", selectable: false,
  capabilities: ["servoShaft"],
  draw() {},
  getPhysics() { return { real: false, massGrams: 0 }; },
  getPower() { return { min: 0, max: 0 }; },
  parentSide() { return "shaft"; }
});
