const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('data/app.js', 'utf8');
assert(!source.includes('{ loop: false, finish: false, steps: [] }'));
const read = source.slice(source.indexOf('async function readSequence('), source.indexOf('async function loadSequence('));
(async () => {
  for (const finish of [undefined, false, true]) {
    const context = { robotPersisted: true, localConfigServer: true, offlineSimulation: false, robotStorageAvailable: true,
      robotSequenceEndpoint: () => '/sequence', AbortSignal,
      fetch: async () => ({ ok: true, json: async () => ({ loop: false, finish, steps: [] }) }) };
    vm.createContext(context); vm.runInContext(read, context);
    const sequence = await context.readSequence('a');
    assert.equal(sequence.finish, finish !== false, 'Missing mode defaults to Finish; explicit choices survive');
  }
  console.log('Sequence default passed: new sequence defaults, legacy missing mode and saved Timed/Finish choices.');
})().catch(error => { console.error(error); process.exitCode = 1; });
