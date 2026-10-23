const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const buttons = [...'abcdefghij'].map(slot => ({ dataset: { slot }, addEventListener(event, callback) { this.click = callback; } }));
const context = {
  document: { querySelectorAll: () => buttons }, sequenceSaving: false, sequencePlaying: false,
  sequenceApplying: false, controllerRebooting: false, sweepRunning: false,
  sequence: { loop: true, steps: [] }, selectedSequenceStepIndex: 2, sequenceLoaded: true,
  updateSequencerControls() {}, renderSequence() {}, setText() {},
  async loadSequence() { if (context.fail) throw new Error('Load failed'); context.sequence = { loop: false, steps: [] }; }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('let sequenceLoading = false;'), source.indexOf('\nlet overdueSequenceSteps')), context);
(async () => {
  await buttons[1].click();
  assert.equal(vm.runInContext('sequenceEndpoint()', context), '/api/sequence/b');
  assert.equal(context.selectedSequenceStepIndex, -1);
  context.sequencePlaying = true;
  await buttons[2].click();
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'b');
  context.sequencePlaying = false;
  context.sequenceSaving = true;
  await buttons[2].click();
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'b');
  context.sequenceSaving = false;
  context.fail = true;
  const previous = context.sequence;
  await buttons[2].click();
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'b');
  assert.equal(context.sequence, previous);
  assert.equal(vm.runInContext('sequenceLoading', context), false);
  console.log('Sequence slot switching passed: file selection, playback/save locks and failed-load rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
