const { loadComponentRegistry } = require('../devserver/component-registry');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
const context = { previewPhysicsEnabled: false, previewPhysics: null };
vm.createContext(context);
  loadComponentRegistry(context);
for (const [start, end] of [
  ['function rotateServoPoint(', 'function drawPreviewConstraintGuides('],
  ['function previewRayDistance(', 'function drawServoPreview(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const ray = context.previewRayDistance;
assert.equal(ray([0, 100, 0], [0, -1, 0], [], 0), 100, 'Floor is solid without any scene meshes');
assert.equal(ray([0, 100, 0], [0, 1, 0], [], 0), null);
assert.equal(ray([0, 100, 0], [0, 0, 1], [], 0), null);
assert.equal(ray([0, -1, 0], [0, 1, 0], [], 0), 0, 'Below-floor origin is inside solid ground');
assert.equal(ray([0, 0, 0], [0, -1, 0], [], 0), 0);
assert.equal(ray([0, 2500, 0], [0, -1, 0], [], 0), null, 'Display ray is limited to 2000 mm');
const surface = { index: 1, vertices: [[-10, 50, -10], [10, 50, -10], [10, 50, 10], [-10, 50, 10]] };
assert.equal(ray([0, 100, 0], [0, -1, 0], [surface], 0), 50, 'Nearest scene surface blocks the beam');
assert.equal(ray([0, 100, 0], [0, -1, 0], [surface], 1), 100, 'Ignore the sensor itself');
assert.equal(ray([20, 100, 0], [0, -1, 0], [surface], 0), 100, 'A missed surface leaves the floor hit');
assert.equal(ray([0, 100, 0], [0, -1, 0], [{ ...surface, index: null }], 0), 50, 'Physics props also block the beam');
const nodes = [
  { objectType: 'Robot', parent: null, position: [0, 100, 0], rotation: [90, 0, 0] },
  { objectType: 'VL53L0X V2 Time of Flight Sensor', parent: 1, position: [0, 0, 0], rotation: [0, 0, 0] }
];
const labels = [], lines = [], dashes = [];
const ctx = { save() {}, restore() {}, setLineDash(value) { dashes.push(value); }, beginPath() {}, arc() {}, fill() {},
  strokeText() {}, fillText(text) { labels.push(text); } };
vm.runInContext('componentRegistry', context).drawOverlays({ ctx, nodes, surfaces: [], project: point => point,
  line: (start, end) => lines.push({ start, end }), worldPoint: context.previewWorldPoint,
  rayDistance: context.previewRayDistance, state: { ledRgb: [0, 0, 0] }, ratio: 1 });
assert.equal(labels[0], '96.9 mm (sim)', 'Distance starts at the optical face and follows the parent rotation');
assert(Math.abs(lines[0].end[1]) < 0.000001);
assert(dashes[0].length === 2 && dashes[1].length === 0, 'Beam is dotted and dash style is reset');
console.log('Distance sensor passed: floor, range, self exclusion, nearest scene/physics surfaces, parent transforms, dotted beam and label.');
