const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
let now = 100, renders = 0;
const controls = Array.from({ length: 3 }, (_, i) => ({ channel: i + 1, ready: true, outputEnabled: true,
  muted: false, solo: false, smoothMode: false, linearMode: true, motionSpeed: 'M', slider: {}, requestQueue: Promise.resolve() }));
const nodes = controls.map(() => ({ angle: 0, enabled: true, outputEnabled: true }));
const requests = [];
const context = {
  controllerRebooting: false, commandModeRevision: 0, sequencePlaying: false, sequenceRunId: 1,
  offlineSimulation: true, servoControls: controls, servoPreview: { servoNodes: nodes },
  performance: { now: () => now }, setText() {}, servoCommandText: (_, angle) => String(angle), applyServoState() {},
  tickServoSimulation() {
    assert(nodes.every(node => node.motion), 'All targets are set before any expensive redraw');
    renders++; now += 3000;
  },
  fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, text: async () => 'OK' }; },
  trackCommandedMotion() {}
};
vm.createContext(context);
for (const [start, end] of [
  ['async function applySequenceStep(', 'async function selectSequenceStep('],
  ['function requestServoBatch(', 'async function performServoRequest('],
  ['function simulateServoRequest(', 'function tickServoSimulation(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const step = { angles: [90, 120, 150], servoStates: [48, 48, 48], durationMs: 2000 };
(async () => {
  await context.applySequenceStep(step);
  assert(nodes.every(node => node.motion.at === 100), 'Shared start time even when rendering takes longer than the motion');
  assert(nodes.every(node => node.motion.duration === 2000), 'Different linear travel distances finish together at step end');
  assert.equal(renders, 1);
  assert.deepEqual(controls.map(control => control.slider.value), ['90', '120', '150']);
  context.offlineSimulation = false;
  await context.applySequenceStep(step, true);
  assert.equal(requests.length, 1, 'Whole step uses one HTTP request');
  assert.equal(requests[0].url, '/api/servos');
  assert.equal(requests[0].body.commands.length, 3);
  assert(requests[0].body.commands.every(command => command.motionMode === 'linear'));
  assert(requests[0].body.commands.every(command => command.durationMs === 2000), 'Initial linear step also uses the step duration');
  let release;
  controls[0].requestQueue = new Promise(resolve => { release = resolve; });
  context.sequencePlaying = true;
  const queued = context.applySequenceStep(step);
  controls[1].outputEnabled = false;
  controls[2].muted = true;
  release();
  await queued;
  const latest = requests.at(-1).body.commands;
  assert.equal(latest[1].angle, undefined, 'Power-off during queue wait strips the angle');
  assert.equal(latest[2].enabled, false, 'Latest mute state is applied at dispatch');
  assert(latest.every(command => !Object.hasOwn(command, 'outputEnabled')), 'Steps cannot turn PWM back on');
  controls[0].requestQueue = new Promise(resolve => { release = resolve; });
  const cancelled = context.applySequenceStep(step);
  context.sequenceRunId++;
  release();
  await cancelled;
  assert.equal(requests.length, 2, 'A stopped playback cannot dispatch a queued batch');
  console.log('Servo batch passed: simultaneous simulated starts, one redraw/request, queue draining, latest mute/power state and playback cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
