const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
class Element {
  constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.value = ''; this.isConnected = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.events[event] = fn; }
  setAttribute(key, value) { this[key] = value; }
  checkValidity() { return true; }
}
const root = new Element('div');
const all = node => [node, ...node.children.flatMap(all)];
const changes = [], switches = [];
const track = { label: 'Desk camera', getSettings: () => ({ width: 640, height: 480, zoom: 2, focusMode: 'continuous', deviceId: 'desk' }),
  getCapabilities: () => ({ zoom: { min: 1, max: 4, step: 0.1 }, focusMode: ['manual', 'continuous'] }),
  getConstraints: () => ({}), async applyConstraints(value) { changes.push(value); } };
const context = {
  document: { activeElement: null, getElementById: id => id === 'setupTransforms' ? root : all(root).find(node => node.id === id), querySelectorAll: () => all(root).filter(node => node.dataset.cameraKey) },
  makeElement: (tag, cls, text) => new Element(tag, text), servoPreview: { selected: 'camera', panX: 0, panY: 0, panZ: 0, pitch: 0, yaw: 0, roll: 0, zoom: 1 },
  savePreviewCamera() {}, drawServoPreview() {}, webcamStream: { getVideoTracks: () => [track] }, webcamToggle: Object.assign(new Element("button"), { disabled: false }),
  webcamVideo: { style: {} }, selectedWebcamDevice: '', savedWebcamControls: {}, navigator: { mediaDevices: { getUserMedia() {}, async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'desk', label: 'Desk camera' }, { kind: 'videoinput', deviceId: 'side', label: 'Side camera' }]; } } },
  startWebcam(id) { switches.push(id); }, setText() {}
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// The viewing camera is a built-in'), source.indexOf('function initializePreviewPlacementControls()')), context);
(async () => {
  context.renderSetupCameraControls();
  await context.refreshSetupWebcamControls();
  const yaw = all(root).find(node => node.dataset.cameraKey === 'yaw');
  yaw.value = '90'; yaw.events.change();
  assert.equal(context.servoPreview.yaw, Math.PI / 2);
  const roll = all(root).find(node => node.dataset.cameraKey === 'roll');
  roll.value = '15'; roll.events.change();
  assert(Math.abs(context.servoPreview.roll - Math.PI / 12) < 1e-9);
  const cameraHost = all(root).find(node => node.id === 'setupWebcamControls');
  const label = text => all(cameraHost).find(node => node.tag === 'label' && node.textContent === text);
  assert(label('Optical zoom')); assert(label('Focus mode')); assert(!label('Exposure time'));
  const zoom = label('Optical zoom').children[0]; zoom.value = '3'; await zoom.events.change();
  assert.equal(changes[0].advanced[0].zoom, 3);
  assert.equal(context.savedWebcamControls.zoom, 3);
  await context.refreshSetupWebcamControls();
  const devices = label('Camera device').children[0];
  assert.equal(devices.children.length, 3);
  devices.value = 'side'; devices.events.change(); assert.deepEqual(switches, ['side']);
  const mirror = label('Mirror video').children[0]; mirror.checked = true; mirror.events.change();
  assert.equal(context.webcamVideo.style.transform, 'scaleX(-1)');
  assert.equal(context.servoPreview.panX, 0);
  console.log('Camera Setup passed: rotation controls, device listing/switching, supported-only camera settings and mirrored video.');
})().catch(error => { console.error(error); process.exitCode = 1; });
