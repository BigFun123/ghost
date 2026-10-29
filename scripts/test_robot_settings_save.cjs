const { loadComponentRegistry } = require('../devserver/component-registry');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('../devserver/server');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/robots/Walker/config.json'), 'utf8'));
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { disabled: false, addEventListener() {}, replaceChildren() {}, append() {} });
  return elements.get(id);
};
const inputs = new Map();
const form = element('servoSettingsForm');
element('robotName').value = 'Robot';
form.reportValidity = () => true;
form.elements = { namedItem: name => inputs.get(name) };
const context = {
  AbortSignal,
  document: { getElementById: element, querySelectorAll: () => [] },
  servoControls: [], servoSettingsDirty: true, controllerConfiguration: config,
  controllerRebooting: false, localConfigServer: true, offlineSimulation: true,
  sequencePlaying: false, sequenceSaving: false, sequenceLoading: false, sequenceApplying: false,
  robotStorageAvailable: true, currentRobotName: 'Robot', robotPersisted: true, robotFolders: ['Robot'],
  simulationSequences: new Map(), selectedSequenceSlot: 'a', sequence: { loop: false, steps: [] },
  updateRobotFolderControls() {},
  makeElement: () => ({}),
  webcamStream: null, webcamVideo: { style: {} }, selectedWebcamDevice: '', savedWebcamControls: {},
  localStorage: { setItem() {} },
  setText: (id, value) => { element(id).textContent = value; },
  commitPreviewComponentName: () => true,
  initializePreviewPlacementControls() {}, drawServoPreview() {}
};
vm.createContext(context);
  loadComponentRegistry(context);
