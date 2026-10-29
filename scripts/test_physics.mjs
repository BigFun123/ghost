import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import registryLoader from '../devserver/component-registry.js';
import '../data/physics.js';
const source = fs.readFileSync(new URL('../data/lib/rapier.js', import.meta.url), 'utf8');
const { default: RAPIER } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
await RAPIER.init();
const world = globalThis.GhostPhysics.create(RAPIER);
const centreY = box => box.vertices.reduce((sum, point) => sum + point[1], 0) / 8;
try {
  world.dropCube([100, 150, 0]);
  for (let i = 0; i < 10; i++) world.advance(1 / 60);
  assert(centreY(world.boxes()[0]) < 150, 'gravity must move a cube down');
  for (let i = 0; i < 180; i++) world.advance(1 / 60);
  assert(Math.abs(centreY(world.boxes()[0]) - 10) < 1, 'cube must settle on the floor in millimetres');
  world.clear();
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const platform = { kind: 'box', center: [0, 20, 0], dimensions: [100, 20, 100], axes };
  world.sync([platform], 'platform');
  world.dropCube([0, 150, 0]);
  for (let i = 0; i < 180; i++) { world.sync([platform], 'platform'); world.advance(1 / 60); }
  assert(Math.abs(centreY(world.boxes()[0]) - 40) < 1, 'cube must collide with robot geometry');
  assert(world.debugLines().length > 0);
  for (let i = 0; i < 25; i++) world.dropCube([i * 25, 200, 0]);
  assert.equal(world.boxes().length, 20, 'test bodies must stay bounded');
  world.sync([], 'empty');
  world.clear();
  assert.equal(world.boxes().length, 0);
  const pose = { center: [0, 150, 0], axes };
  const nodes = [
    { index: 0, parent: null, parentSide: 'body', null: true, servo: false, body: pose, shaft: pose },
    { index: 1, parent: 0, parentSide: 'body', servo: true, fixedSide: 'body', body: pose, shaft: pose, enabled: true, target: 0 }
  ];
  const robotShapes = [
    { index: 1, shaft: false, kind: 'box', offset: [0, -20, 0], dimensions: [40, 40, 20] },
    { index: 1, shaft: true, kind: 'box', offset: [35, -30, 0], dimensions: [70, 10, 10] }
  ];
  world.syncRobot(nodes, robotShapes, 'free robot');
  const initial = world.point(0, [0, 0, 0]);
  for (let i = 0; i < 15; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  assert(world.point(0, [0, 0, 0])[1] < initial[1] - 10, 'root Null must fall under gravity, not pin the assembly');
  for (let i = 0; i < 180; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  const landed = world.point(1, [0, -40, 0]);
  assert(landed[1] > -2 && landed[1] < 5, 'robot body must be supported by the floor');
  assert(world.point(0, [0, 0, 0]).every(Number.isFinite));
  const relativeDirection = () => {
    const a = world.point(1, [0, 0, 0], false), x = world.point(1, [1, 0, 0], false);
    const y = world.point(1, [0, 1, 0], false), z = world.point(1, [0, 0, 1], false);
    const movingX = world.point(1, [1, 0, 0], true), movingOrigin = world.point(1, [0, 0, 0], true);
    const direction = movingX.map((v, i) => v - movingOrigin[i]);
    return [x, y, z].map(axis => axis.reduce((sum, v, i) => sum + (v - a[i]) * direction[i], 0));
  };
  nodes[1].target = Math.PI / 3;
  for (let i = 0; i < 180; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  const direction = relativeDirection();
  assert(direction[2] < -0.4, 'servo motor must rotate the shaft relative to its body');
  // Isolate motor stiffness from floor friction for the power on/off comparison.
  world.world.gravity = { x: 0, y: 0, z: 0 };
  nodes[1].target = 0;
  world.resetRobot(); world.syncRobot(nodes, robotShapes, 'free robot');
  for (let i = 0; i < 60; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  let hinge;
  world.world.impulseJoints.forEach(joint => { if (joint.type() === RAPIER.JointType.Revolute) hinge = joint; });
  const hingeAngle = () => { const d = relativeDirection(); return Math.atan2(-d[2], d[0]); };
  const impulseAlongHinge = () => {
    const origin = world.point(1, [0, 0, 0], true), axis = world.point(1, [0, 1, 0], true);
    hinge.body2().applyTorqueImpulse({ x: (axis[0] - origin[0]) * 0.00001,
      y: (axis[1] - origin[1]) * 0.00001, z: (axis[2] - origin[2]) * 0.00001 }, true);
  };
  impulseAlongHinge();
  for (let i = 0; i < 60; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  assert(Math.abs(hingeAngle() - nodes[1].target) < 0.05, 'powered servo must firmly hold its target after an external impulse');
  const poweredAngle = hingeAngle();
  nodes[1].enabled = false;
  world.syncRobot(nodes, robotShapes, 'free robot');
  world.world.impulseJoints.forEach(joint => { if (joint.type() === RAPIER.JointType.Revolute) hinge = joint; });
  impulseAlongHinge();
  for (let i = 0; i < 30; i++) { world.syncRobot(nodes, robotShapes, 'free robot'); world.advance(1 / 60); }
  assert(Math.abs(hingeAngle() - poweredAngle) > 0.1, 'switched-off servo must release its holding stiffness');

} finally { world.destroy(); world.destroy(); }
// Reuse the actual model primitives and hierarchy transforms for collision geometry.
const app = fs.readFileSync(new URL('../data/app.js', import.meta.url), 'utf8');
const context = { servoPreview: { nodes: [{ objectType: 'Servo', model: 'standard', parent: null, angle: 90, rotation: [0, 0, 90], position: [10, 20, 30] }] } };
vm.createContext(context);
registryLoader.loadComponentRegistry(context);
vm.runInContext(app.slice(app.indexOf('function rotateServoPoint('), app.indexOf('function clampPreviewPitch(')), context);
vm.runInContext(app.slice(app.indexOf('function collectPreviewPhysicsShapes('), app.indexOf('function syncPreviewPhysics(')), context);
const shapes = context.collectPreviewPhysicsShapes();
assert(shapes.length >= 4);
assert.equal(shapes[0].kind, 'box');
assert(Math.abs(shapes[0].center[0] - 30) < 0.001);
assert(Math.abs(shapes[0].center[1] - 32) < 0.001);
// Use a fixed authored assembly so editing a saved robot cannot change this regression.
const config = JSON.parse(fs.readFileSync(new URL('./fixtures/physics_assembly.json', import.meta.url), 'utf8'));
context.servoPreview.nodes = config.components.map(c => ({ ...c,
  // Test assembly welding independently of saved support constraints below.
  constraints: undefined, rotationConstraints: undefined,
  parent: c.parent == null ? null : config.components.findIndex(other => other.name === c.parent) + 1,
  position: ['x', 'y', 'z'].map(axis => c.position?.[axis] || 0),
  rotation: ['x', 'y', 'z'].map(axis => c.rotation?.[axis] || 0),
  angle: c.startupAngle ?? 90, spinAngle: c.startupAngle ?? 90, enabled: true, outputEnabled: true
}));

const assembly = globalThis.GhostPhysics.create(RAPIER);
try {
  for (let i = 0; i < 300; i++) {
    assembly.syncRobot(context.collectPreviewPhysicsNodes(), context.collectPreviewPhysicsShapes(), 'configured assembly');
    assembly.advance(1 / 60);
  }
  assert.equal(assembly.world.bodies.len(), context.servoPreview.nodes.filter(node => node.objectType === 'Servo').length + 1,
    'fixed brackets and Nulls must be welded into compound bodies, leaving only servo hinges');
  const descriptors = context.collectPreviewPhysicsNodes();
  context.servoPreview.nodes.forEach((node, index) => {
    if (node.objectType === 'Servo' && !node.continuous) {
      const baseSide = descriptors[index].fixedSide === 'shaft';
      const baseOrigin = assembly.point(index, [0, 0, 0], baseSide);
      const baseX = assembly.point(index, [1, 0, 0], baseSide).map((value, axis) => value - baseOrigin[axis]);
      const baseZ = assembly.point(index, [0, 0, 1], baseSide).map((value, axis) => value - baseOrigin[axis]);
      const movingOrigin = assembly.point(index, [0, 0, 0], !baseSide);
      const movingX = assembly.point(index, [1, 0, 0], !baseSide).map((value, axis) => value - movingOrigin[axis]);
      const dot = axis => axis.reduce((sum, value, i) => sum + value * movingX[i], 0);
      const angle = Math.atan2(-dot(baseZ), dot(baseX));
      const error = angle - descriptors[index].target * (baseSide ? -1 : 1);
      assert(Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < 0.05,
        'powered servo must hold within three degrees under load: ' + node.name);
    }
    if (node.parent !== null) {
      const mount = assembly.point(node.parent - 1, node.position, descriptors[index].parentSide === 'shaft');
      const origin = assembly.point(index, [0, 0, 0], descriptors[index].fixedSide === 'shaft');
      assert(Math.hypot(...mount.map((value, axis) => value - origin[axis])) < 0.0001,
        'bracket/servo mount must remain rigid under gravity: ' + node.name);
    }
  });
  context.servoPreview.nodes.forEach((_, index) => {
    const point = assembly.point(index, [0, 0, 0]);
    if (!point.every(value => Number.isFinite(value) && Math.abs(value) < 5000)) console.log('Unstable node', index, point);
    assert(point.every(value => Number.isFinite(value) && Math.abs(value) < 5000), 'configured robot must remain finite and near the floor');
  });
} finally { assembly.destroy(); }
const supported = globalThis.GhostPhysics.create(RAPIER);
try {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], pose = { center: [0, 150, 0], axes };
  const nodes = [{ index: 0, parent: null, null: true, servo: false, body: pose,
    constraints: { x: { enabled: false, min: 0, max: 0 }, y: { enabled: true, min: -10, max: 10 }, z: { enabled: true, min: 0, max: 0 } } }];
  supported.syncRobot(nodes, [], 'bounded Null');
  let body;
  supported.world.bodies.forEach(candidate => { if (!body && candidate.isDynamic()) body = candidate; });
  body.applyImpulse({ x: 0.001, y: 0, z: 0.001 }, true);
  for (let i = 0; i < 120; i++) supported.advance(1 / 60);
  const position = supported.point(0, [0, 0, 0]);
  assert(position[0] > 5, 'unconstrained X must remain free to move');
  console.log('Bounded support position',position);
  assert(position[1] >= 139 && position[1] <= 161, 'Y must stay within configured +/-10mm under gravity');
  assert(Math.abs(position[2]) < 1, 'Z with zero tolerance must stay held');
  body.applyTorqueImpulse({ x: 0.000001, y: 0, z: 0 }, true);
  for (let i = 0; i < 20; i++) supported.advance(1 / 60);
  const origin = supported.point(0, [0, 0, 0]), axis = supported.point(0, [0, 0, 1]);
  assert(Math.abs(axis[1] - origin[1]) > 0.01, 'translation constraints must leave Null rotation free');
  nodes[0].constraints.y = { enabled: true, min: 0, max: 0 };
  supported.syncRobot(nodes, [], 'locked Y');
  for (let i = 0; i < 120; i++) supported.advance(1 / 60);
  assert(Math.abs(supported.point(0, [0, 0, 0])[1] - 150) < 1, 'zero Y range must hold the Null up');
  nodes[0].constraints = { y: { enabled: true, min: 0, max: 0 } };
  supported.syncRobot(nodes, [], 'isolated Y only');
  for (let i = 0; i < 120; i++) supported.advance(1 / 60);
  console.log('Isolated Y-only height', supported.point(0, [0, 0, 0])[1]);
  assert(Math.abs(supported.point(0, [0, 0, 0])[1] - 150) < 1, 'isolated Y-only must hold height');
  nodes[0].constraints = {};
  supported.syncRobot(nodes, [], 'released Null');
  for (let i = 0; i < 20; i++) supported.advance(1 / 60);
  assert(supported.point(0, [0, 0, 0])[1] < 130, 'removing constraints must release the Null');
} finally { supported.destroy(); }
const rigged = globalThis.GhostPhysics.create(RAPIER);
try {
  const rootIndex = context.servoPreview.nodes.findIndex(node => node.objectType === 'Null' && node.parent === null);
  assert(rootIndex >= 0);
  const root = context.servoPreview.nodes[rootIndex];
  root.constraints = { y: { enabled: true, min: 0, max: 0 }, z: { enabled: true, min: -10, max: 10 } };
  for (let i = 0; i < 300; i++) {
    rigged.syncRobot(context.collectPreviewPhysicsNodes(), context.collectPreviewPhysicsShapes(), 'supported full robot');
    rigged.advance(1 / 60);
  }
  const p = rigged.point(rootIndex, [0, 0, 0]);
  assert(Math.abs(p[1] - root.position[1]) < 1, 'Null support must hold the complete robot at its configured height');
  assert(Math.abs(p[2] - root.position[2]) < 11, 'Null range must bound the complete robot on Z');
  root.constraints = { y: { enabled: true, min: 0, max: 0 } };
  let maximumHeightError = 0;
  for (let i = 0; i < 600; i++) {
    rigged.syncRobot(context.collectPreviewPhysicsNodes(), context.collectPreviewPhysicsShapes(), 'Y-only full robot');
    rigged.advance(1 / 60);
    maximumHeightError = Math.max(maximumHeightError, Math.abs(rigged.point(rootIndex, [0, 0, 0])[1] - root.position[1]));
  }
  const yOnly = rigged.point(rootIndex, [0, 0, 0]);
  console.log('Y-only support: max height error in mm', maximumHeightError, 'final Null position', yOnly);
  assert(maximumHeightError < 1, 'Y-only support must hold the Null height throughout the full robot simulation');
  root.rotationConstraints = {};
  let movingHeightError = 0;
  const servoNodes = context.servoPreview.nodes.filter(node => node.objectType === 'Servo');
  for (let i = 0; i < 480; i++) {
    servoNodes.forEach((node, servo) => { node.angle = 90 + 70 * Math.sin(i / 35 + servo); });
    rigged.syncRobot(context.collectPreviewPhysicsNodes(), context.collectPreviewPhysicsShapes(), 'Y-only moving full robot');
    rigged.advance(1 / 60);
    movingHeightError = Math.max(movingHeightError, Math.abs(rigged.point(rootIndex, [0, 0, 0])[1] - root.position[1]));
  }
  console.log('Y-only support while all servos move: maximum height error (mm)', movingHeightError);
  assert(movingHeightError < 1, 'Y-only support must withstand servo movement without breaking');
  root.rotationConstraints = { x: true, z: true };
  for (let i = 0; i < 600; i++) {
    rigged.syncRobot(context.collectPreviewPhysicsNodes(), context.collectPreviewPhysicsShapes(), 'Y-only upright full robot');
    rigged.advance(1 / 60);
  }
  const uprightOrigin = rigged.point(rootIndex, [0, 0, 0]);
  const uprightY = rigged.point(rootIndex, [0, 1, 0]);
  assert(Math.abs(uprightOrigin[1] - root.position[1]) < 1, 'height must remain held with independent rotation locks');
  assert(uprightY[1] - uprightOrigin[1] > 0.999, 'locking rotation X/Z must keep the full robot upright');


} finally { rigged.destroy(); }
for (const axis of ['x', 'y', 'z']) {
  const check = globalThis.GhostPhysics.create(RAPIER);
  try {
    check.world.gravity = { x: 0, y: 0, z: 0 };
    const pose = { center: [0, 150, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    check.syncRobot([{ index: 0, parent: null, null: true, body: pose, constraints: { [axis]: { enabled: true, min: -10, max: 10 } } }], [], 'single-axis range');
    let rootBody; check.world.bodies.forEach(body => { if (!rootBody && body.isDynamic()) rootBody = body; });
    const impulse = { x: 0.0003, y: 0.0003, z: 0.0003 }; impulse[axis] = 0.001;
    rootBody.applyImpulse(impulse, true);
    const index = ['x', 'y', 'z'].indexOf(axis);
    let furthest = 0, peak = 0;
    for (let i = 0; i < 120; i++) {
      check.advance(1 / 60);
      const displacement = check.point(0, [0, 0, 0])[index] - pose.center[index];
      peak = Math.max(peak, displacement); furthest = Math.max(furthest, Math.abs(displacement));
    }
    const position = check.point(0, [0, 0, 0]);
    assert(peak > 8 && furthest < 11, 'single-axis ' + axis + ' must reach its limit and stay inside the range');
    const guide = check.constraintGuides()[0];
    assert.equal(guide.axis, axis); assert.equal(guide.min, -10); assert.equal(guide.max, 10);
    assert(guide.current.every(Number.isFinite));
  } finally { check.destroy(); }
}
console.log('Local Rapier integration passed: real WASM, gravity, floor/robot collisions, debug geometry, limits, cleanup, free root Null, motor joints and scene transforms.');
