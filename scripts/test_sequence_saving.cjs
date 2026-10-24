const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const buttons = [...'abcdefghij'].map(slot => ({ dataset: { slot }, addEventListener(event, callback) { this.click = callback; } }));
const files = new Map([['b', { loop: false, steps: [] }]]);
const requests = [];
const context = {
  document: { querySelectorAll: () => buttons },
  sequenceSaving: false, sequencePlaying: false, sequenceApplying: false,
  controllerRebooting: false, sweepRunning: false, offlineSimulation: false, localConfigServer: false,
  selectedSequenceStepIndex: -1, sequenceLoaded: true, sequence: { loop: false, steps: [] },
  renderSequence() {}, updateSequencerControls() {}, setText() {},
  async fetch(url, options) {
    return new Promise(resolve => requests.push({ url, body: JSON.parse(options.body), complete(ok = true) {
      if (ok) files.set(url.at(-1), JSON.parse(options.body));
      resolve({ ok, text: async () => ok ? 'Saved' : 'Write failed' });
    } }));
  },
  async loadSequence() { context.sequence = files.get(vm.runInContext('selectedSequenceSlot', context)); }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('let sequenceLoading = false;'), source.indexOf('\nlet overdueSequenceSteps')), context);
vm.runInContext(source.slice(source.indexOf('async function saveSequenceChange('), source.indexOf('\nasync function readSequence(')), context);
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const first = { loop: false, steps: [{ type: 'color', rgb: [255, 0, 0], durationMs: 100 }] };
  const second = { ...first, steps: [...first.steps, { type: 'color', rgb: [0, 0, 255], durationMs: 100 }] };
  const save1 = context.saveSequenceChange(first);
  const save2 = context.saveSequenceChange(second);
  const switchToB = buttons[1].click();
  await tick();
  assert.equal(requests.length, 1, 'writes must be serialized');
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'a');
  requests[0].complete();
  await tick();
  assert.equal(requests.length, 2, 'the overlapping edit must not be dropped');
  assert.equal(requests[1].url, '/api/sequence/a');
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'a', 'slot switch must wait for every queued save');
  requests[1].complete();
  assert.equal(await save1, true);
  assert.equal(await save2, true);
  await switchToB;
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'b');
  assert.deepEqual(files.get('a'), second);
  await buttons[0].click();
  assert.deepEqual(context.sequence, second, 'returning to A must restore both saved steps');
  const failed = context.saveSequenceChange({ loop: true, steps: [] });
  const failedSwitch = buttons[1].click();
  await tick();
  requests[2].complete(false);
  assert.equal(await failed, false);
  await failedSwitch;
  assert.equal(vm.runInContext('selectedSequenceSlot', context), 'a', 'failed save must prevent navigation');
  assert.deepEqual(context.sequence, second);
  console.log('Sequence saving passed: queued edits, slot-bound payloads, A/B round trip, waiting for writes and failure rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