for (const [start, end] of [
  ['function servoCommandLimits(', 'function prepareServoRequest('],
  ['function configurationWithRobot(', 'function initializeServoPreview('],
  ['function updateConfiguredServoMute(', 'function initializeServoControls('],
  ['function previewConfigurationSnapshot(', 'async function replaceSetupRobot('],
  ['async function saveLocalConfiguration(', 'function renderSetupCameraControls('],
  ['let editedServoName =', 'function openServoSettings('],
  ['function editedServoConfiguration(', 'document.getElementById("servoSettingsForm").addEventListener("input"']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const index = config.components.findIndex(c => (c.objectType ?? 'Servo') === 'Servo');
const normalized = context.configurationWithRobot(config);
context.servoPreview = { configuration: normalized, nodes: context.createRobotNodes(normalized),
  savedNames: config.components.map(c => c.name), editing: true, selected: null,
  yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0, panZ: 0, perspective: false };
context.servoPreview.servoNodes = context.servoPreview.nodes.filter(node => node.objectType === 'Servo');
vm.runInContext(`editedServoIndex = ${index}; editedServoName = servoPreview.nodes[editedServoIndex].name;`, context);
const fields = vm.runInContext('servoSettingsFields', context);
const original = normalized.components[index];
for (const [key, , type] of fields) {
  const value = key.split('.').reduce((current, part) => current?.[part], original);
  inputs.set(key, { value: value == null ? '' : String(value), checked: value === true });
}
inputs.get('name').value = 'Saved walker servo';
inputs.get('startupAngle').value = '115';
inputs.get('initialMotionMode').value = 'smooth';
inputs.get('minPowerWatts').value = '0.4';
inputs.get('maxPowerWatts').value = '18.5';
inputs.get('enabled').checked = false;
inputs.get('reversed').checked = true;
assert(!inputs.has('position.x') && !inputs.has('rotation.x'), 'Transforms remain in component Setup');
context.servoPreview.nodes[index].position[0] = 37.5;
const originalNames = config.components.map(c => c.name);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-settings-'));
fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
const server = createServer(directory);

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  context.fetch = (url, options) => fetch(base + url, options);
  context.robotSequenceEndpoint = slot => '/api/sequence/' + slot + '?robot=' + encodeURIComponent(context.currentRobotName);
  await context.savePreviewConfiguration();
  assert(!element('previewSaveStatus').textContent.startsWith('Save failed'), element('previewSaveStatus').textContent);
  assert.equal(context.servoSettingsDirty, false);
  const saved = await (await fetch(base + '/config.json')).json();
  const servo = saved.components[index];
  const robot = saved.components.find(component => component.objectType === 'Robot');
  assert(robot, 'Physical Robot board is saved with the robot config');
  assert.equal(saved.components.filter(component => (component.objectType ?? 'Servo') === 'Servo').length,
    config.components.filter(component => (component.objectType ?? 'Servo') === 'Servo').length);
  assert.equal(servo.name, 'Saved walker servo');
  assert.equal(servo.startupAngle, 115);
  assert.equal(servo.initialMotionMode, 'smooth');
  assert.equal(servo.minPowerWatts, 0.4);
  assert.equal(servo.maxPowerWatts, 18.5);
  assert.equal(servo.enabled, false);
  assert.equal(servo.reversed, true);
  assert.equal(servo.position.x, 37.5);
  assert(saved.components.filter(c => c.parent === servo.name).length > 0, 'Child references follow rename');
  assert.notEqual(originalNames[index], servo.name);
  await context.savePreviewConfiguration();
  const again = await (await fetch(base + '/config.json')).json();
  assert.deepEqual(again, saved, 'A second save must not restore stale node values');
  const muteControl = { channel: 1, muted: false };
  context.updateConfiguredServoMute(muteControl);
  assert.equal(inputs.get('enabled').checked, true, 'Open settings form follows mixer unmute');
  await context.savePreviewConfiguration();
  const unmuted = await (await fetch(base + '/config.json')).json();
  assert.equal(unmuted.components[index].enabled, true, 'Mixer unmute survives save and reload');
  muteControl.muted = true;
  context.updateConfiguredServoMute(muteControl);
  assert.equal(inputs.get('enabled').checked, false, 'Open settings form follows mixer mute');
  await context.savePreviewConfiguration();
  const muted = await (await fetch(base + '/config.json')).json();
  assert.equal(muted.components[index].enabled, false, 'Mixer mute survives save and reload');
  context.servoSettingsDirty = true;
  inputs.get('minPulseMicroseconds').value = '2500';
  await context.savePreviewConfiguration();
  assert.match(element('previewSaveStatus').textContent, /Save failed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'robots', 'Robot', 'config.json'))), saved);
  context.servoSettingsDirty = false;
  element('robotName').value = 'Renamed Robot';
  await context.savePreviewConfiguration();
  assert(!element('previewSaveStatus').textContent.startsWith('Save failed'), element('previewSaveStatus').textContent);
  assert.equal(context.currentRobotName, 'Renamed Robot');
  assert.equal(fs.existsSync(path.join(directory, 'robots', 'Robot')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'robots', 'Renamed Robot', 'config.json'))), saved);
  context.servoSettingsDirty = false;
  context.robotPersisted = false;
  context.currentRobotName = 'New Test Robot';
  context.robotStorageAvailable = false;
  element('robotName').value = context.currentRobotName;
  await context.savePreviewConfiguration();
  assert(!element('previewSaveStatus').textContent.startsWith('Save failed'), element('previewSaveStatus').textContent);
  assert.equal(context.robotPersisted, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'robots.json'))).active, 'New Test Robot');
  assert.equal(fs.existsSync(path.join(directory, 'robots', 'New Test Robot', 'sequence_a.json')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'robots', 'Renamed Robot', 'config.json'))), saved,
    'Saving a new named robot leaves the previous folder intact');
  console.log('Settings persistence passed: edited form -> Save robot -> reload, rename/children, transforms, repeated save, invalid edits.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  server.close();
  for (const robot of fs.readdirSync(path.join(directory, 'robots'))) {
    const robotDirectory = path.join(directory, 'robots', robot);
    for (const name of fs.readdirSync(robotDirectory)) fs.unlinkSync(path.join(robotDirectory, name));
    fs.rmdirSync(robotDirectory);
  }
  fs.rmdirSync(path.join(directory, 'robots'));
  for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);
});
