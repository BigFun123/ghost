const { loadComponentRegistry } = require('../devserver/component-registry');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
const walker = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/robots/Walker/config.json'), 'utf8'));
const element = () => ({ attrs: {}, handlers: {}, disabled: false, value: 0,
  setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, callback) { this.handlers[event] = callback; },
  classList: { toggle() {} }, firstElementChild: {}, lastElementChild: {}, children: [{}, {}, {}] });
const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
let release;
const oldStrip = element();
const masterStrip = element(), sequencerStrip = element();
const oldControl = { strip: oldStrip, timer: null, pendingCommand: { angle: '180' }, requestQueue: new Promise(resolve => { release = resolve; }) };
const context = {
  console, clearTimeout, controllerRebooting: false, offlineSimulation: true,
  robotFolders: [], robotPersisted: true, currentRobotName: 'Robot', updateRobotFolderControls() {},
  previewPhysics: null, previewPhysicsEnabled: false,
  commandModeRevision: 0, sequenceLoading: false, sequenceSaving: false, sequenceApplying: false,
  servoPreview: { editing: true, savedNames: ['Persisted robot'] }, servoControls: [oldControl],
  simulationSequences: new Map([['a', { steps: [1] }]]),
  document: { getElementById: getElement }, allServosOffButton: element(),
  mixer: { strips: [masterStrip, sequencerStrip, oldStrip], append(strip) {
    this.strips.push(strip);
    strip.remove = () => { this.strips = this.strips.filter(child => child !== strip); };
  }, replaceChildren() { this.strips = []; } },
  createServoStrip() {
    return Object.fromEntries(['strip', 'slider', 'powerButton', 'muteButton', 'soloButton',
      'motionButton', 'speedButton', 'reverseButton', 'scale'].map(key => [key, element()]));
  },
  servoCommandText: (_, angle) => String(angle),
  setText: (id, value) => { getElement(id).textContent = value; },
  setOfflineSimulation: enabled => { context.offlineSimulation = enabled; },
  stopSweep() {}, stopSequence() {}, setServoPlaybackLock() {}, renderSequence() {},
  updateSequencerControls() {}, clearPreviewTreeDrag() {}, initializePreviewPlacementControls() {}, drawServoPreview() {}
};
oldStrip.remove = () => { context.mixer.strips = context.mixer.strips.filter(child => child !== oldStrip); };
vm.createContext(context);
  loadComponentRegistry(context);
for (const [start, end] of [
  ['function syncServoStateButtons(', 'async function runMacro('],
  ['function syncReverse(', 'async function setServoPower('],
  ['function configurationWithRobot(', 'function initializeServoPreview('],
  ['function refreshAddedComponent(', 'document.getElementById("previewAddComponent").addEventListener('],
  ['async function replaceSetupRobot(', 'function downloadPreviewConfiguration(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);

(async () => {
  const pending = context.replaceSetupRobot(walker, 'Loaded');
  assert.equal(getElement('previewSave').disabled, true);
  assert.equal(oldControl.pendingCommand, null);
  assert.equal(context.commandModeRevision, 1);
  assert.equal(context.servoControls[0], oldControl, 'Wait for old requests before rebuilding');
  release();
  await pending;
  const servos = walker.components.filter(c => (c.objectType ?? 'Servo') === 'Servo');
  assert.equal(context.servoControls.length, servos.length);
  assert.equal(context.mixer.strips.length, servos.length + 2);
  assert(context.mixer.strips.includes(masterStrip), 'Master controls survive robot replacement');
  assert(context.mixer.strips.includes(sequencerStrip), 'Sequencer controls survive robot replacement');
  context.servoControls.forEach((control, index) => {
    const config = servos[index], node = context.servoPreview.servoNodes[index];
    assert(context.servoPreview.nodes.includes(node));
    assert.equal(control.name, config.name);
    assert.equal(Number(control.slider.value), config.startupAngle ?? 90);
    assert.equal(control.outputEnabled, false);
    assert.equal(control.powerButton.attrs['aria-pressed'], 'false');
    assert.equal(control.muteButton.attrs['aria-pressed'], String(config.enabled === false));
    assert.equal(control.motionButton.attrs['aria-pressed'], String((config.initialMotionMode ?? 'smooth') === 'smooth'));
    assert.equal(node.outputEnabled, false);
    assert.equal(node.enabled, config.enabled !== false);
    assert.equal(node.ready, true);
    assert.equal(getElement('servoStatus' + control.channel).textContent, 'Off');
  });
  assert.equal(getElement('servoPowerLabel').textContent, 'OFF');
  assert.equal(getElement('previewOffline').disabled, true);
  assert.equal(context.servoPreview.savedNames[0], 'Persisted robot');
  assert.equal(context.sequence.steps.length, 0);
  assert.equal(context.simulationSequences.size, 0);
  await context.newRobot();
  assert.equal(context.servoControls.length, 1);
  assert.equal(context.mixer.strips.length, 3, 'Repeated loads replace only servo strips');
  assert.equal(context.servoControls[0].muted, false, 'New robot servo starts unmuted');
  assert.equal(context.servoControls[0].outputEnabled, false, 'New robot servo starts with power off');
  context.previewConfigurationSnapshot = () => JSON.parse(JSON.stringify(context.servoPreview.configuration));
  vm.runInContext(source.slice(source.indexOf('document.getElementById("previewAdd").addEventListener('), source.indexOf('document.getElementById("previewRemove").addEventListener(')), context);
  const existingControl = context.servoControls[0];
  existingControl.muted = true;
  existingControl.outputEnabled = true;
  getElement('previewAddComponent').value = 'micro';
  getElement('previewAdd').handlers.click();
  assert.equal(context.servoControls.length, 2, 'Adding a servo immediately adds its mixer strip');
  assert.equal(context.servoControls[1].channel, 2, 'New strip has the next runtime ID');
  assert.equal(context.servoControls[1].ready, true);
  assert.equal(context.servoControls[1].muted, false);
  assert.equal(context.servoControls[1].outputEnabled, false);
  assert.equal(context.servoControls[0], existingControl);
  assert.equal(existingControl.muted, true, 'Existing mixer state is preserved');
  assert.equal(existingControl.outputEnabled, true);
  assert.equal(context.servoPreview.servoNodes.length, 2);
  assert.equal(context.controllerConfiguration.components.at(-1).model, 'micro');
  assert.equal(context.mixer.strips.length, 4, 'Master and sequencer controls remain intact');
  context.offlineSimulation = false;
  getElement('previewAddComponent').value = 'standard';
  getElement('previewAdd').handlers.click();
  assert.equal(context.servoControls.length, 3);
  assert.equal(context.servoControls[2].ready, false, 'Unsaved hardware channel is not commandable');
  assert.equal(context.servoControls[2].powerButton.disabled, true);
  const current = context.servoPreview.nodes;
  await assert.rejects(context.replaceSetupRobot({ components: [] }, ''), /1-20/);
  assert.equal(context.servoPreview.nodes, current, 'Invalid config preserves existing robot');
  console.log('Robot loading passed: walker states, master OFF, pending requests, mapping, repeated loads, invalid files.');
})().catch(error => { console.error(error); process.exitCode = 1; });
