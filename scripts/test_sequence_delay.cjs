const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('data/app.js', 'utf8');
const server = fs.readFileSync('devserver/server.js', 'utf8');
const context = { sequence: { finish: true }, performance: { now: () => 0 }, servoControls: [] };
vm.createContext(context);
for (const [source, start, end] of [
  [app, 'async function applySequenceStep(', 'async function selectSequenceStep('],
  [app, 'function sequenceStepWaitMilliseconds(', 'async function playSequence('],
  [server, 'function validateSequence(', 'function writeJsonFile(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);

(async () => {
  for (const durationMs of [1, 1000, 60000]) {
    const step = { type: 'delay', durationMs };
    context.validateSequence({ loop: false, finish: true, steps: [step] }, 20);
    // No hardware, preview, or network dependencies should be touched.
    await context.applySequenceStep(step, true, 2);
    for (const finish of [false, true]) for (const rate of [0.5, 1, 2]) {
      assert.equal(context.sequenceStepWaitMilliseconds(step, rate, [90000], finish), durationMs);
    }
  }
  for (const durationMs of [0, -1, 60001, 1.5, '1000', null]) {
    assert.throws(() => context.validateSequence({ loop: false, steps: [{ type: 'delay', durationMs }] }, 20));
  }
  for (const finish of [false, true]) {
    const waits = [], moves = [];
    const delay = { type: 'delay', durationMs: 1234 };
    const playback = {
      controllerRebooting: false, sequencePlaying: false, sweepRunning: false,
      sequence: { loop: false, finish, steps: [delay, { durationMs: 500 }] },
      selectedSequenceSlot: 'a',
      playbackRateInput: { value: '2' }, servoControls: [{ ready: true }],
      sequenceLiveOverrides: new Map(), sequenceRunId: 0,
      sweepButton: {}, sweepAllButton: {}, centerButton: {}, stopSweepButton: {},
      performance: { now: () => 0 }, isEligible: () => true,
      setText() {}, setServoPlaybackLock() {}, updateSequencerControls() {}, renderSequence() {}, stopContinuousServos() {},
      activeStepMotionEnds: () => [],
      async applySequenceStep(step, startup) { moves.push({ step, startup }); },
      async waitForStep(runId, ms) { waits.push(ms); }
    };
    vm.createContext(playback);
    vm.runInContext(app.slice(app.indexOf('function sequenceStepWaitMilliseconds('), app.indexOf('function stopSequence(')), playback);
    await playback.playSequence();
    assert.deepEqual(waits, [1234, 250]);
    assert.equal(moves[1].startup, true, 'A leading delay preserves the first motion step startup ramp');
    assert.equal(playback.sequencePlaying, false);
  }
  let now = 0, scheduled;
  const cancellation = { sequenceRunId: 1, Date: { now: () => now }, setTimeout(fn) { scheduled = fn; } };
  vm.createContext(cancellation);
  vm.runInContext(app.slice(app.indexOf('function waitForStep('), app.indexOf('function sequenceStepWaitMilliseconds(')), cancellation);
  let stopped = false;
  const waiting = cancellation.waitForStep(1, 60000).then(() => { stopped = true; });
  assert.equal(stopped, false);
  cancellation.sequenceRunId++;
  scheduled();
  await waiting;
  assert.equal(stopped, true, 'Stopping interrupts a delay without waiting for its deadline');
  console.log('Delay steps passed: validation, no output commands, exact delay in both modes at all playback rates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
