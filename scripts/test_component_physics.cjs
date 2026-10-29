const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = {};
const registry = loadComponentRegistry(context);
for (const definition of registry.choices().concat(registry.withCapability('root'))) {
  const node = { objectType: definition.objectType, ...definition.defaults };
  const physics = registry.getPhysics(node);
  assert.equal(typeof physics.real, 'boolean');
  assert(physics.real ? physics.massGrams > 0 : physics.massGrams === 0);
  assert.equal(registry.getPhysics({ ...node, massGrams: 123 }).massGrams, physics.real ? 123 : 0);
  assert.throws(() => registry.getPhysics({ ...node, massGrams: -1 }), /Mass/);
}
const source = fs.readFileSync('data/app.js', 'utf8');
for (const [start, end] of [
  ['function rotateServoPoint(', 'function drawPreviewConstraintGuides('],
  ['function collectPreviewPhysicsShapes(', 'function syncPreviewPhysics(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const node = (objectType, parent) => ({ objectType, parent, position: [10, 0, 0], rotation: [0, 0, 0], angle: 90 });
context.servoPreview = { nodes: [node('Robot', null), node('Target', 1), node('Box 50 mm', 2)] };
const physics = context.collectPreviewPhysicsNodes();
assert.deepEqual(Array.from(physics, node => node.index), [0, 2]);
assert.equal(physics[1].parent, 0, 'Physical child attaches through virtual parent');
assert.equal(physics[1].massGrams, 100);
assert(context.collectPreviewPhysicsShapes().every(shape => shape.index !== 1), 'Virtual geometry never becomes a collider');
context.servoPreview.nodes[1].massGrams = 500;
assert.equal(registry.getPhysics(context.servoPreview.nodes[1]).massGrams, 0, 'Saved overrides cannot give a virtual node mass');
context.previewPhysicsEnabled = true;
context.previewPhysics = { point(index, point) { assert.equal(index, 0); return point.map(value => value + 100); } };
assert.deepEqual(Array.from(context.previewWorldPoint(context.servoPreview.nodes, 1, [0, 0, 0])), [110, 100, 100]);
context.servoPreview.nodes = [node('Target', null)];
assert.equal(context.collectPreviewPhysicsNodes().length, 0);
assert.equal(context.collectPreviewPhysicsShapes().length, 0);
console.log('Component physics passed: per-model metadata, mass overrides, virtual exclusion, attachment chains and simulated visual placement.');
