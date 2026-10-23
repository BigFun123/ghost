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
    sequence: { finish, loop, steps: [first, second] },
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
  assert.deepEqual(waits, finish ? [1200 / rate, ...Array(count - 1).fill(300 / rate)] : (loop ? [500, 700, 500, 700] : [500, 700]).map(ms => ms / rate));
  if (!loop) assert.equal(context.sequencePlaying, false);
}

(async () => {
  for (const finish of [false, true]) for (const loop of [false, true]) for (const rate of [1, 2]) await checkPlayback(finish, loop, rate);
  console.log('Sequence playback passed: single startup command/wait, smooth first move, timed/Finish modes, looping and playback rates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
