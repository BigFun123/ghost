const { loadComponentRegistry } = require('../devserver/component-registry');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateConfiguration } = require('../devserver/server');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/robots/Walker/config.json')));
const expected = {
  'PCA9685 Servo Controller': [62, 8, 25],
  'Aluminium Panel 50x50 mm': [50, 2, 50],
  'Aluminium Panel 50x100 mm': [50, 2, 100],
  'Box 50 mm': [50, 50, 50],
  'Aluminium Extrusion 20x20x100 mm': [20, 100, 20]
};
for (const [type, dimensions] of Object.entries(expected)) {
  let add;
  const context = {
    document: { getElementById: id => id === 'previewAdd' ? { addEventListener: (_, callback) => { add = callback; } } : { value: type } },
    initializePreviewPlacementControls() {}, setText() {}, drawServoPreview() {}, refreshAddedComponent() {}
  };
  vm.createContext(context);
  loadComponentRegistry(context);
  vm.runInContext(source.slice(source.indexOf('function servoCommandLimits('), source.indexOf('function prepareServoRequest(')), context);
  vm.runInContext(source.slice(source.indexOf('function configurationWithRobot('), source.indexOf('function initializeServoPreview(')), context);
  const config = context.configurationWithRobot(fixture);
  const nodes = context.createRobotNodes(config);
  const servoCount = nodes.filter(node => node.objectType === 'Servo').length;
  context.servoPreview = { editing: true, configuration: config, nodes,
    servoNodes: nodes.filter(node => node.objectType === 'Servo'), savedNames: config.components.map(c => c.name) };
  vm.runInContext(source.slice(source.indexOf('document.getElementById("previewAdd").addEventListener('), source.indexOf('document.getElementById("previewRemove").addEventListener(')), context);
  add();
  const added = config.components.at(-1), node = context.servoPreview.nodes.at(-1);
  assert.equal(added.objectType, type);
  assert.equal(added.parent, config.components.find(c => c.objectType === 'Robot').name);
  assert.equal(nodes[node.parent - 1].objectType, 'Robot');
  assert.equal(context.servoPreview.servoNodes.length, servoCount, 'Hardware consumes no servo channel');
  validateConfiguration(JSON.parse(JSON.stringify(config)));
  assert.equal(context.createRobotNodes(config).at(-1).objectType, type, 'Config reload accepts hardware');
  const boxes = [];
  context.recordBox = (offset, size, color, shaft) => {
    assert(size.every(value => Number.isFinite(value) && value > 0));
    assert.equal(shaft, false);
    boxes.push({ offset, size });
  };
  vm.runInContext(`componentRegistry.draw({objectType: ${JSON.stringify(type)}}, { box: recordBox, label() {} });`, context);
  const bounds = [0, 1, 2].map(axis =>
    Math.max(...boxes.map(box => box.offset[axis] + box.size[axis] / 2)) -
    Math.min(...boxes.map(box => box.offset[axis] - box.size[axis] / 2)));
  assert.deepEqual(bounds, dimensions, 'Model has the specified physical dimensions');
}
console.log('Hardware components passed: dimensions, addition/attachment, unchanged servo count, config validation and reload.');
