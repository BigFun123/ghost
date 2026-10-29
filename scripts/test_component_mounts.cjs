const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = {};
const registry = loadComponentRegistry(context);
const source = fs.readFileSync('data/app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function rotateServoPoint('), source.indexOf('function previewWorldPoint(')), context);
vm.runInContext(source.slice(source.indexOf('function collectPreviewPhysicsNodes('), source.indexOf('function syncPreviewPhysics(')), context);

// Reference the previous mounting rules to catch changes in either visual or physics poses.
function legacyPoint(nodes, index, point, shaft = false) {
  const node = nodes[index], parent = node.parent === null ? null : nodes[node.parent - 1];
  if (node.objectType === 'Servo') {
    const angle = node.continuous ? node.spinAngle : node.angle;
    const rotation = parent?.objectType === 'U Bracket Long' ? (shaft ? 0 : 90 - angle) : (shaft ? angle - 90 : 0);
    point = context.rotateServoPoint(point, [0, rotation, 0]);
  }
  point = context.rotateServoPoint(point, node.rotation).map((value, axis) => value + node.position[axis]);
  if (!parent) return point;
  const parentFixed = parent.objectType === 'Servo' && parent.parent !== null && nodes[parent.parent - 1].objectType === 'U Bracket Long';
  return legacyPoint(nodes, node.parent - 1, point, node.objectType === 'U Bracket Long' || (node.objectType === 'Servo' && !parentFixed));
}
const types = ['Robot', 'Servo', 'U Bracket Long', 'U Bracket Short', 'Null', 'Box 50 mm'];
for (const grandparent of types) for (const parent of types) for (const child of types) {
  const nodes = [grandparent, parent, child].map((objectType, index) => ({
    objectType, parent: index || null, position: [index * 13, 20, -7], rotation: [13, 24, -11],
    angle: 137, spinAngle: 223, enabled: true, outputEnabled: true
  }));
  for (const continuous of [false, true]) {
    nodes.forEach(node => { node.continuous = continuous; });
    context.servoPreview = { nodes };
    const physics = context.collectPreviewPhysicsNodes();
    nodes.forEach((node, index) => {
      for (const shaft of [false, true]) {
        const actual = context.servoWorldPoint(nodes, index, [4, 8, 12], shaft);
        const expected = legacyPoint(nodes, index, [4, 8, 12], shaft);
        actual.forEach((value, axis) => assert(Math.abs(value - expected[axis]) < 1e-9));
        const center = legacyPoint(nodes, index, [0, 0, 0], shaft);
        physics[index][shaft ? 'shaft' : 'body'].center.forEach((value, axis) => assert(Math.abs(value - center[axis]) < 1e-9));
      }
      const parentNode = index ? nodes[index - 1] : null;
      const parentFixed = parentNode?.objectType === 'Servo' && index > 1 && nodes[index - 2].objectType === 'U Bracket Long';
      const side = parentNode?.objectType === 'Servo' && (node.objectType === 'U Bracket Long' || (node.objectType === 'Servo' && !parentFixed)) ? 'shaft' : 'body';
      assert.equal(physics[index].parentSide, side);
      assert.equal(physics[index].fixedSide, node.objectType === 'Servo' && parentNode?.objectType === 'U Bracket Long' ? 'shaft' : 'body');
    });
  }
}
registry.register({ objectType: 'Custom shaft mount', capabilities: ['shaftMount'], parentSide() { return 'shaft'; }, draw() {} });
const nodes = [{ objectType: 'Custom shaft mount', parent: null }, { objectType: 'Servo', parent: 1 }];
assert.equal(registry.attachment(nodes, 1).fixedSide, 'shaft', 'New mounting components require no app dispatch');
assert(!source.includes('"U Bracket Long"') && !source.includes('"TD-7120MG"') && !source.includes('"esp32-board"'));
console.log('Component mounts passed: legacy visual/physics poses, attachment sides, continuous rotation and custom mounts.');
