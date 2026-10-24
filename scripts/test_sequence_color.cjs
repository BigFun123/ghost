const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const server = fs.readFileSync(require('node:path').join(__dirname, '../devserver/server.js'), 'utf8');
const context = { offlineSimulation: false, AbortSignal, JSON,
  async fetch(url, options) {
    assert.equal(url, '/api/led');
    assert.deepEqual(JSON.parse(options.body), { rgb: [255, 0, 255] });
    return { ok: true };
  }
};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('async function applySequenceStep('), app.indexOf('async function selectSequenceStep(')), context);
vm.runInContext(server.slice(server.indexOf('function validateSequence('), server.indexOf('function writeJsonFile(')), context);
(async () => {
  const step = { type: 'color', rgb: [255, 0, 255], durationMs: 100 };
  context.validateSequence({ loop: false, steps: [step] }, 20);
  for (const rgb of [[256, 0, 0], [-1, 0, 0], [0.5, 0, 0], [0, 0], ['255', 0, 0]]) {
    assert.throws(() => context.validateSequence({ loop: false, steps: [{ ...step, rgb }] }, 20));
  }
  // No servo controls are supplied: a color step must never touch servo state.
  await context.applySequenceStep(step);
  context.servoControls = [{ ready: false }];
  context.applyServoState = () => { throw Error('Unavailable servo state must not change'); };
  context.requestServo = () => { throw Error('Unavailable servo must not receive commands'); };
  await context.applySequenceStep({ angles: [90], servoStates: [0], durationMs: 100 });
  await context.applySequenceStep(step);
  context.offlineSimulation = true;
  context.fetch = () => { throw Error('Simulation must not send LED requests'); };
  await context.applySequenceStep(step);
  context.offlineSimulation = false;
  context.fetch = async () => ({ ok: false, text: async () => 'LED unavailable' });
  await assert.rejects(context.applySequenceStep(step), /LED unavailable/);
  console.log('Color steps passed: RGB validation, playback API, servo isolation, simulation and request failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
