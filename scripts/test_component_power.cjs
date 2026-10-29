const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const { validateConfiguration } = require('../devserver/server');
const app = fs.readFileSync('data/app.js', 'utf8');
const context = { servoPreview: null, setText() {}, webcamStream: null, webcamVideo: { hidden: true, style: {} }, selectedWebcamDevice: '', savedWebcamControls: {} };
context.makeElement = (tag, cls, text) => ({ tag, children: [], value: '', append(child) { this.children.push(child); }, setAttribute() {}, addEventListener(event, fn) { this[event] = fn; } });
vm.createContext(context); loadComponentRegistry(context);
for (const [start, end] of [
  ['function configurationWithRobot(', 'function initializeServoPreview('],
  ['function renderComponentPower(', 'function renderComponentMass('],
  ['function previewConfigurationSnapshot(', 'function updateRobotFolderControls(']
]) vm.runInContext(app.slice(app.indexOf(start), app.indexOf(end)), context);
const config = JSON.parse(fs.readFileSync('data/robots/Walker/config.json', 'utf8'));
context.servoPreview = { configuration: config, nodes: context.createRobotNodes(config), editing: true,
  yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0, panZ: 0, perspective: false };
const node = context.servoPreview.nodes[0], host = { children: [], append(child) { this.children.push(child); } };
context.renderComponentPower(node, host);
const min = host.children[0].children[1].children[0], max = host.children[0].children[2].children[0];
assert.equal(min.value, ''); assert.equal(max.value, '');
min.value = '0.5'; min.change(); max.value = '3.25'; max.change();
let snapshot = context.previewConfigurationSnapshot();
assert.equal(snapshot.components[0].minPowerWatts, 0.5);
assert.equal(snapshot.components[0].maxPowerWatts, 3.25);
validateConfiguration(JSON.parse(JSON.stringify(snapshot)));
assert.equal(context.createRobotNodes(snapshot)[0].maxPowerWatts, 3.25);
min.value = '4'; min.change(); assert.equal(node.minPowerWatts, 0.5, 'Reject reversed ranges');
min.value = ''; min.change(); max.value = ''; max.change();
snapshot = context.previewConfigurationSnapshot();
assert.equal(snapshot.components[0].minPowerWatts, null);
assert.equal(snapshot.components[0].maxPowerWatts, null);
const voltage = host.children[0].children[3].children[0];
const idle = host.children[0].children[4].children[0];
const running = host.children[0].children[5].children[0];
const peak = host.children[0].children[6].children[0];
for (const [input, value] of [[voltage, '5'], [idle, '0.1'], [running, '0.2'], [peak, '0.4']]) {
  input.value = value; input.change();
}
snapshot = context.previewConfigurationSnapshot();
validateConfiguration(JSON.parse(JSON.stringify(snapshot)));
assert.equal(snapshot.components[0].powerVoltageVolts, 5);
assert.equal(snapshot.components[0].runningCurrentAmps, 0.2);
const reloaded = context.createRobotNodes(snapshot)[0];
assert.equal(reloaded.peakCurrentAmps, 0.4);
const range = vm.runInContext('componentRegistry', context).getPower(reloaded);
assert.equal(range.min, 0.5); assert.equal(range.running, 1); assert.equal(range.max, 2);
assert.equal(snapshot.components[0].minPowerWatts, null, 'Electrical edits clear watt overrides');
for (const values of [{powerVoltageVolts:0}, {idleCurrentAmps:-1}, {runningCurrentAmps:0.5}, {peakCurrentAmps:0.05}]) {
  const invalid = JSON.parse(JSON.stringify(snapshot));
  Object.assign(invalid.components[0], values);
  assert.throws(() => validateConfiguration(invalid), /[Vv]oltage|[Cc]urrent/);
  assert.throws(() => context.createRobotNodes(invalid), /[Vv]oltage|[Cc]urrent/);
}
for (const values of [[-1, 2], [4, 2], ['1', 2], [0, Infinity]]) {
  snapshot.components[0].minPowerWatts = values[0]; snapshot.components[0].maxPowerWatts = values[1];
  assert.throws(() => validateConfiguration(snapshot), /[Pp]ower/);
  assert.throws(() => context.createRobotNodes(snapshot), /[Pp]ower/);
}
console.log('Component power passed: editable watt ranges, snapshot/reload, unknown calibration and invalid range rejection.');
