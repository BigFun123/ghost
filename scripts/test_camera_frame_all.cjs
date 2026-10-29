const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = { previewLedColor: [0, 0, 0] };
context.clampPreviewPitch = pitch => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
vm.createContext(context); const registry = loadComponentRegistry(context);
const source = fs.readFileSync('data/app.js', 'utf8');
for (const [start, end] of [
  ['function rotateServoPoint(', 'function drawPreviewConstraintGuides('],
  ['function previewCameraPoint(', 'function cancelPreviewCameraFocus('],
  ['function frameAllPreviewCamera(', 'function drawServoPreview(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
context.previewPhysicsEnabled = false;
const nodes = [
  { objectType: 'Stepper Linear Actuator', lengthMm: 2000, positionMm: 1800, parent: null, position: [-600, 100, 0], rotation: [0, 35, 10] },
  { objectType: 'Box 50 mm', parent: 1, position: [0, 60, 0], rotation: [15, 0, 0] },
  { objectType: 'Target', parent: null, position: [2000, -150, 300], rotation: [0, 0, 0] }
];
for (const [width, height] of [[640, 480], [280, 800], [1200, 220]]) {
  context.servoPreview = { nodes, canvas: { clientWidth: width, clientHeight: height } };
  const camera = context.frameAllPreviewCamera();
  const scale = Math.min(width, height) / 400 * camera.zoom;
  const check = (index, offset, dimensions) => {
    for (let bits = 0; bits < 8; bits++) {
      const point = context.servoWorldPoint(nodes, index, dimensions.map((size, axis) => offset[axis] + ((bits >> axis) & 1 ? .5 : -.5) * size));
      const projected = context.previewCameraPoint(point.map((v, axis) => v - [camera.panX, camera.panY, camera.panZ][axis]), camera.yaw, camera.pitch, camera.roll);
      assert(Math.abs(projected[0] * scale) <= width * .401);
      assert(Math.abs(projected[1] * scale) <= height * .401);
    }
  };
  nodes.forEach((node, index) => registry.draw(node, { label() {},
    box(offset, dimensions) { check(index, offset, dimensions); },
    cylinder(offset, radius, height) { check(index, offset, [2 * radius, height, 2 * radius]); } }));
  assert.equal(camera.perspective, false);
}
context.servoPreview.nodes = [];
assert(Number.isFinite(context.frameAllPreviewCamera().zoom));
console.log('Frame-all camera passed: long rail, rotated mount, child, virtual target, wide/tall viewports and empty scene.');
