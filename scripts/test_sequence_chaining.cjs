const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const playback = source.slice(source.indexOf('function sequenceStepWaitMilliseconds('), source.indexOf('function stopSequence('));
const motion = name => ({ name, durationMs: 100 });
const call = slot => ({ type: 'sequence', slot });
async function run(root, slots, stopOnRead = false, servoReady = true) {
  const moves = [], messages = [], views = [];
  const context = {
    controllerRebooting: false, sequencePlaying: false, sweepRunning: false,
    sequence: root, selectedSequenceSlot: 'a', playbackRateInput: { value: '1' },
    servoControls: [{ ready: servoReady }], sequenceLiveOverrides: new Map(), sequenceRunId: 0,
    sweepButton: {}, sweepAllButton: {}, centerButton: {}, stopSweepButton: {},
    performance: { now: () => 0 }, setText(id, text) { messages.push(text); },
    setServoPlaybackLock() {}, updateSequencerControls() {}, renderSequence() {
      if (context.playbackSequenceView) views.push({ slot: context.playbackSequenceView.slot, index: context.sequenceStepIndex,
        name: context.playbackSequenceView.sequence.steps[context.sequenceStepIndex].name });
    }, stopContinuousServos() {},
    activeStepMotionEnds: () => [], isEligible: () => true,
    async applySequenceStep(step) { moves.push(step.name); }, async waitForStep() {},
    async readSequence(slot) { if (stopOnRead) context.sequenceRunId++; if (!slots[slot]) throw new Error('Missing sequence'); return slots[slot]; }
  };
  vm.createContext(context);
  vm.runInContext(playback, context);
  await context.playSequence();
  return { moves, messages, views, context };
}
(async () => {
  const root = { loop: false, steps: [motion('A1'), call('b'), motion('A2')] };
  const result = await run(root, {
    b: { loop: true, steps: [motion('B1'), call('c'), motion('B2')] },
    c: { loop: false, steps: [motion('C1')] }
  });
  assert.deepEqual(result.moves, ['A1', 'B1', 'C1', 'B2', 'A2']);
  assert.equal(result.context.sequence, root);
  assert.deepEqual(result.views, [
    { slot: 'a', index: 0, name: 'A1' },
    { slot: 'b', index: 0, name: 'B1' },
    { slot: 'c', index: 0, name: 'C1' },
    { slot: 'b', index: 2, name: 'B2' },
    { slot: 'a', index: 2, name: 'A2' }
  ]);
  assert.equal(result.context.playbackSequenceView, null);
  const color = { type: 'color', rgb: [255, 0, 255], durationMs: 100, name: 'LED' };
  const colored = await run({ loop: false, steps: [motion('A1'), call('b'), motion('A2')] }, {
    b: { loop: false, steps: [color, motion('B1')] }
  });
  assert.deepEqual(colored.moves, ['A1', 'LED', 'B1', 'A2']);
  const unavailable = await run({ loop: false, steps: [motion('skip unavailable'), call('b')] }, {
    b: { loop: false, steps: [color] }
  }, false, false);
  assert.deepEqual(unavailable.moves, ['skip unavailable', 'LED'], 'missing servo controller must not block mixed or nested LED playback');
  const circular = await run(root, { b: { steps: [call('a')] } });
  assert.deepEqual(circular.moves, []);
  assert(circular.messages.some(text => text.includes('Circular')));
  const missing = await run(root, {});
  assert.deepEqual(missing.moves, []);
  const stopped = await run(root, { b: { steps: [motion('B')] } }, true);
  assert.deepEqual(stopped.moves, []);
  const empty = await run({ steps: [call('b')] }, { b: { steps: [] } });
  assert(empty.messages.some(text => text.includes('no motion steps')));
  console.log('Sequence chaining passed: nested call/return, child loop runs once, cycles, missing files, empty chains and cancellation during load.');
})().catch(error => { console.error(error); process.exitCode = 1; });
