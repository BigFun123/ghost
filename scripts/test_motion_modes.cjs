const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
let now = 0;
const context = {
  sequencePlaying: false, syncServoStateButtons() {}, syncMotionSpeed() {},
  performance: { now: () => now }, setText() {}, tickServoSimulation() {}
};
vm.createContext(context);
for (const [start, end] of [
  ['function servoCommandLimits(', 'function prepareServoRequest('],
  ['function encodeServoState(', 'async function saveSequenceChange('],
  ['function syncMotionMode(', 'function syncMotionSpeed('],
  ['function updateServoPositionTrail(', 'function activeStepMotionEnds('],
  ['function simulateServoRequest(', 'function tickServoSimulation(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
for (const mode of ['immediate', 'smooth', 'linear']) {
  for (const speed of ['L', 'M', 'H']) for (const muted of [false, true]) for (const solo of [false, true]) {
    const control = { muted, solo, smoothMode: mode === 'smooth', linearMode: mode === 'linear', motionSpeed: speed,
      motionButton: { setAttribute() {} } };
    const encoded = context.encodeServoState(control);
    if (mode !== 'linear') assert(encoded <= 23, 'Existing saved states stay backward compatible');
    const restored = { motionButton: { setAttribute() {} } };
    context.applyServoState(restored, encoded);
    for (const key of ['muted', 'solo', 'smoothMode', 'linearMode', 'motionSpeed']) assert.equal(restored[key], control[key]);
    assert.equal(restored.motionButton.textContent, mode === 'smooth' ? 'S' : mode === 'linear' ? '/' : '-');
  }
}
for (const mode of ['immediate', 'smooth', 'linear']) {
  const node = { angle: 0, enabled: true, outputEnabled: true };
  context.servoPreview = { servoNodes: [node] };
  now = 0;
  context.simulateServoRequest({ channel: 1 }, { angle: '180', motionMode: mode, speed: 'H' });
  if (mode === 'immediate') {
    assert.equal(node.angle, 180); assert.equal(node.motion, null); continue;
  }
  assert.equal(node.motion.duration, mode === 'smooth' ? 1500 : 1000);
  const control = { commandedMotion: node.motion };
  assert.equal(context.estimatedCommandedAngle(control, node.motion.duration / 4), mode === 'linear' ? 45 : 28.125);
  assert.equal(context.estimatedCommandedAngle(control, node.motion.duration * 3 / 4), mode === 'linear' ? 135 : 151.875);
  const tracked = { reportedAngle: 0, slider: { value: '0' } };
  context.trackCommandedMotion(tracked, { angle: '180', motionMode: mode, speed: 'M', playbackRate: '2' }, 0);
  assert.equal(tracked.commandedMotion.duration, mode === 'linear' ? 1000 : 1500);
}
const offNode = { angle: 0, enabled: true, outputEnabled: false };
for (const speed of ['L', 'M', 'H']) for (const rate of [0.5, 1, 2]) {
  const node = { angle: 10, enabled: true, outputEnabled: true };
  context.servoPreview = { servoNodes: [node] };
  now = 0;
  const request = { angle: '90', motionMode: 'linear', speed, durationMs: 2000, playbackRate: String(rate) };
  context.simulateServoRequest({ channel: 1 }, request);
  assert.equal(node.motion.duration, 2000 / rate, 'Step timing overrides the speed and travel distance');
  const control = { reportedAngle: 10, slider: { value: '10' } };
  context.trackCommandedMotion(control, request, 0);
  assert.equal(control.commandedMotion.duration, node.motion.duration);
  assert.equal(context.estimatedCommandedAngle(control, 1000 / rate), 50, 'Halfway through the step is halfway through the move');
  assert.equal(context.estimatedCommandedAngle(control, 2000 / rate), 90, 'Target reached at step deadline');
}
context.servoPreview = { servoNodes: [{ angle: 10, enabled: true, outputEnabled: true }] };
context.simulateServoRequest({ channel: 1 }, { angle: '20', motionMode: 'linear', durationMs: 100, playbackRate: '10' });
assert.equal(context.servoPreview.servoNodes[0].motion.duration, 10, 'Fast playback is not extended to a 50 ms minimum');
context.servoPreview = { servoNodes: [offNode] };
context.simulateServoRequest({ channel: 1 }, { angle: '180', motionMode: 'linear', speed: 'H' });
assert.equal(offNode.angle, 0, 'Linear commands cannot move an output while power is off');
console.log('Motion modes passed: symbols, legacy sequence compatibility, linear/smooth interpolation, speed/rate timing, immediate moves and power-off guard.');
