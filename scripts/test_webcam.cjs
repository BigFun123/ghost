const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const webcamSource = source.slice(source.indexOf('const webcamToggle ='), source.indexOf('const tabs ='));
function setup(getUserMedia) {
  const messages = [], listeners = {};
  const button = { disabled: false, setAttribute(key, value) { this[key] = value; }, addEventListener(event, fn) { this.click = fn; } };
  const video = { hidden: true, async play() {} };
  const context = { document: { getElementById: id => id === 'webcamToggle' ? button : video },
    navigator: { mediaDevices: getUserMedia ? { getUserMedia } : undefined },
    window: { isSecureContext: false, addEventListener(event, fn) { listeners[event] = fn; } },
    previewReady: true, servoPreview: { active: true }, drawServoPreview() {}, refreshSetupWebcamControls() {}, setText(id, value) { messages.push(value); } };
  vm.createContext(context); vm.runInContext(webcamSource, context);
  return { button, video, context, messages, listeners };
}
(async () => {
  let stops = 0;
  const track = { stop() { stops++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const active = setup(async options => { assert.equal(options.audio, false); return stream; });
  await active.button.click();
  assert.equal(active.video.srcObject, stream);
  assert.equal(active.video.hidden, false);
  assert.equal(active.button['aria-pressed'], 'true');
  await active.button.click();
  assert.equal(stops, 1); assert.equal(active.video.srcObject, null); assert.equal(active.video.hidden, true);
  const denied = setup(async () => { throw new Error('Permission denied'); });
  await denied.button.click();
  assert.equal(denied.button.disabled, false); assert.equal(denied.video.hidden, true);
  assert(denied.messages.at(-1).includes('Permission denied'));
  const insecure = setup(); await insecure.button.click();
  assert(insecure.messages.at(-1).includes('HTTPS or localhost'));
  let grant;
  const pending = setup(() => new Promise(resolve => { grant = resolve; }));
  const request = pending.button.click();
  pending.listeners.pagehide(); grant(stream); await request;
  assert.equal(stops, 2); assert.equal(pending.video.hidden, true);
  console.log('Webcam passed: activation, camera shutdown, denied permission, insecure context and cancelled pending access.');
})().catch(error => { console.error(error); process.exitCode = 1; });
