const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');

async function checkPlayback(finish, loop, rate = 1) {
  const calls = [], waits = [];
  let now = 0, motionEnd = 0;
  const first = { durationMs: 500 }, second = { durationMs: 700 };
  const context = {
    controllerRebooting: false, sequencePlaying: false, sweepRunning: false,
    sequence: { finish, loop: false, steps: loop ? [first, second, { type: 'sequence', slot: 'a' }] : [first, second] },
    selectedSequenceSlot: 'a',
    playbackRateInput: { value: String(rate) }, servoControls: [{ ready: true }],
    sequenceLiveOverrides: new Map(), sequenceRunId: 0, sequenceStepIndex: -1,
    sweepButton: {}, sweepAllButton: {}, centerButton: {}, stopSweepButton: {},
    performance: { now: () => now }, isEligible: () => true,
    setText() {}, setServoPlaybackLock() {}, updateSequencerControls() {}, renderSequence() {}, stopContinuousServos() {},
    activeStepMotionEnds: () => [motionEnd],
    async applySequenceStep(step, startup, playbackRate) {
      calls.push({ step, startup, playbackRate });
      motionEnd = now + (startup ? 1200 : 300) / playbackRate;
    },
    async waitForStep(runId, milliseconds) {
      if (milliseconds === 16) return; // Cooperative yield at a sequence jump.
      waits.push(milliseconds);
      now += milliseconds;
      if (loop && waits.length === 4) context.sequenceRunId++;
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function sequenceStepWaitMilliseconds('), source.indexOf('function stopSequence(')), context);
  await context.playSequence();
  const count = loop ? 4 : 2;
  assert.equal(calls.length, count, 'Each step must be commanded once, including startup');
  assert.equal(waits.length, count, 'Each step must have only one wait');
  assert.deepEqual(calls.map(call => call.startup), loop ? [true, false, false, false] : [true, false]);
  assert.deepEqual(calls.map(call => call.step), loop ? [first, second, first, second] : [first, second]);
  assert.deepEqual(waits, finish ? (loop ? [1200, 700, 500, 700] : [1200, 700]).map(ms => ms / rate) : (loop ? [500, 700, 500, 700] : [500, 700]).map(ms => ms / rate));
  if (!loop) assert.equal(context.sequencePlaying, false);
}

(async () => {
  const timing = {
    sequence: { finish: true }, performance: { now: () => 100 },
    servoControls: [], isEligible: () => true
  };
  vm.createContext(timing);
  vm.runInContext(source.slice(source.indexOf('function sequenceStepWaitMilliseconds('),
    source.indexOf('async function playSequence(')), timing);
  const step = { durationMs: 700 };
  assert.equal(timing.sequenceStepWaitMilliseconds(step, 1, []), 700, 'Immediate moves retain the full step duration');
  assert.equal(timing.sequenceStepWaitMilliseconds(step, 1, [300, 1300]), 1200, 'Finish waits for the slowest servo');
  assert.equal(timing.sequenceStepWaitMilliseconds(step, 2, [200]), 350, 'Step duration follows playback rate');
  assert.equal(timing.sequenceStepWaitMilliseconds(step, 1, [1300], false), 700, 'Timed mode can overlap a longer move');
  for (const finish of [false, true]) for (const loop of [false, true]) for (const rate of [1, 2]) await checkPlayback(finish, loop, rate);
  console.log('Sequence playback passed: single startup command/wait, smooth first move, timed/Finish modes, looping and playback rates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
